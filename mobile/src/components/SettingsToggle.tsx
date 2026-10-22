import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Card, Label, shared } from './ui';
import { colors as c } from '../theme';

export function SettingsToggle({ label, subtitle, value, onChange, icon, contained = true }: {
  label: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
  contained?: boolean;
}) {
  const content = <View style={[shared.row, styles.row]}>
    {icon}
    <View style={[shared.flex, styles.copy]}>
      <Label size={16} weight="medium">{label}</Label>
      <Label size={12} color={c.muted}>{subtitle}</Label>
    </View>
    <View style={styles.control}>
      <Switch accessibilityLabel={label} accessibilityHint={subtitle} value={value} onValueChange={onChange}
        trackColor={{ false: c.toggle, true: c.brand }} thumbColor={c.surface} ios_backgroundColor={c.toggle} />
    </View>
  </View>;
  return contained ? <Card style={styles.card}>{content}</Card> : content;
}

const styles = StyleSheet.create({
  card: { paddingVertical: 0 },
  row: { minHeight: 92, paddingVertical: 16 },
  copy: { gap: 4, minWidth: 0 },
  control: { minWidth: 44, minHeight: 44, flexShrink: 0, justifyContent: 'center', alignItems: 'center' },
});
