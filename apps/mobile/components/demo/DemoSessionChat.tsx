import { Ionicons } from '@expo/vector-icons';
import type { Thread } from '@/lib/WorkspaceContext';
import { useDemoTheme as useTheme } from './DemoAppearance';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

export function DemoSessionChat({ thread, active = false }: { thread: Thread; active?: boolean }) {
  const { palette: color } = useTheme();
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [allowWrite, setAllowWrite] = useState(false);
  const [stopped, setStopped] = useState(false);
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(color, insets), [color, insets]);
  const run = thread.runs[thread.runs.length - 1]!;
  const isActive = active && !stopped;
  return (
    <View style={styles.page}>
      <View style={styles.nav}>
        <Pressable accessibilityLabel="Back to sessions" onPress={() => router.back()} style={styles.navButton}>
          <Ionicons name="chevron-back" size={23} color={color.text} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>Session</Text>
          <Text style={styles.navSub}>
            {isActive ? 'Claude is working' : active ? 'Run stopped' : 'Archived conversation'}
          </Text>
        </View>
        <Pressable accessibilityLabel="Session options" style={styles.navButton}>
          <Ionicons name="ellipsis-horizontal" size={20} color={color.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.prompt}>
          <Text style={styles.promptLabel}>YOU ASKED</Text>
          <Text style={styles.promptText}>{run.prompt}</Text>
        </View>
        <View style={styles.agentHead}>
          <View style={[styles.avatar, { backgroundColor: color.claudeIconBg }]}>
            <Text style={[styles.avatarText, { color: color.claudeIconText }]}>C</Text>
          </View>
          <View>
            <Text style={styles.agent}>Claude Code</Text>
            <Text style={styles.status}>{isActive ? 'Working now' : stopped ? 'Stopped' : 'Completed'}</Text>
          </View>
        </View>
        <Text style={styles.answer}>{run.text}</Text>
        <View style={styles.tools}>
          <Text style={styles.toolTitle}>{isActive ? 'WORKING NOW' : 'WHAT HAPPENED'}</Text>
          {run.activity.map((item) => (
            <View key={item.id} style={styles.tool}>
              <Ionicons
                name={
                  item.ok === false
                    ? 'close-circle-outline'
                    : item.ok === null
                      ? 'ellipsis-horizontal-circle-outline'
                      : 'checkmark-circle-outline'
                }
                size={18}
                color={item.ok === false ? color.danger : item.ok === null ? color.info : color.ok}
              />
              <View style={styles.flex}>
                <Text style={styles.toolLabel}>{item.label}</Text>
                {item.detail && <Text style={styles.toolDetail}>{item.detail}</Text>}
              </View>
              {isActive && item.ok === null && <Text style={styles.running}>Running</Text>}
            </View>
          ))}
        </View>
        {isActive && (
          <Pressable
            onPress={() =>
              Alert.alert('Stop this run?', 'Claude will stop after its current tool completes.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Stop run', style: 'destructive', onPress: () => setStopped(true) },
              ])
            }
            style={[styles.stop, { borderColor: color.lineStrong }]}
          >
            <Ionicons name="stop-circle-outline" size={18} color={color.danger} />
            <Text style={[styles.stopText, { color: color.danger }]}>Stop run</Text>
          </Pressable>
        )}
      </ScrollView>
      <View style={styles.composer}>
        <View style={styles.composerTop}>
          <Text style={styles.composerHint}>This prompt</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: allowWrite }}
            onPress={() => setAllowWrite((current) => !current)}
            style={[styles.writeToggle, allowWrite && { backgroundColor: color.claudeBubble }]}
          >
            <Ionicons
              name={allowWrite ? 'create-outline' : 'eye-outline'}
              size={15}
              color={allowWrite ? color.claudeText : color.textMuted}
            />
            <Text style={[styles.writeToggleText, { color: allowWrite ? color.claudeText : color.textMuted }]}>
              {allowWrite ? 'Allow write' : 'Read only'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.composerRow}>
          <TextInput
            accessibilityLabel="Follow-up prompt"
            multiline
            onChangeText={setDraft}
            placeholder="Ask a follow-up"
            placeholderTextColor={color.textSoft}
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityLabel="Send prompt"
            disabled={!draft.trim()}
            onPress={() => {
              setDraft('');
              setAllowWrite(false);
            }}
            style={[styles.send, { backgroundColor: color.text }, !draft.trim() && styles.sendDisabled]}
          >
            <Ionicons name="arrow-up" size={19} color={color.panel} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
const makeStyles = (color: ReturnType<typeof useTheme>['palette'], insets: EdgeInsets) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    nav: {
      paddingHorizontal: 18,
      paddingTop: Math.max(58, insets.top + 12),
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomColor: color.line,
      borderBottomWidth: 1,
    },
    navButton: { height: 38, width: 38, alignItems: 'center', justifyContent: 'center' },
    navCenter: { alignItems: 'center' },
    navTitle: { color: color.text, fontSize: 15, fontWeight: '700' },
    navSub: { color: color.textMuted, fontSize: 11, marginTop: 1 },
    content: { padding: 22, gap: 20, paddingBottom: 130 + insets.bottom },
    prompt: { backgroundColor: color.panelAlt, borderRadius: 17, padding: 16, gap: 7 },
    promptLabel: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    promptText: { color: color.text, fontSize: 17, fontWeight: '600', lineHeight: 24 },
    agentHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: {
      height: 32,
      width: 32,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontSize: 15, fontWeight: '800' },
    agent: { color: color.text, fontSize: 15, fontWeight: '700' },
    status: { color: color.textMuted, fontSize: 12, marginTop: 2 },
    answer: { color: color.text, fontSize: 17, lineHeight: 26 },
    tools: {
      borderRadius: 17,
      backgroundColor: color.panel,
      borderColor: color.line,
      borderWidth: 1,
      padding: 15,
      gap: 13,
    },
    toolTitle: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    tool: { flexDirection: 'row', gap: 9, alignItems: 'center' },
    flex: { flex: 1 },
    toolLabel: { color: color.text, fontSize: 14, fontWeight: '600' },
    toolDetail: { color: color.textMuted, fontSize: 12, marginTop: 2 },
    running: { color: color.info, fontSize: 12, fontWeight: '600' },
    stop: {
      borderWidth: 1,
      borderRadius: 14,
      paddingVertical: 12,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    stopText: { fontSize: 14, fontWeight: '700' },
    composer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopColor: color.line,
      borderTopWidth: 1,
      backgroundColor: color.bg,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 12 + insets.bottom,
      gap: 8,
    },
    composerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    composerHint: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
    writeToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 6 },
    writeToggleText: { fontSize: 12, fontWeight: '700' },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    input: { color: color.text, fontSize: 15, flex: 1, minHeight: 39, maxHeight: 96, paddingHorizontal: 4, paddingVertical: 8 },
    send: {
      height: 39,
      width: 39,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.42 },
  });
