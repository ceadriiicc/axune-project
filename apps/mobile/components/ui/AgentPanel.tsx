import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import type { AgentTurn } from '@/lib/types';

interface Props {
  turn: AgentTurn;
  prompt: string;
}

export function AgentPanel({ turn, prompt }: Props) {
  const agent = AGENTS[turn.agentId];
  return (
    <View
      style={[
        styles.col,
        { shadowColor: agent.accent, borderColor: 'transparent' },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.name, { color: agent.accentText }]}>
          {agent.glyph} {agent.name}
        </Text>
      </View>

      <View style={[styles.bubble, styles.question]}>
        <Text style={styles.questionText}>{prompt}</Text>
      </View>

      <View style={[styles.bubble, { backgroundColor: agent.bubbleBg }]}>
        <Text style={[styles.answerText, { color: agent.bubbleText }]}>{turn.answer}</Text>
      </View>

      <View style={[styles.bubble, { backgroundColor: `${agent.accent}1f`, marginTop: 'auto' }]}>
        <Text style={[styles.followText, { color: agent.bubbleText }]}>{turn.followUp}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  col: {
    flex: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    backgroundColor: color.surface,
    gap: spacing.sm,
  },
  head: {
    marginBottom: 2,
  },
  name: {
    fontWeight: '700',
    fontSize: 14,
  },
  bubble: {
    borderRadius: 16,
    padding: spacing.sm,
  },
  question: {
    backgroundColor: '#303842',
  },
  questionText: {
    color: color.text,
    fontSize: 12.5,
    lineHeight: 18,
  },
  answerText: {
    fontSize: 12.5,
    lineHeight: 19,
  },
  followText: {
    fontSize: 12,
    lineHeight: 17,
  },
});
