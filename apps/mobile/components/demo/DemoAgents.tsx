import { Ionicons } from '@expo/vector-icons';
import type { AgentStatus, Capability } from '@axune/protocol';
import { useTheme } from '@/lib/ThemeContext';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DemoTabBar } from './DemoTabBar';

export function DemoAgents({
  agents,
  capability,
}: {
  agents: AgentStatus[];
  capability: Capability;
}) {
  const { palette: color } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(color), [color]);
  const claude = agents.find((agent) => agent.agentId === 'claude-code');

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={styles.kicker}>YOUR TEAM</Text>
          <Text style={styles.title}>Agents</Text>
          <Text style={styles.intro}>Who is ready to work on this repository.</Text>
        </View>
        {claude ? (
          <View style={styles.profile}>
            <View style={styles.profileTop}>
              <View style={[styles.mark, { backgroundColor: color.claudeIconBg }]}>
                <Text style={[styles.markLetter, { color: color.claudeIconText }]}>C</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.name}>Claude Code</Text>
                <Text style={styles.role}>Repository agent</Text>
              </View>
              <View style={styles.available}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: claude.installed ? color.ok : color.danger },
                  ]}
                />
                <Text
                  style={[
                    styles.availableText,
                    { color: claude.installed ? color.ok : color.danger },
                  ]}
                >
                  {claude.installed ? 'Available' : 'Unavailable'}
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
              value={
                claude.authenticated === 'unknown'
                  ? 'Status unavailable'
                  : claude.authenticated === 'yes'
                    ? 'Authenticated'
                    : 'Not authenticated'
              }
              styles={styles}
            />
            <Detail
              icon="code-slash-outline"
              label="Version"
              value={claude.version ?? 'Version unavailable'}
              styles={styles}
            />
            <View style={styles.guardrail}>
              <Ionicons name="git-branch-outline" size={18} color={color.claudeText} />
              <Text style={styles.guardrailText}>
                Write runs use a separate branch and worktree. Changes are reviewed before they are
                kept.
              </Text>
            </View>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/demo/session/[id]' as never, params: { id: 'new' } })
              }
              style={({ pressed }) => [
                styles.start,
                { backgroundColor: color.text },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.startText, { color: color.panel }]}>
                Start a session with Claude
              </Text>
              <Ionicons name="arrow-forward" size={18} color={color.panel} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No agent status available</Text>
            <Text style={styles.emptyText}>Connect to a desktop to see what is ready.</Text>
          </View>
        )}
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={18} color={color.textMuted} />
          <Text style={styles.noteText}>
            This page only shows agents Axune can actually detect on your desktop.
          </Text>
        </View>
      </ScrollView>
      <DemoTabBar />
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
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}
const makeStyles = (color: ReturnType<typeof useTheme>['palette']) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    content: { padding: 22, paddingTop: 68, paddingBottom: 110, gap: 20 },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: color.text, fontSize: 31, letterSpacing: -1, fontWeight: '600', marginTop: 6 },
    intro: { color: color.textMuted, fontSize: 15, marginTop: 7 },
    profile: {
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
      borderRadius: 21,
      padding: 17,
      gap: 15,
    },
    profileTop: { flexDirection: 'row', gap: 11, alignItems: 'center' },
    mark: {
      height: 46,
      width: 46,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markLetter: { fontSize: 20, fontWeight: '800' },
    flex: { flex: 1 },
    name: { color: color.text, fontSize: 18, fontWeight: '700' },
    role: { color: color.textMuted, fontSize: 13, marginTop: 3 },
    available: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dot: { height: 7, width: 7, borderRadius: 4 },
    availableText: { fontSize: 12, fontWeight: '700' },
    divider: { height: 1, backgroundColor: color.line, marginVertical: 1 },
    detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    detailLabel: { color: color.textMuted, fontSize: 13, width: 92 },
    detailValue: {
      color: color.text,
      fontSize: 13,
      fontWeight: '600',
      flex: 1,
      textAlign: 'right',
    },
    guardrail: {
      flexDirection: 'row',
      gap: 9,
      padding: 12,
      borderRadius: 14,
      backgroundColor: color.claudeBubble,
      marginTop: 1,
    },
    guardrailText: { color: color.claudeBubbleText, fontSize: 13, lineHeight: 19, flex: 1 },
    start: {
      height: 48,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 1,
    },
    startText: { fontSize: 14, fontWeight: '700' },
    note: { flexDirection: 'row', gap: 9, paddingHorizontal: 4 },
    noteText: { color: color.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
    empty: { backgroundColor: color.panel, padding: 18, borderRadius: 19, gap: 4 },
    emptyTitle: { color: color.text, fontSize: 16, fontWeight: '700' },
    emptyText: { color: color.textMuted, fontSize: 14 },
    pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  });
