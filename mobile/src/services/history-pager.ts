/**
 * Reading past the fiftieth transaction.
 *
 * The backend has served `/v1/history?page=N` with a `hasMore` flag since 5 November 2026, and
 * `history-export.ts` has walked every page of it since. The Activity screen never asked. So a
 * person's older history was reachable by exporting a CSV and not by scrolling — the data was
 * there, the server would hand it over, and the one surface built for reading it stopped at
 * fifty. This module is the missing half.
 *
 * ## Why this pages one chain at a time
 *
 * The route accepts both chains in one request, fetches a page from each, merges, sorts by time
 * and slices the result back to fifty. With both asked for, up to fifty of the hundred fetched
 * are discarded — and page 2 is *the provider's* page 2 of each chain, so the discarded ones are
 * not in it either. They are gone for good. `HistoryPageOptions.chain` in `wallet-api.ts` says
 * the same thing from the other side.
 *
 * One chain per request makes the merge a no-op and the slice harmless, so the pages line up
 * end to end with nothing dropped between them. The merging then happens here, across a list
 * that only ever grows, where nothing has to be thrown away to fit.
 *
 * That costs one extra round trip on first load. The backend coalesces identical concurrent
 * calls and caches history, and the two requests are made in parallel, so the cost is a second
 * connection rather than a second wait — which is worth paying to stop losing records.
 */
import type { Chain, LiveHistory, LiveTransaction } from './wallet-api';

/**
 * How far through one chain we have read, and whether anything is behind it.
 *
 * `next` is the page to ask for if the user asks for more; `more` is false once the chain has
 * answered completely, failed, or hit the server's ceiling. A chain is only asked again while
 * `more` is true, so an exhausted chain costs nothing on later presses.
 */
export type ChainCursor = { chain: Chain; next: number; more: boolean };

/** Everything read so far, with every reason it might not be everything. */
export type PagedHistory = {
  items: LiveTransaction[];
  cursors: ChainCursor[];
  /** Per-chain failures, in the backend's own wording. Carried, never thrown. */
  errors: string[];
  fetchedAt: number;
  source: string;
};

/**
 * The backend's own ceiling (`MAX_PAGE` in `backend/src/indexer.ts`). Asking past it is a 400,
 * so stopping here is the edge of what the service answers rather than a limit we chose.
 */
export const MAX_PAGE = 20;

/** One page of one chain. Injected so the walk below is testable without a server. */
export type PageFetcher = (chain: Chain, page: number) => Promise<LiveHistory>;

/**
 * Drop repeats and order newest first.
 *
 * Provider pages overlap — a transaction confirming between two requests shifts the window —
 * so the same hash can arrive twice. Identity is chain *and* hash: the same hash on two chains
 * is two transactions, and collapsing them would hide one.
 *
 * Earlier copies win, because a record already on screen has been looked at and should not
 * change under the reader. A later page re-reporting it adds nothing a refresh would not.
 */
export function dedupeTransactions(items: readonly LiveTransaction[]): LiveTransaction[] {
  const seen = new Set<string>();
  const unique: LiveTransaction[] = [];
  for (const item of items) {
    const id = `${item.chain}:${item.hash.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique.sort(newestFirst);
}

/**
 * Newest first, with a stable tiebreak.
 *
 * Two transfers in one block share a timestamp, and leaving those in provider order makes the
 * same list come back differently between reads — a pair that swaps places when more is loaded
 * reads as the list having changed under you. `history-export.ts` found this first, for files
 * that differ between downloads; the screen has the same problem for the same reason, so both
 * sort through this one comparator.
 */
export function newestFirst(a: LiveTransaction, b: LiveTransaction): number {
  return (b.submittedAt ?? 0) - (a.submittedAt ?? 0)
    || a.chain.localeCompare(b.chain)
    || a.hash.localeCompare(b.hash);
}

/** Whether any chain has history behind what has been read. */
export function hasMore(paged: PagedHistory | null): boolean {
  return !!paged?.cursors.some(cursor => cursor.more);
}

/** The chains that would be asked if more were requested now. */
export function pendingChains(paged: PagedHistory | null): Chain[] {
  return (paged?.cursors ?? []).filter(cursor => cursor.more).map(cursor => cursor.chain);
}

/**
 * Read one page from each chain, in parallel, and fold the answers in.
 *
 * A chain that fails does not stop the others and does not end its own paging either: the
 * cursor stays where it was with `more` intact, so pressing again retries that chain rather
 * than silently writing off the rest of its history. A network blip must not look like the end
 * of the list — that is the failure this whole module exists to stop.
 */
async function readPage(
  chains: readonly ChainCursor[],
  fetchPage: PageFetcher,
  previous: PagedHistory | null,
): Promise<PagedHistory> {
  const answers = await Promise.all(chains.map(async cursor => {
    try {
      return { cursor, page: await fetchPage(cursor.chain, cursor.next), failure: null as string | null };
    } catch (problem) {
      const reason = problem instanceof Error ? problem.message : `${cursor.chain} history is unavailable.`;
      return { cursor, page: null, failure: reason };
    }
  }));

  const errors: string[] = [];
  const add = (reason: string) => { if (!errors.includes(reason)) errors.push(reason); };
  // A previous page's failure is not carried forward: it described that attempt, and this one
  // has now happened. A chain that failed again reports it again below.
  const cursors: ChainCursor[] = [];
  const fetched: LiveTransaction[] = [];
  let fetchedAt = 0;
  let source = '';

  for (const answer of answers) {
    if (!answer.page) {
      add(answer.failure ?? 'Activity is unavailable.');
      cursors.push(answer.cursor); // unchanged: retry this same page next press
      continue;
    }
    const page = answer.page;
    // The route answers 200 for one chain while reporting the other in `errors`.
    for (const reason of page.errors) add(reason);
    fetched.push(...page.items);
    fetchedAt = Math.max(fetchedAt, page.fetchedAt);
    if (page.source && !source) source = page.source;

    // `hasMore` undefined means a server with no paging at all — the loopback dev wallet. One
    // list is the whole list there, so that is the end rather than something unknown.
    //
    // An empty page has nothing behind it worth another round trip whatever the flag says.
    // Without this, a server that always sets hasMore would be asked twenty times.
    const more = page.hasMore === true && page.items.length > 0 && answer.cursor.next < MAX_PAGE;
    cursors.push({ chain: answer.cursor.chain, next: answer.cursor.next + 1, more });
  }

  // Chains not asked this round keep their cursors untouched.
  const asked = new Set(chains.map(cursor => cursor.chain));
  for (const cursor of previous?.cursors ?? []) if (!asked.has(cursor.chain)) cursors.push(cursor);

  return {
    items: dedupeTransactions([...(previous?.items ?? []), ...fetched]),
    cursors,
    errors,
    fetchedAt: fetchedAt || previous?.fetchedAt || Date.now(),
    // A continuation keeps the label the first page established. `withLocalSubmissions` has
    // usually appended "and this device's submissions" to it by then, and letting page 2
    // overwrite that with the bare provider name would quietly drop a true statement about
    // where the list came from.
    source: previous?.source || source || '',
  };
}

/** Start again from page 1 of every chain, discarding anything read before. */
export function loadFirstPage(chains: readonly Chain[], fetchPage: PageFetcher): Promise<PagedHistory> {
  return readPage(chains.map(chain => ({ chain, next: 1, more: true })), fetchPage, null);
}

/**
 * Read the next page of every chain that still has one.
 *
 * Resolves to the list unchanged when nothing is outstanding, so a caller that presses twice
 * spends no requests on the second press.
 */
export async function loadNextPage(current: PagedHistory, fetchPage: PageFetcher): Promise<PagedHistory> {
  const outstanding = current.cursors.filter(cursor => cursor.more);
  if (!outstanding.length) return current;
  return readPage(outstanding, fetchPage, current);
}

/**
 * Fold this device's own submissions into a paged list.
 *
 * The backend cannot see a transaction this phone submitted but never got a receipt for, so a
 * just-sent transfer would vanish from Activity if the indexed list simply replaced the local
 * one. Indexed records win on a duplicate — the indexer is authoritative about whether
 * something confirmed, while a local record only knows what this device last checked — which
 * `dedupeTransactions` gives for free by keeping the earlier copy, remote first.
 *
 * `local.errors` is dropped: those describe the loopback server's own indexer attempt, which is
 * not what Activity is built from, so repeating them would say something untrue.
 */
export function withLocalSubmissions(paged: PagedHistory, local: LiveHistory): PagedHistory {
  return {
    ...paged,
    items: dedupeTransactions([...paged.items, ...local.items]),
    source: paged.source ? `${paged.source} and this device's submissions` : local.source,
  };
}

/**
 * The shape the screens already read.
 *
 * `LiveHistory` is what every Activity surface consumes, so a paged list is handed over as one
 * rather than teaching each of them a second shape. The fifty-item cap that `parseHistory`
 * enforces is deliberately *not* applied: that is a contract about one response from the
 * server, not about how much a reader may accumulate, and re-imposing it here would undo the
 * entire point of paging.
 */
export function asLiveHistory(paged: PagedHistory): LiveHistory {
  return {
    version: 1,
    fetchedAt: paged.fetchedAt,
    source: paged.source,
    items: paged.items,
    errors: paged.errors,
    hasMore: hasMore(paged),
  };
}
