import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { font, type Palette } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';

interface Props {
  label: string;
  tone?: 'codex' | 'gray';
}

export function Badge({ label, tone = 'gray' }: Props) {
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  const isCodex = tone === 'codex';
  return <Text style={[styles.base, isCodex ? styles.codex : styles.gray]}>{label}</Text>;
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    base: {
      fontSize: font.caption,
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: 999,
      borderWidth: 1,
      overflow: 'hidden',
    },
    codex: {
      backgroundColor: color.codexIconBg,
      color: color.codexText,
      borderColor: color.codex,
    },
    gray: {
      backgroundColor: color.panelAlt,
      color: color.textMuted,
      borderColor: color.line,
    },
  });
