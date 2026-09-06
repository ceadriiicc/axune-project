import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import type { LiveRun } from '@/lib/WorkspaceContext';

/**
 * The hero when an agent is working.
 *
 * Reports facts, never a percentage. A coding agent genuinely does not know how
 * far through it is, so "72% complete" would be an invention — elapsed time,
 * what it last touched, and how long since it said anything are all true and
 * more useful.
 *
 * Stop is present but quiet: it is the rarer intent, and an equally weighted
 * pair of buttons makes both harder to hit correctly one-handed.
 */
export function ActiveRun({
  run,
  onOpen,
  onStop,
}: {
  run: LiveRun;
  onOpen: () => void;
  onStop: () => void;
}) {
  const agent = AGENTS.claude;
  const elapsed = useTicker(run.startedAt);
  const quietFor = run.lastEventAt ? Date.now() - run.lastEventAt : 0;
  const lastTool = [...run.activity].reverse().find((line) => line.ok === null);

  const reads = run.activity.filter((l) => l.label === 'Read').length;
  const commands = run.activity.filter((l) => l.label === 'Bash').length;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={[styles.pulse, { backgroundColor: agent.accent }]} />
        <Text style={[styles.agent, { color: agent.accentText }]}>{agent.name}</Text>
        <View style={styles.flex} />
        <Text style={styles.elapsed}>{formatDuration(elapsed)}</Text>
      </View>

      <Text style={styles.prompt} numberOfLines={3}>
        {run.prompt}
      </Text>

      {lastTool ? (
        <Text style={styles.doing} numberOfLines={1}>
          {lastTool.label}
          {lastTool.detail ? ` ${lastTool.detail}` : ''}
        </Text>
      ) : null}

      <Text style={styles.counts}>
        {reads} file{reads === 1 ? '' : 's'} read · {commands} command
        {commands === 1 ? '' : 's'}
      </Text>

      {/*
        Silence is reported as a fact, not a diagnosis. An agent waiting on a
        test run, an install or a slow command is working perfectly well, and
        calling that "stalled" after two minutes would teach the user to worry
        every time. Only a much longer gap earns stronger wording.
      */}
      {quietFor > 20_000 ? (
        <Text style={[styles.counts, quietFor > 5 * 60_000 && styles.warnText]}>
          {quietFor > 5 * 60_000
            ? `No output for ${formatDuration(quietFor)} — possibly stalled`
            : `Last activity ${formatDuration(quietFor)} ago`}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable style={styles.open} onPress={onOpen}>
          <Text style={styles.openText}>Open live run</Text>
          <Ionicons name="arrow-forward" size={15} color="#1e1b18" />
        </Pressable>
        <Pressable style={styles.stop} onPress={onStop} hitSlop={8}>
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Re-renders once a second so elapsed time actually moves. */
function useTicker(since: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return since ? now - since : 0;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(216,173,123,0.32)',
    backgroundColor: 'rgba(216,173,123,0.08)',
    padding: spacing.md,
    marginTop: spacing.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulse: { width: 8, height: 8, borderRadius: 4 },
  agent: { fontSize: 13, fontWeight: '700' },
  flex: { flex: 1 },
  elapsed: { color: color.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  prompt: { color: color.text, fontSize: 15, lineHeight: 21, marginTop: spacing.sm },
  doing: { color: color.claudeText, fontSize: 12, marginTop: spacing.sm },
  counts: { color: color.textSoft, fontSize: 12, marginTop: 4 },
  warnText: { color: color.claude },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  open: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.claude,
    borderRadius: radius.md,
    paddingVertical: 13,
  },
  openText: { color: '#1e1b18', fontSize: 14, fontWeight: '700' },
  stop: { paddingHorizontal: spacing.md, paddingVertical: 13 },
  stopText: { color: color.danger, fontSize: 14, fontWeight: '600' },
});
