import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { config } from "./config.js";
import { getLogger } from "./logger.js";
import { wdkSubprocess } from "./wdk/server.js";
import { startSessionReaper } from "./session/manager.js";
import { listSessions } from "./session/store.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { attachWsServer } from "./routes/ws.js";
import { getDb } from "./db/index.js";

const log = getLogger("server");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
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

  app.get("/", async (_req, reply) => {
    const html = readFileSync(path.join(publicDir, "reach.html"), "utf-8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    const ext = path.extname(file);
    const mime = mimeTypes[ext];
    if (!mime) return reply.code(404).send("Not found");
    const filePath = path.join(publicDir, file);
    if (!existsSync(filePath)) return reply.code(404).send("Not found");
    return reply.type(mime).send(readFileSync(filePath, "utf-8"));
  });

  // 5. Register API routes
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

  // Chat sessions for the sidebar (local SQLite; newest first)
  app.get("/api/sessions", async (_req, reply) => {
    return reply.send(listSessions());
  });

  // 6. Attach WebSocket server to the HTTP server before listening
  attachWsServer(app);

  // 7. Start session reaper (prunes idle sessions every minute)
  startSessionReaper();

  // 8. Listen
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port }, "Wally server started");

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
  console.error("Fatal startup error:", err);
  process.exit(1);
});
