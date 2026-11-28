import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Group, Label, useShared } from './ui';
import { useColors } from '../theme';

/** A switch with a label that says what it does, so it needs no explanation underneath. */
export function SettingsToggle({ label, value, onChange, icon, contained = true }: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
  contained?: boolean;
}) {
  const c = useColors();
  const shared = useShared();
  const content = <View style={[shared.row, styles.row]}>
    {icon}
    <Label size={16} style={shared.flex}>{label}</Label>
    <View style={styles.control}>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange}
        trackColor={{ false: c.toggle, true: c.brand }} thumbColor={value ? c.knobOn : c.knobOff} ios_backgroundColor={c.toggle} />
    </View>
  </View>;
  return contained ? <Group><View style={styles.contained}>{content}</View></Group> : content;
}

const styles = StyleSheet.create({
  contained: { paddingHorizontal: 16 },
  row: { minHeight: 54, paddingVertical: 6 },
  control: { minWidth: 44, minHeight: 44, flexShrink: 0, justifyContent: 'center', alignItems: 'center' },
});
