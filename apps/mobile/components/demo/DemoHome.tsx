import { Ionicons } from '@expo/vector-icons';
import type { ActivityEvent, AgentBranch, AgentStatus, ProjectSummary } from '@axune/protocol';
import type { LiveRun, RunSummary } from '@/lib/WorkspaceContext';
import { useDemoTheme as useTheme } from './DemoAppearance';
import { useDemoScenario } from './DemoScenario';
import { DemoTabBar } from './DemoTabBar';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

type WidgetId = 'next' | 'now' | 'health' | 'recent' | 'activity' | 'branches' | 'agents';

interface Props {
  project: ProjectSummary;
  agents: AgentStatus[];
  live: LiveRun;
  history: RunSummary[];
  activity: ActivityEvent[];
  branches: AgentBranch[];
}

const titles: Record<WidgetId, string> = {
  next: 'Next up',
  now: 'Now',
  health: 'Repository health',
  recent: 'Last session',
  activity: 'Recent activity',
  branches: 'Agent branches',
  agents: 'Agent',
};

export function DemoHome({ project, agents, live, history, activity, branches }: Props) {
  const { palette: color } = useTheme();
  const { state } = useDemoScenario();
  const router = useRouter();
  const [widgets, setWidgets] = useState<WidgetId[]>(['next', 'now', 'health', 'recent']);
  const [runStopped, setRunStopped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(color, insets), [color, insets]);
  const missing = (Object.keys(titles) as WidgetId[]).filter((id) => !widgets.includes(id));

  const move = (id: WidgetId, direction: -1 | 1) => {
    setWidgets((current) => {
      const index = current.indexOf(id);
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  };

  const remove = (id: WidgetId) =>
    setWidgets((current) => current.filter((widget) => widget !== id));
  const add = (id: WidgetId) => {
    setWidgets((current) => [...current, id]);
    setPickerOpen(false);
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topline}>
          <View>
            <Text style={styles.kicker}>YOUR WORKSPACE</Text>
            <Text style={styles.title}>Good afternoon.</Text>
          </View>
          <Pressable
            accessibilityLabel="Customize home"
            onPress={() => (editing ? setEditing(false) : setPickerOpen(true))}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name={editing ? 'checkmark' : 'add'} size={23} color={color.text} />
          </Pressable>
        </View>

        <View style={styles.workspace}>
          <View style={[styles.workspaceMark, { backgroundColor: color.claudeIconBg }]}>
            <Ionicons name="laptop-outline" size={20} color={color.claudeIconText} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.workspaceName}>{project.name}</Text>
            <Text style={styles.workspaceMeta}>{project.branch}</Text>
          </View>
          <View style={styles.connected}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    state === 'offline'
                      ? color.danger
                      : state === 'reconnecting'
                        ? color.claudeStrong
                        : color.ok,
                },
              ]}
            />
            <Text style={styles.connectedText}>
              {state === 'offline' ? 'Offline' : state === 'reconnecting' ? 'Reconnecting' : 'Connected'}
            </Text>
          </View>
        </View>

        {state === 'reconnecting' && <ConnectionNotice styles={styles} color={color} reconnecting />}
        {state === 'offline' && <ConnectionNotice styles={styles} color={color} />}

        {editing && (
          <View style={styles.editNotice}>
            <Ionicons name="reorder-three-outline" size={19} color={color.textMuted} />
            <Text style={styles.editText}>
              Arrange what matters. Remove anything you do not use.
            </Text>
          </View>
        )}

        {state === 'empty' ? (
          <View style={styles.emptyWorkspace}>
            <View style={[styles.emptyIcon, { backgroundColor: color.panelAlt }]}>
              <Ionicons name="sparkles-outline" size={24} color={color.claudeStrong} />
            </View>
            <Text style={styles.emptyTitle}>A calm starting point.</Text>
            <Text style={styles.emptyCopy}>
              There is no activity to show yet. Start a session when you have something to investigate.
            </Text>
            <Pressable style={[styles.emptyAction, { backgroundColor: color.text }]}>
              <Text style={[styles.emptyActionText, { color: color.panel }]}>Start a session</Text>
            </Pressable>
          </View>
        ) : widgets.map((id) => (
          <WidgetFrame
            key={id}
            title={titles[id]}
            editing={editing}
            onRemove={() => remove(id)}
            onMove={move}
            id={id}
            styles={styles}
          >
            {id === 'next' && <NextWidget styles={styles} color={color} />}
            {id === 'now' && (
              <NowWidget
                styles={styles}
                color={color}
                live={live}
                onOpen={() => router.push('/demo/sessions')}
                onStop={() => setRunStopped(true)}
                stopped={runStopped}
              />
            )}
            {id === 'health' && <HealthWidget styles={styles} color={color} project={project} />}
            {id === 'recent' && <RecentWidget styles={styles} color={color} run={history[0]} />}
            {id === 'activity' && (
              <ActivityWidget styles={styles} color={color} activity={activity} />
            )}
            {id === 'branches' && (
              <BranchesWidget styles={styles} color={color} branches={branches} />
            )}
            {id === 'agents' && <AgentsWidget styles={styles} color={color} agents={agents} />}
          </WidgetFrame>
        ))}

        <Pressable
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
        >
          <Ionicons name="add-circle-outline" size={20} color={color.textMuted} />
          <Text style={styles.addText}>Add to Home</Text>
        </Pressable>
      </ScrollView>

      <Modal
        transparent
        animationType="slide"
        visible={pickerOpen}
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.scrim} onPress={() => setPickerOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Add to Home</Text>
          <Text style={styles.sheetSubtitle}>Only things Axune can actually tell you.</Text>
          {missing.length === 0 ? (
            <Text style={styles.empty}>Everything available is already on your Home.</Text>
          ) : (
            missing.map((id) => (
              <Pressable
                key={id}
                onPress={() => add(id)}
                style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
              >
                <View style={styles.pickIcon}>
                  <Ionicons name="add" size={20} color={color.text} />
                </View>
                <Text style={styles.pickTitle}>{titles[id]}</Text>
                <Ionicons name="chevron-forward" size={17} color={color.textSoft} />
              </Pressable>
            ))
          )}
        </View>
      </Modal>
      {!pickerOpen && <DemoTabBar />}
    </View>
  );
}

function ConnectionNotice({
  styles,
  color,
  reconnecting = false,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  reconnecting?: boolean;
}) {
  const accent = reconnecting ? color.claudeStrong : color.danger;
  return (
    <View style={[styles.connectionNotice, { borderColor: accent }]}>
      <Ionicons name={reconnecting ? 'sync-outline' : 'cloud-offline-outline'} size={19} color={accent} />
      <View style={styles.flex}>
        <Text style={styles.connectionTitle}>
          {reconnecting ? 'Reconnecting to your desktop' : 'Your desktop is unavailable'}
        </Text>
        <Text style={styles.connectionCopy}>
          {reconnecting
            ? 'Runs are safe. Axune will resume the activity stream.'
            : 'Reconnect to see live work and start a session.'}
        </Text>
      </View>
    </View>
  );
}

function WidgetFrame({
  children,
  title,
  editing,
  onRemove,
  onMove,
  id,
  styles,
}: {
  children: React.ReactNode;
  title: string;
  editing: boolean;
  onRemove: () => void;
  onMove: (id: WidgetId, direction: -1 | 1) => void;
  id: WidgetId;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  return (
    <View style={styles.widget}>
      <View style={styles.widgetHead}>
        <Text style={styles.widgetTitle}>{title}</Text>
        {editing && (
          <View style={styles.editActions}>
            <Pressable onPress={() => onMove(id, -1)}>
              <Ionicons name="arrow-up" size={16} color={color.textMuted} />
            </Pressable>
            <Pressable onPress={() => onMove(id, 1)}>
              <Ionicons name="arrow-down" size={16} color={color.textMuted} />
            </Pressable>
            <Pressable onPress={onRemove}>
              <Ionicons name="close" size={18} color={color.danger} />
            </Pressable>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

function NextWidget({
  styles,
  color,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
}) {
  return (
    <View style={styles.next}>
      <View style={[styles.alertIcon, { backgroundColor: color.danger }]}>
        <Ionicons name="git-merge-outline" size={18} color={color.panel} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.nextTitle}>Finish the rebase before your next write run.</Text>
        <Text style={styles.nextBody}>2 conflicts are waiting in this repository.</Text>
      </View>
      <Ionicons name="arrow-forward" size={19} color={color.textMuted} />
    </View>
  );
}
function NowWidget({
  styles,
  color,
  live,
  onOpen,
  onStop,
  stopped,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  live: LiveRun;
  onOpen: () => void;
  onStop: () => void;
  stopped: boolean;
}) {
  return (
    <View>
      <View style={styles.nowMeta}>
        <View style={styles.agentLine}>
          <View style={[styles.avatar, { backgroundColor: color.claudeIconBg }]}>
            <Text style={[styles.avatarText, { color: color.claudeIconText }]}>C</Text>
          </View>
          <Text style={styles.agentName}>{stopped ? 'Claude stopped' : 'Claude is working'}</Text>
        </View>
        <Text style={styles.elapsed}>8m</Text>
      </View>
      <Text style={styles.nowPrompt}>{live.prompt}</Text>
      <View style={styles.liveActivity}>
        <View style={[styles.pulse, { backgroundColor: stopped ? color.textSoft : color.claudeStrong }]} />
        <Text style={styles.liveText}>{stopped ? 'Run stopped in this demo' : 'Searching session screens'}</Text>
      </View>
      <View style={styles.actionRow}>
        <Pressable onPress={onOpen} style={[styles.primaryAction, { backgroundColor: color.text }]}>
          <Text style={[styles.primaryLabel, { color: color.panel }]}>Open session</Text>
        </Pressable>
        {!stopped && <Pressable
          onPress={() =>
            Alert.alert('Stop this run?', 'Claude will stop after its current tool completes.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Stop run', style: 'destructive', onPress: onStop },
            ])
          }
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryLabel}>Stop run</Text>
        </Pressable>}
      </View>
    </View>
  );
}
function HealthWidget({
  styles,
  color,
  project,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  project: ProjectSummary;
}) {
  const git = project.git!;
  return (
    <View style={styles.health}>
      <View>
        <Text style={styles.healthNumber}>{git.dirtyFiles + git.untrackedFiles}</Text>
        <Text style={styles.healthLabel}>files changed</Text>
      </View>
      <View style={styles.healthRule} />
      <View>
        <Text style={[styles.healthNumber, { color: color.danger }]}>{git.conflicts}</Text>
        <Text style={styles.healthLabel}>conflicts</Text>
      </View>
      <View style={styles.healthRule} />
      <View>
        <Text style={styles.healthNumber}>+{git.ahead ?? 0}</Text>
        <Text style={styles.healthLabel}>ahead</Text>
      </View>
    </View>
  );
}
function RecentWidget({
  styles,
  color,
  run,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  run?: RunSummary;
}) {
  if (!run) return <Text style={styles.empty}>No finished sessions yet.</Text>;
  return (
    <View>
      <Text style={styles.recentPrompt}>{run.prompt}</Text>
      <View style={styles.recentMeta}>
        <Text style={styles.recentDetail}>{run.filesRead} files read</Text>
        <Text style={styles.recentDetail}>{run.commands} commands</Text>
        <Text style={[styles.done, { color: color.ok }]}>Completed</Text>
      </View>
    </View>
  );
}
function ActivityWidget({
  styles,
  color,
  activity,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  activity: ActivityEvent[];
}) {
  return (
    <View>
      {activity.map((event) => (
        <View key={event.id} style={styles.timeline}>
          <View
            style={[
              styles.timelineDot,
              { backgroundColor: event.kind === 'git.commit' ? color.info : color.claudeStrong },
            ]}
          />
          <View>
            <Text style={styles.timelineSummary}>{event.summary}</Text>
            <Text style={styles.timelineDetail}>{event.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
function BranchesWidget({
  styles,
  branches,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  branches: AgentBranch[];
}) {
  const branch = branches[0];
  return branch ? (
    <View>
      <Text style={styles.branchName}>{branch.name}</Text>
      <Text style={styles.timelineDetail}>
        {branch.subject} · {branch.files} files
      </Text>
    </View>
  ) : (
    <Text style={styles.empty}>No agent branches to review.</Text>
  );
}
function AgentsWidget({
  styles,
  color,
  agents,
}: {
  styles: ReturnType<typeof makeStyles>;
  color: ReturnType<typeof useTheme>['palette'];
  agents: AgentStatus[];
}) {
  const agent = agents[0];
  return agent ? (
    <View style={styles.agentWidget}>
      <View style={[styles.avatar, { backgroundColor: color.claudeIconBg }]}>
        <Text style={[styles.avatarText, { color: color.claudeIconText }]}>C</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.agentName}>Claude Code</Text>
        <Text style={styles.timelineDetail}>
          {agent.version ? `Version ${agent.version}` : 'Version unavailable'}
        </Text>
      </View>
      <Text style={[styles.done, { color: color.ok }]}>
        {agent.installed ? 'Available' : 'Not installed'}
      </Text>
    </View>
  ) : (
    <Text style={styles.empty}>No agent status available.</Text>
  );
}

const makeStyles = (color: ReturnType<typeof useTheme>['palette'], insets: EdgeInsets) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    content: {
      padding: 22,
      paddingTop: Math.max(68, insets.top + 20),
      paddingBottom: 110 + insets.bottom,
      gap: 14,
    },
    topline: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 6,
    },
    kicker: { color: color.textSoft, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
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
    pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
    workspace: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 18,
      backgroundColor: color.panelAlt,
      gap: 11,
    },
    workspaceMark: {
      height: 40,
      width: 40,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flex: { flex: 1 },
    workspaceName: { color: color.text, fontSize: 16, fontWeight: '700' },
    workspaceMeta: { color: color.textMuted, marginTop: 2, fontSize: 12 },
    connected: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    connectedText: { color: color.textMuted, fontSize: 12 },
    connectionNotice: { flexDirection: 'row', gap: 10, borderWidth: 1, borderRadius: 15, padding: 13 },
    connectionTitle: { color: color.text, fontSize: 14, fontWeight: '700' },
    connectionCopy: { color: color.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
    emptyWorkspace: { alignItems: 'center', paddingHorizontal: 26, paddingVertical: 54, gap: 12 },
    emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: color.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
    emptyCopy: { color: color.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    emptyAction: { borderRadius: 13, paddingHorizontal: 17, paddingVertical: 12, marginTop: 6 },
    emptyActionText: { fontSize: 13, fontWeight: '700' },
    editNotice: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    editText: { color: color.textMuted, fontSize: 13, flex: 1 },
    widget: {
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
      borderRadius: 18,
      padding: 16,
      gap: 13,
    },
    widgetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    widgetTitle: {
      color: color.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.35,
      textTransform: 'uppercase',
    },
    editActions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
    next: { flexDirection: 'row', gap: 11, alignItems: 'center' },
    alertIcon: {
      height: 35,
      width: 35,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextTitle: { color: color.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
    nextBody: { color: color.textMuted, fontSize: 13, marginTop: 3 },
    nowMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    agentLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    avatar: {
      width: 25,
      height: 25,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontSize: 13, fontWeight: '800' },
    agentName: { color: color.text, fontWeight: '600', fontSize: 14 },
    elapsed: { color: color.textSoft, fontSize: 13 },
    nowPrompt: {
      color: color.text,
      fontSize: 17,
      lineHeight: 23,
      letterSpacing: -0.25,
      marginTop: 12,
    },
    liveActivity: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
    pulse: { width: 7, height: 7, borderRadius: 4 },
    liveText: { color: color.textMuted, fontSize: 13 },
    actionRow: { flexDirection: 'row', gap: 9, marginTop: 14 },
    primaryAction: { borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13 },
    primaryLabel: { fontSize: 13, fontWeight: '700' },
    secondaryAction: {
      borderRadius: 12,
      paddingHorizontal: 15,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: color.lineStrong,
    },
    secondaryLabel: { color: color.textMuted, fontSize: 13, fontWeight: '700' },
    health: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
    healthNumber: {
      color: color.text,
      fontSize: 24,
      letterSpacing: -0.8,
      fontWeight: '600',
      textAlign: 'center',
    },
    healthLabel: { color: color.textMuted, fontSize: 12, marginTop: 2, textAlign: 'center' },
    healthRule: { height: 34, width: 1, backgroundColor: color.line },
    recentPrompt: { color: color.text, fontSize: 15, lineHeight: 21 },
    recentMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 10 },
    recentDetail: { color: color.textMuted, fontSize: 12 },
    done: { marginLeft: 'auto', fontSize: 12, fontWeight: '700' },
    timeline: { flexDirection: 'row', gap: 11, marginBottom: 13 },
    timelineDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
    timelineSummary: { color: color.text, fontSize: 14, fontWeight: '600' },
    timelineDetail: { color: color.textMuted, fontSize: 12, marginTop: 3 },
    branchName: { color: color.text, fontSize: 14, fontWeight: '600' },
    agentWidget: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    addRow: {
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: color.lineStrong,
      borderStyle: 'dashed',
    },
    addText: { color: color.textMuted, fontSize: 14, fontWeight: '600' },
    scrim: { flex: 1, backgroundColor: 'transparent' },
    sheet: {
      backgroundColor: color.panel,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderWidth: 1,
      borderColor: color.line,
      padding: 22,
      paddingBottom: 42 + insets.bottom,
      gap: 4,
    },
    sheetHandle: {
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.lineStrong,
      alignSelf: 'center',
      marginBottom: 14,
    },
    sheetTitle: { color: color.text, fontSize: 22, letterSpacing: -0.4, fontWeight: '700' },
    sheetSubtitle: { color: color.textMuted, fontSize: 13, marginBottom: 12 },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    pickIcon: {
      height: 32,
      width: 32,
      borderRadius: 11,
      backgroundColor: color.panelAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickTitle: { color: color.text, fontSize: 15, fontWeight: '600', flex: 1 },
    empty: { color: color.textMuted, fontSize: 14, lineHeight: 20 },
  });
