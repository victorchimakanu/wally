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
import { callerOf, createRateLimiter, INSTALL_HEADER } from "./ratelimit.js";

/** The shared key callers present. Named once so the reader and the preflight cannot drift. */
export const KEY_HEADER = "x-wally-key";

/**
 * Every custom request header this service reads.
 *
 * Adding one means the browser will preflight requests that carry it, so it has to appear in
 * `Access-Control-Allow-Headers` or those requests fail before they arrive. Keeping the list
 * here, beside the code that reads them, is what stops that being forgotten a third time —
 * `test/access.test.ts` asserts the preflight lists every entry.
 */
export const CUSTOM_HEADERS = [KEY_HEADER, INSTALL_HEADER] as const;
import { healthRoutes } from "./routes/health.js";
import { marketRoutes } from "./routes/market.js";
import { rpcRoutes } from "./routes/rpc.js";
import { statusRoutes } from "./routes/status.js";
import { watchRoutes } from "./routes/watch.js";
import { gaslessRoutes } from "./routes/gasless.js";
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

export function buildServer() {
  const app = Fastify({
    logger: false,
    // Chain history and RPC payloads are small; a signed transaction is the largest thing here.
    bodyLimit: 64 * 1024,
    // Not `true`: that would honour X-Forwarded-For from any client and let anyone who can
    // reach this port directly forge their IP, defeating the rate limiter. See TRUSTED_PROXY.
    trustProxy: trustProxySetting(),
  });

  // Two limits, and a request has to pass both. One separates honest callers from each other;
  // the other bounds a machine that will not identify itself honestly. See `ratelimit.ts`.
  const allowCaller = createRateLimiter(config.rateLimitPerMinute);
  const allowAddress = createRateLimiter(config.rateLimitPerAddress);

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
      // Every custom header this service reads has to be listed. A custom header makes the
      // browser preflight the request, and a preflight that omits the header refuses the
      // request outright — the app sees a network failure, not a 4xx, so nothing in the
      // response explains it.
      //
      // This has now happened twice. `x-wally-key` was missing and broke every browser
      // request the moment WALLY_APP_KEY was set (22 Oct 2026, #3). The comment that fixed it
      // sat directly above this line while #55 added `x-wally-install` on 19 Nov and did not
      // add it here — so from that day, every browser request carrying the installation id
      // failed. Measured 23 Nov: Activity showed "Failed to fetch" and fell back to the dev
      // wallet server, losing the indexed history it exists to fetch.
      //
      // So the list is no longer written out. It is built from CUSTOM_HEADERS, which is the
      // same constant the readers below use, and `test/access.test.ts` walks it.
      reply.header("Access-Control-Allow-Headers", ["Content-Type", ...CUSTOM_HEADERS].join(", "));
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
    //
    // The address ceiling is checked first and applies to everyone: it is the only limit an
    // attacker cannot widen by inventing identifiers. Then the caller's own budget, which is
    // their installation id when they sent one and their address when they did not — the
    // latter being exactly the policy that existed before ids.
    const caller = callerOf(request);
    if (!allowAddress(request.ip) || !allowCaller(caller.key)) {
      return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    }

    if (config.appKey) {
      const presented = request.headers[KEY_HEADER];
      if (typeof presented !== "string" || !keyMatches(presented, config.appKey)) {
        // Log that it happened, never what was presented.
        log.warn({ url: request.url, ip: request.ip }, "rejected a request with a missing or wrong key");
        return reply.code(401).send({ error: `This service requires a valid ${KEY_HEADER} header.` });
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
  void app.register(statusRoutes);
  void app.register(gaslessRoutes);
  void app.register(watchRoutes);

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
