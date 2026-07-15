---
id: on-device-signing
title: On-device signing
sidebar_label: On-device signing
---

# On-device signing

## What a signature is

Your seed phrase generates a private key. Think of the private key as a pen only you own, with an unforgeable handwriting. When you send money, your wallet writes a note — "move 10 USDT from my address to that address" — and signs it with that pen. The network's math can check the handwriting matches your address without ever seeing the pen. That is the trick that makes crypto work: anyone can **verify** the signature, nobody can **reproduce** it.

## What "signed on device" means

The pen never leaves your laptop. The note is written and signed in your machine's memory, and only the finished, signed note goes to the network. Nothing that leaves your machine can be used to sign anything else. Altering a single character of a signed transaction breaks the signature, so what travels is tamper-proof and single-purpose.

**The network only ever sees the sealed envelope, never the pen that sealed it.**

## Why it matters: three arguments

### 1. There is no vault worth robbing

The alternative design is a company holding keys for a million users on their servers. That is a pile of pens in one drawer — the most attractive target on the internet, and the reason exchanges get breached. On-device signing means every attacker's prize is one laptop with one key. The economics of stealing change completely.

### 2. Nobody can say no

If a server signs for you, that server can also *not* sign for you — freeze your account, block a recipient, go bankrupt with your keys inside. When signing happens on your device, there is no third party between your decision and the network. Your transaction does not need anyone's permission.

### 3. The guarantee is math, not a promise

A custodian's security is a policy: "we promise to protect your funds." On-device signing's security is arithmetic: producing your signature without your key is not forbidden, it is **computationally impossible**. Policies get violated. Math does not.

## The Wally twist: intent stays local too

Most self-custodial wallets still leak your *intent* — you tap buttons in an app that phones home, or type into an interface backed by a cloud model. In Wally, the AI that reads "send 10 USDT to my landlord" is also local. Both halves of the sensitive part — what you want to do, and the authority to do it — never leave the machine.

The same applies to your history: every conversation is stored in a local SQLite file on your disk. The chat sidebar, balances, recipients, habits — none of it is telemetry, none of it syncs anywhere.

## Where the seed actually lives

Concretely, in Wally the seed is read once by the WDK subprocess at boot and then deleted from the environment. The layer the agent talks to has no operation that returns key material:

```typescript title="src/wdk/client.ts (module header)"
/**
 * Seed security: the seed phrase is read once by the subprocess (via
 * WDK_SEED / WDK_SEED_COMMAND / WDK_SEED_FILE), then deleted from the
 * subprocess environment. It is never passed through this client layer.
 */
```

```typescript title="src/wdk/server.ts — only the subprocess env carries it"
private buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of [
    "PATH", "HOME", "NODE_PATH",
    "WDK_SEED", "WDK_SEED_COMMAND", "WDK_SEED_FILE",
    "WDK_INDEXER_API_KEY",
    "WDK_CONFIG",
  ]) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  // ...
}
```

## And the human gate on top

On-device signing removes the third party. The confirmation gate removes blind automation. Every spend shows amount, recipient, chain, and fee, and waits up to 60 seconds for a human decision. See [the transaction lifecycle](/transaction-lifecycle#6-confirm--the-gate-that-never-moves) for the code.

> The agent proposes. It cannot spend.
