/**
 * WDK MCP Client — the bridge between Wally's agent loop and the WDK wallet.
 *
 * Architecture: WDK runs as a separate child process (src/wdk/server.ts)
 * exposing wallet operations as MCP tools over stdio. This module wraps the
 * MCP Client in typed functions so the rest of the code never touches raw
 * JSON payloads or the protocol directly.
 *
 * Why MCP? The WDK MCP Toolkit (tetherto/wdk-mcp-toolkit) is the official
 * way to drive WDK from an AI agent. It handles key derivation, account
 * management, RPC connections, and on-chain signing — none of which belong
 * in Wally's application code.
 *
 * Seed security: the seed phrase is read once by the subprocess (via
 * WDK_SEED / WDK_SEED_COMMAND / WDK_SEED_FILE), then deleted from the
 * subprocess environment. It is never passed through this client layer.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { wdkSubprocess } from "./server.js";
import { getLogger } from "../logger.js";

const log = getLogger("wdk:client");

function getClient(): Client {
  const client = wdkSubprocess.client;
  if (!client) throw new Error("WDK MCP client is not connected");
  return client;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const start = Date.now();
  try {
    const result = await getClient().callTool({ name, arguments: args });
    // MCP tools signal failure in-band: the result carries isError plus an
    // error message in the content. Surface that as a real exception so
    // callers never mistake an error string for a payload.
    if (result.isError) {
      throw new Error(extractText(result.content));
    }
    log.info({ tool: name, duration_ms: Date.now() - start }, "WDK tool call succeeded");
    return result.content;
  } catch (err) {
    log.error({ tool: name, err }, "WDK tool call failed");
    throw err;
  }
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export async function getAddress(chain: string): Promise<string> {
  const result = await callTool("getAddress", { chain });
  return extractText(result);
}

export interface BalanceResult {
  native: string;
  tokens: Array<{ symbol: string; amount: string }>;
  raw: string;
}

export async function getBalance(chain: string): Promise<string> {
  const result = await callTool("getBalance", { chain });
  return extractText(result);
}

export async function getTokenBalance(chain: string, token: string): Promise<string> {
  const result = await callTool("getTokenBalance", { chain, token });
  return extractText(result);
}

export interface TransferQuote {
  fee: string;
  raw: string;
}

export async function quoteTransfer(
  chain: string,
  token: string,
  amount: string,
  to: string
): Promise<string> {
  const result = await callTool("quoteTransfer", { chain, token, amount, to });
  return extractText(result);
}

export async function transfer(
  chain: string,
  token: string,
  amount: string,
  to: string
): Promise<string> {
  const result = await callTool("transfer", { chain, token, amount, to });
  return extractText(result);
}

export async function quoteSendTransaction(
  chain: string,
  to: string,
  value: string,
  data?: string
): Promise<string> {
  const result = await callTool("quoteSendTransaction", { chain, to, value, ...(data ? { data } : {}) });
  return extractText(result);
}

export async function sendTransaction(
  chain: string,
  to: string,
  value: string,
  data?: string
): Promise<string> {
  const result = await callTool("sendTransaction", { chain, to, value, ...(data ? { data } : {}) });
  return extractText(result);
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export async function getPrice(token: string): Promise<string> {
  const result = await callTool("getPrice", { token });
  return extractText(result);
}

// ─── Swap ─────────────────────────────────────────────────────────────────────

export async function quoteSwap(
  chain: string,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<string> {
  const result = await callTool("quoteSwap", { chain, fromToken, toToken, amount });
  return extractText(result);
}

export async function swap(
  chain: string,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<string> {
  const result = await callTool("swap", { chain, fromToken, toToken, amount });
  return extractText(result);
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

export async function quoteBridge(
  fromChain: string,
  toChain: string,
  token: string,
  amount: string
): Promise<string> {
  const result = await callTool("quoteBridge", { fromChain, toChain, token, amount });
  return extractText(result);
}

export async function bridge(
  fromChain: string,
  toChain: string,
  token: string,
  amount: string,
  to: string
): Promise<string> {
  const result = await callTool("bridge", { fromChain, toChain, token, amount, to });
  return extractText(result);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // MCP content blocks: [{type:"text",text:"..."}]
    const texts = (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    return texts;
  }
  return JSON.stringify(content);
}

export async function listAvailableTools(): Promise<string[]> {
  const result = await getClient().listTools();
  return result.tools.map((t) => t.name);
}
