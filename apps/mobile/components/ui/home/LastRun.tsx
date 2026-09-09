import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ago } from '@/components/ui/home/RepoStatus';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import type { RunSummary } from '@/lib/WorkspaceContext';

/**
 * The last thing you asked, and how it went.
 *
 * Home showed nothing at all about past work, so a healthy project and no live
 * run left the screen empty - which reads as "nothing here" rather than
 * "nothing wrong". This answers the question someone actually opens the app
 * with when away from their desk: what did I ask it, and did it work?
 *
 * Every field is a real one from a finished run. Rendered only when a run has
 * actually finished, so there is never a placeholder pretending to be history.
 */
export function LastRun({ run, onOpen }: { run: RunSummary; onOpen: () => void }) {
  const { palette: color } = useTheme();
  const styles = useStyles();
  const failed = run.outcome === 'failed';
  const stopped = run.outcome === 'stopped';

  return (
    <Pressable style={styles.card} onPress={onOpen}>
      <View style={styles.header}>
        <Text style={styles.label}>Last run</Text>
        <Text style={[styles.outcome, failed && styles.failed, stopped && styles.stopped]}>
          {failed ? 'failed' : stopped ? 'stopped' : 'completed'} · {ago(run.finishedAt)}
        </Text>
      </View>

      <Text style={styles.prompt} numberOfLines={2}>
        {run.prompt}
      </Text>

      {run.excerpt ? (
        <Text style={styles.excerpt} numberOfLines={2}>
          {run.excerpt}
        </Text>
      ) : null}

      <View style={styles.footer}>
        {/* Only shown when non-zero: "0 files, 0 commands" is noise, and a run
            that read nothing usually failed early. */}
        <Text style={styles.meta}>
          {[
            run.filesRead ? `${run.filesRead} file${run.filesRead === 1 ? '' : 's'} read` : null,
            run.commands ? `${run.commands} command${run.commands === 1 ? '' : 's'}` : null,
            durationOf(run),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={color.textSoft} />
      </View>
    </Pressable>
  );
}

function durationOf(run: RunSummary): string | null {
  const ms = run.finishedAt - run.startedAt;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}

function useStyles() {
  const { palette: color } = useTheme();
  return StyleSheet.create({
    card: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      marginTop: spacing.md,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    label: {
      color: color.textSoft,
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    outcome: { color: color.textSoft, fontSize: 10.5 },
    failed: { color: color.danger },
    stopped: { color: color.claude },
    prompt: { color: color.text, fontSize: 15, lineHeight: 21, marginTop: 6 },
    excerpt: { color: color.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
    },
    meta: { color: color.textSoft, fontSize: 11 },
  });
}
