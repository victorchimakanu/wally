# Wally: local development simulation and feature review

Reviewed 22 September 2026 against the checked-out source and a browser-tested UI simulator.

## Run locally

```powershell
npm run dev:sim
```

Open http://127.0.0.1:3000. Set `SIM_PORT` to choose a different port.

This new simulator uses only Node built-ins and the existing `public/reach.html`, `reach.css`, and `app.js`. It does not require an npm dependency install. Its isolated browser adapter supplies fictional balances and scripted replies; it never loads QVAC, WDK, seeds, RPC endpoints, or the production database. Simulation labels are added when serving the assets; production UI files are unchanged.

Try:

- `what is my balance`
- Click a balance card to reveal a clearly invalid demo deposit address.
- `send 10 USDT to 0x1111111111111111111111111111111111111111 on arbitrum`
- Confirm or cancel the simulated transfer.
- `history`
- Start a new chat and switch back using the desktop sidebar.

Demo state uses sessionStorage in the current browser tab. A new chat shares the fictional wallet balance. Closing the tab normally clears its demo state; browser session restoration may preserve it. The simulator deliberately does not fabricate swaps, lending, market prices, wallet backup, or real settlement.

## Validation and limits

Browser-verified: app load; sample balance cards; address reveal; transfer confirmation; cancellation; 60-second expiry; balance changing from 1000 to 990 USDT after a confirmed 10-USDT send; transaction history; new chat; chat switching and replay. The localhost health endpoint reports simulation/scripted/mock/fictional. Both new scripts pass Node syntax checks.

Desktop checked at 1440 x 1000; mobile checked at 390 x 844. The existing layout hides chat navigation below 900px. At 390px, the unmodified balance-card layout extended to 558px before the final simulation badge wording change; horizontal overflow remains a product layout concern, not a wallet-integrity result.

The real backend was NOT started or verified. `npm ci --no-audit --no-fund` failed with npm-cache EEXIST/ENOENT errors, tar write errors, and EPERM cleanup errors. The machine also reported very low free RAM and one PowerShell process failed with OutOfMemoryException. A TypeScript check against this incomplete install failed on missing dependencies/types; this is not evidence of a clean-install compilation failure. The unit suite could not be validly run. No QVAC executable was found on PATH; the local Ollama API probe timed out. No model was downloaded, no seed was created, and no on-chain operation was attempted.

## Features present in the production source

| Capability | Current implementation | Verification boundary |
| --- | --- | --- |
| Natural-language wallet chat | OpenAI-compatible local QVAC client, structured intent output, recent conversation context | Source reviewed; real model not exercised |
| Multichain balances and receive addresses | Ethereum, Arbitrum, Bitcoin; native assets plus USDT on EVM; address cards bypass AI | UI exercised with fictional data |
| Transfers | Fee quote, literal-address and amount checks, 60-second confirm/cancel gate, execution, EVM receipt checks | UI gate simulated; real signing/settlement unverified |
| Swaps | Ethereum/Arbitrum quote, confirmation, execution and settlement status | Source reviewed; integration unverified |
| Aave deposit plus borrow | Approval, supply, borrow plan; missing-LTV follow-up; numeric risk calculation and position readout | Source reviewed; incomplete lifecycle and network issues below |
| Gasless accounts | Detect bundler and paymaster configuration; use smart accounts and user-operation receipts | Requires external configuration; not enabled out of the box |
| Local history | SQLite chats, sidebar, new chat/switch, session-local transaction records | Simulator mimics UI using separate browser-tab storage |
| Wallet bootstrap | Auto-generated local seed, backup modal, configured seed alternatives | Source reviewed; backup request mismatch below |
| Operational controls | Loopback default, signed cookies, origin checks, rate limits, secret scrubbing, health and metrics endpoints | Source reviewed; no full security assessment performed |
| Documentation and CLI | Docusaurus site on port 3001; terminal agent harness | Present; not started |

## Main disparities, in priority order

1. **Testnet selection does not reliably produce a testnet configuration.** `.env.example:39-40` explicitly sets mainnet Ethereum and Arbitrum RPC URLs while line 49 selects testnet. Both `src/config.ts:238` and `src/wdk/server.ts` honor explicit overrides in testnet mode. Copying the example therefore overrides the intended Sepolia defaults. Separately, `src/wdk/lending.ts:36-49` fixes USDT token addresses and Aave pools to mainnet deployments, and `src/wdk/tools.ts:19-28` always builds mainnet explorer links. Bitcoin address validation in `src/agent/intent.ts` accepts mainnet-style prefixes, not typical testnet prefixes. Resolve the network configuration as a whole before treating the TESTNET badge as assurance.

2. **Wallet backup has a likely browser request mismatch.** `src/server.ts:153-178` requires a present same-origin Origin header on the recovery GET. `public/app.js:587` uses ordinary same-origin `fetch('/api/wallet/recovery')`; browsers normally omit Origin on this kind of GET. The frontend silently ignores the resulting error response. This is a source-derived defect candidate, not reproduced against the real backend in this run. Verify first-run backup before using the real wallet.

3. **Bridging is advertised in the intent surface but not implemented.** `src/agent/index.ts:721-728` only returns “Bridge operations are coming soon.” The installed bridge package does not make this a working user flow.

4. **Lending can open a position but cannot close it through Wally.** The intent union and handlers include deposit/borrow and position reads, but no repay or withdraw actions. `src/agent/intent.ts:67` caps LTV at 60%, while the fallback question at `src/agent/index.ts:203` still says 75%.

5. **Gasless is configuration-dependent.** README positioning presents fees in USDT as the default experience; `src/config.ts:11-27` detects no gasless chains without bundler/paymaster configuration. A fresh checkout uses classic accounts and needs native gas for token sends. Also, receipt verification at `src/wdk/tools.ts:238-245` hardcodes `wdk.config.json`, whereas startup accepts an arbitrary `WDK_CONFIG` path; a custom path can leave submitted operations unconfirmed in the app.

6. **Saved history is short-lived and scoped to individual chats.** `src/agent/index.ts:241-257` reads the latest 10 local transactions for the current session. It does not provide wallet-wide indexed chain history or a date-range report. `src/session/manager.ts:145-146` deletes sessions after 24 hours of inactivity; `src/db/schema.sql:17` cascades deletion to their transaction records. This is much narrower than durable wallet history. The “send the same again” flow only asks a follow-up; it does not prepare a repeat transaction (`src/agent/index.ts:275-292`).

7. **Mobile loses navigation and overflows horizontally.** The sidebar, including “new chat,” is hidden under 900px with no replacement (`public/reach.css:219-221`), confirmed at 390px. The balance strip also extends beyond the mobile viewport in the tested UI.

8. **The live status copy overstates what is checked.** The production welcome text claims systems are online and inference is local QVAC after a WebSocket connects (`public/app.js:91-105,197-211`), without consulting `/health`. Configuration permits remote authenticated inference, and an unavailable model does not prevent the socket connecting. The status should reflect actual inference health and location.

9. **Production packaging has gaps.** `package.json` uses shell `cp` in the build command, which is not portable to standard Windows npm execution. The TypeScript build does not enable allowJs and only explicitly copies schema.sql, so the `src/wdk/approve-runner.mjs` helper is not included in dist, although compiled lending code resolves it beside itself. These are source findings; a clean production build was not completed.

10. **End-to-end coverage is stale.** `vitest.config.ts` excludes `test/integration/**`. The integration test opens an unauthenticated WebSocket and expects `connected.sessionId`, while `src/routes/ws.ts` requires a signed cookie and no longer sends that field. Unit-test success alone would not prove the documented startup and chat flow works.

11. **Personalization is roadmap-only.** `docs/LORA_ROADMAP.md` explicitly describes a design outline. There is no implemented LoRA training, adapter management, or human-confirmation training dataset pipeline.

## Suggested work order

First align testnet RPCs, token/pool registries, explorer URLs, and wallet backup. Then complete lending exit actions and correct gasless configuration handling. Next fix mobile navigation/layout and clarify history retention. Finally repair the production build and authenticated integration tests. Bridging and LoRA should remain labeled as planned until implemented and verified.
