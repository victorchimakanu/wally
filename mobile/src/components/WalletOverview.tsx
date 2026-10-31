import React, { useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { WallyAsset } from './WallyAsset';
import { Button, Card, Detail, Label, shared } from './ui';
import { useDemo } from '../demo/store';
import { money } from '../demo/model';
import { colors as c } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveWalletOverview } from './WalletData';

export function WalletOverview({ balance, transactionId, snapshot = false }: { balance?: number; transactionId?: string; snapshot?: boolean } = {}) {
  const wallet = useWallet();
  return wallet.enabled && !snapshot ? <LiveWalletOverview /> : <DemoWalletOverview balance={balance} transactionId={transactionId} snapshot={snapshot} />;
}
function DemoWalletOverview({ balance, transactionId, snapshot = false }: { balance?: number; transactionId?: string; snapshot?: boolean }) {
  const { state } = useDemo();
  const [width, setWidth] = useState(384);
  const [expanded, setExpanded] = useState(false);
  const [activity, setActivity] = useState(false);
  const mobile = useWindowDimensions().width < 768;
  const scale = width / 384;
  const displayedBalance = balance ?? state.balance;
  const latest = snapshot ? state.transactions.find(item => item.id === transactionId) : state.transactions[0];
  return <View style={{ gap: 12 }}>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: 238 * scale }}>
      <View style={{ width: 384, height: 238, position: 'absolute', transformOrigin: 'top left', transform: [{ scale }] }}>
        <View style={{ position: 'absolute', top: 13.4, width: 384, height: 223.439, overflow: 'hidden', borderRadius: 22.326 }}>
          <WallyAsset name="6a869.svg" />
          <WallyAsset name="d7e4c.svg" style={{ position: 'absolute', left: 324.49, top: 5.61, opacity: .55 }} />
          <WallyAsset name="27e99.svg" style={{ position: 'absolute', left: -150.46, top: 5.61, opacity: .55 }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')} style={{ position: 'absolute', left: 165.05, top: 2.23, width: 53.895, height: 53.895, borderRadius: 27, overflow: 'hidden' }}>
          <Image source={require('../../assets/wallyui/9b60e.png')} accessible={false} contentFit="cover" style={{ position: 'absolute', left: -37.726, top: 0, width: 139.436, height: 92.968 }} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse wallet balances' : 'Expand wallet balances'} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ position: 'absolute', top: 72, left: 26.79, width: 330.419, height: 146, alignItems: 'center', gap: 9 }}>
          <View style={[shared.row, { width: '100%', paddingHorizontal: 8, gap: 9 }]}>
            <View style={{ width: 18 }} />
            <Label size={17.86} style={{ flex: 1, textAlign: 'center', lineHeight: 25.67 }}>Personal wallet</Label>
            <WallyAsset name="e353f.svg" size={18} style={{ transform: [{ rotate: expanded ? '-90deg' : '90deg' }] }} />
          </View>
          <View style={[shared.row, { gap: 9 }]}><Label size={40.186} weight="semibold" adjustsFontSizeToFit numberOfLines={1} style={{ lineHeight: 46.884, maxWidth: 282 }}>{money(displayedBalance)}</Label><Label size={13.395} weight="medium">USDt</Label></View>
          <Label size={13.395} weight="medium">{state.offline ? 'Cached balance' : '3 networks'}</Label>
        </Pressable>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={mobile ? 'View notifications' : 'Toggle recent activity'} accessibilityState={mobile ? undefined : { expanded: activity }} onPress={() => mobile ? router.navigate('/notifications') : setActivity(value => !value)} style={{ marginTop: -16, marginHorizontal: 26 * scale, backgroundColor: c.tint, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, padding: 16, paddingTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={shared.flex}><Label size={13} numberOfLines={1}>{latest ? `${latest.status === 'pending' ? 'Sending' : latest.status === 'failed' ? 'Failed' : 'Sent'} ${latest.amount} USDt` : 'Your recent activity'}</Label><Label size={11} color={c.muted}>{latest ? `${latest.status} · Arbitrum · Demo` : 'No transfers yet · Demo wallet'}</Label></View><WallyAsset name="7da25.svg" />
    </Pressable>
    {expanded && <Card><Detail label="Arbitrum" value={`${money(displayedBalance)} USDt`} /><Detail label="Ethereum" value="0.042 ETH" /><Detail label="Bitcoin" value="0.0012 BTC" /><Label size={12} color={c.muted}>Fictional balances. Arbitrum USDt is the only simulated send asset.</Label></Card>}
    {!mobile && activity && <Card><Label weight="semibold">Recent activity</Label>{latest ? <Label size={13}>{latest.amount} USDt · {latest.status}</Label> : <Label size={13} color={c.muted}>Approved demo transfers appear here.</Label>}<Button label="View activity" secondary onPress={() => router.push('/history')} /></Card>}
  </View>;
}
