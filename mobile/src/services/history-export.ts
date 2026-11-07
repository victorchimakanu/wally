import type { Chain, LiveHistory, LiveTransaction } from './wallet-api.ts';

/**
 * Turn Activity into a file a person can keep.
 *
 * FEATURE-AUDIT §11.2 and §11.3. The second is the one with a deadline that is not ours:
 * people need transaction records for tax, and until now the app could produce none — the
 * only hits for "export" in the codebase were `export function`.
 *
 * A tax record has a different standard of correctness from a screen. A screen that shows
 * forty-nine of your fifty transfers is slightly wrong; a tax record that does is a
 * misdeclaration. So the rules here are stricter than the ones Activity lives by, and the
 * three that matter are:
 *
 * **Nothing may be silently missing.** Every reason the export might be incomplete is
 * collected and reported, and an incomplete file is named as one. See `describeGaps`.
 *
 * **Amounts are exact or they are absent.** The backend's `formatUnits` is lossless, so the
 * figures here are the chain's own. Where an amount was dropped upstream for being outside
 * what the app can display, the cell says so rather than being left empty — a blank reads as
 * zero to a spreadsheet and to a person.
 *
 * **A spreadsheet must not execute the file.** See `csvCell`.
 */

/** One row, in column order. Everything is already a string, because CSV has no other type. */
export type ExportRow = {
  /** ISO 8601 UTC. Unambiguous in every locale and sortable as text. */
  timeUtc: string;
  /** The same instant in the phone's timezone, because a tax year is local. */
  timeLocal: string;
  chain: string;
  direction: 'sent' | 'received' | 'unknown';
  counterparty: string;
  amount: string;
  token: string;
  feeEth: string;
  status: string;
  hash: string;
  explorerUrl: string;
};

export const CSV_COLUMNS = [
  'Date (UTC)', 'Date (local)', 'Chain', 'Direction', 'Counterparty',
  'Amount', 'Token', 'Fee (ETH)', 'Status', 'Transaction hash', 'Explorer',
] as const;

/**
 * The characters a spreadsheet treats as the start of a formula rather than text.
 *
 * Excel, LibreOffice and Google Sheets all evaluate a cell beginning with one of these, and a
 * tab or carriage return can smuggle one in past a naive check. The values here are not all
 * ours: a token symbol comes off the chain, and anyone can deploy a token called
 * `=HYPERLINK("http://…","click")`. Exporting that unescaped hands the attacker a formula in
 * the victim's spreadsheet, which is CSV injection (CWE-1236).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: neutralised, then quoted.
 *
 * The leading apostrophe is what stops a formula being evaluated, and it is applied before
 * quoting so that it survives inside the quotes. It is deliberately *not* applied to the
 * amount column by accident: amounts are written unsigned, with direction in its own column,
 * precisely so that no legitimate number starts with `-` and gets an apostrophe glued to it.
 * A column of `'-0.5` is not a column of numbers any more, and the point of the export is
 * that a spreadsheet can add it up.
 */
export function csvCell(value: string): string {
  const text = String(value ?? '');
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180: CRLF line endings, which is what Excel expects on every platform. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Sent, received, or neither — decided against the wallet's own addresses.
 *
 * Returns 'unknown' rather than guessing when the record does not name both ends or the
 * address for that chain is not known. A transfer filed under the wrong direction is an
 * invented gain or an unclaimed loss, so "I cannot tell" is the honest cell.
 *
 * Addresses are compared lowercased: the chain is case-insensitive about them and the
 * indexer, the EIP-55 checksum and the dev server do not agree on case.
 */
export function direction(
  item: Pick<LiveTransaction, 'from' | 'recipient' | 'chain'>,
  owned: Partial<Record<Chain, string>>,
): ExportRow['direction'] {
  const mine = owned[item.chain]?.toLowerCase();
  if (!mine) return 'unknown';
  const from = item.from?.toLowerCase();
  const to = item.recipient?.toLowerCase();
  if (from === mine && to !== mine) return 'sent';
  if (to === mine && from !== mine) return 'received';
  return 'unknown';
}

/** Absent on purpose, and said so. A blank cell reads as zero; this does not. */
const NOT_RECORDED = 'not recorded';

/**
 * A timestamp a spreadsheet will parse, or a stated absence.
 *
 * `submittedAt` is optional on a LiveTransaction — a record read from a provider that did not
 * carry one still exists and still belongs in the export.
 */
function times(at: number | undefined): { utc: string; local: string } {
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return { utc: NOT_RECORDED, local: NOT_RECORDED };
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return { utc: NOT_RECORDED, local: NOT_RECORDED };
  return { utc: date.toISOString(), local: date.toLocaleString('sv-SE') };
}

/** Chain ids are what the app stores; these are what a person reading the file expects. */
const CHAIN_NAMES: Record<string, string> = {
  arbitrum: 'Arbitrum Sepolia',
  ethereum: 'Ethereum Sepolia',
};

export function toRow(item: LiveTransaction, owned: Partial<Record<Chain, string>>): ExportRow {
  const when = times(item.submittedAt);
  const way = direction(item, owned);
  return {
    timeUtc: when.utc,
    timeLocal: when.local,
    chain: CHAIN_NAMES[item.chain] ?? item.chain,
    direction: way,
    // The other end of the transfer, which depends on which end we are.
    counterparty: (way === 'sent' ? item.recipient : way === 'received' ? item.from : item.recipient ?? item.from) ?? NOT_RECORDED,
    amount: item.amount ?? NOT_RECORDED,
    // Absent symbol means the chain's native coin — the meaning every record carried before
    // USDt existed. Defaulting it to ETH here keeps those records readable rather than blank.
    token: item.symbol ?? 'ETH',
    feeEth: item.fee ?? NOT_RECORDED,
    status: item.status,
    hash: item.hash,
    explorerUrl: item.explorerUrl,
  };
}

export function rowValues(row: ExportRow): string[] {
  return [row.timeUtc, row.timeLocal, row.chain, row.direction, row.counterparty,
    row.amount, row.token, row.feeEth, row.status, row.hash, row.explorerUrl];
}

/**
 * Newest first, matching Activity, with a stable tiebreak.
 *
 * Two transfers in one block share a timestamp, and a sort that leaves them in provider order
 * makes the same export differ between runs — which looks like a changed record to anyone
 * diffing two downloads.
 */
export function sortForExport(items: readonly LiveTransaction[]): LiveTransaction[] {
  return [...items].sort((a, b) =>
    (b.submittedAt ?? 0) - (a.submittedAt ?? 0) ||
    a.chain.localeCompare(b.chain) ||
    a.hash.localeCompare(b.hash));
}

export function historyCsv(items: readonly LiveTransaction[], owned: Partial<Record<Chain, string>>): string {
  return toCsv(CSV_COLUMNS, sortForExport(items).map(item => rowValues(toRow(item, owned))));
}

// ─── Completeness ────────────────────────────────────────────────────────────────────────────

/**
 * What was collected, and every reason it might not be everything.
 *
 * `reachedLimit` is its own field rather than another string in `errors` because it is a
 * different kind of incompleteness: the chain answered, we simply stopped asking. Both make
 * the file partial, and the user is told which.
 */
export type Collected = {
  items: LiveTransaction[];
  /** Chains whose history could not be read at all, in the backend's own wording. */
  errors: string[];
  /** Chains with more history behind the last page we fetched. */
  reachedLimit: Chain[];
  /** Chains that answered completely. */
  complete: Chain[];
};

export function isComplete(collected: Collected): boolean {
  return collected.errors.length === 0 && collected.reachedLimit.length === 0;
}

/**
 * Why this export is not a complete record, in sentences for the person about to file it.
 *
 * Empty when nothing is missing. The caller must not paste these into the CSV: a comment row
 * breaks every parser that reads it, so the warning belongs in the screen and the filename.
 */
export function describeGaps(collected: Collected): string[] {
  const gaps: string[] = [...collected.errors];
  for (const chain of collected.reachedLimit) {
    gaps.push(`${CHAIN_NAMES[chain] ?? chain} has more history than this export could reach, so the oldest transfers are missing.`);
  }
  return gaps;
}

/**
 * The file name, which carries the warning that the file itself must not.
 *
 * A partial export that is filed as a complete one is the failure this whole module is
 * arranged against, and the name is the part that survives being emailed to an accountant.
 */
export function exportFilename(at: Date, complete: boolean): string {
  const day = at.toISOString().slice(0, 10);
  return `wally-activity-${day}${complete ? '' : '-PARTIAL'}.csv`;
}

/** Merge pages, dropping the duplicates that overlapping provider pages produce. */
export function mergeItems(pages: readonly LiveHistory[]): LiveTransaction[] {
  const seen = new Set<string>();
  const items: LiveTransaction[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const id = `${item.chain}:${item.hash.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(item);
    }
  }
  return items;
}

// ─── Collecting ──────────────────────────────────────────────────────────────────────────────

/** One page of one chain. Injected so the walk below can be tested without a server. */
export type PageFetcher = (chain: Chain, page: number) => Promise<LiveHistory>;

/**
 * The backend's own ceiling. Asking past it is a 400, so stopping here is not a choice we are
 * making about the user's data — it is the edge of what the service will answer.
 */
export const MAX_PAGES = 20;

/**
 * Walk every page of every chain, and come back with an honest account.
 *
 * One chain at a time, deliberately: see `HistoryPageOptions.chain` in `wallet-api.ts` for why
 * asking for both at once drops records that no later page returns.
 *
 * A chain that fails does not stop the others. Its failure is recorded and the export goes
 * ahead for the rest, because a Nigerian user who can file their Arbitrum transfers today is
 * better served than one handed nothing because Ethereum's indexer was down. What must never
 * happen is the file arriving as though it were everything, which is what `describeGaps` and
 * the PARTIAL filename are for.
 */
export async function collectHistory(
  chains: readonly Chain[],
  fetchPage: PageFetcher,
  maxPages = MAX_PAGES,
): Promise<Collected> {
  const pages: LiveHistory[] = [];
  const errors: string[] = [];
  const reachedLimit: Chain[] = [];
  const complete: Chain[] = [];

  for (const chain of chains) {
    let failed = false;
    let more = false;
    for (let page = 1; page <= maxPages; page++) {
      let answer: LiveHistory;
      try {
        answer = await fetchPage(chain, page);
      } catch (problem) {
        errors.push(problem instanceof Error ? problem.message : `${chain} history is unavailable.`);
        failed = true;
        break;
      }
      pages.push(answer);
      // The route reports a chain it could not read in `errors` while still answering 200 for
      // the other one. Those belong in the account too.
      for (const error of answer.errors) if (!errors.includes(error)) errors.push(error);

      // Undefined means a server with no pages at all — the loopback dev wallet. One list is
      // the whole list there, so this is the end rather than an unknown.
      more = answer.hasMore === true;
      // A page that came back empty has nothing behind it worth another round trip, whatever
      // the flag says. Without this, a server that always sets hasMore spends twenty requests.
      if (!more || answer.items.length === 0) { more = false; break; }
    }
    if (failed) continue;
    if (more) reachedLimit.push(chain); else complete.push(chain);
  }

  return { items: mergeItems(pages), errors, reachedLimit, complete };
}
