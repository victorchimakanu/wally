import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { TtlCache, singleFlight } from "../cache.js";
import { fetchJson, UpstreamError } from "../upstream.js";
import { getLogger } from "../logger.js";

const log = getLogger("market");

/** The app shows exactly these assets. Anything else is refused rather than forwarded. */
const ASSETS = ["bitcoin", "ethereum", "solana", "tether"] as const;
const CURRENCIES = ["usd", "ngn", "eur"] as const;
const DAYS = ["1", "7", "30", "365"] as const;

type Currency = (typeof CURRENCIES)[number];
const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
const isAsset = (v: unknown): v is string => typeof v === "string" && (ASSETS as readonly string[]).includes(v);
const isDays = (v: unknown): v is string => typeof v === "string" && (DAYS as readonly string[]).includes(v);

const markets = new TtlCache<unknown>(config.marketCacheMs);
const charts = new TtlCache<unknown>(config.chartCacheMs);

/**
 * CoinGecko's public tier throttles hard, and a cache expiry releases every waiting phone at
 * once. Without coalescing, that burst is what the provider sees. See singleFlight in cache.ts.
 */
const flight = singleFlight<unknown>();

function coingecko(path: string, params: Record<string, string>): string {
  const url = new URL(config.coingeckoBase + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function headers(): Record<string, string> {
  return config.coingeckoApiKey ? { "x-cg-demo-api-key": config.coingeckoApiKey } : {};
}

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Prices for the watchlist. Cached briefly because CoinGecko's public tier throttles
   * aggressively and every phone would otherwise hit it directly.
   */
  app.get("/v1/market", async (request, reply) => {
    const currency = (request.query as Record<string, unknown>)["currency"] ?? "usd";
    if (!isCurrency(currency)) {
      return reply.code(400).send({ error: "Supported currencies are usd, ngn and eur." });
    }

    const key = `markets:${currency}`;
    const hit = markets.get(key);
    if (hit) return reply.header("x-wally-cache", "hit").send({ currency, fetchedAt: hit.storedAt, fresh: true, data: hit.value });

    try {
      const data = await flight.run(key, () =>
        fetchJson<unknown>(
          coingecko("/coins/markets", {
            vs_currency: currency,
            ids: ASSETS.join(","),
            price_change_percentage: "24h",
          }),
          { headers: headers() },
          "coingecko markets",
        ),
      );
      markets.set(key, data);
      return reply.header("x-wally-cache", "miss").send({ currency, fetchedAt: Date.now(), fresh: true, data });
    } catch (error) {
      // A stale price labelled stale is more useful to the app than an error it must hide.
      const stale = markets.stale(key);
      if (stale) {
        log.warn({ currency }, "serving stale market data");
        return reply.header("x-wally-cache", "stale").send({ currency, fetchedAt: stale.storedAt, fresh: false, data: stale.value });
      }
      const status = error instanceof UpstreamError ? error.status : 502;
      log.warn({ currency, status, err: error instanceof Error ? error.message : String(error) }, "market request failed with no cache to fall back on");
      return reply.code(status === 429 ? 429 : 503).send({ error: "Market data is unavailable right now." });
    }
  });

  /** Price history for one asset chart. */
  app.get("/v1/market/chart", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const id = query["id"], days = query["days"] ?? "7", currency = query["currency"] ?? "usd";
    if (!isAsset(id)) return reply.code(400).send({ error: `Supported assets are ${ASSETS.join(", ")}.` });
    if (!isDays(days)) return reply.code(400).send({ error: `Supported ranges are ${DAYS.join(", ")} days.` });
    if (!isCurrency(currency)) return reply.code(400).send({ error: "Supported currencies are usd, ngn and eur." });

    const key = `chart:${id}:${days}:${currency}`;
    const hit = charts.get(key);
    if (hit) return reply.header("x-wally-cache", "hit").send({ id, days, currency, fetchedAt: hit.storedAt, fresh: true, data: hit.value });

    try {
      const data = await flight.run(key, () =>
        fetchJson<unknown>(
          coingecko(`/coins/${id}/market_chart`, { vs_currency: currency, days }),
          { headers: headers() },
          "coingecko chart",
        ),
      );
      charts.set(key, data);
      return reply.header("x-wally-cache", "miss").send({ id, days, currency, fetchedAt: Date.now(), fresh: true, data });
    } catch (error) {
      const stale = charts.stale(key);
      if (stale) {
        return reply.header("x-wally-cache", "stale").send({ id, days, currency, fetchedAt: stale.storedAt, fresh: false, data: stale.value });
      }
      const status = error instanceof UpstreamError ? error.status : 502;
      log.warn({ id, days, currency, status, err: error instanceof Error ? error.message : String(error) }, "chart request failed with no cache to fall back on");
      return reply.code(status === 429 ? 429 : 503).send({ error: "Chart data is unavailable right now." });
    }
  });
}
