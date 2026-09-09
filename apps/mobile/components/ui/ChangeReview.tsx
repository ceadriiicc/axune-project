import { Ionicons } from '@expo/vector-icons';
import type { ChangeSet } from '@axune/protocol';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';

/**
 * Review what an agent wrote, and decide.
 *
 * The decision is genuinely safe in both directions, which is the point of the
 * worktree: keeping leaves a branch, discarding deletes one, and neither
 * touches the user's working tree. That is what makes it reasonable to offer
 * this on a phone at all.
 *
 * Files are collapsed by default. A patch is long and a phone is small, so the
 * default view answers "what did it touch and how much" and the diff is there
 * when you want it.
 */
export function ChangeReview({
  changes,
  decision,
  onDecide,
}: {
  changes: ChangeSet;
  decision: 'keep' | 'discard' | null;
  onDecide: (decision: 'keep' | 'discard') => void;
}) {
  const { palette: color } = useTheme();
  const styles = useStyles();
  const [openFile, setOpenFile] = useState<string | null>(null);
  const byFile = useMemo(() => splitPatch(changes.patch), [changes.patch]);

  if (!changes.commit) {
    return (
      <View style={styles.card}>
        <Text style={styles.noChanges}>The agent did not change any files.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="git-branch-outline" size={14} color={color.codexText} />
        <Text style={styles.branch} numberOfLines={1}>
          {changes.branch}
        </Text>
      </View>

      <Text style={styles.summary}>
        {changes.files.length} file{changes.files.length === 1 ? '' : 's'}
        {'  '}
        <Text style={styles.plus}>+{changes.insertions}</Text>
        {'  '}
        <Text style={styles.minus}>−{changes.deletions}</Text>
      </Text>

      {/* The reviewer should know the work was built on older code. */}
      {changes.behindBy > 0 ? (
        <Text style={styles.stale}>
          Branched before your last {changes.behindBy} commit
          {changes.behindBy === 1 ? '' : 's'}
        </Text>
      ) : null}

      <View style={styles.files}>
        {changes.files.map((file) => {
          const open = openFile === file.path;
          return (
            <View key={file.path}>
              <Pressable
                style={styles.fileRow}
                onPress={() => setOpenFile(open ? null : file.path)}
              >
                <Ionicons
                  name={open ? 'chevron-down' : 'chevron-forward'}
                  size={13}
                  color={color.textSoft}
                />
                <Text style={[styles.status, statusStyle(file.status, styles)]}>
                  {file.status === 'created' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                </Text>
                <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                  {file.path}
                </Text>
                <Text style={styles.counts}>
                  <Text style={styles.plus}>+{file.insertions}</Text>{' '}
                  <Text style={styles.minus}>−{file.deletions}</Text>
                </Text>
              </Pressable>

              {open ? <Diff text={byFile.get(file.path) ?? ''} /> : null}
            </View>
          );
        })}
      </View>

      {decision ? (
        <View style={styles.decided}>
          <Ionicons
            name={decision === 'keep' ? 'checkmark-circle' : 'trash-outline'}
            size={15}
            color={decision === 'keep' ? color.ok : color.textSoft}
          />
          <Text style={styles.decidedText}>
            {decision === 'keep'
              ? `Kept on ${changes.branch}`
              : 'Discarded — the branch was deleted'}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable style={styles.keep} onPress={() => onDecide('keep')}>
            <Ionicons name="checkmark" size={16} color="#0f1b1c" />
            <Text style={styles.keepText}>Keep branch</Text>
          </Pressable>
          <Pressable style={styles.discard} onPress={() => onDecide('discard')}>
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Header lines git emits that tell a phone reader nothing new. */
const DIFF_NOISE =
  /^(index [0-9a-f]+\.\.|--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/;

/** A patch rendered so additions and removals are distinguishable at a glance. */
function Diff({ text }: { text: string }) {
  const styles = useStyles();
  if (!text.trim()) {
    return <Text style={styles.noDiff}>No diff available for this file.</Text>;
  }

  // Git prefixes each file's patch with a blob-hash index line and the a/ and
  // b/ paths. The filename is already in the row directly above, and blob
  // hashes mean nothing to a reader — on a phone that is three of roughly
  // twenty visible lines spent repeating the header.
  const lines = text
    .split('\n')
    .filter((line) => !DIFF_NOISE.test(line))
    .slice(0, 400);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.diffScroll}>
      <View style={styles.diff}>
        {lines.map((line, index) => (
          <Text key={index} style={[styles.diffLine, lineStyle(line, styles)]}>
            {line || ' '}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function lineStyle(line: string, styles: ReturnType<typeof useStyles>) {
  if (line.startsWith('+++') || line.startsWith('---')) return styles.diffMeta;
  if (line.startsWith('@@')) return styles.diffHunk;
  if (line.startsWith('+')) return styles.diffAdd;
  if (line.startsWith('-')) return styles.diffRemove;
  return styles.diffContext;
}

function statusStyle(status: string, styles: ReturnType<typeof useStyles>) {
  if (status === 'created') return styles.statusAdd;
  if (status === 'deleted') return styles.statusDelete;
  return styles.statusModify;
}

/**
 * Split a unified diff into per-file sections, so a file can be expanded on its
 * own rather than scrolling one long patch.
 */
function splitPatch(patch: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) sections.set(current, buffer.join('\n'));
    buffer = [];
  };

  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      flush();
      current = header[2] ?? header[1] ?? null;
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  return sections;
}

function useStyles() {
  const { palette: color } = useTheme();
  return StyleSheet.create({
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.codex,
      backgroundColor: color.codexIconBg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    branch: { color: color.codexText, fontSize: 12, fontWeight: '600', flex: 1 },
    summary: { color: color.textMuted, fontSize: 13 },
    stale: { color: color.claude, fontSize: 11.5 },
    noChanges: { color: color.textMuted, fontSize: 13 },

    files: { gap: 2 },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7 },
    status: { fontSize: 11, fontWeight: '700', width: 12 },
    statusAdd: { color: color.ok },
    statusDelete: { color: color.danger },
    statusModify: { color: color.claude },
    path: { flex: 1, color: color.text, fontSize: 12.5 },
    counts: { fontSize: 11 },
    plus: { color: color.ok, fontWeight: '600' },
    minus: { color: color.danger, fontWeight: '600' },

    diffScroll: { backgroundColor: color.panelAlt, borderRadius: radius.sm, marginBottom: 6 },
    diff: { padding: spacing.sm },
    diffLine: { fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 15 },
    diffAdd: { color: color.ok },
    diffRemove: { color: color.danger },
    diffContext: { color: color.textSoft },
    diffHunk: { color: color.codexText },
    diffMeta: { color: color.textSoft },
    noDiff: { color: color.textSoft, fontSize: 11.5, paddingBottom: 6 },

    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
    keep: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: color.codex,
      borderRadius: radius.md,
      paddingVertical: 12,
    },
    keepText: { color: color.bg, fontSize: 13, fontWeight: '700' },
    discard: { paddingHorizontal: spacing.md, paddingVertical: 11 },
    discardText: { color: color.textMuted, fontSize: 13, fontWeight: '600' },

    decided: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    decidedText: { color: color.textMuted, fontSize: 12 },
  });
}
