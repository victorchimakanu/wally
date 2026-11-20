import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { Button, Card, Divider, Group, Label, Note, Pill, Row, Screen } from '../components/ui';
import { SettingsToggle as Toggle } from '../components/SettingsToggle';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { APPEARANCES, type Appearance } from '../services/preferences-store';
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
import { custodyNotice } from '../services/custody';
import { readDeviceLock, readLockPreference, writeLockPreference } from '../services/device-lock';

/**
 * The version for the Settings row, which used to be the string literal "1.0.0 · Frontend
 * preview". That was wrong twice: the app stopped being a preview when it was renamed, and a
 * hardcoded version keeps claiming 1.0.0 after a release bumps the real one — the one moment
 * the number matters. Same source as the card the row now leads to.
 */
function settingsBuildLine(): string {
  return versionLabel(buildInfo({ appVersion: Constants.expoConfig?.version, os: Platform.OS, isDevelopment: __DEV__ }));
}

/**
 * Settings is a list of places, each row saying where it goes and, when there is one, its
 * current value. Explanations live on the screen a row opens, never under the row.
 */
const APPEARANCE_LABELS: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function SettingsScreen() {
  const wallet = useWallet();
  const { state, ai, phone } = useDemo();
  const { preferences, updatePreferences } = usePreferences();
  const appearance = preferences.appearance ?? 'system';
  const open = (panel: Panel) => router.push({ pathname: '/preferences', params: { panel } });
  const network = wallet.enabled ? 'Testnet' : state.offline ? 'Offline' : 'Demo';
  const assistant = state.aiPaused ? 'Paused' : phone?.phase === 'loading' ? 'Loading' : ai.mode !== 'qvac' ? 'Scripted' : ai.location === 'phone' ? 'This phone' : 'Your computer';
  return <Screen title="Settings">
    <Group>
      <Row title="Network" value={network} onPress={() => open('connection')} />
      <Row title="Assistant" value={assistant} onPress={() => open('model')} />
      <Row title="Address book" onPress={() => router.push('/address-book')} />
      <Row title="Security" onPress={() => open('security')} />
    </Group>
    <Group title="Appearance">
      {APPEARANCES.map(value => <Row key={value} title={APPEARANCE_LABELS[value]} selected={appearance === value} onPress={() => updatePreferences({ appearance: value })} />)}
    </Group>
    <Group>
      {/* FEATURE-AUDIT §11.2–11.3: people need transaction records for tax and the app
          could produce none — every hit for "export" in the codebase was `export function`. */}
      <Row title="Export history" onPress={() => router.push('/export-data')} />
      {/* FEATURE-AUDIT §11.5. Chats persisted here with no way to clear them, which left
          uninstalling the app as the only route — and that takes the wallet with it. */}
      <Row title="Clear chats" onPress={() => router.push('/clear-chats')} />
      <Row title="Problem reports" onPress={() => router.push('/problems')} />
    </Group>
    <Group>
      <Row title="Version" value={settingsBuildLine()} onPress={() => open('about')} />
      <Row title="Licences" onPress={() => router.push('/licences')} />
      <Row title="Demo controls" onPress={() => open('demo')} />
    </Group>
    <Group><Row title="Remove this wallet" danger onPress={() => router.push('/reset-wallet')} /></Group>
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
  return <>
    <Group>
      <Row title="Version" value={versionLabel(info)} />
      <Row title="Platform" value={info.platform} />
      <Row title="Device" value={info.device} />
      <Row title="Backend" value={info.backend} />
    </Group>
    <Button secondary label={copied ? 'Copied' : 'Copy for support'} onPress={() => { void copy(); }} />
  </>;
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

  // The label says what is locked, so the switch needs no explanation; the warning stays
  // because turning it off is the one choice here that can cost money.
  return <Card>
    {capability.available ? <>
      <Toggle contained={false} label="Lock sending and recovery phrase" value={lockEnabled(capability, preference)} onChange={next => { void choose(next); }} />
      {!lockEnabled(capability, preference) && <Note error>With this off, anyone holding this phone unlocked can see your recovery phrase and spend your money.</Note>}
      {saving && <Note>Saving…</Note>}
    </> : <>
      <Label>App lock is unavailable on this phone</Label>
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
      <Pill tone={status.backedUpAt ? 'success' : 'warning'}>{status.backedUpAt ? `Backed up ${new Date(status.backedUpAt).toLocaleDateString()}` : 'Not backed up'}</Pill>
      {/* The phrase and the money can belong to different wallets. Saying "you confirmed your
          recovery phrase" beside balances it does not protect is the confusion custody.ts
          exists to prevent, so the warning sits with the claim. */}
      {!status.protectsDisplayedFunds && <Note error>{custodyNotice(status.custody) ?? 'This phrase does not control the balances shown elsewhere in the app.'}</Note>}
      {!status.backedUpAt && <Label>Sending stays off until your recovery phrase is written down.</Label>}
      <Button
        label={status.backedUpAt ? 'Show recovery phrase' : 'Write down my recovery phrase'}
        secondary={!!status.backedUpAt}
        onPress={() => router.push({ pathname: '/recovery-phrase', params: { mode: status.backedUpAt ? 'view' : 'setup' } })}
      />
    </Card> : <Card>
      <Label weight="semibold">No wallet on this phone</Label>
      <Button label="Set up a wallet" onPress={() => router.push('/wallet-setup')} />
    </Card>)}

    {status?.available === false && <Note>{keystoreUnavailableReason()}</Note>}

    {devWallet && <Card>
      <Label weight="semibold">Developer wallet</Label>
      <Note>Balances and sending come from the wallet server on your computer. Its seed is in internal/testnet-wallet/wallet.seed, a different wallet from any on this phone: back that file up separately.</Note>
    </Card>}
  </>;
}

type Panel = 'security' | 'model' | 'connection' | 'about' | 'demo';
const PANEL_TITLES: Record<Panel, string> = { security: 'Security', model: 'Assistant', connection: 'Network', about: 'About', demo: 'Demo controls' };

export function PreferencesScreen() {
  const wallet = useWallet();
  const params = useLocalSearchParams<{ panel: string }>();
  const panel: Panel = params.panel && params.panel in PANEL_TITLES ? params.panel as Panel : 'demo';
  const { state, ai, phone, phoneMetrics, loadPhone, releasePhone, checkAi, cancelAi, update, reset } = useDemo();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [selectedModel, setSelectedModel] = useState<PhoneModel>('qwen3-600m');
  const [backend, setBackend] = useState<PhoneBackend>('cpu');
  const compatibility = phoneCompatibility();
  return <Screen title={PANEL_TITLES[panel]}>
    {panel === 'security' ? <>
      <WalletKeysCard devWallet={wallet.enabled} />
      {keystoreAvailable && <AppLockCard />}
      <Note>Wally never asks for your recovery phrase. Never type it into a chat.</Note>
    </> : panel === 'model' ? <>
      <Group>
        <Row title="Runs on" value={ai.mode !== 'qvac' ? 'Scripted replies' : ai.location === 'phone' ? 'This phone' : 'Your computer'} />
        {ai.mode === 'qvac' && <Row title="Status" value={ai.status === 'ready' ? 'Ready' : ai.status === 'working' ? 'Checking…' : ai.status === 'error' ? 'Needs attention' : 'Not checked'} />}
        {phoneMetrics && <Row title="Last reply" value={`${(phoneMetrics.totalMs / 1000).toFixed(2)} s · ${phoneMetrics.actualBackend ?? 'unreported'}`} />}
      </Group>
      <Toggle label="Pause assistant" value={state.aiPaused} onChange={aiPaused => update({ aiPaused })} />
      {!!ai.error && <Note error>{ai.error}</Note>}
      {ai.mode === 'qvac' && <Button secondary label={ai.status === 'working' ? 'Cancel check' : 'Test connection'} onPress={ai.status === 'working' ? cancelAi : checkAi} disabled={state.aiPaused || (state.offline && ai.location !== 'phone')} />}
      {ai.location === 'phone' && <>
        <Group title="Model on this phone">
          {(['qwen3-600m', 'qwen3-1.7b'] as const).map(candidate => <Row key={candidate} title={PHONE_MODELS[candidate].label} value={`${(PHONE_MODELS[candidate].bytes / 1e6).toFixed(0)} MB`} selected={selectedModel === candidate} onPress={() => { if (ai.status !== 'working') setSelectedModel(candidate); }} />)}
        </Group>
        {!!compatibility.reason && <Note>{compatibility.reason}</Note>}
        <Toggle label="Use phone GPU" value={backend === 'gpu'} onChange={value => setBackend(value ? 'gpu' : 'cpu')} />
        <Button label={ai.status === 'working' ? 'Cancel setup' : 'Set up model'} onPress={ai.status === 'working' ? cancelAi : () => loadPhone(selectedModel, backend)} disabled={!compatibility.supported || state.aiPaused || state.offline} />
        {!!phone && <Note>{PHONE_MODELS[phone.model].label} · {phone.phase}{phone.progress !== null ? ` · ${phone.progress}%` : ''}</Note>}
        {!!phone?.error && <Note error>{phone.error}</Note>}
        <Button label="Release model memory" secondary onPress={releasePhone} />
      </>}
      <Group><Row title="Phone performance" onPress={() => router.push('/phone-performance')} /></Group>
    </> : panel === 'connection' ? <>
      <Group>
        <Row title="Wallet" value={wallet.enabled ? 'Testnet' : 'Demo'} />
        <Row title="Networks" value={wallet.enabled ? 'Arbitrum, Ethereum Sepolia' : 'Arbitrum'} />
        <Row title="Market data" value={marketSource().label} />
        {wallet.enabled && <Row title="Activity" value={historySource().label} />}
      </Group>
      {wallet.enabled && <WalletStatus />}
    </> : panel === 'about' ? <BuildCard /> : <>
      <Card style={styles.demoControls}>
        <Toggle contained={false} label="Simulate offline" value={state.offline} onChange={offline => update({ offline })} />
        {/* The other two only shape simulated transfers, so they are not offered beside a real testnet wallet. */}
        {!wallet.enabled && <>
          <Divider />
          <Toggle contained={false} label="Fail the next transfer" value={state.failNext} onChange={failNext => update({ failNext })} />
          <Divider />
          <Toggle contained={false} label="Quotes expire in 5 seconds" value={state.quoteSeconds === 5} onChange={short => update({ quoteSeconds: short ? 5 : 60 })} />
        </>}
      </Card>
      {resetConfirm
        ? <Card><Label size={18} weight="semibold">Reset the demo?</Label><Note>Sample chats and transfers are cleared and the 1,250 USDt balance comes back.</Note><Button label="Reset demo" onPress={() => { reset(); router.replace('/'); }} /><Button label="Cancel" secondary onPress={() => setResetConfirm(false)} /></Card>
        : <Button label="Reset demo" secondary onPress={() => setResetConfirm(true)} />}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  demoControls: { gap: 0, paddingVertical: 4, paddingHorizontal: 16 },
});
