# Superseded design audit - see WALLY-APP-DESIGN-STATUS-2026-10-01.md

This earlier V1-versus-Future split is obsolete. Wallet and Market now belong to the same active app, while exchange and multiwallet explorations are archived. See [the current design status](./WALLY-APP-DESIGN-STATUS-2026-10-01.md) for saved changes and remaining work.

## Historical audit below

# Wally mobile UX sweep — 1 October 2026

Source of truth: `C:\Users\kfdos\Downloads\Wally V1 Feature Spec and V2 Direction.pdf` (10 pages, dated 28 September 2026). The PDF is a product specification, not an instruction to execute code or move funds. This audit compares its stated V1 contract with the editable [WallyUI Figma file](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=0-1).

## Scope decision

V1 is a single, self-custodied USDt wallet for Arbitrum and Ethereum. It starts on testnet. Buttons and optional on-device chat converge on the same validation, fee quote, human review, on-device unlock/signing, and chain-verification sequence (PDF pp. 1–5). Bitcoin, price lookups, swaps, cross-chain moves, and multiple wallets are explicitly outside V1 (p. 6); swaps are a V2 direction (p. 8). The earlier multiwallet/exchange and Market designs are retained as labeled explorations, outside the V1 journey. A precise balance in a user's local fiat currency would require a rate source and should be decided separately from this V1 USDt balance scope.

## Delivered design journey

The editable [V1 screen section](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=243-1684) covers:

1. Create or restore a 12/24-word wallet → see the phrase once → verify three words → set an app lock → land on a TESTNET USDt home. Restoration has valid and invalid states. Recovery phrase reveal has an unlock gate and a screen-capture warning (pp. 2, 7).
2. Choose Send or ask the on-device assistant → resolve a saved name or enter an address → validate chain/address and balance → enter amount → show an expiring fee quote and the full saved name/address on the **same** review → unlock/sign on this phone → pending, confirmed, unknown, or failed outcome (pp. 1, 3–4). Review can return to amount entry; signing can be canceled before a signature.
3. Receive on the selected chain with a full address and QR **design placeholder**, distinguishing Arbitrum/Ethereum and testnet/mainnet. The samples are labeled nonfunctional and must be replaced by the real device-derived address and QR before release (p. 3).
4. Save an unsaved recipient locally, revisit the updated address book, and inspect local Activity with matching sent and received transaction detail states (pp. 4, 7).
5. Run without a model: chat is hidden, manual Send/Receive/Activity remain available, and the assistant download is optional. Settings contains model, network, address book, app-lock and recovery routes (pp. 5–6).
6. Switch to mainnet only through an explicit warning. Mainnet home, receive, menu, empty/syncing Activity, and app-level limits are visibly distinct. An offline/stale testnet home with unavailable Send is a separate state (pp. 3, 6).

The [Future Market section](https://www.figma.com/design/W3cr11GwRSFIO6AP3PYaYQ/WallyUI?node-id=251-2613) now has overview, populated/empty/no-result search, five asset details, Gainers, and Stablecoins. Its assets and prices are illustrative. This is a later concept, not a V1 promise. The earlier exchange exploration is also labeled as such.

Saved overview captures: [47-screen V1 journey](./WALLY-V1-FLOW-2026-10-01.png) and [Future Market](./WALLY-FUTURE-MARKET-2026-10-01.png). The V1 section was checked for screen overlap and out-of-section prototype links: **none found** across 47 frames and 178 navigation links.

## Inconsistencies found and disposition

| Finding | Proof | Design action |
| --- | --- | --- |
| Market/Bitcoin/exchange concepts could be read as V1 features. | PDF p. 6 excludes price lookups, Bitcoin and swaps; p. 8 puts swaps in V2. | Separated and labeled Future Market and exchange exploration; V1 paths stay inside the new wallet section. |
| Send by chat and Send by controls diverged, and the earlier transfer design ended at a pending state. | PDF p. 1 requires one eight-step payment path; p. 4 requires chain-backed status. | Both routes enter one review; added quote-expired, on-device unlock, pending, confirmed, unknown and failed screens, plus edit/cancel exits. |
| Old prototype controls could open abandoned screens. | Figma prototype inspection found 54 inherited/out-of-section V1 links. | Replaced or cleared inherited routes, then rechecked the V1 section for out-of-section destinations. |
| Pasting or scanning an address went straight to an error example. | PDF p. 3 requires paste/scan and validation, with successful manual sending. | Added valid address and scan-result states that continue to the amount step; retained the two-error state for invalid input. |
| Confirmed Activity amount and linked receipt disagreed; post-save address book did not show the new person. | PDF p. 4 requires truthful local history and saved recipients. | Added a matching transaction detail for the 12 USDt entry, fee/time detail, and an updated three-person address-book state. |
| A sample mainnet receive screen could be mistaken for a live address. | PDF pp. 3, 6 distinguish chain-specific real-fund handling. | Sample/nonfunctional language is shown at the address, QR and copy/share actions; the mainnet badge remains prominent. |
| Mainnet, testnet, and unavailable balance states were visually under-specified. | PDF pp. 3, 6 require visible network and deliberate real-money entry. | Added distinct mainnet, app-limit, syncing/offline and network-specific receive states. |
| The token label mixed `USDT` and `USDt`, and one mainnet confirmation showed an undecided numeric cap. | The PDF consistently calls the token USDt and requires low app-level caps without specifying amounts (pp. 3, 6). | Standardized V1 copy to USDt and removed the made-up cap value. |
| The Market navigation and asset views felt like a generic search page. | Earlier design feedback requested a market-like landing view and the purple-diamond back control. | Added 24-hour market rows/sparklines, filters, adaptive asset-detail examples, and consistent diamond navigation on all 11 Market screens. |

## What the design does not prove

- **Ethereum send fees remain a product/engineering decision.** The PDF explicitly leaves paymaster sponsorship versus classic ETH gas open for the spike (p. 4). No final Ethereum signing/fee-shortfall route should be treated as approved until that decision is made.
- The QR blocks, addresses, balances, prices, fee values, timestamps, and transaction histories are illustrative Figma data. The screens do not prove address derivation, functional QR scanning/sharing, secure on-device key storage, screenshot blocking, checksum and token-contract validation, real fee quotes, cap enforcement, or chain-confirmed receipts (pp. 2–6).
- App limit amounts, model download size/fit, Wi‑Fi-only behavior, delete-model behavior, biometric/PIN fallback, and the exact offline recovery policy still need product and implementation validation (pp. 5–6). The designs avoid inventing final cap values.
- The earlier request for an exact local-currency balance conflicts with the PDF's V1 exclusion of price lookups (p. 6). Retain local-currency and Market concepts as future exploration until a live-rate source, freshness policy, and scope are specified.
- Future Market exchange buttons lead into the labeled exchange exploration; its chat composer remains a visual affordance until a contextual V2 chat journey is specified. It is not wired into the V1 wallet journey.
- Prototype navigation represents sample outcomes; it is not a live state machine. Confirmation must only appear after chain verification, and an unknown status must never invite blind resending (pp. 1, 4, 6).

The next release gate is to resolve the Ethereum fee approach, then validate the end-to-end V1 acceptance cases on devices: create/restore, testnet receive, manual/chat sends through one review, saved-name sending, confirmed local history, and no-model use (PDF p. 7).
