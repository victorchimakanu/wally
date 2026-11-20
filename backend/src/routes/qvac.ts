import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { config } from "../config.js";
import { getLogger } from "../logger.js";

const log = getLogger("qvac");

/**
 * QVAC passthrough.
 *
 * MEASURED 20 Oct 2026: QVAC's HTTP server returns `access-control-allow-origin` on ordinary
 * JSON responses but **omits it on streaming `text/event-stream` responses**. A browser
 * therefore blocks every streamed chat reply with `TypeError: Failed to fetch` after about
 * 10ms, while curl — which does not enforce CORS — sees a perfectly good 200.
 *
 *   non-streaming POST  → access-control-allow-origin present
 *   streaming POST      → header absent, browser discards the response
 *
 * Native builds send no Origin header, so they never hit this. It breaks the web preview only.
 *
 * Forwarding through here fixes it because the server-wide onRequest hook sets the CORS
 * header on every response, streamed or not. The body is piped through untouched, so
 * streaming still streams and the app's token-by-token preview is preserved.
 *
 * This holds no keys and makes no decisions; it is a transport fix, nothing more.
 */
export async function qvacRoutes(app: FastifyInstance): Promise<void> {
  /** Model list. The app calls this to verify the assistant connection. */
  app.get("/v1/models", async (_request, reply) => {
    try {
      const upstream = await fetch(`${config.qvacUrl}/v1/models`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await upstream.text();
      return reply
        .code(upstream.status)
        .header("content-type", upstream.headers.get("content-type") ?? "application/json")
        .send(body);
    } catch (error) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, "qvac model list unavailable");
      return reply.code(503).send({ error: "The local model server is not reachable. Start it with: npm run ai:server" });
    }
  });

  /** Chat completions, streaming or not. */
  app.post("/v1/chat/completions", async (request, reply) => {
    const started = Date.now();
    const streaming = (request.body as { stream?: unknown } | undefined)?.stream === true;

    let upstream: Response;
    try {
      upstream = await fetch(`${config.qvacUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: streaming ? "text/event-stream" : "application/json" },
        body: JSON.stringify(request.body),
        // Inference, not a quick API call: this needs its own long budget.
        signal: AbortSignal.timeout(config.qvacTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      log.warn({ streaming, timedOut, ms: Date.now() - started }, "qvac request failed");
      return reply.code(503).send({
        error: timedOut
          ? "The model took too long to answer. Nothing was submitted."
          : "The local model server is not reachable. Nothing was submitted.",
      });
    }

    reply.code(upstream.status).header("content-type", upstream.headers.get("content-type") ?? "application/json");

    if (!upstream.body) {
      return reply.send(await upstream.text());
    }

    // Pipe rather than buffer, so streamed tokens reach the app as they are produced.
    // Node's Readable.fromWeb keeps backpressure intact.
    log.info({ streaming, status: upstream.status, ms: Date.now() - started }, "qvac upstream responded");
    return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
  });
}
