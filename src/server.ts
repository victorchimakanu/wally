import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { config } from "./config.js";
import { getLogger, scrubSecrets } from "./logger.js";
import { wdkSubprocess } from "./wdk/server.js";
import { startSessionReaper } from "./session/manager.js";
import { listSessions } from "./session/store.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { attachWsServer } from "./routes/ws.js";
import { getDb } from "./db/index.js";
import { makeSessionCookie, verifySessionCookie, isAllowedOrigin, checkAccessToken } from "./middleware/auth.js";
import { captureSeed, getRecoveryPhraseForBackup, acknowledgeBackup } from "./wdk/seed.js";
import { getOrCreateSession } from "./session/manager.js";
import { getSession, getSessionOwner, ensureSessionOwner } from "./session/store.js";

const log = getLogger("server");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Last-resort scrubbing for anything that reaches stderr outside pino (a
// throw during startup, an unhandled rejection), so a secret in an error
// string never lands in raw logs.
process.on("unhandledRejection", (reason) => {
  const s = reason instanceof Error ? reason.message : String(reason);
  log.error({ scope: "unhandledRejection" }, scrubSecrets(s));
});
process.on("uncaughtException", (err) => {
  log.error({ scope: "uncaughtException" }, scrubSecrets(err.message));
  process.exit(1);
});

async function main() {
  // 0. Capture the seed out of the parent environment before anything else so
  //    it is not resident in process.env for the process lifetime.
  captureSeed();

  // 1. Initialize the database (creates tables if needed)
  getDb();

  // 2. Start the WDK MCP subprocess
  log.info("Starting WDK MCP subprocess...");
  await wdkSubprocess.start();

  wdkSubprocess.on("fatal", () => {
    log.error("WDK MCP subprocess cannot restart. Exiting.");
    process.exit(1);
  });

  // 3. Create Fastify
  const app = Fastify({ logger: false });

  // 4. Serve static public/ files
  const publicDir = path.join(__dirname, "..", "public");
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
  };

  // Content Security Policy: same-origin only. Model output is rendered with
  // DOM APIs, but CSP is the backstop if any sink is ever missed.
  const CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; " +
    "base-uri 'none'; frame-ancestors 'none'";

  app.get("/", async (req, reply) => {
    // Issue (or keep) the signed HttpOnly session cookie. The browser cannot
    // read or forge it; the WebSocket upgrade requires it. When the server is
    // exposed off-loopback, a new cookie is issued only to a caller that
    // presents the shared access token — otherwise anyone reaching the port
    // could obtain a session and operate the wallet.
    let sessionId = verifySessionCookie(req.headers["cookie"]);
    if (!sessionId) {
      const headerVal = req.headers["x-wally-access"];
      // Header only — never a query parameter, which would leak the secret via
      // browser history, Referer, and access logs.
      if (!checkAccessToken(Array.isArray(headerVal) ? headerVal[0] : headerVal)) {
        return reply.code(401).type("text/plain").send("Access token required.");
      }
      sessionId = getOrCreateSession();
      reply.header("set-cookie", makeSessionCookie(sessionId));
    }
    const html = readFileSync(path.join(publicDir, "reach.html"), "utf-8");
    return reply
      .header("content-security-policy", CSP)
      .header("referrer-policy", "no-referrer")
      .type("text/html; charset=utf-8")
      .send(html);
  });

  app.get("/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    const ext = path.extname(file);
    const mime = mimeTypes[ext];
    if (!mime) return reply.code(404).send("Not found");
    // The app shell (HTML) is served only through GET /, which applies the CSP
    // and the access-token gate. Do not let it be fetched raw here, bypassing
    // both. Static assets (.js/.css) are fine.
    if (ext === ".html") return reply.code(404).send("Not found");
    // Path-traversal containment: resolve the candidate and confirm it stays
    // inside publicDir. Without this, "..%2f..%2fsrc%2fconfig.js" escapes and
    // reads arbitrary files. Also reject any separator/parent segment outright.
    if (file.includes("/") || file.includes("\\") || file.includes("..")) {
      return reply.code(404).send("Not found");
    }
    const filePath = path.resolve(publicDir, file);
    if (filePath !== path.join(publicDir, file) || !filePath.startsWith(publicDir + path.sep)) {
      return reply.code(404).send("Not found");
    }
    if (!existsSync(filePath)) return reply.code(404).send("Not found");
    return reply.type(mime).send(readFileSync(filePath, "utf-8"));
  });

  // 5. Register API routes
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

  // Chat sessions for the sidebar. Requires the signed session cookie and a
  // same-origin caller — never exposed to unauthenticated clients.
  app.get("/api/sessions", async (req, reply) => {
    const activeId = verifySessionCookie(req.headers["cookie"]);
    if (!isAllowedOrigin(req.headers["origin"]) || !activeId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    // Only the caller's own sessions — never every session in the database.
    const owner = getSessionOwner(activeId);
    return reply.send({ sessions: owner ? listSessions(owner) : [], activeId });
  });

  // Server-side session switching: the HttpOnly cookie is not scriptable, so
  // the sidebar switches sessions here and gets a re-signed cookie back. The
  // target must belong to the same owner as the caller's current session, so
  // a client can never adopt another owner's session by guessing its id.
  app.post("/api/session/switch", async (req, reply) => {
    const activeId = verifySessionCookie(req.headers["cookie"]);
    if (!isAllowedOrigin(req.headers["origin"]) || !activeId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const { id } = (req.body ?? {}) as { id?: string };
    if (!id || getSession(id) === undefined) return reply.code(404).send({ error: "unknown session" });
    const callerOwner = ensureSessionOwner(activeId);
    if (getSessionOwner(id) !== callerOwner) {
      return reply.code(403).send({ error: "forbidden" });
    }
    getOrCreateSession(id);
    return reply.header("set-cookie", makeSessionCookie(id)).send({ ok: true });
  });

  // One-time recovery-phrase backup for an auto-generated wallet. Returns the
  // phrase only while a backup is still pending; the client shows it once, the
  // user writes it down, then acks. Cookie + same-origin gated like the rest.
  app.get("/api/wallet/recovery", async (req, reply) => {
    if (!isAllowedOrigin(req.headers["origin"]) || !verifySessionCookie(req.headers["cookie"])) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const phrase = getRecoveryPhraseForBackup();
    return reply.header("referrer-policy", "no-referrer").send({ pendingBackup: phrase !== null, phrase: phrase ?? undefined });
  });

  app.post("/api/wallet/recovery/ack", async (req, reply) => {
    if (!isAllowedOrigin(req.headers["origin"]) || !verifySessionCookie(req.headers["cookie"])) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    acknowledgeBackup();
    return reply.send({ ok: true });
  });

  app.post("/api/session/new", async (req, reply) => {
    const activeId = verifySessionCookie(req.headers["cookie"]);
    if (!isAllowedOrigin(req.headers["origin"]) || !activeId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    // A new chat inherits the caller's owner so it appears in their sidebar.
    // ensureSessionOwner backfills legacy null-owner sessions so the new chat
    // is not orphaned under a fresh random owner.
    const id = getOrCreateSession(undefined, ensureSessionOwner(activeId));
    return reply.header("set-cookie", makeSessionCookie(id)).send({ ok: true });
  });

  // 6. Attach WebSocket server to the HTTP server before listening
  attachWsServer(app);

  // 7. Start session reaper (prunes idle sessions every minute)
  startSessionReaper();

  // 8. Listen
  await app.listen({ port: config.port, host: config.host });
  log.info({ port: config.port, host: config.host }, "Wally server started");

  // 9. Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      log.info({ signal }, "Shutting down");
      await wdkSubprocess.stop();
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  const s = err instanceof Error ? err.message : String(err);
  console.error("Fatal startup error:", scrubSecrets(s));
  process.exit(1);
});
