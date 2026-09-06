import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActiveRun, formatDuration } from '@/components/ui/home/ActiveRun';
import { Alerts, collectAlerts } from '@/components/ui/home/Alerts';
import { ago, RepoStatus } from '@/components/ui/home/RepoStatus';
import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * A dashboard for a machine you are not sitting at.
 *
 * Ordered so that opening Axune for ten seconds is worthwhile even if nothing
 * is typed: what is happening, what state the work is in, what needs
 * attention, what was done. Asking lives in Workspace.
 *
 * Health is quiet here. A green "everything is fine" banner would train the eye
 * to skip the exact place warnings appear, so a healthy project simply reads
 * calm and only trouble is coloured.
 */
export default function HomeScreen() {
  const router = useRouter();
  const {
    connectionState,
    connectionDetail,
    project,
    agents,
    machine,
    capability,
    lastSeenAt,
    live,
    history,
    newConversation,
    stopRun,
  } = useWorkspace();

  const connected = connectionState === 'connected' || connectionState === 'reconnecting';
  const everPaired = Boolean(machine || project || lastSeenAt);
  const git = project?.git;
  const running = live?.status === 'working' ? live : null;
  const lastRun = history[0];

  const alerts = collectAlerts({
    connectionState,
    agents,
    git,
    staleRunMs: running?.lastEventAt ? Date.now() - running.lastEventAt : null,
  });

  // State 1 — never paired. Deliberately not a dashboard of empty cards.
  if (!everPaired) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.onboarding}>
          <Text style={styles.wordmarkLarge}>Axune</Text>
          <Text style={styles.onboardingTitle}>Pair your development machine</Text>
          <Text style={styles.onboardingBody}>
            Run Axune Desktop on your computer and scan the code it shows. Your project and agents
            stay on that machine — this phone only drives them.
          </Text>
          <Pressable style={styles.primary} onPress={() => router.push('/pair')}>
            <Ionicons name="qr-code-outline" size={17} color="#1e1b18" />
            <Text style={styles.primaryText}>Scan QR code</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header: where am I, quietly. */}
        <View style={styles.header}>
          <Text style={styles.wordmark}>Axune</Text>
          <Pressable style={styles.machineRow} onPress={() => router.push('/pair')}>
            <View style={[styles.dot, { backgroundColor: dotColor(connectionState) }]} />
            <Text style={styles.machineName}>{machine?.name ?? 'Desktop'}</Text>
            <Text style={styles.machineState}>
              {connected
                ? connectionState === 'reconnecting'
                  ? 'Reconnecting'
                  : 'Connected'
                : lastSeenAt
                  ? `Offline · last seen ${ago(lastSeenAt)}`
                  : 'Offline'}
            </Text>
          </Pressable>
        </View>

        <Alerts items={alerts} />

        {/* State 3 — a run in progress is the hero. */}
        {running ? (
          <ActiveRun run={running} onOpen={() => router.push('/workspace')} onStop={stopRun} />
        ) : null}

        {/* The project being controlled. */}
        {project ? (
          <View style={styles.projectCard}>
            <View style={styles.projectTop}>
              <Text style={styles.projectName} numberOfLines={1}>
                {project.name}
              </Text>
              <Text style={styles.capability}>{capability === 'read-only' ? 'Read-only' : 'Read + write'}</Text>
            </View>
            <Text style={styles.branch} numberOfLines={1}>
              {project.branch}
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
                    <Text style={[styles.agentName, { color: meta.accentText }]}>{meta.name}</Text>
                    <Text style={styles.agentState}>
                      {agent.installed ? 'Ready' : 'Not installed'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* State 4 — disconnected keeps showing the last known picture. */}
        {git ? <RepoStatus git={git} stale={!connected} /> : null}

        {!running ? (
          <Pressable
            style={styles.primary}
            onPress={() => {
              if (!connected) return router.push('/pair');
              newConversation();
              router.push('/workspace');
            }}
          >
            <Ionicons name={connected ? 'add' : 'refresh'} size={17} color="#1e1b18" />
            <Text style={styles.primaryText}>{connected ? 'New run' : 'Reconnect'}</Text>
          </Pressable>
        ) : null}

        <View style={styles.quickRow}>
          <Quick icon="albums-outline" label="Sessions" onPress={() => router.push('/sessions')} />
          <Quick icon="grid-outline" label="Workspace" onPress={() => router.push('/workspace')} />
          <Quick icon="git-compare-outline" label="Insights" onPress={() => router.push('/insights')} />
        </View>

        {lastRun ? (
          <>
            <Text style={styles.sectionLabel}>Last run</Text>
            <Pressable style={styles.runCard} onPress={() => router.push('/workspace')}>
              <Text style={styles.runPrompt} numberOfLines={2}>
                {lastRun.prompt || 'Untitled run'}
              </Text>
              <View style={styles.runMetaRow}>
                <View style={[styles.dot, { backgroundColor: outcomeColor(lastRun.outcome) }]} />
                <Text style={styles.runMeta}>
                  {lastRun.outcome} · {ago(lastRun.finishedAt)} ·{' '}
                  {formatDuration(lastRun.finishedAt - lastRun.startedAt)}
                </Text>
              </View>
              <Text style={styles.runCounts}>
                {lastRun.filesRead} file{lastRun.filesRead === 1 ? '' : 's'} read ·{' '}
                {lastRun.commands} command{lastRun.commands === 1 ? '' : 's'}
              </Text>
              {lastRun.excerpt ? (
                <Text style={styles.runExcerpt} numberOfLines={2}>
                  {lastRun.excerpt}
                </Text>
              ) : null}
            </Pressable>
          </>
        ) : null}

        {history.length > 1 ? (
          <>
            <Text style={styles.sectionLabel}>Earlier</Text>
            <View style={styles.list}>
              {history.slice(1, 5).map((run) => (
                <Pressable
                  key={run.runId}
                  style={styles.smallRow}
                  onPress={() => router.push('/workspace')}
                >
                  <View style={[styles.dot, { backgroundColor: outcomeColor(run.outcome) }]} />
                  <Text style={styles.smallPrompt} numberOfLines={1}>
                    {run.prompt}
                  </Text>
                  <Text style={styles.smallTime}>{ago(run.finishedAt)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {connectionDetail && !connected ? (
          <Text style={styles.footnote}>{connectionDetail}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Quick({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quick} onPress={onPress}>
      <Ionicons name={icon} size={17} color={color.textMuted} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },

  onboarding: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  wordmarkLarge: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: color.text },
  onboardingTitle: { color: color.text, fontSize: 18, fontWeight: '600' },
  onboardingBody: { color: color.textMuted, fontSize: 14, lineHeight: 21 },

  header: { gap: 4 },
  wordmark: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: color.text },
  machineRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  machineName: { color: color.textMuted, fontSize: 13, fontWeight: '600' },
  machineState: { color: color.textSoft, fontSize: 13 },

  projectCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  projectTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  projectName: { flex: 1, color: color.text, fontSize: 20, fontWeight: '700' },
  capability: {
    color: color.textSoft,
    fontSize: 11,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  branch: { color: color.textMuted, fontSize: 13, marginTop: 3 },
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
  agentState: { color: color.textSoft, fontSize: 11 },

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

  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  quick: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 12,
  },
  quickLabel: { color: color.textMuted, fontSize: 11 },

  sectionLabel: {
    color: color.textSoft,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  runCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.md,
  },
  runPrompt: { color: color.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  runMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  runMeta: { color: color.textMuted, fontSize: 12 },
  runCounts: { color: color.textSoft, fontSize: 12, marginTop: 3 },
  runExcerpt: { color: color.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },

  list: { gap: 6 },
  smallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  smallPrompt: { flex: 1, color: color.textMuted, fontSize: 13 },
  smallTime: { color: color.textSoft, fontSize: 11 },

  footnote: { color: color.textSoft, fontSize: 12, marginTop: spacing.lg, textAlign: 'center' },
});
