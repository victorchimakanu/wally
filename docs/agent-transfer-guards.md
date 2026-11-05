# The agent transfer guards, and why the app does not have them yet

**Status: a prerequisite, not a decision.** Nothing here needs doing today. It needs doing
before one specific feature, and this record exists so that dependency is not discovered late.

Written 22 October 2026, from an audit of the mobile app against the reference app.

---

## What the reference app does

The reference app in `src/agent/` enforces in code that the model never supplies a number:

- `amountAppearsInText()` ([src/agent/index.ts](../src/agent/index.ts)) rejects any amount that
  does not literally appear in the user's message. It handles `12,50`, `1.250,50` and `1,250`.
  A value the model invented never reaches a confirmation screen.
- Recipient addresses come from the user's literal text or from transaction history, never from
  model output.
- `isKnownContractAddress()` blocks sends to token and pool contracts, which are unrecoverable.
- `createConfirmation()` ([src/agent/confirm.ts](../src/agent/confirm.ts)) mints a token and
  waits for a protocol event. Typing "yes" is not a confirmation.

`CLAUDE.md` calls this the invariant the whole design protects.

## What the mobile app does instead

**It does not carry model values at all,** which is a stronger guarantee than validating them.

`liveIntentReply()` ([mobile/src/services/live-wallet-chat.ts](../mobile/src/services/live-wallet-chat.ts))
handles a `transfer` intent by discarding `intent.amount` and `intent.recipient` and opening
Send empty. The user types both. There is no invented amount to catch because no amount is
carried.

Chat-initiated transfers are additionally refused outright while a live wallet is connected
(`liveWalletEnabled` in [mobile/src/demo/store.tsx](../mobile/src/demo/store.tsx)); the draft
flow is demo-only, against a fictional USDt balance that touches no chain.

The equivalent of `isKnownContractAddress()` does exist on the live path: the dev wallet server
refuses a contract recipient via `eth_getCode` before signing
([mobile/scripts/wallet-api-core.mjs](../mobile/scripts/wallet-api-core.mjs)). A confirmation
protocol exists too, as quote → review → confirm with a quote id, an origin check and an expiry.

So today the only thing holding the line against a model-supplied amount is that **no model
value is ever used**. The system prompt also instructs the model to copy literal values, but
prompt text is not a control and must not be counted as one.

## When this becomes a prerequisite

V1 calls for a confirmed transfer driven from chat. The moment the assistant is allowed to
prefill a transfer on a live wallet, the guarantee above disappears, and the app has no code
guard to fall back on:

| Guard | Reference app | Mobile app today |
|---|---|---|
| Amount must appear in the user's text | `amountAppearsInText()` | **none** — not needed while no amount is carried |
| Recipient never from model output | enforced | enforced, by carrying nothing |
| Contract recipient refused | `isKnownContractAddress()` | `eth_getCode` check in the dev server |
| Confirmation is a protocol event | `createConfirmation()` | quote id + origin + expiry |

Two of the four have no equivalent once values start being carried, and the `eth_getCode` check
lives in the development server, so it has to be rebuilt anyway when signing moves into the WDK
worklet.

**The work, when it comes:** port `amountAppearsInText()`, decide where the recipient may come
from, and re-establish the contract-recipient refusal and the confirmation protocol on the
on-device signing path rather than in the dev server.

**What not to do:** enable chat-driven transfers on a live wallet and rely on the review screen
plus the system prompt. The review screen is a human check, not a code control, and a prefilled
address is exactly the field a user is least likely to verify character by character.
