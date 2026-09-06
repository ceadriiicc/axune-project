import type { GitSnapshot } from '@axune/protocol';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

/**
 * The development snapshot: working tree, remote, last commit, diff scale.
 *
 * Compact metric rows rather than one card per fact. A clean tree reads calm;
 * anything unusual is coloured so it catches the eye without an alert banner.
 */
export function RepoStatus({ git, stale }: { git: GitSnapshot; stale: boolean }) {
  const clean = git.dirtyFiles === 0 && git.untrackedFiles === 0 && git.conflicts === 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Repository</Text>
        {stale ? <Text style={styles.stale}>last known</Text> : null}
      </View>

      <View style={styles.grid}>
        <Metric
          label="Working tree"
          value={clean ? 'clean' : `${git.dirtyFiles} modified`}
          tone={clean ? color.textMuted : color.claude}
          sub={git.untrackedFiles ? `${git.untrackedFiles} untracked` : undefined}
        />
        <Metric
          label="Remote"
          value={
            git.ahead === null
              ? 'no upstream'
              : `${git.ahead} ahead${git.behind ? ` · ${git.behind} behind` : ''}`
          }
          tone={git.behind ? color.danger : git.ahead ? color.codex : color.textMuted}
        />
      </View>

      {!clean && (git.insertions > 0 || git.deletions > 0) ? (
        <Text style={styles.diff}>
          <Text style={styles.plus}>+{git.insertions}</Text>
          {'  '}
          <Text style={styles.minus}>−{git.deletions}</Text>
          <Text style={styles.diffLabel}>  uncommitted</Text>
        </Text>
      ) : null}

      <View style={styles.divider} />

      <Text style={styles.commitLabel}>Latest commit</Text>
      <Text style={styles.commit} numberOfLines={2}>
        {git.lastCommitMessage}
      </Text>
      <Text style={styles.commitMeta}>
        {git.lastCommitHash} · {ago(git.lastCommitAt)}
      </Text>
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: string;
  sub?: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: tone }]}>{value}</Text>
      {sub ? <Text style={styles.metricSub}>{sub}</Text> : null}
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    color: color.textSoft,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  stale: { color: color.textSoft, fontSize: 11, fontStyle: 'italic' },
  grid: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.sm },
  metric: { gap: 2, flexShrink: 1 },
  metricLabel: { color: color.textSoft, fontSize: 11 },
  metricValue: { fontSize: 15, fontWeight: '600' },
  metricSub: { color: color.textSoft, fontSize: 11 },
  diff: { marginTop: spacing.sm, fontSize: 12 },
  plus: { color: color.ok, fontWeight: '600' },
  minus: { color: color.danger, fontWeight: '600' },
  diffLabel: { color: color.textSoft },
  divider: { height: 1, backgroundColor: color.line, marginVertical: spacing.md },
  commitLabel: { color: color.textSoft, fontSize: 11 },
  commit: { color: color.text, fontSize: 14, fontWeight: '600', lineHeight: 19, marginTop: 3 },
  commitMeta: { color: color.textSoft, fontSize: 12, marginTop: 3 },
});
