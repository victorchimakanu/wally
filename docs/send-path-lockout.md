# A refused broadcast locked the chain — fixed 5 November 2026

**Status: fixed.** Both halves. The node's reason reaches the user, and a transfer that can no
longer land is now detected and stops blocking the chain.

The fix is the one this document argued for rather than the one it warned against: **ask the
chain, do not parse the node's error text.** If the account's nonce has moved past a
transaction's nonce and that transaction has no receipt, some other transaction consumed the
nonce. A nonce is spent once, so the transfer is dead and the money never moved. No string
matching, and no risk of calling `already known` a failure while it confirms.

The same rule closes `FEATURE-AUDIT.md` §28.3 — the same recovery phrase sending from two
phones, where both read one nonce and only one can win — because they were never two problems.
Both are a record that can never resolve, and `quote()` blocking on it forever.

Three details worth knowing:

- **The nonce is read a few blocks behind the head**, not at it, using the same
  `CONFIRMATIONS` table the receipt check already uses. A reorg that reversed this verdict
  would have to be as deep as one that reverses a confirmed transfer. A terminal verdict a
  reorg can undo is how somebody sends twice.
- **`confirm()` resolves what is outstanding before it decides to block.** Otherwise the
  unblocking would only happen when somebody opened Activity, so a dead transfer would keep
  the chain wedged for as long as nobody looked.
- **Records written before nonces were journalled cannot be judged**, so they get a deliberate
  user action — "this never arrived" — which the server refuses for anything it *can* judge.
  That refusal is what stops the escape hatch becoming a way to send the same money twice.

**One thing this missed, found 7 November.** Adding the `superseded` status left the journal's
load-time validator still listing four statuses, so the first restart after a stranded transfer
was resolved threw "The transaction journal is invalid" and the dev server would not start — the
fix for a wedged chain wedged the server instead. The statuses are now one list with
`OUTSTANDING` computed as the complement of `SETTLED`, the validator is an exported function so
it can be tested at all, and a test walks every status through it.

The history below is kept because the reasoning still matters.

## What happens

When the node *answers and refuses* a broadcast — `nonce too low`, `insufficient funds`,
`intrinsic gas too low` — the result is:

```
broadcast attempts: 1
record status after a REJECTED broadcast: "unknown"
what the user is told: nothing — confirm() resolved successfully

after 3 receipt checks, status is still: "unknown"

second send: BLOCKED — "A transfer on this network still needs a receipt.
                        Resolve it in Activity before creating another send."
other chain:  still works (the block is per-chain)
```

The transaction was never accepted, so `eth_getTransactionReceipt` returns `null` forever.
`receipt()` falls back to `record?.status ?? 'pending'`, so the record stays unresolved
permanently. `quote()` refuses to build a new transfer while any record on that chain is
`unknown` or `pending`. **There is no UI action that can clear it.** The message tells the user
to resolve it in Activity, and Activity cannot.

The chain is wedged for good.

## What was fixed

`rpc()` now distinguishes *the node refused* from *the node was unreachable*, and `confirm()`
records the node's own words on the transaction as `rejection` instead of discarding them.

The deliberate behaviour is unchanged: a **lost response** still keeps the hash and the
`unknown` status, because the transaction may well have arrived. That is correct and Kojo's
existing test covers it. Only the silence changed.

## What is still open, and why I stopped

The obvious fix — mark the record `failed` when the node refuses — is wrong as stated, and the
reason is worth writing down:

| Node says | Can the transaction still land? |
|---|---|
| `nonce too low` | No. Another transaction used that nonce. |
| `insufficient funds` | No, not as signed. |
| `intrinsic gas too low` | No. |
| **`already known`** | **Yes — the node already has it.** |
| **`replacement transaction underpriced`** | **Possibly — the original is still in the pool.** |

Marking `already known` as failed would tell someone a transfer failed while it was on its way
to confirming, and the pending-transfer guard exists precisely to stop a second send colliding
with a first. Getting that backwards is worse than the lockout.

Matching on provider error strings is also brittle: the wording differs between Geth, Erigon,
Nethermind and the hosted providers, and it is not part of any standard.

**The decision belongs to whoever owns the send path.** Two defensible shapes:

1. **Treat only an unambiguous refusal as terminal** — a short allowlist of reasons that
   definitively mean "never broadcast", everything else staying `unknown` as today.
2. **Give the user an explicit way out** — an Activity action that marks an unresolved record
   abandoned after re-checking the nonce on-chain, which is the real question: if the account
   nonce has moved past this transaction's nonce and no receipt exists, it can never land.

Option 2 is the sounder one, because it asks the chain rather than parsing a string. It needs
UI, which is Kojo's.

## Why this was not caught earlier

`test/wallet-server.test.mjs` was not in `npm test`. It ran only under `npm run test:wallet`,
needed a separate `npm run wallet:install`, and **errored outright on a fresh checkout**. The
most safety-critical code in the repo had tests that never ran — including in four previous
audits that each reported the mobile suite as fully passing.

It is in `npm test` now, and the cases needing WDK skip with a visible reason instead of
failing or being quietly absent.

## One more thing, not yet a bug

`wallet-api-core.mjs` resolves WDK with `createRequire(internal/wallet-api-runtime/package.json)`,
and Node walks *up* from there. The repo root `node_modules` also contains
`@tetherto/wdk-wallet-evm` for the reference app, so that resolution can reach the wrong copy.
Today it fails loudly instead, because `qrcode` is not installed at the root and the whole
`try` block throws together. If `qrcode` ever appears at the root, the dev server would load
WDK from the reference app's tree — the duplicate-wallet-class problem `CLAUDE.md` warns about
under `scripts/dedupe-wdk.mjs`. Worth pinning the resolution to the isolated runtime before
that happens.

(The same false positive bit the skip guard in the test file, which is how it was noticed.)
