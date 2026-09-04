import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

interface Props {
  eyebrow?: string;
  title: string;
  onBack?: () => void;
  onMore?: () => void;
}

export function TopBar({ eyebrow, title, onBack, onMore }: Props) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.iconBtn} onPress={onBack} disabled={!onBack}>
        {onBack ? <Ionicons name="chevron-back" size={20} color={color.text} /> : <View />}
      </Pressable>
      <View style={styles.center}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Pressable style={styles.iconBtn} onPress={onMore} disabled={!onMore}>
        {onMore ? <Ionicons name="ellipsis-horizontal" size={18} color={color.text} /> : <View />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 12,
    color: color.textSoft,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: color.text,
    marginTop: 2,
  },
});
