# Wally tablet views
Date: 7 October 2026

Added 26 tablet frames to the App page in WallyUI, grouped one flow per horizontal section. Existing mobile and desktop core screens remain in their original sections.

## Sizes and layout
- Portrait: 768 × 1024, 40 px content margins.
- Landscape: 1024 × 768, 88 px shared navigation rail, 32 px content offset from the rail.
- Content begins at 128 px; major sections use 24 px spacing.
- The wallet artwork stays 384 px wide. Icons keep their native proportions.
- Home uses the Wallet/Chat toggle and has no composer.
- Chat stays one continuous, scrollable message stream with contextual suggestions beside the field.
- Market uses back/title navigation. Landscape places pulse and search/sort side by side.
- Landscape asset details show chart/actions and facts side by side.

## Flow links
- [Home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16674)
- [Chat](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16675)
- [Market](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16676)
- [Asset](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16677)
- [Review](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16678)
- [Activity](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16679)
- [Profile](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16680)
- [Settings](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16681)
- [Manual](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=774-16682)

## Assets
Bitcoin, Ethereum, Solana, Tether USDt and XRP each have portrait and landscape detail frames. The logo, title, pair, price and facts match the selected sample asset.

## Reuse
Canonical wallet card, attached tinted history, quick tools, text-only black/yellow buttons, Hugeicons, transaction rows, signing/review/receipt cards, profile rows and assistant model states were reused. Added tablet top bar, rail, adaptive market table, landscape chart, 45 context variants for each tablet composer and shared overlay layouts.

## Verification
Screenshots were visually reviewed across the nine core flows and selected additional assets. Repaired landscape chart overflow, clipped chart actions, suggestion dividers, composer height, Activity row spacing, search height and settings chevron bounds. All 26 frame dimensions and horizontal fit were checked. Native Chat counter conditions were inspected after Figma timed out during a large prototype update.

Main navigation, quick tools, market asset links, receipt selection, profile/settings links and assistant removal have tablet destinations. Prototype wiring was inspected; a complete interactive roundtrip was not run. Some secondary settings controls and assistant-install/recovery routes reuse existing demo behavior and have not been exercised end to end. The recovery phrase is masked; its biometric/PIN controls are visual design states.

Financial values and charts are sample data. This batch edits Figma designs; it does not implement database fetching, transfers or model downloads.

