import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActiveRun } from '@/components/ui/home/ActiveRun';
import { RecentActivity, SinceLastChecked } from '@/components/ui/home/Activity';
import { Alerts, collectAlerts } from '@/components/ui/home/Alerts';
import { LastRun } from '@/components/ui/home/LastRun';
import { ago, RepoStatus } from '@/components/ui/home/RepoStatus';
import { lookFor } from '@/constants/agents';
import { type Palette, radius, spacing } from '@/constants/theme';
import {
  availableWidgets,
  moveWidget,
  DEFAULT_LAYOUT,
  type WidgetId,
} from '@/lib/homeLayout';
import { nextAdvice } from '@/lib/nextAdvice';
import { useTheme } from '@/lib/ThemeContext';
import { loadHomeLayout, saveHomeLayout } from '@/lib/themeStore';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * The three-second remote check-in: live work, attention, then change.
 *
 * Now arrangeable. The cards are the same ones this screen always rendered -
 * ActiveRun, RepoStatus, LastRun, SinceLastChecked - wrapped in a frame that
 * can be reordered and removed, rather than reimplemented. That is deliberate:
 * every behaviour those components carry survives by construction instead of
 * being re-derived from a design.
 *
 * Two things are not cards and cannot be removed. Alerts interrupt rather than
 * inform, so hiding them would let someone switch off the warning that their
 * agent is missing. And the machine line is how you know whether anything on
 * this screen is still true.
 */
const TITLES: Record<WidgetId, string> = {
  next: 'Next up',
  now: 'Now',
  health: 'Repository',
  recent: 'Last session',
  activity: 'Since you last checked',
  branches: 'Agent branches',
  agents: 'Agents',
};

export default function HomeScreen() {
  const router = useRouter();
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
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
    activity,
    newSinceLastVisit,
    markChecked,
    stopRun,
    branches,
  } = useWorkspace();

  const [layout, setLayout] = useState<WidgetId[]>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadHomeLayout().then((stored) => {
      if (!cancelled) setLayout(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Written on every change rather than on leaving edit mode: there is no
  // "done" that the app is guaranteed to see, and losing an arrangement
  // because someone switched apps would be indistinguishable from it not
  // working.
  const commit = useCallback((next: WidgetId[]) => {
    setLayout(next);
    void saveHomeLayout(next);
  }, []);

  const connected = connectionState === 'connected' || connectionState === 'reconnecting';
  const everPaired = Boolean(machine || project || lastSeenAt);
  const running = live?.status === 'working' ? live : null;
  const git = project?.git;

  const alerts = collectAlerts({
    connectionState,
    agents,
    git,
    staleRunMs: running?.lastEventAt ? Date.now() - running.lastEventAt : null,
  });

  if (!everPaired) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.onboarding}>
          <View style={styles.mark}>
            <Text style={styles.markText}>A</Text>
          </View>
          <Text style={styles.wordmark}>Axune</Text>
          <Text style={styles.onboardingTitle}>Your development machine, within reach.</Text>
          <Text style={styles.onboardingBody}>
            Pair with Axune Desktop to check real work and drive Claude Code from this phone.
          </Text>
          <Pressable style={styles.primary} onPress={() => router.push('/pair')}>
            <Ionicons name="qr-code-outline" size={18} color={color.bg} />
            <Text style={styles.primaryText}>Scan QR code</Text>
          </Pressable>
          <Text style={styles.privacyNote}>Your repository and agent stay on your machine.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const missing = availableWidgets(layout);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topline}>
          <View style={styles.flex}>
            <Text style={styles.kicker}>{greetingFor(new Date())}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {project?.name ?? 'Axune'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={editing ? 'Done arranging' : 'Arrange home'}
            style={styles.iconButton}
            onPress={() => setEditing((on) => !on)}
          >
            <Ionicons
              name={editing ? 'checkmark' : 'options-outline'}
              size={editing ? 22 : 20}
              color={color.text}
            />
          </Pressable>
        </View>

        {/* The machine, and whether what follows is still true. */}
        <Pressable style={styles.machine} onPress={() => router.push('/settings')}>
          <View style={[styles.statusDot, { backgroundColor: connectionColor(connectionState, color) }]} />
          <View style={styles.flex}>
            <Text style={styles.machineName} numberOfLines={1}>
              {machine?.name ?? 'Development machine'}
            </Text>
            <Text style={styles.machineMeta} numberOfLines={1}>
              {connectionLabel(connectionState, lastSeenAt)}
              {project?.branch ? ` · ${project.branch}` : ''}
            </Text>
          </View>
          <View style={styles.permission}>
            <Ionicons
              name={capability === 'read-write' ? 'create-outline' : 'eye-outline'}
              size={12}
              color={color.textSoft}
            />
            <Text style={styles.permissionText}>
              {capability === 'read-write' ? 'Write available' : 'Read-only'}
            </Text>
          </View>
        </Pressable>

        {/* Not a card: an alert you can remove is not an alert. */}
        <Alerts items={alerts} />

        {editing ? (
          <View style={styles.editNotice}>
            <Ionicons name="reorder-three-outline" size={18} color={color.textMuted} />
            <Text style={styles.editText}>Arrange what matters. Remove anything you do not use.</Text>
          </View>
        ) : null}

        {layout.map((id) => (
          <Frame
            key={id}
            id={id}
            title={TITLES[id]}
            editing={editing}
            onMove={(direction) => commit(moveWidget(layout, id, direction))}
            onRemove={() => commit(layout.filter((entry) => entry !== id))}
            styles={styles}
          >
            {id === 'next' ? <NextCard git={git} styles={styles} /> : null}
            {id === 'now' ? (
              running ? (
                <ActiveRun run={running} onOpen={() => router.push('/workspace')} onStop={stopRun} />
              ) : (
                <Pressable style={styles.action} onPress={() => router.push('/workspace')}>
                  <View style={styles.flex}>
                    {/*
                      The agent you would actually be asking, from what the
                      desktop reports installed - not a hardcoded name. With
                      nothing installed this says nothing rather than naming an
                      agent that is not there.
                    */}
                    <Text style={styles.actionEyebrow}>
                      {(() => {
                        const ready = agents.find((agent) => agent.installed);
                        return ready ? lookFor(ready.agentId).name : 'No agent installed';
                      })()}
                    </Text>
                    <Text style={styles.actionTitle}>
                      {connected ? 'Ask about this project' : 'Reconnect to continue'}
                    </Text>
                  </View>
                  <View style={styles.actionArrow}>
                    <Ionicons name="arrow-forward" size={17} color={color.bg} />
                  </View>
                </Pressable>
              )
            ) : null}
            {/* The guard the demo dropped: a project without a snapshot must
                not take the screen down. */}
            {id === 'health' ? (
              git ? (
                <RepoStatus git={git} stale={!connected} />
              ) : (
                <Text style={styles.quiet}>No repository snapshot yet.</Text>
              )
            ) : null}
            {id === 'recent' ? (
              history[0] ? (
                <LastRun run={history[0]} onOpen={() => router.push('/workspace')} />
              ) : (
                <Text style={styles.quiet}>No finished sessions yet.</Text>
              )
            ) : null}
            {/* Dismissed by its own close button and by nothing else - not a
                timer, not leaving the screen. */}
            {id === 'activity' ? (
              <>
                <SinceLastChecked
                  events={activity}
                  count={newSinceLastVisit}
                  lastCheckedAt={lastSeenAt}
                  onDismiss={markChecked}
                />
                {/*
                  The events themselves, not only how many there were.
                  SinceLastChecked reads kinds to produce counts and reads a
                  summary only for branch and dirty/clean; everything else the
                  desktop sends - why a write was downgraded to a read, which
                  tool was denied and on what grounds, what was sent to which
                  agent, a commit's subject, the time anything happened - was
                  arriving and being dropped, because this component existed
                  and was mounted nowhere.
                */}
                <RecentActivity events={activity} />
              </>
            ) : null}
            {id === 'branches' ? (
              branches.length === 0 ? (
                <Text style={styles.quiet}>No branches waiting.</Text>
              ) : (
                branches.slice(0, 4).map((branch) => (
                  <View key={branch.name} style={styles.branchRow}>
                    <Text style={styles.branchName} numberOfLines={1}>
                      {branch.name.replace(/^axune\//, '')}
                    </Text>
                    <Text style={styles.branchMeta}>
                      {[`${branch.files} file${branch.files === 1 ? '' : 's'}`, ago(branch.at)].join(' · ')}
                    </Text>
                  </View>
                ))
              )
            ) : null}
            {id === 'agents' ? (
              agents.length === 0 ? (
                <Text style={styles.quiet}>No agents detected.</Text>
              ) : (
                agents.map((agent) => (
                  <View key={agent.agentId} style={styles.agentRow}>
                    <View
                      style={[
                        styles.agentDot,
                        { backgroundColor: agent.installed ? color.ok : color.textSoft },
                      ]}
                    />
                    <Text style={styles.agentName}>{agent.agentId}</Text>
                    <Text style={styles.agentMeta} numberOfLines={1}>
                      {agent.installed ? (agent.version ?? 'ready') : 'not installed'}
                    </Text>
                  </View>
                ))
              )
            ) : null}
          </Frame>
        ))}

        {missing.length > 0 ? (
          <Pressable style={styles.addRow} onPress={() => setPicker(true)}>
            <Ionicons name="add-circle-outline" size={20} color={color.textMuted} />
            <Text style={styles.addText}>Add to Home</Text>
          </Pressable>
        ) : null}

        {connectionDetail && !connected ? (
          <Text style={styles.detail}>{connectionDetail}</Text>
        ) : null}
      </ScrollView>

      <Modal transparent animationType="slide" visible={picker} onRequestClose={() => setPicker(false)}>
        <Pressable style={styles.scrim} onPress={() => setPicker(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Add to Home</Text>
          <Text style={styles.sheetSubtitle}>Only things Axune can actually tell you.</Text>
          {missing.map((id) => (
            <Pressable
              key={id}
              style={styles.pickRow}
              onPress={() => {
                commit([...layout, id]);
                setPicker(false);
              }}
            >
              <Ionicons name="add" size={20} color={color.text} />
              <Text style={styles.pickTitle}>{TITLES[id]}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Frame({
  id,
  title,
  editing,
  onMove,
  onRemove,
  children,
  styles,
}: {
  id: WidgetId;
  title: string;
  editing: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  return (
    <View style={styles.widget}>
      <View style={styles.widgetHead}>
        <Text style={styles.widgetTitle}>{title.toUpperCase()}</Text>
        {editing ? (
          <View style={styles.editActions}>
            <Pressable onPress={() => onMove(-1)} hitSlop={10} accessibilityLabel={`Move ${title} up`}>
              <Ionicons name="arrow-up" size={17} color={color.textMuted} />
            </Pressable>
            <Pressable onPress={() => onMove(1)} hitSlop={10} accessibilityLabel={`Move ${title} down`}>
              <Ionicons name="arrow-down" size={17} color={color.textMuted} />
            </Pressable>
            <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${title}`}>
              <Ionicons name="close" size={19} color={color.danger} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function NextCard({
  git,
  styles,
}: {
  git: Parameters<typeof nextAdvice>[0];
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  const advice = nextAdvice(git);
  if (!advice) return <Text style={styles.quiet}>Nothing is waiting on you.</Text>;

  return (
    <View style={styles.next}>
      <View style={[styles.alertIcon, { backgroundColor: color[advice.tone] }]}>
        <Ionicons name={advice.icon as never} size={18} color={color.panel} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.nextTitle}>{advice.title}</Text>
        <Text style={styles.nextBody}>{advice.body}</Text>
      </View>
    </View>
  );
}

/** Derived rather than asserted, so it is not wrong before lunch. */
function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

function connectionColor(state: string, color: Palette): string {
  if (state === 'connected') return color.ok;
  if (state === 'connecting' || state === 'reconnecting') return color.claude;
  if (state === 'failed') return color.danger;
  return color.textSoft;
}

/** Every state the transport actually has, not just connected and not. */
function connectionLabel(state: string, lastSeenAt: number | null): string {
  if (state === 'connected') return 'Connected';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'connecting') return 'Connecting';
  if (state === 'failed') return 'Could not reach it';
  return lastSeenAt ? `Last seen ${ago(lastSeenAt)}` : 'Not connected';
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.md },
    flex: { flex: 1 },

    onboarding: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    mark: {
      width: 46,
      height: 46,
      borderRadius: 16,
      backgroundColor: color.claude,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    markText: { color: color.bg, fontSize: 23, fontWeight: '800', letterSpacing: -1 },
    wordmark: { color: color.text, fontSize: 34, fontWeight: '800', letterSpacing: -1.5 },
    onboardingTitle: {
      color: color.text,
      fontSize: 26,
      lineHeight: 32,
      fontWeight: '700',
      letterSpacing: -0.8,
      maxWidth: 320,
    },
    onboardingBody: { color: color.textMuted, fontSize: 15, lineHeight: 23, maxWidth: 335 },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      backgroundColor: color.claude,
      borderRadius: radius.md,
      paddingVertical: 15,
      marginTop: spacing.md,
    },
    primaryText: { color: color.bg, fontSize: 15, fontWeight: '700' },
    privacyNote: { color: color.textSoft, fontSize: 12, marginTop: spacing.xs },

    topline: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: color.text, fontSize: 31, letterSpacing: -1, fontWeight: '600', marginTop: 6 },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
      alignItems: 'center',
      justifyContent: 'center',
    },

    machine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.xl,
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
    },
    statusDot: { width: 9, height: 9, borderRadius: 5 },
    machineName: { color: color.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
    machineMeta: { color: color.textSoft, fontSize: 12, marginTop: 2 },
    permission: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    permissionText: { color: color.textSoft, fontSize: 11 },

    editNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    editText: { color: color.textMuted, fontSize: 13, flex: 1 },

    widget: {
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
      borderRadius: radius.xl,
      padding: spacing.md,
      gap: 12,
    },
    widgetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    widgetTitle: {
      color: color.textMuted,
      fontSize: 11.5,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    editActions: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    quiet: { color: color.textSoft, fontSize: 13.5, lineHeight: 19 },

    next: { flexDirection: 'row', gap: 11, alignItems: 'center' },
    alertIcon: { height: 35, width: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    nextTitle: { color: color.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
    nextBody: { color: color.textMuted, fontSize: 13, marginTop: 3 },

    action: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    actionEyebrow: {
      color: color.claudeText,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.45,
      textTransform: 'uppercase',
    },
    actionTitle: {
      color: color.text,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: -0.35,
      marginTop: 5,
    },
    actionArrow: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: color.claude,
      alignItems: 'center',
      justifyContent: 'center',
    },

    branchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    branchName: { color: color.text, fontSize: 14, fontWeight: '600', flex: 1 },
    branchMeta: { color: color.textSoft, fontSize: 12 },
    agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    agentDot: { width: 7, height: 7, borderRadius: 4 },
    agentName: { color: color.text, fontSize: 14, flex: 1 },
    agentMeta: { color: color.textSoft, fontSize: 12, maxWidth: '50%' },

    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: 15,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
    },
    addText: { color: color.textMuted, fontSize: 14, fontWeight: '600' },
    detail: { color: color.textSoft, fontSize: 12, lineHeight: 18, textAlign: 'center' },

    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: color.panel,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.lg,
      paddingBottom: spacing.xl * 2,
      gap: spacing.xs,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.lineStrong,
      marginBottom: spacing.sm,
    },
    sheetTitle: { color: color.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
    sheetSubtitle: { color: color.textMuted, fontSize: 13, marginBottom: spacing.sm },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14 },
    pickTitle: { color: color.text, fontSize: 16, flex: 1 },
  });
