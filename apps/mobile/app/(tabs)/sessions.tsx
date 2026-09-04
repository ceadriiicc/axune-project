import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SessionRow } from '@/components/ui/SessionRow';
import { SettingRow } from '@/components/ui/SettingRow';
import { color, font, spacing } from '@/constants/theme';
import { SESSIONS } from '@/lib/fakeData';
import { useWorkspace } from '@/lib/WorkspaceContext';

export default function SessionsScreen() {
  const router = useRouter();
  const { loadSession } = useWorkspace();

  const [pairDefault, setPairDefault] = useState(true);
  const [syncPrompt, setSyncPrompt] = useState(true);
  const [saveSessions, setSaveSessions] = useState(true);

  const openSession = (id: string) => {
    loadSession(id);
    router.push('/workspace');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Sessions &amp; Settings</Text>

        <SectionLabel label="Saved Sessions" action="See all" />
        <View style={styles.list}>
          {SESSIONS.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onPress={() => openSession(session.id)}
              trailing={<Badge label={session.mode === 'paired' ? 'Paired' : 'Independent'} tone={session.mode === 'paired' ? 'codex' : 'gray'} />}
            />
          ))}
        </View>

        <SectionLabel label="Settings & Tools" />
        <View style={styles.list}>
          <SettingRow
            glyph="⚖"
            title="Pair mode default"
            description="Open new sessions in paired mode"
            trailing={{ kind: 'switch', value: pairDefault, onValueChange: setPairDefault }}
          />
          <SettingRow
            glyph="⇄"
            title="Sync prompt to both"
            description="Send your messages to both agents"
            trailing={{ kind: 'switch', value: syncPrompt, onValueChange: setSyncPrompt }}
          />
          <SettingRow
            glyph="☁"
            title="Save sessions"
            description="Auto-save your conversations"
            trailing={{ kind: 'switch', value: saveSessions, onValueChange: setSaveSessions }}
          />
          <SettingRow
            glyph="⇪"
            title="Export chat"
            description="Export conversations as Markdown or PDF"
            trailing={{ kind: 'chevron' }}
          />
          <SettingRow
            glyph="◐"
            title="Theme"
            description="Dark"
            trailing={{ kind: 'chevron' }}
          />
          <SettingRow
            glyph="◍"
            title="Connected accounts"
            description="Manage Claude Code and Codex connections"
            trailing={{ kind: 'chevron' }}
          />
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
  header: {
    fontSize: font.heading,
    fontWeight: '700',
    color: color.text,
    textAlign: 'center',
  },
  list: {
    gap: spacing.sm,
  },
});
