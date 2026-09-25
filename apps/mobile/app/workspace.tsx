import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
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

import { AgentText } from '@/components/ui/AgentText';
import { ChangeReview } from '@/components/ui/ChangeReview';
import { ThreadSheet } from '@/components/ui/ThreadSheet';
import { formatDuration } from '@/components/ui/home/ActiveRun';
import { lookFor } from '@/constants/agents';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import { describeUsage } from '@/lib/usageLine';
import { useWorkspace, type LiveRun } from '@/lib/WorkspaceContext';

/**
 * The conversation with the agents working on this project.
 *
 * Laid out as a thread of turns rather than one answer, because the desktop
 * resumes the agent's own session between prompts — showing only the latest
 * exchange would display less than the agent itself remembers.
 *
 * Each turn renders a row of agent panels. Today that row has one panel; with
 * Codex it has two, and nothing here needs to change for that to work.
 */
const SUGGESTIONS = [
  'What changed on this branch?',
  'Summarise what this project does.',
  'Where is authentication handled?',
  'Why might the build be failing?',
];

export default function WorkspaceScreen() {
  const router = useRouter();
  const { palette: color } = useTheme();
  const styles = useStyles();
  const {
    connectionState,
    project,
    conversation,
    threads,
    openThread,
    live,
    capability,
    sendPrompt,
    resolveChanges,
    newConversation,
    stopRun,
  } = useWorkspace();

  const [draft, setDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * Editing is opt-in per prompt rather than a mode you can forget you are in.
   * Asking a question and accidentally authorising file changes should not be
   * possible, so this resets after every send.
   */
  const [writeMode, setWriteMode] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const connected = connectionState === 'connected' || connectionState === 'reconnecting';
  const canWrite = connected && capability === 'read-write';

  // Follow the stream as it arrives, the way a terminal would.
  const lastText = conversation[conversation.length - 1]?.text.length ?? 0;
  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [lastText, conversation.length]);

  const ask = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    if (!connected) return router.push('/pair');
    sendPrompt(text, writeMode);
    setDraft('');
    setWriteMode(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // No offset: the tab bar is covered by the keyboard rather than pushed
        // above it, so anything added here becomes a visible gap between the
        // composer and the keyboard.
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={1}>
              {/* "Workspace" was the tab this screen used to live in. There is
                  no such tab now - it is reached from Sessions and Agents - so
                  the fallback names what the screen is rather than where it
                  used to be. */}
              {project?.name ?? 'Session'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {connected ? (project?.branch ?? '') : 'Not connected'}
            </Text>
          </View>
          {/*
            Two controls, not one. Browsing earlier conversations used to be
            possible only by tapping "New", which archives what you are reading
            and starts an uncached conversation - so looking at an old thread
            cost about three times what continuing costs. Threads now has its
            own door; New is unchanged, because starting fresh was never the
            problem.

            Labelled rather than icon-only: an unlabelled icon that changes what
            you are reading is a trap.
          */}
          <View style={styles.headerActions}>
            {threads.length > 0 ? (
              <Pressable
                style={styles.headerButton}
                onPress={() => setSheetOpen(true)}
                hitSlop={8}
              >
                <Ionicons name="chatbubbles-outline" size={14} color={color.textMuted} />
                <Text style={styles.headerButtonText}>Threads</Text>
                <Text style={styles.headerButtonCount}>{threads.length}</Text>
              </Pressable>
            ) : null}
            {conversation.length > 0 ? (
              <Pressable style={styles.headerButton} onPress={newConversation} hitSlop={8}>
                <Ionicons name="add" size={15} color={color.textMuted} />
                <Text style={styles.headerButtonText}>New</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
        >
          {conversation.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {connected ? 'Ask about this project' : 'Pair to start'}
              </Text>
              <Text style={styles.emptyBody}>
                {connected
                  ? canWrite
                    ? 'Claude Code reads the repository on your machine and answers here. Turn on editing below and changes land on a branch you review.'
                    : 'Claude Code reads the repository on your machine and answers here.'
                  : 'Scan the code shown by Axune Desktop to connect this phone.'}
              </Text>

              {threads.length > 0 ? (
                <View style={styles.previous}>
                  <Text style={styles.previousLabel}>Previous conversations</Text>
                  {threads.slice(0, 4).map((thread) => (
                    <Pressable
                      key={thread.id}
                      style={styles.previousRow}
                      onPress={() => openThread(thread.id)}
                    >
                      <Ionicons name="chatbubble-outline" size={14} color={color.textSoft} />
                      <Text style={styles.previousText} numberOfLines={1}>
                        {thread.runs[0]?.prompt ?? 'Conversation'}
                      </Text>
                      <Text style={styles.previousCount}>{thread.runs.length}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {connected ? (
                <View style={styles.suggestions}>
                  {SUGGESTIONS.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      style={styles.suggestion}
                      onPress={() => ask(suggestion)}
                    >
                      <Text style={styles.suggestionText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Pressable style={styles.pairButton} onPress={() => router.push('/pair')}>
                  <Ionicons name="qr-code-outline" size={16} color="#1e1b18" />
                  <Text style={styles.pairText}>Scan QR code</Text>
                </Pressable>
              )}
            </View>
          ) : (
            conversation.map((run, index) => (
              <Turn
                key={run.runId}
                run={run}
                sincePrevious={gapBefore(conversation, index)}
                onStop={stopRun}
                onDecide={(decision) => resolveChanges(run.runId, decision)}
              />
            ))
          )}
        </ScrollView>

        {capability === 'read-write' ? (
          <Pressable
            style={[styles.modeRow, writeMode && styles.modeRowOn, !connected && styles.modeRowOff]}
            onPress={() => connected && setWriteMode((on) => !on)}
            disabled={!connected}
          >
            <Ionicons
              name={writeMode ? 'create' : 'eye-outline'}
              size={14}
              color={writeMode ? color.claudeText : color.textSoft}
            />
            <Text style={[styles.modeText, writeMode && styles.modeTextOn]}>
              {!connected
                ? 'Editing available once connected'
                : writeMode
                  ? 'Editing — changes land on a branch you review'
                  : 'Read-only — tap to let this prompt edit files'}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={live ? 'Claude Code is working…' : 'Ask about your project…'}
            placeholderTextColor={color.textSoft}
            multiline
            editable={connected}
          />
          <Pressable
            style={[styles.send, !draft.trim() && styles.sendIdle]}
            onPress={() => ask(draft)}
          >
            <Ionicons name="arrow-up" size={18} color={draft.trim() ? '#0f1b1c' : color.textSoft} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ThreadSheet
        visible={sheetOpen}
        threads={threads}
        conversation={conversation}
        onOpen={(id) => {
          openThread(id);
          setSheetOpen(false);
        }}
        onNew={() => {
          newConversation();
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

/**
 * One exchange: what was asked, and what each agent said back.
 *
 * The panels sit in a row so a second agent needs no layout change — with two,
 * each takes half the width and the comparison is side by side.
 */
function Turn({
  run,
  sincePrevious,
  onStop,
  onDecide,
}: {
  run: LiveRun;
  /**
   * Milliseconds since the previous turn of this conversation, or null for the
   * first. Only ever used to explain low cache reuse, never on its own - a run
   * kept warm by a different thread reuses plenty, so the reuse signal already
   * rules out the case this gap would get wrong.
   */
  sincePrevious: number | null;
  onStop: () => void;
  onDecide: (decision: 'keep' | 'discard') => void;
}) {
  const { palette: color } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.turn}>
      <View style={styles.promptRow}>
        {run.write ? (
          <View style={styles.writeBadge}>
            <Ionicons name="create-outline" size={11} color={color.claudeText} />
            <Text style={styles.writeBadgeText}>edit</Text>
          </View>
        ) : null}
        <View style={styles.promptBubble}>
          <Text style={styles.promptText}>{run.prompt}</Text>
        </View>
      </View>

      <View style={styles.panels}>
        <AgentPanel run={run} sincePrevious={sincePrevious} onStop={onStop} />
      </View>

      {run.changes ? (
        <ChangeReview changes={run.changes} decision={run.decision} onDecide={onDecide} />
      ) : null}
    </View>
  );
}

function AgentPanel({
  run,
  sincePrevious,
  onStop,
}: {
  run: LiveRun;
  sincePrevious: number | null;
  onStop: () => void;
}) {
  const { palette: color } = useTheme();
  const styles = useStyles();
  const agent = lookFor(run.agentId);
  const working = run.status === 'working';
  const lastTool = [...run.activity].reverse().find((line) => line.ok === null);
  // Capped: a run that is being refused repeatedly should say so once or twice,
  // not turn the panel into a list.
  const refused = run.activity.filter((line) => line.ok === false).slice(-3);

  return (
    <View style={[styles.panel, { borderColor: `${agent.accent}33` }]}>
      <View style={styles.panelHead}>
        <Text style={[styles.panelAgent, { color: agent.accentText }]}>
          {agent.glyph} {agent.name}
        </Text>
        <View style={styles.flex} />
        <Text style={styles.panelStatus}>{statusLabel(run)}</Text>
      </View>

      {/*
        What it consumed. The provider has always reported this and Axune threw
        it away, so there was no way to tell a cheap question from one that
        spent a chunk of the day's allowance - and no way to explain a limit
        when it arrived. Absent rather than zero when unreported.
      */}
      {run.usage ? <Usage run={run} sincePrevious={sincePrevious} /> : null}

      {working && lastTool ? (
        <Text style={styles.doing} numberOfLines={1}>
          {lastTool.label}
          {lastTool.detail ? ` · ${lastTool.detail}` : ''}
        </Text>
      ) : null}

      {/*
        What the gate refused, and why. These survive the run finishing on
        purpose: a refusal is often the most useful thing that happened - it is
        how you learn the run was read-only, or that a command was not on the
        allow-list - and it used to vanish the moment the agent moved on.
      */}
      {refused.length > 0 ? (
        <View style={styles.refusals}>
          {refused.map((line) => (
            <View key={line.id} style={styles.refusalRow}>
              <Ionicons name="close-circle-outline" size={13} color={color.danger} />
              <Text style={styles.refusalText}>
                {line.label}
                {line.detail ? ` — ${line.detail}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/*
        The reason, which the desktop has always sent and this card has always
        thrown away — a failed run read as the single word "failed" with no way
        to find out why, on the phone or anywhere else.
      */}
      {run.error ? <Text style={styles.failure}>{run.error}</Text> : null}

      {/*
        Above the reply, not below it, because it changes how the text beneath
        should be read. The desktop keeps a bounded number of events per run, so
        a long run reconnected to late can only be replayed in part - and a
        reply missing its beginning is indistinguishable from a whole one unless
        something says so.
      */}
      {run.incomplete ? (
        <View style={styles.incompleteRow}>
          <Ionicons name="cut-outline" size={12} color={color.textSoft} />
          <Text style={styles.incompleteText}>
            The start of this reply was no longer on your desktop when this phone reconnected
          </Text>
        </View>
      ) : null}

      {run.text ? (
        <View style={[styles.answer, { backgroundColor: agent.bubbleBg }]}>
          <AgentText text={run.text} style={{ color: agent.bubbleText }} />
        </View>
      ) : working ? (
        <Text style={styles.thinking}>Working…</Text>
      ) : null}

      {working ? (
        <Pressable style={styles.stop} onPress={onStop} hitSlop={6}>
          <Ionicons name="stop-circle-outline" size={15} color={color.danger} />
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function statusLabel(run: LiveRun): string {
  if (run.status === 'working') {
    return run.startedAt ? formatDuration(Date.now() - run.startedAt) : 'working';
  }
  if (run.status === 'finished') return 'completed';
  if (run.status === 'stopped') return 'stopped';
  return 'failed';
}

function useStyles() {
  const { palette: color } = useTheme();
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    flex: { flex: 1 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    title: { color: color.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.45 },
    subtitle: { color: color.textSoft, fontSize: 12, marginTop: 3 },
    headerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
    },
    headerButtonText: { color: color.textMuted, fontSize: 12, fontWeight: '600' },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerButtonCount: { color: color.textSoft, fontSize: 11, fontVariant: ['tabular-nums'] },
    previous: { marginTop: spacing.lg, gap: 4 },
    previousLabel: {
      color: color.textSoft,
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    previousRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 10,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
    },
    previousText: { flex: 1, color: color.textMuted, fontSize: 13 },
    previousCount: { color: color.textSoft, fontSize: 11 },

    thread: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },

    empty: { paddingTop: spacing.xl * 2, gap: spacing.sm },
    emptyTitle: {
      color: color.text,
      fontSize: 24,
      lineHeight: 30,
      fontWeight: '700',
      letterSpacing: -0.6,
    },
    emptyBody: { color: color.textMuted, fontSize: 14, lineHeight: 21, maxWidth: 350 },
    suggestions: { gap: spacing.sm, marginTop: spacing.md },
    suggestion: {
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.panel,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    suggestionText: { color: color.textMuted, fontSize: 14 },
    pairButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: color.claude,
      borderRadius: radius.md,
      paddingVertical: 13,
      marginTop: spacing.md,
    },
    pairText: { color: '#1e1b18', fontSize: 14, fontWeight: '700' },

    turn: { gap: spacing.sm },
    promptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
    writeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(216,173,123,0.35)',
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    writeBadgeText: { color: color.claudeText, fontSize: 10, fontWeight: '600' },
    modeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginHorizontal: spacing.lg,
      marginBottom: 6,
      paddingVertical: 8,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
    },
    modeRowOff: { opacity: 0.45 },
    modeRowOn: {
      borderColor: 'rgba(216,173,123,0.4)',
      backgroundColor: 'rgba(216,173,123,0.08)',
    },
    modeText: { color: color.textSoft, fontSize: 11.5, flex: 1 },
    modeTextOn: { color: color.claudeText },
    promptBubble: {
      alignSelf: 'flex-end',
      maxWidth: '88%',
      backgroundColor: '#303842',
      borderRadius: radius.md,
      paddingVertical: 10,
      paddingHorizontal: spacing.md,
    },
    promptText: { color: color.text, fontSize: 14, lineHeight: 20 },

    panels: { flexDirection: 'row', gap: spacing.sm },
    panel: {
      flex: 1,
      borderRadius: radius.md,
      borderWidth: 1,
      backgroundColor: color.panel,
      padding: spacing.sm + 2,
      gap: spacing.sm,
    },
    panelHead: { flexDirection: 'row', alignItems: 'center' },
    panelAgent: { fontSize: 13, fontWeight: '700' },
    panelStatus: { color: color.textSoft, fontSize: 11, fontVariant: ['tabular-nums'] },
    doing: { color: color.claudeText, fontSize: 11.5 },
    // Readable rather than a warning stripe: this is usually something the
    // person can act on ("not a git repository", "read-only run"), so it earns
    // body-text size instead of fine print.
    failure: { color: color.danger, fontSize: 13, lineHeight: 18 },
    usageBlock: { gap: 3 },
    usage: { color: color.textSoft, fontSize: 11, fontVariant: ['tabular-nums'] },
    usageIdleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    usageIdle: { color: color.claudeText, fontSize: 11, flex: 1 },
    refusals: { gap: 4 },
    refusalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    refusalText: { color: color.textMuted, fontSize: 12, lineHeight: 16, flex: 1 },
    thinking: { color: color.textSoft, fontSize: 13, fontStyle: 'italic' },
    incompleteRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    incompleteText: { color: color.textSoft, fontSize: 11, flex: 1, fontStyle: 'italic' },
    answer: { borderRadius: radius.sm, padding: spacing.sm },
    stop: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    stopText: { color: color.danger, fontSize: 12, fontWeight: '600' },

    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.panel,
    },
    input: {
      flex: 1,
      color: color.text,
      fontSize: 15,
      lineHeight: 21,
      maxHeight: 120,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    // 44pt, not 38: this is the control every prompt goes through, and it was
    // under the minimum touch target.
    send: {
      width: 44,
      height: 44,
      borderRadius: radius.sm,
      // Was color.codex - the Codex brand colour, on the send button of a
      // screen that runs Claude Code, for an agent that is not even supported.
      // The same mistake as dressing the desktop's icon in Claude's brown.
      backgroundColor: color.claude,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Fixed rather than white-on-any-theme: this is the disabled state, and a
    // hardcoded white wash disappears entirely on the light end of the slider.
    sendIdle: { backgroundColor: color.panelAlt },
  });
}

/**
 * One line describing what a run consumed.
 *
 * Tokens first, because that is what an allowance is measured in. The cost is
 * second and explicitly labelled an equivalent: nothing here is billed - the
 * run happens on a subscription already paid for - and showing a dollar figure
 * without saying so would be a lie about how the product works.
 */
/**
 * How long the conversation sat idle before this turn, or null when that is not
 * knowable - the first turn, or a run restored from disk without timings. Null
 * is not treated as "no gap": an unknown gap must not silently suppress an
 * explanation, and the reuse signal is what stops it being claimed wrongly.
 */
function gapBefore(conversation: LiveRun[], index: number): number | null {
  if (index === 0) return null;
  const previous = conversation[index - 1];
  const startedAt = conversation[index]?.startedAt;
  if (!previous?.lastEventAt || !startedAt) return null;
  return startedAt - previous.lastEventAt;
}

/**
 * What this turn consumed, and - only when it can be said honestly - why.
 *
 * The counts alone answer "was that expensive". The second line answers the
 * question that follows, which is the one worth acting on: a turn that reused
 * nothing after a long gap cost several times what the same question costs
 * inside a live conversation. Withheld whenever either signal is missing,
 * because a confident wrong explanation is worse than none.
 */
function Usage({ run, sincePrevious }: { run: LiveRun; sincePrevious: number | null }) {
  const { palette: color } = useTheme();
  const styles = useStyles();
  if (!run.usage) return null;
  const line = describeUsage(run.usage, sincePrevious);

  return (
    <View style={styles.usageBlock}>
      <Text style={styles.usage}>{line.text}</Text>
      {line.idle ? (
        <View style={styles.usageIdleRow}>
          <Ionicons name="snow-outline" size={11} color={color.claudeText} />
          <Text style={styles.usageIdle}>
            First run in a while — continuing a conversation re-sends far less
          </Text>
        </View>
      ) : null}
    </View>
  );
}
