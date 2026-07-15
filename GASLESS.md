# Gasless transfers — pay gas in USDT, never hold ETH

Wally's standard wallet is a plain EOA (externally owned account): every token
transfer needs ETH on the same chain for gas. This guide switches the Arbitrum
wallet to an **ERC-4337 Safe smart account** where a paymaster fronts the gas
and takes payment **in USDT**. Result: you can receive USDT and send USDT
without the address ever holding ETH.

## How it works

- WDK ships `@tetherto/wdk-wallet-evm-erc-4337` (built on Safe's relay kit).
  Instead of signing a raw transaction, the wallet signs a **user operation**.
- A **bundler** (an external service) wraps user operations into real
  transactions and pays the ETH gas itself.
- A **paymaster** (usually the same provider) reimburses the bundler and
  charges your smart account in USDT.
- The WDK MCP toolkit loads this wallet for a chain via a `WDK_CONFIG` JSON
  file, so Wally's own code barely changes.

## What changes for you

- **New address.** The smart account is a Safe contract with its own address,
  different from the EOA you used before. Click the Arbitrum card after
  restarting to see it. Fund it with USDT directly.
- Funds on the old EOA address stay there. They are not lost; they still need
  ETH gas to move, whenever you care to.
- The very first send also deploys the smart account on-chain, so the first
  fee is slightly higher than later ones. Still paid in USDT.
- Wally reports a **user operation hash** instead of a transaction hash.
  Etherscan-style explorers cannot look those up directly.

## Setup (about 10 minutes)

1. **Create an account with a bundler/paymaster provider** that supports
   Safe accounts, EntryPoint v0.7, and an ERC-20 paymaster with USDT on
   Arbitrum One. Pimlico is the common choice and has a free tier; Gelato
   and Candide also work. From their dashboard you need three things:
   - the bundler RPC URL for Arbitrum One (contains your API key)
   - the paymaster URL (often the same URL)
   - the ERC-20 paymaster contract address for Arbitrum One (from their docs)

2. **Create the config file:**

       cp wdk.config.example.json wdk.config.json

   Fill in the three `PASTE_` values. The USDT token address and EntryPoint
   v0.7 address are already filled in. `wdk.config.json` is gitignored
   because the bundler URL embeds your API key.

3. **Enable it in `.env.local`** by uncommenting:

       WDK_CONFIG=./wdk.config.json
       WALLY_GASLESS_CHAINS=arbitrum

4. **Restart the server**, click the Arbitrum card, and send USDT to the new
   smart-account address.

5. **Test:** `send 1 USDT to 0x... on arbitrum`. The confirmation card
   appears as usual; gas is charged in USDT by the paymaster.

## Verify the pairing if the provider errors

`safeModulesVersion: "0.3.0"` pairs with EntryPoint v0.7
(`0x0000000071727De22E5E9d8BAf0edAc6f37da032`). If your provider only offers
EntryPoint v0.6 (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`), set
`safeModulesVersion` to `"0.2.0"`. The relay kit validates the pairing and
fails with a clear error if they mismatch.

## Rollback

Comment the two lines out of `.env.local` and restart. The Arbitrum wallet
returns to the plain EOA and its original address.
