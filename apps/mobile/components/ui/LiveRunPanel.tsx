import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AgentText } from '@/components/ui/AgentText';
import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import type { LiveRun } from '@/lib/WorkspaceContext';

/**
 * A real Claude Code run, rendered from agent events alone.
 *
 * Nothing here knows what Claude Code is: it renders streamed text, tool
 * activity and a status, all of which any adapter produces. That is what makes
 * Codex and Gemini drop-in later rather than a rewrite.
 */
export function LiveRunPanel({ run, onStop }: { run: LiveRun; onStop: () => void }) {
  const agent = AGENTS.claude;
  const working = run.status === 'working';

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: agent.accentText }]}>
          {agent.glyph} {agent.name}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: statusColor(run.status) }]} />
          <Text style={styles.status}>{statusLabel(run.status, run.outcome)}</Text>
        </View>
      </View>

      {run.prompt ? (
        <View style={[styles.bubble, styles.prompt]}>
          <Text style={styles.promptText}>{run.prompt}</Text>
        </View>
      ) : null}

      {run.activity.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activityRow}>
          {run.activity.slice(-8).map((line) => (
            <View key={line.id} style={[styles.chip, line.ok === false && styles.chipDenied]}>
              <Text style={[styles.chipText, line.ok === false && styles.denied]}>
                {line.label}
              </Text>
              {/* What the tool touched. On a refusal this is the whole point:
                  "denied" on its own tells the user nothing. */}
              {line.detail ? <Text style={styles.chipDetail}>{line.detail}</Text> : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={[styles.bubble, { backgroundColor: agent.bubbleBg }]}>
        {run.text ? (
          <AgentText text={run.text} style={{ color: agent.bubbleText }} />
        ) : (
          <Text style={[styles.answer, { color: agent.bubbleText }]}>
            {working ? 'Working…' : 'No output yet.'}
          </Text>
        )}
      </View>

      {working ? (
        <Pressable style={styles.stop} onPress={onStop}>
          <Ionicons name="stop-circle-outline" size={16} color={color.danger} />
          <Text style={styles.stopText}>Stop run</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function statusColor(status: LiveRun['status']): string {
  if (status === 'working') return color.claude;
  if (status === 'finished') return color.ok;
  if (status === 'stopped') return color.textSoft;
  return color.danger;
}

function statusLabel(status: LiveRun['status'], outcome: string | null): string {
  if (status === 'working') return 'working';
  if (status === 'finished') return 'completed';
  if (status === 'stopped') return 'stopped';
  return outcome ? `failed — ${outcome}` : 'failed';
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.panel,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontWeight: '700', fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { color: color.textMuted, fontSize: 12 },
  bubble: { borderRadius: radius.md, padding: spacing.sm },
  prompt: { backgroundColor: '#303842' },
  promptText: { color: color.text, fontSize: 13, lineHeight: 19 },
  answer: { fontSize: 13, lineHeight: 20 },
  activityRow: { flexGrow: 0 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  chipText: { color: color.textMuted, fontSize: 11 },
  chipDetail: { color: color.textSoft, fontSize: 11 },
  chipDenied: { borderColor: color.danger },
  denied: { color: color.danger },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 12,
  },
  stopText: { color: color.danger, fontSize: 14, fontWeight: '600' },
});
