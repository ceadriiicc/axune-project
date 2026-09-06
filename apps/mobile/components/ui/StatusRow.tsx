import { Ionicons } from '@expo/vector-icons';
import type { AgentStatus, ProjectSummary } from '@axune/protocol';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, spacing } from '@/constants/theme';
import type { ConnectionState } from '@/lib/AxuneClient';

/**
 * One line: which project, which branch, is an agent there.
 *
 * A status line rather than a card. This is something you glance at before
 * typing, not the reason you opened the app — so it gets a row, not a headline.
 */
export function StatusRow({
  state,
  project,
  agents,
  onPress,
}: {
  state: ConnectionState;
  project: ProjectSummary | null;
  agents: AgentStatus[];
  onPress: () => void;
}) {
  const connected = state === 'connected' || state === 'reconnecting';
  const online = agents.filter((a) => a.installed).length;

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: dotColor(state) }]} />

      {connected && project ? (
        <>
          <Text style={styles.project} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={styles.separator}>·</Text>
          <Text style={styles.branch} numberOfLines={1}>
            {project.branch}
          </Text>
          {online > 0 ? (
            <>
              <Text style={styles.separator}>·</Text>
              <Text style={styles.agents}>
                {online} agent{online === 1 ? '' : 's'}
              </Text>
            </>
          ) : null}
        </>
      ) : (
        <Text style={styles.disconnected}>
          {state === 'connecting' ? 'Connecting…' : 'Not connected — tap to pair'}
        </Text>
      )}

      <View style={styles.flex} />
      <Ionicons name="chevron-forward" size={14} color={color.textSoft} />
    </Pressable>
  );
}

function dotColor(state: ConnectionState): string {
  if (state === 'connected') return color.ok;
  if (state === 'connecting' || state === 'reconnecting') return color.claude;
  if (state === 'failed') return color.danger;
  return color.textSoft;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: spacing.sm,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  project: { color: color.text, fontSize: 13, fontWeight: '600', maxWidth: 140 },
  branch: { color: color.textMuted, fontSize: 13, maxWidth: 130 },
  agents: { color: color.textMuted, fontSize: 13 },
  separator: { color: color.textSoft, fontSize: 13 },
  disconnected: { color: color.textMuted, fontSize: 13 },
  flex: { flex: 1 },
});
