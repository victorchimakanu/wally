# ADR-001: Wallet keys stay on the phone

**Status:** Accepted · 18 October 2026
**Supersedes:** the development wallet API server as a production path

---

## Decision

**Wally is non-custodial. Private keys are generated on the phone, stored in the Android
Keystore / iOS Keychain, and used for signing inside a Bare worklet thread. No key material
reaches our servers, ever.**

Signing moves from `mobile/scripts/wallet-api-server.mjs` (a development server holding the
seed on a developer's computer) to an on-device WDK worklet, using the officially supported
React Native path.

---

## Context

Three architectures were considered over the preceding weeks.

**1. Keys on the phone, no server.** The original product thesis. Matches the V1 spec
("No account, no email, no server. Everything here happens on the phone") and the roadmap
("Keys never leave the phone. No seed in any repo, any log, any fixture, any server").

**2. Keys on a VPS, custodial, multi-user.** Considered because it removes the hardest
engineering from the critical path and makes debugging easy.

**3. Keys on the phone, thin backend for services.** The hybrid.

### What settled it

**Regulation.** Nigeria's SEC circular of 16 January 2026 sets minimum capital at ₦2bn for a
Digital Assets Custodian, ₦500m for an Intermediary, and ₦300m for an Ancillary VASP, plus a
reported ₦30m registration fee. Holding user keys puts us squarely in the custodian
category. A three-person team cannot meet that threshold, and routing around it quietly is
not an option in a regulated market. *(Figures from legal commentary, not the circular
itself — flagged UNVERIFIED in `REVENUE-MODEL-RESPONSE.md`.)*

**Engineering reality.** The existing server is single-user by construction: one seed file at
`internal/testnet-wallet/wallet.seed`, one wallet per process. Serving many users from it
means building per-user key custody from scratch — the most security-critical component in
the product, written new, under schedule pressure.

**The supported path already exists.** WDK ships first-class React Native support that we had
not found when the VPS option was chosen:

| Package | Role |
|---|---|
| `@tetherto/wdk-worklet-bundler` | Bundles chosen wallet modules into a Bare worklet artifact |
| `@tetherto/pear-wrk-wdk` | The worklet runtime and HRPC bridge |
| `@tetherto/wdk-react-native-core` | Provider and hooks, with automatic keychain storage |

`react-native-bare-kit` and `bare-pack` were **already installed** in `mobile/` for QVAC.
The runtime this needs is present.

**It preserves the product.** On-device keys keep the privacy claim honest, keep inference
cost at zero per request, and keep the marketing copy truthful without rewriting it.

---

## Consequences

### What this buys

- No custodial licensing exposure; every fiat touchpoint rides on a licensed partner instead
- No key vault to secure, breach, or insure
- The V1 spec's wallet section stops being aspirational — `useWalletManager`,
  `useAddresses`, `useBalance` map almost one-to-one onto F1–F6
- Keys isolated from the UI thread even on-device, in a dedicated worklet

### What this costs

- A native development build is required. Expo Go cannot run the worklet, exactly as it
  cannot run native QVAC
- Losing the phone and the recovery phrase means losing the funds. F1's three-word
  verification step and F2's restore flow become load-bearing, not nice-to-have
- Multi-device access needs the recovery phrase, not an account login
- The backend can never sign, which rules out server-side automation of payments

### What the backend becomes

A thin service that holds **no keys, no seeds, and no personal data**.

**Status, 23 October 2026 — it exists**, in `backend/`, and the first two items below are built and
running locally. See [backend/README.md](../backend/README.md).

| | | |
|---|---|---|
| 1 | RPC and indexer proxy — hides provider keys, absorbs rate limits, works around the Blockscout Arbitrum Sepolia 403 | **Built.** Needs an Etherscan API key to serve indexed history |
| 2 | Market data proxy — same pattern | **Built** |
| 3 | Receipt watcher and push — resolves pending transactions while the phone sleeps | Not started. The one thing a phone genuinely cannot do for itself |
| 4 | Conversion partner proxy — the revenue hinge, once a partner is chosen | Not started, and gated on a legal question rather than an engineering one. See `OFFRAMP-DESIGN.md` §1 at the workspace base |

The decision below held up under construction: the backend forwards and refuses, and nothing in it
can sign. The method allowlist is the control, and `eth_sendRawTransaction` is off unless an
operator turns it on deliberately.

**One consequence worth recording.** A conversion partner supplies a *deposit address*, which is the
first recipient in the product that the user neither typed nor chose from history. Every existing
guard passes on it, because it is well-formed and the user does approve it. That path needs its own
protections — certificate pinning, a second independent read of the order before signing, a per-order
ceiling — and they do not exist yet.

---

## Enforcement

`mobile/wdk.config.js` sets `allowedMethods`, restricting the worklet to reads, quoting and
sending. Without it, `callMethod` can invoke any method on the account object including
key export. This is the architectural equivalent of the existing rule that the model never
chooses an amount or a recipient: the boundary is enforced in code, not in prompt text.

---

## Open items

1. Verify the `allowedMethods` names against the installed wallet package surface.
2. Decide whether Ethereum also gets a bundler and paymaster (V1 spec F9).
3. Confirm whether a non-custodial wallet routing conversions through a licensed partner
   avoids SEC registration entirely, or lands in the ₦300m Ancillary VASP tier. This needs a
   Nigerian fintech lawyer and is the single question that most affects viability.
4. Confirm the Apple Developer account is an organization — Apple permits crypto wallets only
   from organizations, and conversion requires a D-U-N-S number.
