import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, spacing } from '@/constants/theme';

interface Props {
  label: string;
  action?: string;
  onPressAction?: () => void;
}

export function SectionLabel({ label, action, onPressAction }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {action ? (
        <Pressable onPress={onPressAction} hitSlop={8}>
          <Text style={styles.action}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: font.label,
    fontWeight: '600',
    color: '#eef2f7',
  },
  action: {
    fontSize: font.label,
    color: color.textSoft,
    fontWeight: '500',
  },
});
