import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { InsightRow } from '@/components/ui/InsightRow';
import { TopBar } from '@/components/ui/TopBar';
import { AGENTS } from '@/constants/agents';
import { color, radius, spacing } from '@/constants/theme';
import { fakeInsights } from '@/lib/fakeData';
import { useWorkspace } from '@/lib/WorkspaceContext';

export default function InsightsScreen() {
  const router = useRouter();
  const { session } = useWorkspace();
  const insights = fakeInsights(session);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <TopBar title="Insights" onBack={() => router.push('/workspace')} onMore={() => {}} />

        <View style={styles.stack}>
          <InsightRow
            glyph="✓"
            iconBg={color.codexIconBg}
            iconFg={color.codexIconText}
            title="Agreements"
            body={insights.agreements}
          />
          <InsightRow
            glyph={AGENTS.claude.glyph}
            iconBg={color.claudeIconBg}
            iconFg={color.claudeIconText}
            title="Claude adds"
            body={insights.claudeAdds}
          />
          <InsightRow
            glyph={AGENTS.codex.glyph}
            iconBg={color.codexIconBg}
            iconFg={color.codexIconText}
            title="Codex adds"
            body={insights.codexAdds}
          />
          <InsightRow
            glyph="⚑"
            iconBg={color.purpleIconBg}
            iconFg={color.purpleIconText}
            title="Recommended next step"
            body={insights.recommendation}
          />
        </View>

        <View style={styles.ctaRow}>
          <Pressable style={[styles.cta, styles.ctaClaude]}>
            <Text style={styles.ctaLabel}>{AGENTS.claude.glyph} Use Claude</Text>
          </Pressable>
          <Pressable style={[styles.cta, styles.ctaCodex]}>
            <Text style={styles.ctaLabel}>{AGENTS.codex.glyph} Use Codex</Text>
          </Pressable>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaLabel}>⟗ Combine</Text>
          </Pressable>
        </View>

        <View style={styles.banner}>
          <Text style={styles.bannerIcon}>⚖</Text>
          <Text style={styles.bannerText}>
            Axune helps you compare multiple coding agents quickly so you can choose, combine, or
            orchestrate the best approach.
          </Text>
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
  stack: {
    gap: spacing.sm,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cta: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaClaude: {
    backgroundColor: '#7b5a3d',
    borderColor: 'rgba(216,173,123,0.18)',
  },
  ctaCodex: {
    backgroundColor: '#36595d',
    borderColor: 'rgba(110,184,187,0.18)',
  },
  ctaLabel: {
    color: color.text,
    fontSize: 13,
    fontWeight: '600',
  },
  banner: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    padding: spacing.lg,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  bannerIcon: {
    fontSize: 24,
    color: color.info,
  },
  bannerText: {
    flex: 1,
    color: '#d4dce5',
    fontSize: 14,
    lineHeight: 20,
  },
});
