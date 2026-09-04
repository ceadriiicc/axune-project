import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

interface Props {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  onColor?: string;
}

export function ToggleRow({ label, value, onValueChange, onColor = color.codex }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#44515f', true: onColor }}
        thumbColor="#ffffff"
        ios_backgroundColor="#44515f"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#eef2f6',
  },
});
