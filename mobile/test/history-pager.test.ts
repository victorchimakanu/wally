import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PAGE, asLiveHistory, dedupeTransactions, hasMore, loadFirstPage, loadNextPage,
  newestFirst, pendingChains, withLocalSubmissions, type PagedHistory,
} from '../src/services/history-pager.ts';
import type { Chain, LiveHistory, LiveTransaction } from '../src/services/wallet-api.ts';

/**
 * Transaction 51 used to be unreachable from the screen. These tests are mostly about the
 * ways a pager can quietly lose records or quietly stop early — a blip that reads as the end
 * of someone's history is the failure that matters here, not an off-by-one in a count.
 */

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────

let serial = 0;
function tx(over: Partial<LiveTransaction> = {}): LiveTransaction {
  serial++;
  return {
    hash: `0x${serial.toString(16).padStart(64, '0')}`,
    chain: 'ethereum',
    status: 'confirmed',
    explorerUrl: 'https://sepolia.etherscan.io/tx/0x0',
    submittedAt: 1_700_000_000_000 - serial * 1000,
    ...over,
  };
}

function page(items: LiveTransaction[], over: Partial<LiveHistory> = {}): LiveHistory {
  return { version: 1, fetchedAt: 1_700_000_000_000, source: 'Etherscan', items, errors: [], ...over };
}

/** A server holding `counts` pages per chain, recording every request it is asked for. */
function server(counts: Partial<Record<Chain, number>>, perPage = 2) {
  const asked: string[] = [];
  const fetchPage = async (chain: Chain, pageNumber: number): Promise<LiveHistory> => {
    asked.push(`${chain}:${pageNumber}`);
    const total = counts[chain] ?? 0;
    if (pageNumber > total) return page([], { hasMore: false });
    return page(Array.from({ length: perPage }, () => tx({ chain })), { hasMore: pageNumber < total });
  };
  return { asked, fetchPage };
}

// ─── Dedupe and order ────────────────────────────────────────────────────────────────────────

test('the same hash on two chains is two transactions, not one', () => {
  const hash = `0x${'a'.repeat(64)}`;
  assert.equal(dedupeTransactions([tx({ hash, chain: 'ethereum' }), tx({ hash, chain: 'arbitrum' })]).length, 2);
});

test('duplicates are matched regardless of hash case', () => {
  // Providers differ on case. Matching on the literal string would show the same transfer
  // twice, once per spelling.
  const lower = tx({ hash: `0x${'d'.repeat(64)}` });
  const upper = tx({ hash: `0x${'D'.repeat(64)}` });
  assert.equal(dedupeTransactions([lower, upper]).length, 1);
});

test('a repeat from an overlapping page keeps the copy already on screen', () => {
  const first = tx({ status: 'pending' });
  const again: LiveTransaction = { ...first, status: 'confirmed' };
  // Remote pages are folded in before local ones for exactly this reason: whichever list is
  // authoritative has to come first.
  assert.equal(dedupeTransactions([first, again])[0]?.status, 'pending');
  assert.equal(dedupeTransactions([again, first])[0]?.status, 'confirmed');
});

test('two transfers in one block keep a stable order across reads', () => {
  const at = 1_700_000_000_000;
  const a = tx({ hash: `0x${'1'.repeat(64)}`, submittedAt: at });
  const b = tx({ hash: `0x${'2'.repeat(64)}`, submittedAt: at });
  // The provider may hand these over in either order; the screen must not reshuffle them when
  // a later page arrives, or the list looks like it changed under the reader.
  assert.deepEqual(
    dedupeTransactions([a, b]).map(item => item.hash),
    dedupeTransactions([b, a]).map(item => item.hash),
  );
});

test('newestFirst puts the most recent transfer at the top', () => {
  const older = tx({ submittedAt: 1 }), newer = tx({ submittedAt: 2 });
  assert.equal([older, newer].sort(newestFirst)[0], newer);
});

// ─── Paging ──────────────────────────────────────────────────────────────────────────────────

test('each chain is asked for its own page, never both at once', async () => {
  const { asked, fetchPage } = server({ ethereum: 1, arbitrum: 1 });
  await loadFirstPage(['ethereum', 'arbitrum'], fetchPage);
  assert.deepEqual(asked, ['ethereum:1', 'arbitrum:1']);
});

test('a chain with more behind it leaves the list continuable', async () => {
  const { fetchPage } = server({ ethereum: 3, arbitrum: 1 });
  const first = await loadFirstPage(['ethereum', 'arbitrum'], fetchPage);
  assert.equal(hasMore(first), true);
  assert.deepEqual(pendingChains(first), ['ethereum']);
});

test('a server that does not page at all ends the list rather than looking unfinished', async () => {
  // The loopback dev wallet omits hasMore entirely. Undefined is the end, not the unknown:
  // offering a Load more there would spend a request to add nothing.
  const fetchPage = async () => page([tx()]);
  assert.equal(hasMore(await loadFirstPage(['ethereum'], fetchPage)), false);
});

test('a page that comes back empty ends the chain whatever the flag claims', async () => {
  // Without this a server that always sets hasMore would be asked twenty times for nothing.
  const fetchPage = async () => page([], { hasMore: true });
  assert.equal(hasMore(await loadFirstPage(['ethereum'], fetchPage)), false);
});

test('loading more appends, so the reader keeps their place', async () => {
  const { fetchPage } = server({ ethereum: 2 });
  const first = await loadFirstPage(['ethereum'], fetchPage);
  const second = await loadNextPage(first, fetchPage);
  assert.equal(second.items.length, 4);
  assert.deepEqual(second.items.slice(0, 2).map(item => item.hash), first.items.map(item => item.hash));
});

test('reads past fifty, which is the whole point', async () => {
  const { fetchPage } = server({ ethereum: 3 }, 50);
  let state = await loadFirstPage(['ethereum'], fetchPage);
  assert.equal(state.items.length, 50);
  while (hasMore(state)) state = await loadNextPage(state, fetchPage);
  // Transaction 51 and everything behind it was permanently invisible before this existed.
  assert.equal(state.items.length, 150);
});

test('an exhausted chain is never asked again', async () => {
  const { asked, fetchPage } = server({ ethereum: 2, arbitrum: 1 });
  let state = await loadFirstPage(['ethereum', 'arbitrum'], fetchPage);
  state = await loadNextPage(state, fetchPage);
  assert.deepEqual(asked, ['ethereum:1', 'arbitrum:1', 'ethereum:2']);
  assert.equal(hasMore(state), false);
});

test('pressing again once everything is read spends no requests', async () => {
  const { asked, fetchPage } = server({ ethereum: 1 });
  const first = await loadFirstPage(['ethereum'], fetchPage);
  assert.equal(await loadNextPage(first, fetchPage), first);
  assert.deepEqual(asked, ['ethereum:1']);
});

test('stops at the backend ceiling instead of being refused by it', async () => {
  // A server that always claims more would be asked forever; past MAX_PAGE the route answers
  // 400, so the walk has to stop on its own.
  const fetchPage = async (chain: Chain, pageNumber: number) => {
    assert.ok(pageNumber <= MAX_PAGE, `asked for page ${pageNumber}, past the ceiling`);
    return page([tx({ chain })], { hasMore: true });
  };
  let state = await loadFirstPage(['ethereum'], fetchPage);
  for (let i = 0; i < MAX_PAGE + 5 && hasMore(state); i++) state = await loadNextPage(state, fetchPage);
  assert.equal(hasMore(state), false);
  assert.equal(state.items.length, MAX_PAGE);
});

// ─── Failure ─────────────────────────────────────────────────────────────────────────────────

test('a chain that fails does not stop the other, and does not end its own history', async () => {
  const fetchPage = async (chain: Chain) => {
    if (chain === 'ethereum') throw new Error('Ethereum history is unavailable.');
    return page([tx({ chain })], { hasMore: false });
  };
  const first = await loadFirstPage(['ethereum', 'arbitrum'], fetchPage);
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.errors, ['Ethereum history is unavailable.']);
  // The critical part: a blip must not look like the end of the list.
  assert.deepEqual(pendingChains(first), ['ethereum']);
});

test('a failed page is retried, not skipped past', async () => {
  const asked: number[] = [];
  let failures = 1;
  const fetchPage = async (chain: Chain, pageNumber: number) => {
    asked.push(pageNumber);
    if (failures-- > 0) throw new Error('Activity took too long to load. Try again.');
    return page([tx({ chain })], { hasMore: false });
  };
  const first = await loadFirstPage(['ethereum'], fetchPage);
  const second = await loadNextPage(first, fetchPage);
  assert.deepEqual(asked, [1, 1]);
  assert.equal(second.items.length, 1);
  assert.deepEqual(second.errors, []);
});

test('a per-chain error reported inside a 200 is carried, not dropped', async () => {
  const fetchPage = async () => page([tx()], { hasMore: false, errors: ['Arbitrum history is unavailable.'] });
  assert.deepEqual((await loadFirstPage(['ethereum'], fetchPage)).errors, ['Arbitrum history is unavailable.']);
});

test('a stale error from an earlier page is not repeated once it is fixed', async () => {
  let failing = true;
  const fetchPage = async (chain: Chain) => {
    const errors = failing ? ['Arbitrum history is unavailable.'] : [];
    failing = false;
    return page([tx({ chain })], { hasMore: true, errors });
  };
  const first = await loadFirstPage(['ethereum'], fetchPage);
  assert.equal(first.errors.length, 1);
  assert.deepEqual((await loadNextPage(first, fetchPage)).errors, []);
});

// ─── Handing it to the screens ───────────────────────────────────────────────────────────────

test("this device's own submissions survive, and the indexed copy wins", async () => {
  const hash = `0x${'c'.repeat(64)}`;
  const indexed = tx({ hash, status: 'confirmed' });
  const mine = tx({ hash, status: 'pending' });
  const unseen = tx({ status: 'pending' });
  const paged = withLocalSubmissions(
    await loadFirstPage(['ethereum'], async () => page([indexed], { hasMore: false })),
    page([mine, unseen], { source: 'local receipts', errors: ['the loopback indexer complaining'] }),
  );
  assert.equal(paged.items.length, 2);
  assert.equal(paged.items.find(item => item.hash === hash)?.status, 'confirmed');
  assert.ok(paged.items.some(item => item.hash === unseen.hash), 'a just-sent transfer must not vanish');
  // The loopback server's own indexer complaints describe a fetch Activity is not built on.
  assert.deepEqual(paged.errors, []);
  assert.equal(paged.source, "Etherscan and this device's submissions");
});

test('the fifty-item cap is not re-imposed on an accumulated list', async () => {
  const { fetchPage } = server({ ethereum: 2 }, 50);
  let state = await loadFirstPage(['ethereum'], fetchPage);
  state = await loadNextPage(state, fetchPage);
  // parseHistory caps one response at fifty. That is a contract about the server's answer, not
  // a limit on how much a reader may accumulate; capping here would undo the paging.
  assert.equal(asLiveHistory(state).items.length, 100);
});

test('loading more does not overwrite the label with the bare provider name', async () => {
  const { fetchPage } = server({ ethereum: 2 });
  const first = withLocalSubmissions(
    await loadFirstPage(['ethereum'], fetchPage),
    page([], { source: 'local receipts' }),
  );
  assert.equal(asLiveHistory(await loadNextPage(first, fetchPage)).source, "Etherscan and this device's submissions");
});

test('hasMore reaches the screen so the button can appear', async () => {
  const { fetchPage } = server({ ethereum: 2 });
  assert.equal(asLiveHistory(await loadFirstPage(['ethereum'], fetchPage)).hasMore, true);
});

test('an empty list is not continuable', () => {
  const empty: PagedHistory = { items: [], cursors: [], errors: [], fetchedAt: 0, source: '' };
  assert.equal(hasMore(empty), false);
  assert.equal(hasMore(null), false);
});
