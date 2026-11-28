import test from 'node:test';
import assert from 'node:assert/strict';
import { historyGap } from '../src/services/history-source.ts';
import { asLiveHistory, withLocalSubmissions } from '../src/services/history-pager.ts';
import type { LiveHistory } from '../src/services/wallet-api.ts';

/**
 * The Activity screen used to name its source with a fixed string: "Blockscout and local
 * receipts. Token transfers and internal contract activity are not included."
 *
 * Both halves became wrong the day the backend existed. The proxy reads Etherscan and merges
 * per-token `tokentx`, so the screen was showing indexed history including USDt while naming
 * a provider that had been 403ing and disclaiming the very transfers on screen. Reading that,
 * you would go looking for a configuration problem that did not exist.
 *
 * The provenance line itself went when the wallet was rebuilt with tighter copy on 15
 * November, and that is fine: a card that makes no claim about its source cannot make a false
 * one. What these cases protect is the half that is a disclosure rather than a credit — on the
 * fallback provider the list really is missing token transfers, and nothing else on the screen
 * would say so.
 */

function history(over: Partial<LiveHistory> = {}): LiveHistory {
  return { version: 1, fetchedAt: 1_700_000_000_000, source: 'test', items: [], errors: [], ...over };
}

test('the caveat appears only where it is true', () => {
  // The Etherscan path merges per-token tokentx, so claiming otherwise would be a lie about
  // data the user can see on the screen.
  assert.equal(historyGap('etherscan'), null);
  assert.equal(historyGap("etherscan and this device's submissions"), null);
  assert.equal(historyGap('Etherscan'), null);

  // The loopback server's Blockscout path really does omit them.
  assert.match(
    historyGap('Blockscout and local submission receipts') ?? '',
    /Token transfers and internal contract activity are not included\./,
  );
});

test('a missing caveat is null, never an empty string', () => {
  // A caller that forgets to check renders nothing rather than a blank line, which is how a
  // disclosure quietly becomes whitespace.
  assert.equal(historyGap('etherscan'), null);
});

test('what the merge stamps is what the caveat reads', () => {
  // The coupling that matters: withLocalSubmissions composes the source, this reads it. If
  // either side changes its wording independently, this fails rather than the screen quietly
  // disclaiming transfers it is showing — or, worse, not disclaiming ones it is not.
  const merged = asLiveHistory(withLocalSubmissions(
    { items: [], cursors: [], errors: [], fetchedAt: 1_700_000_000_000, source: 'etherscan' },
    history({ source: 'Blockscout and local submission receipts' }),
  ));
  assert.equal(merged.source, "etherscan and this device's submissions");
  assert.equal(historyGap(merged.source), null, 'indexed history includes token transfers');
});

test('a source the code has never seen is treated as incomplete, not as complete', () => {
  // Defensive, and deliberately one-directional: `source` is a server-supplied string, and the
  // safe failure is an extra caveat rather than a missing one.
  for (const unknown of ['', 'something new', 'Covalent', 'undefined']) {
    assert.match(historyGap(unknown) ?? '', /not included/, `"${unknown}" was treated as complete`);
  }
});
