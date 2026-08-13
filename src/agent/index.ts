import { parseIntent } from "../qvac/client.js";
import { classify, type LendBorrowIntent } from "./intent.js";
import { sanitize } from "./sanitize.js";
import { createConfirmation, cancelConfirmation } from "./confirm.js";
import { storePendingLend, takePendingLend, clearPendingLend, buildLendPlan, executeLendPlan } from "./lend.js";
import { fetchAccountRisk, describeRisk } from "../wdk/lending.js";
import * as tools from "../wdk/tools.js";
import { loadHistory, saveHistory } from "../session/store.js";
import { formatHistoryContext } from "../history/formatter.js";
import {
  getRecentTxs,
  getLastTxToRecipient,
  insertTx,
  updateTxStatus,
} from "../history/store.js";
import { peekGlobalOpRate, consumeGlobalOpRate, checkTransferRate } from "../middleware/rateLimit.js";
import { config } from "../config.js";
import { getLogger } from "../logger.js";
import type {
  WallyOutboundEvent,
  WallyInboundEvent,
  CompletionMessage,
} from "../types.js";

const log = getLogger("agent");

type Emitter = (event: WallyOutboundEvent) => void;

// WallyAgent handles one WebSocket session. Each browser tab gets its own instance.
export class WallyAgent {
  private readonly sessionId: string;
  private emit: Emitter;

  constructor(sessionId: string, emit: Emitter) {
    this.sessionId = sessionId;
    this.emit = emit;
  }

  // handleMessage is the entry point for every user message.
  async handleMessage(raw: WallyInboundEvent): Promise<void> {
    if (raw.type === "confirm" || raw.type === "cancel") {
      // Confirmation/cancellation is handled by confirm.ts via resolveConfirmation.
      // The WebSocket route calls that directly; nothing to do here.
      return;
    }

    if (raw.type === "get_balance") {
      await this.handleBalance("all");
      return;
    }

    if (raw.type !== "message") return;

    const sanResult = sanitize(raw.content);
    if (!sanResult.ok) {
      this.emit({ type: "error", message: "Message not accepted: " + (sanResult.reason ?? "unknown reason") });
      return;
    }

    const userText = sanResult.cleaned!;

    this.emit({ type: "typing" });

    // If the last turn asked "what LTV do you want?", a bare answer like
    // "50%" completes the pending lend_borrow without a round-trip to the
    // model — deterministic slot-filling beats re-parsing.
    const completedLend = takePendingLend(this.sessionId, userText);
    if (completedLend) {
      const history = loadHistory(this.sessionId);
      await this.handleLendBorrow(completedLend as LendBorrowIntent["params"], [
        ...history,
        { role: "user", content: userText },
      ]);
      return;
    }

    try {
      const history = loadHistory(this.sessionId);
      const historyCtx = await buildHistoryContext(this.sessionId);
      const parsed = await parseIntent(userText, history, historyCtx);

      // The recipient is never the model's to choose — not even among past
      // recipients. The only address a transfer accepts is one the user typed
      // literally in this message. "Send it to the same address as last time"
      // is a separate, deterministic path (the last_recipient intent), which
      // resolves to the single most recent recipient in code, never a value
      // the model selected. So here: a literal address is used verbatim; its
      // absence is a hard stop, whatever the model proposed in `to`.
      if (parsed.intent === "transfer" && parsed.params && typeof parsed.params === "object") {
        const evmAddrs = userText.match(/0x[0-9a-fA-F]{40}\b/g) ?? [];
        const btcAddrs = userText.match(/\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g) ?? [];
        const all = [...evmAddrs, ...btcAddrs];
        if (all.length === 1) {
          (parsed.params as Record<string, unknown>)["to"] = all[0];
        } else {
          // Zero addresses → ask for one. More than one → refuse rather than
          // guess which is the intended recipient (a pasted message could
          // contain an attacker address alongside the intended one).
          const msg =
            all.length > 1
              ? "I found more than one address in your message, so I will not guess which to send to. " +
                "Send again with only the recipient address."
              : "I need the recipient address in your message — paste the full address you want to send to. " +
                "For safety I never pick or remember an address myself; every send needs the address in your message.";
          this.emit({ type: "message", content: msg });
          saveHistory(this.sessionId, [
            ...history,
            { role: "user", content: userText },
            { role: "assistant", content: msg },
          ]);
          return;
        }
      }

      const intent = classify(parsed);

      log.info(
        { session_id: this.sessionId, intent_type: intent.intent },
        "Classified intent"
      );

      // Always save the user turn to session history
      const updatedHistory: CompletionMessage[] = [
        ...history,
        { role: "user", content: userText },
      ];

      switch (intent.intent) {
        case "transfer":
          await this.handleTransfer(intent.params, intent.reply, updatedHistory);
          break;

        case "swap":
          await this.handleSwap(intent.params, intent.reply, updatedHistory);
          break;

        case "bridge":
          await this.handleBridge(intent.params, intent.reply, updatedHistory);
          break;

        case "lend_borrow": {
          if (intent.params.ltv === undefined) {
            // Ask for the missing LTV and park the rest of the slots.
            storePendingLend(this.sessionId, intent.params);
            const ask =
              intent.reply ||
              `What loan-to-value do you want? For example, 50% on ${intent.params.collateralAmount} ${intent.params.collateralToken} borrows about half its value. I allow up to 75%.`;
            this.emit({ type: "message", content: ask });
            saveHistory(this.sessionId, [...updatedHistory, { role: "assistant", content: ask }]);
            break;
          }
          await this.handleLendBorrow(intent.params, updatedHistory);
          break;
        }

        case "balance": {
          const summary = await this.handleBalance(intent.params.chain, true);
          saveHistory(this.sessionId, [
            ...updatedHistory,
            { role: "assistant", content: summary || intent.reply },
          ]);
          break;
        }

        case "price":
          await this.handlePrice(intent.params.token, intent.reply, updatedHistory);
          break;

        case "position": {
          try {
            const addressText = await tools.fetchAddress(intent.params.chain);
            const address = addressText.match(/0x[0-9a-fA-F]{40}/)?.[0];
            if (!address) throw new Error(`Could not resolve the wallet address on ${intent.params.chain}.`);
            const risk = await fetchAccountRisk(intent.params.chain, address);
            const msg = describeRisk(risk, intent.params.chain, address);
            this.emit({ type: "message", content: msg });
            saveHistory(this.sessionId, [...updatedHistory, { role: "assistant", content: msg }]);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Could not fetch the position";
            this.emit({ type: "error", message: "Position check failed: " + message });
          }
          break;
        }

        case "history": {
          const txs = getRecentTxs(this.sessionId, 10);
          const msg =
            txs.length === 0
              ? "No transactions found for this session."
              : txs
                  .map(
                    (t) =>
                      `${t.created_at ? new Date(t.created_at * 1000).toLocaleDateString() : "?"}: ${t.amount} ${t.token} to ${t.recipient.slice(0, 8)}... on ${t.chain} (${t.status})`
                  )
                  .join("\n");
          this.emit({ type: "message", content: msg });
          saveHistory(this.sessionId, [
            ...updatedHistory,
            { role: "assistant", content: msg },
          ]);
          break;
        }

        case "address": {
          try {
            const addr = await tools.fetchAddress(intent.params.chain);
            this.emit({ type: "message", content: addr });
            saveHistory(this.sessionId, [
              ...updatedHistory,
              { role: "assistant", content: addr },
            ]);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Could not fetch address";
            this.emit({ type: "error", message: "Address lookup failed: " + message });
          }
          break;
        }

        case "last_recipient": {
          const last = getLastTxToRecipient(this.sessionId);
          if (!last) {
            const msg = "No previous transactions found for this session.";
            this.emit({ type: "message", content: msg });
            saveHistory(this.sessionId, [
              ...updatedHistory,
              { role: "assistant", content: msg },
            ]);
          } else {
            const msg = `Your last payment was ${last.amount} ${last.token} to ${last.recipient} on ${last.chain}. Should I send the same amount again?`;
            this.emit({ type: "message", content: msg });
            saveHistory(this.sessionId, [
              ...updatedHistory,
              { role: "assistant", content: msg },
            ]);
          }
          break;
        }

        default: {
          this.emit({ type: "message", content: intent.reply });
          saveHistory(this.sessionId, [
            ...updatedHistory,
            { role: "assistant", content: intent.reply },
          ]);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error({ session_id: this.sessionId, err }, "Agent error");
      this.emit({
        type: "error",
        message: "Something went wrong. Please try again.",
      });
    }
  }

  // ─── Intent handlers ────────────────────────────────────────────────────────

  private async handleTransfer(
    params: { chain: string; token: string; amount: string; to: string },
    initialReply: string,
    history: CompletionMessage[]
  ): Promise<void> {
    if (!peekGlobalOpRate()) {
      const msg = "Rate limit: too many wallet operations this hour. Try again later.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }
    const isGasless = config.gaslessChains.includes(params.chain);

    // 0. Gas preflight: a token transfer pays its fee in the chain's native
    // asset. With zero native balance the transaction can never be mined,
    // so stop here with a clear explanation instead of failing downstream.
    // Gasless (ERC-4337) chains pay fees via the paymaster in the token
    // itself, so the preflight does not apply.
    const isToken = params.token.toUpperCase() !== "ETH" && params.token.toUpperCase() !== "BTC";
    if (!isGasless && isToken && ["ethereum", "arbitrum"].includes(params.chain)) {
      try {
        const native = await tools.fetchNativeBalanceNumber(params.chain);
        if (native === 0) {
          const msg =
            `This transfer cannot go through yet. On a classic account, sending ${params.token} ` +
            `costs a small ETH fee (gas), and this address has 0 ETH on ${params.chain}. ` +
            `The recommended fix: enable the gasless smart account (see GASLESS.md in the repo) ` +
            `and pay fees in ${params.token} instead. No ETH needed, ever. ` +
            `Alternatively, send a little ETH on ${params.chain} to this address. ` +
            `Your ${params.token} is untouched.`;
          this.emit({ type: "error", message: msg });
          saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
          return;
        }
      } catch (err) {
        log.warn({ err }, "Gas preflight check failed — continuing");
      }
    }

    // 1. Quote the fee. No quote, no confirmation screen: a spend whose cost
    // cannot be shown must not be signable.
    let fee: string;
    try {
      const quote = await tools.quoteAndDescribeTransfer(
        params.chain,
        params.token,
        params.amount,
        params.to
      );
      fee = quote.fee;
    } catch (err) {
      log.warn({ err }, "Could not get transfer quote");
      const msg =
        "I could not get a fee quote for this transfer, so I am not sending it. " +
        "Check the connection and try again.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }

    // 2. Send confirmation to UI and wait for user approval
    const { payload, promise } = createConfirmation(
      this.sessionId,
      `Send ${params.amount} ${params.token} on ${params.chain}`,
      params.amount,
      params.token,
      params.to,
      params.chain,
      fee
    );

    this.emit({ type: "confirmation", payload });

    const confirmed = await promise;

    if (!confirmed) {
      const msg = "Transfer cancelled.";
      this.emit({ type: "message", content: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }

    // 3. Execute. Consume a rate-limit slot only now, on a confirmed spend,
    // so cancelled or quote-failed attempts never burn the budget. Both the
    // global ceiling and the per-session cap are checked here.
    if (!checkTransferRate(this.sessionId) || !consumeGlobalOpRate()) {
      const msg = "Rate limit reached for wallet operations. Please wait before trying again.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }
    this.emit({ type: "typing" });
    try {
      const { txHash, explorerUrl } = await tools.executeTransfer(
        params.chain,
        params.token,
        params.amount,
        params.to
      );

      const txId = insertTx({
        session_id: this.sessionId,
        chain: params.chain,
        token: params.token,
        amount: params.amount,
        recipient: params.to,
        tx_hash: txHash,
        fee,
        status: "pending",
      });

      // Trust but verify: only claim success once the operation is actually
      // mined AND succeeded. WDK has reported "sent" for transactions that
      // never reached the network, and a mined-but-reverted tx moved nothing.
      // Gasless sends verify against the bundler's user-operation receipt.
      // Non-gasless checks the tx RECEIPT status (mined + success), not mere
      // mempool presence. While we poll, the row stays "pending".
      const outcome = isGasless
        ? await tools.verifyUserOpOnChain(params.chain, txHash)
        : await tools.verifyTxOnChain(params.chain, txHash);

      if (outcome === "failed") {
        updateTxStatus(txId, "failed");
        const msg =
          `This transfer failed on ${params.chain} — it was mined but reverted, so no funds moved. ` +
          `Say "what is my balance" to confirm. Reference: ${txHash}`;
        this.emit({ type: "error", message: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }

      if (outcome === "indeterminate") {
        // Do NOT say "not sent" — a slow tx that later mines would then be
        // double-spent if the user resends. Leave the row pending.
        const msg =
          `I could not confirm this transfer landed on ${params.chain} within the wait window. ` +
          `It may still be settling. Do NOT resend — say "what is my balance" in a minute to check. ` +
          `Reference: ${txHash}`;
        this.emit({ type: "error", message: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }

      if (outcome === "unverifiable") {
        // Chains with no verification path (e.g. Bitcoin): report as submitted,
        // never as confirmed.
        updateTxStatus(txId, "pending");
        const msg =
          `Submitted on ${params.chain}. I cannot verify settlement on this chain from here, ` +
          `so treat it as unconfirmed until you check. Reference: ${txHash}`;
        this.emit({ type: "message", content: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }

      updateTxStatus(txId, "confirmed");

      // A user-operation hash has no page on Etherscan-style explorers.
      const link = isGasless ? "" : explorerUrl;
      const msg = isGasless
        ? `Sent. ${params.amount} ${params.token} is on its way on ${params.chain}, gas paid in ${params.token}.\n` +
          `User operation: ${txHash.slice(0, 10)}...${txHash.slice(-8)}\n` +
          `Say "what is my balance" in a minute to see it settle.`
        : `Sent. ${params.amount} ${params.token} is on its way on ${params.chain}.\n` +
          `Transaction: ${txHash.slice(0, 10)}...${txHash.slice(-8)}` +
          (explorerUrl ? `\n${explorerUrl}` : "");
      this.emit({ type: "message", content: msg });
      this.emit({ type: "tx_complete", txHash, chain: params.chain, explorerUrl: link });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
    } catch (err) {
      // An error here does not prove the transaction was not broadcast — the
      // wallet may have sent it and then the call threw. Never imply "not
      // sent", which would invite a double-spend resend.
      const message = err instanceof Error ? err.message : "Transaction error";
      const msg =
        "I hit an error during this transfer and cannot confirm whether it was sent. " +
        "Do NOT resend it — say \"what is my balance\" first to check. Details: " + message;
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      log.error({ err, session_id: this.sessionId }, "Transfer execution failed");
    }
  }

  private async handleSwap(
    params: { chain: string; fromToken: string; toToken: string; amount: string },
    initialReply: string,
    history: CompletionMessage[]
  ): Promise<void> {
    if (!peekGlobalOpRate()) {
      const msg = "Rate limit: too many wallet operations this hour. Try again later.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }
    let fee: string;
    let quoteSummary: string;
    try {
      const quote = await tools.quoteAndDescribeSwap(
        params.chain,
        params.fromToken,
        params.toToken,
        params.amount
      );
      fee = quote.fee;
      quoteSummary = quote.summary;
    } catch (err) {
      log.warn({ err }, "Could not get swap quote");
      const msg =
        "I could not get a quote for this swap, so I am not executing it. " +
        "Check the connection and try again.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }

    // Show the user the economic effect before they confirm.
    if (quoteSummary) {
      this.emit({ type: "message", content: quoteSummary });
    }

    const { payload, promise } = createConfirmation(
      this.sessionId,
      `Swap ${params.amount} ${params.fromToken} for ${params.toToken} on ${params.chain}`,
      params.amount,
      params.fromToken,
      `${params.toToken} (swap)`,
      params.chain,
      fee
    );

    this.emit({ type: "confirmation", payload });
    const confirmed = await promise;

    if (!confirmed) {
      const msg = "Swap cancelled.";
      this.emit({ type: "message", content: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }

    // Consume a rate-limit slot only on the confirmed swap.
    if (!checkTransferRate(this.sessionId) || !consumeGlobalOpRate()) {
      const msg = "Rate limit reached for wallet operations. Please wait before trying again.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }
    this.emit({ type: "typing" });
    try {
      const isGasless = config.gaslessChains.includes(params.chain);
      const { txHash, explorerUrl } = await tools.executeSwap(
        params.chain,
        params.fromToken,
        params.toToken,
        params.amount
      );

      // Record the swap as pending BEFORE verification, so a swap that lands
      // after the poll window still appears in history (mirrors transfers).
      const swapTxId = insertTx({
        session_id: this.sessionId,
        chain: params.chain,
        token: `${params.fromToken}->${params.toToken}`,
        amount: params.amount,
        recipient: "(swap)",
        tx_hash: txHash,
        fee: "",
        status: "pending",
      });

      // Same verification discipline as transfers — a swap is not "complete"
      // until it is mined and succeeded. WDK reports "sent" optimistically.
      const outcome = isGasless
        ? await tools.verifyUserOpOnChain(params.chain, txHash)
        : await tools.verifyTxOnChain(params.chain, txHash);

      if (outcome === "failed") {
        updateTxStatus(swapTxId, "failed");
        const msg = `The swap failed on ${params.chain} — mined but reverted, so your tokens were not swapped. Reference: ${txHash}`;
        this.emit({ type: "error", message: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }
      if (outcome === "indeterminate" || outcome === "unverifiable") {
        // Leave the row pending — it may still land.
        const msg = `Swap submitted on ${params.chain}, but I could not confirm it landed. Do NOT resend — check your balance in a minute. Reference: ${txHash}`;
        this.emit({ type: "message", content: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }

      updateTxStatus(swapTxId, "confirmed");
      const msg =
        `Swap complete. Transaction: ${txHash.slice(0, 10)}...${txHash.slice(-8)}` +
        (explorerUrl ? `\n${explorerUrl}` : "");
      this.emit({ type: "message", content: msg });
      this.emit({ type: "tx_complete", txHash, chain: params.chain, explorerUrl });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Swap error";
      const msg =
        "I hit an error during this swap and cannot confirm whether it went through. " +
        "Do NOT resend — check your balance first. Details: " + message;
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
    }
  }

  // handleLendBorrow: one sentence, one confirmation, three on-chain steps
  // (approve, supply, borrow), then a plain-English risk readout.
  private async handleLendBorrow(
    params: LendBorrowIntent["params"],
    history: CompletionMessage[]
  ): Promise<void> {
    clearPendingLend(this.sessionId);
    if (!peekGlobalOpRate()) {
      const msg = "Rate limit: too many wallet operations this hour. Try again later.";
      this.emit({ type: "error", message: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
      return;
    }
    try {
      const plan = await buildLendPlan(params);

      const { payload, promise } = createConfirmation(
        this.sessionId,
        `Aave: deposit ${plan.params.collateralAmount} ${plan.params.collateralToken}, borrow ${plan.borrowAmount} ${plan.params.borrowToken} at ${plan.params.ltv}% LTV`,
        plan.params.collateralAmount,
        plan.params.collateralToken,
        `Aave pool (${plan.params.chain})`,
        plan.params.chain,
        "3 transactions — fees quoted per step"
      );

      this.emit({ type: "message", content: plan.summary });
      this.emit({ type: "confirmation", payload });

      const confirmed = await promise;
      if (!confirmed) {
        const msg = "Lending plan cancelled. Nothing was sent.";
        this.emit({ type: "message", content: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }

      // Consume a rate-limit slot only on the confirmed lend chain.
      if (!checkTransferRate(this.sessionId) || !consumeGlobalOpRate()) {
        const msg = "Rate limit reached for wallet operations. Please wait before trying again.";
        this.emit({ type: "error", message: msg });
        saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
        return;
      }

      this.emit({ type: "typing" });
      // fetchAddress returns display text ("Address: 0x..."); the Aave read
      // needs the bare address.
      const addressText = await tools.fetchAddress(plan.params.chain);
      const walletAddress = addressText.match(/0x[0-9a-fA-F]{40}/)?.[0];
      if (!walletAddress) throw new Error(`Could not resolve the wallet address on ${plan.params.chain}.`);
      const { riskSummary } = await executeLendPlan(plan, walletAddress, (msg) =>
        this.emit({ type: "message", content: msg })
      );

      const msg =
        `Done. Deposited ${plan.params.collateralAmount} ${plan.params.collateralToken} and borrowed ` +
        `${plan.borrowAmount} ${plan.params.borrowToken} on ${plan.params.chain}.\n${riskSummary}`;
      this.emit({ type: "message", content: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lending operation failed";
      log.error({ err, session_id: this.sessionId }, "Lend/borrow failed");
      this.emit({ type: "error", message: "Lending stopped: " + message + " No further steps were run." });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: "Lending stopped: " + message }]);
    }
  }

  private async handleBridge(
    params: { fromChain: string; toChain: string; token: string; amount: string },
    initialReply: string,
    history: CompletionMessage[]
  ): Promise<void> {
    const msg = "Bridge operations are coming soon. For now, try transferring on Ethereum or Arbitrum.";
    this.emit({ type: "message", content: msg });
    saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
  }

  // Returns the chat summary when announce=true (so the caller can save it to
  // history), or "" when only the balance strip should update.
  private async handleBalance(chain: string, announce = false): Promise<string> {
    this.emit({ type: "typing" });
    try {
      const chains =
        chain === "all" ? config.wdkChains : [chain];
      const balances = await tools.fetchAllBalances(chains);
      this.emit({ type: "balance", balances });
      if (announce) {
        const summary = tools.describeBalances(balances);
        this.emit({ type: "message", content: summary });
        return summary;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not fetch balance";
      this.emit({ type: "error", message: "Balance check failed: " + message });
    }
    return "";
  }

  private async handlePrice(
    token: string,
    reply: string,
    history: CompletionMessage[]
  ): Promise<void> {
    try {
      const price = await tools.fetchPrice(token);
      const msg = `${token}: ${price}`;
      this.emit({ type: "message", content: msg });
      saveHistory(this.sessionId, [...history, { role: "assistant", content: msg }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Price unavailable";
      this.emit({ type: "error", message: "Could not fetch price: " + message });
    }
  }
}

async function buildHistoryContext(sessionId: string): Promise<string> {
  const txs = getRecentTxs(sessionId, 5);
  return txs.length > 0 ? formatHistoryContext(txs) : "";
}
