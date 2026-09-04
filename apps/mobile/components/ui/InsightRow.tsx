import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

import { IconBadge } from './IconBadge';

interface Props {
  glyph: string;
  iconBg: string;
  iconFg: string;
  title: string;
  body: string;
}

export function InsightRow({ glyph, iconBg, iconFg, title, body }: Props) {
  return (
    <View style={styles.row}>
      <IconBadge glyph={glyph} background={iconBg} foreground={iconFg} size={42} />
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    padding: spacing.md,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: color.text,
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: color.textMuted,
  },
});
