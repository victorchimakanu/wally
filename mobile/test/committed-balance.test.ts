import test from 'node:test';
import assert from 'node:assert/strict';
import { availableBase, committedBase, NATIVE_SYMBOL } from '../src/services/committed-balance.ts';
import type { Chain, LiveTransaction } from '../src/services/wallet-api.ts';

/**
 * `eth_getBalance` answers for the latest block, so a broadcast-but-unmined transfer is not
 * deducted from it. The Send screen printed that number under the word "Available".
 *
 * These cases are mostly about the direction of error. Showing less than is really there is a
 * briefly pessimistic number; showing more invites a send that cannot succeed, so every
 * uncertainty has to resolve the cautious way.
 */

const ME = '0x' + '1'.repeat(40);
const ALSO_ME = '0x' + '2'.repeat(40);
const THEM = '0x' + '3'.repeat(40);

let serial = 0;
function tx(over: Partial<LiveTransaction> = {}): LiveTransaction {
  serial++;
  return {
    hash: `0x${serial.toString(16).padStart(64, '0')}`,
    chain: 'ethereum',
    status: 'pending',
    explorerUrl: 'https://sepolia.etherscan.io/tx/0x0',
    from: ME,
    recipient: THEM,
    amount: '1',
    fee: '0.001',
    ...over,
  };
}

const eth = (history: LiveTransaction[], chain: Chain = 'ethereum') =>
  committedBase({ chain, symbol: 'ETH', decimals: 18, owned: [ME, ALSO_ME], history });

const usdt = (history: LiveTransaction[], chain: Chain = 'ethereum') =>
  committedBase({ chain, symbol: 'USDT', decimals: 6, owned: [ME, ALSO_ME], history });

// ─── What counts ─────────────────────────────────────────────────────────────────────────────

test('a pending transfer out commits its amount and its fee', () => {
  // 1 ETH + 0.001 fee
  assert.equal(eth([tx()]).base, 1_001_000_000_000_000_000n);
});

test('a settled transfer commits nothing, because the node already knows', () => {
  for (const status of ['confirmed', 'failed', 'superseded'] as const) {
    assert.equal(eth([tx({ status })]).base, 0n, `${status} was counted`);
  }
});

test('a submission nobody has resolved yet still counts', () => {
  // 'unknown' may still land. Assuming it will not is assuming money back that may be gone.
  assert.ok(eth([tx({ status: 'unknown' })]).base > 0n);
});

test('money coming in commits nothing', () => {
  assert.equal(eth([tx({ from: THEM, recipient: ME })]).base, 0n);
});

test('a transfer on the other chain commits nothing here', () => {
  assert.equal(eth([tx({ chain: 'arbitrum' })], 'ethereum').base, 0n);
  assert.ok(eth([tx({ chain: 'arbitrum' })], 'arbitrum').base > 0n);
});

test('every address this wallet holds is its own, whatever the case', () => {
  assert.ok(eth([tx({ from: ALSO_ME.toUpperCase() })]).base > 0n);
  assert.equal(eth([tx({ from: THEM })]).base, 0n);
});

// ─── Fees are native whatever moved ──────────────────────────────────────────────────────────

test('a pending token transfer commits the token by amount and ETH by fee', () => {
  // The error that looks right: the USDt figure correct and the ETH one quietly short.
  const pendingUsdt = tx({ symbol: 'USDT', amount: '25', fee: '0.002' });
  assert.equal(usdt([pendingUsdt]).base, 25_000_000n, 'USDt at 6 decimals');
  assert.equal(eth([pendingUsdt]).base, 2_000_000_000_000_000n, 'the fee still commits ETH');
});

test('a record with no symbol still means the native coin', () => {
  // Every record written before USDt existed reads this way, so absence has to keep meaning
  // ETH rather than becoming an error.
  const { symbol: _dropped, ...rest } = tx();
  assert.equal(eth([rest as LiveTransaction]).base, 1_001_000_000_000_000_000n);
  assert.equal(NATIVE_SYMBOL, 'ETH');
});

test('a token transfer does not commit a different token', () => {
  assert.equal(usdt([tx({ symbol: 'DAI', amount: '25', fee: '0' })]).base, 0n);
});

test('amounts are read at the asset\'s own scale', () => {
  // Running 6 decimals through 18 is wrong by a factor of a million million and looks
  // perfectly ordinary on the way past.
  assert.equal(usdt([tx({ symbol: 'USDT', amount: '1', fee: '0' })]).base, 1_000_000n);
});

// ─── Uncertainty resolves the cautious way ───────────────────────────────────────────────────

test('an amount that cannot be read is reported, never skipped', () => {
  // Skipping it would understate what is committed and so overstate what is available, which
  // is the one direction this must never fail in silently.
  const { amount: _gone, ...rest } = tx();
  assert.equal(eth([rest as LiveTransaction]).uncertain, true);
  assert.equal(eth([tx({ amount: 'lots' })]).uncertain, true);
});

test('a fee that cannot be read makes the native total uncertain', () => {
  const { fee: _gone, ...rest } = tx();
  assert.equal(eth([rest as LiveTransaction]).uncertain, true);
  // The token total does not depend on the fee, so it stays knowable.
  assert.equal(usdt([tx({ symbol: 'USDT', amount: '25', fee: undefined })]).uncertain, false);
});

test('a clean list is not uncertain', () => {
  assert.equal(eth([tx(), tx()]).uncertain, false);
});

// ─── Turning that into a figure ──────────────────────────────────────────────────────────────

test('available is the balance minus what is committed', () => {
  const committed = eth([tx({ amount: '1', fee: '0' })]);
  const result = availableBase(3_000_000_000_000_000_000n, committed);
  assert.equal(result.base, 2_000_000_000_000_000_000n);
  assert.equal(result.pending, true);
});

test('nothing in flight leaves the balance alone and says so', () => {
  const result = availableBase(5n, eth([]));
  assert.equal(result.base, 5n);
  assert.equal(result.pending, false);
  assert.equal(result.committed, 0n);
});

test('an uncertain total refuses to produce a figure', () => {
  // The screen has to say it does not know. Printing the raw balance under "Available" is the
  // behaviour this whole module exists to end.
  const result = availableBase(5n, eth([tx({ amount: 'lots' })]));
  assert.equal(result.base, null);
  assert.equal(result.pending, true);
});

test('no balance means no available figure', () => {
  assert.equal(availableBase(null, eth([])).base, null);
});

test('it floors at zero rather than going negative', () => {
  // Legitimate: a transfer listed as pending that has already been mined is deducted by the
  // node and again here. Briefly pessimistic beats an unusable negative number.
  const committed = eth([tx({ amount: '10', fee: '0' })]);
  assert.equal(availableBase(1_000_000_000_000_000_000n, committed).base, 0n);
});
