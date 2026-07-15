---
id: run-wally
title: Run Wally yourself
sidebar_label: Run Wally
---

# Run Wally yourself

Wally is a sample app. It exists so you can read it, run it, and copy the pattern into your own project. The whole codebase is readable in an evening.

## Prerequisites

- **Node.js 22+**
- **QVAC** installed on your machine, with a downloaded model. Wally is tested with Qwen3 4B (quantized, ~2.5 GB). Get QVAC at [qvac.tether.io](https://qvac.tether.io).
- **A seed phrase** for a test wallet. Generate a fresh one; never reuse a seed that holds real funds.

## Setup

```bash
git clone <the-wally-repo>
cd wally
npm install
cp .env.example .env.local
```

Edit `.env.local`:

```bash title=".env.local"
# Path to your local model file
QVAC_MODEL_ID=/Users/you/.qvac/models/Qwen3-4B-Q4_K_M.gguf

# Your test seed phrase (dev only — use WDK_SEED_COMMAND in production)
WDK_SEED=your twelve word test seed phrase goes here ...

# Start on testnet
NETWORK_MODE=testnet

SESSION_SECRET=change-me
```

## Run

```bash
npm run dev        # or: npm run dev:watch (auto-restart on code changes)
```

Open [http://localhost:3000](http://localhost:3000). The first message takes a few extra seconds while the model loads into memory.

## Try these

```text
what is my balance
what is my arbitrum address
send 1 USDT to 0x... on arbitrum
```

Click any balance card to reveal and copy that chain's address. Chats are saved on your device (local SQLite) and appear in the left sidebar.

## Optional: gasless USDT on Arbitrum

To pay fees in USDT with no ETH anywhere, follow [Gasless USDT](/gasless) — it is one JSON file and two environment lines.

## Every fork is its own wallet

The repo contains code, not keys. Your wallet is derived entirely from the seed in your local `.env.local`, which is gitignored. Fork the repo, write your own seed, and you have addresses no one else can derive. There is no shared "example wallet" to accidentally drain.

## Where things live

```text
src/qvac/       local inference: model loading, schema-constrained parsing
src/wdk/        the wallet subprocess: MCP client, tools, on-chain verification
src/agent/      the bridge: sanitize → parse → validate → confirm → execute → verify
src/session/    chat sessions, SQLite persistence
public/         the UI (plain HTML/CSS/JS, no build step)
docs-site/      this documentation
```
