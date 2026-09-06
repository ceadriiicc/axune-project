import { Ionicons } from '@expo/vector-icons';
import type { AgentStatus, ProjectSummary } from '@axune/protocol';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import type { ConnectionState } from '@/lib/AxuneClient';

/**
 * The first thing worth knowing: which machine is this pointed at, which
 * project, and is an agent actually available.
 *
 * Deliberately shows the branch. Sending "what changed here?" to the wrong
 * branch wastes a run and, once writes exist, would be worse than wasteful.
 */
export function ConnectionCard({
  state,
  detail,
  project,
  agents,
  onPair,
}: {
  state: ConnectionState;
  detail: string | null;
  project: ProjectSummary | null;
  agents: AgentStatus[];
  onPair: () => void;
}) {
  if (state === 'idle' || (state === 'failed' && !project)) {
    return (
      <Pressable style={[styles.card, styles.empty]} onPress={onPair}>
        <View style={styles.emptyRow}>
          <Ionicons name="qr-code-outline" size={20} color={color.claude} />
          <View style={styles.flex}>
            <Text style={styles.emptyTitle}>Not connected</Text>
            <Text style={styles.emptyBody}>
              {detail ?? 'Scan the code shown by Axune Desktop to pair this phone.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={color.textSoft} />
        </View>
      </Pressable>
    );
  }

  const connecting = state === 'connecting' || state === 'reconnecting';

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.flex}>
          <Text style={styles.project} numberOfLines={1}>
            {project?.name ?? 'Connecting…'}
          </Text>
          {project ? (
            <Text style={styles.branch} numberOfLines={1}>
              {project.branch}
              {project.isGitRepo ? '' : ' · not a git repo'}
            </Text>
          ) : null}
        </View>
        <View style={styles.statePill}>
          <View
            style={[
              styles.dot,
              { backgroundColor: connecting ? color.claude : color.ok },
            ]}
          />
          <Text style={styles.stateText}>{connecting ? state : 'connected'}</Text>
        </View>
      </View>

      {agents.length > 0 ? (
        <View style={styles.agentRow}>
          {agents.map((agent) => {
            const meta = AGENTS[agent.agentId === 'claude-code' ? 'claude' : 'codex'];
            return (
              <View key={agent.agentId} style={styles.agentChip}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: agent.installed ? color.ok : color.danger },
                  ]}
                />
                <Text style={[styles.agentName, { color: meta.accentText }]}>{meta.name}</Text>
                {agent.version ? (
                  <Text style={styles.agentVersion} numberOfLines={1}>
                    {agent.version.replace(/\s*\(.*\)$/, '')}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  empty: { borderColor: 'rgba(216,173,123,0.25)' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emptyTitle: { color: color.text, fontSize: 15, fontWeight: '600' },
  emptyBody: { color: color.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  flex: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  project: { color: color.text, fontSize: 17, fontWeight: '700' },
  branch: { color: color.textMuted, fontSize: 13, marginTop: 2 },
  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  stateText: { color: color.textMuted, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  agentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  agentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  agentName: { fontSize: 12, fontWeight: '600' },
  agentVersion: { color: color.textSoft, fontSize: 11 },
  detail: { color: color.textSoft, fontSize: 12 },
});
