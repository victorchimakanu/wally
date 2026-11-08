/**
 * Where this Activity list actually came from, and what it therefore leaves out.
 *
 * This used to be the fixed string "Blockscout and local receipts. Token transfers and
 * internal contract activity are not included." It was wrong on both halves once the backend
 * existed, and wrong in the direction that costs time: the proxy reads Etherscan and merges
 * per-token `tokentx`, so the data was indexed history including USDt while the screen named
 * a provider that had 403'd and disclaimed the token transfers it was showing. Reading the
 * label, you would conclude the backend was misconfigured and go looking.
 *
 * So it reports `history.source`, which is set by whatever actually answered — the merge in
 * `mergeHistory`, or the dev wallet server when the proxy is absent or failed. A label that
 * reads the data cannot disagree with it.
 */
export function historyProvenance(source: string): string {
  // mergeHistory stamps "<remote> and this device's submissions"; the loopback server stamps
  // its own. Only the Etherscan path carries token transfers.
  const indexed = /etherscan/i.test(source);
  return `${source}.${indexed ? '' : ' Token transfers and internal contract activity are not included.'}`;
}
