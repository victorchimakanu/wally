# Extending Wally

Two common extension patterns: adding a new chain and adding a new intent type.

## How to add a new chain

Wally uses the WDK MCP toolkit's auto-discovery: if the wallet package for a chain is installed, the toolkit registers it automatically at startup.

**Step 1 — Install the wallet package**

```bash
npm install @tetherto/wdk-wallet-<chain>
```

For example, for Tron:

```bash
npm install @tetherto/wdk-wallet-tron
```

Check the latest version with `npm view @tetherto/wdk-wallet-tron version` before pinning.

**Step 2 — Enable the chain in config**

Add it to `WDK_CHAINS` in your `.env.local`:

```
WDK_CHAINS=ethereum,arbitrum,bitcoin,tron
```

The WDK MCP subprocess reads this at startup and tries to import the package. If the package is not installed it logs a warning and skips the chain — no crash.

**Step 3 — Add the block explorer URL**

In `src/wdk/tools.ts`, add an entry to `BLOCK_EXPLORERS`:

```typescript
tron: (h) => `https://tronscan.org/#/transaction/${h}`,
```

**Step 4 — Update the intent validator**

In `src/agent/intent.ts`, add the chain to `SUPPORTED_CHAINS`:

```typescript
const SUPPORTED_CHAINS = ["ethereum", "arbitrum", "bitcoin", "tron"] as const;
```

Then add address validation logic to `isValidAddress()`. Tron addresses start with `T` and are 34 characters:

```typescript
if (chain === "tron") {
  return /^T[A-Za-z0-9]{33}$/.test(address);
}
```

**Step 5 — Update the QVAC system prompt**

In `src/qvac/prompts.ts`, update the transfer intent description to include the new chain name so the model knows it exists:

```
{ "chain": "ethereum|arbitrum|bitcoin|tron", ... }
```

**Step 6 — Add tests**

In `test/agent/intent.test.ts`, add cases for address validation on the new chain:

```typescript
it("accepts a valid Tron address", () => {
  const result = classify({ intent: "transfer", params: { chain: "tron", token: "USDT", amount: "10", to: "TBjMam1..." }, reply: "" });
  expect(result.intent).toBe("transfer");
});
```

---

## How to add a new intent type

An intent type is a named action the user can request. The flow is: QVAC identifies it, the classifier validates it, the agent loop handles it.

**Example: adding a `lend` intent** (supply USDT to Aave)

**Step 1 — Name the intent and define its params**

In `src/agent/intent.ts`, add the schema and type:

```typescript
const LendParams = z.object({
  chain: z.enum(["ethereum"]),
  token: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

export type LendIntent = {
  intent: "lend";
  params: z.infer<typeof LendParams>;
  reply: string;
};
```

Add `LendIntent` to the `TypedIntent` union, and add a `case "lend":` branch in `classify()`.

**Step 2 — Tell QVAC about the new intent**

In `src/qvac/prompts.ts`, add it to the intent type list in the system prompt:

```
lend:
  { "chain": "ethereum", "token": "string", "amount": "string" }
```

Add a few-shot example to `FEW_SHOT_EXAMPLES`:

```typescript
{ role: "user", content: "lend 100 USDT on Aave" },
{ role: "assistant", content: JSON.stringify({ intent: "lend", params: { chain: "ethereum", token: "USDT", amount: "100" }, reply: "I will supply 100 USDT to Aave on Ethereum. I will show you the terms before proceeding." }) },
```

**Step 3 — Handle it in the agent loop**

In `src/agent/index.ts`, add a case to the `switch` statement:

```typescript
case "lend":
  await this.handleLend(intent.params, intent.reply, updatedHistory);
  break;
```

Add the `handleLend()` method. Use the same pattern as `handleTransfer()`: quote first, show confirmation, execute only after an explicit button click.

```typescript
private async handleLend(params: LendParams, reply: string, history: CompletionMessage[]): Promise<void> {
  // 1. Quote via WDK
  const quoteRaw = await wdk.callTool("quoteSupply", { chain: params.chain, token: params.token, amount: params.amount });
  // 2. Show confirmation
  const { payload, promise } = createConfirmation(this.sessionId, `Supply ${params.amount} ${params.token} to Aave`, ...);
  this.emit({ type: "confirmation", payload });
  const confirmed = await promise;
  if (!confirmed) { ... return; }
  // 3. Execute
  const result = await wdk.callTool("supply", { chain: params.chain, token: params.token, amount: params.amount });
  ...
}
```

**Step 4 — Add to JSON schema in QVAC client**

In `src/qvac/client.ts`, add `"lend"` to the `intent` enum in `INTENT_SCHEMA`. QVAC uses this to constrain its output.

**Step 5 — Test it**

Add unit tests to `test/agent/intent.test.ts` for the new intent's happy path and error cases (missing param, wrong chain).

---

## General rules for extensions

- Never add a chain or intent to the QVAC system prompt unless the WDK tool to execute it exists. A user who asks for it and gets a failure will trust Wally less.
- Always quote before executing. Show fee and recipient in the confirmation dialog.
- Every write operation must go through `createConfirmation()`. No exceptions.
- Run `npm test` after every change to make sure existing intents still classify correctly.
