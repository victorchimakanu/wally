import type { TxRecord } from "./store.js";

// formatHistoryContext produces a short text block injected into QVAC's
// system prompt so the model can resolve "last time" references in user messages.
export function formatHistoryContext(txs: TxRecord[]): string {
  if (txs.length === 0) return "";

  const lines = txs.map((tx) => {
    const date = tx.created_at
      ? new Date(tx.created_at * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "unknown date";
    return `- ${date}: sent ${tx.amount} ${tx.token} to ${tx.recipient} on ${tx.chain} (${tx.status})`;
  });

  return `Recent transactions for context:\n${lines.join("\n")}`;
}
