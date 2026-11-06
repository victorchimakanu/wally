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
  /**
   * False when the deployment is not the token issuer's own. Surfaced in the app so a tester
   * is never misled into thinking testnet USDt is Tether's.
   */
  official: boolean;
};

const USDT_ARBITRUM_SEPOLIA: Token = {
  address: '0xE5b6C29411b3ad31C3613BbA0145293fC9957256',
  symbol: 'USDT',
  decimals: 6,
  name: 'Tether USD (testnet)',
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
