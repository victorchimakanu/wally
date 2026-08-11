---
id: architecture
title: How QVAC and WDK connect
sidebar_label: How QVAC and WDK connect
---

# How QVAC and WDK connect

The most important fact about Wally's architecture: **the AI and the keys never touch.** They live in separate processes, speak through a typed agent in the middle, and the seed phrase is unreachable from anything the model can influence.

```text
 you ──▶ browser ──▶ WebSocket ──▶ agent ──▶ QVAC CLI server (HTTP, loopback)
                                     │            └── owns the model, calls @qvac/sdk
                                     └─────▶ WDK  (separate subprocess, MCP)
                                                 └── seed, keys, signing
```

## QVAC: the local brain

Wally sends OpenAI-compatible HTTP requests to the QVAC CLI server, started with `qvac serve openai`. That server belongs to `@qvac/cli`; it owns the model lifecycle (loading the quantized Qwen3 4B from disk) and translates each HTTP request into `@qvac/sdk` calls. Wally itself never loads a model in-process.

**The privacy boundary, stated precisely: inference is on-device only when `QVAC_SERVER_URL` is loopback.** That is the default, and Wally refuses to start against a non-loopback server unless the URL is `https` and `QVAC_API_KEY` is set — pointing at a remote server means chat context leaves the machine, and that must be an explicit operator decision. This is the actual client code:

```typescript title="src/qvac/client.ts"
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
    reasoning_budget: false,   // constrained extraction, not an essay
    response_format: {
      type: "json_schema",
      json_schema: { name: "wallet_intent", schema: INTENT_SCHEMA, strict: true },
    },
  }),
  signal: AbortSignal.timeout(config.qvacTimeoutMs),
});
```

The model never speaks freely. The `response_format` above constrains generation to a JSON schema **at the sampling level**: the model is physically unable to produce anything except a valid, structured intent. Between a human sentence and a financial action, you do not want creative writing. You want a form, filled in.

## WDK: the local vault

Wallet operations run in a **separate child process**: the WDK MCP Toolkit, spoken to over MCP (the Model Context Protocol) via stdio. Wally boots it like this:

```typescript title="src/wdk/server.ts"
this.transport = new StdioClientTransport({
  command: process.execPath,
  args: [TOOLKIT_BIN, "serve"],   // @tetherto/wdk-mcp-toolkit
  env: this.buildEnv(),           // seed goes ONLY into this env
});

const client = new Client({ name: "wally", version: "1.0.0" });
await client.connect(this.transport);
```

The seed phrase is passed once into that subprocess environment and the toolkit deletes it from the environment after reading it. The client layer that the agent uses exposes wallet *operations*, never key material:

```typescript title="src/wdk/client.ts"
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await getClient().callTool({ name, arguments: args });
  // MCP tools signal failure in-band; surface it as a real exception so
  // callers never mistake an error string for a payload.
  if (result.isError) {
    throw new Error(extractText(result.content));
  }
  return result.content;
}

export async function transfer(
  chain: string, token: string, amount: string, to: string
): Promise<string> {
  const result = await callTool("transfer", { chain, token, amount, to });
  return extractText(result);
}
```

## The agent: the only bridge

The agent is the one component that talks to both sides, and it treats both as untrusted. Model output is re-validated with strict types before anything executes, and long identifiers are never trusted to the model at all:

```typescript title="src/agent/index.ts — the model never copies addresses"
const parsed = await parseIntent(userText, history, historyCtx);

// Never trust the model to copy a long address. If the user's own text
// contains one, it is the ground truth for the recipient.
if (parsed.intent === "transfer") {
  const evmAddr = userText.match(/0x[0-9a-fA-F]{40}\b/);
  if (evmAddr) (parsed.params as Record<string, unknown>)["to"] = evmAddr[0];
}

const intent = classify(parsed);   // zod schemas + address format checks
```

```typescript title="src/agent/intent.ts — strict re-validation"
const TransferParams = z.object({
  chain: ChainSchema,                                  // enum: ethereum | arbitrum | bitcoin
  token: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  to: z.string().min(10),
});

function isValidAddress(address: string, chain: SupportedChain): boolean {
  if (chain === "ethereum" || chain === "arbitrum") {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }
  if (chain === "bitcoin") {
    return /^(1|3|bc1)[A-Za-z0-9]{25,62}$/.test(address);
  }
  return true;
}
```

## Why this separation earns trust

- A prompt injection that somehow survived screening could, at worst, produce a *proposal* — which still faces schema validation, address checks, rate limits, and the human confirmation gate.
- A bug in the AI layer cannot read the seed: it lives in a different OS process, behind an interface that has no "export key" operation.
- A bug in the wallet layer cannot be triggered creatively: it only receives typed, validated tool calls.

Next: follow one sentence all the way to the chain in [A transaction, end to end](/transaction-lifecycle).
