import { BRAND } from '@axune/shared';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/ui/SectionLabel';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SessionRow } from '@/components/ui/SessionRow';
import { color, font, radius, spacing } from '@/constants/theme';
import { SESSIONS, SUGGESTED_PROMPTS } from '@/lib/fakeData';
import { useWorkspace } from '@/lib/WorkspaceContext';

export default function HomeScreen() {
  const router = useRouter();
  const { loadSession, sendPrompt, setPaired } = useWorkspace();
  const [modeTab, setModeTab] = useState<'paired' | 'independent'>('paired');

  const openSession = (id: string) => {
    loadSession(id);
    router.push('/workspace');
  };

  const openPrompt = (text: string) => {
    setPaired(modeTab === 'paired');
    sendPrompt(text);
    router.push('/workspace');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{BRAND.name}</Text>
        <Text style={styles.subtitle}>{BRAND.tagline}</Text>

        <SegmentedControl
          value={modeTab}
          onChange={(v) => setModeTab(v as 'paired' | 'independent')}
          options={[
            { key: 'paired', label: 'Paired', glyph: '👥' },
            { key: 'independent', label: 'Independent', glyph: '👤' },
          ]}
        />

        <SectionLabel label="Recent Sessions" action="See all" onPressAction={() => router.push('/sessions')} />
        <View style={styles.list}>
          {SESSIONS.slice(0, 3).map((session) => (
            <SessionRow key={session.id} session={session} onPress={() => openSession(session.id)} />
          ))}
        </View>

        <SectionLabel label="Suggested Prompts" />
        <View style={styles.chips}>
          {SUGGESTED_PROMPTS.slice(0, 4).map((prompt) => (
            <Pressable key={prompt.id} style={styles.chip} onPress={() => openPrompt(prompt.text)}>
              <Text style={styles.chipIcon}>{prompt.glyph}</Text>
              <Text style={styles.chipLabel}>{prompt.label}</Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.chip, styles.chipWide]}
            onPress={() => openPrompt(SUGGESTED_PROMPTS[4].text)}
          >
            <Text style={styles.chipIcon}>{SUGGESTED_PROMPTS[4].glyph}</Text>
            <Text style={styles.chipLabel}>{SUGGESTED_PROMPTS[4].label}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: color.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  title: {
    fontSize: font.title,
    fontWeight: '800',
    letterSpacing: -1,
    color: color.text,
  },
  subtitle: {
    marginTop: 6,
    color: color.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    width: '48%',
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chipWide: {
    width: '100%',
    justifyContent: 'center',
  },
  chipIcon: {
    color: color.claude,
    fontSize: 15,
  },
  chipLabel: {
    color: '#f1f4f8',
    fontSize: 14,
    flexShrink: 1,
  },
});
