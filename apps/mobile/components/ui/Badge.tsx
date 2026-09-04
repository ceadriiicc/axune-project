import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { font } from '@/constants/theme';

interface Props {
  label: string;
  tone?: 'codex' | 'gray';
}

export function Badge({ label, tone = 'gray' }: Props) {
  const isCodex = tone === 'codex';
  return (
    <Text
      style={[
        styles.base,
        isCodex ? styles.codex : styles.gray,
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: font.caption,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  codex: {
    backgroundColor: 'rgba(110,184,187,0.16)',
    color: '#b7edf0',
    borderColor: 'rgba(110,184,187,0.14)',
  },
  gray: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#d7dde5',
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
