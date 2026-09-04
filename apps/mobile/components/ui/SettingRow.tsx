import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

import { IconBadge } from './IconBadge';

interface Props {
  glyph: string;
  title: string;
  description: string;
  trailing:
    | { kind: 'switch'; value: boolean; onValueChange: (v: boolean) => void }
    | { kind: 'chevron'; onPress?: () => void }
    | { kind: 'text'; value: string; onPress?: () => void };
}

export function SettingRow({ glyph, title, description, trailing }: Props) {
  const content = (
    <View style={styles.row}>
      <View style={styles.left}>
        <IconBadge glyph={glyph} background={color.neutralIconBg} foreground={color.neutralIconText} size={38} />
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.desc}>{description}</Text>
        </View>
      </View>
      {trailing.kind === 'switch' ? (
        <Switch
          value={trailing.value}
          onValueChange={trailing.onValueChange}
          trackColor={{ false: '#44515f', true: color.codex }}
          thumbColor="#ffffff"
          ios_backgroundColor="#44515f"
        />
      ) : trailing.kind === 'text' ? (
        <Text style={styles.trailingText}>{trailing.value}</Text>
      ) : (
        <Text style={styles.arrow}>›</Text>
      )}
    </View>
  );

  if (trailing.kind === 'chevron' || trailing.kind === 'text') {
    return <Pressable onPress={trailing.onPress}>{content}</Pressable>;
  }
  return content;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    padding: spacing.md,
  },
  left: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    flex: 1,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    color: color.text,
    marginBottom: 4,
    fontWeight: '600',
  },
  desc: {
    fontSize: 13,
    color: color.textMuted,
    lineHeight: 18,
  },
  arrow: {
    fontSize: 20,
    color: color.textSoft,
  },
  trailingText: {
    fontSize: 14,
    color: color.textMuted,
  },
});
