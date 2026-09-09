import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { type Palette, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';

export function Card({ style, ...rest }: ViewProps) {
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  return <View style={[styles.card, style]} {...rest} />;
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: color.panel,
      borderColor: color.line,
      borderWidth: 1,
      borderRadius: radius.xl,
      padding: spacing.lg,
    },
  });
