---
id: transaction-lifecycle
title: A transaction, end to end
sidebar_label: A transaction, end to end
---

# A transaction, end to end

This page follows one sentence through the entire pipeline, with the real code at every step.

```text
"send 10 USDT to 0x4f2a...9c1e on arbitrum"
   │
   1. sanitize        (screen for prompt injection)
   2. parse           (QVAC → structured intent, schema-locked)
   3. validate        (zod types + literal address from user text)
   4. preflight       (can this transfer physically succeed?)
   5. quote           (WDK estimates the fee)
   6. confirm         (a human presses the button — or nothing happens)
   7. execute         (WDK signs locally, submits)
   8. verify          (only claim success once the chain agrees)
```

## 1. Sanitize

Wally handles money, so prompt injection is a real attack surface. Every message is screened before the model ever sees it:

```typescript title="src/agent/sanitize.ts"
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|all|above)\s+(instructions?|prompts?)/i,
  /system\s+override/i,
  /you\s+are\s+now/i,
  /admin\s+mode/i,
  /forget\s+(everything|all|your|prior)/i,
  /new\s+instruction/i,
  /jailbreak/i,
  /\[system\]/i,
  // ...
];

export function sanitize(input: string): SanitizeResult {
  if (input.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: "Message too long" };
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) return { ok: false, reason: "Message contains disallowed content" };
  }
  const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  return { ok: true, cleaned };
}
```

## 2. Parse — on your hardware

The sentence goes to the local model with a system prompt that knows the network mode, and generation locked to the intent schema (see [architecture](/architecture) for the `responseFormat` block). What comes back is never prose:

```json
{
  "intent": "transfer",
  "params": { "chain": "arbitrum", "token": "USDT", "amount": "10", "to": "0x4f2a...9c1e" },
  "reply": "Sending 10 USDT to 0x4f2a...9c1e on Arbitrum. I will show the fee and ask you to confirm."
}
```

## 3. Validate — trust nothing

The intent is re-validated with strict types, and the recipient address is taken **from your literal text**, character for character, never from the model's copy (models mangle long identifiers).

## 4. Preflight — fail with an explanation, not a surprise

A token transfer on a classic account pays its fee in the chain's native asset. If the wallet cannot possibly succeed, Wally says so before showing a confirmation:

```typescript title="src/agent/index.ts"
const isGasless = config.gaslessChains.includes(params.chain);

if (!isGasless && isToken && ["ethereum", "arbitrum"].includes(params.chain)) {
  const native = await tools.fetchNativeBalanceNumber(params.chain);
  if (native === 0) {
    this.emit({ type: "error", message:
      `This transfer cannot go through yet. Your address has 0 ETH on ${params.chain}, ` +
      `and sending ${params.token} costs a small ETH fee (gas). ...` });
    return;
  }
}
```

(On [gasless chains](/gasless) this check is skipped — the fee comes out of the token itself.)

## 5. Quote

The agent asks WDK for a fee estimate, so the confirmation card shows a real number.

## 6. Confirm — the gate that never moves

Nothing in Wally spends money except a human pressing CONFIRM. The pending operation is a promise that resolves only from the UI, and it self-destructs in 60 seconds:

```typescript title="src/agent/confirm.ts"
const CONFIRMATION_TIMEOUT_MS = 60_000;

export function createConfirmation(sessionId, action, amount, tokenSymbol, recipient, chain, fee) {
  const token = randomUUID();
  const promise = new Promise<boolean>((resolve) => { resolver = resolve; });

  const timer = setTimeout(() => {
    pending.delete(sessionId);
    resolver(false);            // timeout = cancel; nothing was signed
  }, CONFIRMATION_TIMEOUT_MS);

  pending.set(sessionId, { payload, resolve: resolver, timer });
  return { payload, promise };
}
```

```typescript title="src/agent/index.ts — the agent stops and waits"
this.emit({ type: "confirmation", payload });
const confirmed = await promise;

if (!confirmed) {
  this.emit({ type: "message", content: "Transfer cancelled." });
  return;
}
```

## 7. Execute — sign locally

Only now does the agent call WDK's `transfer` tool. The key is derived from the seed in the subprocess's memory, the transaction is signed there, and only the signed result goes to the network.

## 8. Verify — trust, but check the chain

Wally does not repeat what the wallet library tells it. Success is only claimed once the chain's own RPC acknowledges the transaction:

```typescript title="src/wdk/tools.ts"
export async function verifyTxOnChain(chain: string, txHash: string): Promise<boolean> {
  // On a chain we CAN verify, something that is not a hash can never be found.
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1,
        method: "eth_getTransactionByHash", params: [txHash] }),
    });
    const json = await res.json();
    if (json.result) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
```

If the network never saw it, the user hears the truth:

```typescript title="src/agent/index.ts"
if (!seenOnChain) {
  updateTxStatus(txId, "failed");
  this.emit({ type: "error", message:
    `The wallet signed this transfer, but the transaction has not appeared on ${params.chain}. ` +
    `Treat it as not sent. Your funds have most likely not moved...` });
  return;
}
```

This last step exists because of a real bug found while building Wally: a wallet layer can report "sent!" for a transaction that never reached the network. An agentic finance app must never relay that claim unchecked. Verify against the ledger itself.
