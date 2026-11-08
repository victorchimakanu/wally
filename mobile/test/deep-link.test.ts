import test from 'node:test';
import assert from 'node:assert/strict';
import { routeForLink } from '../src/services/deep-link.ts';

/**
 * A link is an untrusted input from another application: something arriving that claims to
 * describe a payment and may be lying. That is the same class of thing as a scanned QR code, so
 * it goes through the same parser with the same refusals — and these tests exist to keep it
 * that way, because the tempting shortcut is to "just read the address out of the URL".
 */

const D = '0x000000000000000000000000000000000000dEaD';
const USDT = '0xE5b6C29411b3ad31C3613BbA0145293fC9957256';

test('a payment link opens Send with the recipient filled in', () => {
  for (const link of [`ethereum:${D}`, `wally://${D}`, `wally://ethereum:${D}`, D]) {
    const route = routeForLink(link);
    assert.equal(route.ok, true, link);
    assert.equal(route.ok === true && route.pathname, '/send');
    assert.equal(route.ok === true && route.params.recipient, D);
  }
});

test('a link never fills in an amount', () => {
  // The rule the scanner already follows: code and the user pick every number. A link that
  // could prefill "10" is a link that can be crafted to read as "1.0" on a small screen.
  const route = routeForLink(`ethereum:${D}@421614?value=2.5e18`);
  assert.equal(route.ok, true);
  if (route.ok) {
    assert.equal(route.params.amount, undefined, 'no amount may ever come from a link');
    assert.equal(route.params.scannedAmountIgnored, '1', 'but the screen is told to say so');
    assert.equal(route.params.chain, 'arbitrum', 'the chain the link named is honoured');
  }
});

test('a token-transfer link is refused, because its target is the contract', () => {
  // ethereum:<token>/transfer?address=<recipient> points at the token contract. Unwrapping it
  // as a recipient would send funds to the contract and burn them.
  const route = routeForLink(`ethereum:${USDT}/transfer?address=${D}`);
  assert.equal(route.ok, false);
  assert.match(route.ok === false ? route.reason : '', /token transfer/i);
});

test('an address inside other text is not a payment link', () => {
  for (const link of [`pay me at ${D} thanks`, `https://evil.example.com/${D}`, `wally://pay?to=${D}`]) {
    assert.equal(routeForLink(link).ok, false, link);
  }
});

test('screen links go to screens and carry nothing with them', () => {
  assert.deepEqual(routeForLink('wally://activity'), { ok: true, pathname: '/history', params: {} });
  assert.deepEqual(routeForLink('wally://settings'), { ok: true, pathname: '/settings', params: {} });
  assert.deepEqual(routeForLink('wally://'), { ok: true, pathname: '/', params: {} });
  // Parameters on a screen link are discarded: no screen takes them, and accepting them would
  // be a way to drive the app from outside.
  const route = routeForLink('wally://send?recipient=' + D + '&amount=999');
  assert.equal(route.ok, true);
  assert.deepEqual(route.ok === true && route.params, {});
});

test('an unknown screen is not silently treated as a payment', () => {
  assert.equal(routeForLink('wally://admin').ok, false);
  assert.equal(routeForLink('wally://../../etc/passwd').ok, false);
});

test('rubbish is refused without a reason worth showing', () => {
  for (const link of [null, undefined, 0, '', '   ', {}]) {
    const route = routeForLink(link);
    assert.equal(route.ok, false);
    assert.equal(route.ok === false && route.reason, '', 'a link that is not for us is not an error');
  }
});

test('the zero address is refused, here as everywhere', () => {
  assert.equal(routeForLink('ethereum:0x' + '0'.repeat(40)).ok, false);
});

test('a link can never send anything — it only ever opens a screen', () => {
  // The shape of the result is the guarantee: a pathname and parameters. There is no branch
  // that performs an action, and if one is ever added this fails.
  for (const link of [`ethereum:${D}`, 'wally://activity', `wally://${D}`]) {
    const route = routeForLink(link);
    if (route.ok) {
      assert.ok(route.pathname.startsWith('/'));
      assert.ok(!('confirm' in route) && !('submit' in route));
    }
  }
});
