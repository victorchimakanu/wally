import type { FastifyInstance } from "fastify";
import { isChain, rpcUrl, type Chain } from "../config.js";
import { fetchJson } from "../upstream.js";
import { getLogger } from "../logger.js";
import { createWatcher, type Receipt, type Watcher } from "../watcher.js";

const log = getLogger("watch");
const HASH = /^0x[0-9a-fA-F]{64}$/;

/** How often the open watches are checked. Slow on purpose: a block is not instant either. */
export const POLL_MS = 15_000;

async function receiptFor(chain: Chain, hash: string): Promise<Receipt> {
  const answer = await fetchJson<{ result?: Receipt }>(
    rpcUrl(chain),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
    },
    `watch ${chain}`,
  );
  return answer?.result ?? null;
}

/**
 * Watch a submitted transfer until the chain decides.
 *
 * The one thing a phone genuinely cannot do for itself: it sleeps mid-confirmation. Nothing
 * here notifies anybody — push needs a device token and therefore a development build, which
 * has never been made. What it does today is have the answer ready before the app asks, which
 * on the public Sepolia nodes is the difference between an instant Activity screen and a
 * twelve-second one.
 *
 * Both routes take a hash, which is public chain data. Nothing is written to disk and the list
 * expires; see `watcher.ts` for why that matters on a service that otherwise holds nothing.
 */
export async function watchRoutes(app: FastifyInstance, options?: { watcher?: Watcher }): Promise<void> {
  const watcher = options?.watcher ?? createWatcher({ fetchReceipt: receiptFor });

  // A single interval for the whole process. Unref'd so it never holds the process open —
  // a proxy that will not shut down because it is waiting on a poll is a worse problem than
  // a transfer checked a few seconds later.
  const timer = setInterval(() => {
    void watcher.tick().catch(error => log.warn({ err: String(error) }, "watch tick failed"));
  }, POLL_MS);
  timer.unref?.();
  app.addHook("onClose", async () => clearInterval(timer));

  app.post("/v1/watch/:chain/:hash", async (request, reply) => {
    const { chain, hash } = request.params as { chain?: string; hash?: string };
    if (!isChain(chain)) return reply.code(400).send({ error: "Unknown chain. Supported: arbitrum or ethereum." });
    if (typeof hash !== "string" || !HASH.test(hash)) return reply.code(400).send({ error: "Provide a complete 0x transaction hash." });

    const watch = watcher.watch(chain, hash);
    // Asked once immediately: a transfer submitted a minute ago may already be settled, and
    // making the caller wait a poll interval to find that out defeats the point.
    if (watch.checkedAt === 0) await watcher.tick().catch(() => {});
    return reply.send(watcher.get(chain, hash) ?? watch);
  });

  app.get("/v1/watch/:chain/:hash", async (request, reply) => {
    const { chain, hash } = request.params as { chain?: string; hash?: string };
    if (!isChain(chain)) return reply.code(400).send({ error: "Unknown chain. Supported: arbitrum or ethereum." });
    if (typeof hash !== "string" || !HASH.test(hash)) return reply.code(400).send({ error: "Provide a complete 0x transaction hash." });

    const watch = watcher.get(chain, hash);
    // Not watched is not an error — it is the honest answer, and it tells the app to submit
    // the hash rather than to assume anything about the transfer.
    if (!watch) return reply.code(404).send({ error: "That transfer is not being watched.", watching: false });
    return reply.send(watch);
  });
}
