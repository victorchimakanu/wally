import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Icon, Label, Note, Pill, Screen, shared } from '../components/ui';
import { SettingsToggle as Toggle } from '../components/SettingsToggle';
import { WallyAsset } from '../components/WallyAsset';
import { SettingRow } from './Profile';
import { useDemo } from '../demo/store';
import { colors as c } from '../theme';
import { useWallet } from '../data/wallet';
import { WalletStatus } from '../components/WalletData';
import { PHONE_MODELS, type PhoneModel, type PhoneBackend } from '../services/phone-models';
import { marketSource } from '../services/market-api';
import { historySource } from '../services/wallet-api';
import { phoneCompatibility } from '../services/phone-adapter';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { buildInfo, supportSummary, versionLabel } from '../services/build-info';
import { backendOrigin } from '../services/backend';
import { walletStatus, keystoreAvailable, keystoreUnavailableReason, type WalletStatus as VaultStatus } from '../services/wallet-worklet';
import { lockCapability, lockEnabled, type LockCapability } from '../services/app-lock';
import { readDeviceLock, readLockPreference, writeLockPreference } from '../services/device-lock';

/**
 * The version for the Settings row, which used to be the string literal "1.0.0 · Frontend
 * preview". That was wrong twice: the app stopped being a preview when it was renamed, and a
 * hardcoded version keeps claiming 1.0.0 after a release bumps the real one — the one moment
 * the number matters. Same source as the card the row now leads to.
 */
function settingsBuildLine(): string {
  const info = buildInfo({ appVersion: Constants.expoConfig?.version, os: Platform.OS, isDevelopment: __DEV__ });
  return `${versionLabel(info)} · ${info.platform}`;
}

export function SettingsScreen() { const wallet = useWallet();
  const { state, ai, phone, update } = useDemo();
  const ready = ai.mode === 'qvac' && ai.status === 'ready' && !state.aiPaused;
  return <Screen title="Settings">
    <Label size={12} weight="semibold" color={c.orange}>WALLET</Label>
    <View style={{ gap: 6 }}>
      <SettingRow title="Network" subtitle={wallet.enabled ? 'Arbitrum & Ethereum Sepolia · Testnet' : state.offline ? 'Arbitrum · Offline preview' : 'Arbitrum · Demo wallet'} icon="de282.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'connection' } })} />
      <SettingRow title="Assistant model" subtitle={state.aiPaused ? 'Paused · Manual wallet available' : phone?.phase === 'loading' ? 'Loading model…' : ai.location === 'phone' ? 'QVAC on this phone' : ai.location === 'computer' ? 'QVAC on your computer' : 'Scripted preview'} icon="de282.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'model' } })} />
      <SettingRow title="Address book" subtitle="Your saved recipients" icon="9a2cd.svg" onPress={() => router.push('/address-book')} />
      <SettingRow title="App lock" subtitle="Fingerprint, face or passcode" icon="43454.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'security' } })} />
      <SettingRow title="Recovery phrase" subtitle="Wallet setup guidance" icon="99b43.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'security' } })} />
    </View>
    <Label size={12} weight="semibold" color={c.orange}>ABOUT</Label>
    <View><SettingRow title="App version" subtitle={settingsBuildLine()} icon="8dca8.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'connection' } })} /><SettingRow title="Open source licences" subtitle="The software Wally is built on" icon="8dca8.svg" onPress={() => router.push('/licences')} /><SettingRow title="Assistant runtime" subtitle={ai.mode === 'qvac' ? 'QVAC · Qwen3 · Local development' : 'Scripted demo responses'} icon="f2470.svg" /></View>
    <Note>{wallet.enabled ? 'This testnet wallet has real signing keys stored privately on your computer. Keys are never sent to chat or the app.' : 'This preview has no real recovery phrase or signing keys.'}</Note>
    <Card><WallyAsset name="c3f35.svg" /><Label size={18} weight="bold">{state.aiPaused ? 'Assistant paused' : ready ? 'Wally is ready' : 'Set up your assistant'}</Label><Label size={16} color={c.muted}>{ai.location === 'phone' ? 'A compatible physical phone and model setup are required.' : ai.location === 'computer' ? 'The Android preview connects to QVAC on your computer.' : 'This preview uses scripted replies.'}</Label><Note>{ready ? 'Model connection verified' : 'Open Assistant model to check the connection'}</Note><Button secondary label="Open Chat" onPress={() => router.push('/chats')} /></Card>
    <Button secondary label="Manage assistant" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'model' } })} />
    <Button secondary label={state.aiPaused ? 'Resume assistant' : 'Pause assistant'} onPress={() => update({ aiPaused: !state.aiPaused })} />
    <SettingRow title="Phone performance" subtitle="Compare models on a physical phone" icon="0aca9.svg" onPress={() => router.push('/phone-performance')} />
    <Button secondary label="Demo controls" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'demo' } })} />
  </Screen>;
}

/**
 * What this build is, where support can find it.
 *
 * A support conversation cannot start without a version, and until now the app never showed
 * one. Copyable in a single tap because asking someone to type "Wally 1.0.0 (release) ·
 * android 14 · Pixel 6a" by hand is asking them not to bother.
 *
 * Nothing here identifies a person — no address, no install id. The device model identifies a
 * product, and it is assembled only when someone chooses to copy it.
 */
function BuildCard() {
  const [copied, setCopied] = useState(false);
  const info = buildInfo({
    appVersion: Constants.expoConfig?.version,
    os: Platform.OS,
    // Device.osVersion, not Platform.Version: it is the documented API for this (expo-constants
    // marks its own equivalent deprecated in favour of expo-device), and it returns null rather
    // than a placeholder where the OS version is unknown. Platform.Version reported "0.0.0" on
    // web, which reads as a bug in the support tool rather than as an absent value.
    osVersion: Device.osVersion ?? undefined,
    deviceModel: Device.modelName ?? undefined,
    isDevelopment: __DEV__,
    backendOrigin: backendOrigin(),
  });
  async function copy() {
    try { setCopied(await Clipboard.setStringAsync(supportSummary(info))); } catch { setCopied(false); }
  }
  return <Card>
    <Label size={12} weight="semibold" color={c.orange}>THIS BUILD</Label>
    <Label size={16}>Wally {versionLabel(info)}</Label>
    <Label size={12} color={c.muted} selectable>{info.platform} · {info.device}</Label>
    <Label size={12} color={c.muted} selectable>Backend: {info.backend}</Label>
    <Note>Include this if you report a problem. It names the build and the device, and nothing about you or your wallet.</Note>
    <Button secondary label={copied ? 'Copied' : 'Copy for support'} onPress={() => { void copy(); }} />
  </Card>;
}

/**
 * The app lock setting.
 *
 * On by default wherever the phone can back it, because a safe default matters most for the
 * people who never open settings — and this is money. It can be turned off, and the choice is
 * stored in the OS keystore rather than ordinary app storage: "app lock is off" is a
 * security-relevant claim, and somewhere an attacker with the handset could flip it is the
 * wrong place to keep it.
 *
 * Only rendered on a build that can hold a wallet. In the browser there is nothing to lock,
 * and telling someone their *phone* has no screen lock when they are on a laptop would be
 * nonsense.
 */
function AppLockCard() {
  const [capability, setCapability] = useState<LockCapability | null>(null);
  const [preference, setPreference] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [device, stored] = await Promise.all([readDeviceLock(), readLockPreference()]);
      if (!live) return;
      setCapability(lockCapability(device));
      setPreference(stored);
    })().catch(() => { /* leaves the card in its loading state rather than claiming a state */ });
    return () => { live = false; };
  }, []);

  async function choose(next: boolean) {
    setSaving(true);
    setPreference(next);
    try { await writeLockPreference(next); }
    catch { setPreference(!next); }  // Not stored means not changed; say so by reverting.
    finally { setSaving(false); }
  }

  if (!capability) return null;

  return <Card>
    <Label size={12} weight="semibold" color={c.orange}>APP LOCK</Label>
    {capability.available ? <>
      <Toggle
        label={capability.level === 'biometric' ? 'Ask for fingerprint or face' : 'Ask for your passcode'}
        subtitle="Before showing your recovery phrase, and before every transfer"
        value={lockEnabled(capability, preference)}
        onChange={next => { void choose(next); }}
      />
      {!lockEnabled(capability, preference) && <Note error>With this off, anyone holding this phone unlocked can see your recovery phrase and spend your money.</Note>}
      <Note>Balances, receiving and Activity are never locked — checking whether money arrived should not cost you a prompt.</Note>
      {saving && <Note>Saving…</Note>}
    </> : <>
      <Label>Not available on this phone</Label>
      <Note error>{capability.reason}</Note>
    </>}
  </Card>;
}

/**
 * What this phone holds, and the four things a user can do about it.
 *
 * This panel used to promise that "the full wallet will guide you through creating or
 * importing a wallet, backing up your recovery phrase, and unlocking securely". None of those
 * screens existed — FEATURE-AUDIT §1. They do now, and this is where they are reached.
 *
 * The dev-server wallet is reported separately and on purpose. It is a different wallet with a
 * different seed, living on the developer's computer, and conflating the two would be the
 * worst possible confusion to introduce on a screen about recovery.
 */
function WalletKeysCard({ devWallet }: { devWallet: boolean }) {
  const [status, setStatus] = useState<VaultStatus | null>(null);

  useEffect(() => {
    let live = true;
    void walletStatus().then(next => { if (live) setStatus(next); }).catch(() => { if (live) setStatus({ available: false }); });
    return () => { live = false; };
  }, []);

  return <>
    {status?.available === true && (status.exists ? <Card>
      <Pill tone={status.backedUpAt ? 'success' : 'warning'}>{status.backedUpAt ? 'WALLET ON THIS PHONE' : 'NOT BACKED UP'}</Pill>
      <Label>{status.backedUpAt
        ? `Your keys are held on this phone. You confirmed your recovery phrase on ${new Date(status.backedUpAt).toLocaleDateString()}.`
        : 'Your keys are held on this phone, and your recovery phrase is not written down yet. Until it is, sending stays switched off — there would be no way back if you lost this phone.'}</Label>
      <Button
        label={status.backedUpAt ? 'Show recovery phrase' : 'Write down my recovery phrase'}
        secondary={!!status.backedUpAt}
        onPress={() => router.push({ pathname: '/recovery-phrase', params: { mode: status.backedUpAt ? 'view' : 'setup' } })}
      />
      <Button secondary label="Remove this wallet" onPress={() => router.push('/reset-wallet')} />
    </Card> : <Card>
      <Pill>NO WALLET ON THIS PHONE</Pill>
      <Label>Create one, or bring in an existing wallet with its recovery phrase.</Label>
      <Button label="Set up a wallet" onPress={() => router.push('/wallet-setup')} />
    </Card>)}

    {status?.available === false && <Card>
      <Pill>PREVIEW</Pill>
      <Label>{keystoreUnavailableReason()}</Label>
    </Card>}

    {devWallet && <Card>
      <Pill>DEVELOPER WALLET</Pill>
      <Label>Balances and sending currently come from the wallet server on your computer, whose seed is stored under internal/testnet-wallet/wallet.seed. That is a different wallet from any held on this phone — back up that file separately.</Label>
    </Card>}
  </>;
}

export function PreferencesScreen() { const wallet = useWallet();
  const { panel } = useLocalSearchParams<{ panel: string }>();
  const { state, ai, phone, phoneMetrics, loadPhone, releasePhone, checkAi, cancelAi, update, reset, newChat } = useDemo();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [selectedModel, setSelectedModel] = useState<PhoneModel>('qwen3-600m');
  const [backend, setBackend] = useState<PhoneBackend>('cpu');
  const title = panel === 'security' ? 'Recovery & security' : panel === 'model' ? 'Local model' : panel === 'connection' ? 'Connection' : 'Demo controls';
  return <Screen title={title} subtitle={panel === 'demo' || !panel ? undefined : 'Frontend preview settings'}>
    {panel === 'security' ? <>
      <View style={[shared.orb, { marginVertical: 20 }]}><Icon name="shield" /></View><Label size={24} weight="semibold">Your wallet. Your keys.</Label><Label color={c.muted}>The full wallet will guide you through creating or importing a wallet, backing up your recovery phrase, and unlocking securely.</Label>
      <WalletKeysCard devWallet={wallet.enabled} />
      {keystoreAvailable && <AppLockCard />}
      <Card><Note>Never enter a recovery phrase into chat. Wally will never ask you for it.</Note></Card>
      <Button label="Back to settings" onPress={() => router.replace('/settings')} />
    </> : panel === 'model' ? <>
      <Card style={{ backgroundColor: c.tint }}><View style={shared.row}><Icon name="spark" /><Label size={18} weight="semibold">{ai.mode === 'qvac' ? (ai.location === 'phone' ? 'QVAC on this phone' : 'QVAC development connection') : 'Chat without the setup'}</Label></View><Label>{ai.mode === 'qvac' ? (ai.location === 'phone' ? 'Set up a model once, then run chat inside this phone. No AI server is contacted for inference. Wallet controls fetch data separately from the model.' : 'The Android preview calls QVAC on this computer through a local connection. No model is bundled in the phone yet. The model interprets requests; wallet controls fetch data separately.') : 'This build demonstrates the interface with scripted replies. It does not download or run an AI model.'}</Label></Card>
      {ai.location === 'phone' && <Card><Label weight="semibold">Run AI on this phone</Label><Note>{phoneCompatibility().reason || 'CPU is the starting option. Try GPU after measuring this phone.'}</Note>
        {(['qwen3-600m', 'qwen3-1.7b'] as const).map(candidate => <Button key={candidate} label={(selectedModel === candidate ? 'Selected: ' : '') + PHONE_MODELS[candidate].label} secondary onPress={() => setSelectedModel(candidate)} disabled={ai.status === 'working'} />)}
        <Toggle label="Use phone GPU" subtitle="Optional acceleration; compatibility varies." value={backend === 'gpu'} onChange={value => setBackend(value ? 'gpu' : 'cpu')} />
        <Note>Download: {(PHONE_MODELS[selectedModel].bytes / 1e6).toFixed(0)} MB. Runtime memory is additional.</Note>
        <Button label={ai.status === 'working' ? 'Cancel setup' : 'Set up selected model'} onPress={ai.status === 'working' ? cancelAi : () => loadPhone(selectedModel, backend)} disabled={!phoneCompatibility().supported || state.aiPaused || state.offline} />
        {!!phone && <Note>{PHONE_MODELS[phone.model].label} · {phone.phase}{phone.progress !== null ? ` · ${phone.progress}%` : ''}</Note>}
        {!!phone?.error && <Note error>{phone.error}</Note>}
        <Button label="Release model memory" secondary onPress={releasePhone} />
        {phoneMetrics && <Note>Last reply: {(phoneMetrics.totalMs / 1000).toFixed(2)}s · Backend: {phoneMetrics.actualBackend ?? 'unreported'}</Note>}
        <Note>Wally releases the model after two minutes idle and when backgrounded. Downloaded weights stay on this phone.</Note>
      </Card>}
      {ai.mode === 'qvac' && <Card><Label weight="medium">{ai.status === 'ready' ? 'Verified: model answered' : ai.status === 'working' ? 'Checking local AI…' : ai.status === 'error' ? 'Connection needs attention' : 'Connection not checked yet'}</Label>{!!ai.error && <Note error>{ai.error}</Note>}<Button label={ai.status === 'working' ? 'Cancel check' : 'Test AI connection'} onPress={ai.status === 'working' ? cancelAi : checkAi} disabled={state.aiPaused || (state.offline && ai.location !== 'phone')} /><Note>The test sends a sample balance question and checks an actual model response.</Note></Card>}
      <Toggle label="Pause chat" subtitle="Keep using the wallet’s manual controls." value={state.aiPaused} onChange={aiPaused => update({ aiPaused })} /><Button label="Open a new chat" onPress={() => router.push({ pathname: '/chat', params: { id: newChat() } })} /><Button label="Use manual send" secondary onPress={() => router.push('/send')} />
    </> : panel === 'connection' ? <>
      {wallet.enabled && <WalletStatus />}<Pill tone={state.offline ? 'warning' : 'success'}>{state.offline ? 'Offline preview' : 'Online preview'}</Pill><Toggle label="Simulate offline" subtitle="Keep drafts; disable quotes and sending." value={state.offline} onChange={offline => update({ offline })} /><Note>This switch changes the simulated connection state. The switch blocks new reviews and sends; real balances still require the wallet API.</Note><Card><Label size={12} weight="semibold" color={c.orange}>MARKET DATA</Label><Label size={16}>{marketSource().label}</Label><Label size={12} color={c.muted} selectable>{marketSource().url}</Label><Note>{marketSource().mode === 'proxy' ? 'Prices and charts go through your Wally backend, which caches them and keeps the provider key off this device.' : 'Prices come straight from the provider. Set EXPO_PUBLIC_WALLY_PROXY_URL and restart Metro to use your backend.'}</Note></Card>{wallet.enabled && <Card><Label size={12} weight="semibold" color={c.orange}>ACTIVITY</Label><Label size={16}>{historySource().label}</Label><Label size={12} color={c.muted} selectable>{historySource().url}</Label><Note>{historySource().mode === 'proxy' ? 'Transaction history is read from your Wally backend and merged with transfers sent from this device.' : 'History comes from the local wallet server. Set EXPO_PUBLIC_WALLY_PROXY_URL and restart Metro to use your backend.'}</Note></Card>}<BuildCard /><Button label="Try offline chat" onPress={() => { update({ offline: true }); router.push({ pathname: '/chat', params: { id: newChat() } }); }} /><Button label="Return to wallet" secondary onPress={() => router.replace('/wallet')} />
    </> : <>
      <Card style={styles.demoIntro}>
        <Label size={20} weight="semibold">Try every outcome</Label>
        <Label color={c.muted}>{wallet.enabled ? 'Testnet wallet is connected. Failure and short-expiry demo switches affect saved simulation data only. They cannot control real blockchain outcomes.' : 'Explore connection, transfer and quote scenarios with sample funds.'}</Label>
      </Card>
      <Card style={styles.demoControls}>
        <Toggle contained={false} label="Simulate offline" subtitle="Drafts work; new transfers are blocked." value={state.offline} onChange={offline => update({ offline })} />
        <Divider />
        <Toggle contained={false} label="Fail next transfer" subtitle="The next approved demo transfer is refunded." value={state.failNext} onChange={failNext => update({ failNext })} />
        <Divider />
        <Toggle contained={false} label="Short quote expiry" subtitle="New quotes expire in 5 seconds instead of 60." value={state.quoteSeconds === 5} onChange={short => update({ quoteSeconds: short ? 5 : 60 })} />
      </Card>
      <View style={shared.gap}>
        <Button label="Try a transfer" onPress={() => router.push('/send')} />
        <Button label="Reset demo" secondary onPress={() => setResetConfirm(true)} />
      </View>
      {resetConfirm && <Card style={styles.resetNotice}><Label size={18} weight="semibold">Reset this preview?</Label><Note>This clears your sample chats and transfers and restores the 1,250 USDT demo balance.</Note><Button label="Yes, reset demo" onPress={() => { reset(); router.replace('/'); }} /><Button label="Keep my demo" secondary onPress={() => setResetConfirm(false)} /></Card>}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  demoIntro: { backgroundColor: c.tint, borderColor: c.tint, padding: 24, gap: 12 },
  demoControls: { gap: 0, paddingVertical: 4 },
  resetNotice: { backgroundColor: c.amber, borderColor: c.amber },
});
