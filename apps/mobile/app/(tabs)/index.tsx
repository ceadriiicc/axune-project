import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { StatusRow } from '@/components/ui/StatusRow';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Home is where you ask. Workspace is where you watch.
 *
 * The prompt box is the primary action, so it sits above the fold rather than
 * a tab away. Suggestions appear only until there is real history — they are
 * onboarding, not permanent furniture, and once you know what to ask you will
 * type your own.
 */
const SUGGESTIONS = [
  'What changed on this branch?',
  'Summarise what this project does.',
  'Where is authentication handled?',
  'Why might the build be failing?',
];

export default function HomeScreen() {
  const router = useRouter();
  const {
    connectionState,
    project,
    agents,
    history,
    sendPrompt,
    newConversation,
  } = useWorkspace();

  const [draft, setDraft] = useState('');
  const connected = connectionState === 'connected' || connectionState === 'reconnecting';

  const ask = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    if (!connected) return router.push('/pair');
    newConversation();
    sendPrompt(text);
    setDraft('');
    router.push('/workspace');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.wordmark}>Axune</Text>
          <StatusRow
            state={connectionState}
            project={project}
            agents={agents}
            onPress={() => router.push('/pair')}
          />
        </View>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={connected ? 'Ask about your project…' : 'Pair to start asking…'}
            placeholderTextColor={color.textSoft}
            multiline
            onSubmitEditing={() => ask(draft)}
            returnKeyType="send"
            blurOnSubmit
          />
          <Pressable
            style={[styles.send, !draft.trim() && styles.sendIdle]}
            onPress={() => ask(draft)}
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={draft.trim() ? '#0f1b1c' : color.textSoft}
            />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {history.length === 0 ? (
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((suggestion) => (
                <Pressable key={suggestion} style={styles.chip} onPress={() => ask(suggestion)}>
                  <Text style={styles.chipText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            history.map((run) => (
              <Pressable
                key={run.runId}
                style={styles.runRow}
                onPress={() => router.push('/workspace')}
              >
                <View style={[styles.outcomeDot, { backgroundColor: outcomeColor(run.outcome) }]} />
                <View style={styles.flex}>
                  <Text style={styles.runPrompt} numberOfLines={2}>
                    {run.prompt || 'Untitled run'}
                  </Text>
                  {run.excerpt ? (
                    <Text style={styles.runExcerpt} numberOfLines={1}>
                      {run.excerpt}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.runTime}>{relativeTime(run.startedAt)}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function outcomeColor(outcome: string): string {
  if (outcome === 'completed') return color.ok;
  if (outcome === 'stopped') return color.textSoft;
  return color.danger;
}

function relativeTime(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  wordmark: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: color.text },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  input: {
    flex: 1,
    color: color.text,
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: color.codex,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIdle: { backgroundColor: 'rgba(255,255,255,0.06)' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  suggestions: { gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  chipText: { color: color.textMuted, fontSize: 14 },
  runRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  outcomeDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  runPrompt: { color: color.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  runExcerpt: { color: color.textMuted, fontSize: 12, marginTop: 4 },
  runTime: { color: color.textSoft, fontSize: 11, marginTop: 3 },
});
