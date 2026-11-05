import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInfo, supportSummary, versionLabel } from '../src/services/build-info.ts';

/**
 * This exists so a support conversation can start, so the cases are about what a report has to
 * survive: missing values, a user on web, and the copy that gets pasted into a message.
 */

const FULL = {
  appVersion: '1.0.0', os: 'android', osVersion: '14',
  deviceModel: 'Pixel 6a', isDevelopment: false, backendOrigin: 'https://api.wally.example',
};

test('a complete report says everything support needs and nothing it does not', () => {
  const info = buildInfo(FULL);
  assert.deepEqual(info, {
    version: '1.0.0', platform: 'android 14', device: 'Pixel 6a',
    channel: 'release', backend: 'https://api.wally.example',
  });

  const line = supportSummary(info);
  assert.match(line, /Wally 1\.0\.0/);
  assert.match(line, /android 14/);
  assert.match(line, /Pixel 6a/);
  // One line: anything that wraps gets half-copied, and half a version string is worse than none.
  assert.equal(line.split('\n').length, 1);
});

test('nothing identifying a person leaks into the summary', () => {
  const line = supportSummary(buildInfo(FULL));
  // The things that must never be here, even though the app knows them.
  for (const forbidden of ['0x', 'seed', 'phrase', 'key', 'token']) {
    assert.doesNotMatch(line.toLowerCase(), new RegExp(forbidden), `must not include ${forbidden}`);
  }
});

test('missing values report as unknown rather than as blanks', () => {
  const info = buildInfo({ os: '' });
  assert.equal(info.version, 'unknown');
  assert.equal(info.platform, 'unknown');
  assert.equal(info.device, 'unknown device');
  // A blank in a support message reads as a bug in the support tool.
  assert.doesNotMatch(supportSummary(info), /··|· ·|\(\)/);
});

test('whitespace-only values are treated as missing', () => {
  const info = buildInfo({ appVersion: '   ', os: 'ios', osVersion: '  ', deviceModel: '' });
  assert.equal(info.version, 'unknown');
  assert.equal(info.platform, 'ios', 'a blank OS version must not leave a trailing space');
  assert.equal(info.device, 'unknown device');
});

test('a missing backend is reported as a fact, not hidden', () => {
  const info = buildInfo({ os: 'web', backendOrigin: '' });
  assert.equal(info.backend, 'none configured');
  assert.match(supportSummary(info), /none configured/);
});

test('a development build says so, because it changes what support asks next', () => {
  const dev = buildInfo({ ...FULL, isDevelopment: true });
  assert.equal(dev.channel, 'development');
  assert.match(supportSummary(dev), /development/);
  assert.equal(versionLabel(dev), '1.0.0 (development build)');

  assert.equal(versionLabel(buildInfo(FULL)), '1.0.0', 'a release build is just the number');
});

test('the web preview produces a usable report too', () => {
  const info = buildInfo({ appVersion: '1.0.0', os: 'web', backendOrigin: 'http://127.0.0.1:8080' });
  assert.equal(info.platform, 'web');
  assert.equal(info.device, 'unknown device');
  assert.match(supportSummary(info), /Wally 1\.0\.0 \(release\) · web/);
});

test('a meaningless OS version is omitted rather than shown', () => {
  // Observed on web: Platform.Version reported "0.0.0", which reads as a bug in the support
  // tool rather than as an absent value. The call site omits it; this pins the shape it
  // produces so the fix cannot be undone silently.
  assert.equal(buildInfo({ os: 'web', osVersion: undefined }).platform, 'web');
  assert.match(supportSummary(buildInfo({ appVersion: '1.0.0', os: 'web' })), /· web ·/);
});

test('a build number is shown in parentheses, and omitted rather than faked', () => {
  // Two builds of 1.0.0 are indistinguishable without this, which is the case a tester on the
  // third TestFlight build of a version actually hits.
  assert.equal(buildInfo({ appVersion: '1.0.0', buildNumber: '42', os: 'ios' }).version, '1.0.0 (42)');
  assert.equal(buildInfo({ appVersion: '1.0.0', buildNumber: '  ', os: 'ios' }).version, '1.0.0');
  assert.equal(buildInfo({ appVersion: '1.0.0', os: 'ios' }).version, '1.0.0');
  // It has to survive into the string someone pastes, not just the card.
  assert.match(supportSummary(buildInfo({ appVersion: '1.0.0', buildNumber: '42', os: 'ios' })), /Wally 1\.0\.0 \(42\)/);
});
