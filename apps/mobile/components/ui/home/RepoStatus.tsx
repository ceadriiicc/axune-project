import type { GitSnapshot } from '@axune/protocol';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

/**
 * Git state, compressed hard when it is boring.
 *
 * A clean repository gets one line, because spending a tall card explaining
 * that nothing is wrong is exactly what trains people to stop reading. A dirty
 * or diverged one earns more room, and only then is the diff scale shown —
 * "+0 −0" is noise.
 */
export function RepoStatus({ git, stale }: { git: GitSnapshot; stale: boolean }) {
  const clean = git.dirtyFiles === 0 && git.untrackedFiles === 0 && git.conflicts === 0;
  const hasDiff = git.insertions > 0 || git.deletions > 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Repository</Text>
        {stale ? <Text style={styles.stale}>last known</Text> : null}
      </View>

      <View style={styles.stateRow}>
        {clean ? (
          <Text style={styles.clean}>✓ Clean</Text>
        ) : (
          <Text style={styles.dirty}>
            {git.dirtyFiles} modified
            {git.untrackedFiles ? ` · ${git.untrackedFiles} untracked` : ''}
          </Text>
        )}
        <Text style={styles.remote}>
          <Text style={git.ahead ? styles.ahead : styles.quiet}>↑{git.ahead ?? 0}</Text>
          {'  '}
          <Text style={git.behind ? styles.behind : styles.quiet}>↓{git.behind ?? 0}</Text>
        </Text>
      </View>

      {!clean && hasDiff ? (
        <Text style={styles.diff}>
          <Text style={styles.plus}>+{git.insertions}</Text>
          {'  '}
          <Text style={styles.minus}>−{git.deletions}</Text>
        </Text>
      ) : null}

      <Text style={styles.commit} numberOfLines={1}>
        {git.lastCommitMessage}
      </Text>
      <Text style={styles.commitMeta}>
        {git.lastCommitHash} · {ago(git.lastCommitAt)}
      </Text>
    </View>
  );
}

export function ago(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    color: color.textSoft,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  stale: { color: color.textSoft, fontSize: 10.5, fontStyle: 'italic' },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  clean: { color: color.textMuted, fontSize: 14, fontWeight: '600' },
  dirty: { color: color.claude, fontSize: 14, fontWeight: '600' },
  remote: { fontSize: 13, fontVariant: ['tabular-nums'] },
  ahead: { color: color.codex, fontWeight: '600' },
  behind: { color: color.danger, fontWeight: '600' },
  quiet: { color: color.textSoft },
  diff: { marginTop: 4, fontSize: 12 },
  plus: { color: color.ok, fontWeight: '600' },
  minus: { color: color.danger, fontWeight: '600' },
  commit: { color: color.textMuted, fontSize: 13, marginTop: spacing.sm },
  commitMeta: { color: color.textSoft, fontSize: 11, marginTop: 2 },
});
