import test from 'node:test';
import assert from 'node:assert/strict';
import { allNotices, noticeText, licenceSummary, searchNotices } from '../src/services/notices.ts';

/**
 * These back a compliance obligation rather than a feature, so the cases check that the
 * obligation is actually met — not that the code runs.
 */

test('every production dependency is accounted for', () => {
  const all = allNotices();
  assert.ok(all.length > 500, `expected the full production tree, got ${all.length}`);
  assert.ok(all.every(n => n.name && n.license), 'every entry needs a name and a licence');
  // Sorted, so the screen is navigable.
  assert.deepEqual(all.map(n => n.name), all.map(n => n.name).slice().sort((a, b) => a.localeCompare(b)));
});

test('the Apache-2.0 packages carry their actual licence text, which is the obligation', () => {
  const apache = allNotices().filter(n => n.license === 'Apache-2.0');
  assert.ok(apache.length > 100, `expected many Apache packages, got ${apache.length}`);

  const wdk = allNotices().find(n => n.name === '@tetherto/wdk');
  assert.ok(wdk, '@tetherto/wdk must be present — it is the wallet');
  assert.equal(wdk.license, 'Apache-2.0');
  const text = noticeText(wdk);
  assert.ok(text, 'Apache-2.0 requires the licence text to be carried, not just named');
  assert.match(text, /Apache License/);
  assert.match(text, /Version 2\.0/);
});

test('a package with no licence file is reported honestly rather than invented', () => {
  const none = allNotices().filter(n => n.textRef < 0);
  for (const n of none.slice(0, 20)) {
    assert.equal(noticeText(n), null, `${n.name} must not fabricate a licence text`);
    assert.ok(n.license, 'the SPDX identifier is still recorded');
  }
});

test('deduplication is lossless — every reference resolves', () => {
  for (const n of allNotices()) {
    if (n.textRef >= 0) assert.ok(noticeText(n), `${n.name} has textRef ${n.textRef} but no text`);
  }
});

test('the summary adds up to the whole tree', () => {
  const summary = licenceSummary();
  assert.equal(summary.reduce((sum, s) => sum + s.count, 0), allNotices().length);
  assert.equal(summary[0]!.license, 'MIT', 'MIT should dominate a JS dependency tree');
});

test('search finds a package by name and a whole licence family by identifier', () => {
  // The two things someone actually arrives wanting.
  const byName = searchNotices('@tetherto/wdk');
  assert.ok(byName.some(n => n.name === '@tetherto/wdk'), 'the wallet must be findable by name');

  const apache = searchNotices('apache');
  assert.ok(apache.length > 100, `expected the Apache family, got ${apache.length}`);
  assert.ok(apache.every(n => /apache/i.test(n.license) || /apache/i.test(n.name)));

  // Case and surrounding space must not matter — people paste package names.
  assert.deepEqual(searchNotices('  EXPO-ROUTER '), searchNotices('expo-router'));
  // An empty query is the whole list, not nothing: the screen opens in that state.
  assert.equal(searchNotices('   ').length, allNotices().length);
  assert.deepEqual(searchNotices('definitely-not-a-real-package-xyz'), []);
});

test('the sorted list is memoised, not rebuilt per keystroke', () => {
  // The screen filters on every keystroke; re-sorting 742 entries each time is work nobody
  // asked for on a phone.
  assert.equal(allNotices(), allNotices(), 'allNotices() should return the same array');
});
