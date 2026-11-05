/**
 * Wally backend.
 *
 * A provider proxy and nothing else. It holds no keys, no seeds and no personal data, and it
 * cannot sign or authorise anything. Signing happens on the phone — see
 * ../../docs/ADR-001-key-custody.md.
 */
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { config, onLoopback, trustProxySetting } from "./config.js";
import { getLogger, scrubSecrets } from "./logger.js";
import { healthRoutes } from "./routes/health.js";
import { marketRoutes } from "./routes/market.js";
import { rpcRoutes } from "./routes/rpc.js";
import { historyRoutes } from "./routes/history.js";
import { qvacRoutes } from "./routes/qvac.js";

const log = getLogger("server");

process.on("unhandledRejection", (reason) => {
  log.error({ scope: "unhandledRejection" }, scrubSecrets(reason instanceof Error ? reason.message : String(reason)));
});
process.on("uncaughtException", (error) => {
  log.error({ scope: "uncaughtException" }, scrubSecrets(error.message));
  process.exit(1);
});

/**
 * Compare the presented key without leaking its length or contents through timing.
 * Returns false fast on a length mismatch, which timingSafeEqual cannot handle itself.
 */
function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Fixed-window limiter per client IP. In-memory is adequate for a single VPS process. */
function createRateLimiter(perMinute: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return function allow(key: string): boolean {
    const now = Date.now();
    // Opportunistic sweep; this map only grows with distinct active clients.
    if (windows.size > 10_000) for (const [id, w] of windows) if (w.resetAt <= now) windows.delete(id);
    const window = windows.get(key);
    if (!window || window.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    window.count++;
    return window.count <= perMinute;
  };
}

export function buildServer() {
  const app = Fastify({
    logger: false,
    // Chain history and RPC payloads are small; a signed transaction is the largest thing here.
    bodyLimit: 64 * 1024,
    // Not `true`: that would honour X-Forwarded-For from any client and let anyone who can
    // reach this port directly forge their IP, defeating the rate limiter. See TRUSTED_PROXY.
    trustProxy: trustProxySetting(),
  });

  const allow = createRateLimiter(config.rateLimitPerMinute);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Native apps send no Origin. Browsers do, and only configured origins are answered.
    const origin = request.headers.origin;
    if (origin) {
      if (!config.allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: "Origin not allowed." });
      }
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");

    if (request.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // x-wally-key must be listed: it is a custom header, so the browser preflights every
      // request carrying it and refuses the request outright if the preflight omits it. The
      // service *requires* that header off loopback, so leaving it out breaks every browser
      // request the moment WALLY_APP_KEY is set. Measured 22 Oct 2026.
      reply.header("Access-Control-Allow-Headers", "Content-Type, x-wally-key");
      // Cache the preflight so a keyed app does not spend two requests on every call; the
      // rate limiter counts preflights too.
      reply.header("Access-Control-Max-Age", "600");
      return reply.code(204).send();
    }

    // Shallow /health stays open so a load balancer or monitor needs no credential.
    // ?deep=1 does not: it spends upstream calls.
    const shallowHealth = request.url === "/health";
    if (shallowHealth) return;

    // Rate limit before the key check, so a brute-force attempt is bounded too.
    if (!allow(request.ip)) {
      return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    }

    if (config.appKey) {
      const presented = request.headers["x-wally-key"];
      if (typeof presented !== "string" || !keyMatches(presented, config.appKey)) {
        // Log that it happened, never what was presented.
        log.warn({ url: request.url, ip: request.ip }, "rejected a request with a missing or wrong key");
        return reply.code(401).send({ error: "This service requires a valid x-wally-key header." });
      }
    }
    return;
  });

  // Never return an upstream exception verbatim: provider errors can echo a keyed URL.
  app.setErrorHandler((error: Error & { statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
    log.error({ url: request.url, err: scrubSecrets(error.message) }, "request failed");
    const status = typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ error: status === 400 ? "Invalid request." : "The service could not complete this request." });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Unknown route." }));

  void app.register(healthRoutes);
  void app.register(marketRoutes);
  void app.register(rpcRoutes);
  void app.register(historyRoutes);

  /**
   * The QVAC passthrough exists only to work around a CORS bug in the browser preview, and
   * the app can only ever reach it from a development build over loopback: the endpoint is
   * `__DEV__`-gated in mobile/src/demo/store.tsx and `localEndpoint()` in
   * mobile/src/services/qvac.ts refuses anything that is not 127.0.0.1, localhost or
   * 10.0.2.2. Serving it from a deployed instance would publish a model relay that no client
   * can legitimately call, so it is registered only when this process is on loopback.
   */
  if (onLoopback()) {
    void app.register(qvacRoutes);
  } else {
    log.info({}, "qvac passthrough not registered: development-only and this host is not loopback");
  }

  return app;
}

async function main(): Promise<void> {
  const app = buildServer();
  await app.listen({ port: config.port, host: config.host });
  log.info(
    { port: config.port, host: config.host, broadcast: config.rpcAllowBroadcast },
    "wally backend listening · holds no keys",
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      log.info({ signal }, "shutting down");
      void app.close().then(() => process.exit(0));
    });
  }
}

// Only start when run directly, so tests can import buildServer without binding a port.
// Same guard the desktop wallet API server uses.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
