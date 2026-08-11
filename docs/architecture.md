# Wally — Architecture

Wally is a production chat interface that lets users send crypto by typing natural language. This document explains how the two core libraries connect and why each design decision was made the way it was.

## The two-library model

Every operation in Wally passes through exactly two libraries:

**QVAC** (`@qvac/sdk`) understands what the user wants. It runs a language model locally on the user's machine, reads the message, and returns a structured JSON object describing the action: what to do, on which chain, with which amount, and to which address.

**WDK** (`@tetherto/wdk-mcp-toolkit`) does what the user wants. It holds the wallet keys, connects to the chains, quotes fees, and executes the transaction. It never interprets language — it only executes typed commands.

Neither library does the other's job. The boundary between them is the JSON intent object produced by QVAC and consumed by the agent loop.

## Why local inference

The QVAC model runs inside the QVAC local server on the user's device. No message text, no address, no amount ever leaves the machine to reach an external AI API. This matters because Wally handles financial operations — sending transaction context to a cloud model is a privacy risk and a potential attack surface.

QVAC communicates with the application over a local socket. The `@qvac/sdk` `completion()` function calls that socket. If the local server is not running, the call fails immediately with a clear error.

## How the request flows

```
Browser tab (WebSocket)
        |
        | JSON event: { type: "message", content: "send 10 USDT to 0x..." }
        v
Fastify server  (src/server.ts)
        |
        | routes through ws.ts → session/manager.ts
        v
Input sanitizer  (src/agent/sanitize.ts)
        | Rejects injection patterns before any LLM call
        v
QVAC completion()  (src/qvac/client.ts)
        | Structured JSON output constrained by JSON schema
        | { intent: "transfer", params: { chain, token, amount, to }, reply }
        v
Intent classifier  (src/agent/intent.ts)
        | Validates types, validates address format per chain
        v
Agent loop  (src/agent/index.ts)
        |
        |-- For balance/price queries: call WDK immediately, stream result back
        |
        |-- For write operations (transfer/swap):
        |     1. Call WDK quoteTransfer() to get the fee
        |     2. Emit confirmation event to browser (a card with amount, fee, recipient)
        |     3. Wait up to 60 seconds for an explicit button click (not text)
        |     4. If confirmed: call WDK transfer(), log to SQLite, return tx hash
        |     5. If cancelled or timeout: do nothing
        v
WDK MCP subprocess  (src/wdk/server.ts + client.ts)
        | Running as a child process over stdio
        | Holds the wallet seed, manages RPC connections, signs transactions
        v
Browser tab  (WebSocket)
        | JSON event: { type: "tx_complete", txHash, chain, explorerUrl }
```

## WDK as an MCP subprocess

WDK runs as a separate child process. Wally spawns it using the `wdk-mcp-toolkit` binary (`bin/index.js serve`) and communicates over stdio using the Model Context Protocol. The reason for a subprocess rather than a direct library import is isolation: if WDK crashes, the main process restarts it without restarting the whole server. It also means the seed phrase is deleted from the subprocess environment immediately after WDK reads it, so it never appears in the main process's memory.

The MCP client in `src/wdk/client.ts` wraps `callTool()` calls into typed functions like `transfer()`, `getBalance()`, and `quoteSwap()`. The rest of the codebase calls those functions and never touches MCP directly.

## Confirmation model

Every operation that writes to the chain requires an explicit UI confirmation — a button click, not a text reply. This is enforced at the protocol level: the browser sends `{ type: "confirm", token: "<uuid>" }` or `{ type: "cancel", token: "<uuid>" }` as a WebSocket event, not as a chat message. The token is a short-lived UUID generated per pending operation and checked server-side before any execution happens. A confirmation with an expired or unknown token is rejected.

Text messages that say "yes" or "confirm" are not confirmations. This design prevents prompt injection attacks where a malicious message payload could trick the model into triggering a transfer.

## Session and history

Each browser tab gets a session ID (UUID) stored in an httpOnly cookie. The session stores the conversation history in SQLite so the QVAC model has context for follow-up questions ("the same address as last time"). Sessions expire after 30 minutes of inactivity.

Completed transactions are written to a separate SQLite table. The agent injects the last five transactions into the QVAC system prompt as plain text so the model can resolve history references without needing RAG.

## Rate limiting

The rate limiter (`src/middleware/rateLimit.ts`) is enforced before the QVAC call:

- 10 messages per minute per session
- 3 transfer attempts per hour per session

Both limits are in-memory and per-session. They reset when a session is reaped.

## Adding a chain

1. Install the wallet package: `npm install @tetherto/wdk-wallet-<chain>`
2. Add the chain name to `WDK_CHAINS` in your `.env.local`
3. The WDK MCP subprocess auto-discovers the installed package at startup
4. Add an entry to `BLOCK_EXPLORERS` in `src/wdk/tools.ts`
5. Update the chain enum in `src/agent/intent.ts` (`SUPPORTED_CHAINS`)
6. Add test cases to `test/agent/intent.test.ts` for address validation on the new chain
