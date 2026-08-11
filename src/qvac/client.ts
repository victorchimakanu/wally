/**
 * QVAC Client — intent parsing over the QVAC CLI HTTP server.
 *
 * Architecture, stated precisely: Wally sends OpenAI-compatible requests to
 * the server started by `qvac serve openai` (default port 11434). That server
 * belongs to @qvac/cli; it owns the model lifecycle and translates HTTP into
 * @qvac/sdk calls. Wally itself never loads a model in-process.
 *
 * Privacy boundary: inference is on-device only when QVAC_SERVER_URL is
 * loopback (the default, and config.ts refuses to start otherwise unless the
 * URL is https with QVAC_API_KEY set). Pointing at a remote server means chat
 * context leaves this machine — that is an explicit operator decision, never
 * a silent one.
 *
 * Start the server from the repo root:
 *   qvac serve openai -c qvac.config.json
 * The config preloads the model and sets ctx_size (see qvac.config.json).
 *
 * Structured output: the request carries a response_format json_schema, which
 * constrains token sampling to valid JSON server-side. If a response returns,
 * it parses.
 */

import { config } from "../config.js";
import { getLogger } from "../logger.js";
import { buildSystemPrompt, FEW_SHOT_EXAMPLES } from "./prompts.js";
import type { CompletionMessage } from "../types.js";

const log = getLogger("qvac:client");

// JSON schema for the structured output QVAC must produce.
const INTENT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["transfer", "swap", "bridge", "balance", "price", "history", "last_recipient", "address", "lend_borrow", "position", "unknown"],
    },
    params: { type: "object" },
    reply: { type: "string" },
  },
  required: ["intent", "params", "reply"],
  additionalProperties: false,
};

export interface ParsedIntent {
  intent: string;
  params: Record<string, unknown>;
  reply: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string; code?: string };
}

// Truncation is retryable (shorter history), unlike malformed output.
export class QvacTruncationError extends Error {
  constructor() {
    super("QVAC generation hit the token limit before completing (finish_reason: length)");
    this.name = "QvacTruncationError";
  }
}

// parseIntent sends the user's message to the QVAC server and returns a
// structured intent. The conversation history is included so the model can
// resolve references like "the same address as last time".
export async function parseIntent(
  userMessage: string,
  sessionHistory: CompletionMessage[],
  historyContext: string = ""
): Promise<ParsedIntent> {
  // Try with 4 turns of recent history; fall back to no history on failure so
  // one oversized session cannot brick intent parsing.
  for (const historySlice of [sessionHistory.slice(-4), [] as CompletionMessage[]]) {
    try {
      return await runCompletion(userMessage, historySlice, historyContext);
    } catch (err: unknown) {
      if (historySlice.length === 0) throw err;
      log.warn({ err }, "QVAC completion failed — retrying without session history");
    }
  }
  // Unreachable, but TypeScript needs a return.
  throw new Error("parseIntent: all retry paths exhausted");
}

async function runCompletion(
  userMessage: string,
  sessionHistory: CompletionMessage[],
  historyContext: string
): Promise<ParsedIntent> {
  const start = Date.now();

  const messages: CompletionMessage[] = [
    { role: "system", content: buildSystemPrompt(config.networkMode) + (historyContext ? "\n\n" + historyContext : "") },
    ...FEW_SHOT_EXAMPLES,
    ...sessionHistory,
    { role: "user", content: userMessage },
  ];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.qvacApiKey) headers["Authorization"] = `Bearer ${config.qvacApiKey}`;

  const res = await fetch(`${config.qvacServerUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.qvacModel,
      messages,
      stream: false,
      max_tokens: 512,
      // Intent parsing is a constrained extraction task; hybrid-thinking
      // models can burn the whole token budget on reasoning and return empty
      // content with finish_reason "length", so reasoning stays off.
      reasoning_budget: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wallet_intent",
          schema: INTENT_SCHEMA,
          strict: true,
        },
      },
    }),
    signal: AbortSignal.timeout(config.qvacTimeoutMs),
  });

  const body = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) {
    throw new Error(`QVAC server error ${res.status}: ${body.error?.message ?? "unknown"} (${body.error?.code ?? "no code"})`);
  }

  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") {
    // Distinct, retryable: the caller retries with less history rather than
    // treating an empty or cut-off body as malformed JSON.
    throw new QvacTruncationError();
  }
  const text = choice?.message?.content ?? "";
  log.info({ duration_ms: Date.now() - start }, "QVAC completion");

  try {
    const parsed = JSON.parse(text) as ParsedIntent;
    if (!parsed.intent || !parsed.params || !parsed.reply) {
      throw new Error("Missing required fields");
    }
    return parsed;
  } catch (err) {
    log.warn({ text, err }, "QVAC output was not valid JSON — falling back to unknown");
    return {
      intent: "unknown",
      params: {},
      reply: "I did not understand that. Try: 'send 10 USDT to 0x... on Ethereum' or 'what is my balance'.",
    };
  }
}

// checkQvacHealth pings the QVAC server and verifies the model is loaded.
export async function checkQvacHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (config.qvacApiKey) headers["Authorization"] = `Bearer ${config.qvacApiKey}`;
    const res = await fetch(`${config.qvacServerUrl}/v1/models/${encodeURIComponent(config.qvacModel)}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, error: `QVAC server responded ${res.status} for model "${config.qvacModel}" — is qvac serve running with the right config?` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot reach QVAC server at ${config.qvacServerUrl}: ${message}` };
  }
}
