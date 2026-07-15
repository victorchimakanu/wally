# Quickstart

Get Wally running in five steps.

## Prerequisites

- Node.js 22 or later
- QVAC desktop app or QVAC CLI running locally with `qwen3-4b-instruct` downloaded
- A BIP-39 seed phrase for a test wallet (12 or 24 words)

If you do not have a seed phrase yet, generate one:

```
node -e "const {generateMnemonic}=require('bip39');console.log(generateMnemonic())"
```

## Step 1 — Clone and install

```bash
cd TetherBrain/POCs/wally
npm install
```

The install pulls `@tetherto/wdk-mcp-toolkit` from GitHub and the wallet packages from npm. It takes about 30 seconds the first time.

## Step 2 — Configure

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in at minimum one seed source:

```
# Development — paste your 12/24-word seed phrase here
WDK_SEED=word1 word2 word3 ... word12
```

For production use `WDK_SEED_COMMAND` instead (for example, a 1Password CLI read).

Leave everything else at its default for local development.

## Step 3 — Start QVAC

Open the QVAC desktop app and confirm the local server is running. You should see a green status indicator. If you prefer the CLI:

```bash
qvac start
qvac models download qwen3-4b-instruct
```

## Step 4 — Run Wally

Verify the agent loop works in the terminal before starting the web server:

```bash
npm run cli
```

Type `what is my ethereum balance` and press Enter. You should see a balance response within a few seconds. If QVAC or WDK is not reachable, you will see a clear error explaining which component failed.

When the CLI works, start the web server:

```bash
npm run dev
```

## Step 5 — Send your first USDT

Open `http://localhost:3000` in a browser.

Try:

```
what is my balance
```

Then, once you see your balances:

```
send 0.01 USDT to 0xYourTestAddress on Ethereum
```

Wally will quote the fee and show a confirmation dialog. Click Confirm. The transaction hash appears in the chat with a link to the block explorer.

## Troubleshooting

**QVAC not reachable**: Make sure the QVAC app is open and the local server is running. Check `GET /health` — the `qvac` field should be `"ok"`.

**WDK not starting**: Check that `WDK_SEED` (or `WDK_SEED_COMMAND` / `WDK_SEED_FILE`) is set in `.env.local`. The server will print the error on startup.

**Insufficient balance**: The confirmation dialog will show the shortfall. Use testnet tokens or switch `NETWORK_MODE=testnet`.

**Type errors**: Run `npm run typecheck` to see any TypeScript issues without building.
