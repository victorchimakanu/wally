/**
 * The ERC-20 tokens Wally knows about.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────
 *  READ THIS BEFORE CHANGING AN ADDRESS. There is **no official Tether testnet USDT.**
 *  Tether publishes no Sepolia or Arbitrum Sepolia deployment, so the address below is a
 *  third-party contract that calls itself USDT. It is pinned deliberately and its properties
 *  were read off the chain rather than taken from a block explorer's label:
 *
 *    0xE5b6C29411b3ad31C3613BbA0145293fC9957256   Arbitrum Sepolia
 *      name()        "USDT"
 *      symbol()      "USDT"
 *      decimals()    6
 *      totalSupply() 12,399,380,000 USDT
 *      balanceOf()   answers
 *      verified by eth_call against sepolia-rollup.arbitrum.io on 6 November 2026
 *
 *  A second candidate, 0x30fA2FbE15c1EaDfbEF28C188b7B8dbd3c1Ff2eB, is also live with a similar
 *  supply but is a proxy whose `name()` returns nothing. That is a worse thing to depend on,
 *  which is the only reason it was not chosen.
 *
 *  **Neither is provably Tether's.** On testnet nothing of value is at stake, so this is a
 *  reasonable thing to build against — but it must not be carried to mainnet by habit. The
 *  mainnet address is the real one and it is in GASLESS.md:
 *  0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 on Arbitrum One.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * Arbitrum only, deliberately. It is the declared home chain, the one with the smart account
 * and the sponsorship path; Ethereum Sepolia stays native-ETH only rather than doubling the
 * config and the testing for a chain the product story does not put value on.
 */
import type { Chain } from './wallet-api.ts';

export type Token = {
  /** Checksummed contract address. */
  address: string;
  /** What the contract's own `symbol()` returns. */
  symbol: string;
  /** What the contract's own `decimals()` returns. Never assumed. */
  decimals: number;
  /** Shown in the UI where "USDT" alone would be ambiguous. */
  name: string;
  /** Who actually issues this asset, for saying whose contract this is *not*. */
  issuer: string;
  /**
   * False when the deployment is not the token issuer's own.
   *
   * Read through `tokenCaveat()` below, which is what every surface showing this token calls.
   * For thirteen days this field was set here, documented as "surfaced in the app so a tester
   * is never misled", and read by nothing at all — while a hand-written sentence elsewhere
   * said the same thing and went stale. A flag that nothing reads is not a safeguard, it is a
   * note to yourself. `test/token-caveat.test.ts` fails if it stops being read.
   */
  official: boolean;
};

const USDT_ARBITRUM_SEPOLIA: Token = {
  address: '0xE5b6C29411b3ad31C3613BbA0145293fC9957256',
  symbol: 'USDT',
  decimals: 6,
  name: 'Tether USD (testnet)',
  issuer: 'Tether',
  official: false,
};

/** Per chain, in display order. An empty list means native coin only. */
export const TOKENS: Record<Chain, readonly Token[]> = {
  arbitrum: [USDT_ARBITRUM_SEPOLIA],
  ethereum: [],
};

export function tokensFor(chain: Chain): readonly Token[] {
  return TOKENS[chain] ?? [];
}

/**
 * Find a token by address, case-insensitively.
 *
 * Returns null for anything not pinned above rather than inventing a token from an address —
 * an unknown contract has unknown decimals, and guessing 18 is how an amount becomes wrong by
 * a factor of a million million.
 */
export function tokenAt(chain: Chain, address: string): Token | null {
  const needle = address.trim().toLowerCase();
  return tokensFor(chain).find(token => token.address.toLowerCase() === needle) ?? null;
}

/** Every pinned token across all chains, for the indexer and for display lookups. */
export function allTokens(): readonly Token[] {
  return Object.values(TOKENS).flat();
}

/**
 * How Wally writes a symbol in a sentence. The contract calls itself `USDT`; the product
 * writes `USDt`, and has done since the brand work.
 */
export function displaySymbol(symbol: string): string {
  return symbol === 'USDT' ? 'USDt' : symbol;
}

/**
 * Everything an address on this chain can hold, named the way a sentence needs it.
 *
 * Native coin first, then the pinned tokens: `['ETH', 'USDt']` on Arbitrum, `['ETH']` on
 * Ethereum. The native coin is ETH on both chains here; a chain with a different native coin
 * would need this to read it rather than assume, and there is no such chain yet.
 *
 * **This exists because the same sentence keeps being written by hand and keeps going stale.**
 * Chat denied USDt for eleven days after it shipped (PR #57). A footnote on the Wallet screen
 * said sending it "is not built yet" for the same eleven days (PR #58). The Receive screen said
 * "Send only testnet ETH" and the QVAC system prompt told the model "USDt and Bitcoin are not
 * configured", both still live on 19 Nov 2026 — three weeks and two more surfaces, each written
 * separately and each wrong in the same direction. Deriving it is the only fix that holds:
 * `test/asset-copy.test.ts` fails when a surface stops reading this.
 */
export function assetNamesOn(chain: Chain): readonly string[] {
  return ['ETH', ...tokensFor(chain).map(token => displaySymbol(token.symbol))];
}

/**
 * What a tester has to be told about this token, or null when there is nothing to say.
 *
 * This is the only reader of `official`, and every screen that names a token calls it. The
 * point is that the warning exists *because the data says so*: pin an issuer's real contract,
 * set `official: true`, and the sentence disappears on its own. Nobody has to remember.
 *
 * It deliberately does not mention testnet value. "Testnet funds have no monetary value" is
 * said elsewhere and is a different fact. This one is narrower and easier to miss: the contract
 * is not the issuer's, so a USDt transfer working here proves nothing about Tether's own token,
 * and must not be read as a mainnet path already tested.
 */
export function tokenCaveat(token: Token): string | null {
  return token.official ? null : `This ${token.symbol} is a third-party testnet deployment, not ${token.issuer}'s own contract.`;
}

/** The caveats for everything connected on a chain, in display order. */
export function chainCaveats(chain: Chain): readonly string[] {
  return tokensFor(chain).map(tokenCaveat).filter((caveat): caveat is string => caveat !== null);
}
