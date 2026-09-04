import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AgentPanel } from '@/components/ui/AgentPanel';
import { Composer } from '@/components/ui/Composer';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { TopBar } from '@/components/ui/TopBar';
import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

export default function WorkspaceScreen() {
  const router = useRouter();
  const { session, paired, setPaired, sendPrompt } = useWorkspace();

  const visibleTurns = paired ? session.turns : session.turns.slice(0, 1);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TopBar
            eyebrow={`${session.project} • ${session.branch}`}
            title={session.title}
            onBack={() => router.push('/')}
            onMore={() => {}}
          />

          <ToggleRow label="Paired mode" value={paired} onValueChange={setPaired} />

          <View style={styles.cols}>
            {visibleTurns.map((turn) => (
              <AgentPanel key={turn.agentId} turn={turn} prompt={session.prompt} />
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => router.push('/insights')}>
              <Ionicons name="git-compare-outline" size={16} color={color.text} />
              <Text style={styles.actionLabel}>Compare</Text>
            </Pressable>
            <Pressable style={styles.action}>
              <Ionicons name="copy-outline" size={16} color={color.text} />
              <Text style={styles.actionLabel}>Copy both</Text>
            </Pressable>
          </View>

          <View style={styles.agentStatus}>
            {session.turns.map((turn) => {
              const agent = AGENTS[turn.agentId];
              const active = visibleTurns.some((t) => t.agentId === turn.agentId);
              return (
                <View key={turn.agentId} style={styles.statusPill}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: active ? agent.accent : color.textSoft },
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {agent.name} · {active ? 'ready' : 'idle'}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.composerWrap}>
          <Composer
            placeholder={paired ? 'Ask both coding agents...' : `Ask ${AGENTS.claude.name}...`}
            initialValue={session.prompt}
            onSend={sendPrompt}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: color.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  cols: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'stretch',
    minHeight: 380,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  action: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionLabel: {
    color: color.text,
    fontSize: 15,
    fontWeight: '600',
  },
  agentStatus: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  statusText: {
    color: color.textMuted,
    fontSize: 12,
  },
  composerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: color.bg,
  },
});
