# Wally backend

A provider proxy. It fronts the chain nodes, the transaction indexer and the market data API
so the mobile app does not call them directly.

**It holds no keys, no seeds and no personal data, and it cannot sign or authorise anything.**
Signing happens on the phone — see [`../docs/ADR-001-key-custody.md`](../docs/ADR-001-key-custody.md).

---

## Why it exists

| Problem today | What the proxy does |
|---|---|
| Arbitrum Sepolia Blockscout returns **403** to the phone, so Activity is broken | Requests server-side, caches, and reports failure honestly instead of showing an empty history |
| Provider keys would have to ship inside the app, where anyone can read them | Keys live here, in the environment |
| Public RPC and CoinGecko throttle per IP; every phone hits them separately | One cached origin, with per-client rate limiting |
| Phones cannot be given a paid provider key safely | Swap the upstream here; the app never changes |

---

## Endpoints

```
GET  /health                                  liveness; ?deep=1 also pings each chain
GET  /v1/rpc/methods                          permitted JSON-RPC methods, and which are cached
POST /v1/rpc/:chain                           JSON-RPC passthrough, allowlisted, read-cached
GET  /v1/history?address=[&chain=]            address transactions, both chains by default
GET  /v1/market?currency=usd|ngn|eur          watchlist prices
GET  /v1/market/chart?id=&days=&currency=     price history
GET  /v1/models                               QVAC model list (passthrough)
POST /v1/chat/completions                     QVAC chat, streaming or not (passthrough)
```

`:chain` is `arbitrum` or `ethereum`. Both are Sepolia testnets for now.

Responses carry `fetchedAt`, and market responses also carry `fresh`. When an upstream fails
but a cached copy exists, the proxy serves it with `x-wally-cache: stale`, so the app can label
it "Saved" exactly as it already does for its own caches.

### Amounts the app cannot display are omitted, not passed through

`parseHistory()` in the app maps `parseTransaction` over the list and throws for the **whole
list** if one item fails, and its `wei()` parser caps the whole part of an amount at 13 digits.
A single spam transfer with an absurd value — free to send on a testnet — would therefore blank
Activity entirely and show "Enter an ETH amount with up to 18 decimals" as a load error.

So any amount or fee above that cap is left out of the record. `amount` and `fee` are optional
in the app's own type and render as `—`, so the transaction still appears; dropping it would
hide a real on-chain event, while omitting one field does not.

### `/v1/history` returns both chains in one call

The Activity screen expects a single flat, time-sorted list plus a per-chain `errors[]` — the
`LiveHistory` shape `parseHistory()` validates in `mobile/src/services/wallet-api.ts`. Omitting
`chain` gives exactly that: both chains queried in parallel, merged, deduplicated by
chain+hash, newest first, capped at 50 (above which `parseHistory` throws).

**One chain failing does not blank the screen.** That chain contributes a sentence to
`errors[]` and the other chain's transactions are still returned with a 200. Only when *every*
chain fails and nothing is cached does the route answer 503 — because an empty `items[]` would
be rendered as "no transactions", which is a different claim from "we could not find out".

**Addresses are per chain.** They need not match: `mobile/wdk.config.js` gives Arbitrum an
ERC-4337 smart account whose address comes from the account factory rather than the key, so it
differs from the EOA on Ethereum. The dev wallet server uses an EOA on both and hides this.

```
/v1/history?address=0xEOA                                  same address on both chains
/v1/history?address.arbitrum=0xAA&address.ethereum=0xBB     per chain
/v1/history?chain=ethereum&address=0xBB                     one chain only
```

A requested chain with no address is a 400 naming that chain, rather than a quiet fallback to
the other chain's address.

The backend cannot see transactions a phone submitted but never got a receipt for, so the app
still merges its own local submission journal on top of this.

### RPC reads are cached briefly, and only where staleness is free

The app polls balances every 60s per chain per user (`mobile/src/data/wallet.tsx`), so without
caching every phone forwards straight to the provider. A few seconds collapses a crowd into one
upstream call while still feeling live — a balance five seconds old is not a stale balance.

| Method | TTL | Why |
|---|---|---|
| `eth_chainId`, `eth_getCode` | 10 min | Effectively immutable |
| `eth_getBalance` | `RPC_CACHE_MS` (10s) | Polled constantly; seconds of lag is invisible |
| `eth_blockNumber` | 5s | Cheap to be slightly behind |

**Never cached**, and each for a reason that costs money if ignored: `eth_getTransactionCount`
(a stale nonce is a rejected transaction), `eth_estimateGas` and `eth_gasPrice` (a stale quote
underpays), `eth_getTransactionReceipt` (flips from null to final exactly once), and
`eth_sendRawTransaction`. `RPC_CACHE_MS=0` disables caching entirely.

Cache keys include the params, so two addresses never share an answer, and the caller's own
JSON-RPC `id` is substituted back on a hit. A JSON-RPC error is never cached — it may be
transient — and is passed through untouched rather than turned into a 5xx. Every response
carries `x-wally-cache: hit | miss | bypass`.

---

## Why chat goes through here: a QVAC CORS bug

**These two routes are registered only when the service is bound to loopback.** The app can
only reach them from a development build — the endpoint is `__DEV__`-gated in
`mobile/src/demo/store.tsx`, and `localEndpoint()` in `mobile/src/services/qvac.ts` refuses
anything that is not `127.0.0.1`, `localhost` or `10.0.2.2`. A deployed instance that served
them would publish a model relay no legitimate client can call, so it answers 404 instead.

**Measured 20 October 2026.** QVAC's HTTP server (`@qvac/cli` 0.15.0) returns
`access-control-allow-origin` on ordinary JSON responses and on the OPTIONS preflight, but
**omits it on streaming `text/event-stream` responses**:

```
non-streaming POST  →  access-control-allow-origin: http://127.0.0.1:8082
streaming POST      →  header absent
```

A browser therefore discards every streamed chat reply and the fetch rejects after about
10 ms with `TypeError: Failed to fetch`. QVAC logs nothing, because from its side the request
succeeded with a 200 — and `curl` agrees, since curl does not enforce CORS. Only a browser
sees the problem.

Native builds send no `Origin` header, so CORS never applies and chat works there. **This
breaks the web preview only.**

Forwarding through `/v1/chat/completions` fixes it: the server-wide `onRequest` hook sets the
CORS header on every response, streamed or not. The body is piped with `Readable.fromWeb`, so
streaming still streams and the app's token-by-token preview is preserved.

Point the app at the backend rather than at QVAC directly:

```bash
# mobile/.env.local
EXPO_PUBLIC_QVAC_URL=http://127.0.0.1:8080   # not 11434
```

`QVAC_TIMEOUT_MS` defaults to 120s because inference is slow — 8 to 16 seconds measured on a
2012 CPU — and the ordinary 12s upstream timeout would otherwise trade a CORS failure for a
timeout failure.

This is worth reporting to Tether. The `cors.origins` setting in `mobile/qvac.config.*.json`
is correct; the server simply does not apply it to SSE responses.

---

## The security model

**The method allowlist is the control.** Only the read methods the app needs are forwarded;
everything else is refused before it reaches a provider. `eth_accounts`, `eth_sign`,
`personal_sign` and the `debug_*` family are not on the list and never will be.

**Broadcasting is off by default.** `RPC_ALLOW_BROADCAST=true` adds `eth_sendRawTransaction`.
The proxy cannot tamper with a signed transaction — altering any byte invalidates the
signature — so the risk is abuse as an open relay, which rate limiting bounds. It is still a
deliberate choice rather than a default.

**Errors never echo upstream detail.** Provider URLs can embed API keys, so failures are
logged through a scrubber and the client receives a generic message.

**Access requires a shared key, off loopback.** Set `WALLY_APP_KEY` and every route except
shallow `/health` needs an `x-wally-key` header. The server **refuses to start** if `HOST` is
not loopback and no key is set, rather than coming up quietly unprotected. Comparison is
constant-time, and a rejected key is logged as an event without its value.

Be clear about what this buys: the mobile app ships the key in its bundle, so it is not a
secret from anyone willing to unpack an APK. It stops drive-by scanners and casual theft of
your provider quota, which is the real threat to a small public service. It is **not user
authentication**, and the rate limiter remains the actual backstop. Per-user auth only
becomes meaningful when there is per-user state to protect.

```bash
WALLY_APP_KEY=$(openssl rand -base64 32)   # backend/.env.local
EXPO_PUBLIC_WALLY_APP_KEY=<same value>     # mobile/.env.local
```

Leave it unset for local development; the server prints a note and stays open on loopback.

**Browsers must be on the allowlist.** `ALLOWED_ORIGINS` gates any request carrying an
`Origin` header. The native app sends none and is unaffected. The preflight permits
`x-wally-key`, which it must: a custom header makes the browser preflight every request and
refuse it outright if the preflight does not list it, so omitting it breaks every browser
request the moment a key is configured.

**`X-Forwarded-For` is trusted only from `TRUSTED_PROXY`,** which defaults to the loopback
address. Setting it to `true` would honour that header from any client and let anyone who can
reach this port without going through the reverse proxy forge their IP past the rate limiter.

**Rate limiting is per client IP, which is weaker on mobile than it looks.** Carrier-grade NAT
puts many subscribers behind one public address, so a per-IP budget is shared by everyone on
that carrier. At the default 120/min and roughly five requests per active user per minute,
that is about two dozen users per address before legitimate traffic starts getting 429s. This
needs a per-installation budget before any real user load; see the open decisions below.

---

## Running it

```bash
cp .env.example .env.local     # edit as needed; defaults are public testnet endpoints
npm install
npm run dev                    # http://127.0.0.1:8080
npm test                       # offline tests: validation, cache, scrubbing
npm run typecheck
```

Production:

```bash
npm run build && npm start
```

### On a VPS

Keep `HOST=127.0.0.1` and terminate TLS in nginx or Caddy in front of it. The service sets
`trustProxy`, so rate limiting uses the forwarded client IP rather than the proxy's.

Point the app at it with `EXPO_PUBLIC_WALLY_PROXY_URL` in `mobile/.env.local`.

---

## Open decisions

Two choices are outstanding. Both are config-level here, so neither needs an app release.

### 1. Which transaction indexer? — DECIDED: Etherscan V2

Implemented 20 October 2026. `INDEXER_PROVIDER` selects `etherscan` (default) or
`blockscout`; both are normalised to the same `LiveTransaction` shape the app validates, so
switching is a config change and the app never notices.

**One thing remains: the API key.** Get a free one at <https://etherscan.io/apis> — a single
key covers Arbitrum Sepolia and Ethereum Sepolia through the v2 `chainid` parameter — and set
`ETHERSCAN_API_KEY` in `backend/.env.local`. Without it the route answers 503 and says
explicitly that no key is configured, rather than looking like a network fault.

The original comparison is kept below for the record.

**Status: blocking Activity.** Measured 20 October 2026 — Blockscout returns **403 for Arbitrum
Sepolia from the server as well as from the phone**. Cloudflare is rejecting the address, not
the User-Agent, so proxying alone does not fix it. A different indexer does.

| Option | For | Against |
|---|---|---|
| **Blockscout with an API key** | Smallest change — same response shape, same parsing | Need to confirm a key lifts the block rather than only the rate limit |
| **Etherscan V2** | One key covers Arbitrum and Ethereum; stable, documented, generous free tier | Different response shape, so `/v1/history` needs a mapping layer |
| **Alchemy or Infura** | Same vendor can serve RPC and history; strong reliability | Paid beyond a small free tier; another account to manage |
| **RPC-only, no indexer** | Zero dependencies — resolve each submitted hash via `eth_getTransactionReceipt` | Only shows transactions this device submitted; no incoming payments, no history after reinstall |

Worth noting the last option is not absurd for V1: the app already keeps a local submission
journal, and "payments you made from this phone" may be enough until mainnet.

**Recommendation: Etherscan V2.** One key, both chains, and it survives the move to mainnet.

### 2. Does the phone broadcast through this proxy, or direct to a node?

Signing happens on the phone either way. The question is only who relays the signed bytes.

| Option | For | Against |
|---|---|---|
| **Through the proxy** (`RPC_ALLOW_BROADCAST=true`) | One paid provider, no key in the app; we can see submission failures and retry policy centrally | Makes this an open broadcast relay that strangers could abuse; rate limiting bounds but does not remove it |
| **Direct to a public node** | Nothing to abuse here; the proxy stays read-only | The app carries an RPC endpoint; public nodes throttle and sometimes drop submissions, and we lose visibility |

The proxy **cannot tamper** with a signed transaction — altering any byte invalidates the
signature — so this is an availability and abuse question, not a safety one.

**Recommendation: through the proxy, with a tighter rate limit on that one method.** It keeps
provider keys out of the app and gives one place to see failed submissions. Currently **off**;
flip `RPC_ALLOW_BROADCAST` when decided.

---

## What belongs here later, and what never does

Planned: a receipt watcher with push notifications (the only piece a phone genuinely cannot do
for itself, because it sleeps mid-confirmation), then the conversion-partner proxy, then the
bills aggregator.

Never: private keys, seed phrases, or any ability to move funds.
