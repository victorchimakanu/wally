import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { join } from 'node:path';
import { TOKENS, allTokens, chainCaveats, tokenCaveat, tokensFor, type Token } from '../src/services/tokens.ts';

/**
 * The third-party-deployment warning, and the flag behind it.
 *
 * `official: false` sat in tokens.ts for thirteen days with a doc comment promising it was
 * "surfaced in the app so a tester is never misled into thinking testnet USDt is Tether's".
 * Nothing read it. The warning a user actually saw was a hand-written sentence in
 * WalletData.tsx that said the same thing and also said "sending it is not built yet" — false
 * from 8 November onward, because prose does not move when a feature lands.
 *
 * Two failures in one place: a flag nobody read, and a sentence nobody could keep true. These
 * cases exist to make both of them impossible to reintroduce quietly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const nodeRequire = createRequire(import.meta.url);
const SRC = new URL('../src/', import.meta.url).pathname;

function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'generated' ? [] : sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}


/**
 * Shallow-renders `LiveWalletOverview` by calling it with a stubbed wallet and the REAL token
 * module, so the flag, the helper and the row are all exercised together. Same approach as
 * test/notifications.test.ts; the UI primitives become plain strings and the tree is walked.
 */
function renderBalances({ tokens = true }: { tokens?: boolean } = {}): Value {
  const row = (chain: string, symbol: string, balance: string) =>
    ({ chain, name: chain, chainId: 1, symbol, address: `0x${'1'.repeat(40)}`, qr: '', balance, balanceWei: '1000', error: '' });
  const balances = [row('arbitrum', 'ETH', '0.5'), row('ethereum', 'ETH', '0.25'),
    ...(tokens ? tokensFor('arbitrum').map(token => row('arbitrum', token.symbol, '25')) : [])];
  const snapshot = { version: 1, network: 'testnet', location: 'computer', fetchedAt: 0, balances, tokenNotice: '' };
  const ui = Object.fromEntries(['Button', 'Card', 'Divider', 'Group', 'Label', 'LinkButton', 'Note', 'Pill', 'QrTile', 'ReceiveAddress'].map(name => [name, name]));
  const mocks: Record<string, Value> = {
    react: { useEffect: () => {}, useMemo: (factory: () => Value) => factory(), useState: (initial: Value) => [initial, () => {}] },
    'expo-image': { Image: 'Image' }, 'expo-router': { router: {} }, 'expo-clipboard': {},
    '../services/clipboard-safety.ts': { createClipboardSafety: () => ({}), copyNotice: () => '' },
    'react-native': { Pressable: 'Pressable', Share: {}, View: 'View' },
    './ui': { ...ui, shared: { row: {}, flex: {}, between: {}, center: {}, input: {} }, useShared: () => ({ row: {}, flex: {}, between: {}, center: {}, input: {} }) },
    '../data/wallet': { useWallet: () => ({ snapshot, balances, loading: false, stale: false, offline: false, error: '', refresh: () => {} }) },
    '../services/history-source': { historyProvenance: () => '', historyGap: () => null },
    '../services/custody': { custodyNotice: () => '' },
    '../services/receive-advice': { receiveAdvice: () => '' },
    '../services/wallet-api': { CHAINS: { arbitrum: { name: 'Arbitrum Sepolia' }, ethereum: { name: 'Ethereum Sepolia' } }, formatEth: (value: bigint) => String(value) },
    // The real thing. Stubbing this would leave the test asserting its own fixture.
    '../services/tokens.ts': { tokenCaveat, tokensFor },
    '../data/market': { useMarket: () => ({ assets: [] }) },
    '../services/market-api': { formatPrice: () => '' },
    '../services/fiat-value': { fiatDisplayable: () => false, fiatTotal: () => null, fiatValue: () => null },
    '../demo/preferences': { usePreferences: () => ({ preferences: {} }) },
    '../theme': { colors: {}, fonts: {}, radius: {}, useColors: () => ({}), useTheme: () => ({ palette: {}, dark: false }) },
  };
  const source = readFileSync(join(SRC, 'components/WalletData.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Value };
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    if (name in mocks) return mocks[name];
    if (name === 'react/jsx-runtime') return nodeRequire(name);
    if (/\.(svg|png)$/.test(name)) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports.LiveWalletOverview();
}

/** Every string in a rendered tree, so an assertion can look for a sentence. */
function texts(tree: Value, found: string[] = []): string[] {
  if (typeof tree === 'string') { found.push(tree); return found; }
  if (!tree || typeof tree !== 'object') return found;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) texts(child, found);
  return found;
}

const read = (path: string) => readFileSync(path, 'utf8');
/** Code with comments stripped, so a comment can discuss what the code must not do. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('a deployment that is not the issuer own gets a caveat naming both', () => {
  const unofficial = allTokens().filter(token => !token.official);
  assert.ok(unofficial.length > 0, 'no unofficial token pinned — delete these cases if that is deliberate');
  for (const token of unofficial) {
    const caveat = tokenCaveat(token);
    assert.ok(caveat, `${token.symbol} has no caveat`);
    assert.match(caveat, new RegExp(token.symbol), 'the caveat must say which asset it is about');
    assert.match(caveat, new RegExp(token.issuer), 'the caveat must say whose contract it is not');
    assert.match(caveat, /third-party/);
  }
});

test('an issuer own contract says nothing at all', () => {
  // The property that makes this maintenance-free: pin a real contract and the sentence goes
  // away by itself. If this returned a string, every future mainnet token would carry a
  // warning that does not apply to it.
  const real: Token = { address: `0x${'1'.repeat(40)}`, symbol: 'USDT', decimals: 6, name: 'Tether USD', issuer: 'Tether', official: true };
  assert.equal(tokenCaveat(real), null);
});

test('chainCaveats returns one line per connected token and none for a native-only chain', () => {
  assert.deepEqual(chainCaveats('ethereum'), []);
  assert.equal(TOKENS.ethereum.length, 0, 'Ethereum Sepolia is native-only; update these cases if that changed');
  assert.equal(chainCaveats('arbitrum').length, tokensFor('arbitrum').filter(token => !token.official).length);
});

test('the flag is read through tokenCaveat and nowhere else', () => {
  // A second reader is how two sources of truth start. If some screen grows its own
  // `token.official ? …` the warning can disagree with itself, which is worse than not having
  // one, so the check is on `official` being touched at all outside its own module.
  const offenders = sources()
    .filter(path => !path.endsWith('/services/tokens.ts'))
    .filter(path => /\bofficial\b/.test(code(read(path))));
  assert.deepEqual(offenders.map(path => path.slice(SRC.length)), [], 'these read `official` directly instead of calling tokenCaveat()');
});

test('the balances card actually renders the caveat on a token row', () => {
  // Rendered, not grepped. The first version of this case asserted that WalletData.tsx
  // contained the string "tokenCaveat(" — and deleting the caveat from the token row passed it,
  // because a helper and a footnote elsewhere in the file still mentioned the name. A test that
  // cannot tell those apart is the "three tests were not testing the code they named" problem
  // from 22 Oct, reproduced. So this one calls the component and walks what comes back.
  const card = renderBalances();
  const token = tokensFor('arbitrum').find(entry => !entry.official);
  assert.ok(token, 'no unofficial token on Arbitrum — these cases need revisiting');
  const caveat = tokenCaveat(token);
  assert.ok(caveat);
  assert.ok(texts(card).includes(caveat), `the token row does not show: ${caveat}`);
});

test('a native-only row shows no caveat', () => {
  // The caveat belongs to the token, not to the screen. An ETH row must not inherit it.
  const ethOnly = renderBalances({ tokens: false });
  for (const line of texts(ethOnly)) assert.doesNotMatch(line, /third-party/, `ETH-only view shows: ${line}`);
});

test('the Send screen asks for the caveat beside the asset it is about', () => {
  // Source-level, because LiveSendScreen drives state, effects and the router and is not worth
  // standing up here. Pinned as the rendered element rather than a bare mention of the name, so
  // that deleting the Note fails even though the import survives — the exact gap above.
  assert.match(code(read(join(SRC, 'screens/LiveWallet.tsx'))), /<Note>\{tokenCaveat\(token\)\}<\/Note>/);
});

test('no screen hand-writes the caveat, or the claim that outlived its feature', () => {
  for (const path of sources()) {
    if (path.endsWith('/services/tokens.ts')) continue;
    // `code`, not `read`: this scans for shipped copy, and a comment is not copy. The two
    // phrases below are the historic bugs, so the files that fix them quote them while
    // explaining why — asset-copy.ts tabulates all four. Matching the raw text made writing
    // that explanation impossible, which pushes the reasoning out of the codebase and is the
    // opposite of what these cases are for. `code()` already existed here for this reason and
    // simply was not applied on this line.
    const text = code(read(path));
    assert.doesNotMatch(text, /not Tether/i, `${path.slice(SRC.length)} hand-writes the caveat instead of calling tokenCaveat()`);
    // The sentence that was false for eleven days. Pinned by phrase because the exact wording
    // is what a person would reach for when writing it again.
    assert.doesNotMatch(text, /sending it is not built|not built yet/i, `${path.slice(SRC.length)} still says sending is not built`);
  }
});
