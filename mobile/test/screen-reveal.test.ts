import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldReveal } from '../src/components/shell.ts';

/**
 * A refusal the user cannot see.
 *
 * Measured in a browser on 23 November 2026, on the Send screen with a contract recipient:
 * the refusal rendered at y=692 in a 626px viewport, with 226px of unscrolled content below
 * it and a sticky footer over the top. Clicking "Review transfer" appeared to do **nothing**.
 * The message was real, rendered, correct, and off-screen — which for the person holding the
 * phone is the same as no message at all.
 *
 * It was not specific to that refusal. Every error on that screen lands in the same place,
 * including the EIP-55 one from #63 and "Not enough testnet ETH" from the wallet server.
 *
 * `Screen` already had the machinery — a ScrollView ref, `toLatest()`, and a `scrollRequest`
 * prop — but the effect reading it was gated behind `autoScroll`, which only chat sets. So
 * nothing changes shape here: one effect, reusing Kojo's own helper.
 */

test('a screen that follows nothing reveals only what it has something to show', () => {
  // The Send screen: no autoScroll, and `error` starts as ''.
  assert.equal(shouldReveal(false, ''), false, 'an empty error must not yank the screen on mount');
  assert.equal(shouldReveal(false, undefined), false, 'a screen passing no request must not scroll');
  assert.equal(shouldReveal(false, 'That address is a contract'), true, 'a refusal must be brought into view');

  // Chat follows new content and drives its own scrolling through the autoScroll path, which
  // must keep handling every request including the first empty one. Revealing as well would
  // scroll it twice per message.
  assert.equal(shouldReveal(true, ''), false);
  assert.equal(shouldReveal(true, 'anything'), false);

  // A numeric request is part of the prop's type, so it has to behave. 0 is "nothing yet".
  assert.equal(shouldReveal(false, 0), false);
  assert.equal(shouldReveal(false, 1), true);
});

/**
 * The call sites, written as the pattern that must be present *and* the one that must not.
 *
 * Chat is the screen this prop was built for and it must keep its own behaviour; the guard
 * below would be satisfied by deleting the autoScroll path entirely, so that is asserted too.
 */
test('the Send screen asks for its errors to be shown, and chat is left alone', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const send = read('screens/LiveWallet.tsx');
  assert.match(send, /scrollRequest=\{error\}/, 'the Send screen must ask for its refusal to be revealed');

  const chat = read('screens/Chat.tsx');
  assert.match(chat, /autoScroll/, 'chat must keep following new content');

  // Both paths still exist in Screen: following, and revealing. One effect doing both would
  // scroll chat twice per message.
  const ui = read('components/ui.tsx');
  assert.match(ui, /if \(!autoScroll\) return;/, 'the follow path must stay gated on autoScroll');
  assert.match(ui, /if \(!shouldReveal\(autoScroll, scrollRequest\)\) return;/, 'the reveal path must stay gated on shouldReveal');
});
