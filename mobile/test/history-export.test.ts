import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_COLUMNS, MAX_PAGES, collectHistory, csvCell, describeGaps, direction, exportFilename,
  historyCsv, isComplete, mergeItems, rowValues, sortForExport, toCsv, toRow,
  type Collected, type PageFetcher,
} from '../src/services/history-export.ts';
import type { Chain, LiveHistory, LiveTransaction } from '../src/services/wallet-api.ts';

/**
 * A tax record has a stricter standard of correctness than a screen: forty-nine of fifty
 * transfers is a slightly wrong screen and a misdeclaration. So these tests are about the
 * three ways this file could lie — executing in the reader's spreadsheet, reporting a transfer
 * in the wrong direction, and being quietly incomplete.
 */

const ME = '0x' + '1'.repeat(40);
const THEM = '0x' + '2'.repeat(40);
const owned: Partial<Record<Chain, string>> = { arbitrum: ME, ethereum: ME };

const tx = (over: Partial<LiveTransaction> = {}): LiveTransaction => ({
  hash: '0x' + 'a'.repeat(64),
  chain: 'arbitrum',
  status: 'confirmed',
  explorerUrl: 'https://sepolia.arbiscan.io/tx/0x' + 'a'.repeat(64),
  from: ME,
  recipient: THEM,
  amount: '1.5',
  fee: '0.00021',
  submittedAt: Date.UTC(2026, 10, 7, 12, 0, 0),
  ...over,
});

const history = (over: Partial<LiveHistory> = {}): LiveHistory =>
  ({ version: 1, fetchedAt: 1, source: 'etherscan', items: [], errors: [], ...over });

// ─── A spreadsheet must not execute the file ─────────────────────────────────────────────────

test('a cell that a spreadsheet would run as a formula is neutralised', () => {
  // Not hypothetical: a token symbol comes off the chain, and anyone can deploy a token whose
  // symbol is a formula. Exporting it raw hands the attacker code in the victim's spreadsheet.
  assert.equal(csvCell('=HYPERLINK("http://evil","Click")'), '"\'=HYPERLINK(""http://evil"",""Click"")"');
  assert.equal(csvCell('+1+1'), "'+1+1");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");

  // A tab or carriage return before the formula character is the usual way past a naive check.
  // Both are neutralised; only the carriage return is also quoted, because a bare tab is
  // ordinary data to a CSV parser while a bare CR would end the record.
  assert.equal(csvCell('\t=1+1'), "'\t=1+1");
  assert.equal(csvCell('\r=1+1'), '"\'\r=1+1"');
});

test('ordinary values survive untouched, including the ones that must stay numbers', () => {
  // The export exists so a spreadsheet can add the amounts up. An apostrophe glued to a figure
  // turns the column into text and defeats the point, so amounts are written unsigned with
  // direction in its own column — nothing legitimate here starts with a minus.
  assert.equal(csvCell('1.5'), '1.5');
  assert.equal(csvCell('0.000000000000000001'), '0.000000000000000001');
  assert.equal(csvCell('0x' + 'a'.repeat(40)), '0x' + 'a'.repeat(40));
  assert.equal(csvCell('2026-11-07T12:00:00.000Z'), '2026-11-07T12:00:00.000Z');

  const row = toRow(tx({ amount: '1.5' }), owned);
  assert.equal(csvCell(row.amount), '1.5', 'an amount must not gain an apostrophe');
});

test('commas and quotes are escaped the way RFC 4180 says', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(toCsv(['a', 'b'], [['1', '2']]), 'a,b\r\n1,2\r\n');
});

test('a hostile token symbol cannot reach the reader as a formula', () => {
  const csv = historyCsv([tx({ symbol: '=1+1' })], owned);
  assert.ok(csv.includes("'=1+1"), 'the symbol must arrive neutralised');
  assert.ok(!/,=1\+1/.test(csv), 'and never as a bare formula cell');
});

// ─── Direction decides whether a transfer is income ──────────────────────────────────────────

test('direction is read from the wallet\'s own address, and refuses to guess', () => {
  assert.equal(direction({ chain: 'arbitrum', from: ME, recipient: THEM }, owned), 'sent');
  assert.equal(direction({ chain: 'arbitrum', from: THEM, recipient: ME }, owned), 'received');

  // Case differs between the indexer, the EIP-55 checksum and the dev server.
  assert.equal(direction({ chain: 'arbitrum', from: ME.toUpperCase().replace('0X', '0x'), recipient: THEM }, owned), 'sent');

  // A transfer filed under the wrong direction is an invented gain or an unclaimed loss, so
  // every case that cannot be decided says so rather than picking the likelier one.
  assert.equal(direction({ chain: 'arbitrum', from: ME, recipient: ME }, owned), 'unknown', 'to self');
  assert.equal(direction({ chain: 'arbitrum', from: THEM, recipient: THEM }, owned), 'unknown', 'neither end is ours');
  assert.equal(direction({ chain: 'arbitrum', recipient: THEM }, owned), 'unknown', 'no sender recorded');
  assert.equal(direction({ chain: 'arbitrum', from: ME, recipient: THEM }, {}), 'unknown', 'our address is unknown');
  assert.equal(direction({ chain: 'ethereum', from: ME, recipient: THEM }, { arbitrum: ME }), 'unknown', 'addresses are per chain');
});

test('the counterparty is the other end, whichever end we are', () => {
  assert.equal(toRow(tx({ from: ME, recipient: THEM }), owned).counterparty, THEM);
  assert.equal(toRow(tx({ from: THEM, recipient: ME }), owned).counterparty, THEM);
});

// ─── Absent data must not read as zero ───────────────────────────────────────────────────────

test('what the chain did not record says so, because a blank cell reads as zero', () => {
  const row = toRow(tx({ amount: undefined, fee: undefined, submittedAt: undefined, recipient: undefined, from: undefined }), owned);
  assert.equal(row.amount, 'not recorded');
  assert.equal(row.feeEth, 'not recorded');
  assert.equal(row.timeUtc, 'not recorded');
  assert.equal(row.counterparty, 'not recorded');
  for (const value of rowValues(row)) assert.notEqual(value, '', 'no cell may be empty');
});

test('a record with no symbol is ETH, which is what it meant before USDt existed', () => {
  assert.equal(toRow(tx({ symbol: undefined }), owned).token, 'ETH');
  assert.equal(toRow(tx({ symbol: 'USDT' }), owned).token, 'USDT');
});

test('times are ISO in UTC and sortable locally', () => {
  const row = toRow(tx({ submittedAt: Date.UTC(2026, 10, 7, 12, 30, 0) }), owned);
  assert.equal(row.timeUtc, '2026-11-07T12:30:00.000Z');
  // sv-SE is ISO-shaped, so a spreadsheet parses the local column as a date rather than text.
  assert.match(row.timeLocal, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // A zero or nonsense timestamp is an absence, not 1970.
  assert.equal(toRow(tx({ submittedAt: 0 }), owned).timeUtc, 'not recorded');
  assert.equal(toRow(tx({ submittedAt: Number.NaN }), owned).timeUtc, 'not recorded');
});

test('the file has a header and one row per transfer', () => {
  const csv = historyCsv([tx(), tx({ hash: '0x' + 'b'.repeat(64) })], owned);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(rowValues(toRow(tx(), owned)).length, CSV_COLUMNS.length, 'columns and values must agree');
});

test('the same history exports identically twice', () => {
  // Two transfers in one block share a timestamp. Without a tiebreak the provider's order
  // leaks through and two downloads of the same history differ, which reads as a changed record.
  const at = Date.UTC(2026, 10, 7, 9, 0, 0);
  const a = tx({ hash: '0x' + 'c'.repeat(64), submittedAt: at });
  const b = tx({ hash: '0x' + 'd'.repeat(64), submittedAt: at });
  assert.equal(historyCsv([a, b], owned), historyCsv([b, a], owned));
});

test('newest first, matching Activity', () => {
  const older = tx({ hash: '0x' + 'e'.repeat(64), submittedAt: 1000 });
  const newer = tx({ hash: '0x' + 'f'.repeat(64), submittedAt: 2000 });
  assert.deepEqual(sortForExport([older, newer]).map(item => item.hash), [newer.hash, older.hash]);
});

// ─── Nothing may be silently missing ─────────────────────────────────────────────────────────

const collected = (over: Partial<Collected> = {}): Collected =>
  ({ items: [], errors: [], reachedLimit: [], complete: ['arbitrum', 'ethereum'], ...over });

test('an export is complete only when every chain answered to the end', () => {
  assert.equal(isComplete(collected()), true);
  assert.equal(isComplete(collected({ errors: ['Ethereum Sepolia history is unavailable right now.'] })), false);
  assert.equal(isComplete(collected({ reachedLimit: ['arbitrum'] })), false);
});

test('every gap is named in words the person filing can act on', () => {
  assert.deepEqual(describeGaps(collected()), []);

  const gaps = describeGaps(collected({
    errors: ['Ethereum Sepolia history needs an indexer API key (set ETHERSCAN_API_KEY).'],
    reachedLimit: ['arbitrum'],
  }));
  assert.equal(gaps.length, 2);
  assert.ok(gaps.some(gap => /ETHERSCAN_API_KEY/.test(gap)), 'the backend already words these for a person');
  assert.ok(gaps.some(gap => /oldest transfers are missing/.test(gap)));
});

test('a partial export says so in its name, because that is what survives being emailed on', () => {
  const day = new Date(Date.UTC(2026, 10, 7, 23, 0, 0));
  assert.equal(exportFilename(day, true), 'wally-activity-2026-11-07.csv');
  assert.equal(exportFilename(day, false), 'wally-activity-2026-11-07-PARTIAL.csv');
});

test('the warning never goes inside the CSV', () => {
  // A comment row breaks every parser that reads the file, so the gap belongs in the screen
  // and the filename. This pins that the file is only ever a header plus rows.
  const csv = historyCsv([tx()], owned);
  assert.ok(csv.startsWith(CSV_COLUMNS[0]!), 'the first byte must be the header');
  assert.ok(!csv.includes('#'), 'no comment row');
  assert.ok(!/PARTIAL/.test(csv));
});

// ─── Paging, which is where records go missing ───────────────────────────────────────────────

function server(pages: Record<string, LiveHistory | Error>): { fetch: PageFetcher; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (chain, page) => {
      asked.push(`${chain}:${page}`);
      const answer = pages[`${chain}:${page}`] ?? history();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

test('it walks every page of every chain, one chain at a time', () => {
  // One chain at a time is not a convenience: the route merges the chains it was asked for,
  // sorts and slices back to fifty, so asking for both drops records that no later page
  // returns. Pinned here because a future "optimisation" to one combined call loses data.
  const { fetch, asked } = server({
    'arbitrum:1': history({ items: [tx({ hash: '0x' + '1'.repeat(64) })], hasMore: true }),
    'arbitrum:2': history({ items: [tx({ hash: '0x' + '2'.repeat(64) })], hasMore: false }),
    'ethereum:1': history({ items: [tx({ chain: 'ethereum', hash: '0x' + '3'.repeat(64), explorerUrl: 'https://sepolia.etherscan.io/tx/0x' + '3'.repeat(64) })], hasMore: false }),
  });
  return collectHistory(['arbitrum', 'ethereum'], fetch).then(result => {
    assert.deepEqual(asked, ['arbitrum:1', 'arbitrum:2', 'ethereum:1']);
    assert.equal(result.items.length, 3);
    assert.equal(isComplete(result), true);
  });
});

test('a chain that fails does not stop the others, and is not hidden', async () => {
  const { fetch } = server({
    'arbitrum:1': history({ items: [tx()], hasMore: false }),
    'ethereum:1': new Error('Ethereum Sepolia history is unavailable right now.'),
  });
  const result = await collectHistory(['arbitrum', 'ethereum'], fetch);

  // Better to let someone file their Arbitrum transfers than hand them nothing — provided the
  // file never arrives claiming to be everything.
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.complete, ['arbitrum']);
  assert.deepEqual(result.errors, ['Ethereum Sepolia history is unavailable right now.']);
  assert.equal(isComplete(result), false);
  assert.equal(exportFilename(new Date(), isComplete(result)).includes('PARTIAL'), true);
});

test('a per-chain error reported inside a 200 is collected too', async () => {
  // The route answers 200 with the other chain's data and puts the failure in errors[].
  const { fetch } = server({
    'arbitrum:1': history({ items: [tx()], errors: ['Ethereum Sepolia history is unavailable.'], hasMore: false }),
  });
  const result = await collectHistory(['arbitrum'], fetch);
  assert.deepEqual(result.errors, ['Ethereum Sepolia history is unavailable.']);
  assert.equal(isComplete(result), false);
});

test('hitting the backend ceiling is reported as its own kind of incomplete', async () => {
  const pages: Record<string, LiveHistory> = {};
  for (let page = 1; page <= MAX_PAGES; page++) {
    pages[`arbitrum:${page}`] = history({ items: [tx({ hash: '0x' + page.toString(16).padStart(64, '0') })], hasMore: true });
  }
  const { fetch, asked } = server(pages);
  const result = await collectHistory(['arbitrum'], fetch);

  assert.equal(asked.length, MAX_PAGES, 'it must not ask past what the backend will answer');
  assert.deepEqual(result.reachedLimit, ['arbitrum']);
  assert.deepEqual(result.complete, []);
  assert.deepEqual(result.errors, [], 'the chain answered; we stopped asking — a different thing');
  assert.ok(describeGaps(result)[0]!.includes('oldest transfers are missing'));
});

test('a server with no paging at all is complete after one page', async () => {
  // The loopback dev wallet serves one list and sends no hasMore. Undefined is the end, not
  // an unknown — treating it as "maybe more" would spend twenty requests on every export.
  const { fetch, asked } = server({ 'arbitrum:1': history({ items: [tx()] }) });
  const result = await collectHistory(['arbitrum'], fetch);
  assert.deepEqual(asked, ['arbitrum:1']);
  assert.equal(isComplete(result), true);
});

test('an empty page ends the walk whatever the flag claims', async () => {
  const { fetch, asked } = server({ 'arbitrum:1': history({ items: [], hasMore: true }) });
  const result = await collectHistory(['arbitrum'], fetch);
  assert.deepEqual(asked, ['arbitrum:1']);
  assert.equal(result.items.length, 0);
  assert.equal(isComplete(result), true, 'nothing behind an empty page');
});

test('the same transfer on two pages is exported once', async () => {
  // Provider pages overlap when a new transaction arrives mid-walk and shifts the window.
  const same = tx({ hash: '0x' + '9'.repeat(64) });
  const { fetch } = server({
    'arbitrum:1': history({ items: [same], hasMore: true }),
    'arbitrum:2': history({ items: [same], hasMore: false }),
  });
  const result = await collectHistory(['arbitrum'], fetch);
  assert.equal(result.items.length, 1);
});

test('the same hash on two different chains is two transfers', () => {
  const hash = '0x' + '7'.repeat(64);
  const merged = mergeItems([history({ items: [
    tx({ chain: 'arbitrum', hash }),
    tx({ chain: 'ethereum', hash, explorerUrl: 'https://sepolia.etherscan.io/tx/' + hash }),
  ] })]);
  assert.equal(merged.length, 2, 'deduplication is per chain, not per hash');
});

// ─── The request itself, where a silent regression would hide ────────────────────────────────

test('the request asks for one chain and one page, which is what makes paging lossless', async () => {
  // If this ever reverts to the two-chain call, the walk still "works" and still produces a
  // file — one quietly missing transfers, because the route merges both chains and slices the
  // result back to fifty. Nothing else in the suite would notice, so the URL is pinned here.
  process.env.EXPO_PUBLIC_WALLY_PROXY_URL = 'http://127.0.0.1:65500';
  const { fetchProxyHistory } = await import(`../src/services/wallet-api.ts?paging=${Date.now()}`);

  const seen: string[] = [];
  const transport = (async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ version: 1, fetchedAt: Date.now(), source: 'etherscan', items: [], errors: [], page: 2, hasMore: false }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const answer = await fetchProxyHistory({ arbitrum: ME }, transport, { chain: 'arbitrum', page: 2 });

  const url = new URL(seen[0]!);
  assert.equal(url.searchParams.get('chain'), 'arbitrum');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('address.arbitrum'), ME);

  // The route sends these and the walk depends on them; parseHistory used to drop both.
  assert.equal(answer.hasMore, false);
  assert.equal(answer.page, 2);
});

test('a server that stops sending the paging fields still parses', async () => {
  // The loopback dev wallet has no pages. Absent must stay absent rather than becoming false,
  // so collectHistory can tell "no paging here" from "this is the last page".
  process.env.EXPO_PUBLIC_WALLY_PROXY_URL = 'http://127.0.0.1:65500';
  const { parseHistory } = await import(`../src/services/wallet-api.ts?nopaging=${Date.now()}`);
  const parsed = parseHistory({ version: 1, fetchedAt: Date.now(), source: 'local', items: [], errors: [] });
  assert.equal('hasMore' in parsed, false);
  assert.equal('page' in parsed, false);
});

test('a nonsense page or hasMore is refused rather than trusted', async () => {
  process.env.EXPO_PUBLIC_WALLY_PROXY_URL = 'http://127.0.0.1:65500';
  const { parseHistory } = await import(`../src/services/wallet-api.ts?badpaging=${Date.now()}`);
  const base = { version: 1, fetchedAt: Date.now(), source: 'etherscan', items: [], errors: [] };
  assert.throws(() => parseHistory({ ...base, page: 0 }), /Invalid activity/);
  assert.throws(() => parseHistory({ ...base, page: 1.5 }), /Invalid activity/);
  assert.throws(() => parseHistory({ ...base, hasMore: 'yes' }), /Invalid activity/);
});
