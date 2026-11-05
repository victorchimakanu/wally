# Wally recommendations — implementation status
Date: 7 October 2026

The design changes are saved on the App page in WallyUI. Existing wallet artwork and shared button components were reused. The source app code was not changed.

## Added in Figma

- Paired desktop/mobile Home, continuous Chat, Market, Asset detail, Review, Activity, Profile and Settings.
- Additional asset examples for Ethereum, Solana, Tether USDt and XRP, with matching labels, prices and logos.
- Recipient, amount and network clarification; tool progress and recovery; quote expiry, insufficient funds and missing ETH; transfer guards; receive cards; superseded drafts.
- Ethereum-specific draft, review, signing, submitted and receive-gas states.
- Searchable saved chat/transaction history and older history controls.
- Market pulse, watchlist, asset facts, freshness states, sorting, sample search and chart-to-chat cards.
- Assistant compatibility, download, pause, failure, ready and removal states; manual wallet Home on both layouts.
- Shared desktop sidebar, transaction filters, receipt selection and device approval overlays.
- Swappable chart timeframe buttons and saved-asset buttons.

Chat remains one message stream. Contextual cards append inside that stream. Home uses the Wallet/Chat toggle. Market uses back/title navigation. Victor, Emmy and Daniel are the demo names.

## Review links

- [Core Home pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9355)
- [Continuous Chat pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9356)
- [Market pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9357)
- [Asset examples](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9358)
- [Review pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9359)
- [Activity pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9360)
- [Profile pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9361)
- [Settings pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9362)
- [Manual wallet pair](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=757-14962)
- [Reusable component library](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=725-9354)
- [Contextual Chat variants](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=763-15950)

## Verification and remaining work

Screenshots were reviewed for desktop Chat, desktop Market, desktop Settings, mobile Asset detail, mobile Review and narrow Home. The Settings state defaults, security icon contrast, selected asset labels and Review/composer overlap were corrected and recaptured.

Figma then returned: “You've reached the Figma MCP tool call limit on the Education plan.” The final repair request was blocked. Two attempts to initialize browser editing also failed because the browser kernel could not write its assets.

The design batch is not fully polished or fully prototype-tested:

1. The 360/390 mobile Home and 1280 desktop Home checks have clipped wallet artwork and stretched icons. Do not treat these narrow variants as approved.
2. Some asset context captions still mention Bitcoin on another asset.
3. Market table headings need alignment and its freshness footer should fit the initial desktop viewport.
4. Desktop “Ask Wally about this move” actions need the selected asset context, rather than only navigation.
5. A few Settings/Profile links still open earlier mobile screens from desktop.
6. Native continuous-chat scroll destinations need checking on the new desktop frame.
7. Saved buttons show saved state; a shared watchlist update has not been verified.
8. Full roundtrip prototype testing and the remaining screen captures are outstanding.

A pending Figma repair script is saved as `fix-wally-final-polish.figma.js`. It has not been executed successfully. It addresses items 1–4; items 5–8 still require work.

Sample financial values are illustrative. Figma interactions do not perform transfers, query prices, store history or download a model. No swaps, fiat purchase/off-ramp, alerts or voice features were added in this batch.

