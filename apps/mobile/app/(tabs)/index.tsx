import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActiveRun } from '@/components/ui/home/ActiveRun';
import { SinceLastChecked } from '@/components/ui/home/Activity';
import { Alerts, collectAlerts } from '@/components/ui/home/Alerts';
import { ago, RepoStatus } from '@/components/ui/home/RepoStatus';
import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/** The three-second remote check-in: live work, attention, then change. */
export default function HomeScreen() {
  const router = useRouter();
  const { connectionState, connectionDetail, project, agents, machine, capability, lastSeenAt, live, activity, newSinceLastVisit, markChecked, stopRun } = useWorkspace();
  const connected = connectionState === 'connected' || connectionState === 'reconnecting';
  const everPaired = Boolean(machine || project || lastSeenAt);
  const running = live?.status === 'working' ? live : null;
  const git = project?.git;
  const repositoryNeedsSpace = Boolean(git && (git.dirtyFiles || git.untrackedFiles || git.conflicts || git.inProgress || git.detachedHead || git.ahead || git.behind));
  useEffect(() => { if (newSinceLastVisit <= 0) return; const timer = setTimeout(markChecked, 6000); return () => clearTimeout(timer); }, [newSinceLastVisit, markChecked]);
  const alerts = collectAlerts({ connectionState, agents, git, staleRunMs: running?.lastEventAt ? Date.now() - running.lastEventAt : null });

  if (!everPaired) return <SafeAreaView style={styles.safe}><View style={styles.onboarding}>
    <View style={styles.mark}><Text style={styles.markText}>A</Text></View>
    <Text style={styles.wordmark}>Axune</Text>
    <Text style={styles.onboardingTitle}>Your development machine, within reach.</Text>
    <Text style={styles.onboardingBody}>Pair with Axune Desktop to check real work and drive Claude Code from this phone.</Text>
    <Pressable style={styles.primary} onPress={() => router.push('/pair')}><Ionicons name="qr-code-outline" size={18} color="#1e1b18" /><Text style={styles.primaryText}>Scan QR code</Text></Pressable>
    <Text style={styles.privacyNote}>Your repository and agent stay on your machine.</Text>
  </View></SafeAreaView>;

  const claude = agents.find((agent) => agent.agentId === 'claude-code');
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Pressable style={styles.identity} onPress={() => router.push('/pair')}>
      <View style={[styles.statusDot, { backgroundColor: connectionColor(connectionState) }]} />
      <View style={styles.identityCopy}><Text style={styles.machineName} numberOfLines={1}>{machine?.name ?? 'Development machine'}</Text><Text style={styles.machineMeta} numberOfLines={1}>{connected ? connectionState === 'reconnecting' ? 'Reconnecting' : 'Connected' : lastSeenAt ? `Last seen ${ago(lastSeenAt)}` : 'Not connected'}{machine?.connection ? ` · ${machine.connection}` : ''}</Text></View>
      <Ionicons name="chevron-forward" size={16} color={color.textSoft} />
    </Pressable>
    {project ? <View style={styles.projectLine}><View style={styles.projectCopy}><Text style={styles.projectName} numberOfLines={1}>{project.name}</Text><Text style={styles.branch} numberOfLines={1}>{project.branch}</Text></View><View style={styles.permission}><Ionicons name={capability === 'read-write' ? 'create-outline' : 'eye-outline'} size={12} color={color.textSoft} /><Text style={styles.permissionText}>{capability === 'read-write' ? 'Write available' : 'Read-only'}</Text></View></View> : null}
    {running ? <ActiveRun run={running} onOpen={() => router.push('/workspace')} onStop={stopRun} /> : <Pressable style={styles.workspaceAction} onPress={() => router.push('/workspace')}><View><Text style={styles.actionEyebrow}>Claude Code</Text><Text style={styles.actionTitle}>{connected ? 'Ask about this project' : 'Reconnect to continue'}</Text></View><View style={styles.actionArrow}><Ionicons name="arrow-forward" size={17} color="#1e1b18" /></View></Pressable>}
    <Alerts items={alerts} />
    <SinceLastChecked events={activity} count={newSinceLastVisit} lastCheckedAt={lastSeenAt} />
    {repositoryNeedsSpace && git ? <RepoStatus git={git} stale={!connected} /> : null}
    {connectionDetail && !connected ? <Text style={styles.detail}>{connectionDetail}</Text> : null}
    {claude?.installed ? <Text style={styles.agentQuiet}>{AGENTS.claude.name} ready</Text> : null}
  </ScrollView></SafeAreaView>;
}

function connectionColor(state: string): string { if (state === 'connected') return color.ok; if (state === 'connecting' || state === 'reconnecting') return color.claude; if (state === 'failed') return color.danger; return color.textSoft; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg }, content: { padding: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.md },
  onboarding: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }, mark: { width: 46, height: 46, borderRadius: 16, backgroundColor: color.claude, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }, markText: { color: '#1e1b18', fontSize: 23, fontWeight: '800', letterSpacing: -1 }, wordmark: { color: color.text, fontSize: 34, fontWeight: '800', letterSpacing: -1.5 }, onboardingTitle: { color: color.text, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.8, maxWidth: 320 }, onboardingBody: { color: color.textMuted, fontSize: 15, lineHeight: 23, maxWidth: 335 }, primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: color.claude, borderRadius: radius.md, paddingVertical: 15, marginTop: spacing.md }, primaryText: { color: '#1e1b18', fontSize: 15, fontWeight: '700' }, privacyNote: { color: color.textSoft, fontSize: 12, marginTop: spacing.xs },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs }, statusDot: { width: 9, height: 9, borderRadius: 5 }, identityCopy: { flex: 1 }, machineName: { color: color.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 }, machineMeta: { color: color.textSoft, fontSize: 12, marginTop: 2 }, projectLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: color.line }, projectCopy: { flex: 1, paddingRight: spacing.sm }, projectName: { color: color.text, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.9 }, branch: { color: color.textMuted, fontSize: 13, marginTop: 3 }, permission: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingBottom: 3 }, permissionText: { color: color.textSoft, fontSize: 11 },
  workspaceAction: { minHeight: 104, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.xl, backgroundColor: color.panel, borderWidth: 1, borderColor: 'rgba(216,173,123,0.24)' }, actionEyebrow: { color: color.claudeText, fontSize: 11, fontWeight: '700', letterSpacing: 0.45, textTransform: 'uppercase' }, actionTitle: { color: color.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.35, marginTop: 5 }, actionArrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: color.claude, alignItems: 'center', justifyContent: 'center' }, detail: { color: color.textSoft, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: spacing.sm }, agentQuiet: { color: color.textSoft, fontSize: 11, textAlign: 'center', marginTop: spacing.lg },
});
