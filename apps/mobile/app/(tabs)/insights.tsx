import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Comparison between agents — the point of the product, and not yet possible.
 *
 * This screen deliberately shows nothing invented. Filling it with a mocked
 * comparison would be the most misleading thing in the app: it would claim the
 * differentiating feature works when no second agent exists to disagree with
 * the first.
 */
export default function InsightsScreen() {
  const { agents, history } = useWorkspace();
  const connectedAgents = agents.filter((agent) => agent.installed);
  const enough = connectedAgents.length >= 2;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>
          Where two agents agree, where they differ, and what to do about it.
        </Text>

        {!enough ? (
          <View style={styles.card}>
            <Ionicons name="git-compare-outline" size={22} color={color.textSoft} />
            <Text style={styles.cardTitle}>Needs a second agent</Text>
            <Text style={styles.cardBody}>
              Comparison starts when two agents answer the same prompt independently. Right now only{' '}
              {connectedAgents.length === 1
                ? `${AGENTS.claude.name} is connected`
                : 'no agent is connected'}
              .
            </Text>

            <View style={styles.agentList}>
              <AgentRow name={AGENTS.claude.name} ready={connectedAgents.length > 0} />
              <AgentRow name={AGENTS.codex.name} ready={false} note="not yet supported" />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nothing to compare yet</Text>
            <Text style={styles.cardBody}>
              Send one prompt to both agents from Workspace, and their answers will be compared here.
            </Text>
          </View>
        )}

        {history.length > 0 ? (
          <Text style={styles.footnote}>
            {history.length} run{history.length === 1 ? '' : 's'} so far, all from a single agent.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AgentRow({ name, ready, note }: { name: string; ready: boolean; note?: string }) {
  return (
    <View style={styles.agentRow}>
      <View style={[styles.dot, { backgroundColor: ready ? color.ok : color.textSoft }]} />
      <Text style={styles.agentName}>{name}</Text>
      <Text style={styles.agentNote}>{note ?? (ready ? 'Ready' : 'Not installed')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  content: { padding: spacing.lg },
  title: { color: color.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: color.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  card: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: color.text, fontSize: 16, fontWeight: '600' },
  cardBody: { color: color.textMuted, fontSize: 13, lineHeight: 19 },
  agentList: { marginTop: spacing.sm, gap: spacing.sm },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4 },
  agentName: { color: color.textMuted, fontSize: 13, flex: 1 },
  agentNote: { color: color.textSoft, fontSize: 12 },
  footnote: { color: color.textSoft, fontSize: 12, marginTop: spacing.lg },
});
