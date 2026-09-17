import { Ionicons } from '@expo/vector-icons';
import type { Thread } from '@/lib/WorkspaceContext';
import { useDemoTheme as useTheme } from './DemoAppearance';
import { useDemoScenario } from './DemoScenario';
import { DemoTabBar } from './DemoTabBar';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

export function DemoSessions({ threads }: { threads: Thread[] }) {
  const { palette: color } = useTheme();
  const { state } = useDemoScenario();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(color, insets), [color, insets]);
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View>
            <Text style={styles.kicker}>CONVERSATIONS</Text>
            <Text style={styles.title}>Sessions</Text>
          </View>
          <Pressable
            accessibilityLabel="Start a new conversation"
            onPress={() =>
              router.push({ pathname: '/demo/session/[id]' as never, params: { id: 'new' } })
            }
            style={styles.newButton}
          >
            <Ionicons name="add" size={20} color={color.panel} />
          </Pressable>
        </View>
        {state !== 'empty' && state !== 'offline' && <Pressable
          onPress={() =>
            router.push({ pathname: '/demo/session/[id]' as never, params: { id: 'live' } })
          }
          style={({ pressed }) => [styles.live, pressed && styles.pressed]}
        >
          <View style={styles.liveTop}>
            <View style={styles.agent}>
              <Text style={[styles.agentLetter, { color: color.claudeIconText }]}>C</Text>
            </View>
            <Text style={styles.liveLabel}>CLAUDE IS WORKING</Text>
            <Text style={styles.liveTime}>8m</Text>
          </View>
          <Text style={styles.livePrompt}>
            Map the mobile navigation and identify the next useful screen.
          </Text>
          <View style={styles.liveFoot}>
            <View style={[styles.dot, { backgroundColor: color.claudeStrong }]} />
            <Text style={styles.liveDetail}>Searching session screens</Text>
            <Ionicons name="chevron-forward" size={18} color={color.textMuted} />
          </View>
        </Pressable>}
        {state !== 'empty' && <Pressable
          onPress={() => router.push('/demo/review')}
          style={({ pressed }) => [styles.review, pressed && styles.pressed]}
        >
          <View style={styles.reviewIcon}>
            <Ionicons name="git-compare-outline" size={19} color={color.claudeIconText} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.reviewTitle}>Changes ready to review</Text>
            <Text style={styles.reviewDetail}>2 files · +64 · −5</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={color.textMuted} />
        </Pressable>}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Archived conversations</Text>
          <Text style={styles.sectionNote}>They stay available to resume.</Text>
        </View>
        {state === 'empty' ? <View style={styles.emptyState}>
          <Ionicons name="chatbubble-ellipses-outline" size={27} color={color.textSoft} />
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <Text style={styles.emptyCopy}>Ask Claude to investigate, explain, or make a change from your phone.</Text>
        </View> : <View style={styles.list}>
          {threads.map((thread) => (
            <SessionRow
              key={thread.id}
              thread={thread}
              onPress={() =>
                router.push({ pathname: '/demo/session/[id]' as never, params: { id: thread.id } })
              }
              styles={styles}
            />
          ))}
        </View>}
      </ScrollView>
      <DemoTabBar />
    </View>
  );
}

function SessionRow({
  thread,
  onPress,
  styles,
}: {
  thread: Thread;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  const run = thread.runs[thread.runs.length - 1]!;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowTop}>
        <Text numberOfLines={2} style={styles.rowPrompt}>
          {run.prompt}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={color.textSoft} />
      </View>
      <Text numberOfLines={2} style={styles.rowExcerpt}>
        {run.text}
      </Text>
      <View style={styles.rowFoot}>
        <Text style={styles.rowMeta}>
          {[
            run.status === 'finished' ? 'Completed' : run.status,
            relativeTime(thread.startedAt),
            thread.runs.length + (thread.runs.length === 1 ? ' prompt' : ' prompts'),
          ].join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

function relativeTime(at: number) {
  const hours = Math.max(1, Math.round((Date.now() - at) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
const makeStyles = (color: ReturnType<typeof useTheme>['palette'], insets: EdgeInsets) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    content: {
      padding: 22,
      paddingTop: Math.max(68, insets.top + 20),
      paddingBottom: 110 + insets.bottom,
      gap: 18,
    },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: color.text, fontSize: 31, letterSpacing: -1, fontWeight: '600', marginTop: 6 },
    newButton: {
      height: 42,
      width: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.text,
    },
    live: { backgroundColor: color.claudeBubble, borderRadius: 20, padding: 17, gap: 13 },
    liveTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    agent: {
      height: 26,
      width: 26,
      borderRadius: 9,
      backgroundColor: color.claudeIconBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentLetter: { fontWeight: '800', fontSize: 13 },
    liveLabel: { color: color.claudeText, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
    liveTime: { marginLeft: 'auto', color: color.textMuted, fontSize: 12 },
    livePrompt: { color: color.claudeBubbleText, fontSize: 18, fontWeight: '600', lineHeight: 24 },
    liveFoot: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    review: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: color.panel,
      borderColor: color.line,
      borderWidth: 1,
      borderRadius: 18,
      padding: 14,
    },
    reviewIcon: {
      height: 35,
      width: 35,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.claudeIconBg,
    },
    flex: { flex: 1 },
    reviewTitle: { color: color.text, fontSize: 14, fontWeight: '700' },
    reviewDetail: { color: color.textMuted, fontSize: 12, marginTop: 3 },
    dot: { height: 7, width: 7, borderRadius: 4 },
    liveDetail: { color: color.claudeText, fontSize: 13, flex: 1 },
    sectionHead: { gap: 3, marginTop: 4 },
    sectionTitle: { color: color.text, fontSize: 17, fontWeight: '700' },
    sectionNote: { color: color.textMuted, fontSize: 13 },
    list: {
      backgroundColor: color.panel,
      borderRadius: 18,
      borderColor: color.line,
      borderWidth: 1,
      overflow: 'hidden',
    },
    row: { padding: 16, gap: 8, borderBottomColor: color.line, borderBottomWidth: 1 },
    rowTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    rowPrompt: { color: color.text, fontSize: 15, lineHeight: 20, fontWeight: '600', flex: 1 },
    rowExcerpt: { color: color.textMuted, fontSize: 13, lineHeight: 18 },
    rowFoot: { flexDirection: 'row', gap: 10, marginTop: 2 },
    rowMeta: { color: color.textSoft, fontSize: 12 },
    pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
    emptyState: { alignItems: 'center', paddingHorizontal: 35, paddingVertical: 46, gap: 9 },
    emptyTitle: { color: color.text, fontSize: 18, fontWeight: '700' },
    emptyCopy: { color: color.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  });
