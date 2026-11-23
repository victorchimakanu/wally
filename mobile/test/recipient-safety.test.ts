import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contractRecipientRefusal, pinnedTokenContract, pinnedTokenRefusal, recipientKind, CONTRACT_REFUSAL,
} from '../src/services/recipient-safety.ts';
import { allTokens, tokensFor } from '../src/services/tokens.ts';
import type { Chain } from '../src/services/wallet-api.ts';

/**
 * Sending to a contract is an unrecoverable burn, and the mobile app had no check for it.
 *
 * The reference app has refused this since 19 August 2026. The phone shipped without it, and
 * the only check on the whole path was `eth_getCode` inside the **dev wallet server** — which
 * is development-only and disappears when signing moves into the on-device worklet. A guard
 * that lives only in the component being removed is a countdown, not a guard.
 */

const WALLET = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const USDT = tokensFor('arbitrum')[0]!;

/**
 * `backendOrigin()` reads `process.env` on every call, so the proxy is set around the cases
 * that need it and removed afterwards — the same pattern as `test/backend-history.test.ts`.
 * Without it there is no proxy to ask and every answer is `unknown`, which is itself a case
 * worth pinning: see the last assertion in this file.
 */
const PROXY = 'http://127.0.0.1:8080';
function withProxy<T>(run: () => Promise<T>): Promise<T> {
  process.env.EXPO_PUBLIC_WALLY_PROXY_URL = PROXY;
  return run().finally(() => { delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL; });
}

/** A backend that answers eth_getCode with whatever this test wants. */
function node(result: unknown, ok = true): typeof fetch {
  return (async (_url: string, init?: { body?: string }) => {
    const sent = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
    assert.equal(sent.method, 'eth_getCode', 'the chain must be asked for code, not something else');
    return { ok, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  }) as unknown as typeof fetch;
}
const unreachable: typeof fetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;

test('a pinned token contract is refused without asking the network at all', async () => {
  // The burn people actually perform: pasting the USDt *contract* address, because that is what
  // a block explorer shows when you search for USDt, and sending USDt to it.
  const refusal = await contractRecipientRefusal('arbitrum', USDT.address, unreachable);
  assert.ok(refusal, 'the pinned token contract must be refused');
  assert.match(refusal, /contract itself, not a wallet/);
  assert.match(refusal, /cannot be recovered/);
  assert.match(refusal, /Nothing was sent/);
  // USDt, not USDT: the product writes Tether's symbol with a lowercase t.
  assert.match(refusal, /USDt/);

  // Case must not matter. Indexers, EIP-55 and the dev server disagree about it constantly.
  assert.ok(await contractRecipientRefusal('arbitrum', USDT.address.toLowerCase(), unreachable));
  assert.ok(await contractRecipientRefusal('arbitrum', USDT.address.toUpperCase().replace('0X', '0x'), unreachable));
});

test('every pinned token is covered, now and when the next one is added', async () => {
  // Written against the token list rather than against USDt by name, so pinning a second token
  // is protected on the commit that pins it.
  assert.ok(allTokens().length > 0, 'no tokens pinned — delete this case if that is deliberate');
  for (const chain of ['arbitrum', 'ethereum'] as const satisfies readonly Chain[]) {
    for (const token of tokensFor(chain)) {
      assert.ok(pinnedTokenContract(chain, token.address), `${token.symbol} on ${chain} is not recognised`);
      assert.ok(await contractRecipientRefusal(chain, token.address, unreachable), `${token.symbol} on ${chain} is sendable`);
    }
  }
  // A token pinned on one chain is an ordinary address on another, and must not be refused there.
  assert.equal(pinnedTokenContract('ethereum', USDT.address), null);
});

test('the chain is asked about anything not pinned, and bytecode is refused', () => withProxy(async () => {
  assert.equal(await recipientKind('arbitrum', WALLET, node('0x')), 'wallet');
  assert.equal(await recipientKind('arbitrum', WALLET, node('0x60806040')), 'contract');

  assert.equal(await contractRecipientRefusal('arbitrum', WALLET, node('0x')), null);
  assert.equal(await contractRecipientRefusal('arbitrum', WALLET, node('0x60806040')), CONTRACT_REFUSAL);
  assert.match(CONTRACT_REFUSAL, /Nothing was sent/);
}));

/**
 * The deliberate limit, asserted so that changing it is a decision rather than a drift.
 *
 * `unknown` does not refuse, because the dev wallet server still performs the same check before
 * it signs and failing closed would stop an offline phone sending at all. When signing moves
 * on-device that second check is gone and this has to become a refusal.
 */
test('an answer that cannot be trusted is unknown, and unknown is never read as a wallet', () => withProxy(async () => {
  for (const [label, t] of [
    ['node unreachable', unreachable],
    ['http error', node('0x', false)],
    ['result missing', node(undefined)],
    ['result not a string', node(12345)],
    ['result not hex', node('not-hex')],
    ['odd number of hex digits', node('0x123')],
  ] as const) {
    assert.equal(await recipientKind('arbitrum', WALLET, t), 'unknown', label);
  }
  // Nothing above may come back as 'wallet' — that is the verdict that lets money move.
  // Today 'unknown' proceeds, and the wallet server refuses the contract instead.
  assert.equal(await contractRecipientRefusal('arbitrum', WALLET, unreachable), null);
  // But a pinned contract is still refused with no network at all, which is the half that
  // survives the dev server being removed.
  assert.ok(await contractRecipientRefusal('arbitrum', USDT.address, unreachable));
}));

/**
 * The default configuration, pinned because it is the weakest one and the easiest to forget.
 *
 * With no proxy configured there is nothing to ask, so the network half does not run at all —
 * not "runs and passes". Everything then rests on the pinned-token list and on the dev wallet
 * server, and the second of those is going away.
 */
test('with no backend configured the network half is skipped, not silently passed', async () => {
  delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
  let asked = false;
  const watcher: typeof fetch = (async () => { asked = true; throw new Error('should not be called'); }) as unknown as typeof fetch;

  assert.equal(await recipientKind('arbitrum', WALLET, watcher), 'unknown');
  assert.equal(asked, false, 'no proxy is configured, so nothing should have been asked');
  // The local half still refuses the commonest burn with nothing configured and nothing up.
  assert.ok(await contractRecipientRefusal('arbitrum', USDT.address, watcher));
  assert.equal(asked, false);
});

/**
 * The call site, written as an absence.
 *
 * Twice in the November audit a mutant survived because a helper was tested and its caller was
 * not. A check that `contractRecipientRefusal` appears somewhere in the file would pass the
 * moment the identifier is imported; this asserts it is awaited and that its answer is thrown,
 * and that it happens before the transfer is prepared.
 */
test('the Send screen refuses before it prepares the transfer', () => {
  const src = readFileSync(new URL('../src/screens/LiveWallet.tsx', import.meta.url).pathname, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const call = src.indexOf('await contractRecipientRefusal(');
  const prepare = src.indexOf('wallet.prepare(');
  assert.notEqual(call, -1, 'the Send screen does not check the recipient for contract code');
  assert.notEqual(prepare, -1, 'the Send screen no longer prepares a transfer — this test is stale');
  assert.ok(call < prepare, 'the contract check must run before the transfer is prepared, not after');
  assert.match(src, /if \(burn\) throw new Error\(burn\)/, 'the refusal must stop the send, not just be computed');
});
