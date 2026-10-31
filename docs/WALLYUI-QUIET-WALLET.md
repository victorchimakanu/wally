# WallyUI · Quiet Wallet

Created 29 September 2026 in the [WallyUI Figma file](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=24-19).

- [Design board](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=24-19)
- [Prototype from Wallet](https://www.figma.com/proto/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=24-23&starting-point-node-id=24%3A23)
- [Prototype from Ask](https://www.figma.com/proto/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=24-25&starting-point-node-id=24%3A25)

This is a separate, editable light direction in the same Figma page as the original Landing frame and dark design-system sheet. It contains sixteen 440 × 956 Android screens. Local Quiet Light color variables and Inter type styles support iteration.

The three supplied mobile screenshots inform the calm white canvas, compact Wallet/Ask switch, plain-text assistant replies, pale user bubbles, anchored composer, keyboard-open state, and slide-out navigation. Wally's original wordmark and robot mark come from exports/wally-wordmark.svg and exports/wally-logo.svg. The existing design sheet contributes cobalt #4766F9; green and orange are small brand accents. This is an adaptation for Wally, not a copy of ChatGPT controls: unsupported voice, model-selection, app-inbox, and reaction actions were omitted.

## Screen map

1. Wallet overview
2. Open Ask canvas
3. Keyboard-open Ask composer
4. Balance conversation
5. Unsigned transfer draft
6. Full transfer review
7. Submitted, awaiting network confirmation
8. Network-confirmed receipt
9. Receive USDT
10. Wallet activity
11. Optional on-device AI setup
12. Offline, unsigned draft
13. Navigation and local conversation drawer
14. Manual send
15. Model download progress
16. Settings and security

The prototype connects the primary journeys and has Wallet, Ask, and Offline starting points. Both manual and assisted send converge on the same review. That review shows the complete recipient address, Arbitrum network, amount, estimated native-network fee, total debit, and quote expiry before an explicit device confirmation. Submitted and confirmed remain separate states. Offline chat only saves an unsigned draft after a model has been installed; it cannot fetch live balances or fees, broadcast, or auto-send after reconnection. Wallet controls remain usable without AI. Chain activity and local conversations have distinct destinations.

## Fidelity and limits

The repository's mobile/ directory is an Expo preview with scripted fixtures. These Figma screens do not sign, download a model, fetch chain data, copy an address, or verify settlement. The shown balances, addresses, fees, receipts, and download percentage are visual examples. The receive QR is deliberately non-scannable and the address is labeled as a sample. Actual Android WDK/QVAC integration and device performance remain unverified.

## Crypto transfer flow · 1 October 2026

- [Dedicated 16-screen transfer board](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=164-672)
- [Clickable prototype from Send](https://www.figma.com/proto/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=164-676&starting-point-node-id=164%3A676)

The light visual language now has a complete USDT-on-Arbitrum transfer journey. The main path covers Send entry, full recipient address, address format check, amount, live review quote, explicit device approval, submission, and confirmation. Separate frames cover an incomplete address, insufficient balance, expired quote, submitted-but-unverified status, verified failure, offline unsigned draft, a chat-prepared draft, and activity history. These are alternate states and sample history, not sequential outcomes of one transaction.

The existing Wallet send button opens the new entry. Chat-assisted drafts and the manual form open the same new review; the older broad transfer screens remain on the original board as earlier exploration. The prototype links the main path and recovery choices. An uncertain broadcast status explicitly prevents an automatic resend. Verified failure starts a fresh review. Offline drafts never quote or submit; reconnecting requires a new quote and a new user decision.

The mobile preview currently simulates only Arbitrum USDT and uses fictional data: 1,250.00 USDT starting balance, 25.00 USDT example amount, 0.02 USDT preview fee, 25.02 USDT preview debit, a 60-second quote, and a sample full address. The new review uses these figures to match the preview. Production fee currency and amount must come from the actual account and network quote; USDT fee payment is conditional on a configured smart-account paymaster, while classic accounts need native gas. No live signing, broadcasting, transaction hash, or explorer link is represented as implemented.

## Iconography · 1 October 2026

The crypto transfer screens now use selected editable vectors from the MIT-licensed Hugeicons Free Stroke Rounded set. They replace placeholder glyphs for address, network, approval, expiry, transfer outcomes, offline, and activity, and now appear inside the primary, outlined, and disabled transfer buttons. See [the Hugeicons notice](HUGEICONS-LICENSE.md) for the exact source and license. The linked Hugeicons Pro Figma file was used only as visual reference; its Pro components were not imported.

The [shared button component set](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=110-507) now defaults to a Hugeicons Free up-right arrow. All 112 variants retain their icon-swap and label properties, and each icon matches its button's text colour. A separate quiet secondary button has default and disabled variants with editable labels and icons; an icon-only button supplies the circular back control. The transfer flow uses those components for its seven secondary actions and sixteen back controls, preserving their prototype destinations.

The [wallet carousel](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=82-222) now demonstrates a varied card palette: lilac for Personal, sky for Trading, and coral for Savings. Each wallet keeps its colour across carousel selection states; the Personal card on Wallet home uses the same lilac. Dark ink text and subtle rings maintain contrast. Carousel Send actions use the existing amber primary button and open the transfer entry; Activity actions use the ink-black primary button and open activity.

