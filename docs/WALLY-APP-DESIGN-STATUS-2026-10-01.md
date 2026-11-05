# Wally app design sweep - 1 October 2026

The [WallyUI Figma file](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=0-1) is one app. Its App page contains active [Wallet](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=243-1684) and [Market](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=251-2613) sections. The user's scope decision keeps Market active even though the feature PDF originally deferred price lookups. Exchange and multiple-wallet explorations are outside the active app.

## Saved in Figma

- Moved Quiet Wallet, the multiwallet/exchange exploration, and the CryptoX reference to [Archive - Prior explorations](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=269-2702). Active prototype links no longer point into Archive.
- Kept the current Wallet and Market screen sections on App without V1/Future labels.
- Added Market to both Wallet menus. The contextual [Chat home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=244-2861) now uses a reusable colored two-network wallet slider, has four action suggestions, and links View market to Market.
- Replaced setup/preview copy on 17 Wallet screens with product-facing copy, including onboarding, testnet receive, recovery, recipient entry, amount, review, and receipts. Security and testnet warnings remain where relevant.
- Designed a loaded [mainnet home](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=245-2683), usable [limits](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=247-2548), populated Activity, and six focused mainnet send screens from recipient through confirmed receipt.
- On 2 October, connected the mainnet Send path, its back/edit/cancel actions, and the pending/confirmed next actions. The path now reaches the confirmed receipt from the Wallet home.
- Reworked all five Market asset details: their buttons open Wallet, and the active Market screens no longer show sample, illustrative, or exchange copy. Updated the matching component defaults.
- Created the reusable [on-device approval component](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=313-2197) with the Hugeicons fingerprint-check icon and editable amount, recipient, network, and fee-inclusive total. Both testnet and mainnet approval screens use instances.
- Replaced placeholder labels on the three remaining Receive variants with network-specific receiving instructions, address labels, and Copy/Share actions. Corrected the mainnet Activity received icon and divider alignment.

## Remaining before this is a finished prototype

1. Make the Receive QR artwork data-driven so it always encodes the displayed, device-derived address for the selected network. The current artwork is static Figma illustration; the Copy/Share actions are prototype affordances.
2. Review focused navigation on send review/status/receipt screens that still show the Wallet/Chat switch. Keep contextual chat where it helps without letting a toggle obscure the task.
3. Inspect orphaned error/offline states and trigger them from meaningful actions, or move unused states to Archive. Recheck every active screen and prototype link after wiring.
4. Confirm the product's sending-cap amounts; the shown values are design examples until validated.

Figma's Education-plan MCP call limit stopped editing on 1 October 2026, then access resumed on 2 October. The remaining items above are not complete. No live wallet behavior, prices, QR generation, secure signing, or chain verification is established by these Figma screens.
