import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { lookFor } from '@/constants/agents';
import { type Palette, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Who can work on this repository, and what they are allowed to do.
 *
 * This replaces the Insights tab and keeps its point rather than discarding it.
 * Insights existed to hold a place for comparing two agents - the thing that
 * makes Axune more than a remote terminal - and to show *nothing invented*
 * while only one agent exists. A whole tab saying "not yet possible" spends a
 * quarter of the navigation on something that cannot act, so the promise moves
 * here, to the screen that is about agents anyway, and comparison earns a tab
 * back when there is a second agent to compare.
 *
 * Nothing on this page is assumed. Every agent shown was detected on the
 * desktop, and "unknown" authentication is printed as unknown, because Claude
 * Code has no way to be asked whether it is signed in.
 */
export default function AgentsScreen() {
  const router = useRouter();
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  const { agents, capability, connectionState } = useWorkspace();
  const connected = connectionState === 'connected' || connectionState === 'reconnecting';
  const installed = agents.filter((agent) => agent.installed);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>YOUR TEAM</Text>
        <Text style={styles.title}>Agents</Text>
        <Text style={styles.subtitle}>Who is ready to work on this repository.</Text>

        {!connected ? (
          <View style={styles.notice}>
            <Ionicons name="cloud-offline-outline" size={19} color={color.textMuted} />
            <Text style={styles.noticeText}>
              Not connected, so this list is from the last time the desktop answered.
            </Text>
          </View>
        ) : null}

        {agents.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No agents detected</Text>
            <Text style={styles.cardBody}>
              Axune runs coding agents that are already installed on your desktop. None were found.
            </Text>
          </View>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agentId={agent.agentId}
              installed={agent.installed}
              version={agent.version}
              authenticated={agent.authenticated}
              capability={capability}
              onStart={() => router.push('/workspace')}
              styles={styles}
            />
          ))
        )}

        {/* Insights' reason for existing, kept. */}
        <View style={styles.compare}>
          <Ionicons name="git-compare-outline" size={19} color={color.textSoft} />
          <View style={styles.flex}>
            <Text style={styles.compareTitle}>
              {installed.length >= 2 ? 'Comparison is available' : 'Comparison needs a second agent'}
            </Text>
            <Text style={styles.compareBody}>
              {installed.length >= 2
                ? 'Send one prompt to two agents and their answers can be compared.'
                : 'Sending one prompt to two agents and comparing their answers is the point of Axune, and it starts when a second agent is installed.'}
            </Text>
          </View>
        </View>

        <View style={styles.footnote}>
          <Ionicons name="information-circle-outline" size={16} color={color.textSoft} />
          <Text style={styles.footnoteText}>
            This page only shows agents Axune can actually detect on your desktop.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AgentCard({
  agentId,
  installed,
  version,
  authenticated,
  capability,
  onStart,
  styles,
}: {
  agentId: string;
  installed: boolean;
  version: string | null;
  authenticated: 'yes' | 'no' | 'unknown';
  capability: string;
  onStart: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  const brand = lookFor(agentId);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: color.claudeIconBg }]}>
          <Text style={[styles.avatarText, { color: color.claudeIconText }]}>
            {brand.name.slice(0, 1)}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.agentName}>{brand.name}</Text>
          <Text style={styles.agentRole}>Repository agent</Text>
        </View>
        <View style={styles.status}>
          <View
            style={[styles.dot, { backgroundColor: installed ? color.ok : color.textSoft }]}
          />
          <Text style={[styles.statusText, { color: installed ? color.ok : color.textSoft }]}>
            {installed ? 'Available' : 'Not installed'}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Detail
        icon="shield-checkmark-outline"
        label="Access"
        value={capability === 'read-write' ? 'Read and write, per prompt' : 'Read-only'}
        styles={styles}
      />
      <Detail
        icon="key-outline"
        label="Authentication"
        // 'unknown' is printed rather than guessed: Claude Code offers no way
        // to ask whether it is signed in, and inventing a green tick here would
        // be the most misleading thing on the page.
        value={
          authenticated === 'yes'
            ? 'Signed in'
            : authenticated === 'no'
              ? 'Not signed in'
              : 'Status unavailable'
        }
        styles={styles}
      />
      <Detail icon="code-slash-outline" label="Version" value={version ?? '—'} styles={styles} />

      {installed ? (
        <>
          <View style={styles.writeNote}>
            <Ionicons name="git-branch-outline" size={17} color={color.claudeText} />
            <Text style={styles.writeNoteText}>
              Write runs use a separate branch and worktree. Changes are reviewed before they are
              kept.
            </Text>
          </View>
          <Pressable style={[styles.start, { backgroundColor: color.text }]} onPress={onStart}>
            <Text style={[styles.startText, { color: color.panel }]}>
              Start a session with {brand.name}
            </Text>
            <Ionicons name="arrow-forward" size={17} color={color.panel} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function Detail({
  icon,
  label,
  value,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  return (
    <View style={styles.detail}>
      <Ionicons name={icon} size={18} color={color.textMuted} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
    flex: { flex: 1 },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: color.text, fontSize: 31, letterSpacing: -1, fontWeight: '600', marginTop: 6 },
    subtitle: { color: color.textMuted, fontSize: 15, lineHeight: 21, marginTop: 6 },

    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
    },
    noticeText: { color: color.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },

    card: {
      marginTop: spacing.md,
      backgroundColor: color.panel,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
      padding: spacing.md,
    },
    cardTitle: { color: color.text, fontSize: 17, fontWeight: '700' },
    cardBody: { color: color.textMuted, fontSize: 14, lineHeight: 20, marginTop: 6 },

    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontSize: 18, fontWeight: '800' },
    agentName: { color: color.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
    agentRole: { color: color.textMuted, fontSize: 13, marginTop: 1 },
    status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: 13, fontWeight: '700' },

    divider: { height: 1, backgroundColor: color.line, marginVertical: spacing.md },
    detail: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
    detailLabel: { color: color.text, fontSize: 14, flex: 1 },
    detailValue: { color: color.text, fontSize: 14, fontWeight: '700', maxWidth: '55%' },

    writeNote: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'flex-start',
      backgroundColor: color.claudeBubble,
      borderRadius: radius.lg,
      padding: spacing.sm + 2,
      marginTop: spacing.sm,
    },
    writeNoteText: { color: color.claudeBubbleText, fontSize: 13, lineHeight: 19, flex: 1 },
    start: {
      height: 47,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: spacing.md,
    },
    startText: { fontSize: 14, fontWeight: '700' },

    compare: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'flex-start',
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
    },
    compareTitle: { color: color.text, fontSize: 15, fontWeight: '700' },
    compareBody: { color: color.textMuted, fontSize: 13, lineHeight: 19, marginTop: 3 },

    footnote: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
      marginTop: spacing.lg,
      paddingHorizontal: 2,
    },
    footnoteText: { color: color.textSoft, fontSize: 12.5, lineHeight: 18, flex: 1 },
  });
