import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Component-handler tests, not a native renderer or an Expo Router integration test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 type Value = any;
const require = createRequire(import.meta.url);
const VICTOR = '0x1111111111111111111111111111111111111111';
function fixture(width: number, transactions: Value[] = []) {
  const hooks: Value[] = [];
  let cursor = 0;
  const stack = ['/wallet'];
  const router = {
    navigate: (route: string) => { if (stack.at(-1) !== route) stack.push(route); },
    push: (route: string) => stack.push(route),
    canGoBack: () => stack.length > 1,
    back: () => { stack.pop(); },
    replace: (route: string) => { stack[stack.length - 1] = route; },
  };
  const state = { balance: 2090000000, offline: false, transactions };
  const mocks: Record<string, Value> = {
    react: { useState: (initial: Value) => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (next: Value) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; } },
    'react-native': { Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({ width }), StyleSheet: { create: (value: Value) => value } },
    'expo-router': { router }, 'expo-image': { Image: 'Image' },
    './WallyAsset': { WallyAsset: 'WallyAsset', Avatar: 'Avatar', Lockup: 'Lockup' },
    './ui': { Label: 'Label', Button: 'Button', Card: 'Card', Detail: 'Detail', LinkButton: 'LinkButton', useShared: () => ({}) },
    '../demo/store': { useDemo: () => ({ state }) },
    '../data/wallet': { useWallet: () => ({ enabled: false }) },
    '../demo/preferences': { usePreferences: () => ({ preferences: { recipients: [{ name: 'Victor', address: VICTOR }] } }) },
    'react-native-safe-area-context': {},
    './shell': { useShell: () => ({ wide: false, topLevel: false }) },
    '../data/market': { useMarket: () => ({ data: { assets: [{ symbol: 'USDT', price: 1, currency: 'USD' }] }, currency: 'USD' }) },
    '../services/fiat-value': { fiatValue: (amount: string, symbol: string, assets: Value[], currency: string) => ({ amount: Number(amount) * assets[0].price, currency }) },
    '../services/market-api': { formatPrice: (amount: number, currency: string) => `${currency} ${amount}` },
    '../services/transfer-summary': { nameFor: (address: string, recipients: Value[]) => recipients.find(entry => entry.address === address)?.name ?? null },
    '../services/when': { whenLabel: () => 'Today, 10:42' },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View' }, FadeIn: { duration: () => ({}) } },
    '../demo/model': { money: (amount: number) => (amount / 1_000_000).toFixed(2), units: (amount: string) => Number(amount) * 1_000_000 },
    '../theme': { useColors: () => ({}), useTheme: () => ({ palette: {}, dark: false }), makeStyles: (factory: (c: Value) => Value) => () => factory({}), fonts: {}, radius: {} },
    './WalletData': { LiveWalletOverview: 'LiveWalletOverview' },
  };
  function load(relative: string): Value {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => name in mocks ? mocks[name] : name === 'react/jsx-runtime' ? require(name) : (/\.(svg|png)$/.test(name)) ? {} : (() => { throw new Error(`Unexpected dependency: ${name}`); })() });
    return module.exports;
  }
  // The real card, so the tests see what the overview actually puts on screen.
  mocks['./WalletCard'] = load('../src/components/WalletCard.tsx');
  const component = load('../src/components/WalletOverview.tsx');
  function render(props: Value = {}): Value {
    cursor = 0;
    let element = component.WalletOverview(props);
    // Function components stand in for their output until a host element is reached.
    while (typeof element?.type === 'function') element = element.type(element.props);
    return element;
  }
  return { render, hooks, stack, load };
}
function find(tree: Value, label: string): Value {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.props?.accessibilityLabel === label) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) { const found = find(child, label); if (found) return found; }
}

for (const width of [375, 767, 1280]) test(`${width}px: the card's tab opens Activity, at every width and never inline`, () => {
  const f = fixture(width);
  const tab = find(f.render(), 'No activity yet');
  assert.ok(tab, 'the tab says there is nothing yet');
  assert.equal(tab.props.accessibilityState, undefined);
  tab.props.onPress();
  assert.deepEqual(f.stack, ['/wallet', '/history']);
});

for (const width of [375, 767, 1280]) test(`${width}px: expanding the balances stays independent of the tab`, () => {
  const f = fixture(width);
  find(f.render(), 'Expand wallet balances').props.onPress();
  assert.equal(find(f.render(), 'Collapse wallet balances').props.accessibilityState.expanded, true);
  find(f.render(), 'No activity yet').props.onPress();
  assert.equal(find(f.render(), 'Collapse wallet balances').props.accessibilityState.expanded, true);
  find(f.render(), 'Collapse wallet balances').props.onPress();
  assert.equal(find(f.render(), 'Expand wallet balances').props.accessibilityState.expanded, false);
});

test('the tab names the latest transfer, with the saved recipient and its state', () => {
  const f = fixture(375, [{ id: 'tx-1', recipient: VICTOR, amount: '25', status: 'pending', submittedAt: 0 }]);
  const tab = find(f.render(), 'Sending 25.00 USDt to Victor. Pending · Arbitrum');
  assert.ok(tab, 'the tab reads as a sentence about the transfer');
  tab.props.onPress();
  assert.deepEqual(f.stack, ['/wallet', '/history']);
});

test('the chat answer is the bare card: no avatar, no tab, the same figures', () => {
  const f = fixture(375);
  const tree = f.render({ snapshot: true, balance: 2090000000 });
  assert.equal(find(tree, 'View profile'), undefined);
  assert.equal(find(tree, 'No activity yet'), undefined);
  assert.ok(find(tree, 'About USD 2090'));
});

test('shared Back handles a directly opened Activity route with no prior screen', () => {
  const f = fixture(767);
  f.stack[0] = '/history';
  find(f.load('../src/components/ui.tsx').Header({ title: 'Activity' }), 'Go back').props.onPress();
  assert.deepEqual(f.stack, ['/wallet']);
});

test('the demo card says what the fictional balance is worth in the chosen currency', () => {
  const f = fixture(767);
  // 2,090,000,000 base units is 2,090 USDt, priced at 1 USD each by the market mock above.
  assert.ok(find(f.render(), 'About USD 2090'), 'the fiat line carries an accessible label');
});
