import { Ionicons } from '@expo/vector-icons';
import type { AgentStatus, GitSnapshot } from '@axune/protocol';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';
import type { ConnectionState } from '@/lib/AxuneClient';

/**
 * Things that actually need attention.
 *
 * Occupies no space when everything is fine — a permanent "all good" banner
 * trains people to ignore the place where real warnings appear. Healthy is
 * quiet; abnormal is loud.
 */
export interface AlertItem {
  id: string;
  text: string;
  severity: 'warn' | 'danger';
}

export function collectAlerts(input: {
  connectionState: ConnectionState;
  agents: AgentStatus[];
  git?: GitSnapshot;
  staleRunMs: number | null;
}): AlertItem[] {
  const alerts: AlertItem[] = [];
  const { git } = input;

  if (git?.conflicts) {
    alerts.push({
      id: 'conflicts',
      severity: 'danger',
      text: `${git.conflicts} merge conflict${git.conflicts === 1 ? '' : 's'} to resolve`,
    });
  }

  if (git?.inProgress) {
    alerts.push({
      id: 'in-progress',
      severity: 'danger',
      text: `A ${git.inProgress} is half-finished on this branch`,
    });
  }

  if (git?.detachedHead) {
    alerts.push({ id: 'detached', severity: 'warn', text: 'HEAD is detached — commits may be lost' });
  }

  // Being a commit or two behind is ordinary and shown quietly in the repository
  // row. Only a real divergence is worth an alert, or every branch you have not
  // pulled today becomes a warning and the alerts stop meaning anything.
  if (git?.behind && git.behind >= 5) {
    alerts.push({
      id: 'behind',
      severity: 'warn',
      text: `${git.behind} commits behind the remote`,
    });
  }

  for (const agent of input.agents) {
    if (!agent.installed) {
      alerts.push({ id: `agent-${agent.agentId}`, severity: 'warn', text: `${agent.agentId} is not installed` });
    } else if (agent.authenticated === 'no') {
      alerts.push({
        id: `auth-${agent.agentId}`,
        severity: 'danger',
        text: `${agent.agentId} needs authentication`,
      });
    }
  }

  // A run that has gone quiet for minutes is worth flagging, without pretending
  // to know a percentage complete — agents cannot reliably report progress.
  if (input.staleRunMs && input.staleRunMs > 5 * 60 * 1000) {
    alerts.push({
      id: 'stale-run',
      severity: 'warn',
      text: `A run has produced no output for ${Math.round(input.staleRunMs / 60000)} minutes`,
    });
  }

  if (input.connectionState === 'failed') {
    alerts.push({ id: 'conn', severity: 'danger', text: 'Connection to the desktop failed' });
  }

  return alerts;
}

export function Alerts({ items }: { items: AlertItem[] }) {
  if (items.length === 0) return null;

  return (
    <View style={styles.stack}>
      {items.map((item) => (
        <View
          key={item.id}
          style={[styles.row, item.severity === 'danger' ? styles.danger : styles.warn]}
        >
          <Ionicons
            name={item.severity === 'danger' ? 'alert-circle' : 'warning-outline'}
            size={15}
            color={item.severity === 'danger' ? color.danger : color.claude}
          />
          <Text style={styles.text}>{item.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 6, marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  warn: { borderColor: 'rgba(216,173,123,0.28)', backgroundColor: 'rgba(216,173,123,0.08)' },
  danger: { borderColor: 'rgba(204,124,124,0.32)', backgroundColor: 'rgba(204,124,124,0.10)' },
  text: { color: color.text, fontSize: 13, flex: 1, lineHeight: 18 },
});
