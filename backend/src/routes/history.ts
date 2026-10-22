import type { FastifyInstance } from "fastify";
import { CHAINS, config, isChain, type Chain } from "../config.js";
import { TtlCache, singleFlight } from "../cache.js";
import { fetchHistory, type LiveTransaction } from "../indexer.js";
import { getLogger } from "../logger.js";

const log = getLogger("history");

type Payload = { items: LiveTransaction[]; source: string };
const cache = new TtlCache<Payload>(config.historyCacheMs);

/** Two screens opening at once, or a pull-to-refresh race, is still one question per chain. */
const flight = singleFlight<Payload>();

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Address transaction history.
 *
 * Shaped to match what the Activity screen consumes (`LiveHistory` in the app):
 * a flat, time-sorted `items[]` across chains plus a per-chain `errors[]`, so one chain
 * failing still shows the other rather than blanking the screen. That mirrors the dev
 * wallet server's `history()`, which queries both chains in parallel and reports partial
 * failure instead of pretending there are no transactions.
 *
 * The app merges its own local submission journal on top of this; the backend cannot know
 * about transactions a phone submitted but never got a receipt for.
 *
 * `chain` is optional. Omit it for both chains, which is what Activity wants.
 *
 * Addresses are per chain, not one address for all of them: the two need not match. The
 * mobile worklet config gives Arbitrum an ERC-4337 smart account
 * (`@tetherto/wdk-wallet-evm-erc-4337`) whose address is derived from the account factory,
 * not from the key, so it differs from the plain EOA used on Ethereum. The dev wallet server
 * happens to use an EOA on both, which hides this. Hence `address` as a fallback plus
 * `address.<chain>` overrides, rather than assuming one address is right everywhere.
 */
export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/history", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const requested = query["chain"];

    if (requested !== undefined && !isChain(requested)) {
      return reply.code(400).send({ error: "Unknown chain. Supported: arbitrum, ethereum, or omit for both." });
    }

    const chains: Chain[] = requested === undefined ? (Object.keys(CHAINS) as Chain[]) : [requested as Chain];

    const fallback = query["address"];
    const addresses = new Map<Chain, string>();
    for (const chain of chains) {
      const specific = query[`address.${chain}`] ?? fallback;
      if (typeof specific !== "string" || !ADDRESS.test(specific)) {
        return reply.code(400).send({
          error: `Provide a complete 0x address for ${CHAINS[chain].name}, as address or address.${chain}.`,
        });
      }
      addresses.set(chain, specific);
    }

    // One chain being down must not hide the other, so each is settled independently.
    const settled = await Promise.all(
      chains.map(async (chain) => {
        const address = addresses.get(chain) as string;
        const key = `${config.indexerProvider}:${chain}:${address.toLowerCase()}`;
        const hit = cache.get(key);
        if (hit) return { chain, items: hit.value.items, error: null as string | null, cache: "hit" as const };

        try {
          const result = await flight.run(key, () => fetchHistory(chain, address));
          cache.set(key, result);
          return { chain, items: result.items, error: null as string | null, cache: "miss" as const };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const needsKey = /api key/i.test(detail);
          log.warn({ chain, provider: config.indexerProvider, err: detail }, "chain history unavailable");

          const stale = cache.stale(key);
          if (stale) {
            return {
              chain,
              items: stale.value.items,
              error: `${CHAINS[chain].name} history is unavailable. Showing saved data.`,
              cache: "stale" as const,
            };
          }
          return {
            chain,
            items: [] as LiveTransaction[],
            // A missing key is an operator problem, not a network one, and saying so saves
            // an hour of looking in the wrong place.
            error: needsKey
              ? `${CHAINS[chain].name} history needs an indexer API key (set ETHERSCAN_API_KEY).`
              : `${CHAINS[chain].name} history is unavailable right now.`,
            cache: "miss" as const,
          };
        }
      }),
    );

    const errors = settled.map((entry) => entry.error).filter((error): error is string => error !== null);

    // Deduplicate on hash+chain: the same transaction can appear from more than one source.
    const seen = new Set<string>();
    const items = settled
      .flatMap((entry) => entry.items)
      .filter((item) => {
        const id = `${item.chain}:${item.hash.toLowerCase()}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      .slice(0, 50);

    // Every chain failed and nothing was cached: that is a failure, not an empty history.
    // Returning [] would be rendered as "no transactions", which is a different claim.
    if (items.length === 0 && errors.length === chains.length) {
      return reply.code(503).send({
        error: errors[0],
        errors,
        hint: "Submitted transactions can still be resolved individually with eth_getTransactionReceipt.",
      });
    }

    const cacheState = settled.every((entry) => entry.cache === "hit")
      ? "hit"
      : settled.some((entry) => entry.cache === "stale")
        ? "stale"
        : "miss";

    return reply.header("x-wally-cache", cacheState).send({
      version: 1,
      // Echoed per chain so a wrong-address bug is visible in the response, not guessed at.
      addresses: Object.fromEntries(addresses),
      fetchedAt: Date.now(),
      source: config.indexerProvider,
      items,
      errors,
    });
  });
}
