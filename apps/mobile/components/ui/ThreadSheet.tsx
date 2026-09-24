import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import type { LiveRun, Thread } from '@/lib/WorkspaceContext';

/**
 * Every conversation on this project, reachable while one is open.
 *
 * ## Why this exists
 *
 * Until now the thread list appeared only on the empty state, so the sole route
 * back to an earlier conversation was the "New" button - which archives what
 * you are reading and starts a fresh one. Browsing and starting over were the
 * same tap.
 *
 * That is expensive, and measurably so. A conversation's first turn re-sends
 * the repository the agent had already read; by its third turn a follow-up
 * sends about forty tokens and costs roughly a third as much. Forcing a new
 * conversation on anyone who merely wanted to look at an old one threw that
 * away every time. Giving the list its own door is the whole fix - "New" is
 * left exactly as it was, because starting fresh is a legitimate thing to want
 * and was never the problem.
 */
export function ThreadSheet({
  visible,
  threads,
  conversation,
  onOpen,
  onNew,
  onClose,
}: {
  visible: boolean;
  threads: Thread[];
  /** The open conversation, listed alongside the rest so the sheet shows where you are. */
  conversation: LiveRun[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { palette: color } = useTheme();
  const styles = useStyles();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stops a tap inside the sheet from closing it, without swallowing
            taps on the rows themselves. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.title}>Conversations</Text>
            <Pressable style={styles.newButton} onPress={onNew} hitSlop={8}>
              <Ionicons name="add" size={15} color={color.textMuted} />
              <Text style={styles.newText}>New</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
            {conversation.length > 0 ? (
              <View style={[styles.row, styles.rowOpen]}>
                <Ionicons name="return-down-forward" size={15} color={color.claudeText} />
                <Text style={[styles.rowText, styles.rowTextOpen]} numberOfLines={1}>
                  {conversation[0]?.prompt ?? 'Conversation'}
                </Text>
                <Text style={styles.rowOpenTag}>open</Text>
              </View>
            ) : null}

            {threads.map((thread) => (
              <Pressable
                key={thread.id}
                style={styles.row}
                onPress={() => {
                  // Closed by the caller rather than here, so the sheet cannot
                  // linger over a conversation that has already swapped under it.
                  onOpen(thread.id);
                }}
              >
                <Ionicons name="chatbubble-outline" size={15} color={color.textSoft} />
                <Text style={styles.rowText} numberOfLines={1}>
                  {thread.runs[0]?.prompt ?? 'Conversation'}
                </Text>
                <Text style={styles.rowCount}>{thread.runs.length}</Text>
              </Pressable>
            ))}

            {threads.length === 0 ? (
              <Text style={styles.empty}>
                Conversations you set aside appear here. Returning to one costs far less than
                starting over, because the agent still remembers what it read.
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function useStyles() {
  const { palette: color } = useTheme();
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: color.panel,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingBottom: spacing.xl,
      maxHeight: '75%',
    },
    grabber: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.lineStrong,
      alignSelf: 'center',
      marginTop: spacing.sm,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    title: { color: color.text, fontSize: 16, fontWeight: '600' },
    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
    },
    newText: { color: color.textMuted, fontSize: 12, fontWeight: '600' },
    list: { paddingHorizontal: spacing.lg },
    listInner: { paddingBottom: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: color.line,
    },
    rowOpen: { borderTopWidth: 0 },
    rowText: { color: color.textMuted, fontSize: 13, flex: 1 },
    rowTextOpen: { color: color.text },
    rowOpenTag: { color: color.claudeText, fontSize: 11 },
    rowCount: { color: color.textSoft, fontSize: 11, fontVariant: ['tabular-nums'] },
    empty: {
      color: color.textSoft,
      fontSize: 12.5,
      lineHeight: 18,
      paddingTop: spacing.md,
    },
  });
}
