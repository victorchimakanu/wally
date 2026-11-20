import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveAdvice } from '../src/services/receive-advice.ts';
import { chainAssetPhrase } from '../src/services/asset-copy.ts';
import { assetNamesOn } from '../src/services/tokens.ts';
import type { Chain } from '../src/services/wallet-api.ts';

/**
 * The Receive screen used to end with a fixed sentence: "The same address works on both test
 * networks." True only by accident — the dev wallet server derives one EOA and serves it for
 * both chains. Arbitrum's real account is an ERC-4337 Safe addressed by the account factory,
 * so the day the on-device keystore runs, the two addresses differ and that sentence starts
 * telling people to send funds somewhere they cannot be recovered from.
 *
 * The *other* half of the sentence went stale the same way, and these tests held it there.
 * Every branch said "Send only testnet ETH" as a literal, and the cases below asserted that
 * literal — so on 8 November, when USDt sending shipped, the screen started telling people not
 * to send the product's flagship asset to an address that displays a balance of it, and the
 * suite stayed green because it was checking the wrong thing. A test that pins a hand-written
 * claim does not protect the claim; it protects the staleness.
 *
 * So the asset names are now read from the same list the screen reads. Add a token to
 * `tokens.ts` and these assertions follow it.
 */

const NAMES: Record<string, string> = { arbitrum: 'Arbitrum Sepolia', ethereum: 'Ethereum Sepolia' };
const nameOf = (chain: Chain) => NAMES[chain] ?? chain;
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);

test('equal addresses may say they are equal', () => {
  // Today's dev-server reality. Still worth saying, because it saves a round trip.
  const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, { arbitrum: A, ethereum: A }, nameOf);
  assert.equal(advice.chainSpecific, false);
  assert.match(advice.text, /same address also works on Ethereum Sepolia/);
});

test('different addresses say so, and name what is lost', () => {
  // Tomorrow's reality, the moment the worklet runs.
  const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, { arbitrum: A, ethereum: B }, nameOf);
  assert.equal(advice.chainSpecific, true);
  assert.match(advice.text, /only to this address/);
  assert.match(advice.text, /Ethereum Sepolia address is different/);
  assert.match(advice.text, /cannot be recovered/);
  assert.ok(!/same address/.test(advice.text), 'the old claim must not survive');
});

test('case differences are not real differences', () => {
  // EIP-55 checksums, the indexer and the dev server disagree about case constantly.
  const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, { arbitrum: A, ethereum: A.toUpperCase().replace('0X', '0x') }, nameOf);
  assert.equal(advice.chainSpecific, false);
});

test('with one chain known, it claims nothing about the other', () => {
  const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, { arbitrum: A }, nameOf);
  assert.equal(advice.text, `Send only ${chainAssetPhrase('arbitrum')} on Arbitrum Sepolia.`);
  assert.equal(advice.chainSpecific, false);
});

test('with no address at all it still says the safe thing', () => {
  const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, {}, nameOf);
  assert.equal(advice.text, `Send only ${chainAssetPhrase('arbitrum')} on Arbitrum Sepolia.`);
});

test('the sentence never claims sameness unless the addresses are the same', () => {
  // The invariant. Any arrangement that mentions "same address" must have matching addresses.
  const cases: Partial<Record<Chain, string>>[] = [
    { arbitrum: A, ethereum: A }, { arbitrum: A, ethereum: B }, { arbitrum: A }, {},
  ];
  for (const addresses of cases) {
    const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, addresses, nameOf);
    if (/same address/.test(advice.text)) {
      const values = Object.values(addresses).map(v => v!.toLowerCase());
      assert.equal(new Set(values).size, 1, `claimed sameness for ${JSON.stringify(addresses)}`);
    }
  }
});

/**
 * The assertion the old suite was missing: the screen must name every asset the chain can
 * actually hold. Written against `assetNamesOn` rather than against a list repeated here, so
 * pinning a second token makes this fail until the screen mentions it.
 */
test('every asset the chain can hold is named, on every branch', () => {
  const arrangements: Partial<Record<Chain, string>>[] = [
    { arbitrum: A, ethereum: A }, { arbitrum: A, ethereum: B }, { arbitrum: A }, {},
  ];
  for (const chain of ['arbitrum', 'ethereum'] as const) {
    for (const addresses of arrangements) {
      const { text } = receiveAdvice(chain, NAMES[chain]!, addresses, nameOf);
      for (const symbol of assetNamesOn(chain)) {
        assert.ok(text.includes(`testnet ${symbol}`),
          `${chain} holds ${symbol} but the Receive screen does not say so: "${text}"`);
      }
    }
  }
});

/** And the converse: it must not name an asset the chain cannot hold. */
test('no asset is named that the chain cannot hold', () => {
  const { text } = receiveAdvice('ethereum', NAMES.ethereum!, { ethereum: A }, nameOf);
  assert.ok(!text.includes('USDt'), `Ethereum Sepolia holds no token, but: "${text}"`);
});
