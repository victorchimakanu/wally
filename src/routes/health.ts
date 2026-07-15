import type { FastifyInstance } from "fastify";
import { checkQvacHealth } from "../qvac/client.js";
import { wdkSubprocess } from "../wdk/server.js";
import { getDb } from "../db/index.js";
import { getLogger } from "../logger.js";

const log = getLogger("routes:health");

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_req, reply) => {
    const [qvacResult] = await Promise.allSettled([checkQvacHealth()]);

    const qvac =
      qvacResult.status === "fulfilled" && qvacResult.value.ok ? "ok" : "error";

    const wdk = wdkSubprocess.client ? "ok" : "error";

    let db: "ok" | "error" = "ok";
    try {
      getDb().prepare("SELECT 1").get();
    } catch {
      db = "error";
    }

    const status = qvac === "ok" && wdk === "ok" && db === "ok" ? 200 : 503;

    return reply.status(status).send({
      qvac,
      wdk,
      db,
      uptime: Math.floor(process.uptime()),
    });
  });
}
