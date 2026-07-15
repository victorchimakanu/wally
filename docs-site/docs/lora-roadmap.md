---
id: lora-roadmap
title: "The LoRA roadmap: a wallet that learns you"
sidebar_label: The LoRA roadmap
---

# The LoRA roadmap

Wally today understands wallet commands. Wally tomorrow understands **your** wallet commands — because QVAC can fine-tune the model on your device, from your history, without a byte of it leaving your machine.

## LoRA in one paragraph

Fine-tuning normally means retraining a model, which takes datacenter hardware. LoRA (Low-Rank Adaptation) freezes the base model and trains only a small adapter — a few megabytes of extra weights on top. Training an adapter is cheap enough for consumer hardware, and adapters load and unload like cartridges. For Wally that means one thing: **the wallet's brain can learn without the wallet's data ever leaving the machine.**

## This is a real QVAC API

The same `@qvac/sdk` that powers Wally's inference ships `finetune()`, with explicit LoRA controls. This example is from the SDK's own documentation:

```typescript title="@qvac/sdk — finetune()"
const handle = finetune({
  modelId,
  options: {
    trainDatasetDir: "./dataset/train",
    validation: { type: "split", fraction: 0.05 },
    outputParametersDir: "./artifacts/lora",   // the adapter comes out here
    numberOfEpochs: 2,
    // loraRank, loraAlpha, loraModules, learningRate, batchSize ... all available
  },
});

for await (const progress of handle.progressStream) {
  console.log(progress.global_steps, progress.loss);
}

console.log(await handle.result);
```

Jobs can be paused, resumed, and cancelled; progress streams live. Everything runs on the device.

:::info Verification status
The training API above is confirmed against `@qvac/sdk` 0.13.5 (the version Wally runs). The adapter *loading* path at inference time is the piece to confirm against the latest SDK before building the in-app loop.
:::

## The insight that makes Wally special for this

Every wallet action in Wally already ends with a human pressing CONFIRM on a card that shows exactly what the model understood. That button is not just a safety gate. **It is a labeling machine.**

```text
"wire 50 to dave for the studio"  ──▶  { transfer, arbitrum, USDT, 50, 0x4f2a... }   ✓ CONFIRMED
```

Every confirmed transaction is a human-verified training pair. Every correction is a negative label. Most products pay annotation teams for this data; Wally's core safety flow produces it as a byproduct, on-device, with perfect ground truth. And the chat sessions feature already stores all of it in local SQLite. **The training corpus builds itself while you use your wallet.**

## The adapters

**1. The personal dialect adapter.** Learns how *you* talk about money: names ("dave", "my landlord") resolving to addresses you have confirmed before, habitual phrasings, recurring amounts, the chains you actually use. "Pay dave his 50" parses correctly on the first try, and the confirmation card is where you check it understood. The model develops a picture of you — and that picture is a file on your disk.

**2. The intent-accuracy adapter.** A 4B model made excellent at one narrow task. Fine-tuning on wallet commands (synthetic plus your own confirmed history) fixes the typo-and-odd-phrasing failures small models make. Small model plus narrow adapter is the whole on-device thesis: you do not need a frontier model to be excellent at a domain.

**3. The product adapter.** New chains, new tokens, new operations taught by shipping a 10 MB adapter instead of a 4 GB model.

## What transactions start to feel like

- **First-name finance.** "send rent" just works — amount, recipient, chain, learned from you.
- **Smart anomaly questions.** "You usually send Dave 50. This says 500. Is that right?" A stock model cannot ask that; a model that learned your patterns can, from local history.
- **Proactive but private.** "It is the 1st. You have sent rent on the 1st for four months. Want the confirmation card?" Creepy when a cloud does it. Genuinely useful when your own laptop does.

## The loop (all local)

1. **Corpus:** confirmed intent pairs from SQLite (user text + parsed intent + confirmed/corrected).
2. **Train:** `finetune()` produces an adapter file next to `wally.db`. Same privacy story: yours, local, deletable.
3. **Evaluate before adopting:** replay held-out past commands through base+adapter; adopt only if parse accuracy improves. Never ship a regression to yourself.
4. **Reset button:** delete the adapter, get the stock model back. Personalization you can uninstall is personalization you can trust.

## The safety line never moves

The adapter only ever improves *understanding*. It gets no new authority. Every action still passes schema-constrained output, strict validation, the address taken from your literal text, rate limits, and the human confirmation gate.

> A smarter Wally proposes better. It still cannot spend.

## Why this story matters

Cloud personalization means your financial behavior becomes training data on someone's server. On-device LoRA inverts it: the model comes to the data.

Your keys, your coins. Your model, your instructions. **Your history, your teacher.**
