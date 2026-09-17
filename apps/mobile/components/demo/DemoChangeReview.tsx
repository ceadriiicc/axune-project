import { Ionicons } from '@expo/vector-icons';
import type { ChangeSet } from '@axune/protocol';
import { useDemoTheme } from './DemoAppearance';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function DemoChangeReview({ result }: { result: ChangeSet }) {
  const { palette: color } = useDemoTheme();
  const router = useRouter();
  const [decision, setDecision] = useState<'keep' | 'discard' | null>(null);
  const styles = useMemo(() => makeStyles(color), [color]);
  return (
    <View style={styles.page}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} style={styles.navButton}>
          <Ionicons name="chevron-back" size={23} color={color.text} />
        </Pressable>
        <View>
          <Text style={styles.navTitle}>Review changes</Text>
          <Text style={styles.navSub}>Write run finished</Text>
        </View>
        <View style={styles.navButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {decision ? (
          <View
            style={[
              styles.resolved,
              { backgroundColor: decision === 'keep' ? color.claudeBubble : color.panelAlt },
            ]}
          >
            <Ionicons
              name={decision === 'keep' ? 'checkmark-circle-outline' : 'trash-outline'}
              size={21}
              color={decision === 'keep' ? color.ok : color.textMuted}
            />
            <View style={styles.flex}>
              <Text style={styles.resolvedTitle}>
                {decision === 'keep' ? 'Changes kept' : 'Changes discarded'}
              </Text>
              <Text style={styles.resolvedText}>
                {decision === 'keep'
                  ? 'The agent branch remains available in Branches.'
                  : 'The agent branch would be removed.'}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.kicker}>CHANGES READY</Text>
              <Text style={styles.branch}>{result.branch}</Text>
              <View style={styles.counts}>
                <Text style={[styles.additions, { color: color.ok }]}>+{result.insertions}</Text>
                <Text style={[styles.deletions, { color: color.danger }]}>−{result.deletions}</Text>
                <Text style={styles.fileCount}>{result.files.length} files</Text>
              </View>
            </View>
            {result.behindBy > 0 && (
              <View style={styles.warning}>
                <Ionicons name="information-circle-outline" size={18} color={color.info} />
                <Text style={styles.warningText}>
                  Your base branch gained {result.behindBy} commit while this run was working.
                  Review before keeping.
                </Text>
              </View>
            )}
          </>
        )}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Changed files</Text>
          <View style={styles.card}>
            {result.files.map((file) => (
              <View key={file.path} style={styles.file}>
                <View
                  style={[
                    styles.fileIcon,
                    { backgroundColor: file.status === 'created' ? color.ok : color.panelAlt },
                  ]}
                >
                  <Ionicons
                    name={file.status === 'created' ? 'add' : 'pencil-outline'}
                    size={15}
                    color={file.status === 'created' ? color.panel : color.textMuted}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.filePath}>{file.path}</Text>
                  <Text style={styles.fileMeta}>
                    +{file.insertions} · −{file.deletions}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patch preview</Text>
          <View style={styles.patch}>
            {result.patch.split('\n').map((line, index) => (
              <Text
                key={`${index}-${line}`}
                style={[
                  styles.patchLine,
                  line.startsWith('+') && { color: color.ok },
                  line.startsWith('-') && { color: color.danger },
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>
      </ScrollView>
      {!decision && (
        <View style={styles.actions}>
          <Pressable onPress={() => setDecision('discard')} style={styles.discard}>
            <Text style={[styles.discardLabel, { color: color.danger }]}>Discard</Text>
          </Pressable>
          <Pressable
            onPress={() => setDecision('keep')}
            style={[styles.keep, { backgroundColor: color.text }]}
          >
            <Text style={[styles.keepLabel, { color: color.panel }]}>Keep changes</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
const makeStyles = (color: ReturnType<typeof useDemoTheme>['palette']) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    nav: {
      paddingTop: 57,
      paddingHorizontal: 18,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: color.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    navButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    navTitle: { color: color.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    navSub: { color: color.textMuted, fontSize: 11, textAlign: 'center', marginTop: 2 },
    content: { padding: 22, paddingBottom: 108, gap: 18 },
    summary: { backgroundColor: color.claudeBubble, borderRadius: 19, padding: 17, gap: 8 },
    kicker: { color: color.claudeText, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
    branch: { color: color.claudeBubbleText, fontSize: 16, fontWeight: '700' },
    counts: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 2 },
    additions: { fontSize: 14, fontWeight: '700' },
    deletions: { fontSize: 14, fontWeight: '700' },
    fileCount: { color: color.claudeText, fontSize: 13 },
    warning: {
      flexDirection: 'row',
      gap: 9,
      borderRadius: 14,
      padding: 13,
      backgroundColor: color.panelAlt,
    },
    warningText: { color: color.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
    section: { gap: 9 },
    sectionTitle: {
      color: color.textMuted,
      fontSize: 12,
      letterSpacing: 0.5,
      fontWeight: '700',
      textTransform: 'uppercase',
      paddingHorizontal: 3,
    },
    card: {
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
      borderRadius: 17,
      overflow: 'hidden',
    },
    file: {
      flexDirection: 'row',
      gap: 10,
      padding: 14,
      borderBottomWidth: 1,
      borderBottomColor: color.line,
    },
    fileIcon: {
      width: 29,
      height: 29,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flex: { flex: 1 },
    filePath: { color: color.text, fontSize: 13, fontWeight: '600' },
    fileMeta: { color: color.textMuted, fontSize: 12, marginTop: 3 },
    patch: { backgroundColor: color.panelAlt, borderRadius: 17, padding: 15, gap: 4 },
    patchLine: { color: color.textMuted, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
    actions: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 24,
      backgroundColor: color.bg,
      borderTopWidth: 1,
      borderColor: color.line,
      flexDirection: 'row',
      gap: 10,
    },
    discard: {
      height: 47,
      paddingHorizontal: 20,
      borderWidth: 1,
      borderColor: color.lineStrong,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discardLabel: { fontSize: 14, fontWeight: '700' },
    keep: { height: 47, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flex: 1 },
    keepLabel: { fontSize: 14, fontWeight: '700' },
    resolved: {
      flexDirection: 'row',
      gap: 10,
      borderRadius: 17,
      padding: 15,
      alignItems: 'flex-start',
    },
    resolvedTitle: { color: color.text, fontSize: 15, fontWeight: '700' },
    resolvedText: { color: color.textMuted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  });
