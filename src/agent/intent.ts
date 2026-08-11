// IntentParser: validate and type the structured JSON that QVAC returns.
// QVAC guarantees the schema via constrained sampling, but we validate here
// anyway to catch any edge cases and to give TypeScript meaningful types.

import { z } from "zod";
import type { ParsedIntent } from "../qvac/client.js";

// ─── Per-intent param schemas ─────────────────────────────────────────────────

const SUPPORTED_CHAINS = ["ethereum", "arbitrum", "bitcoin"] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

const ChainSchema = z.enum(SUPPORTED_CHAINS);

const TransferParams = z.object({
  chain: ChainSchema,
  token: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive number"),
  to: z.string().min(10),
});

const SwapParams = z.object({
  chain: z.enum(["ethereum", "arbitrum"]),
  fromToken: z.string().min(1),
  toToken: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

const BridgeParams = z.object({
  fromChain: ChainSchema,
  toChain: ChainSchema,
  token: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

const BalanceParams = z.object({
  chain: z.union([ChainSchema, z.literal("all")]),
});

const PriceParams = z.object({
  token: z.string().min(1),
});

// LTV arrives from the model as a number ("50") or occasionally a string
// ("50%"). Normalize to a number in (0, 75]. 75 sits safely under Aave's
// liquidation thresholds for stablecoin collateral.
export const MAX_LTV_PERCENT = 75;

const LtvSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? parseFloat(v.replace("%", "").trim()) : v))
  .refine((n) => Number.isFinite(n) && n > 0 && n <= MAX_LTV_PERCENT, {
    message: `ltv must be a percentage between 1 and ${MAX_LTV_PERCENT}`,
  });

const LendBorrowParams = z.object({
  chain: z.enum(["ethereum", "arbitrum"]).default("arbitrum"),
  collateralToken: z.string().min(1).default("USDT"),
  collateralAmount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive number"),
  borrowToken: z.string().min(1).default("USDT"),
  ltv: LtvSchema.optional(),
});

// ─── Typed intent union ───────────────────────────────────────────────────────

export type TransferIntent = { intent: "transfer"; params: z.infer<typeof TransferParams>; reply: string };
export type SwapIntent = { intent: "swap"; params: z.infer<typeof SwapParams>; reply: string };
export type BridgeIntent = { intent: "bridge"; params: z.infer<typeof BridgeParams>; reply: string };
export type BalanceIntent = { intent: "balance"; params: z.infer<typeof BalanceParams>; reply: string };
export type PriceIntent = { intent: "price"; params: z.infer<typeof PriceParams>; reply: string };
export type HistoryIntent = { intent: "history"; params: Record<string, never>; reply: string };
export type LastRecipientIntent = { intent: "last_recipient"; params: Record<string, never>; reply: string };
export type AddressIntent = { intent: "address"; params: { chain: SupportedChain }; reply: string };
export type LendBorrowIntent = { intent: "lend_borrow"; params: z.infer<typeof LendBorrowParams>; reply: string };
export type PositionIntent = { intent: "position"; params: { chain: "ethereum" | "arbitrum" }; reply: string };
export type UnknownIntent = { intent: "unknown"; params: Record<string, never>; reply: string };

export type TypedIntent =
  | TransferIntent
  | SwapIntent
  | BridgeIntent
  | BalanceIntent
  | PriceIntent
  | HistoryIntent
  | LastRecipientIntent
  | AddressIntent
  | LendBorrowIntent
  | PositionIntent
  | UnknownIntent;

// ─── Address validation ───────────────────────────────────────────────────────

function isValidAddress(address: string, chain: SupportedChain): boolean {
  if (chain === "ethereum" || chain === "arbitrum") {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }
  if (chain === "bitcoin") {
    return /^(1|3|bc1)[A-Za-z0-9]{25,62}$/.test(address);
  }
  return true;
}

// ─── classify: turn a raw ParsedIntent into a TypedIntent ────────────────────

export function classify(raw: ParsedIntent): TypedIntent {
  const reply = typeof raw.reply === "string" ? raw.reply : "Something went wrong. Please try again.";

  switch (raw.intent) {
    case "transfer": {
      const parse = TransferParams.safeParse(raw.params);
      if (!parse.success) {
        return { intent: "unknown", params: {}, reply: "I could not read all the transfer details. Please specify the chain, token, amount, and recipient address." };
      }
      if (!isValidAddress(parse.data.to, parse.data.chain)) {
        return { intent: "unknown", params: {}, reply: `That address does not look valid for ${parse.data.chain}. Please double-check it.` };
      }
      return { intent: "transfer", params: parse.data, reply };
    }

    case "swap": {
      const parse = SwapParams.safeParse(raw.params);
      if (!parse.success) {
        return { intent: "unknown", params: {}, reply: "I need the chain, source token, destination token, and amount for a swap." };
      }
      return { intent: "swap", params: parse.data, reply };
    }

    case "bridge": {
      const parse = BridgeParams.safeParse(raw.params);
      if (!parse.success) {
        return { intent: "unknown", params: {}, reply: "I need the source chain, destination chain, token, and amount for a bridge." };
      }
      return { intent: "bridge", params: parse.data, reply };
    }

    case "balance": {
      const parse = BalanceParams.safeParse(raw.params);
      if (!parse.success) {
        return { intent: "balance", params: { chain: "all" }, reply };
      }
      return { intent: "balance", params: parse.data, reply };
    }

    case "price": {
      const parse = PriceParams.safeParse(raw.params);
      if (!parse.success) {
        return { intent: "unknown", params: {}, reply: "Which token's price did you want? Example: 'what is the price of BTC'" };
      }
      return { intent: "price", params: parse.data, reply };
    }

    case "lend_borrow": {
      const parse = LendBorrowParams.safeParse(raw.params);
      if (!parse.success) {
        return { intent: "unknown", params: {}, reply: "I could not read the lending details. Tell me the amount to deposit, like: 'put 200 USDT on Aave and borrow at 50% LTV'." };
      }
      return { intent: "lend_borrow", params: parse.data, reply };
    }

    case "position": {
      const chain = z.enum(["ethereum", "arbitrum"]).safeParse((raw.params as Record<string, unknown>)?.chain);
      return { intent: "position", params: { chain: chain.success ? chain.data : "arbitrum" }, reply };
    }

    case "history":
      return { intent: "history", params: {}, reply };

    case "last_recipient":
      return { intent: "last_recipient", params: {}, reply };

    case "address": {
      const chain = ChainSchema.safeParse((raw.params as Record<string, unknown>)?.chain);
      return {
        intent: "address",
        params: { chain: chain.success ? chain.data : "arbitrum" },
        reply,
      };
    }

    default:
      return {
        intent: "unknown",
        params: {},
        reply: reply || "I did not understand that. Try: 'send 10 USDT to 0x... on Ethereum' or 'what is my balance'.",
      };
  }
}
