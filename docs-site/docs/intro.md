---
id: intro
title: Agentic finance, on device
sidebar_label: What Wally is
slug: /
---

# Agentic finance, on device

Wally is a self-custodial crypto wallet you talk to. You type plain English. It understands, quotes the cost, asks you to confirm, and executes on-chain.

```text
you:    send 10 USDT to 0x4f2a...9c1e on arbitrum
wally:  Sending 10 USDT to 0x4f2a...9c1e on Arbitrum. I will show the fee
        and ask you to confirm.
        [ CONFIRM TRANSACTION — amount, recipient, chain, fee, 60s ]
```

Two things make it different from every other wallet, and both are about where things run:

1. **The AI runs on your device.** Wally's language understanding is powered by [QVAC](https://qvac.tether.io), Tether's local AI runtime. The model lives on your machine. No cloud API, no API key, no message ever leaves the device to be understood.
2. **The keys never leave your device either.** Wallet operations run through [WDK](https://wdk.tether.io), Tether's Wallet Development Kit. One seed phrase derives your addresses; transactions are signed locally; only the finished signature touches the network.

Put together, this is **agentic finance**: an AI agent that can genuinely move money, running entirely on hardware you own.

## The one design rule

Every architectural decision in Wally follows from a single sentence:

> **The agent proposes. It cannot spend.**

The model can read your words and suggest a transaction. Between that suggestion and any money moving there is always a strict validation layer and a human pressing CONFIRM inside a 60-second window. A smarter model gets you better proposals. It never gets more authority.

## What Wally demonstrates

| Capability | Where to read about it |
|---|---|
| Local model parses intent, constrained to a JSON schema | [How QVAC and WDK connect](/architecture) |
| A sentence becoming an on-chain transaction, step by step | [A transaction, end to end](/transaction-lifecycle) |
| Why local signing changes the security model | [On-device signing](/on-device-signing) |
| Sending USDT and paying gas in USDT, no ETH ever | [Gasless USDT](/gasless) |
| Where this goes: a wallet that learns you, locally | [The LoRA roadmap](/lora-roadmap) |
| Running it yourself | [Run Wally](/run-wally) |

## Status

Wally is a **reference app**. It exists so you can read it, run it, and copy the pattern. It is small enough to read in an evening, and that is deliberate.
