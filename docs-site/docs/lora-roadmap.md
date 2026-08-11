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
The training API above is confirmed against `@qvac/sdk` 0.13.5. Two constraints to respect before building the in-app loop. First, **not every quantization is fine-tunable**: QVAC's requirements currently list F32, F16, Q4_0, Q8_0, TQ1_0 and TQ2_0 as supported, and the Q4_K_M file Wally serves for inference is not on that list — the training loop must select a verified fine-tunable model (check with `getModelInfo()`), then use the resulting adapter with a compatible base. Second, the adapter *loading* path at inference time still needs confirming against the latest SDK.
:::

## The insight that makes Wally special for this

Every wallet action in Wally already ends with a human pressing CONFIRM on a card that shows exactly what the model understood. That button is not just a safety gate. **It is a labeling machine.**

```text
"wire 50 to dave for the studio"  ──▶  { transfer, arbitrum, USDT, 50, 0x4f2a... }   ✓ CONFIRMED
```

Every confirmed transaction is a human-verified training pair, and every correction is a negative label — in principle. Honest status: today's database stores chat history and completed transfer fields, not the parsed intent, the correction, or an accept/reject label. Building the corpus means adding an explicit, reviewed training log at the confirmation gate: user text in, parsed intent out, confirmed or corrected. The safety flow makes that log cheap to produce, but it must be built and reviewed — it does not exist as a byproduct yet.

## The adapters

**What an adapter can improve: understanding.** A 4B model made excellent at one narrow task — parsing wallet commands. Fine-tuning on wallet phrasings (synthetic plus an explicit, reviewed log of confirmed history) fixes the typo-and-odd-phrasing failures small models make, and can learn *your* habitual phrasings and recurring patterns. Small model plus narrow adapter is the whole on-device thesis: you do not need a frontier model to be excellent at a domain.

**What an adapter can never do: gain authority or capability.** An adapter is weights, not code. It cannot add chains, tokens, or operations — those are WDK modules, handlers and validation enums that ship as software. And it is never the source of a recipient: "dave" resolving to an address is an address-book feature with deterministic, user-verified entries, because Wally's safety rule is that the model does not choose addresses, learned or not. LoRA here is an intent-classification improvement. Nothing else.

## What transactions start to feel like

- **Fewer misparses.** Typos, shorthand and your personal phrasing parse correctly on the first try, and the confirmation card is where you verify it understood.
- **Smart anomaly questions.** "You usually send 50 here. This says 500. Is that right?" A stock model cannot ask that; a model that learned your patterns can, from local history. The recipient itself still comes from your text or your verified address book — never from the model's memory.
- **Proactive but private.** "It is the 1st. You have sent rent on the 1st for four months. Want the confirmation card?" Creepy when a cloud does it. Genuinely useful when your own laptop does — and the card it offers is still built from deterministic history, not model recall.

## The loop (all local)

1. **Corpus:** an explicit, reviewed training log written at the confirmation gate (user text + parsed intent + confirmed/corrected) — to be added; today's database does not store this.
2. **Train:** `finetune()` produces an adapter file next to `wally.db`. Same privacy story: yours, local, deletable.
3. **Evaluate before adopting:** replay held-out past commands through base+adapter; adopt only if parse accuracy improves. Never ship a regression to yourself.
4. **Reset button:** delete the adapter, get the stock model back. Personalization you can uninstall is personalization you can trust.

## The safety line never moves

The adapter only ever improves *understanding*. It gets no new authority. Every action still passes schema-constrained output, strict validation, the address taken from your literal text, rate limits, and the human confirmation gate.

> A smarter Wally proposes better. It still cannot spend.

## Why this story matters

Cloud personalization means your financial behavior becomes training data on someone's server. On-device LoRA inverts it: the model comes to the data.

Your keys, your coins. Your model, your instructions. **Your history, your teacher.**
