import React from 'react';
import { router } from 'expo-router';
import { Button, Card, Label, Screen } from '../components/ui';
import { useDemo } from '../demo/store';
import { useColors } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveActivityCard } from '../components/WalletData';

export default function Notifications() {
  const c = useColors();
  const { state } = useDemo();
  const wallet = useWallet();
  return <Screen title="Notifications">
    {wallet.enabled ? <LiveActivityCard /> : state.transactions.length ? state.transactions.map(item => <Card key={item.id}>
      <Label weight="semibold">{item.status === 'pending' ? 'Sending' : item.status === 'failed' ? 'Failed' : 'Sent'} {item.amount} USDt</Label>
      <Button secondary label="View activity" onPress={() => router.navigate('/history')} />
    </Card>) : <Label color={c.muted}>No notifications yet.</Label>}
  </Screen>;
}
