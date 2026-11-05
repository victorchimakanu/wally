# Wally mobile frontend

**Phone-local test setup, 7 October 2026:** native QVAC model selection, lifecycle controls and a two-model performance comparison are now implemented. See [the phone testing guide](../docs/QVAC-PHONE-TESTING.md). The connected Android 10 / roughly 4 GB Samsung phone fails QVAC's documented Android 12 support floor, so no on-phone model benchmark or APK installation has been verified. The Expo Go/computer model path remains available with `npm start` or `npm run android:local-ai`; phone builds use the separate `phone:*` commands.

An Android-first React Native / Expo app implementing the active [WallyUI design](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=0-1). It is a frontend wallet preview with fictional balances and simulated transactions. Chat uses scripted replies by default, or a real local QVAC model through the opt-in development adapter. The desktop backend is not needed.

**Frontend update, 7 October 2026:** Inter typography, the shaped wallet card, Wallet/Chat switch, shared menu drawer, persistent draft dismissal, sample market search/filter/watchlist, asset details, editable profile, local address book, review balance impact, and the original receive QR now use WallyUI. The existing QVAC connection, manual sends, quote expiry, refunds, offline controls and phone performance tools remain connected. Market fixtures cover BTC, ETH and SOL; stablecoin prices and charts beyond the sample Bitcoin 24h render are explicitly unavailable. Wallet creation, real authentication, camera scanning and signing remain future integrations. The desktop browser remains a preview of the Android screens, rather than the separate Figma desktop app.

## Run

Use Node.js 22.13+ (verified here with Node 24).

```powershell
cd "C:\Users\kfdos\Desktop\Web Projects\wally\mobile"
npm ci
npm start
```

Open the project with a compatible Expo Go app on Android using the terminal QR code, with phone and computer on the same network. The frontend uses Expo-supported native modules. A physical Android run has not yet been verified. If another Metro server occupies the default port, use `npm start -- --port 8082`.

For a browser preview of the same React Native screens:

```powershell
npm run web -- --port 8081
```

The browser uses a centered phone preview on wide screens and a full-width layout on narrow screens. Native Android uses the actual system status/navigation bars and safe-area insets.

## Implemented

- Welcome and wallet overview, expandable balances and recent activity, Send/Receive, and persistent Wallet/Chat navigation with a shared menu drawer.
- Editable manual send with full-address, positive-amount, decimal-precision, and balance-plus-fee validation.
- Local chat list, new conversations, scripted balance/address/transfer commands, and preserved conversations.
- One canonical review screen for chat and manual transfers; live quote countdown, cancel, refresh, and explicit confirmation.
- Pending, confirmed, and failed transaction screens; local transaction history independent of chats.
- Receive address copying, with clear sample-data labeling.
- Settings, recovery explainer, model-preview pause, offline mode, fast expiry, failed-transfer scenario, and confirmed demo reset.
- Locally bundled Inter fonts and original WallyUI artwork/icons, with shared design tokens and reusable components. Asset provenance is recorded in `assets/wallyui-source.json`; SVG dimensions are retained in `src/components/wally-assets.ts`.

Try `Send 25 USDT on Arbitrum to 0x1111111111111111111111111111111111111111`, or use the example buttons. Settings → Demo controls exposes offline mode, five-second quotes, and a rejected transfer.

Only USDT on Arbitrum is simulated for sends. ETH and BTC are illustrative balance rows. No real seed, signing, blockchain RPC, WDK, authentication, swaps, bridge, or lending integration exists in this app. Native model download and lifecycle controls are implemented but have not been verified on a supported physical phone. QVAC development integration is described below. Recovery and local-model screens explain their current status. Do not enter real recovery phrases or fund sample addresses.

Pending transfers simulate settlement after four seconds; this timer is exclusively demo behavior. Confirmed sends deduct amount plus a fictional 0.02 USDT fee. Failed sends refund both. Repeated confirmation of the same quote cannot debit twice. Existing pending transfers reconcile from their saved timestamp on reopening the preview.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/app/` | Expo Router routes and app layout |
| `src/screens/` | Wallet, chat, transfer, and settings screens |
| `src/components/ui.tsx` | Buttons, cards, navigation, safe-area shell, and local Figma icons |
| `src/theme.ts` | WallyUI palette, Inter font names, radii |
| `src/demo/model.ts` | Typed fixtures, decimal validation, scripted replies, and demo transitions |
| `src/demo/store.tsx` | Demo state and AsyncStorage persistence |
| `assets/wallyui/`, `assets/figma/` | Current and earlier original design assets; no temporary asset URLs at runtime |
| `test/model.test.ts` | Transaction and command validation tests |

For production integration, replace the simulated wallet transitions with audited WDK service adapters while preserving canonical review/confirmation behavior. Validate the native QVAC adapter on a supported physical phone before claiming phone-local inference works. AsyncStorage here is for fictional state only, not signing secrets.

## Checks and bundles

```powershell
npm run typecheck
npm run lint
npm test
npx expo-doctor
npm run export:android
npm run export:web
```

Exports go to `dist/android` and `dist/web`. An Android JavaScript/Hermes export is **not an APK**. `eas.json` includes an internal APK preview profile for a later authenticated EAS build (`npx eas-cli@latest build --platform android --profile preview`). No cloud build or publication has been performed.

## Verification and design adaptations

Verified 27 September 2026: TypeScript, ESLint, five behavior tests, Expo Doctor (21/21), Android and web exports, and browser interaction checks for form validation, confirmed sending, balance persistence, receive copying, scripted balance chat, offline send blocking, and quote expiry.

Verified 7 October 2026: TypeScript, ESLint, all 28 behavior tests and an Android export. Android emulator checks covered consecutive typed requests above the visible keyboard. Isolated browser checks covered three consecutive requests at 360 × 900, four at 720 × 1800, and the responsive layout at 1280 × 700, with no horizontal overflow in the final narrow/wide check. Inline draft review, pending settlement and confirmation remained on the chat route. No application errors or console warnings appeared in the final isolated request walkthrough. Earlier browser route transitions produced a React Native Web focus/aria-hidden warning.

Chat now keeps the toolbar and composer fixed around a bounded message list. Sending anchors the latest request into view; scrolling back exposes a shortcut to return to that request. The Figma Empty/Active/Focused/Typing/Replying composer states, portrait/landscape suggestions, inline history, receive/copy/share card, balance/activity/market cards, clarification and request-error states, and active/replaced/cancelled/submitted drafts have reusable components. Reviewing and editing a draft stay inline; each quote belongs to exactly one active proposal, so retired cards cannot submit funds. Balance replies preserve the values when requested. Original SVG dimensions and assets remain intact.

These states adapt WallyUI to the existing demo capabilities. Ethereum sends, gas funding, token approvals, biometric authorization, swaps and uncertain real-network settlement states remain unconnected; the prototype's full set of wallet-operation variants is not implemented. Phone-local QVAC performance and supported physical-device rendering remain unverified.

Layouts use flex and scrolling rather than fixed Figma coordinates. The preview adds persistent demo labeling, functional forms, example controls, and settings subpages. Addresses wrap naturally rather than containing hard-coded line breaks; Android uses native system chrome. Prototype claims of a ready local AI or a funded wallet are replaced with accurate demo copy.

Android device rendering, TalkBack, keyboard behavior, and native clipboard interaction still need physical-device verification. Launcher artwork is inherited from the Expo starter and should be replaced before distribution. This is frontend implementation and bundle verification, not a production-wallet release.

## Local QVAC + Android emulator

This development path runs the **Android UI inside the emulator** and **Qwen3 1.7B Q4 through QVAC on the computer's CPU**. It does not use CUDA or a cloud AI service. It is not yet phone-local inference or a production wallet.

From the repository root, install the isolated runtime once:

```powershell
npm install --prefix internal/qvac-runtime --save-exact @qvac/cli@0.15.0 --no-audit --no-fund
```

In terminal 1, start the local model server:

```powershell
node mobile/scripts/qvac-server.mjs
```

The launcher reads `mobile/qvac.config.example.json`, writes its working config into ignored `internal/qvac-runtime`, and caches model assets under ignored `internal/qvac-models`. The first run uses system curl to download the pinned model revision directly over HTTPS, verifies its size and Hugging Face SHA-256 against `mobile/qvac-model.json`, then loads the verified local file. Interrupted transfers resume on the next launch; later launches reuse and recheck the model. This avoids depending on peer availability. Startup refuses to serve if the configured model cannot preload. It binds only to `127.0.0.1:11434`, loads only the text inference plugin, disables GPU layers, and uses a 2,048-token context. Node 22.13+ and the current QVAC Windows prerequisites, including Vulkan 1.4, are required even in CPU mode. Model files are not checked into Git.

Start an Android virtual device in Android Studio, then use terminal 2:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File mobile/scripts/start-android.ps1
```

This opens Expo Go and forwards emulator ports 11434 and 8082 to the computer. For the general Expo development command, copy `mobile/.env.example` to `mobile/.env.local` first. The environment variables contain only a local URL and model alias, never an API key. The HTTP adapter is disabled when `__DEV__` is false. Unset the URL and restart Expo to return to scripted mode.

In Settings → Local model, **Test AI connection** performs actual generation and validates the response. An alias listed by `/v1/models` alone does not establish model readiness. Start a fresh chat and try “How much USDT do I have on Arbitrum?” or the transfer example. Existing sample conversations remain static examples.

The model returns either a short conversational reply or a constrained wallet intent. Chat includes the last four message texts, capped at 320 characters each, to support recent follow-ups within the small model context. Generated conversation is display-only; wallet balances and execution instructions remain application-controlled. Wally reads its own fictional wallet state, validates a proposed amount and recipient against explicit literals in the current request, then requires review and confirmation. Unsupported chains, ambiguous transfers, invalid JSON, missing details, connection failures and cancellations cannot submit a transfer. Requests run one at a time, have a 90-second timeout, and can be cancelled. Pause, simulated offline mode, or reset also cancels pending inference; late results are discarded. There is no automatic cloud fallback. The simulated-offline switch uses explicitly labelled scripted replies in QVAC mode.

Restarting the emulator requires rerunning the launcher to restore port forwarding. Keep the server terminal open. Stop it with Ctrl+C when finished. This path validates integration; it does not measure Android-native model latency, RAM, battery or heat. For deployment to a 6–8 GB ARM64 phone, the next stage is an Expo development build with the native QVAC SDK and a verified model download into app-private storage, followed by real-device benchmarking. Expo Go cannot provide that native QVAC runtime.

References: [QVAC HTTP server](https://docs.qvac.tether.io/cli/http-server/), [QVAC configuration](https://docs.qvac.tether.io/sdk/configuration/), [QVAC system requirements](https://docs.qvac.tether.io/sdk/system-requirements/), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).

Run the optional live model check after the server is ready: `node --experimental-strip-types mobile/scripts/check-qvac.ts` from the repository root. It verifies balance, address, history and transfer intent through real inference and saves an ignored result under `internal/evidence/qvac-smoke.json`.



### Verified local inference, 6 October 2026

QVAC CLI 0.15.0 / SDK 0.21.0 loaded the checksum-verified Qwen3 1.7B Q4_0 file on Windows using the CPU backend. Live intent checks passed for balance, receive address, history and a literal 25 USDT transfer proposal; measured responses were 17.4, 13.2, 10.5 and 24.7 seconds respectively, before the final Android interaction checks. These are desktop CPU observations, not phone benchmarks or a broad model-quality evaluation. The model supplied irrelevant guesses in some unused intent fields; the app derives wallet values itself and does not trust those guesses for execution.

A generated worker containing only the text plugin and memory-mapped weights allowed successful loading after the default worker crashed under memory pressure. The launcher now generates that worker on first use. The API 36 emulator forces a minimum 2,560 MB guest allocation even when a smaller memory flag is supplied; emulator plus Expo plus QVAC can put this busy computer under substantial memory pressure. It is not a resource-free setup. Use a lower emulator display resolution and leave adequate host memory available.

Android API 36 / Expo Go 57.0.9 also displayed a real QVAC balance reply using the existing saved fictional balance (1,224.98 USDT), with an observed 18.6-second server duration. Typed message entry and the pending/cancel UI were exercised. The running app and server use local port forwarding; the saved balance screenshot is in `internal/evidence/wally-android-qvac-balance.png`.


The typed Android transfer request also completed through CPU inference (20.2 seconds), showed the exact 25 USDT / Arbitrum / full-recipient draft, and opened the canonical review screen with a fictional 0.02 USDT fee and 25.02 USDT total. It was cancelled at review; no transaction was submitted. Draft and review screenshots are saved beside the balance screenshot. Lint, TypeScript and all 10 behavior tests passed after the adapter and error-state changes.

### Conversational chat fix, 6 October 2026

The initial QVAC adapter handled only wallet intent classification, so greetings and general questions fell back to canned wallet help. Chat now requests a generated reply and supplies bounded recent conversation context. Wallet requests continue to use application-owned demo values and explicit transfer validation. The input clears only after the store accepts a message, and chat scrolls to keep replies visible.

Live CPU checks passed for a greeting containing the name Ada, a follow-up asking for that name, and a literal 25 USDT / Arbitrum transfer draft. Greeting and follow-up took 18.4 and 19.8 seconds in the direct check. Android displayed both the generated greeting and the correct name in the follow-up through the native message input and send button (19.0 and 22.9 seconds on the server). Evidence is saved under internal/evidence/wally-android-chat-fixed.png and the matching UI hierarchy. Lint, TypeScript and all 12 behavior tests passed. This remains computer-hosted development inference; no on-phone model runtime or real wallet was added.

### Android keyboard setup, 7 October 2026

For typing with the computer keyboard, enable **Keyboard: Enable Keyboard Input** in the virtual device's advanced settings. Wally_API_36 had hw.keyboard=no; this was changed to yes and the emulator cold-started. The Android launcher also enables the visible phone keyboard when a hardware keyboard is detected, so tapping the chatbox can show it.

Chat remains editable while a model reply is pending; sending another request waits until the current one finishes. Paused chat displays instructions to resume it in Settings → Local model. The native keyboard was shown above the system navigation bar and visible key taps entered Hi into the chatbox. After the restart, Android detected an alphabetic hardware keyboard and the emulator keyboard text path entered hi into the focused input. Further keyboard text was accepted while a real QVAC reply was pending; the send button remained disabled during that request. Evidence is saved under internal/evidence/wally-typing-pending.png and its UI hierarchy. Lint and TypeScript passed. Saved conversations and fictional wallet data are retained through an emulator restart.



### Faster development inference, 7 October 2026

This computer's GTX 1650 now runs the model through QVAC's Vulkan backend, without CUDA. Use npm run ai:server:vulkan from this folder to select it; npm run ai:server retains CPU mode. The running server was switched to Vulkan and runtime logs confirmed GPU inference.

After warm-up, the three live benchmark messages began displaying reply text in 0.56–0.77 seconds and completed in 1.28–3.94 seconds. The original CPU samples took 14.16–47.08 seconds before displaying anything. Cold model loading and the first GPU request are slower; keep the server running. These are development samples from this computer, not phone-local benchmarks.

Chat now uses native streamed fetch, a shorter prompt and a 180-token output budget. Exact wallet reads bypass inference and use current demo state. Streaming previews cannot create transfer drafts; full response validation and the existing review flow remain required. All 15 tests, lint and TypeScript passed, and Android visibly received text while generation was in progress.

Run npm run ai:benchmark -- vulkan-warm from this folder to record first-visible-text and full-response times and check follow-up context. Detailed measurements, startup commands, evidence and phone deployment limits are in ../docs/QVAC-PERFORMANCE.md.

