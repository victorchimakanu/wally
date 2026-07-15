# Gasless USDT: the intended Wally setup

This is Wally's default story: **you hold USDT, you send USDT, and the network fee comes out
in USDT.** The wallet never holds ETH. This guide takes about ten minutes, and at the end your
Arbitrum wallet is a smart account (ERC-4337) whose gas is paid by a paymaster and charged
back to you in USDT.

Every value in the config below is verified and correct as shipped. The only thing you supply
is one free API key.

## How it works, in three sentences

Instead of signing raw transactions, your wallet signs **user operations**. A **bundler** (an
external service) wraps them into real transactions and fronts the ETH gas itself. A
**paymaster** reimburses the bundler and charges your smart account in USDT. Your key still
signs everything, still on your device; the smart account only changes who fronts the gas,
never who controls the money.

## Setup

### 1. Get a Pimlico API key (free)

Sign up at [pimlico.io](https://www.pimlico.io), create an API key. The free tier is plenty
for personal use. Pimlico provides both the bundler and the USDT paymaster through a single
URL, which is why one key is all you need.

### 2. Create the config file

```bash
cp wdk.config.example.json wdk.config.json
```

Open `wdk.config.json` and replace `YOUR_PIMLICO_API_KEY` in **both** URLs with your key.
That is the only edit. Do not retype the addresses; they are exact, including their letter
casing (Ethereum addresses carry a checksum in their capitalization, and validation rejects
any deviation).

For reference, what the values are:

| Field | Value | What it is |
|---|---|---|
| `bundlerUrl` / `paymasterUrl` | `https://api.pimlico.io/v2/42161/rpc?apikey=...` | Pimlico's combined bundler + paymaster endpoint for Arbitrum One (chain 42161) |
| `paymasterAddress` | `0x7777...834C` | Pimlico's ERC-20 paymaster contract (EntryPoint v0.7, same address on every chain) |
| `paymasterToken.address` | `0xFd08...Cbb9` | USDT on Arbitrum One: the token your fees are charged in |
| `entryPointAddress` | `0x0000...a032` | The standard ERC-4337 v0.7 EntryPoint contract |
| `safeModulesVersion` | `0.3.0` | The Safe modules release that pairs with EntryPoint v0.7 |

`wdk.config.json` is gitignored because the URL embeds your API key.

### 3. Enable it

In `.env.local`, uncomment (or add) these two lines:

```bash
WDK_CONFIG=./wdk.config.json
WALLY_GASLESS_CHAINS=arbitrum
```

### 4. Restart and get your new address

Restart the server (`npm run dev`). Click the **Arbitrum** card: you will see a **new
address**. That is your smart account, a Safe contract wallet derived from the same seed.
Copy it with the copy button.

### 5. Fund it with USDT

Send USDT to that address on the **Arbitrum One** network (when withdrawing from an exchange,
the network selector must say Arbitrum One). USDT is the only asset you need. Do not send ETH.

### 6. Send

```text
send 1 USDT to 0x... on arbitrum
```

The confirmation card shows the details, you confirm, the fee comes out of your USDT. Ask
`what is my balance` a minute later and watch it settle.

## What to expect

- **A new address.** The smart account is separate from the classic address the same seed
  produces. Fund the smart account directly; balances on the old classic address stay where
  they are.
- **The first send costs slightly more.** The first user operation also deploys your Safe
  contract on-chain. Still paid in USDT. Later sends are cheaper.
- **No Arbiscan link.** Gasless sends return a user-operation hash, which Etherscan-style
  explorers cannot look up. Proof of settlement is your balance updating, which Wally
  refreshes automatically.

## Troubleshooting

- **"Address ... is invalid ... checksum"** — an address in `wdk.config.json` was retyped
  with different capitalization. Restore it exactly from `wdk.config.example.json`.
- **Provider errors mentioning EntryPoint or modules** — your provider account may only
  support EntryPoint v0.6. Set `entryPointAddress` to
  `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` and `safeModulesVersion` to `"0.2.0"`. The
  pairing is validated and fails loudly when mismatched.
- **Transfer blocked with a gas message** — `WALLY_GASLESS_CHAINS=arbitrum` is missing from
  `.env.local`, or the server was not restarted after adding it.

## Rollback

Comment the two lines out of `.env.local` and restart. Arbitrum returns to the classic
account and its original address.
