import type { FastifyInstance } from "fastify";
import { CHAINS, config, allowedRpcMethods, rpcUrl } from "../config.js";
import { fetchJson } from "../upstream.js";

/**
 * Liveness by default. `?deep=1` additionally pings each chain for its id, which is the
 * cheapest call that proves the provider is actually answering — use it from a monitor,
 * not from a load balancer, since it costs upstream requests.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (request, reply) => {
    const deep = (request.query as Record<string, unknown>)["deep"] === "1";

    const base = {
      status: "ok" as const,
      service: "wally-backend",
      uptimeSeconds: Math.floor(process.uptime()),
      chains: Object.keys(CHAINS),
      broadcastEnabled: config.rpcAllowBroadcast,
      rpcMethods: allowedRpcMethods().length,
    };

    if (!deep) return reply.send(base);

    const checks = await Promise.all(
      (Object.keys(CHAINS) as (keyof typeof CHAINS)[]).map(async (chain) => {
        try {
          const result = await fetchJson<{ result?: string }>(
            rpcUrl(chain),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
            },
            `rpc ${chain}`,
          );
          const reported = result.result ? Number.parseInt(result.result, 16) : null;
          return { chain, ok: reported === CHAINS[chain].id, chainId: reported, expected: CHAINS[chain].id };
        } catch {
          return { chain, ok: false, chainId: null, expected: CHAINS[chain].id };
        }
      }),
    );

    const healthy = checks.every((check) => check.ok);
    return reply.code(healthy ? 200 : 503).send({ ...base, status: healthy ? "ok" : "degraded", checks });
  });
}
