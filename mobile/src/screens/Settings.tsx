import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Icon, Label, Note, Pill, Screen, shared } from '../components/ui';
import { SettingsToggle as Toggle } from '../components/SettingsToggle';
import { WallyAsset } from '../components/WallyAsset';
import { SettingRow } from './Profile';
import { useDemo } from '../demo/store';
import { colors as c } from '../theme';
import { useWallet } from '../data/wallet';
import { WalletStatus } from '../components/WalletData';
import { PHONE_MODELS, type PhoneModel, type PhoneBackend } from '../services/phone-models';
import { phoneCompatibility } from '../services/phone-adapter';

export function SettingsScreen() { const wallet = useWallet();
  const { state, ai, phone, update } = useDemo();
  const ready = ai.mode === 'qvac' && ai.status === 'ready' && !state.aiPaused;
  return <Screen title="Settings">
    <Label size={12} weight="semibold" color={c.orange}>WALLET</Label>
    <View style={{ gap: 6 }}>
      <SettingRow title="Network" subtitle={wallet.enabled ? 'Arbitrum & Ethereum Sepolia · Testnet' : state.offline ? 'Arbitrum · Offline preview' : 'Arbitrum · Demo wallet'} icon="de282.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'connection' } })} />
      <SettingRow title="Assistant model" subtitle={state.aiPaused ? 'Paused · Manual wallet available' : phone?.phase === 'loading' ? 'Loading model…' : ai.location === 'phone' ? 'QVAC on this phone' : ai.location === 'computer' ? 'QVAC on your computer' : 'Scripted preview'} icon="de282.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'model' } })} />
      <SettingRow title="Address book" subtitle="Your saved recipients" icon="9a2cd.svg" onPress={() => router.push('/address-book')} />
      <SettingRow title="App lock" subtitle="Not enabled · Frontend preview" icon="43454.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'security' } })} />
      <SettingRow title="Recovery phrase" subtitle="Wallet setup guidance" icon="99b43.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'security' } })} />
    </View>
    <Label size={12} weight="semibold" color={c.orange}>ABOUT</Label>
    <View><SettingRow title="App version" subtitle="1.0.0 · Frontend preview" icon="8dca8.svg" /><SettingRow title="Assistant runtime" subtitle={ai.mode === 'qvac' ? 'QVAC · Qwen3 · Local development' : 'Scripted demo responses'} icon="f2470.svg" /></View>
    <Note>{wallet.enabled ? 'This testnet wallet has real signing keys stored privately on your computer. Keys are never sent to chat or the app.' : 'This preview has no real recovery phrase or signing keys.'}</Note>
    <Card><WallyAsset name="c3f35.svg" /><Label size={18} weight="bold">{state.aiPaused ? 'Assistant paused' : ready ? 'Wally is ready' : 'Set up your assistant'}</Label><Label size={16} color={c.muted}>{ai.location === 'phone' ? 'A compatible physical phone and model setup are required.' : ai.location === 'computer' ? 'The Android preview connects to QVAC on your computer.' : 'This preview uses scripted replies.'}</Label><Note>{ready ? 'Model connection verified' : 'Open Assistant model to check the connection'}</Note><Button secondary label="Open Chat" onPress={() => router.push('/chats')} /></Card>
    <Button secondary label="Manage assistant" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'model' } })} />
    <Button secondary label={state.aiPaused ? 'Resume assistant' : 'Pause assistant'} onPress={() => update({ aiPaused: !state.aiPaused })} />
    <SettingRow title="Phone performance" subtitle="Compare models on a physical phone" icon="0aca9.svg" onPress={() => router.push('/phone-performance')} />
    <Button secondary label="Demo controls" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'demo' } })} />
  </Screen>;
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
      <Card><Pill>{wallet.enabled ? 'LOCAL TESTNET WALLET' : 'FRONTEND PREVIEW'}</Pill><Label>{wallet.enabled ? 'Your wallet seed is stored under internal/testnet-wallet/wallet.seed on this computer. The API and chat cannot reveal it. Back up that private file securely before deleting or moving this setup.' : 'No wallet has been created in this demo. There is no recovery phrase to reveal or back up.'}</Label><Note>Never enter a recovery phrase into chat. App lock and phone-local key storage are not implemented yet.</Note></Card><Button label="Back to settings" onPress={() => router.replace('/settings')} />
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
      {wallet.enabled && <WalletStatus />}<Pill tone={state.offline ? 'warning' : 'success'}>{state.offline ? 'Offline preview' : 'Online preview'}</Pill><Toggle label="Simulate offline" subtitle="Keep drafts; disable quotes and sending." value={state.offline} onChange={offline => update({ offline })} /><Note>This switch changes the simulated connection state. The switch blocks new reviews and sends; real balances still require the wallet API.</Note><Button label="Try offline chat" onPress={() => { update({ offline: true }); router.push({ pathname: '/chat', params: { id: newChat() } }); }} /><Button label="Return to wallet" secondary onPress={() => router.replace('/wallet')} />
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
