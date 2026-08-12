import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { verifySessionCookie } from "../middleware/auth.js";

// Minimal Prometheus-compatible /metrics endpoint.
// Extend with actual counters once @opentelemetry or prom-client is wired in.
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (req, reply) => {
    // Off-loopback, metrics (heap/uptime recon) require a valid session.
    if (config.allowRemote && !verifySessionCookie(req.headers["cookie"])) {
      return reply.code(401).send("unauthorized");
    }
    const uptime = process.uptime();
    const memMb = process.memoryUsage().heapUsed / 1024 / 1024;

    const body = [
      `# HELP wally_uptime_seconds Process uptime in seconds`,
      `# TYPE wally_uptime_seconds gauge`,
      `wally_uptime_seconds ${uptime.toFixed(1)}`,
      ``,
      `# HELP wally_heap_used_mb Heap memory used in megabytes`,
      `# TYPE wally_heap_used_mb gauge`,
      `wally_heap_used_mb ${memMb.toFixed(2)}`,
    ].join("\n");

    return reply.header("content-type", "text/plain; version=0.0.4").send(body);
  });
}
