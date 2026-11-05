import type { FastifyInstance } from "fastify";
import {
  allowedBundlerMethods, bundlerUrl, isChain, paymasterUrl, PAYMASTER_METHODS, config,
} from "../config.js";
import { singleFlight } from "../cache.js";
import { fetchJson, UpstreamError } from "../upstream.js";
import { getLogger } from "../logger.js";

const log = getLogger("gasless");

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/**
 * The ERC-4337 bundler and paymaster, fronted.
 *
 * **Why these do not go direct from the phone.** Pimlico puts the API key in the endpoint
 * itself — `https://api.pimlico.io/v2/<chainId>/rpc?apikey=…` — so an app bundle carrying that
 * URL hands the key to anyone who unzips the APK. For the bundler that is a stolen rate limit.
 * For the paymaster it is worse: a sponsorship policy is a budget, and a leaked key is someone
 * else spending it. The key belongs here, where the provider keys already live.
 *
 * **This is the one route in the service that costs money when it is used.** The app-key check
 * and the rate limiter are not belt-and-braces here, they are the budget's only protection, and
 * the known per-IP weakness under carrier-grade NAT (see README) applies to them as it does
 * everywhere else.
 *
 * **Nothing is cached, ever.** Not a conservative default — a correctness requirement.
 * `pm_getPaymasterData` returns data signed over one exact user operation, and a gas price or a
 * stub returned for someone else's operation is not an approximation of the right answer, it is
 * an invalid one. Identical concurrent calls are still coalesced, because two callers asking
 * the same question with the same parameters is one question.
 *
 * The method allowlist comes from `abstractionkit`, the library the installed WDK ERC-4337
 * package actually calls, rather than from a provider's documentation.
 */
const flight = singleFlight<Record<string, unknown>>();

type Upstream = {
  label: "bundler" | "paymaster";
  url(chain: "arbitrum" | "ethereum"): string | undefined;
  methods(): readonly string[];
};

function register(app: FastifyInstance, upstream: Upstream): void {
  app.post(`/v1/${upstream.label}/:chain`, async (request, reply) => {
    const chain = (request.params as Record<string, unknown>)["chain"];
    if (!isChain(chain)) {
      return reply.code(400).send({ error: "Unknown chain. Supported: arbitrum, ethereum." });
    }

    const target = upstream.url(chain);
    if (!target) {
      // Said plainly, and distinguished from a chain that does not exist: Ethereum runs a plain
      // EOA, so there is nothing to bundle there however the service is configured.
      return reply.code(503).send({
        error: chain === "arbitrum"
          ? `No ${upstream.label} is configured, so gasless transfers are not available.`
          : `${upstream.label === "bundler" ? "Bundling" : "Sponsorship"} applies only to Arbitrum, which is the chain running a smart account.`,
      });
    }

    const body = request.body as RpcRequest | RpcRequest[] | undefined;
    if (Array.isArray(body)) {
      return reply.code(400).send({ error: "Send one JSON-RPC request at a time." });
    }
    if (!body || typeof body !== "object" || typeof body.method !== "string") {
      return reply.code(400).send({ error: "Invalid JSON-RPC request." });
    }

    const allowed = upstream.methods();
    if (!allowed.includes(body.method)) {
      log.warn({ chain, method: body.method, upstream: upstream.label }, "refused method");
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

    try {
      const key = `${upstream.label}:${chain}:${body.method}:${JSON.stringify(params)}`;
      const result = await flight.run(key, () =>
        fetchJson<Record<string, unknown>>(
          target,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: body.method, params }),
          },
          `${upstream.label} ${chain}`,
        ),
      );
      // A JSON-RPC error is a valid upstream answer and passes through, but the id must be this
      // caller's: a coalesced response carries whichever id was sent first.
      return reply.send({ ...result, id });
    } catch (error) {
      const status = error instanceof UpstreamError ? error.status : 502;
      log.warn({ chain, method: body.method, upstream: upstream.label, status }, "upstream failed");
      return reply.code(status === 429 ? 429 : 503).send({
        error: `The ${upstream.label} could not be reached. Nothing was submitted and no fee was charged.`,
      });
    }
  });
}

export async function gaslessRoutes(app: FastifyInstance): Promise<void> {
  register(app, { label: "bundler", url: bundlerUrl, methods: allowedBundlerMethods });
  register(app, { label: "paymaster", url: paymasterUrl, methods: () => PAYMASTER_METHODS });

  /** Lets the app find out whether gasless is available before it offers it. */
  app.get("/v1/gasless", async (_request, reply) =>
    reply.send({
      /** Arbitrum only: Ethereum runs a plain EOA with no user operations. */
      available: Boolean(bundlerUrl("arbitrum") && paymasterUrl("arbitrum")),
      submitEnabled: config.rpcAllowBroadcast,
      bundlerMethods: allowedBundlerMethods(),
      paymasterMethods: PAYMASTER_METHODS,
    }),
  );
}
