# Wally mobile design

> New light mobile direction: [WallyUI · Quiet Wallet](WALLYUI-QUIET-WALLET.md). The Signal board below remains an earlier concept.


Updated 27 September 2026 in the supplied Wally Figma file.

- [Signal design board](https://www.figma.com/design/8JZvVCg2lPwlw9CqguBhpg/Wally?node-id=431-197)
- [Signal prototype](https://www.figma.com/proto/8JZvVCg2lPwlw9CqguBhpg/Wally?node-id=431-198&starting-point-node-id=431%3A198)
- [Earlier layout study](https://www.figma.com/design/8JZvVCg2lPwlw9CqguBhpg/Wally?node-id=420-252)
- [Components and handoff notes](https://www.figma.com/design/8JZvVCg2lPwlw9CqguBhpg/Wally?node-id=414-16)

## Design direction

The **Wally Mobile · Product Design** page has a sixteen-screen Signal concept and an earlier twelve-screen layout study, all at 390 × 844. Signal covers welcome, wallet, chat draft, transfer review, pending transaction, confirmed receipt, receive, chat history, settings, offline chat, expired quote, manual send, an empty conversation, installed-model management, recovery gate, and optional AI setup. The original Figma reference pages remain intact.

The supplied reference drives the cobalt #4766F9, ink #1E1F4B, canvas #F5F8FE, white rounded cards, Poppins typography, and orbital motifs. Wally's actual vector wordmark from exports/wally-wordmark.svg is now on the welcome screen. Its robot mark from exports/wally-logo.svg and the Reach palette in public/reach.css (#16301F, #3DD68C, #F5EFDF, #F2A03D) identify the private-AI screens. This pairs the requested Figma system with the project's own identity instead of treating the orbital W as its logo. Fira Code is used for full wallet addresses. Scoped color and radius variables, text styles, and button/status components support editing.

## What the supplied history establishes

The user chose an **Android app intended to run locally**, aimed at a **midrange phone with 6–8 GB RAM**, and asked for a low-resource approach that does not rely on CUDA. A VPS was discussed as an alternative, but no decision to move the AI there was made. No exact model or acceptable physical-device performance has been established.

The following are working product assumptions from earlier assistant recommendations, not confirmed user decisions: one optional model downloaded after app installation; wallet basics usable before and without AI; balance, receive, local activity, and simple confirmed transfer as the first slice; voice, loans, and bridges later. The design uses these assumptions to make the product journey concrete. QVAC/Qwen variants remain research candidates, not a selected or benchmarked production model. The setup screen presents one private download, with no model picker or unverified size/speed claim.

## Product and safety basis

Grounded in README.md, src/types.ts, public/app.js, public/reach.css, the SVG exports, docs/LOCAL-DEV-REVIEW.md, and docs/ANDROID-LOCAL-AI-RESEARCH.md.

- Chat interprets a request and prepares a draft; the canonical review shows the full address, network, amount, estimated fee, and total. The user explicitly confirms before WDK signs on the phone. The AI does not receive signing authority or recovery material.
- Manual send converges on the same review. A pending submission remains distinct from verified settlement.
- Offline local chat is possible only after a model is installed; live balances, fee quotes, broadcast, and settlement still need a network connection. Expired drafts need fresh data and another approval.
- Wallet and chat navigation remain available without the model. Local conversations are not presented as a complete chain transaction history.
- Gasless USDT fee examples assume configured smart accounts and paymaster support. Classic accounts require network-native fees. The current preview only simulates Arbitrum USDT sending; showing other assets does not imply they can all be sent.
- Bridge and incomplete lending exit flows are not presented as working mobile features. The empty-chat quick action now suggests receiving USDT rather than a loan feature.

## Prototype and implementation boundary

The prototype links the main navigation, send flow, empty chat, settings → optional AI setup → installed-model preview, and recovery gate. The sample review expires after 48 seconds; pending requires an explicit tap to preview the confirmed receipt. Production must derive success from verified settlement. The countdown and model download are static design states.

The repository also contains an interactive **Expo frontend preview** under mobile/; it uses fictional fixtures and scripted replies in mobile/src/demo/model.ts and demo persistence in mobile/src/demo/store.tsx. It is not native QVAC or WDK integration, and it has not established performance on the target Android device. Its theme currently cites the earlier Figma layout study, so the Signal board is a proposed direction rather than an implemented mobile UI.

Copy, recovery, model setup, and text entry in Figma are visual controls. Offline-to-manual-send demonstrates the destination layout; a real implementation must preserve the offline guard and prevent quoting or sending until connectivity returns. No transactions, model downloads, or clipboard writes occur in Figma. All balances, recipient addresses, fees, and status values are fictional. The receive address is explicitly a sample that must not receive deposits.

