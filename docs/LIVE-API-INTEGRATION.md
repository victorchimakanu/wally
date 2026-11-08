# Live APIs in the Wally mobile app

**Updated 8 November 2026, against a running stack.**

The mobile app has **three** data connections, not two: the backend proxy on 8080 (market data,
indexed history, chain RPC), the loopback WDK testnet wallet API on 3003 (balances, quotes,
signing), and — where no proxy is configured — CoinGecko directly as a fallback. QVAC interprets
conversation; it never supplies balances, prices, fees or blockchain confirmations.

## Connected surfaces

| Surface | Source and behavior |
| --- | --- |
| Watchlist, market, stablecoins, gainers, trends, asset facts | The backend's `/v1/market`, which fronts CoinGecko `/coins/markets` for BTC/ETH/SOL/USDT. USD/NGN/EUR changes the actual request. Falls back to CoinGecko directly when `EXPO_PUBLIC_WALLY_PROXY_URL` is unset |
| Asset charts | CoinGecko `/coins/{id}/market_chart`, 1/7/30/365 days; real timestamp spacing |
| Wallet and chat balances | WDK-derived account and RPC `eth_getBalance` on Arbitrum Sepolia and Ethereum Sepolia, **plus a USDt balance on Arbitrum** read with `eth_call` `balanceOf`. USDt has 6 decimals and ETH has 18; `decimals` is data, never a constant |
| Receive | The actual account address plus its generated QR; copy/share identifies the selected test network |
| Send and Review | Server checks chain ID, recipient code, balance, nonce, gas estimate and gas price; review expires after 60 seconds |
| Confirm | Exact quote ID and explicit approval; WDK signs a fully populated transaction, signed contents are compared with the approved review before broadcast |
| Activity and receipts | The backend's `/v1/history`, backed by **Etherscan V2** and including ERC-20 transfers for pinned tokens, merged with a durable local submission journal; actual RPC receipts decide confirmed/failed status. Without a proxy it falls back to the wallet server's Blockscout path, which **403s Arbitrum Sepolia** |
| Chat wallet commands | Direct balance/address/history tools skip inference; transfer commands open manual Send and cannot submit by themselves |

## Run locally

From `mobile/`, use separate terminals:

```powershell
npm.cmd run wallet:install  # once: isolated, pinned WDK runtime under internal/
npm.cmd run wallet:server
```

```powershell
npm.cmd run start:local
```

Set `EXPO_PUBLIC_WALLY_API_URL=http://127.0.0.1:3003` in `mobile/.env.local` and restart Metro after changing it. The example also retains the existing QVAC connection. Open `http://127.0.0.1:8082/wallet`. This uses the mobile frontend, separate from the root project's scripted simulation.

For the emulator, `npm.cmd run android:local-ai` forwards ports 8082, 11434 and 3003. Start the wallet API and QVAC separately before using the launcher. A USB-connected phone needs the same `adb reverse` mappings with its own device serial. Use the literal `127.0.0.1` URL to avoid another service that might bind IPv6 `localhost` on the same port.

The first wallet-server start creates a new seed at `internal/testnet-wallet/wallet.seed`. Later starts reuse it; an invalid seed stops startup instead of silently replacing the wallet. Back up this private file securely. The directory is ignored by Git. The seed, private keys and signed transaction bytes are never returned to the app or passed into chat. Public snapshots alone are stored in the app cache. Clearing demo data does not delete the testnet wallet.

This is a **single-user development wallet with keys on the computer**. The server binds IPv4 loopback and checks Host, Origin, an HttpOnly session cookie and request limits. It is not a multi-user VPS wallet service. The Android app accesses it through the USB/emulator reverse connection; phone-local signing and secure phone key storage remain a separate native implementation task.

## Failure and approval behavior

- Missing balances show **Unavailable**, never zero. Genuine zero RPC balances show 0 ETH. A configured but unavailable wallet API never falls back to fictional balances.
- Market caches are validated, separated by currency and labeled Saved after an error/offline state. Charts never substitute the old illustration for missing data.
- Invalid, changed or expired quotes cannot submit. The API accepts the quote ID and approval only, and reloads the approved transaction from its own state.
- The journal saves the deterministic transaction hash **before** broadcast. A lost response leaves an unknown receipt; the app does not automatically resend. An unresolved pending/unknown submission blocks further sends on that network until the actual receipt is resolved. A restart retains the journal.
- No funds are debited locally and no timer creates a confirmed receipt. Network status comes from `eth_getTransactionReceipt`. A confirmed receipt means inclusion in a block, not an additional finality guarantee.
- Old demo chats and receipts remain labeled fictional. Their draft controls are disabled when the live testnet connection is configured.

## Current limits

**Sending** is still **native testnet ETH** only, to ordinary EVM wallet recipients. USDt is now
**readable** — a balance and history on Arbitrum, against a pinned third-party testnet
deployment, since there is no official Tether testnet USDT — but the ERC-20 send flow is
deliberately not built: the decimals conversion was new, and read-only means a bug shows a wrong
number rather than moving wrong money. Bitcoin, Solana, swaps, bridging and gasless relays are
not connected. Public market quotes are not valuations of testnet tokens.

A fresh wallet is unfunded. Request testnet ETH for its Receive address from a faucet for the exact selected network before an end-to-end send. The current integration has been tested against live balance RPCs and with a mocked network for signing/broadcast recovery; a funded public testnet send still requires funds and explicit UI approval.

Public providers can rate-limit or fail. Arbitrum Sepolia Blockscout returns a Cloudflare 403 —
from a server as well as from a phone — which is why the backend uses Etherscan V2 instead. With
the proxy configured, history **does** include ERC-20 transfers for pinned tokens; the "excludes
token transfers" caveat applies only to the Blockscout fallback. Internal contract traces are
excluded either way, and neither path is a complete chain index.

**A trap, fixed 8 November 2026:** the Activity screen's source line was a hardcoded string
reading "Blockscout and local receipts", regardless of what actually answered. A correctly
configured stack showed Etherscan data while crediting Blockscout and disclaiming the token
transfers it was displaying. If you are checking which path is live, trust the network panel,
not an app build older than that date.

The web app can display already saved data after losing its connection. An offline
reload/installable PWA is not implemented.

**Three items this paragraph used to list as incomplete now ship:** the backup and recovery UI
(`/wallet-setup`, `/recovery-phrase`, `/restore-wallet`, `/reset-wallet`), app lock behind
fingerprint, face or passcode, and QR recipient scanning. **Device-local key storage is written
and has never run** — `wallet-keystore.ts` over the WDK Bare worklet needs a development build
on a physical phone, and until then the recovery screens create a *different wallet* from the
one the dev server signs with. Production API authentication is still absent.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:wallet
npm.cmd run export:android
```

`test:wallet` uses the installed WDK runtime and an isolated temporary test wallet with a mocked transport. It never broadcasts to a real network. It checks exact signing, session isolation, confirmation gates, persisted uncertain broadcasts and nonce changes.

Provider references: [CoinGecko markets](https://docs.coingecko.com/demo/reference/coins-markets), [CoinGecko charts](https://docs.coingecko.com/demo/reference/coins-id-market-chart), [Arbitrum chain information](https://docs.arbitrum.io/chain-info), [WDK EVM transactions](https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm/guides/send-transactions/). WDK runtime is pinned to `@tetherto/wdk-wallet-evm@1.0.0-beta.14`; the installed source was used for its API contract.
