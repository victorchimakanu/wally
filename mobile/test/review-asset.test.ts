import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { CHAINS, parseQuote, type LiveQuote } from '../src/services/wallet-api.ts';

/**
 * What the approval screen says you are about to send.
 *
 * `LiveReviewScreen` hardcoded ETH in four places while `LiveQuote` carried `symbol` and
 * `decimals`. Approving 25 USDt rendered **"25 ETH"**, the button read "Confirm and send ETH",
 * and "Amount + fee" appended ` ETH` to `q.total` — which for a token is the composite string
 * the dev server sends (`"25 USDT + 0.000021 ETH"`) precisely because there is no sum.
 *
 * Every other part of the token path was careful. `parseQuote` refuses a symbol it cannot
 * scale and skips the total arithmetic for tokens; the receipt screen reads `tx.symbol`. It was
 * only the one screen whose entire job is showing a person what they are approving.
 *
 * These cases render the screen rather than reading its source, after a grep-based guard on a
 * sibling change passed while the thing it checked was deleted.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const nodeRequire = createRequire(import.meta.url);
const SRC = new URL('../src/', import.meta.url).pathname;
const ADDRESS = '0x1111111111111111111111111111111111111111';

/** A real quote, built through the real parser, so the fixture cannot accept what the app won't. */
function quote({ symbol = 'ETH', amount = '0.001', total = '0.001021' } = {}): LiveQuote {
  return parseQuote({
    id: '12345678-1234-1234-1234-123456789012', chain: 'arbitrum', chainId: CHAINS.arbitrum.id,
    network: CHAINS.arbitrum.name, symbol, from: ADDRESS, recipient: ADDRESS,
    amount, fee: '0.000021', total, expiresAt: 61_000, expiresInMs: 60_000,
  });
}

function renderReview(q: LiveQuote | null): Value {
  const ui = Object.fromEntries(['Address', 'Button', 'Card', 'Detail', 'Label', 'Note', 'Pill', 'Screen'].map(name => [name, name]));
  const mocks: Record<string, Value> = {
    react: { useEffect: () => {}, useRef: (initial: Value) => ({ current: initial }), useState: (initial: Value) => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'expo-router': { router: {}, useLocalSearchParams: () => ({}) },
    'expo-linking': {},
    'react-native': { Pressable: 'Pressable', TextInput: 'TextInput', View: 'View' },
    '../components/ui': { ...ui, shared: { row: {}, flex: {}, between: {}, center: {}, input: {} } },
    '../services/tokens': { tokenCaveat: () => null, tokensFor: () => [] },
    '../components/WalletData': { AssetChoice: 'AssetChoice', LiveActivityCard: 'LiveActivityCard', LiveReceiveCard: 'LiveReceiveCard', NetworkChoice: 'NetworkChoice', WalletStatus: 'WalletStatus' },
    '../data/wallet': { useWallet: () => ({ quote: q, offline: false, confirm: async () => {}, clearQuote: () => {} }) },
    '../demo/store': { useDemo: () => ({ state: { offline: false } }) },
    '../services/wallet-api': { CHAINS, fetchGasPrice: async () => 0n, formatUnits: (v: bigint) => String(v), isAddress: () => true, parseSendAmount: () => 0n, sendableMax: () => 0n },
    '../services/committed-balance.ts': { availableBase: () => ({ base: 0n, pending: false, committed: 0n }), committedBase: () => ({ base: 0n, uncertain: false }) },
    // Stubbed so a clock cannot decide whether these cases pass. quote-clock has its own tests.
    '../services/quote-clock': { monotonicNow: () => 0, quoteExpired: () => false, secondsLeft: () => 30 },
    '../services/address-safety.ts': { addressTrust: () => null, trustWarning: () => '' },
    '../services/chain-safety.ts': { chainOfNetwork: () => null, crossChainWarning: () => '' },
    '../services/transfer-watch.ts': { readWatch: async () => null, watchStatus: () => null, watchTransfer: async () => null },
    '../demo/preferences': { usePreferences: () => ({}) },
    '../theme': { colors: {}, fonts: {}, radius: {} },
  };
  const source = readFileSync(`${SRC}screens/LiveWallet.tsx`, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Value };
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    if (name in mocks) return mocks[name];
    if (name === 'react/jsx-runtime') return nodeRequire(name);
    if (/\.(svg|png)$/.test(name)) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports.LiveReviewScreen();
}

/**
 * Every string anywhere in the tree — children and string props alike.
 *
 * The props matter here: a Button's text is `label` and a Detail's is `label`/`value`, so a
 * walker that only followed children would read none of the words on this screen.
 */
function words(tree: Value, found: string[] = []): string[] {
  if (typeof tree === 'string') { found.push(tree); return found; }
  if (typeof tree === 'number') { found.push(String(tree)); return found; }
  if (!tree || typeof tree !== 'object') return found;
  for (const [key, value] of Object.entries(tree.props ?? {})) {
    if (key === 'children') continue;
    if (typeof value === 'string' || typeof value === 'number') found.push(String(value));
    else words(value, found);
  }
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) words(child, found);
  return found;
}

/**
 * The screen as one run of text, whitespace collapsed.
 *
 * JSX splits `{q.amount} {q.symbol}` into three children, so a per-string check would never see
 * "25 USDT" — or "25 ETH", which is the bug. Joining first is what makes the assertion the one
 * a person reading the screen would make.
 */
const said = (q: LiveQuote | null) => words(renderReview(q)).join(' ').replace(/\s+/g, ' ');
/**
 * One element's own text, not the screen's.
 *
 * Asserting against the whole screen let two mutations through: dropping the fee from the token
 * note passed because the fee Detail still said it, and mislabelling the fee Detail passed
 * because the note still said it. Two places stating the same fact mask each other's loss, so
 * anything about a specific line has to be read off that line.
 */
function elements(tree: Value, found: Value[] = []): Value[] {
  if (!tree || typeof tree !== 'object') return found;
  if (tree.props) found.push(tree);
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) elements(child, found);
  return found;
}

/** The `value` of the Detail row with this label. */
function detail(tree: Value, label: string): string | undefined {
  const row = elements(tree).find(node => node.type === 'Detail' && node.props.label === label);
  return row ? String(row.props.value) : undefined;
}

/** The text of the first Note that mentions a phrase. */
function note(tree: Value, phrase: string): string | undefined {
  const match = elements(tree)
    .filter(node => node.type === 'Note')
    .map(node => words(node).join(' ').replace(/\s+/g, ' '))
    .find(text => text.includes(phrase));
  return match;
}


test('a token review names the token, not ETH', () => {
  const screen = said(quote({ symbol: 'USDT', amount: '25', total: '25 USDT + 0.000021 ETH' }));
  assert.match(screen, /25 USDT/, `the amount is not shown in USDT: ${screen}`);
  assert.match(screen, /Confirm and send USDT/, 'the confirm button still offers to send ETH');
  // The bug in one assertion: the number the user typed must never appear beside ETH.
  assert.doesNotMatch(screen, /25 ETH/, 'a USDt amount is labelled ETH');
});

test('a token review shows no single total, because there is not one', () => {
  const screen = said(quote({ symbol: 'USDT', amount: '25', total: '25 USDT + 0.000021 ETH' }));
  assert.doesNotMatch(screen, /Amount \+ fee/, 'a token review invents a total');
  // `total` for a token is server prose that parseQuote deliberately does not verify, so it is
  // the one number on this screen nothing checked. It must not be rendered at all.
  assert.doesNotMatch(screen, /25 USDT \+ 0\.000021 ETH/, 'the unverified server total is displayed');
  // Read off the note itself. Both amounts have to be stated there, or "there is no total" is
  // just hiding information — and the fee Detail saying it elsewhere does not count.
  const explanation = note(renderReview(quote({ symbol: 'USDT', amount: '25', total: '25 USDT + 0.000021 ETH' })), 'no single total');
  assert.ok(explanation, 'nothing explains why there is no total');
  assert.match(explanation, /25 USDT/, `the note omits the amount: ${explanation}`);
  assert.match(explanation, /0\.000021 ETH/, `the note omits the fee: ${explanation}`);
});

test('the fee row is always quoted in ETH, token or not', () => {
  // Read off the row, because the token note mentions the fee too and would otherwise cover for
  // a mislabelled one. Gas is native on both chains; a fee in USDT is not a thing that exists.
  for (const q of [quote(), quote({ symbol: 'USDT', amount: '25', total: '25 USDT + 0.000021 ETH' })]) {
    assert.equal(detail(renderReview(q), 'Maximum network fee'), '0.000021 ETH', `fee row wrong for ${q.symbol}`);
  }
});

test('a native review is unchanged, including the total the parser checked', () => {
  const screen = said(quote());
  assert.match(screen, /0\.001 ETH/);
  assert.match(screen, /Confirm and send ETH/);
  assert.match(screen, /Amount \+ fee/);
  assert.match(screen, /0\.001021 ETH/);
  assert.doesNotMatch(screen, /no single total/);
});

test('with no quote the screen asks for a fresh one and offers to send nothing', () => {
  const screen = said(null);
  assert.match(screen, /A fresh review is required/);
  assert.doesNotMatch(screen, /0\.001/);
});
