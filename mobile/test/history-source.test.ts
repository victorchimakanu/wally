import test from 'node:test';
import assert from 'node:assert/strict';
import { historyProvenance } from '../src/services/history-source.ts';
import { mergeHistory, type LiveHistory } from '../src/services/wallet-api.ts';

/**
 * The Activity screen used to name its source with a fixed string: "Blockscout and local
 * receipts. Token transfers and internal contract activity are not included."
 *
 * Both halves became wrong the day the backend existed, and wrong in the direction that costs
 * time. The proxy reads Etherscan and merges per-token `tokentx`, so a correctly configured
 * app was showing indexed history including USDt while crediting a provider that had 403'd
 * and disclaiming the token transfers it was displaying. Reading that label during an
 * end-to-end run on 8 November, I concluded the backend was misconfigured and went looking —
 * it was not. The label was.
 *
 * So these pin it to the data: the string on screen is derived from whatever actually
 * answered, and the caveat about token transfers appears only where it is true.
 */

const history = (over: Partial<LiveHistory> = {}): LiveHistory =>
  ({ version: 1, fetchedAt: 1, source: 'etherscan', items: [], errors: [], ...over });

test('the label names whatever actually answered', () => {
  assert.match(historyProvenance('etherscan'), /^etherscan\./);
  assert.match(historyProvenance('Blockscout and local submission receipts'), /^Blockscout and local submission receipts\./);
  // The exact string the screen showed for weeks while serving Etherscan data.
  assert.ok(!historyProvenance('etherscan').includes('Blockscout'));
});

test('the token-transfer caveat appears only where it is true', () => {
  // Etherscan: viaEtherscan merges txlist with a per-token tokentx call, so USDt is included
  // and saying otherwise tells a user their transfer is missing when it is on the screen.
  assert.ok(!/Token transfers/.test(historyProvenance('etherscan')));
  assert.ok(!/Token transfers/.test(historyProvenance("etherscan and this device's submissions")));

  // The loopback server's Blockscout path really does omit them.
  assert.match(historyProvenance('Blockscout and local submission receipts'), /Token transfers and internal contract activity are not included\./);
});

test('what the merge stamps is what the screen reports', () => {
  // The coupling that matters: mergeHistory composes the source, the screen renders it. If
  // either side changes its wording independently, this fails rather than the screen quietly
  // crediting the wrong provider again.
  const merged = mergeHistory(history({ source: 'etherscan' }), history({ source: 'Blockscout and local submission receipts' }));
  assert.equal(merged.source, "etherscan and this device's submissions");

  const shown = historyProvenance(merged.source);
  assert.ok(shown.startsWith("etherscan and this device's submissions"), shown);
  assert.ok(!shown.includes('Blockscout'), 'the merged label must not credit the provider it did not use');
  assert.ok(!/Token transfers/.test(shown), 'indexed history includes token transfers');
});

test('a source the code has never seen still produces a sentence', () => {
  // Defensive: source is a server-supplied string. It must never render as "undefined." or
  // swallow the caveat by accident.
  const odd = historyProvenance('some-new-indexer');
  assert.equal(odd, 'some-new-indexer. Token transfers and internal contract activity are not included.');
  assert.ok(!historyProvenance('').startsWith('undefined'));
});
