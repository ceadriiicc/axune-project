import { Ionicons } from '@expo/vector-icons';
import type { Thread } from '@/lib/WorkspaceContext';
import { useTheme } from '@/lib/ThemeContext';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function DemoSessions({ threads }: { threads: Thread[] }) {
  const { palette: color } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(color), [color]);
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View>
            <Text style={styles.kicker}>CONVERSATIONS</Text>
            <Text style={styles.title}>Sessions</Text>
          </View>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/demo/session/[id]' as never, params: { id: 'new' } })
            }
            style={styles.newButton}
          >
            <Ionicons name="add" size={20} color={color.panel} />
          </Pressable>
        </View>
        <Pressable
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
            <Ionicons name="arrow-forward" size={18} color={color.textMuted} />
          </View>
        </Pressable>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Archived conversations</Text>
          <Text style={styles.sectionNote}>They stay available to resume.</Text>
        </View>
        <View style={styles.list}>
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
        </View>
      </ScrollView>
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
        <Text style={styles.rowMeta}>{run.status === 'finished' ? 'Completed' : run.status}</Text>
        <Text style={styles.rowMeta}>{relativeTime(thread.startedAt)}</Text>
        <Text style={styles.rowMeta}>
          {thread.runs.length} prompt{thread.runs.length === 1 ? '' : 's'}
        </Text>
      </View>
    </Pressable>
  );
}

function relativeTime(at: number) {
  const hours = Math.max(1, Math.round((Date.now() - at) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
const makeStyles = (color: ReturnType<typeof useTheme>['palette']) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    content: { padding: 22, paddingTop: 68, paddingBottom: 40, gap: 18 },
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
  });
