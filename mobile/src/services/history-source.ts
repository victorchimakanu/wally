/**
 * What an Activity list is missing, said out loud.
 *
 * The screen used to name its source with a fixed string: "Blockscout and local receipts.
 * Token transfers and internal contract activity are not included."
 *
 * Both halves became wrong the day the backend existed, and wrong in the direction that costs
 * time: the proxy reads Etherscan and merges per-token `tokentx`, so the data was indexed
 * history including USDt while the screen named a provider that had been 403ing and disclaimed
 * the token transfers it was showing. Reading that label, you would conclude the backend was
 * misconfigured and go looking.
 *
 * The fix then was to report `history.source`, set by whatever actually answered, on the
 * grounds that a label reading the data cannot disagree with it.
 *
 * ## Why that line is gone and this one is not
 *
 * The wallet was rebuilt on 15 November with tighter copy and no room for a provenance
 * sentence under every refresh. Naming the provider was never the point — it was how the
 * earlier bug was fixed, not the thing worth saying. And a card that makes no claim about its
 * source cannot make a false one.
 *
 * What does not survive being tightened away is the half that is a **disclosure rather than a
 * credit**. On the fallback provider the list genuinely does not contain token transfers, so a
 * USDt payment someone is hunting for is absent from a screen that otherwise looks complete.
 * Nothing else on that screen would tell them. "We read Etherscan" is trivia; "this list is
 * not everything" is not.
 *
 * So this says nothing at all on the ordinary path, and speaks only when the list is short of
 * something a reader would otherwise assume was there.
 */

/** Whether whatever answered includes ERC-20 transfers. Only the Etherscan path does. */
function indexesTokens(source: string): boolean {
  // `withLocalSubmissions` stamps "<remote> and this device's submissions"; the loopback dev
  // wallet stamps its own. Matching the remote half is what decides this.
  return /etherscan/i.test(source);
}

/**
 * The caveat this list needs, or null when it needs none.
 *
 * Null rather than an empty string so a caller cannot render a blank line by forgetting to
 * check, which is how a disclosure quietly becomes whitespace.
 */
export function historyGap(source: string): string | null {
  return indexesTokens(source) ? null : 'Token transfers and internal contract activity are not included.';
}
