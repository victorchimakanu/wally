# Wally consistency sweep — 7 October 2026

Implemented in the WallyUI Figma file. This is a visual consistency sweep; it does not certify every prototype journey or production behavior.

[Highlighted originals](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=809-29673) · [Corrected desktop Home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=764-16448) · [Corrected 360 Home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=764-16264) · [Corrected 390 Home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=764-16073)

## Findings and fixes

| Finding | Implemented correction |
| --- | --- |
| Recent activity icons stretched horizontally on 1280 Home | Restored fixed 32 × 32 icons; recipient text fills the row and amount/date retains a fixed width. |
| BTC/ETH watchlist marks became ovals on 360/390/1280 Home | Restored fixed 40 × 40 logos and fixed value columns. |
| View-all arrow expanded across the watchlist row | Restored fixed 20 × 20 icon; only the label expands. |
| Sidebar wordmark and profile photo distorted at 1280 | Restored wordmark proportions and square 40 × 40 avatar. |
| Wallet art clipped or overlapped the adjacent panel | Kept the full 384-wide desktop wallet; adapted compact mobile instances proportionally. The desktop right panel now fills the remaining space with a 24 gap. |
| Currency and network labels wrapped after compact resizing | Recalculated single-line text width and retained a minimum 12 font size for small wallet labels. |
| Profile/settings chevrons and Market dropdown had unequal width/height | Corrected the shared component icon slots to 20 × 20. |
| Market headings did not align with data | Matched header column geometry to the shared table row. Reduced section gaps to 16 so the source footer fits the initial desktop viewport. |
| Other asset pages still used Bitcoin-specific captions | Updated 10 desktop/mobile caption instances to neutral USDt wallet wording. |
| Incoming activity used the Send symbol | Updated the Received row variant to the proper Hugeicons Receive symbol and synchronized existing instances. |
| Max and Add controls had padding larger than their compact height | Corrected source padding across the older transfer forms. |
| Reused rows exceeded bordered containers slightly | Set appropriate layout rows to fill their parent content width; icon/avatar slots stay fixed. Includes navigation, tables, manual overlays and model actions. |
| Quick-tool masters were shorter than their content | Set card and text containers to fit their content; default cards resolve to 104 high. |

## Verification

- Inspected 191 product frames and overlays across original flows, desktop/mobile additions and tablet views.
- Checked 1,050 visible icon/logo instances against their source proportions.
- Final automated check: zero distorted graphics; zero horizontal or vertical auto-layout content overflow above the 2.1 tolerance.
- Visually inspected corrected desktop Home, both narrow Home widths, desktop/tablet Market, tablet Profile and the transfer amount control.
- Preserved three detached before frames in a separate reference section, with 18 red issue outlines. They are outside the active product flows and contain no prototype actions.

The geometry check excludes intentionally positioned wallet artwork and content inside scrolling viewports. Prototype actions and conditional states were preserved; a full interactive journey test was not part of this visual sweep.

## Sizing rule to preserve

Allow text and layout containers to fill available width. Keep icons, coin logos and avatars fixed and square. Scale artwork proportionally; resizing only its width creates the distortion shown in the original screenshot.
