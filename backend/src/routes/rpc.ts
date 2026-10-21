import type { FastifyInstance } from "fastify";
import { allowedRpcMethods, isChain, rpcUrl, config } from "../config.js";
import { TtlCache } from "../cache.js";
import { fetchJson, UpstreamError } from "../upstream.js";
import { getLogger } from "../logger.js";

const log = getLogger("rpc");

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/**
 * Methods worth caching briefly.
 *
 * The app polls balances every 60 seconds per chain (see mobile/src/data/wallet.tsx), so
 * without this every phone forwards straight to the provider: two calls per user per minute,
 * untouched. A few seconds of cache collapses a crowd into one upstream request while still
 * feeling live, because a balance that is five seconds old is not a stale balance.
 *
 * Deliberately excluded:
 *   eth_estimateGas, eth_gasPrice   — feed a fee quote; must be current
 *   eth_getTransactionCount         — the nonce; a stale one produces a rejected transaction
 *   eth_getTransactionReceipt       — the answer changes from null to final exactly once
 *   eth_sendRawTransaction          — never
 */
const CACHEABLE = new Set(["eth_getBalance", "eth_chainId", "eth_blockNumber", "eth_getCode"]);

/** eth_chainId and eth_getCode are effectively immutable; a balance should age out quickly. */
function ttlFor(method: string): number {
  if (method === "eth_chainId" || method === "eth_getCode") return 600_000;
  if (method === "eth_blockNumber") return 5_000;
  return config.rpcCacheMs;
}

const caches = new Map<string, TtlCache<unknown>>();
function cacheFor(method: string): TtlCache<unknown> {
  let cache = caches.get(method);
  if (!cache) {
    cache = new TtlCache<unknown>(ttlFor(method), 500);
    caches.set(method, cache);
  }
  return cache;
}

/**
 * JSON-RPC proxy.
 *
 * The phone signs locally and this service holds no keys, so the only thing it can do is
 * forward or refuse. The method allowlist is the control: anything not named is rejected
 * here rather than reaching the provider.
 */
export async function rpcRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/rpc/:chain", async (request, reply) => {
    const chain = (request.params as Record<string, unknown>)["chain"];
    if (!isChain(chain)) {
      return reply.code(400).send({ error: "Unknown chain. Supported: arbitrum, ethereum." });
    }

    const body = request.body as RpcRequest | RpcRequest[] | undefined;
    if (Array.isArray(body)) {
      // Batches let one request fan out past the rate limit and complicate the allowlist.
      return reply.code(400).send({ error: "Send one JSON-RPC request at a time." });
    }
    if (!body || typeof body !== "object" || typeof body.method !== "string") {
      return reply.code(400).send({ error: "Invalid JSON-RPC request." });
    }

    const allowed = allowedRpcMethods();
    if (!allowed.includes(body.method)) {
      log.warn({ chain, method: body.method }, "refused rpc method");
      return reply.code(403).send({
        error: `Method ${body.method} is not available through this proxy.`,
        allowed,
      });
    }

    if (body.params !== undefined && !Array.isArray(body.params)) {
      return reply.code(400).send({ error: "JSON-RPC params must be an array." });
    }

    const id = typeof body.id === "number" || typeof body.id === "string" ? body.id : 1;
    const params = body.params ?? [];
    const payload = { jsonrpc: "2.0", id, method: body.method, params };

    // Key on chain + method + params so two addresses never share an answer.
    const cacheable = config.rpcCacheMs > 0 && CACHEABLE.has(body.method);
    const key = cacheable ? `${chain}:${body.method}:${JSON.stringify(params)}` : "";
    if (cacheable) {
      const hit = cacheFor(body.method).get(key);
      if (hit) {
        // The caller's own id must come back, not the id of whoever populated the cache.
        return reply
          .header("x-wally-cache", "hit")
          .send({ ...(hit.value as Record<string, unknown>), id });
      }
    }

    try {
      const result = await fetchJson<Record<string, unknown>>(
        rpcUrl(chain),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        `rpc ${chain}`,
      );
      // Only cache successful answers; a JSON-RPC error may be transient.
      if (cacheable && result && typeof result === "object" && !("error" in result)) {
        cacheFor(body.method).set(key, result);
      }
      // A JSON-RPC error is a valid upstream answer, so pass it through untouched.
      return reply.header("x-wally-cache", cacheable ? "miss" : "bypass").send(result);
    } catch (error) {
      const status = error instanceof UpstreamError ? error.status : 502;
      log.warn({ chain, method: body.method, status }, "rpc upstream failed");
      return reply.code(status === 429 ? 429 : 503).send({
        error: "The network node could not be reached. Nothing was submitted.",
      });
    }
  });

  /** Lets the app show which methods it may call, and whether broadcasting is enabled. */
  app.get("/v1/rpc/methods", async (_request, reply) =>
    reply.send({
      allowed: allowedRpcMethods(),
      broadcastEnabled: config.rpcAllowBroadcast,
      cached: [...CACHEABLE],
    }),
  );
}
