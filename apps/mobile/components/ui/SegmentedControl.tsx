import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

interface Option {
  key: string;
  label: string;
  glyph?: string;
}

interface Props {
  options: [Option, Option];
  value: string;
  onChange: (key: string) => void;
}

export function SegmentedControl({ options, value, onChange }: Props) {
  return (
    <View style={styles.track}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {opt.glyph ? (
              <Text style={[styles.glyph, active && styles.textActive]}>{opt.glyph}</Text>
            ) : null}
            <Text style={[styles.label, active && styles.textActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: 6,
    marginTop: spacing.lg,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 14,
    paddingVertical: 13,
  },
  segmentActive: {
    backgroundColor: color.claude,
  },
  glyph: {
    fontSize: 15,
    color: color.textMuted,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: color.textMuted,
  },
  textActive: {
    color: '#1e1b18',
  },
});
