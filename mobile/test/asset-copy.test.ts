import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetPhrase, chainAssetPhrase, tokenAssets } from '../src/services/asset-copy.ts';
import { assetNamesOn, displaySymbol, tokensFor } from '../src/services/tokens.ts';
import { TESTNET_CHAT_PROMPT, CHAT_PROMPT } from '../src/services/qvac.ts';
import { receiveAdvice } from '../src/services/receive-advice.ts';
import { liveIntentReply } from '../src/services/live-wallet-chat.ts';
import { CHAINS, type Chain } from '../src/services/wallet-api.ts';

/**
 * Four surfaces have now claimed, in writing, that this wallet cannot hold an asset it holds.
 * Chat (fixed 17 Nov), the Wallet screen footnote (fixed 17 Nov), the Receive screen and the
 * model's own system prompt — the last two still live on 19 Nov 2026, three weeks after USDt
 * shipped. Each was written separately, each was true when written, and fixing the first two
 * one at a time is exactly why the other two survived.
 *
 * This file tests the class rather than the instances: every surface that names assets must
 * name them from `tokens.ts`, and none may deny one that is pinned there.
 */

const CHAIN_LIST = ['arbitrum', 'ethereum'] as const satisfies readonly Chain[];

/** Every connected asset, as a sentence would write it. */
function connected(): { symbol: string; chain: Chain }[] {
  return CHAIN_LIST.flatMap(chain => assetNamesOn(chain).map(symbol => ({ symbol, chain })));
}

test('the derived phrases agree with the token list, not with a copy of it', () => {
  for (const chain of CHAIN_LIST) {
    const phrase = chainAssetPhrase(chain);
    for (const token of tokensFor(chain)) {
      assert.ok(phrase.includes(displaySymbol(token.symbol)),
        `${chain} pins ${token.symbol} but chainAssetPhrase says "${phrase}"`);
    }
    assert.ok(phrase.includes('ETH'), `${chain} always holds native ETH, but: "${phrase}"`);
  }
  // Ethereum Sepolia pins no token, so its phrase must not borrow Arbitrum's.
  for (const token of tokensFor('arbitrum')) {
    assert.ok(!chainAssetPhrase('ethereum').includes(displaySymbol(token.symbol)),
      'a token pinned on one chain must not be claimed on another');
  }
  // The whole-wallet phrase names each token beside the network that actually holds it.
  for (const asset of tokenAssets()) {
    assert.ok(assetPhrase().includes(`testnet ${displaySymbol(asset.symbol)} on ${CHAINS[asset.chain].name}`),
      `assetPhrase() must place ${asset.symbol} on ${asset.chain}: "${assetPhrase()}"`);
  }
});

/**
 * The finding that produced this file.
 *
 * The prompt is the worst place for this claim to be wrong, because it is wrong *sometimes*.
 * Measured against the running model on 19 Nov 2026, a fresh conversation asking whether USDt
 * could be sent was told no in three samples out of three.
 */
test('the model is not instructed to deny an asset this wallet holds', () => {
  for (const asset of tokenAssets()) {
    const name = displaySymbol(asset.symbol);
    assert.ok(TESTNET_CHAT_PROMPT.includes(name),
      `the live system prompt never mentions ${name}, which this wallet holds`);
    // The exact shape of the bug: the symbol named in the same breath as a denial.
    const denial = new RegExp(`${name}[^.]{0,80}(not configured|not connected|not supported|unavailable|cannot)`, 'i');
    assert.ok(!denial.test(TESTNET_CHAT_PROMPT),
      `the live system prompt denies ${name}: "${TESTNET_CHAT_PROMPT.match(denial)?.[0]}"`);
  }
  // Bitcoin genuinely is not connected, and the prompt must still say so *as a denial*.
  //
  // Two wrong versions of this assertion came first, and both are worth recording because they
  // are the two obvious ones. `match(/Bitcoin/)` — mere presence — passed while the prompt said
  // "Nothing else is, Bitcoin included", which the model did not read as a refusal at all: four
  // samples out of four then answered "Yes, you can hold Bitcoin in this wallet." Replacing it
  // with `match(/Bitcoin is not connected/)` pinned one exact sentence, and promptly failed the
  // wording that actually measured best.
  //
  // So: a denial in either order, with the verb left open. This is a proxy and is honest about
  // being one — whether the model *obeys* the prompt is a measurement, not an assertion, and it
  // lives in AUDIT-2026-11-19.md. What this can do is stop a rewrite that drops the refusal
  // altogether, which is exactly what happened.
  const denies = /bitcoin[^.]{0,60}(not connected|not configured|not supported|unavailable|cannot)/i.test(TESTNET_CHAT_PROMPT)
    || /(not connected|not configured|not supported)[^.]{0,60}bitcoin/i.test(TESTNET_CHAT_PROMPT);
  assert.ok(denies,
    `the prompt must deny Bitcoin in words the model reads as a denial, not merely mention it: "${TESTNET_CHAT_PROMPT}"`);
  // The demo prompt is a different wallet and is allowed to differ, but it must exist and
  // must not be the live one by accident.
  assert.notEqual(CHAT_PROMPT, TESTNET_CHAT_PROMPT);
});

test('no screen that names assets denies a connected one', () => {
  const texts: string[] = [];
  for (const chain of CHAIN_LIST) {
    texts.push(receiveAdvice(chain, CHAINS[chain].name, { [chain]: '0x' + 'a'.repeat(40) }, c => CHAINS[c].name).text);
    texts.push(receiveAdvice(chain, CHAINS[chain].name, {}, c => CHAINS[c].name).text);
  }
  for (const intent of ['balance', 'address', 'transfer', 'history'] as const) {
    texts.push(liveIntentReply({ intent, chain: 'unknown', token: 'unknown', amount: '', recipient: '', reply: '' }).text);
  }
  for (const text of texts) {
    for (const { symbol } of connected()) {
      const denial = new RegExp(`${symbol}[^.]{0,60}(not configured|not connected|not supported|not available|not built)`, 'i');
      assert.ok(!denial.test(text), `a connected asset is denied: "${text}"`);
    }
  }
});

/**
 * The deletion-proof half. The three fixes so far were each caught only after shipping, so
 * this looks for the *pattern* rather than for any one sentence: a source file that writes an
 * asset name next to "only"/"not configured" is writing the claim by hand again.
 */
test('no source file hand-writes the connected-asset claim', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  })(root);

  // The demo wallet is a fiction with its own fixed assets, and its *content* is not a claim
  // about the connected wallet. But excluding the whole `demo/` folder was too coarse and hid
  // a fifth instance: `demo/store.tsx` holds the live-mode branches, and two of its strings —
  // "USDt is not connected" and "a testnet ETH transfer" — ran only when the real wallet was
  // connected. So the exclusion names the fiction files rather than the directory.
  const FICTION = ['model.ts', 'market.ts', 'preferences.tsx'].map(name => `${path.sep}demo${path.sep}${name}`);
  const live = files.filter(file => !FICTION.some(suffix => file.endsWith(suffix)));
  assert.ok(live.length > 40, `expected to be scanning the app; found ${live.length} files`);

  const offenders: string[] = [];
  for (const file of live) {
    const source = readFileSync(file, 'utf8');
    // Strip block comments: these files document the bug at length, and the documentation
    // naturally contains the very sentences being banned.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const { symbol } of connected()) {
      // All three string delimiters. The first version of this check listed only ' and ` and
      // a planted `"USDt is not supported…"` walked straight past it — a guard that proved
      // nothing about the half of the codebase using double quotes.
      const written = new RegExp(`["'\`][^"'\`]*(only ${symbol}\\b|${symbol}[^"'\`]{0,40}(not configured|not connected|not supported|not available|not built))[^"'\`]*["'\`]`, 'i');
      const hit = written.exec(code);
      if (hit) offenders.push(`${path.relative(root, file)}: ${hit[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [],
    'These state which assets are connected as a literal. They go stale silently — four already ' +
    'have. Build the sentence from assetPhrase() or chainAssetPhrase() in asset-copy.ts instead.');
});
