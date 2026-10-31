# Wally — next screens implemented

6 October 2026. This continues the earlier UI sweep. The active Figma file now has **110 screens in 28 flow rows**, including **38 new screens/states**.

## Home and Chat

Both Home states have no chat composer or suggestions. The shared Wallet/Chat toggle has 125 × 58 touch targets and opens the new Chat landing screen. The latest wallet card, inline wallet list, avatar → Profile, history → Activity, Market and Trends remain.

- [Home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=244-2861)
- [Chat landing](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=524-4560)

The contextual chat dock uses bottom-aligned layout. Its focused composer ends at the same bottom edge, and suggestions move up with the expanded field. Removed inherited placeholder actions that navigated Home instead of expanding in place.

## Added screens

| Flow | New screens/states | Figma |
|---|---:|---|
| Chat entry | 1 | [Start & prepare](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2712) |
| Mainnet transfer recovery | 4 | [Send · Mainnet](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2715) |
| App security and PIN change | 8 | [Security](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-4689) |
| Cancelled approval and PIN signing, both environments | 4 | [Authentication fallback](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=546-6919) |
| Recovery phrase PIN unlock | 1 | [Recovery](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=345-2720) |
| Camera denied/unavailable and unsupported QR | 3 | [Scan recovery](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-5070) |
| Country and display currency | 2 | [Country & currency](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-5299) |
| Activity loading, empty, offline and refresh failure, both environments | 8 | [Testnet states](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-5452), [Mainnet states](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-5757) |
| Market loading, offline prices and failed fetch | 3 | [Market states](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-6062) |
| Adaptive recipient details/edit and empty/no-results address book | 4 | [Recipient flow](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=528-6291) |

## Consistency and prototype details

- Reused navigation, black/yellow icon-free buttons, fields, quote/review/status cards, activity feeds, wallet cards and asset rows.
- Added reusable feedback panel, selection row, country/currency selection menus, Home/Chat toggle and biometric switch. Icons use the existing Hugeicons assets.
- Matched heading/body typography to the existing Market, Activity and Address-book flows. Each flow remains on one horizontal row with a dedicated section.
- Currency selections save back to the Profile prototype. Market explicitly retains USD prices; local equivalents remain estimates.
- One details/edit layout adapts to Victor, Emmy and Daniel through prototype variables.
- Separate PIN screens return to transfer signing, recovery phrase reveal or PIN change, according to their origin.
- Mainnet Max preserves 249.82 USDt through review, approval and receipt, with a 0.18 USDt fee and a 250.00 USDt total. Starting another send resets the demo amount.
- Loading states return to normal data; retry actions open loading. Cached Activity remains scrollable and shows its freshness.

## Verification

The final check found 110 screens, 28 flows, and 103 prototype destination nodes. All destinations exist. No empty screen frames, visible text-symbol icons, visible primary-button icons, out-of-bounds top-level text, or overlapping flow frames were found. Both Home states have zero visible composers.

Screens from each new flow were visually inspected. A focused chat instance was checked at 400 × 118; its bottom stayed within the 400 × 238 dock. Temporary verification nodes were removed.

These are Figma designs and prototype definitions. Native authentication, text input, database requests, currency conversion and chain submission were not executed.

