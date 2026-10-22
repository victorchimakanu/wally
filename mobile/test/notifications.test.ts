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
function fixture(width: number) {
  const hooks: Value[] = [];
  let cursor = 0;
  const stack = ['/wallet'];
  const calls: string[] = [];
  const router = {
    navigate: (route: string) => { calls.push(route); if (stack.at(-1) !== route) stack.push(route); },
    push: (route: string) => stack.push(route),
    canGoBack: () => stack.length > 1,
    back: () => { stack.pop(); },
    replace: (route: string) => { stack[stack.length - 1] = route; },
  };
  const state = { balance: 2090000000, offline: false, transactions: [] };
  const mocks: Record<string, Value> = {
    react: { useState: (initial: Value) => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (next: Value) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; } },
    'react-native': { Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({ width }), StyleSheet: { create: (value: Value) => value } },
    'expo-router': { router }, 'expo-image': { Image: 'Image' },
    './WallyAsset': { WallyAsset: 'WallyAsset', Avatar: 'Avatar' },
    './ui': { Label: 'Label', Button: 'Button', Card: 'Card', Detail: 'Detail', shared: {} },
    '../demo/store': { useDemo: () => ({ state }) },
    '../data/wallet': { useWallet: () => ({ enabled: false }) },
    '../demo/preferences': {}, 'react-native-safe-area-context': {},
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View' }, FadeIn: { duration: () => ({}) } },
    '../demo/model': { money: (amount: number) => String(amount) },
    '../theme': { colors: {}, fonts: {}, radius: {} },
    './WalletData': { LiveWalletOverview: 'LiveWalletOverview' },
  };
  function load(relative: string): Value {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => name in mocks ? mocks[name] : name === 'react/jsx-runtime' ? require(name) : (/\.(svg|png)$/.test(name)) ? {} : (() => { throw new Error(`Unexpected dependency: ${name}`); })() });
    return module.exports;
  }
  const component = load('../src/components/WalletOverview.tsx');
  function render(): Value { cursor = 0; const element = component.WalletOverview(); return element.type(element.props); }
  return { render, hooks, stack, calls, load };
}
function find(tree: Value, label: string): Value {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.props?.accessibilityLabel === label) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) { const found = find(child, label); if (found) return found; }
}

test('767px notifications navigate repeatedly without inline expansion or duplicate mocked routes, then shared Back returns to wallet', () => {
  const f = fixture(767);
  const notification = find(f.render(), 'View notifications');
  assert.ok(notification);
  assert.equal(notification.props.accessibilityState, undefined);
  notification.props.onPress(); notification.props.onPress();
  assert.deepEqual(f.calls, ['/notifications', '/notifications']);
  assert.deepEqual(f.stack, ['/wallet', '/notifications']);
  assert.equal(f.hooks[2], false);
  const header = f.load('../src/components/ui.tsx').Header({ title: 'Notifications' });
  find(header, 'Go back').props.onPress();
  assert.deepEqual(f.stack, ['/wallet']);
});

for (const width of [768, 1280]) test(`${width}px notifications expand and collapse inline without routing`, () => {
  const f = fixture(width);
  let activity = find(f.render(), 'Toggle recent activity');
  assert.equal(activity.props.accessibilityState.expanded, false);
  activity.props.onPress();
  activity = find(f.render(), 'Toggle recent activity');
  assert.equal(activity.props.accessibilityState.expanded, true);
  activity.props.onPress();
  assert.equal(find(f.render(), 'Toggle recent activity').props.accessibilityState.expanded, false);
  assert.deepEqual(f.calls, []);
});

for (const width of [767, 768, 1280]) test(`${width}px wallet expansion stays independent of notification taps`, () => {
  const f = fixture(width);
  find(f.render(), 'Expand wallet balances').props.onPress();
  assert.equal(find(f.render(), 'Collapse wallet balances').props.accessibilityState.expanded, true);
  find(f.render(), width < 768 ? 'View notifications' : 'Toggle recent activity').props.onPress();
  assert.equal(find(f.render(), 'Collapse wallet balances').props.accessibilityState.expanded, true);
  find(f.render(), 'Collapse wallet balances').props.onPress();
  assert.equal(find(f.render(), 'Expand wallet balances').props.accessibilityState.expanded, false);
});

test('shared Back handles a directly opened notification route with no prior screen', () => {
  const f = fixture(767);
  f.stack[0] = '/notifications';
  find(f.load('../src/components/ui.tsx').Header({ title: 'Notifications' }), 'Go back').props.onPress();
  assert.deepEqual(f.stack, ['/wallet']);
});
