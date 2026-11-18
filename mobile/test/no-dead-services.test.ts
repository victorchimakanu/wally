import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every service module must be reachable from the app.
 *
 * This exists because the same mistake happened four times. `spendAllowed`, `send-gate` and
 * `maxSendable` were each written, tested, reviewed and wired to nothing — and two of the
 * three were hiding real bugs behind a green suite. `fiat-value.ts` made it four. A module
 * with tests and no caller is the most expensive kind of code in a repository: it costs
 * review, it reads as finished, and it protects nobody.
 *
 * A green test suite cannot see this. Tests import the module directly, so the module is
 * "used" by exactly the thing that cannot tell you whether the app uses it.
 *
 * ## What counts as reachable
 *
 * Only a real import from something under `src/`, or a path in a build config — Metro
 * substitutes `phone-sdk-unavailable.ts` by filename, which is a genuine use with no import
 * statement anywhere. **A mention in a comment does not count.** Half the modules here name
 * their neighbours in prose, and accepting that would let a module be kept alive by the
 * sentence explaining why it was removed.
 *
 * ## What this does not catch
 *
 * A module imported only by another dead module still looks reachable, because this asks
 * "does anything import you", not "is anything that imports you reachable from a screen".
 * Worth knowing; still catches the case that has actually happened four times.
 */

const SERVICES = 'src/services';

/** Every `.ts` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * The module names a file imports.
 *
 * Import statements, dynamic `import()` and `require()` only — never a bare string and never
 * a comment. A specifier is reduced to its basename with the extension, any `?query` a test
 * uses to defeat the module cache, and any `.native` suffix removed, so every spelling of the
 * same module collapses to one name.
 */
function importsIn(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // Bare side-effect import: `import './thing.ts'`
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) if (match[1]) specifiers.push(match[1]);
  }
  return specifiers.map(specifier => {
    const withoutQuery = specifier.split('?')[0] ?? '';
    const base = withoutQuery.split('/').pop() ?? '';
    return base.replace(/\.(ts|tsx|js|jsx)$/, '').replace(/\.native$/, '');
  });
}

/** Module names a build config pins by path, which Metro resolves without any import. */
function configReferences(): string[] {
  const names: string[] = [];
  for (const config of ['metro.config.cjs', 'app.config.cjs']) {
    let source: string;
    try { source = readFileSync(config, 'utf8'); } catch { continue; }
    for (const match of source.matchAll(/['"][^'"]*src\/services\/([\w.-]+?)(?:\.native)?\.ts['"]/g)) {
      if (match[1]) names.push(match[1]);
    }
  }
  return names;
}

test('every service module is imported by something in the app', () => {
  const modules = readdirSync(SERVICES)
    .filter(name => name.endsWith('.ts'))
    .map(name => name.replace(/\.ts$/, '').replace(/\.native$/, ''));

  const reachable = new Set(configReferences());
  for (const file of sourceFiles('src')) {
    // A module importing its own platform sibling does not make it reachable, and a module
    // cannot keep itself alive.
    const self = file.startsWith(SERVICES)
      ? (file.split('/').pop() ?? '').replace(/\.tsx?$/, '').replace(/\.native$/, '')
      : null;
    for (const name of importsIn(readFileSync(file, 'utf8'))) {
      if (name !== self) reachable.add(name);
    }
  }

  const orphans = [...new Set(modules)].filter(name => !reachable.has(name)).sort();
  assert.deepEqual(orphans, [],
    `These service modules have tests but no caller in the app: ${orphans.join(', ')}. `
    + 'Wire each one up or delete it — a module nothing imports protects nobody, however '
    + 'well it is tested. See the comment at the top of this file.');
});

test('the guard can tell a real import from a module merely mentioned in a comment', () => {
  // The property this whole file rests on. Without it, the sentence explaining why a module
  // was abandoned would be enough to keep it looking alive.
  assert.deepEqual(importsIn(`import { a } from './wallet-api.ts';`), ['wallet-api']);
  assert.deepEqual(importsIn(`// see ./wallet-api.ts for why\nconst x = 1;`), []);
  assert.deepEqual(importsIn(`/** \`fiat-value.ts\` is built and not shown yet. */`), []);
  assert.deepEqual(importsIn(`const path = 'src/services/qvac.ts';`), []);
});

test('the guard reads every spelling of an import as the same module', () => {
  assert.deepEqual(importsIn(`import x from '../services/device-lock';`), ['device-lock']);
  assert.deepEqual(importsIn(`import x from '../services/device-lock.native.ts';`), ['device-lock']);
  assert.deepEqual(importsIn(`export { x } from './quote-clock.ts';`), ['quote-clock']);
  assert.deepEqual(importsIn(`await import('../src/services/transfer-watch.ts?case=1');`), ['transfer-watch']);
  assert.deepEqual(importsIn(`const m = require('./tokens.ts');`), ['tokens']);
  assert.deepEqual(importsIn(`import './app-data.ts';`), ['app-data']);
  assert.deepEqual(importsIn(`import type { Chain } from './wallet-api.ts';`), ['wallet-api']);
});

test('a module Metro substitutes by filename counts as reachable', () => {
  // metro.config.cjs resolves the phone QVAC adapter to a stub by path, with no import
  // statement anywhere in the tree. Without this the guard would demand its deletion.
  assert.ok(configReferences().includes('phone-sdk-unavailable'),
    'metro.config.cjs no longer pins a service by path — if that is deliberate, this case should go');
});
