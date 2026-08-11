# Wally + QVAC LoRA fine-tuning — design outline

Status: design outline, not implementation. QVAC ships a fine-tuning surface (confirmed in the
July 2026 stack scan); the exact API shapes below must be verified against the current QVAC SDK
before building. The product thinking stands regardless.

## What LoRA is, in one paragraph

Fine-tuning normally means retraining a model, which takes datacenter hardware. LoRA (Low-Rank
Adaptation) freezes the base model and trains only a small adapter, a few megabytes of extra
weights that sit on top. Training an adapter is cheap enough to run on consumer hardware, and
adapters load and unload like cartridges. For Wally that means one thing: **the wallet's brain
can learn without the wallet's data ever leaving the machine.**

## The insight that makes Wally special for this

Every wallet action in Wally already ends with a human pressing CONFIRM on a card that shows
exactly what the model understood. That button is not just a safety gate. **It is a labeling
machine.** Every confirmed transaction is a human-verified training pair:

    "wire 50 to dave for the studio" → {transfer, arbitrum, USDT, 50, 0x4f2a...}   ✓ confirmed

Every correction ("no, I meant on ethereum") is a negative label. Most products pay annotators
for this data. Wally's core safety flow produces it as a byproduct, on-device, with perfect
ground truth. The chat sessions feature stores all of it in local SQLite. The training corpus
builds itself while the user simply uses their wallet.

## What the adapters would be

**1. The personal dialect adapter (the big one).**
Learns how *this specific user* talks about money. Names ("dave", "my landlord", "the studio
account") resolving to addresses they have confirmed before. Habitual phrasings, recurring
amounts, the chains they actually use. Today Wally needs "send 10 USDT to 0x4f2a... on
arbitrum". With a dialect adapter, "pay dave his 50" parses correctly on the first try, and the
confirmation card is where the user checks it understood. The model develops a picture of you,
and that picture is a file on your disk.

**2. The intent-accuracy adapter (the practical one).**
The stock Qwen3 4B occasionally mangles parsing: typos like "arbritum", unusual word orders,
mixed instructions. Fine-tuning on a corpus of wallet commands (synthetic + the user's own
confirmed history) makes a small model behave like a much larger one *on this one narrow task*.
Small model + narrow adapter is the whole on-device thesis: you do not need a frontier model to
be excellent at a domain, you need a focused one.

**3. The product adapter (the maintainable one).**
New WDK chains, new tokens, new operations (lending, bridging) taught via adapter update instead
of a new base model download. Shipping a 10 MB adapter beats shipping a 4 GB model.

## What it makes transactions feel like

- **First-name finance.** "send rent" just works, because the model learned what rent means
  to you: the amount, the recipient, the chain, the day of the month it usually happens.
- **Clarifying questions that are actually smart.** "You usually send Dave 50, this says 500.
  Is that right?" A stock model cannot ask that question; a model that learned your patterns can.
  The anomaly check happens on-device, from local history.
- **Proactive but private.** "It is the 1st. You have sent rent on the 1st for four months.
  Want the confirmation card?" This is the kind of feature that is creepy when a cloud does it
  and genuinely useful when your own laptop does it.
- **Your categories, your language.** Summaries like "how much did I send the studio this
  month" work because "the studio" is a concept the adapter learned from you.

## The training loop (all local)

1. **Corpus:** confirmed intent pairs from SQLite (sessions + transactions tables join:
   the user text, the parsed intent, and the fact it was confirmed or corrected).
2. **Trigger:** manual at first ("Wally, learn from our history"), scheduled later. Training is
   a background job; the wallet stays usable on the base model meanwhile.
3. **Train:** QVAC fine-tuning API produces a LoRA adapter file on disk.
4. **Evaluate before adopting:** replay a held-out set of past confirmed commands through
   base+adapter; adopt only if parse accuracy improves. Otherwise discard. Never ship a
   regression to yourself.
5. **Load:** QVAC loads base + adapter at startup. The adapter file sits next to wally.db,
   same privacy story: yours, local, deletable.
6. **Reset button:** delete the adapter, get the stock model back. Personalization you can
   uninstall is personalization users can trust.

## Safety line that never moves

The adapter only ever improves *understanding*. It gets no new authority. Every action still
goes through schema-constrained output, strict validation, the address taken from the user's
literal text, rate limits, and the human confirmation gate. A smarter Wally proposes better.
It still cannot spend.

## Why this story matters beyond Wally

Cloud personalization means your financial behavior becomes training data on someone's server.
On-device LoRA inverts it: the model comes to the data. "Your keys, your coins. Your model,
your instructions" gets a third line: **your history, your teacher.** No other wallet stack can
currently tell that story end to end; QVAC (local inference + local fine-tuning) plus WDK
(local signing) is the only pairing that has all the pieces in one place.

## Phasing

- **Phase 0 (now possible):** log the labeled corpus cleanly (confirmed intent + user text
  already in SQLite; add a small export view).
- **Phase 1:** offline experiment: export corpus, train adapter with QVAC fine-tuning on the
  same laptop, measure parse accuracy base vs adapted. This is one afternoon and produces the
  demo number ("misparse rate cut by X%").
- **Phase 2:** in-app loop with evaluate-before-adopt and the reset button.
- **Phase 3:** proactive features (recurring detection, anomaly questions) gated behind the
  adapter's confidence.
