# Wally design revisit — 28 November 2026

Every screen of the Expo web build at the four layout tiers (`layoutFor` in `mobile/src/components/shell.ts`: phone 375, upright tablet 834, landscape tablet 1194, desktop 1440), light and dark, in demo mode and in live mode with the wallet server down. Compared with the WallyUI boards: Tablet · Home/Chat/Market/Asset/Review/Activity/Profile/Settings (`774:16674`–`774:16681`), Desktop and mobile (`725:9355`–`725:9362`), shared components (`774:16519`) and Home & profile components (`411:2893`, which has the wallet card's Offline variant and the recent-activity card). Captured headlessly; the `before/` folder keeps the four wallet shots that triggered this pass.

Settled and left alone: no taglines or helper text; Send and Receive are the wallet's only actions; the bar's switch, the rail with no menu button, the avatar only in the upright-tablet bar; the ring mark; settings groups inside Profile.

## Priority 1 — the wallet screen

1. **Live, disconnected, every tier.** Three stacked boxes before anything else: the amber custody notice, a tint card with "— ETH / Connecting to the wallet… / Refresh", a red error card. Fix: one hero card in both modes (the lilac card the demo already has), with the Figma Offline variant inside it — the dash, then one status line ("Not connected · Refresh", or "Saved 10:42" when a snapshot exists). The custody notice and the error are that one line, never separate cards.
2. **Tablet and rail.** Send/Receive are 112 px tiles that do not meet the card's 238 px; Recent activity sits beside them as a third box, and in live mode it is error text, "Not loaded yet", Refresh and View all. Fix: tiles that fill the card's height; Recent activity as a full-width card below (Figma order: card, actions, activity, watchlist); disconnected is one line inside it.
3. **Desktop.** No recent activity at all, while tablets have it; the watchlist alone fills the right column. Fix: left column card + actions, right column Recent activity then Watchlist, as the desktop board has them.
4. **All tiers, both modes.** Recent-activity rows are "To 0x1111…1111 −25 USDt ›" (demo) or hash + status + chain (live). Fix: one transfer row — direction icon, name or short address, "Pending · Arbitrum Sepolia", amount right, time under it — shared with Activity and the chat history panel.
5. **Live.** `LiveWalletOverview` stacks a tint card, a per-network group and a Tokens group under the actions; per-row errors print twice (label and note). Fix: the hero card carries the total; networks and tokens are one group with the error once, as a muted line in the row.

## Priority 2 — one width rule for the landscape tablet

6. **Rail (1194), every pushed screen.** Settings, Profile, Send, Receive, Asset, Transaction and Address book stretch to 1042 px: a metre-wide Review transfer button, a QR tile lost in a card, a row's value far from its label. Fix: the rail tier takes the desktop's left-aligned 696 column for lists and forms; Wallet and Chat keep the full width.
7. **Rail, top-level sections.** Market, Activity, Settings and Address book show the pushed-screen header (centred title, blank back slot) although the rail is the navigation. Fix: the desktop page heading (title left, badge beside it) — the rail tier becomes "desktop without labels", one rule instead of two.

## Priority 3 — chat

8. **Inline balance card, tablet/rail/desktop.** The demo wallet card scales with its container, so "What is my balance?" answers with a 750–1100 px card and a 100 px figure. Fix: cap the inline card at 384, the width the chat boards draw it at.
9. **Tools sheet (composer "+"), all tiers.** A card titled Tools with five identical outlined buttons, Close included. Fix: a `Group` of `Row`s (New chat, Chat history, Manual send, Receive address); tapping outside closes it.
10. **Drawer, phone and upright tablet.** A New chat button, a Chats row and a Recent chats list are three doors to the same place now that history and new chat live in the Tools sheet. Fix: the shared-components drawer — six section rows and the profile row, nothing else.

## Priority 4 — market and asset

11. **Market, all tiers.** The Watchlist group repeats two of the four rows in All assets directly above them. Fix: one list; the watchlist lives on Wallet and the asset screen's own toggle.
12. **Asset, all tiers.** "On watchlist" is a full-width secondary button between the chart and the facts, and the chart draws a falling day in error red. Fix: a text toggle (Save / Saved) in the title row beside the logo, as the asset boards place it; one chart colour (the boards use amber) with the sign colour kept for the 24h figure.
13. **Asset timeframe chips.** Amber fill with an orange border on the selected chip, the only orange-bordered control in the app. Fix: the segmented track the Wallet/Chat switch and the Activity filter already use.

## Priority 5 — activity, receive, welcome

14. **Activity.** Demo rows have no icon, status or network; live rows read "Sent — ETH". Fix: the transfer row from item 4, dates as "Today, 10:42".
15. **Activity, live disconnected.** Error card, "Not loaded yet", Refresh, in a bordered card. Fix: the status line from item 1, the error said once.
16. **Receive, live disconnected.** The card keeps the network switch but loses its shape: status, error, advice. Fix: an empty paper tile where the QR goes, the status line under it, Copy/Share disabled.
17. **Welcome, tablet and desktop.** Lockup top-left, illustration centred, headline left, a 1000 px button. Fix: a 384 column, centred above the phone tier.

## Decisions for you

18. **Profile and Settings** now show the same groups; the rail, sidebar and drawer still list Settings separately. Either Settings opens Profile, or Profile keeps only the account rows (avatar, name, currency) and a Settings row. The first is one screen fewer.
19. **Dark mode** needs no redesign: the palette holds everywhere; only the Send tile turns white beside the yellow Receive tile on tablets, which item 2's tiles will settle.

Not design: Metro serves each SVG slowly on this machine, so icons appear a few seconds late in every fresh load; the logos in dark mode are fine once loaded.

## Added after review

20. **Chat section, phone and tablets.** Where the Wallet/Chat switch exists, the rail's and the drawer's section is Chats, the list at `/chats`, never a conversation; the switch alone moves between Wallet and the conversation. Fix: a tier-aware section (`RAIL_SECTIONS`, `RAIL_OWNER`) with the conversation keeping Chats highlighted; the desktop sidebar, which has no switch, keeps Chat. The Chats list itself showed a Back arrow beside the rail and a full-width New chat button above the rows: no Back on a rail destination, and an add-action on a list screen is the list's first row (Chats' New chat, Address book's Add recipient).
21. **Desktop sidebar.** Oversized and undifferentiated: 126 px lockup, 52 px section rows with 24 px icons, recent chats in the same type, no New chat. Fix: compact rows (40 px, 15 px labels, 20 px icons), New chat at the top, a quiet one-line recents list with a way to see all, the account at the foot; the ring lockup stays as the mark.
22. **Chat page, every tier.** Revisit against the Chat boards and the quiet-wallet notes: plain-text assistant replies, pale user bubbles, an anchored composer; decide the type scale, bubble and card treatment, spacing, the tool and unavailable-model cards, and the empty state.
