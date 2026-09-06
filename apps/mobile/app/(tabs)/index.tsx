import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Home answers "what am I connected to, and what has happened".
 *
 * Asking lives in Workspace, next to the conversation it belongs to. A prompt
 * box here would sit with no context around it, and would be useless whenever
 * the phone is not paired — which is exactly when Home is most needed.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { connectionState, connectionDetail, project, agents, history, newConversation } =
    useWorkspace();

  const connected = connectionState === 'connected' || connectionState === 'reconnecting';

  const startRun = () => {
    if (!connected) return router.push('/pair');
    newConversation();
    router.push('/workspace');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.wordmark}>Axune</Text>

        {/* The anchor of this screen: which machine, which project, who is available. */}
        <Pressable style={styles.status} onPress={() => router.push('/pair')}>
          <View style={styles.statusTop}>
            <View style={[styles.dot, { backgroundColor: dotColor(connectionState) }]} />
            <Text style={styles.statusLabel}>
              {connected ? 'Connected' : connectionState === 'connecting' ? 'Connecting' : 'Not connected'}
            </Text>
            <View style={styles.flex} />
            <Ionicons name="chevron-forward" size={15} color={color.textSoft} />
          </View>

          {connected && project ? (
            <>
              <Text style={styles.project} numberOfLines={1}>
                {project.name}
              </Text>
              <Text style={styles.branch} numberOfLines={1}>
                {project.branch}
                {project.isGitRepo ? '' : ' · not a git repo'}
              </Text>

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
                      <Text style={[styles.agentName, { color: meta.accentText }]}>
                        {meta.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.hint}>
              {connectionDetail ?? 'Tap to scan the code shown by Axune Desktop.'}
            </Text>
          )}
        </Pressable>

        <Pressable style={styles.primary} onPress={startRun}>
          <Ionicons
            name={connected ? 'add' : 'qr-code-outline'}
            size={17}
            color="#1e1b18"
          />
          <Text style={styles.primaryText}>{connected ? 'New run' : 'Pair this phone'}</Text>
        </Pressable>

        {history.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Recent runs</Text>
            <View style={styles.list}>
              {history.map((run) => (
                <Pressable
                  key={run.runId}
                  style={styles.runRow}
                  onPress={() => router.push('/workspace')}
                >
                  <View
                    style={[styles.outcomeDot, { backgroundColor: outcomeColor(run.outcome) }]}
                  />
                  <View style={styles.flex}>
                    <Text style={styles.runPrompt} numberOfLines={2}>
                      {run.prompt || 'Untitled run'}
                    </Text>
                    {run.excerpt ? (
                      <Text style={styles.runExcerpt} numberOfLines={1}>
                        {run.excerpt}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.runTime}>{relativeTime(run.startedAt)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function dotColor(state: string): string {
  if (state === 'connected') return color.ok;
  if (state === 'connecting' || state === 'reconnecting') return color.claude;
  if (state === 'failed') return color.danger;
  return color.textSoft;
}

function outcomeColor(outcome: string): string {
  if (outcome === 'completed') return color.ok;
  if (outcome === 'stopped') return color.textSoft;
  return color.danger;
}

function relativeTime(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  wordmark: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: color.text,
    marginBottom: spacing.lg,
  },
  status: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.md,
  },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel: { color: color.textMuted, fontSize: 12, letterSpacing: 0.2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  flex: { flex: 1 },
  project: { color: color.text, fontSize: 20, fontWeight: '700', marginTop: spacing.sm },
  branch: { color: color.textMuted, fontSize: 13, marginTop: 3 },
  hint: { color: color.textMuted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  agentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
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
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.claude,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  primaryText: { color: '#1e1b18', fontSize: 15, fontWeight: '700' },
  sectionLabel: {
    color: color.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  list: { gap: spacing.sm },
  runRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  outcomeDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  runPrompt: { color: color.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  runExcerpt: { color: color.textMuted, fontSize: 12, marginTop: 4 },
  runTime: { color: color.textSoft, fontSize: 11, marginTop: 3 },
});
