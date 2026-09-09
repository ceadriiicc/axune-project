import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';

/**
 * Renders the small slice of Markdown that coding agents actually emit.
 *
 * A full Markdown library is the wrong trade here: it is a large dependency for
 * a phone app that needs bold, inline code, fenced code, bullets and headings —
 * and nothing else. Anything unrecognised falls through as plain text, which is
 * the correct failure mode: the reader sees the words, never the syntax.
 */
export function AgentText({ text, style }: { text: string; style?: TextStyle }) {
  const styles = useStyles();
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => {
        if (block.kind === 'code') {
          return (
            <View key={index} style={styles.codeBlock}>
              <Text style={styles.codeText}>{block.text}</Text>
            </View>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={[styles.bulletDot, style]}>•</Text>
              <Text style={[styles.paragraph, style, styles.bulletText]}>
                {renderInline(block.text, styles)}
              </Text>
            </View>
          );
        }
        if (block.kind === 'heading') {
          return (
            <Text key={index} style={[styles.heading, style]}>
              {renderInline(block.text, styles)}
            </Text>
          );
        }
        return (
          <Text key={index} style={[styles.paragraph, style]}>
            {renderInline(block.text, styles)}
          </Text>
        );
      })}
    </View>
  );
}

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'code'; text: string };

function parseBlocks(input: string): Block[] {
  const blocks: Block[] = [];
  const lines = input.split('\n');
  let paragraph: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (code) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        flushParagraph();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: trimmed.replace(/^#{1,6}\s/, '') });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: trimmed.replace(/^([-*]|\d+\.)\s+/, '') });
      continue;
    }

    paragraph.push(trimmed);
  }

  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  flushParagraph();

  return blocks;
}

/** Handles **bold**, *italic* and `inline code` in a single pass. */
function renderInline(text: string, styles: ReturnType<typeof useStyles>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];

    if (token.startsWith('**')) {
      nodes.push(
        <Text key={key++} style={styles.bold}>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <Text key={key++} style={styles.inlineCode}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      nodes.push(
        <Text key={key++} style={styles.italic}>
          {token.slice(1, -1)}
        </Text>,
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function useStyles() {
  const { palette: color } = useTheme();
  return StyleSheet.create({
    stack: { gap: spacing.sm },
    paragraph: { fontSize: 13, lineHeight: 20, color: color.text },
    heading: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: color.text },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    inlineCode: {
      fontFamily: 'Menlo',
      fontSize: 12,
      color: color.claudeText,
    },
    bulletRow: { flexDirection: 'row', gap: 8 },
    bulletDot: { fontSize: 13, lineHeight: 20, color: color.textSoft },
    bulletText: { flex: 1 },
    codeBlock: {
      backgroundColor: 'rgba(0,0,0,0.28)',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
      padding: spacing.sm,
    },
    codeText: { fontFamily: 'Menlo', fontSize: 11.5, lineHeight: 17, color: color.textMuted },
  });
}
