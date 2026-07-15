/**
 * QVAC Client — local AI inference for Wally's intent parsing.
 *
 * What QVAC is: an on-device AI runtime (tetherto/qvac) that runs language
 * models directly on the user's machine. No cloud API, no API key, no data
 * leaving the device. The model loads into the QVAC local server (started
 * separately with `qvac start` or the QVAC desktop app), and the SDK talks
 * to it over a local socket.
 *
 * What this module does: wraps the @qvac/sdk completion() call in a single
 * function that takes a conversation history and returns a structured JSON
 * intent. The JSON schema is enforced via the responseFormat parameter, which
 * tells QVAC's llama.cpp backend to constrain token sampling to valid JSON.
 * This eliminates the need to parse or sanitize LLM output — if it returns,
 * it is valid JSON.
 *
 * Why local inference matters here: Wally handles seed phrases and financial
 * operations. Sending transaction context to a cloud model would be a privacy
 * and security risk. QVAC keeps the inference loop on the same machine that
 * holds the keys.
 */

import { completion, heartbeat, loadModel } from "@qvac/sdk";
import { config } from "../config.js";
import { getLogger } from "../logger.js";
import { buildSystemPrompt, FEW_SHOT_EXAMPLES } from "./prompts.js";
import type { CompletionMessage } from "../types.js";

const log = getLogger("qvac:client");

// The SDK worker starts fresh each process. loadModel must be called before
// completion() — it reads the .gguf file from disk and registers it with the
// worker. QVAC_MODEL_ID is the path to the local model file (or a URL/descriptor).
let resolvedModelId: string | null = null;

async function ensureModelLoaded(): Promise<string> {
  if (resolvedModelId) return resolvedModelId;
  log.info({ src: config.qvacModelId }, "Loading QVAC model");
  resolvedModelId = await loadModel({
    modelSrc: config.qvacModelId,
    modelType: "llamacpp-completion",
  });
  log.info({ modelId: resolvedModelId }, "QVAC model ready");
  return resolvedModelId!;
}

// JSON schema for the structured output QVAC must produce.
const INTENT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["transfer", "swap", "bridge", "balance", "price", "history", "last_recipient", "address", "unknown"],
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

// parseIntent sends the user's message to QVAC and returns a structured intent.
// The conversation history is included so QVAC can resolve references like
// "the same address as last time" using the session context.
export async function parseIntent(
  userMessage: string,
  sessionHistory: CompletionMessage[],
  historyContext: string = ""
): Promise<ParsedIntent> {
  const modelId = await ensureModelLoaded();
  // Try with 4 turns of recent history; fall back to no history on overflow.
  for (const historySlice of [sessionHistory.slice(-4), [] as CompletionMessage[]]) {
    try {
      return await runCompletion(modelId, userMessage, historySlice, historyContext);
    } catch (err: unknown) {
      const isOverflow = err instanceof Error && (err as { name?: string }).name === "CONTEXT_OVERFLOW";
      if (!isOverflow || historySlice.length === 0) throw err;
      log.warn("Context overflow — retrying without session history");
    }
  }
  // Unreachable, but TypeScript needs a return.
  throw new Error("parseIntent: all retry paths exhausted");
}

async function runCompletion(
  modelId: string,
  userMessage: string,
  sessionHistory: CompletionMessage[],
  historyContext: string
): Promise<ParsedIntent> {
  const start = Date.now();

  const history: CompletionMessage[] = [
    { role: "system", content: buildSystemPrompt(config.networkMode) + (historyContext ? "\n\n" + historyContext : "") },
    ...FEW_SHOT_EXAMPLES,
    ...sessionHistory,
    { role: "user", content: userMessage },
  ];

  const run = completion({
    modelId,
    history,
    stream: false,
    captureThinking: false,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "wallet_intent",
        schema: INTENT_SCHEMA,
        strict: true,
      },
    },
  });

  const final = await run.final;
  const text = final.contentText ?? "";
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

// checkHealth pings the QVAC local server.
export async function checkQvacHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    await heartbeat();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
