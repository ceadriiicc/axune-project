import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ago } from '@/components/ui/home/RepoStatus';
import { type Palette, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import { useWorkspace, type LiveRun, type Thread } from '@/lib/WorkspaceContext';

/**
 * The conversations this phone has had with the desktop.
 *
 * Rebuilt around threads rather than individual runs. A flat list of runs is
 * how the desktop stores them and not how anybody thinks about them: you
 * remember asking about a bug, not the four prompts it took. Opening a thread
 * resumes it rather than starting over.
 *
 * Two sections left with the migration and are not missed. Connection details
 * and the agent list were both here because nothing else owned them, and both
 * are now on screens that do - repeating them here would mean two places to
 * read the same fact and two places to keep it true.
 */
export default function SessionsScreen() {
  const router = useRouter();
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  const { live, threads, openThread, branches, deleteBranch, newConversation } = useWorkspace();
  const working = live?.status === 'working' ? live : null;

  const open = (id: string) => {
    openThread(id);
    router.push('/workspace');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topline}>
          <View style={styles.flex}>
            <Text style={styles.kicker}>CONVERSATIONS</Text>
            <Text style={styles.title}>Sessions</Text>
          </View>
          <Pressable
            accessibilityLabel="Start a new conversation"
            style={[styles.newButton, { backgroundColor: color.text }]}
            onPress={() => {
              newConversation();
              router.push('/workspace');
            }}
          >
            <Ionicons name="add" size={22} color={color.panel} />
          </Pressable>
        </View>

        {working ? <LiveCard run={working} onOpen={() => router.push('/workspace')} styles={styles} /> : null}

        {branches.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Changes ready to review</Text>
            <View style={styles.card}>
              {branches.map((branch) => (
                <View key={branch.name} style={styles.branchRow}>
                  <View style={[styles.branchIcon, { backgroundColor: color.claudeIconBg }]}>
                    <Ionicons name="git-compare-outline" size={17} color={color.claudeIconText} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.branchName} numberOfLines={1}>
                      {branch.name.replace(/^axune\//, '')}
                    </Text>
                    <Text style={styles.branchMeta} numberOfLines={1}>
                      {[
                        `${branch.files} file${branch.files === 1 ? '' : 's'}`,
                        ago(branch.at),
                      ].join(' · ')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => deleteBranch(branch.name)}
                    hitSlop={12}
                    accessibilityLabel={`Delete ${branch.name}`}
                  >
                    <Ionicons name="trash-outline" size={17} color={color.textSoft} />
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={styles.branchHint}>
              Keep one at your desk with git merge {branches[0]?.name ?? ''}
            </Text>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Earlier conversations</Text>
        {threads.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Nothing to resume yet</Text>
            <Text style={styles.emptyBody}>
              Conversations you finish are kept here, so you can pick one up rather than explaining
              it again.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {threads.map((thread, index) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                first={index === 0}
                onPress={() => open(thread.id)}
                styles={styles}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LiveCard({
  run,
  onOpen,
  styles,
}: {
  run: LiveRun;
  onOpen: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  const doing = run.activity[run.activity.length - 1]?.label ?? null;

  return (
    <Pressable style={[styles.live, { backgroundColor: color.claudeBubble }]} onPress={onOpen}>
      <View style={styles.liveTop}>
        <View style={[styles.avatar, { backgroundColor: color.claudeIconBg }]}>
          <Text style={[styles.avatarText, { color: color.claudeIconText }]}>C</Text>
        </View>
        <Text style={[styles.liveLabel, { color: color.claudeText }]}>CLAUDE IS WORKING</Text>
        <Ionicons name="chevron-forward" size={18} color={color.claudeText} />
      </View>
      <Text style={[styles.livePrompt, { color: color.claudeBubbleText }]} numberOfLines={3}>
        {run.prompt}
      </Text>
      {doing ? (
        <Text style={[styles.liveDoing, { color: color.claudeText }]} numberOfLines={1}>
          {doing}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ThreadRow({
  thread,
  first,
  onPress,
  styles,
}: {
  thread: Thread;
  first: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  // The last run is what the conversation ended on, which is what someone
  // scanning the list is trying to recognise.
  const last = thread.runs[thread.runs.length - 1];
  if (!last) return null;

  return (
    <Pressable style={[styles.row, !first && styles.rowDivided]} onPress={onPress}>
      <View style={styles.rowTop}>
        <Text style={styles.rowPrompt} numberOfLines={2}>
          {last.prompt || 'Untitled conversation'}
        </Text>
        <Ionicons name="chevron-forward" size={17} color={color.textSoft} />
      </View>
      {last.text ? (
        <Text style={styles.rowExcerpt} numberOfLines={2}>
          {last.text}
        </Text>
      ) : null}
      <Text style={styles.rowMeta}>
        {[
          outcomeLabel(last),
          ago(thread.startedAt),
          `${thread.runs.length} prompt${thread.runs.length === 1 ? '' : 's'}`,
        ].join(' · ')}
      </Text>
    </Pressable>
  );
}

function outcomeLabel(run: LiveRun): string {
  if (run.status === 'working') return 'Still running';
  if (run.status === 'stopped') return 'Stopped';
  if (run.status === 'failed') return 'Failed';
  return 'Completed';
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
    flex: { flex: 1 },
    topline: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: color.text, fontSize: 31, letterSpacing: -1, fontWeight: '600', marginTop: 6 },
    newButton: {
      height: 42,
      width: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
    },

    live: { borderRadius: radius.xl, padding: spacing.md, marginTop: spacing.lg, gap: 10 },
    liveTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatar: { height: 26, width: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 13, fontWeight: '800' },
    liveLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, flex: 1 },
    livePrompt: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
    liveDoing: { fontSize: 13 },

    sectionTitle: {
      color: color.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.35,
      textTransform: 'uppercase',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: color.panel,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
      overflow: 'hidden',
    },

    row: { padding: spacing.md, gap: 5 },
    rowDivided: { borderTopWidth: 1, borderTopColor: color.line },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    rowPrompt: { color: color.text, fontSize: 16, lineHeight: 22, fontWeight: '600', flex: 1 },
    rowExcerpt: { color: color.textMuted, fontSize: 13.5, lineHeight: 19 },
    rowMeta: { color: color.textSoft, fontSize: 12, marginTop: 2 },

    emptyTitle: { color: color.text, fontSize: 16, fontWeight: '700', padding: spacing.md, paddingBottom: 0 },
    emptyBody: {
      color: color.textMuted,
      fontSize: 13.5,
      lineHeight: 19,
      padding: spacing.md,
      paddingTop: 6,
    },

    branchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
    },
    branchIcon: { height: 34, width: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    branchName: { color: color.text, fontSize: 15, fontWeight: '700' },
    branchMeta: { color: color.textMuted, fontSize: 12.5, marginTop: 2 },
    branchHint: { color: color.textSoft, fontSize: 12, marginTop: spacing.sm, lineHeight: 18 },
  });
