import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.panel,
    borderColor: color.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
