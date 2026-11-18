import React, { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, TextInput, View } from 'react-native';
import { Address, Button, Card, Detail, Divider, Label, LinkButton, Note, Pill, Screen, useShared } from '../components/ui';
import { tokensFor } from '../services/tokens';
import { AssetChoice, LiveActivityCard, LiveReceiveCard, NetworkChoice, WalletStatus } from '../components/WalletData';
import { useWallet } from '../data/wallet';
import { useDemo } from '../demo/store';
import { CHAINS, fetchGasPrice, formatUnits, isAddress, parseSendAmount, sendableMax, type Chain, type LiveTransaction } from '../services/wallet-api';
import { monotonicNow, quoteExpired, secondsLeft } from '../services/quote-clock';
import { addressTrust, trustWarning } from '../services/address-safety.ts';
import { readWatch, watchStatus, watchTransfer } from '../services/transfer-watch.ts';
import { usePreferences } from '../demo/preferences';
import { useColors } from '../theme';

export function LiveSendScreen() {
  const c = useColors();
  const shared = useShared();
  const wallet = useWallet(), { state } = useDemo();
  const params = useLocalSearchParams<{ chain?: string; recipient?: string; amount?: string; scannedChain?: string; scannedAmountIgnored?: string }>();
  const [chain, setChain] = useState<Chain>(params.chain === 'ethereum' ? 'ethereum' : 'arbitrum');
  const [recipient, setRecipient] = useState(params.recipient ?? ''), [amount, setAmount] = useState(params.amount ?? ''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  /**
   * Set when a scanned code named a chain other than the one that was selected.
   *
   * The scan switches the chain rather than warning and carrying on, because sending to the
   * right address on the wrong network loses the money. Switching silently would be worse
   * though, so the switch is stated.
   */
  const scannedChain = params.scannedChain === 'arbitrum' || params.scannedChain === 'ethereum' ? params.scannedChain : null;

  // Native ETH explicitly: sending is ETH-only for now, and finding by chain alone would
  // return whichever asset the server listed first for this chain.
  // What can be sent on this chain: the native coin, then any pinned token. Read from the
  // snapshot rather than hardcoded, so a chain with no token simply offers one option and the
  // chooser renders nothing.
  const assets = ['ETH', ...tokensFor(chain).map(token => token.symbol)];
  const [asset, setAsset] = useState('ETH');
  const sending = assets.includes(asset) ? asset : 'ETH';
  const token = sending === 'ETH' ? null : tokensFor(chain).find(entry => entry.symbol === sending) ?? null;
  const decimals = token ? token.decimals : 18;
  const balance = wallet.snapshot?.balances.find(item => item.chain === chain && item.symbol === sending);
  const { preferences } = usePreferences();

  /**
   * Warn when a recipient merely *looks* like one the user saved.
   *
   * Address poisoning sends dust from an address sharing the first and last characters of one
   * you use, so the truncated form every screen renders is identical. Compared only against
   * addresses the user deliberately saved — never against ones that merely appeared in
   * history, because that is exactly where a poisoned entry lives.
   */
  const lookalike = trustWarning(addressTrust(
    recipient.trim(),
    preferences.recipients.map(item => ({ address: item.address, label: item.name })),
  ));

  /**
   * Fill the amount with everything that can actually be sent.
   *
   * For a token that is the whole balance — the fee comes out of ETH. For the coin the fee
   * and a buffer stay behind, which needs a gas price, which needs the backend; without one
   * the button is not offered rather than offering a figure the quote would reject.
   */
  const [maxBusy, setMaxBusy] = useState(false);
  async function fillMax() {
    if (maxBusy || !balance?.balanceWei) return;
    setMaxBusy(true); setError('');
    try {
      const gasPriceWei = token ? undefined : (await fetchGasPrice(chain)) ?? undefined;
      const most = sendableMax({ balanceBase: BigInt(balance.balanceWei), native: !token, ...(gasPriceWei === undefined ? {} : { gasPriceWei }) });
      if (most <= 0n) {
        throw new Error(token
          ? `There is no ${sending} here to send.`
          : 'The network fee could not be read, so Wally will not guess at a maximum. Type an amount instead.');
      }
      wallet.clearQuote();
      setAmount(formatUnits(most, decimals, decimals));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'A maximum could not be worked out.'); }
    finally { setMaxBusy(false); }
  }

  async function review() {
    if (busy) return;
    setError('');
    try {
      if (!isAddress(recipient.trim())) throw new Error('Enter a complete, non-zero EVM wallet address.');
      // parseSendAmount, not wei(): wei() is the permissive parser that also reads amounts off
      // the chain, and using it here let an amount through that the wallet server then refused
      // a round trip later, with a message about decimal places that was not the problem.
      // At the asset's own scale. USDt is 6 decimals and ETH is 18, so validating a token
      // amount against the ETH scale would accept figures the server then refuses.
      parseSendAmount(amount.trim(), decimals, sending);
      if (state.offline || wallet.offline) throw new Error('Reconnect before reviewing a transfer.');
      setBusy(true);
      await wallet.prepare({ chain, recipient: recipient.trim(), amount: amount.trim(), ...(token ? { token: sending } : {}) });
      router.push('/review');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not prepare the transfer.'); }
    finally { setBusy(false); }
  }
  // Each warning sits beside the field it is about: the lookalike check under the address, the
  // fee currency beside the balance. Nothing explains the flow; the review screen is the check.
  return <Screen title={`Send ${sending}`} footer={<Button label={busy ? 'Checking network fee…' : 'Review transfer'} disabled={busy || wallet.offline || state.offline || !balance || balance.balance === null} onPress={() => { void review(); }} />}>
    <NetworkChoice value={chain} onChange={next => { wallet.clearQuote(); setChain(next); setAsset('ETH'); setError(''); }} />
    {!!scannedChain && <Note>Switched to {CHAINS[scannedChain].name}, the network the scanned code asked for.</Note>}
    <AssetChoice value={sending} options={assets} onChange={next => { wallet.clearQuote(); setAsset(next); setAmount(''); setError(''); }} />
    <View style={{ gap: 8 }}>
      <View style={[shared.row, { gap: 20 }]}><Label size={13} weight="medium" color={c.muted} style={shared.flex}>To</Label><LinkButton label="Saved" accessibilityLabel="Choose saved recipient" disabled={busy} onPress={() => router.push('/address-book')} /><LinkButton label="Scan" accessibilityLabel="Scan a QR code" disabled={busy} onPress={() => router.push('/scan')} /></View>
      <TextInput accessibilityLabel="Recipient address" value={recipient} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder="0x…" placeholderTextColor={c.muted} onChangeText={value => { wallet.clearQuote(); setRecipient(value); }} style={shared.input} />
      {!!lookalike && <Card style={{ backgroundColor: c.warningTint, borderColor: c.warningTint }}><Label weight="semibold">Check this address carefully</Label><Note>{lookalike}</Note></Card>}
    </View>
    <View style={{ gap: 8 }}>
      <View style={shared.row}><Label size={13} weight="medium" color={c.muted} style={shared.flex}>Amount</Label><LinkButton label={maxBusy ? 'Working…' : 'Max'} accessibilityLabel="Send max" disabled={busy || maxBusy || !balance?.balanceWei || balance.balanceWei === '0'} onPress={() => { void fillMax(); }} /></View>
      <TextInput accessibilityLabel={`Amount in ${sending}`} value={amount} editable={!busy} keyboardType="decimal-pad" placeholder={token ? '25' : '0.001'} placeholderTextColor={c.muted} onChangeText={value => { wallet.clearQuote(); setAmount(value); }} style={shared.input} />
      <Label size={13} color={c.muted}>{balance?.balance ?? '—'} {sending} available{token ? ' · fee paid in ETH' : ''}</Label>
    </View>
    {params.scannedAmountIgnored === '1' && <Note>The scanned code had an amount. Wally leaves it out: type the amount you mean.</Note>}
    {balance?.balance === '0' && <Card style={{ backgroundColor: c.warningTint, borderColor: c.warningTint }}><Label weight="semibold">No {sending} on {CHAINS[chain].name} yet</Label><Button secondary label="Receive" onPress={() => router.push('/receive')} /></Card>}
    {!!error && <Note error>{error}</Note>}
    {!balance && <WalletStatus />}
  </Screen>;
}
export function LiveReviewScreen() {
  const c = useColors();
  const shared = useShared();
  const wallet = useWallet(), { state } = useDemo();
  const [now, setNow] = useState(monotonicNow), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const q = wallet.quote;
  // The monotonic clock, so a timezone change or an NTP correction mid-review cannot expire a
  // live quote or revive a dead one.
  useEffect(() => { const timer = setInterval(() => setNow(monotonicNow()), 500); return () => clearInterval(timer); }, []);
  async function confirm() {
    if (busy || state.offline || wallet.offline) return;
    setBusy(true); setError('');
    try { const tx = await wallet.confirm(); router.replace({ pathname: '/transaction', params: { chain: tx.chain, hash: tx.hash } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Submission could not be verified. Check Activity.'); }
    finally { setBusy(false); }
  }
  const expired = !q || quoteExpired(q.deadline, now);
  // The confirm button names the exact amount and asset, and the network carries its chain id:
  // the details that decide an irreversible transfer are on the button and the card, not in prose.
  return <Screen title="Review" footer={<>
    <Button label={busy ? 'Sending…' : q ? `Send ${q.amount} ${q.symbol}` : 'Send'} disabled={busy || expired || state.offline || wallet.offline} onPress={() => { void confirm(); }} />
    <Button secondary label="Cancel" disabled={busy} onPress={() => { wallet.clearQuote(); router.replace('/send'); }} />
  </>}>
    {q ? <>
      <View style={shared.between}>
        <Label size={30} weight="semibold" adjustsFontSizeToFit numberOfLines={1} style={{ flexShrink: 1, lineHeight: 38 }}>{q.amount} {q.symbol}</Label>
        <Pill tone="warning">{expired ? 'Expired' : `Expires in ${secondsLeft(q.deadline, now)} s`}</Pill>
      </View>
      <Card>
        <Label size={13} color={c.muted}>From</Label><Address value={q.from} />
        <Label size={13} color={c.muted}>To</Label><Address value={q.recipient} />
        <Divider />
        <Detail label="Network" value={`${q.network} · Chain ${q.chainId}`} />
        <Detail label="Max fee" value={`${q.fee} ETH`} />
        {/* A token total is already "25 USDt + 0.0001 ETH"; only an ETH total is a bare number. */}
        <Detail label="Total" value={q.symbol === 'ETH' ? `${q.total} ETH` : q.total} emphasis />
      </Card>
    </> : <Card><Label weight="semibold">This review has ended</Label><Note>{busy ? 'Sending…' : 'Check Activity before sending again.'}</Note>{!busy && <Button secondary label="Check Activity" onPress={() => router.push('/history')} />}</Card>}
    {!!error && <Note error>{error}</Note>}
    {expired && !busy && <Button secondary label="Back to Send" onPress={() => router.replace('/send')} />}
  </Screen>;
}
export function LiveReceiveScreen() { return <Screen title="Receive"><LiveReceiveCard /></Screen>; }
export function LiveHistoryScreen() {
  const c = useColors();
  const shared = useShared();
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('All');
  return <Screen title="Activity"><TextInput accessibilityLabel="Search activity" style={shared.input} placeholder="Search" placeholderTextColor={c.muted} value={search} onChangeText={setSearch} /><View style={shared.row}>{['All', 'Sent', 'Received'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: filter === value ? c.tint : c.surface, borderRadius: 18 }}><Label>{value}</Label></Pressable>)}</View><LiveActivityCard search={search} filter={filter} /></Screen>;
}
/**
 * "It never arrived" — the deliberate way out of a transfer the chain cannot settle.
 *
 * Only reachable for the few records written before Wally journalled nonces. The server
 * refuses this for anything it can still judge, so a merely-slow transfer cannot be declared
 * dead from here — that refusal is what stops this becoming a way to send the same money
 * twice, and the copy below does not promise more than Wally knows.
 */
function NeverArrived({ chain, hash, onResolved }: { chain: Chain; hash: string; onResolved: (tx: LiveTransaction) => void }) {
  const wallet = useWallet();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  if (!asking) {
    return <Button secondary label="This never arrived" onPress={() => setAsking(true)} />;
  }

  return <Card>
    <Label weight="semibold">Mark this as never arrived?</Label>
    <Note>Only if the block explorer shows no such transaction. Marking it lets you send on this network again.</Note>
    {!!problem && <Note error>{problem}</Note>}
    <Button
      label={busy ? 'Checking…' : 'Yes, it never arrived'}
      disabled={busy}
      onPress={() => {
        setBusy(true); setProblem('');
        void wallet.resolve(chain, hash)
          .then(onResolved)
          .catch((failure: unknown) => setProblem(failure instanceof Error ? failure.message : 'That could not be resolved.'))
          .finally(() => setBusy(false));
      }}
    />
    <Button secondary label="Leave it alone" onPress={() => { setAsking(false); setProblem(''); }} />
  </Card>;
}

export function LiveTransactionScreen() {
  const params = useLocalSearchParams<{ chain: string; hash: string }>();
  const valid = (params.chain === 'arbitrum' || params.chain === 'ethereum') && typeof params.hash === 'string' && /^0x[\da-f]{64}$/i.test(params.hash);
  return valid ? <Receipt key={`${params.chain}:${params.hash}`} chain={params.chain as Chain} hash={params.hash} /> : <Screen title="Transaction"><Note error>Invalid transaction link.</Note><Button label="View Activity" onPress={() => router.replace('/history')} /></Screen>;
}
function Receipt({ chain, hash }: { chain: Chain; hash: string }) {
  const c = useColors();
  const wallet = useWallet();
  const [tx, setTx] = useState<LiveTransaction | null>(wallet.history?.items.find(item => item.hash === hash && item.chain === chain) ?? null), [error, setError] = useState('');
  const [checking, setChecking] = useState(false), [attempt, setAttempt] = useState(0);
  // superseded is terminal too: the nonce was spent by another transaction, so no receipt for
  // this hash can ever exist and polling would continue forever.
  const terminal = tx?.status === 'confirmed' || tx?.status === 'failed' || tx?.status === 'superseded';
  const receipt = useRef(wallet.receipt); useEffect(() => { receipt.current = wallet.receipt; }, [wallet.receipt]);
  // Which transfer the backend has been asked to watch. Once per hash: the route is
  // idempotent, but a POST on every poll would be noise for no answer.
  const registered = useRef('');
  useEffect(() => {
    let stopped = false, active = false, first = true;
    async function check() {
      if (active || stopped) return;
      active = true; setChecking(true);
      try {
        // Keep the chain being asked once this screen is closed and the phone is asleep.
        // Advisory: it never gates the authoritative read below, and never throws.
        const key = `${chain}:${hash}`;
        if (registered.current !== key) { registered.current = key; void watchTransfer(chain, hash); }

        // Cheap first. The backend holds the last receipt it read, so this usually answers
        // from memory, while the real read below goes to a public Sepolia node measured at
        // 11 to 12 seconds a call on 8 November 2026.
        const watched = watchStatus(await readWatch(chain, hash));
        // Skip the expensive call only when the backend affirmatively says the chain has not
        // decided. No opinion — no backend configured, not watched, expired, unreadable —
        // falls through to asking properly, which is what this screen did before the watcher
        // existed. A watcher that cannot answer must never look like a stalled transfer.
        //
        // Never skipped on the first pass of a mount, or on an explicit Check receipt, both
        // of which re-run this effect: somebody waiting deserves the real answer, not a
        // cached one that is up to a poll interval old.
        if (!first && watched === 'pending') return;

        const result = await receipt.current(chain, hash);
        if (!stopped) { setTx(result); setError(''); }
      } catch (failure) {
        if (!stopped) setError(failure instanceof Error ? failure.message : 'Receipt unavailable.');
      } finally {
        first = false; active = false; if (!stopped) setChecking(false);
      }
    }
    if (!wallet.offline) void check();
    const timer = !terminal && !wallet.offline ? setInterval(() => { void check(); }, 10000) : null;
    return () => { stopped = true; if (timer) clearInterval(timer); };
  }, [chain, hash, terminal, attempt, wallet.offline]);
  const status = tx?.status;
  const headline = status === 'confirmed' ? 'Confirmed' : status === 'failed' ? 'Rejected by the network' : status === 'superseded' ? 'Never went through' : status === 'unknown' ? 'Needs a network check' : 'Waiting for the network';
  return <Screen title="Transfer">
    <Pill tone={status === 'confirmed' ? 'success' : 'warning'}>{CHAINS[chain].name}</Pill>
    <Label size={26} weight="semibold">{headline}</Label>
    {status === 'superseded' && <Note>Another transfer took its place in the queue, so this one can never arrive. Your money did not move and no fee was charged.</Note>}
    {!terminal && <Note>Don’t send it again while it’s waiting.</Note>}
    <Card>
      {tx?.amount !== undefined && <Detail label="Amount" value={`${tx.amount} ${tx.symbol ?? 'ETH'}`} />}
      {tx?.recipient && <><Label size={13} color={c.muted}>To</Label><Address value={tx.recipient} /></>}
      {tx?.fee && <Detail label="Fee limit" value={`${tx.fee} ETH`} />}
      <Label size={13} color={c.muted}>Hash</Label><Label selectable size={12}>{hash}</Label>
      {tx?.blockNumber !== null && tx?.blockNumber !== undefined && <Detail label="Block" value={String(tx.blockNumber)} />}
    </Card>
    {!!error && <Note error>{error}</Note>}
    {!terminal && <NeverArrived chain={chain} hash={hash} onResolved={setTx} />}
    {!terminal && <Button secondary label={checking ? 'Checking…' : 'Check again'} disabled={checking || wallet.offline} onPress={() => setAttempt(value => value + 1)} />}
    <Button secondary label="View in explorer" onPress={() => { void Linking.openURL(`${CHAINS[chain].explorer}/tx/${hash}`).catch(() => setError('Could not open the explorer.')); }} />
    <Button label="Done" onPress={() => router.replace('/wallet')} />
  </Screen>;
}
