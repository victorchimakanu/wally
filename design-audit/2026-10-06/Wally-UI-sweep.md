# Wally UI sweep — 6 October 2026

The sweep covered the 69 existing active screens and added three screens for the address-book overview and its add/save return path. The current set contains **72 screens in 20 flows**.

The active scope follows your decisions in this conversation: Wallet and Market belong in the app, the latest Home card remains the source component, and obsolete exchange/setup explorations belong in Archive.

## Changes applied in Figma

- Standardized **69 secondary-screen headers** around the shared back navigation component. Removed Wallet/Chat switches from those screens and hid unwired overflow controls. Home retains its own navigation.
- Replaced standalone text-symbol icons and inline arrow/check characters with proper reusable icons. Used the supplied **Hugeicons library**, including Pro assets. Fixed icon scaling so small icons fit their containers.
- Replaced **20 hand-built actions** with shared buttons. Primary actions use black or yellow and remain icon-free. Disabled and outline treatments are consistent.
- Reused existing text-field components for recipient names, full addresses and search. Added a shared amount-entry component with normal/error states.
- Added or consolidated shared available-balance, fee, matched-recipient, network-confirmation, recipient-list, saved-success and contact-detail cards. Card data is editable through component properties.
- Unified all four receive screens around a shared network selector and address panel. Replaced decorative QR patterns with QR assets encoding the same demo addresses displayed on screen. These are address payloads; the sender still needs the selected network.
- Reused the wallet card and bottom-anchored composer for offline state. Send remains disabled; Receive and saved Activity remain available.
- Consolidated Settings into the existing reusable row component. Removed chevrons from rows that only display information.
- Kept avatar → Profile, history → Activity, card → inline wallet list, and Home → Market/Trends routes. Preserved the contextual composer’s click/press/keyboard state transitions.
- Added [Address book overview](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=504-4368), with shared recipient rows and full demo addresses. Profile and Settings open this overview. Its reused add/save screens return to the overview instead of sending users into the transfer flow.
- Preserved the separate transfer-origin recipient-save path. Updated remaining old demo-name copy to Victor, Emmy and Daniel.
- Moved **eight unused canvas samples/setup elements** into the existing Archive page. Existing component references were preserved.
- Kept each flow on one horizontal row and retained the current wallet palette.

## Reusable components

| Component | Figma source |
|---|---|
| Wallet card and history | [wallet/card](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=74-101) |
| Button family | [button](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=110-507) |
| Screen header | [navigation/header](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=234-1620) |
| Contextual suggestions and composer | [chat/context-dock](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=324-2357) |
| Amount entry | [form/amount-entry](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=482-4018) |
| Recipient text/search fields | [form/text-field](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=149-913) |
| Inline link | [action/text-link](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=490-4090) |
| Address validation status | [form/validation-status](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=490-4114) |
| Receive network selector | [network/receive-selector](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=491-4129) |
| Receive address panel | [receive/address-details](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=492-4144) |
| Available balance | [transfer/available-balance](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=498-4337) |
| Fee estimate | [transfer/fee-summary](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=498-4361) |
| Matched contact | [recipient/matched-contact](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=498-4388) |
| Confirm-network notice | [notice/confirm-network](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=498-4403) |
| Network field | [form/network-select](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=498-4412) |
| Recipient row | [recipient/list-row](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=505-4398) |
| Recipient saved state | [recipient/save-success](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=513-4524) |
| Saved contact details | [recipient/contact-details](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=513-4545) |
| Settings/profile rows | [profile/settings-row](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=412-2897) |
| Market result and logo swap | [market/asset-result](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=228-1461) |
| Market detail content | [market/asset-detail-content](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=228-1471) |

Asset logos remain swappable so database-provided assets can replace the demo assets. Bitcoin and Ethereum use supplied Hugeicons artwork. XRP uses the [XRP asset from the XRPL documentation](https://xrpl.org/docs/introduction/what-is-xrp); Solana uses the [Solana Labs token-registry asset](https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png). The generic fallback component remains available for missing logos.

## Flow-by-flow review

“Next” describes screens or states to add or reuse, not work already implemented. Source screenshots show the starting UI; representative final screenshots follow below.

| Flow | Screens now | Applied/reused | Next | Before evidence |
|---|---:|---|---|---|
| [Create wallet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2708) | 4 | Shared back/progress header, proper security icons and component buttons. | Reuse lock UI for cancelled/unavailable authentication and passcode fallback. | [01-create-wallet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/01-create-wallet.png>) |
| [Restore wallet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2709) | 2 | Valid/invalid restore states retain their validation; standard navigation and actions. | Add keyboard and longer-phrase layouts if supported by the wallet. | [02-restore-wallet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/02-restore-wallet.png>) |
| [Home · Wallets & discovery ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=411-2886) | 2 | Latest wallet card, avatar, history, inline wallet list, Market/Trends and nearby suggestions retained. Menu now uses Hugeicons. | Add first-use/empty wallet and data-loading states using the same card. | [03-home](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/03-home.png>) |
| [Profile · Preferences ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=411-2887) | 2 | Shared avatar, fields and settings rows; Address book opens its overview. | Add a focused country/currency selector; Local currency currently uses Edit profile. | [04-profile](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/04-profile.png>) |
| [Wallet · Testnet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2710) | 3 | Wallet card reused for offline balance; disabled Send and available Receive/Activity preserved; environment shown inline. | Keep stale balance/time explicit when cached data exists. | [05-wallet-testnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/05-wallet-testnet.png>) |
| [Wallet · Mainnet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2711) | 4 | Same navigation, card and black/yellow controls as testnet; explicit mode switch retained. | Reuse offline state with mainnet context. | [06-wallet-mainnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/06-wallet-mainnet.png>) |
| [Chat · Prepare a transfer ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2712) | 1 | Contextual composer and suggestions retained; current draft remains a reviewable transfer. | Add ambiguous recipient, unsupported request and interrupted conversation states. | [07-chat](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/07-chat.png>) |
| [Assistant · Download ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2713) | 2 | Download/setup actions share the button system; normal wallet use remains represented. | Add failed download, pause/retry and completed download states. | [08-assistant](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/08-assistant.png>) |
| [Send · Testnet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2714) | 16 | Recipient/amount fields, balance/fee cards, validation, review, signing and chain status are aligned. | Reuse existing expired/unknown/failed status patterns across environments. | [09-send-testnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/09-send-testnet.png>) |
| [Send · Mainnet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2715) | 6 | Same fields, quote/review/signing components and icon-free actions as testnet. | Add expired quote, insufficient balance, unknown status and failed transfer states by reusing testnet components. | [10-send-mainnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/10-send-mainnet.png>) |
| [Receive · Testnet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2716) | 2 | Shared network selector/address panel; QR assets encode the displayed demo addresses. | Add QR-loading and copy/share feedback; native clipboard/share behavior needs implementation. | [11-receive-testnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/11-receive-testnet.png>) |
| [Receive · Mainnet ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2717) | 2 | Same receive controls, QR styling and network warnings as testnet. | Reuse the same loading/error/feedback states with mainnet context. | [12-receive-mainnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/12-receive-mainnet.png>) |
| [Activity · Testnet receipts ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2718) | 3 | Shared feed/receipt components, common header and correct receipt return path. | Add empty, loading, offline-cache and failed-refresh states. | [13-activity-testnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/13-activity-testnet.png>) |
| [Activity · Mainnet receipts ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=425-3374) | 2 | Shared feed/receipt structure and mainnet destinations retained. | Reuse Activity states with environment-specific data. | [14-activity-mainnet](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/14-activity-mainnet.png>) |
| [Address book · Manage & save ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2719) | 6 | New overview plus reused add/save screens return to the overview. Transfer-origin save path stays separate. Shared recipient/success/detail cards. | Add contact edit/delete and empty/no-results states if included in product scope. | [15-address-book](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/15-address-book.png>) |
| [Settings · Recovery phrase ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2720) | 3 | Seven rows now reuse one component. Static information has no misleading chevron; recovery remains gated by unlock. | Add actual App lock settings and authentication fallback/error screens. | [16-settings](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/16-settings.png>) |
| [Market · Browse ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2721) | 3 | Common market navigation, reusable asset rows, proper adaptive crypto logos and consistent action styling. | Add loading, stale/offline and failed-refresh states; define currency preference behavior. | [17-market-browse](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/17-market-browse.png>) |
| [Market · Trends ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=411-2888) | 1 | Trends remains reachable from Home/Market and reuses asset components. | Add no-data and loading states; support the same display-currency policy. | [18-trends](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/18-trends.png>) |
| [Market · Search ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2722) | 3 | Empty, results and no-results screens retained; asset result logo remains swappable; inline glyph arrow replaced. | Add searching/loading and request failure states. | [19-market-search](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/19-market-search.png>) |
| [Market · Asset details ](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2723) | 5 | Five assets reuse detail content and adaptive logos; primary action styling unified. | Add chart loading/unavailable states and long-name/price layouts. | [20-market-details](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/20-market-details.png>) |

## Suggested next screens

| Priority | Add or reuse | Existing components to reuse | Purpose |
|---|---|---|---|
| P1 | Security settings; biometric cancelled/unavailable; PIN/passcode fallback | Create-wallet lock screen, device-approval card, fields and buttons | Make App security and App lock complete journeys, including unsuccessful authentication. |
| P1 | Mainnet quote-expired, insufficient-balance, status-unknown and transfer-failed states | Existing testnet quote, review, amount-error, status and receipt components | Match testnet coverage without designing a second visual system. |
| P1 | Camera denied/unavailable and invalid/unsupported QR | Camera permission screen, notice, pasted-address field | Keep manual address entry reachable when scanning cannot continue. |
| P2 | Country/display-currency selector | Edit-profile fields, existing local-value card and Hugeicons info icon | Reduce steps from Profile and clarify whether NGN preference changes Market prices or adds a secondary local value. Current Market explicitly labels USD. |
| P2 | Activity empty/loading/offline and Market loading/stale/error | Activity rows, history loading state, market rows/results, notice and retry button | Make database/network conditions coherent across balances, history and market views. |
| P2 | Contact details/edit and address-book empty/no-results | Recipient row, text fields, network field, save-success and contact-details cards | Extend the new overview when editing/removal and contact search are required. |

## Final visual evidence

| Screen | Screenshot |
|---|---|
| Home | [home](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/home.png>) |
| Offline wallet | [offline](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/offline.png>) |
| Profile | [profile](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/profile.png>) |
| Settings | [settings](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/settings.png>) |
| Review transfer | [review](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/review.png>) |
| Device approval | [approval](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/approval.png>) |
| Confirmed transfer | [confirmed](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/confirmed.png>) |
| Receive | [receive](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/receive.png>) |
| Market | [market](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/market.png>) |
| Address-book overview | [address-book](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/address-book.png>) |
| Address-book save confirmation | [address-book-saved](<C:/Users/kfdos/Desktop/Web Projects/wally/design-audit/2026-10-06/after/address-book-saved.png>) |

## Verification and limits

The final structure check covered every active screen. It found:

- 72 active screen frames and 20 flow sections.
- 69 shared secondary-navigation instances.
- All flows arranged on one row, without overlapping screen frames.
- No missing prototype destination nodes.
- No active arrow/check text-symbol icons.
- No visible button-icon overrides in the standard button family.
- No remaining Sam, Taylor or Mira demo-name text.
- No loose canvas samples outside the design-system components and flow sections.

All 20 starting flow captures were inspected, with additional crops for long flows. Representative modified screens were visually checked again. The shared bottom chat anchor aligns the expanded composer within the screen, and the Figma interaction definitions include click, press and keyboard triggers.

This is a **Figma design and prototype-structure audit**. Native keyboard entry, biometrics, clipboard/share, database fetches, live prices, wallet signing and chain submission were not exercised. Demo amounts, contacts and addresses remain illustrative. The proposed states above are the remaining design coverage to add.

Sources: [WallyUI](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=0-1), [supplied Hugeicons library](https://www.figma.com/design/NoKfYtsDdpc9ffdugTYvrr/Huge-Icons-Library--Community-?node-id=0-1).
