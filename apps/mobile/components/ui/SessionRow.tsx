import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, radius, spacing } from '@/constants/theme';
import type { Session, SessionIconKind } from '@/lib/types';

import { IconBadge } from './IconBadge';

const ICONS: Record<SessionIconKind, { glyph: string; bg: string; fg: string }> = {
  product: { glyph: '◎', bg: '#60462d', fg: '#f0d8bf' },
  code: { glyph: '</>', bg: '#24474e', fg: '#bfe8ea' },
  research: { glyph: '▥', bg: color.neutralIconBg, fg: color.neutralIconText },
  insights: { glyph: '⚖', bg: color.purpleIconBg, fg: color.purpleIconText },
};

interface Props {
  session: Session;
  onPress: () => void;
  trailing?: React.ReactNode;
}

export function SessionRow({ session, onPress, trailing }: Props) {
  const icon = ICONS[session.icon];
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <IconBadge glyph={icon.glyph} background={icon.bg} foreground={icon.fg} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {session.updatedAtLabel}
        </Text>
      </View>
      {trailing ?? <Text style={styles.arrow}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: color.text,
  },
  meta: {
    marginTop: 4,
    fontSize: font.label,
    color: color.textMuted,
  },
  arrow: {
    fontSize: 22,
    color: color.textSoft,
  },
});
