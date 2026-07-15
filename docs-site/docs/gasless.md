---
id: gasless
title: "Gasless USDT: pay fees in the token you hold"
sidebar_label: Gasless USDT
---

# Gasless USDT

One of the worst UX problems in crypto: you hold USDT, you want to send USDT, and you cannot — because the network fee must be paid in ETH, a second asset you now have to go buy first.

Wally's Arbitrum wallet removes that problem completely. **You receive USDT, you send USDT, and the fee comes out in USDT. The wallet has never held ETH.**

## How it works: ERC-4337

WDK ships `@tetherto/wdk-wallet-evm-erc-4337`, built on Safe's relay kit. Instead of a classic account signing raw transactions, you get a **smart account** (a small contract wallet) that signs **user operations**:

- A **bundler** (an external service) wraps user operations into real transactions and pays the ETH gas itself.
- A **paymaster** reimburses the bundler and charges your smart account **in USDT**.
- Your key still signs everything, still on your device. The smart account changes who *fronts* the gas, not who *controls* the money.

```text
 classic account:  you ──sign──▶ raw tx ──▶ network      (you pay ETH)
 smart account:    you ──sign──▶ user op ──▶ bundler ──▶ network
                                              ▲ paid in ETH by bundler
                                              └ reimbursed in USDT by paymaster,
                                                charged to your smart account
```

## The whole feature is one JSON file

The WDK MCP Toolkit accepts per-chain wallet module overrides via a config file. This is Wally's actual (redacted) configuration:

```json title="wdk.config.json"
{
  "chains": {
    "arbitrum": {
      "module": "@tetherto/wdk-wallet-evm-erc-4337",
      "config": {
        "chainId": 42161,
        "provider": "https://arbitrum-one-rpc.publicnode.com",
        "bundlerUrl": "https://api.pimlico.io/v2/42161/rpc?apikey=YOUR_KEY",
        "paymasterUrl": "https://api.pimlico.io/v2/42161/rpc?apikey=YOUR_KEY",
        "paymasterAddress": "0x777777777777AeC03fd955926DbF81597e66834C",
        "paymasterToken": {
          "address": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"
        },
        "entryPointAddress": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
        "safeModulesVersion": "0.3.0"
      }
    }
  }
}
```

Plus two lines of environment:

```bash title=".env.local"
WDK_CONFIG=./wdk.config.json
WALLY_GASLESS_CHAINS=arbitrum
```

`paymasterToken.address` is USDT on Arbitrum One. The `entryPointAddress` is the standard ERC-4337 v0.7 EntryPoint. The bundler/paymaster URL comes from a provider (Pimlico shown; free tier available).

## What changes in the app

Wally's agent knows which chains are gasless and adapts three behaviors:

```typescript title="src/agent/index.ts"
const isGasless = config.gaslessChains.includes(params.chain);

// 1. The ETH gas preflight is skipped — the token itself pays the fee.

// 2. Verification: 4337 returns a user-operation hash, which
//    eth_getTransactionByHash cannot see, so RPC verification is skipped.
const seenOnChain = isGasless || (await tools.verifyTxOnChain(params.chain, txHash));

// 3. The success message is honest about what the hash is:
const msg = isGasless
  ? `Sent. ${params.amount} ${params.token} is on its way on ${params.chain}, ` +
    `gas paid in ${params.token}.\nUser operation: ${txHash.slice(0, 10)}...`
  : /* classic path with an explorer link */;
```

## Things to know

- **New address.** The smart account is a contract with its own address, different from the classic account derived from the same seed. Fund it directly with USDT.
- **First send deploys the account.** The first user operation also deploys the Safe contract on-chain, so the first fee is slightly higher than later ones — still paid in USDT.
- **User operations have no Etherscan page.** Proof of settlement is the balance updating, which Wally refreshes automatically after a send.

Full setup guide with rollback instructions: `GASLESS.md` in the repo.
