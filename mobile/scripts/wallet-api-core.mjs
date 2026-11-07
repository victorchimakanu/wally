import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * How long a fee quote is good for.
 *
 * Sent to the app as a duration as well as a timestamp. The timestamp is this machine's clock
 * and the app cannot safely compare it with its own — a phone running a few minutes fast saw
 * every quote as already expired and could not send at all. See
 * mobile/src/services/quote-clock.ts.
 */
export const QUOTE_MS = 60000;

export const NETWORKS = {
  arbitrum: { name: 'Arbitrum Sepolia', chainId: 421614, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io', indexer: 'https://arbitrum-sepolia.blockscout.com' },
  ethereum: { name: 'Ethereum Sepolia', chainId: 11155111, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', indexer: 'https://eth-sepolia.blockscout.com' },
};
/**
 * ERC-20 tokens this dev server reports balances for.
 *
 * **Third copy of this list.** The others are `TOKENS` in mobile/src/services/tokens.ts and in
 * backend/src/config.ts. None of the three can import the others — a .mjs script cannot read a
 * .ts module and the backend is a separate package — so `backend/test/usdt.test.ts` asserts all
 * three agree. A one-sided edit fails that test rather than putting a wrong number beside
 * somebody's money.
 *
 * 6 decimals, not 18. See the app's copy for what this address is and is not.
 */
export const TOKENS = {
  arbitrum: [{ address: '0xE5b6C29411b3ad31C3613BbA0145293fC9957256', symbol: 'USDT', decimals: 6 }],
  ethereum: [],
};

/** Base units to a decimal string, at the token's own scale. Never rounds up. */
export function tokenDisplay(value, decimals) {
  const n = BigInt(value), scale = 10n ** BigInt(decimals);
  const whole = n / scale;
  const fraction = decimals === 0 ? '' : (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}${fraction ? '.' + fraction : ''}`;
}

/**
 * Accept a comma as a decimal separator. Must stay identical to normaliseAmount() in
 * mobile/src/services/wallet-api.ts — the app validates an amount before sending it here, and
 * two parsers that disagree is a transfer that passes one check and fails the other.
 *
 * A lone comma is always a decimal point. `1,250` is ambiguous, and of the two readings the
 * decimal one risks sending a thousand times less while the grouping one risks sending a
 * thousand times more. Anything more ambiguous is refused rather than guessed at.
 */
export function normaliseAmount(text) {
  if (typeof text !== 'string') return text;
  const commas = (text.match(/,/g) ?? []).length;
  if (commas === 0) return text;
  if (commas > 1 || text.includes('.')) return text;
  return text.replace(',', '.');
}
export function ethUnits(raw) {
  const text = normaliseAmount(raw);
  // Two separate refusals. One message for both said "up to 18 decimals" when the real problem
  // was the number of whole digits, which told the user nothing they could act on — and the app
  // used to let such an amount through, so this message was what they actually saw.
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) throw new Error('Enter an ETH amount with up to 18 decimals.');
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,18})?$/.test(text)) throw new Error('That is more than this wallet will send at once. The most is 9,999 ETH.');
  const [whole, fraction = ''] = text.split('.');
  const value = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (value <= 0n) throw new Error('The amount must be positive.');
  return value;
}
export function ethDisplay(value) { const n = BigInt(value), whole = n / 10n ** 18n, fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${whole}${fraction ? '.' + fraction : ''}`; }
export function validAddress(address) { return typeof address === 'string' && /^0x[\da-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address); }
/**
 * Statuses that are final. A record in one of these no longer blocks sending on its chain.
 *
 * `unknown` and `pending` are the two that block, and until now nothing could ever leave
 * `unknown`: a broadcast the node refused recorded the reason and kept the status, so
 * `quote()` blocked on it forever and that chain could never be used again. See
 * docs/send-path-lockout.md.
 */
export const SETTLED = ['confirmed', 'failed', 'superseded'];

/**
 * Every status a journalled transfer can hold.
 *
 * **One list, derived from, rather than three kept in step by hand.** Adding `superseded` left
 * the journal's load-time validator still listing four statuses, so the first restart after a
 * stranded transfer was resolved threw "The transaction journal is invalid" and the dev server
 * would not start at all. The fix for a wedged chain wedged the server instead.
 *
 * OUTSTANDING is computed as the complement of SETTLED rather than written out, because the
 * two have to be complements and a hand-maintained pair is how they stop being.
 */
export const STATUSES = ['unknown', 'pending', 'confirmed', 'failed', 'superseded'];
export const OUTSTANDING = STATUSES.filter(status => !SETTLED.includes(status));

/**
 * Is a journal file one we are willing to act on?
 *
 * Extracted so it can be tested. It used to be an expression inside `createWalletService`,
 * which needs the isolated WDK runtime to construct — so the one code path that decides
 * whether the server starts was unreachable from the test suite, which is why the missing
 * status shipped.
 */
export function validJournal(journal, networks = NETWORKS) {
  return Array.isArray(journal) && journal.every(item =>
    item && typeof item === 'object' &&
    Object.hasOwn(networks, item.chain) &&
    typeof item.hash === 'string' && /^0x[\da-f]{64}$/i.test(item.hash) &&
    STATUSES.includes(item.status));
}

/**
 * Can this transaction still land?
 *
 * The question is answered by asking the chain, not by reading the node's error text. If the
 * account's nonce has already moved past this transaction's nonce and this transaction has no
 * receipt, then some *other* transaction consumed that nonce. Nothing can change that: a nonce
 * is used once. The transfer is dead and the money never moved.
 *
 * That single rule covers both of the ways a transfer gets stranded today — a broadcast the
 * node refused, and the same recovery phrase sending from two phones at once, where both read
 * the same nonce and only one can win (FEATURE-AUDIT §28.3). Parsing error strings would not:
 * `already known` means the node *has* it, and calling that a failure would tell someone their
 * transfer failed while it was confirming.
 *
 * Deliberately conservative. Every uncertain case returns false and the record stays pending,
 * because the cost of being wrong here is someone sending twice.
 */
export function superseded({ hasReceipt, recordNonce, confirmedNonce }) {
  if (hasReceipt) return false;
  // A record written before nonces were journalled cannot be judged this way. Those are
  // resolved by an explicit user action instead — see `resolve()`.
  if (!Number.isInteger(recordNonce) || !Number.isInteger(confirmedNonce)) return false;
  return confirmedNonce > recordNonce;
}

/**
 * May the user declare this transfer dead by hand?
 *
 * Only when Wally has no way to find out for itself. A record that carries a nonce can be
 * judged against the chain, and allowing a person to override *that* is the one way this whole
 * mechanism could make things worse: a transfer that is merely slow would be declared dead,
 * the chain unblocked, and the same money sent again.
 *
 * So the answer is no whenever the automatic rule applies, and the reason is returned rather
 * than a bare false, because the refusal is the interesting part.
 */
export function manualResolve(record) {
  if (!record) return { allowed: false, reason: 'That transfer is not one this wallet submitted.' };
  if (SETTLED.includes(record.status)) return { allowed: false, reason: 'settled' };
  if (typeof record.nonce === 'number') {
    return {
      allowed: false,
      reason: 'Wally can check this transfer against the network, and the network still says it may arrive. It cannot be marked as never arrived.',
    };
  }
  return { allowed: true };
}

export function visibleRecord(record) { const { owner, ...visible } = record; return visible; }
export class QuoteBook {
  constructor(now = Date.now) { this.now = now; this.items = new Map(); }
  create(owner, payload) {
    for (const [id, quote] of this.items) if (quote.expiresAt <= this.now()) this.items.delete(id);
    if (this.items.size >= 128) throw new Error('Too many pending reviews. Try again later.');
    const quote = { ...payload, id: randomUUID(), owner, expiresAt: this.now() + QUOTE_MS, claimed: false };
    this.items.set(quote.id, quote); return quote;
  }
  claim(owner, id, approved) {
    const quote = this.items.get(id);
    if (!quote || quote.owner !== owner) throw new Error('This review belongs to another session or is no longer available.');
    if (approved !== true) throw new Error('Explicit approval is required.');
    if (quote.claimed) throw new Error('This review was already submitted. Check its receipt before trying another transfer.');
    if (quote.expiresAt <= this.now()) throw new Error('This review expired. Request a fresh fee estimate.');
    quote.claimed = true; return quote;
  }
}
export async function createWalletService(directory, { transport = fetch } = {}) {
  const runtime = path.join(directory, '..', 'wallet-api-runtime');
  const require = createRequire(path.join(runtime, 'package.json'));
  let WalletManagerEvm, ethers, qr;
  try { ({ default: WalletManagerEvm } = await import(pathToFileURL(require.resolve('@tetherto/wdk-wallet-evm')).href)); ethers = await import(pathToFileURL(require.resolve('ethers')).href); qr = require('qrcode'); }
  catch { throw new Error('Install the isolated WDK runtime with npm install --prefix internal/wallet-api-runtime --save-exact @tetherto/wdk-wallet-evm@1.0.0-beta.14 qrcode@1.5.4'); }
  mkdirSync(directory, { recursive: true });
  const seedFile = path.join(directory, 'wallet.seed');
  let phrase;
  if (existsSync(seedFile)) { phrase = readFileSync(seedFile, 'utf8').trim(); if (!ethers.Mnemonic.isValidMnemonic(phrase)) throw new Error('The testnet wallet seed is invalid. Restore its backup; a replacement was not generated.'); }
  else { phrase = ethers.Wallet.createRandom().mnemonic.phrase; writeFileSync(seedFile, phrase + '\n', { mode: 0o600, flag: 'wx' }); }
  try { chmodSync(seedFile, 0o600); } catch {}
  const journalFile = path.join(directory, 'transactions.json');
  let journal = [];
  if (existsSync(journalFile)) { journal = JSON.parse(readFileSync(journalFile, 'utf8')); if (!validJournal(journal)) throw new Error('The transaction journal is invalid. Restore it before submitting transfers.'); }
  const save = () => { writeFileSync(journalFile + '.tmp', JSON.stringify(journal, null, 2), { mode: 0o600 }); renameSync(journalFile + '.tmp', journalFile); };
  const book = new QuoteBook();
  const managers = new Map(), accounts = new Map(), accountInfo = new Map();
  let rpcId = 0, sending = false;
  async function rpc(chain, method, params = []) {
    if (!Object.hasOwn(NETWORKS, chain)) throw new Error('Unsupported test network.');
    const network = NETWORKS[chain];
    const response = await transport(network.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${network.name} RPC is unavailable.`);
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) {
      // The node answered and refused, which is different from not reaching it. Keep that
      // apart, and keep the node's own words: for a broadcast they are the only explanation
      // the user will ever get, and confirm() currently discards them entirely.
      const refusal = new Error(`${network.name} could not complete the ${method} request.`);
      refusal.nodeRefused = true;
      refusal.nodeMessage = typeof data.error?.message === 'string' ? data.error.message : '';
      throw refusal;
    }
    return data.result;
  }
  async function checked(chain) { const actual = Number(BigInt(await rpc(chain, 'eth_chainId'))); if (actual !== NETWORKS[chain].chainId) throw new Error('RPC network mismatch. Testnet operations were blocked.'); }
  async function account(chain) {
    if (!Object.hasOwn(NETWORKS, chain)) throw new Error('Only Arbitrum Sepolia and Ethereum Sepolia are enabled.');
    if (!accounts.has(chain)) { const manager = new WalletManagerEvm(phrase, { provider: { request: ({ method, params }) => rpc(chain, method, params) }, transactionMaxFee: 10n ** 16n }); managers.set(chain, manager); accounts.set(chain, await manager.getAccount(0)); }
    return accounts.get(chain);
  }
  for (const chain of Object.keys(NETWORKS)) { const a = await account(chain), address = await a.getAddress(); if (!validAddress(address)) throw new Error('WDK returned an invalid address.'); const svg = await qr.toString(address, { type: 'svg', width: 160, margin: 2 }); accountInfo.set(chain, { address, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }); }
  // Managers retain the seed internally. No API response includes the seed or signed bytes.
  phrase = null;
  /**
   * One ERC-20 balance, by `eth_call` rather than through a Provider object.
   *
   * The result is decoded as a plain 32-byte integer. A contract that answers with anything
   * else is treated as unavailable rather than as zero: showing a balance of nothing when the
   * call failed is the one wrong answer here.
   */
  async function tokenBalance(chain, token, holder) {
    const data = `0x70a08231${holder.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
    const result = await rpc(chain, 'eth_call', [{ to: token.address, data }, 'latest']);
    if (typeof result !== 'string' || !/^0x[\da-f]{1,64}$/i.test(result) || result === '0x') {
      throw new Error(`${token.symbol} balance could not be read.`);
    }
    return BigInt(result);
  }

  async function wallet() {
    // One entry per chain AND asset now, which is the shape parseWallet() in
    // mobile/src/services/wallet-api.ts derives from the same token list.
    const balances = await Promise.all(Object.entries(NETWORKS).flatMap(([chain, network]) => {
      const info = accountInfo.get(chain);
      const common = { chain, name: network.name, chainId: network.chainId, ...info };

      const native = (async () => {
        try { await checked(chain); const value = await (await account(chain)).getBalance(); return { ...common, symbol: 'ETH', balanceWei: value.toString(), balance: ethDisplay(value), error: '' }; }
        catch { return { ...common, symbol: 'ETH', balanceWei: null, balance: null, error: `${network.name} balance could not be refreshed.` }; }
      })();

      const tokens = (TOKENS[chain] ?? []).map(async token => {
        try {
          await checked(chain);
          const value = await tokenBalance(chain, token, info.address);
          // balanceWei holds base units for a token; the field keeps its name because the
          // app's parser has always used it, and the app cross-checks it against `balance`
          // using this token's decimals.
          return { ...common, symbol: token.symbol, balanceWei: value.toString(), balance: tokenDisplay(value, token.decimals), error: '' };
        } catch {
          return { ...common, symbol: token.symbol, balanceWei: null, balance: null, error: `${token.symbol} balance could not be refreshed.` };
        }
      });

      return [native, ...tokens];
    }));
    return { version: 1, network: 'testnet', location: 'computer', fetchedAt: Date.now(), balances, tokenNotice: 'Native testnet ETH and testnet USDt on Arbitrum. The USDt contract is a third-party testnet deployment, not Tether\u2019s; gas is paid in ETH.' };
  }
  async function quote(owner, body) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['chain', 'recipient', 'amount'].includes(key)) || !Object.hasOwn(NETWORKS, body.chain) || !validAddress(body.recipient)) throw new Error('Choose a test network and enter a complete recipient address.');
    const recipient = ethers.getAddress(body.recipient), value = ethUnits(body.amount), chain = body.chain;
    await checked(chain);
    // OUTSTANDING, not a second copy of ['unknown', 'pending']: this list and SETTLED have to
    // stay complements, and the way they stop being is somebody adding a status to one.
    for (const pending of journal.filter(item => item.chain === chain && OUTSTANDING.includes(item.status))) {
      try { await receipt(chain, pending.hash); } catch {}
      if (OUTSTANDING.includes(pending.status)) throw new Error('A transfer on this network still needs a receipt. Resolve it in Activity before creating another send.');
    }
    const info = accountInfo.get(chain), a = await account(chain);
    const balance = await a.getBalance(); if (balance < value) throw new Error('Not enough testnet ETH. Fund this address from a faucet before sending.');
    if (await rpc(chain, 'eth_getCode', [recipient, 'latest']) !== '0x') throw new Error('This native ETH send supports ordinary wallet recipients. Contract interactions need their own review.');
    const [gasHex, gasPriceHex, nonceHex] = await Promise.all([rpc(chain, 'eth_estimateGas', [{ from: info.address, to: recipient, value: ethers.toQuantity(value), data: '0x' }]), rpc(chain, 'eth_gasPrice'), rpc(chain, 'eth_getTransactionCount', [info.address, 'pending'])]);
    const gasLimit = BigInt(gasHex), gasPrice = BigInt(gasPriceHex), fee = gasLimit * gasPrice;
    if (fee <= 0n || fee > 10n ** 16n || gasLimit > 1000000n) throw new Error('The fee estimate is outside the configured testnet limit.');
    if (balance < value + fee) throw new Error('Not enough testnet ETH to cover the amount and network fee.');
    const tx = { to: recipient, value, data: '0x', chainId: NETWORKS[chain].chainId, nonce: Number(BigInt(nonceHex)), gasLimit, gasPrice, type: 0 };
    const wdkQuote = await a.quoteSendTransaction(tx); if (wdkQuote.fee > 10n ** 16n) throw new Error('WDK rejected the network fee limit.');
    const entry = book.create(owner, { chain, recipient, amount: ethers.formatEther(value), fee: ethers.formatEther(fee), feeWei: fee.toString(), total: ethers.formatEther(value + fee), from: info.address, tx });
    return { id: entry.id, chain, network: NETWORKS[chain].name, recipient, amount: entry.amount, fee: entry.fee, total: entry.total, from: entry.from, expiresAt: entry.expiresAt,
      // The duration, which is what the app actually uses. expiresAt stays for the explorer
      // view and for anything reading the journal, but comparing it against a phone's clock is
      // the bug this fixes.
      expiresInMs: QUOTE_MS, symbol: 'ETH', chainId: NETWORKS[chain].chainId };
  }
  async function confirm(owner, body) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['quoteId', 'approved'].includes(key)) || typeof body.quoteId !== 'string' || body.approved !== true) throw new Error('Confirm the exact reviewed quote before submitting.');
    const previous = journal.find(item => item.quoteId === body.quoteId && item.owner === owner); if (previous) return visibleRecord(previous);
    if (sending) throw new Error('A transfer is already being submitted. Check its receipt first.');
    const q = book.claim(owner, body.quoteId, body.approved); sending = true;
    try {
      // Ask the chain about anything still outstanding on this network first. Without this the
      // unblocking would only happen when somebody opened Activity, so a transfer that can no
      // longer land would keep the chain wedged for as long as nobody looked.
      for (const item of journal.filter(item => item.chain === q.chain && !SETTLED.includes(item.status))) {
        try { await receipt(item.chain, item.hash); } catch { /* leave it outstanding */ }
      }
      const outstanding = journal.find(item => item.chain === q.chain && !SETTLED.includes(item.status));
      if (outstanding) {
        throw new Error(outstanding.nonce === undefined
          // Pre-dates journalled nonces, so the rule cannot settle it. Say what to do.
          ? 'An earlier transfer on this network was never resolved, and it was sent before Wally recorded enough to check it. Open it in Activity and mark it as never arrived to carry on.'
          : 'A transfer on this network still needs a receipt. Check Activity before sending again.');
      }
      await checked(q.chain);
      const a = await account(q.chain), tx = q.tx;
      const balance = await a.getBalance(); if (balance < tx.value + BigInt(q.feeWei)) throw new Error('The balance changed. Request a fresh review.');
      const nonce = Number(BigInt(await rpc(q.chain, 'eth_getTransactionCount', [q.from, 'pending']))); if (nonce !== tx.nonce) throw new Error('The wallet nonce changed. Request a fresh review.');
      if (await rpc(q.chain, 'eth_getCode', [q.recipient, 'latest']) !== '0x') throw new Error('The recipient changed. Request a fresh review.');
      const requiredGas = BigInt(await rpc(q.chain, 'eth_estimateGas', [{ from: q.from, to: q.recipient, value: ethers.toQuantity(tx.value), data: '0x' }])); if (requiredGas > tx.gasLimit) throw new Error('The fee estimate changed. Request a fresh review.');
      const raw = await a.signTransaction(tx), decoded = ethers.Transaction.from(raw);
      if (decoded.to !== tx.to || decoded.from?.toLowerCase() !== q.from.toLowerCase() || decoded.value !== tx.value || decoded.data !== '0x' || decoded.chainId !== BigInt(tx.chainId) || decoded.nonce !== tx.nonce || decoded.gasLimit !== tx.gasLimit || decoded.gasPrice !== tx.gasPrice || decoded.type !== 0) throw new Error('The signed transaction did not match the approved review. Nothing was broadcast.');
      const hash = ethers.keccak256(raw);
      // nonce is journalled so a stranded record can later be judged against the chain: if the
      // account has moved past this nonce and this hash has no receipt, it can never land.
      const record = { quoteId: q.id, owner, hash, chain: q.chain, network: NETWORKS[q.chain].name, from: q.from, recipient: q.recipient, amount: q.amount, fee: q.fee, nonce: tx.nonce, status: 'unknown', submittedAt: Date.now(), explorerUrl: `${NETWORKS[q.chain].explorer}/tx/${hash}`, symbol: 'ETH' };
      journal.unshift(record); save();
      try { const returned = await rpc(q.chain, 'eth_sendRawTransaction', [raw]); if (returned?.toLowerCase() === hash.toLowerCase()) record.status = 'pending'; }
      catch (error) {
        // A lost response may still have arrived, so the hash and the unknown status stay.
        // But when the node itself refused, saying nothing leaves the user with a transfer
        // that never confirms, no explanation, and — because quote() blocks on an unresolved
        // record — no way to send on this chain again. Record what the node said so the
        // receipt screen can show it.
        if (error?.nodeRefused) record.rejection = error.nodeMessage || 'The network refused this transfer.';
      }
      save(); return visibleRecord(record);
    } finally { sending = false; }
  }
  /**
   * How deep a receipt must be before a transfer is called confirmed.
   *
   * A receipt alone is not finality. A chain reorganisation can remove a block that already
   * had one, and until 5 Nov 2026 this said "confirmed" the instant a receipt appeared — so
   * Wally could tell someone their money arrived and never correct itself when it had not.
   *
   * Ethereum Sepolia reorgs a block or two routinely, so three. Arbitrum's sequencer makes
   * single-block reorgs the realistic case, so two — still more than one, because the point is
   * not to trust the first answer.
   */
  const CONFIRMATIONS = { ethereum: 3, arbitrum: 2 };

  async function receipt(chain, hash) {
    if (!Object.hasOwn(NETWORKS, chain) || !/^0x[\da-f]{64}$/i.test(hash)) throw new Error('Invalid transaction lookup.');
    await checked(chain); const result = await rpc(chain, 'eth_getTransactionReceipt', [hash]);
    const record = journal.find(item => item.hash.toLowerCase() === hash.toLowerCase() && item.chain === chain);
    let status = result ? BigInt(result.status) === 1n ? 'confirmed' : 'failed' : record?.status ?? 'pending';
    // A successful receipt that is not yet deep enough stays pending: it is on chain, but it
    // is not yet safe to say so. A failed one is reported immediately — a reorg cannot make a
    // failure into a success without also changing the hash.
    if (status === 'confirmed') {
      try {
        const head = BigInt(await rpc(chain, 'eth_blockNumber'));
        const depth = head - BigInt(result.blockNumber) + 1n;
        if (depth < BigInt(CONFIRMATIONS[chain] ?? 3)) status = 'pending';
      } catch { status = 'pending'; } // cannot prove depth, so do not claim confirmation
    }
    // No receipt: the transaction may still be in flight, or its nonce may already have been
    // spent by another transaction — from a second phone holding the same recovery phrase, or
    // a replacement — in which case it is dead and the money never moved.
    //
    // The account nonce is read a few blocks behind the head rather than at it. A reorg that
    // reversed this verdict would then have to be as deep as one that reverses a confirmed
    // transfer, which is the same bar the app already accepts above for calling anything
    // confirmed. A terminal verdict that a reorg could undo is how someone ends up sending
    // twice, and the saving would have been seconds.
    if (!result && record && typeof record.nonce === 'number' && !SETTLED.includes(status)) {
      try {
        const head = BigInt(await rpc(chain, 'eth_blockNumber'));
        const behind = BigInt(CONFIRMATIONS[chain] ?? 3);
        if (head >= behind) {
          const buried = ethers.toQuantity(head - behind);
          const confirmedNonce = Number(BigInt(await rpc(chain, 'eth_getTransactionCount', [record.from, buried])));
          if (superseded({ hasReceipt: false, recordNonce: record.nonce, confirmedNonce })) status = 'superseded';
        }
      } catch { /* cannot prove it, so claim nothing and leave the record as it was */ }
    }
    if (record && record.status !== status) { record.status = status; save(); }
    return { ...(record ? visibleRecord(record) : { hash, chain, explorerUrl: `${NETWORKS[chain].explorer}/tx/${hash}` }), status, blockNumber: result?.blockNumber ? Number(BigInt(result.blockNumber)) : null, checkedAt: Date.now() };
  }
  /**
   * "This never arrived" — the deliberate way out for a record the chain cannot settle.
   *
   * Only for records written before nonces were journalled. Everything newer is judged against
   * the chain, and letting a user override *that* would be the one way this work could make
   * things worse: a transfer that is merely slow would be declared dead, the chain unblocked,
   * and the same money sent twice.
   *
   * So this refuses whenever the automatic rule applies. Wally cannot prove what happened to
   * the records it does accept, and the copy around this action says so — the block explorer is
   * where the truth is.
   */
  async function resolve(owner, body) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['chain', 'hash'].includes(key)) || !Object.hasOwn(NETWORKS, body.chain) || !/^0x[\da-f]{64}$/i.test(String(body.hash))) {
      throw new Error('Name the exact transfer to resolve.');
    }
    const record = journal.find(item => item.owner === owner && item.chain === body.chain && item.hash.toLowerCase() === String(body.hash).toLowerCase());
    if (!record) throw new Error('That transfer is not one this wallet submitted.');
    const verdict = manualResolve(record);
    if (!verdict.allowed) {
      if (verdict.reason === 'settled') return visibleRecord(record);
      // Ask the chain once more rather than simply refusing — it may have become answerable
      // since the screen was drawn, in which case the user gets the real verdict instead of a
      // refusal they can do nothing about.
      try { await receipt(record.chain, record.hash); } catch { /* fall through to the refusal */ }
      const current = journal.find(item => item.hash === record.hash && item.chain === record.chain);
      if (current && SETTLED.includes(current.status)) return visibleRecord(current);
      throw new Error(verdict.reason);
    }
    record.status = 'superseded';
    record.resolvedByUser = Date.now();
    save();
    return visibleRecord(record);
  }

  async function history() {
    const errors = [], items = [];
    await Promise.all(Object.entries(NETWORKS).map(async ([chain, network]) => {
      try { const response = await transport(`${network.indexer}/api/v2/addresses/${accountInfo.get(chain).address}/transactions`, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(); const data = await response.json(); if (!Array.isArray(data.items)) throw new Error(); for (const item of data.items.slice(0, 25)) { if (!/^0x[\da-f]{64}$/i.test(item.hash) || !/^\d+$/.test(String(item.value))) continue; items.push({ hash: item.hash, chain, network: network.name, from: item.from?.hash ?? '', recipient: item.to?.hash ?? '', amount: ethDisplay(item.value), symbol: 'ETH', status: item.status === 'ok' ? 'confirmed' : item.status === 'error' ? 'failed' : 'pending', submittedAt: Date.parse(item.timestamp) || 0, explorerUrl: `${network.explorer}/tx/${item.hash}` }); } }
      catch { errors.push(`${network.name} history is unavailable. Showing locally tracked submissions where available.`); }
    }));
    await Promise.all(journal.slice(0, 25).map(async record => { try { await receipt(record.chain, record.hash); } catch {} if (!items.some(item => item.hash === record.hash && item.chain === record.chain)) items.push(visibleRecord(record)); }));
    return { version: 1, source: 'Blockscout and local submission receipts', fetchedAt: Date.now(), items: items.sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 50), errors };
  }
  return { wallet, quote, confirm, receipt, resolve, history, dispose: () => { for (const manager of managers.values()) manager.dispose(); }, seedFile };
}
export function newSession() { return randomBytes(32).toString('hex'); }
