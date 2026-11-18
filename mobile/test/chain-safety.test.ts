import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_LABELS, chainOfNetwork, chainsUsed, crossChainWarning, type ChainUse } from '../src/services/chain-safety.ts';

/**
 * Every EVM address is valid on every EVM chain, so no send path will ever refuse one for
 * being on the wrong network. The transfer succeeds, the explorer shows it confirmed, and the
 * money is at an address on a chain where nobody can reach it.
 *
 * These cases are mostly about when to stay quiet. A warning that fires on every first payment
 * to a new person is a warning nobody reads, including on the occasion it was right.
 */

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

const used = (address: string, chain: 'arbitrum' | 'ethereum'): ChainUse => ({ address, chain });

// ─── Reading the saved network ───────────────────────────────────────────────────────────────

test('a saved recipient\'s network becomes a chain', () => {
  // The address book stores 'Arbitrum' | 'Ethereum'; everything else speaks lowercase.
  assert.equal(chainOfNetwork('Arbitrum'), 'arbitrum');
  assert.equal(chainOfNetwork('Ethereum'), 'ethereum');
  assert.equal(chainOfNetwork('  ethereum  '), 'ethereum');
});

test('a stored network the code does not recognise is null, never a guess', () => {
  // A value this cannot read must not become a confident claim about where an address has
  // been used — in either direction.
  for (const bad of ['', 'Optimism', 'mainnet', 'Arbitrum One', 'eth', 'undefined']) {
    assert.equal(chainOfNetwork(bad), null, `"${bad}" was read as a chain`);
  }
});

// ─── Which chains an address has been seen on ────────────────────────────────────────────────

test('an address is matched in full, never truncated', () => {
  // A lookalike match is address-safety.ts's question. Answering it here would conflate two
  // different warnings into one that means neither.
  const lookalike = A.slice(0, 6) + 'c'.repeat(30) + A.slice(-4);
  assert.deepEqual(chainsUsed(lookalike, [used(A, 'arbitrum')]), []);
});

test('case and whitespace do not hide a chain an address was used on', () => {
  assert.deepEqual(chainsUsed(`  ${A.toUpperCase()}  `, [used(A, 'arbitrum')]), ['arbitrum']);
});

test('the same address on both chains reports both, once each', () => {
  const uses = [used(A, 'arbitrum'), used(A, 'ethereum'), used(A, 'arbitrum')];
  assert.deepEqual(chainsUsed(A, uses), ['arbitrum', 'ethereum']);
});

test('an empty address matches nothing', () => {
  assert.deepEqual(chainsUsed('', [used(A, 'arbitrum')]), []);
  assert.deepEqual(chainsUsed('   ', [used(A, 'arbitrum')]), []);
});

// ─── When to warn ────────────────────────────────────────────────────────────────────────────

test('warns when an address has only ever been used on the other chain', () => {
  const warning = crossChainWarning({ address: A, chain: 'ethereum', uses: [used(A, 'arbitrum')] });
  assert.ok(warning, 'no warning for an address used only on the other chain');
  assert.match(warning, /only used this address on Arbitrum/);
  assert.match(warning, /on Ethereum/);
});

test('says nothing when the address has been used on this chain before', () => {
  assert.equal(crossChainWarning({ address: A, chain: 'ethereum', uses: [used(A, 'ethereum')] }), null);
  // Used on both: this one is ordinary.
  assert.equal(
    crossChainWarning({ address: A, chain: 'ethereum', uses: [used(A, 'ethereum'), used(A, 'arbitrum')] }),
    null,
  );
});

test('says nothing about an address never seen anywhere', () => {
  // The case this deliberately stays quiet for. A first payment to a new person is the most
  // common thing a wallet does; warning on every one of them trains people to dismiss the
  // warning, including on the occasion that mattered. address-safety.ts covers the dangerous
  // version of an unfamiliar address.
  assert.equal(crossChainWarning({ address: B, chain: 'ethereum', uses: [used(A, 'arbitrum')] }), null);
  assert.equal(crossChainWarning({ address: B, chain: 'ethereum', uses: [] }), null);
});

test('says nothing when there is no address yet', () => {
  assert.equal(crossChainWarning({ address: '', chain: 'ethereum', uses: [used(A, 'arbitrum')] }), null);
});

test('names the mechanism rather than pronouncing a verdict', () => {
  // This cannot tell an EOA from a contract without asking a node, and a warning that waits on
  // the network is a warning that does not appear. So it must not claim the money will be
  // lost, and must not claim it is fine either.
  const warning = crossChainWarning({ address: A, chain: 'ethereum', uses: [used(A, 'arbitrum')] }) ?? '';
  assert.match(warning, /smart account/i);
  assert.match(warning, /could be unreachable/i);
  assert.ok(!/will be lost|is safe|is fine/i.test(warning), warning);
  // It tells them what to actually do, and with whom.
  assert.match(warning, /Check with whoever gave you the address/);
});

test('both chains are named the way the rest of the app names them', () => {
  // A warning that says "arbitrum" while every other screen says "Arbitrum" reads as a bug.
  assert.equal(CHAIN_LABELS.arbitrum, 'Arbitrum');
  assert.equal(CHAIN_LABELS.ethereum, 'Ethereum');
  const warning = crossChainWarning({ address: A, chain: 'arbitrum', uses: [used(A, 'ethereum')] }) ?? '';
  assert.match(warning, /only used this address on Ethereum/);
  assert.ok(!/ethereum[ ,.]/.test(warning), 'a lowercase chain name reached the copy');
});
