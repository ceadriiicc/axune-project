import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/components/ui/home/ActiveRun';
import { ago } from '@/components/ui/home/RepoStatus';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Every run this device has seen, plus the few settings that are real.
 *
 * The mockup's toggles — sync prompts, save sessions, theme — are deliberately
 * absent: a switch that controls nothing is worse than no switch, because it
 * teaches people the app lies about what it can do.
 */
export default function SessionsScreen() {
  const router = useRouter();
  const { history, machine, project, capability, connectionState, agents, disconnect } =
    useWorkspace();

  const connected = connectionState === 'connected' || connectionState === 'reconnecting';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Sessions</Text>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No runs yet</Text>
            <Text style={styles.emptyBody}>
              Runs you start appear here with what the agent read and how long it took.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {history.map((run) => (
              <Pressable
                key={run.runId}
                style={styles.row}
                onPress={() => router.push('/workspace')}
              >
                <View style={styles.rowTop}>
                  <View style={[styles.dot, { backgroundColor: outcomeColor(run.outcome) }]} />
                  <Text style={styles.rowPrompt} numberOfLines={2}>
                    {run.prompt || 'Untitled run'}
                  </Text>
                </View>
                <Text style={styles.rowMeta}>
                  {run.outcome} · {ago(run.finishedAt)} ·{' '}
                  {formatDuration(run.finishedAt - run.startedAt)} · {run.filesRead} read ·{' '}
                  {run.commands} command{run.commands === 1 ? '' : 's'}
                </Text>
                {run.excerpt ? (
                  <Text style={styles.rowExcerpt} numberOfLines={2}>
                    {run.excerpt}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.sectionLabel}>Connection</Text>
        <View style={styles.card}>
          <Detail label="Machine" value={machine?.name ?? 'Not paired'} />
          <Detail label="Project" value={project?.name ?? '—'} />
          <Detail label="Branch" value={project?.branch ?? '—'} />
          <Detail label="Permission" value={capability === 'read-only' ? 'Read-only' : 'Read + write'} />
          <Detail
            label="Transport"
            value={machine ? `${machine.connection} network` : '—'}
          />
        </View>

        <Text style={styles.sectionLabel}>Agents</Text>
        <View style={styles.card}>
          {agents.length === 0 ? (
            <Text style={styles.muted}>Not connected.</Text>
          ) : (
            agents.map((agent) => (
              <Detail
                key={agent.agentId}
                label={agent.agentId}
                value={
                  agent.installed
                    ? `Ready${agent.version ? ` · ${agent.version.replace(/\s*\(.*\)$/, '')}` : ''}`
                    : 'Not installed'
                }
              />
            ))
          )}
        </View>

        <Pressable style={styles.danger} onPress={connected ? disconnect : () => router.push('/pair')}>
          <Ionicons
            name={connected ? 'unlink-outline' : 'qr-code-outline'}
            size={16}
            color={connected ? color.danger : color.claude}
          />
          <Text style={[styles.dangerText, !connected && { color: color.claude }]}>
            {connected ? 'Unpair this phone' : 'Pair a machine'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function outcomeColor(outcome: string): string {
  if (outcome === 'completed') return color.ok;
  if (outcome === 'stopped') return color.textSoft;
  return color.danger;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { color: color.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },

  empty: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: spacing.lg,
    gap: 6,
  },
  emptyTitle: { color: color.text, fontSize: 15, fontWeight: '600' },
  emptyBody: { color: color.textMuted, fontSize: 13, lineHeight: 19 },

  list: { gap: spacing.sm, marginTop: spacing.lg },
  row: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  rowPrompt: { flex: 1, color: color.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  rowMeta: { color: color.textSoft, fontSize: 11.5, marginTop: 6 },
  rowExcerpt: { color: color.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },

  sectionLabel: {
    color: color.textSoft,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 10,
  },
  detailLabel: { color: color.textSoft, fontSize: 13 },
  detailValue: { color: color.textMuted, fontSize: 13, flexShrink: 1 },
  muted: { color: color.textSoft, fontSize: 13, paddingVertical: 10 },

  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 13,
  },
  dangerText: { color: color.danger, fontSize: 14, fontWeight: '600' },
});
