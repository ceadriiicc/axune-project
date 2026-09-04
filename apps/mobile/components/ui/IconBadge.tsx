import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius } from '@/constants/theme';

interface Props {
  glyph: string;
  background: string;
  foreground: string;
  size?: number;
}

export function IconBadge({ glyph, background, foreground, size = 46 }: Props) {
  return (
    <View
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: size >= 44 ? radius.sm : 12,
          backgroundColor: background,
        },
      ]}
    >
      <Text style={[styles.glyph, { color: foreground, fontSize: size * 0.46 }]}>{glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  glyph: {
    fontWeight: '600',
  },
});
