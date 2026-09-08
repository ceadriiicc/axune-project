import type { ActivityEvent, ActivityKind } from '@axune/protocol';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

/**
 * Two views of one stream.
 *
 * `SinceLastChecked` answers "what happened while I was away", which is the
 * question a remote monitor exists to answer. `RecentActivity` is the same
 * events in order, for when the summary is not enough. They share a source so
 * they can never disagree.
 */
export function SinceLastChecked({
  events,
  count,
  lastCheckedAt,
}: {
  events: ActivityEvent[];
  count: number;
  lastCheckedAt: number | null;
}) {
  if (count <= 0) return null;

  const fresh = events.slice(-count);
  const commits = fresh.filter((e) => e.kind === 'git.commit').length;
  const runsDone = fresh.filter((e) => e.kind.startsWith('run.') && e.kind !== 'run.started').length;
  const failed = fresh.filter((e) => e.kind === 'run.failed').length;
  const branches = fresh.filter((e) => e.kind === 'git.branch');
  const dirty = fresh.filter((e) => e.kind === 'git.dirty' || e.kind === 'git.clean').slice(-1)[0];

  const lines: string[] = [];
  if (runsDone) lines.push(`${runsDone} agent run${runsDone === 1 ? '' : 's'} finished`);
  if (failed) lines.push(`${failed} run${failed === 1 ? '' : 's'} failed`);
  if (commits) lines.push(`${commits} new commit${commits === 1 ? '' : 's'}`);
  if (branches.length) lines.push(branches[branches.length - 1]!.summary);
  if (dirty) lines.push(dirty.summary);

  // Everything was device chatter — connections and disconnections. True, but
  // not worth a summary card.
  if (lines.length === 0) return null;

  return (
    <View style={styles.since}>
      <Text style={styles.sinceLabel}>Since you last checked</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.sinceLine}>
          {line}
        </Text>
      ))}
      {lastCheckedAt ? (
        <Text style={styles.sinceFoot}>Last checked {relative(lastCheckedAt)}</Text>
      ) : null}
    </View>
  );
}

export function RecentActivity({ events }: { events: ActivityEvent[] }) {
  const rows = [...events].reverse().slice(0, 6);
  if (rows.length === 0) return null;

  return (
    <>
      <Text style={styles.sectionLabel}>Recent activity</Text>
      <View style={styles.feed}>
        {rows.map((event) => (
          <View key={event.id} style={styles.row}>
            <Text style={styles.time}>{clock(event.at)}</Text>
            <View style={[styles.tick, { backgroundColor: kindColor(event.kind) }]} />
            <View style={styles.copy}>
              <Text style={styles.summary} numberOfLines={1}>
                {event.summary}
              </Text>
              {event.detail ? (
                <Text style={styles.detail} numberOfLines={1}>
                  {event.detail}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function kindColor(kind: ActivityKind): string {
  if (kind === 'run.failed') return color.danger;
  if (kind === 'run.completed') return color.ok;
  if (kind === 'git.commit' || kind === 'git.pushed') return color.codex;
  if (kind === 'run.started') return color.claude;
  return color.textSoft;
}

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function relative(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  since: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(110,184,187,0.28)',
    backgroundColor: 'rgba(110,184,187,0.08)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  sinceLabel: {
    color: color.codexText,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sinceLine: { color: color.text, fontSize: 14, marginTop: 5, lineHeight: 19 },
  sinceFoot: { color: color.textSoft, fontSize: 11, marginTop: 7 },

  sectionLabel: {
    color: color.textSoft,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  feed: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  time: {
    color: color.textSoft,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    width: 38,
  },
  tick: { width: 6, height: 6, borderRadius: 3 },
  copy: { flex: 1 },
  summary: { color: color.textMuted, fontSize: 13 },
  detail: { color: color.textSoft, fontSize: 11, marginTop: 1 },
});
