# Wally chat components and desktop/mobile direction

7 October 2026. Recommendation pass based on the current WallyUI canvas, the checked-out desktop and Expo source, the ten-page feature document dated 28 September 2026, and official competitor documentation.

## Main recommendation

Complete the missing conversational states and bring the existing app into the current WallyUI system before adding more financial operations. Wally's distinct experience should be a continuous, useful conversation that renders trustworthy wallet and market tools in context.

The live App page contains 108 screen frames across 29 flow sections. Every active screen is 440 pixels wide. The repository already contains a desktop web interface and an Expo mobile frontend; an active desktop Figma design is missing.

This is a design and source review. No model inference, device authentication, real wallet, chain transaction, or competitor app interaction was executed in this pass. Competitor documentation supports pattern research, not claims that their apps were tested.

## Document and scope

The supplied PDF is the baseline for the complete app, not a separate V1 comparison flow.

- Pages 1-4: one payment pipeline for buttons and chat; Android and iOS; USDt on Arbitrum and Ethereum; receive, QR scanning, address book, durable local payment history. Arbitrum fees are in USDt. Ethereum requires ETH unless fee sponsorship is implemented.
- Page 5: chat supports balance, receive address, sending, and history. Code validates the model's structured instruction. Recipient resolution comes from the user's words or the local address book. Model installation is optional and device checked; the wallet works without it.
- Page 6: testnet default, deliberate mainnet switch, payment/daily caps, rate limits, contract-address rejection, model management and app/model version information. Voice, spending insights, personalization, Bitcoin wallet support, prices, multiple wallets and push notifications are later scope. Cloud backup is excluded.
- Pages 8-10: swaps, bill-photo errands, fiat payouts and African-language translation are future direction. Naira payouts depend on a verified off-ramp partner; the exact supported languages must be verified.

The user's later decision keeps Wallet + Market active, overriding the PDF's price-lookup deferral for this design. Watchlists and richer market readouts below are proposed additions to that Market scope. Price alerts, portfolio insights, cross-device linking, OCR, swaps and language packs remain proposals for later work, not implied approved implementation.

Viewing BTC/SOL/XRP market information does not mean the payment wallet supports those assets. Clearly distinguish market assets from spendable USDt balances on supported networks. Local-currency amounts remain estimates and never change the actual settlement currency.

## Current evidence: four inspected surfaces

1. **Home - coherent foundation.** The profile wallet card, lavender attached transaction preview and four tool boxes establish the app's visual language. Reuse these. Add a small optional watchlist preview after the tools, rather than another navigation system or Home composer. Keep the environment readable on the card or money context. Profile remains on the avatar; history expands under the card.

   [Current Home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=244-2861)

   ![Current Home](C:/Users/kfdos/Desktop/Web%20Projects/wally/design-audit/2026-10-07/01-home.png)

2. **Continuous Chat - sound core, incomplete states.** One conversation, plain assistant text, contextual draft and suggestions next to the composer are right. The library has 17 inline-tool turn variants and 20 composer contexts. It covers balances, local value, Market, BTC/ETH/USDt details, draft/edit/review/approval, pending/confirmed/cancelled, Activity and receipt examples. Missing states are mainly clarification, tool progress, failures and stale historical actions.

   [Current Chat](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=524-4560)

   ![Current continuous Chat](C:/Users/kfdos/Desktop/Web%20Projects/wally/design-audit/2026-10-07/02-chat.png)

3. **Market overview - readable, needs more purpose.** Search, filter pills, asset rows and sparklines already feel like a market. The next useful layer is saved assets, sorting, market facts and a route into a contextual explanation. It needs freshness/source information and a clear distinction between a price and a wallet holding.

   [Current Market](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=215-1356)

   ![Current Market](C:/Users/kfdos/Desktop/Web%20Projects/wally/design-audit/2026-10-07/03-market.png)

4. **Trends - clear, currently BTC-led.** A Bitcoin chart plus three positive movers is a good start, but offers limited discovery. Reuse the chart for the selected asset and timeframe; add gainers/losers, volume and an optional two-asset comparison. Avoid suggesting that an upward chart guarantees a return.

   [Current Trends](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=411-2892)

   ![Current Trends](C:/Users/kfdos/Desktop/Web%20Projects/wally/design-audit/2026-10-07/04-trends.png)

Screenshots were captured in this review, saved locally, reopened and checked. The broader 108-screen inventory was inspected structurally, not captured step by step.

## Chat components to design or extend

Priority: First = complete the current wallet journey; Next = deepen the approved Market experience; Later = requires further product/runtime scope.

| Priority | Component | Gap and intended behavior | Reuse |
| --- | --- | --- | --- |
| First | Clarification and choice reply | Ask one missing detail: amount, recipient or network. If Victor has multiple saved addresses, display the saved candidates with chain and full address available. Preserve the draft while choosing. Never let the model invent a recipient. | Recipient rows, network select, amount field, plain assistant message |
| First | Tool progress and assistant recovery | Reading request, checking balance, fetching fee, awaiting approval, cancelled, timed out and unavailable. Give a useful cancel/retry or manual path. Cancel inference must not imply cancellation of an already broadcast transaction. | Composer Stop, feedback panel, quiet button; mobile already has thinking/cancel/stream preview behavior |
| First | Inline transfer problem states | Expired quote, insufficient USDt, missing ETH on classic Ethereum, fee quote unavailable, unknown chain status and verified failure. Refresh quotes before approval. Unknown status offers Check status, never a blind resend. | Existing review/quote/status cards and standalone recovery screens |
| First | Blocked action reply | Payment cap, daily cap, message/payment rate limit, invalid or contract recipient, unsupported request. State the reason and a usable next step; identify caps as app limits. Do not reject unrelated read-only actions. | Context note, limits card, validation status, manual Send path |
| First | Receive/address turn | Show full address, QR, Copy and Share, selected network and compatible asset. A copied/success/failure state belongs to the same card. Scanned payment-link chain and amount are shown for checking before review. | Receive address-details, QR, network selector, camera recovery |
| First | Draft revision and historical action state | A changed draft replaces the active actionable version; old cards remain in history as superseded, expired, cancelled or submitted. A receipt opens that transaction. Repeat starts a fresh draft and review. | Existing draft/review/receipt/status cards |
| First | Model availability and management | Compatible, incompatible, compatibility unknown, insufficient storage, Wi-Fi waiting, downloading, paused, failed, installed, load failed and deleting. Show storage/model/app version. Without a usable model, hide the Chat entry and explain manual mode in one line, per the PDF. | Download progress, assistant availability/ready, settings rows, feedback panel |
| Next | Data freshness and provenance | Attach source, last update, timeframe and currency to balance, FX and market readouts. Include loading, stale, unavailable and partially available data. A missing price stays unavailable, not zero. | Existing timestamp labels, local-value Rate unavailable, Market data-state screens |
| Next | Generic market insight turns | Movers, asset facts, watchlist, two-asset comparison and sourced explanation. The same asset card receives asset identity and data rather than a separate variant per coin. Explain observed data; acknowledge when the reason for a move is unknown. | Asset row/result/detail, chart, snapshot, inline Market turns |
| Next | Conversation navigation and search | Existing Chats/Transactions history needs search, dates, pagination/load older, jump to a receipt or relevant turn, unread/new-reply indicator and return to latest. Opening history preserves the current draft. | History tabs/panel/row and shared drawer |

These should render inside the one Chat conversation. They do not require a new full-screen chat page for each request.

## What would make the app feel better

1. **A personal watchlist.** Save assets locally from Market/detail screens. Home can show two or three tracked assets; no extra composer. Use stars or a proper Hugeicons save control, not a new decorative card family.
2. **A useful market overview.** One compact market pulse, followed by saved assets and top movers. Add sort by price change, volume or market cap, and reuse the existing filter/row styles. Define each metric's period and provider.
3. **Explain this move.** From an asset/chart, open Chat with asset and timeframe attached. Render the chart plus a concise explanation and sources. If no explanatory source exists, describe the movement without inventing a cause. This is a proposed model/data capability; the mobile adapter does not support it yet.
4. **A connected transaction story.** Activity can open both the receipt and the conversation that prepared it. A recent-recipient suggestion saves typing but still produces a fresh validated draft.
5. **Calm motion.** Animate the wallet/history expansion, use brief copy feedback and reveal arriving chat cards without disruptive jumps. Preserve reading position while the user reads older messages. Respect reduced motion.
6. **Better asset identity.** Use official project logos for tokens and network brands, retaining Hugeicons for controls and a generic logo fallback. A logo is never proof that a token is authentic; network and contract identity matter.

After the payment baseline is complete: price alerts with permission controls, portfolio performance with known cost basis, multilingual typing, photo bill review and multi-step errands. Do not show operational controls for a capability whose runtime or provider is not ready.

## Competitor patterns worth adapting

- **Phantom:** interactive token charts, market cap/supply/volume and security information make asset details more useful than a price alone. Its Explore experience uses curated lists and dynamic discovery. Adapt a restrained watchlist, market facts and filters to Wally. [Token Pages](https://phantom.com/learn/blog/charts-in-phantom), [Explore](https://help.phantom.com/articles/41523165147667).
- **MetaMask:** pre-signing simulations show estimated balance changes. For Wally's current transfer scope, improve the review with amount, actual fee asset and before/after balance. A computed debit summary is not a transaction simulation or security guarantee. Simulation/security-service integration would be separate work. [Transaction simulations](https://support.metamask.io/manage-crypto/transactions/simulations/).
- **Exodus:** explicit mobile/desktop pairing is a designed flow, not an automatic consequence of responsive layouts. Its QR sync transfers encrypted secret material. Wally should preserve local-only custody/history initially; any future linking needs an explicit custody and data-sync decision. [Device sync](https://www.exodus.com/support/en/articles/8598619-how-do-i-sync-my-exodus-wallet-to-a-different-device).

## Desktop and mobile versions

One component vocabulary, information hierarchy and payment state machine; layouts adapt to the device.

| Surface | Mobile | Desktop |
| --- | --- | --- |
| Navigation | Shared drawer and Wallet/Chat toggle at the main entry. Market/detail flows retain back navigation. | Persistent shared sidebar with Wallet, Chat, Market, Activity, Address book and Settings. Recent local chats below. |
| Home | Profile wallet card, tinted attached history, inline expansion, four tool boxes; optional small watchlist. | Keep the branded wallet card at a bounded size. Put assets/recent activity alongside it and tools/watchlist below. |
| Chat | One scrollable thread. Context cards are in the thread; suggestions remain immediately above the keyboard-aware composer. | Same continuous thread in a readable central column. Optional right context panel for selected wallet/asset/receipt, collapsed at narrower widths. |
| Market | Rows/cards, full-width chart, details stacked vertically. | Sortable asset table, larger interactive chart, details beside it. Both use the same data and freshness controls. |
| Review/approval | Canonical review followed by native unlock, with PIN fallback. | Canonical review in a focused panel/dialog followed by device-appropriate unlock. Do not place an independent second Confirm beside a different copy of the draft. |
| Activity/history | Scannable rows, inline filters and full transaction detail. | Table with amount, recipient, chain, fee, time and status; detail panel and conversation link. |

Design representative mobile widths of 360, 390 and the current 440; desktop at 1280 and 1440. Keep a shared spacing scale, use content-driven height, and validate long recipient names, full addresses, large values and unavailable data. Desktop cards should not simply stretch the existing 384-pixel artwork.

Initially, desktop and mobile each have local chat/address-book/model state. Restoring the same wallet on another device does not automatically sync those records. Do not add cloud backup or silently pair devices. On-device mobile QVAC remains a runtime milestone: the current development adapter runs inference on the computer, not on the phone.

## Source-to-design gaps to address

- `mobile/src/theme.ts:3` and `:8` still use the older cobalt/Poppins system. The active WallyUI direction uses the newer light/pastel, ink/yellow language. Synchronize tokens and component usage before adding screens.
- `mobile/src/demo/model.ts:9` stores text plus an optional transfer draft. `mobile/src/screens/Chat.tsx:34` mainly renders that draft as a rich reply. Balances, receive, history and Market need typed, persisted message/card records rather than only prose.
- `mobile/src/screens/Chat.tsx:36` and `mobile/src/services/qvac.ts:93` already contain waiting/cancel and conversational streaming behavior. Design matching shared states; do not classify the behavior as wholly absent.
- `mobile/src/services/qvac.ts:3` has no Market intent; the repo has no corresponding Expo Market route in the inspected route tree. The desktop agent's price handler (`src/agent/index.ts:752`) returns text, not the full market data model pictured in Figma.
- `src/types.ts:9` has balance/address/confirmation/message events, but no generalized market/card payload. UI, validated tool data and persisted conversation records need a common contract.
- `src/agent/index.ts:242` reads ten transactions from the current session. That is narrower than the PDF's durable wallet-wide history. Do not build View all around only the current chat.
- `src/agent/index.ts:109` onward requires literal recipient addresses, while the spec and designs support local saved names. Implement deterministic address-book resolution, including ambiguous matches, before promising Send to Victor.
- `public/reach.css:220` hides the desktop chat-session sidebar below 900 pixels. The shared mobile drawer should replace it at that size; hiding navigation is not a mobile version.

## Recommended next design batch

1. Create shared adaptive clarification, tool progress/recovery, blocked-action, receive, freshness and draft-revision components. Extend existing transfer cards for every inline recovery state.
2. Build paired desktop/mobile Home, continuous Chat, Market overview and asset detail, canonical transfer review and Activity. Include Profile/Settings navigation and manual mode as the next pair.
3. Add the small watchlist, asset facts and chart-to-Chat explanation journey using those foundations.
4. Mirror each flow in its own horizontal section, with separate Desktop and Mobile rows. Keep current mobile work and archive intact while the desktop family is developed.

Acceptance: one shared menu, one continuous chat, one active actionable draft, identical review facts on both platforms, no Home composer, current Hugeicons controls, text-only primary CTAs, consistent black/yellow buttons and pastel cards, visible environment on wallet/transfer money context, truthful data freshness, and no assumed backend capability.

Accessibility checks still needed in a running build: screen-reader reading order, live-region announcements for progress/errors, keyboard/focus behavior and dialog return focus, touch targets, 200% text enlargement/reflow, small chart/meta text and contrast, reduced motion, and composer visibility with the native keyboard. Screenshots cannot prove those behaviors.
