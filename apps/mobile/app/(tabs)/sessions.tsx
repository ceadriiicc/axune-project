import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/components/ui/home/ActiveRun';
import { ago } from '@/components/ui/home/RepoStatus';
import { type Palette, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Every run this device has seen, plus the few settings that are real.
 *
 * The mockup's toggles — sync prompts, save sessions, theme — are deliberately
 * absent: a switch that controls nothing is worse than no switch, because it
 * teaches people the app lies about what it can do.
 */
export default function SessionsScreen() {
  const router = useRouter();
  const { palette: color, mode, setMode } = useTheme();
  const styles = makeStyles(color);
  const {
    history,
    machine,
    project,
    capability,
    connectionState,
    agents,
    branches,
    deleteBranch,
    disconnect,
  } = useWorkspace();

  const connected = connectionState === 'connected' || connectionState === 'reconnecting';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Sessions</Text>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No runs yet</Text>
            <Text style={styles.emptyBody}>
              Runs you start appear here with what the agent read and how long it took.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {history.map((run) => (
              <Pressable
                key={run.runId}
                style={styles.row}
                onPress={() => router.push('/workspace')}
              >
                <View style={styles.rowTop}>
                  <View
                    style={[styles.dot, { backgroundColor: outcomeColor(run.outcome, color) }]}
                  />
                  <Text style={styles.rowPrompt} numberOfLines={2}>
                    {run.prompt || 'Untitled run'}
                  </Text>
                </View>
                <Text style={styles.rowMeta}>
                  {run.outcome} · {ago(run.finishedAt)} ·{' '}
                  {formatDuration(run.finishedAt - run.startedAt)} · {run.filesRead} read ·{' '}
                  {run.commands} command{run.commands === 1 ? '' : 's'}
                </Text>
                {run.excerpt ? (
                  <Text style={styles.rowExcerpt} numberOfLines={2}>
                    {run.excerpt}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}

        {branches.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Agent branches</Text>
            <View style={styles.card}>
              {branches.map((branch) => (
                <View key={branch.name} style={styles.branchRow}>
                  <View style={styles.branchCopy}>
                    <Text style={styles.branchName} numberOfLines={1}>
                      {branch.name.replace(/^axune\//, '')}
                    </Text>
                    <Text style={styles.branchMeta} numberOfLines={1}>
                      {branch.files} file{branch.files === 1 ? '' : 's'} · {ago(branch.at)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => deleteBranch(branch.name)}
                    hitSlop={10}
                    style={styles.branchDelete}
                  >
                    <Ionicons name="trash-outline" size={16} color={color.textSoft} />
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={styles.branchHint}>
              Merge one at your desk with git merge {branches[0]?.name ?? ''}
            </Text>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={styles.card}>
          <Text style={styles.appearanceCopy}>
            Follow this phone, or choose an appearance for Axune.
          </Text>
          <View style={styles.themeChoices}>
            {(['system', 'light', 'dark'] as const).map((choice) => (
              <Pressable
                key={choice}
                onPress={() => setMode(choice)}
                style={[styles.themeChoice, mode === choice && styles.themeChoiceSelected]}
              >
                <Text
                  style={[
                    styles.themeChoiceText,
                    mode === choice && styles.themeChoiceTextSelected,
                  ]}
                >
                  {choice[0].toUpperCase() + choice.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Connection</Text>
        <View style={styles.card}>
          <Detail label="Machine" value={machine?.name ?? 'Not paired'} />
          <Detail label="Project" value={project?.name ?? '—'} />
          <Detail label="Branch" value={project?.branch ?? '—'} />
          <Detail
            label="Permission"
            value={capability === 'read-only' ? 'Read-only' : 'Read + write'}
          />
          <Detail label="Transport" value={machine ? `${machine.connection} network` : '—'} />
        </View>

        <Text style={styles.sectionLabel}>Agents</Text>
        <View style={styles.card}>
          {agents.length === 0 ? (
            <Text style={styles.muted}>Not connected.</Text>
          ) : (
            agents.map((agent) => (
              <Detail
                key={agent.agentId}
                label={agent.agentId}
                value={
                  agent.installed
                    ? `Ready${agent.version ? ` · ${agent.version.replace(/\s*\(.*\)$/, '')}` : ''}`
                    : 'Not installed'
                }
              />
            ))
          )}
        </View>

        <Pressable
          style={styles.danger}
          onPress={connected ? disconnect : () => router.push('/pair')}
        >
          <Ionicons
            name={connected ? 'unlink-outline' : 'qr-code-outline'}
            size={16}
            color={connected ? color.danger : color.claude}
          />
          <Text style={[styles.dangerText, !connected && { color: color.claude }]}>
            {connected ? 'Unpair this phone' : 'Pair a machine'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function outcomeColor(outcome: string, color: Palette): string {
  if (outcome === 'completed') return color.ok;
  if (outcome === 'stopped') return color.textSoft;
  return color.danger;
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
    title: {
      color: color.text,
      fontSize: 30,
      fontWeight: '800',
      letterSpacing: -1.1,
      marginTop: spacing.xs,
    },

    empty: {
      marginTop: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      padding: spacing.lg,
      backgroundColor: color.panelAlt,
      gap: 6,
    },
    emptyTitle: { color: color.text, fontSize: 15, fontWeight: '600' },
    emptyBody: { color: color.textMuted, fontSize: 13, lineHeight: 19 },

    list: { gap: spacing.sm, marginTop: spacing.lg },
    row: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.surface,
      padding: spacing.md,
    },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
    rowPrompt: { flex: 1, color: color.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
    rowMeta: { color: color.textSoft, fontSize: 11.5, marginTop: 6 },
    rowExcerpt: { color: color.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },

    sectionLabel: {
      color: color.textSoft,
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    card: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: 10,
    },
    detailLabel: {
      color: color.textSoft,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.45,
    },
    detailValue: { color: color.textMuted, fontSize: 13, flexShrink: 1, textAlign: 'right' },
    muted: { color: color.textSoft, fontSize: 13, paddingVertical: 10 },
    appearanceCopy: {
      color: color.textMuted,
      fontSize: 13,
      lineHeight: 19,
      paddingTop: spacing.sm,
    },
    themeChoices: {
      flexDirection: 'row',
      gap: spacing.xs,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    themeChoice: {
      flex: 1,
      alignItems: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
      paddingVertical: 9,
    },
    themeChoiceSelected: { backgroundColor: color.claudeIconBg, borderColor: color.claude },
    themeChoiceText: { color: color.textMuted, fontSize: 12, fontWeight: '600' },
    themeChoiceTextSelected: { color: color.claudeIconText },
    branchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
    branchCopy: { flex: 1 },
    branchName: { color: color.codexText, fontSize: 13, fontWeight: '600' },
    branchMeta: { color: color.textSoft, fontSize: 11, marginTop: 2 },
    branchDelete: { padding: 4 },
    branchHint: { color: color.textSoft, fontSize: 11, marginTop: 6, lineHeight: 16 },

    danger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: spacing.xl,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      paddingVertical: 13,
    },
    dangerText: { color: color.danger, fontSize: 14, fontWeight: '600' },
  });
