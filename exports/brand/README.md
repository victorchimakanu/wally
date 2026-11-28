# Wally brand files

The mark is a ring: a soft W drawn as one closed shape with eight rounded corners and a thick
stroke, so it reads as a wallet and as a w. The wordmark is "wally", outlined. Everything is one
colour: midnight `#0B1630` on paper, paper on midnight.

## Source of truth

The WallyUI Figma file, frame `941:27423` ("Frame 2"):

| Node | What it is |
|---|---|
| `941:27427` | The ring: a native vector, 8 corner vertices with corner radius 42.9, stroke 50 centred, round joins, no fill. Edit this one; the radii and stroke weight are live. |
| `941:27437` | The wordmark, already outlined. |

The brand components in the "Brand · Wally logo (final)" section (`brand/mark`, `brand/lockup`,
`brand/app-icon` and the export frames) are built from those two nodes with the stroke outlined.

## Files

| File | Use |
|---|---|
| `wally-lockup-light.svg`, `wally-lockup-dark.svg` | Ring plus wordmark, midnight / paper. Copies live in `mobile/assets/wallyui/`. |
| `wally-mark-paper.svg` | The ring in midnight, for paper backgrounds. |
| `wally-mark-midnight.svg` | The ring in paper, for midnight backgrounds. |
| `wally-mark-mono.svg` | The ring in black, for one-colour reproduction. |
| `app-icons/` | `icon.png` 1024, `favicon.png` 48, `android-icon-foreground.png` 512, `android-icon-monochrome.png` 432, `splash-icon.png` 1024, `android-icon-background.png` 512 (plain midnight). Copies live in `mobile/assets/`. |

The lockup keeps the arrangement from the Figma frame: ring box 363.27 × 273.36, wordmark
667.37 × 263.41 placed at (427.28, 12.70), total 1094.65 × 276.11. The 64 units between the
ring and the word are deliberate; closer and the two read as one shape.

## Regenerating

1. In Figma, duplicate `941:27427`, run Outline Stroke on the copy, and export it and `941:27437`
   as SVG. Replace the paths in the five SVGs above (the lockup translates the wordmark by
   427.28, 12.70). Run `node mobile/scripts/catalog-figma-assets.mjs` from `mobile/` so the asset
   registry picks up any size change.
2. Icons: `python exports/brand/make-icons.py DIR` writes one HTML page per PNG into `DIR`, then
   render each with a headless Chromium at the page's size:

       chrome --headless --hide-scrollbars --default-background-color=00000000 \
              --window-size=1024,1024 --screenshot=icon.png file:///DIR/icon.html

   The ring is centred; it is symmetric, so no optical offset. The Android foreground and
   monochrome layers are sized to stay inside the 66 dp safe circle.
