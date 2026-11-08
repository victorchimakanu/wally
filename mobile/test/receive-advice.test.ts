import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveAdvice } from '../src/services/receive-advice.ts';
import type { Chain } from '../src/services/wallet-api.ts';

/**
 * The Receive screen used to end with a fixed sentence: "The same address works on both test
 * networks." True only by accident — the dev wallet server derives one EOA and serves it for
 * both chains. Arbitrum's real account is an ERC-4337 Safe addressed by the account factory,
 * so the day the on-device keystore runs, the two addresses differ and that sentence starts
 * telling people to send funds somewhere they cannot be recovered from.
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
  assert.equal(advice.text, 'Send only testnet ETH on Arbitrum Sepolia.');
  assert.equal(advice.chainSpecific, false);
});

test('with no address at all it still says the safe thing', () => {
  const advice = receiveAdvice('arbitrum', NAMES.arbitrum!, {}, nameOf);
  assert.match(advice.text, /^Send only testnet ETH on Arbitrum Sepolia\.$/);
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
