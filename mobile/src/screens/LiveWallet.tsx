import React, { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, TextInput, View } from 'react-native';
import { Address, Button, Card, Detail, Label, Note, Pill, Screen, shared } from '../components/ui';
import { LiveActivityCard, LiveReceiveCard, NetworkChoice, WalletStatus } from '../components/WalletData';
import { useWallet } from '../data/wallet';
import { useDemo } from '../demo/store';
import { CHAINS, isAddress, wei, type Chain, type LiveTransaction } from '../services/wallet-api';
import { colors as c } from '../theme';

export function LiveSendScreen() {
  const wallet = useWallet(), { state } = useDemo();
  const params = useLocalSearchParams<{ chain?: string; recipient?: string; amount?: string }>();
  const [chain, setChain] = useState<Chain>(params.chain === 'ethereum' ? 'ethereum' : 'arbitrum');
  const [recipient, setRecipient] = useState(params.recipient ?? ''), [amount, setAmount] = useState(params.amount ?? ''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const balance = wallet.snapshot?.balances.find(item => item.chain === chain);
  async function review() {
    if (busy) return;
    setError('');
    try {
      if (!isAddress(recipient.trim())) throw new Error('Enter a complete, non-zero EVM wallet address.');
      if (wei(amount.trim()) <= 0n) throw new Error('Enter a positive amount.');
      if (state.offline || wallet.offline) throw new Error('Reconnect before reviewing a transfer.');
      setBusy(true); await wallet.prepare({ chain, recipient: recipient.trim(), amount: amount.trim() }); router.push('/review');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not prepare the transfer.'); }
    finally { setBusy(false); }
  }
  return <Screen title="Send testnet ETH" subtitle="A real testnet transfer" footer={<Button label={busy ? 'Checking network fee…' : 'Review transfer'} disabled={busy || wallet.offline || state.offline || !balance || balance.balance === null} onPress={() => { void review(); }} />}><Pill>TESTNET ONLY</Pill><NetworkChoice value={chain} onChange={next => { wallet.clearQuote(); setChain(next); setError(''); }} /><Note>Available on {CHAINS[chain].name}: {balance?.balance ?? 'Unavailable'} ETH</Note><Label weight="medium">Recipient address</Label><TextInput accessibilityLabel="Recipient address" value={recipient} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder="0x…" placeholderTextColor={c.muted} onChangeText={value => { wallet.clearQuote(); setRecipient(value); }} style={shared.input} /><Button secondary label="Choose saved recipient" disabled={busy} onPress={() => router.push('/address-book')} /><Label weight="medium">Amount in ETH</Label><TextInput accessibilityLabel="Amount in ETH" value={amount} editable={!busy} keyboardType="decimal-pad" placeholder="0.001" placeholderTextColor={c.muted} onChangeText={value => { wallet.clearQuote(); setAmount(value); }} style={shared.input} /><Note>Only native testnet ETH to ordinary wallet addresses is supported. Fees are estimated from the selected network. Nothing is sent until you approve the next screen.</Note>{balance?.balance === '0' && <Card style={{ backgroundColor: c.warningTint }}><Label weight="semibold">Fund your testnet wallet first</Label><Note>Request ETH from a {CHAINS[chain].name} faucet for your Receive address. Testnet tokens have no monetary value.</Note><Button secondary label="Open receive address" onPress={() => router.push('/receive')} /></Card>}{!!error && <Note error>{error}</Note>}<WalletStatus /></Screen>;
}
export function LiveReviewScreen() {
  const wallet = useWallet(), { state } = useDemo();
  const [now, setNow] = useState(Date.now), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const q = wallet.quote;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  async function confirm() {
    if (busy || state.offline || wallet.offline) return;
    setBusy(true); setError('');
    try { const tx = await wallet.confirm(); router.replace({ pathname: '/transaction', params: { chain: tx.chain, hash: tx.hash } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Submission could not be verified. Check Activity.'); }
    finally { setBusy(false); }
  }
  const expired = !q || q.expiresAt <= now;
  return <Screen title="Review testnet transfer" footer={<><Button label={busy ? 'Submitting to the testnet…' : 'Confirm and send ETH'} disabled={busy || expired || state.offline || wallet.offline} onPress={() => { void confirm(); }} /><Button secondary label="Cancel" disabled={busy} onPress={() => { wallet.clearQuote(); router.replace('/send'); }} /></>}>{q ? <><Pill>Only {CHAINS[q.chain].name} · Chain {q.chainId}</Pill><Label size={30} weight="semibold">{q.amount} ETH</Label><Card><Note>From</Note><Address value={q.from} /><Note>To</Note><Address value={q.recipient} /><Detail label="Network" value={q.network} /><Detail label="Maximum network fee" value={`${q.fee} ETH`} /><Detail label="Amount + fee" value={`${q.total} ETH`} /><Note>{expired ? 'This review expired. Open Send for a fresh network fee.' : `Review expires in ${Math.max(0, Math.ceil((q.expiresAt - now) / 1000))} seconds.`}</Note></Card><Note>Your approval signs and broadcasts this exact testnet transaction through WDK. Wallet keys stay on your computer in this development setup.</Note></> : <Card><Label weight="semibold">A fresh review is required</Label><Note>{busy ? 'Submission is in progress.' : 'The review expired, was cancelled, or was already submitted. Check Activity before creating another transfer.'}</Note>{!busy && <Button secondary label="Check Activity" onPress={() => router.push('/history')} />}</Card>}{!!error && <Note error>{error}</Note>}{expired && !busy && <Button secondary label="Open Send" onPress={() => router.replace('/send')} />}</Screen>;
}
export function LiveReceiveScreen() { return <Screen title="Receive" subtitle="Your real testnet wallet"><LiveReceiveCard /><WalletStatus /></Screen>; }
export function LiveHistoryScreen() {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('All');
  return <Screen title="Activity" subtitle="Real testnet transactions"><TextInput accessibilityLabel="Search activity" style={shared.input} placeholder="Search address, amount or network" placeholderTextColor={c.muted} value={search} onChangeText={setSearch} /><View style={shared.row}>{['All', 'Sent', 'Received'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: filter === value ? c.tint : c.surface, borderRadius: 18 }}><Label>{value}</Label></Pressable>)}</View><LiveActivityCard search={search} filter={filter} /></Screen>;
}
export function LiveTransactionScreen() {
  const params = useLocalSearchParams<{ chain: string; hash: string }>();
  const valid = (params.chain === 'arbitrum' || params.chain === 'ethereum') && typeof params.hash === 'string' && /^0x[\da-f]{64}$/i.test(params.hash);
  return valid ? <Receipt key={`${params.chain}:${params.hash}`} chain={params.chain as Chain} hash={params.hash} /> : <Screen title="Transaction"><Note error>Invalid transaction link.</Note><Button label="View Activity" onPress={() => router.replace('/history')} /></Screen>;
}
function Receipt({ chain, hash }: { chain: Chain; hash: string }) {
  const wallet = useWallet();
  const [tx, setTx] = useState<LiveTransaction | null>(wallet.history?.items.find(item => item.hash === hash && item.chain === chain) ?? null), [error, setError] = useState('');
  const [checking, setChecking] = useState(false), [attempt, setAttempt] = useState(0);
  const terminal = tx?.status === 'confirmed' || tx?.status === 'failed';
  const receipt = useRef(wallet.receipt); useEffect(() => { receipt.current = wallet.receipt; }, [wallet.receipt]);
  useEffect(() => {
    let stopped = false, active = false;
    async function check() { if (active || stopped) return; active = true; setChecking(true); try { const result = await receipt.current(chain, hash); if (!stopped) { setTx(result); setError(''); } } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : 'Receipt unavailable.'); } finally { active = false; if (!stopped) setChecking(false); } }
    if (!wallet.offline) void check();
    const timer = !terminal && !wallet.offline ? setInterval(() => { void check(); }, 10000) : null;
    return () => { stopped = true; if (timer) clearInterval(timer); };
  }, [chain, hash, terminal, attempt, wallet.offline]);
  return <Screen title="Testnet receipt"><Pill tone={tx?.status === 'confirmed' ? 'success' : 'warning'}>{CHAINS[chain].name}</Pill><Label size={26} weight="semibold">{tx?.status === 'confirmed' ? 'Confirmed on the network' : tx?.status === 'failed' ? 'The network rejected this transfer' : tx?.status === 'unknown' ? 'Submission needs a network check' : 'Waiting for a network receipt'}</Label>{!terminal && <Note>Confirmation comes from the blockchain receipt. There is no simulated confirmation timer. Do not submit another transfer just because a response is slow.</Note>}<Card>{tx?.amount !== undefined && <Detail label="Amount" value={`${tx.amount} ETH`} />}{tx?.recipient && <><Note>Recipient</Note><Address value={tx.recipient} /></>}{tx?.fee && <Detail label="Approved fee limit" value={`${tx.fee} ETH`} />}<Note>Transaction hash</Note><Label selectable size={12}>{hash}</Label>{tx?.blockNumber !== null && tx?.blockNumber !== undefined && <Detail label="Block" value={String(tx.blockNumber)} />}{tx?.checkedAt && <Note>Receipt checked {new Date(tx.checkedAt).toLocaleTimeString()}</Note>}</Card>{!!error && <Note error>{error}</Note>}<Button secondary label={checking ? 'Checking receipt…' : 'Check receipt'} disabled={checking || wallet.offline} onPress={() => setAttempt(value => value + 1)} /><Button secondary label="Open block explorer" onPress={() => { void Linking.openURL(`${CHAINS[chain].explorer}/tx/${hash}`).catch(() => setError('Could not open the explorer.')); }} /><Button label="Back to wallet" onPress={() => router.replace('/wallet')} /></Screen>;
}
