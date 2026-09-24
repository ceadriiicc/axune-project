import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { type Palette, radius, spacing } from '@/constants/theme';
import { applyCaptureGuard, loadCaptureGuard, saveCaptureGuard } from '@/lib/captureGuard';
import { useTheme } from '@/lib/ThemeContext';
import { approxCost, compact } from '@/lib/usageLine';
import type { UsageDay } from '@axune/protocol';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Everything about this phone's relationship with the desktop.
 *
 * These controls used to live at the bottom of the Sessions tab, below a run
 * history, which is where settings end up when no screen owns them. Sessions is
 * about conversations; this is about the machine, what agents may do to it, and
 * how to stop.
 *
 * Nothing here is invented. Every value is either read from the desktop or is a
 * control that does something - the rule the old Sessions screen already stated
 * about the mockup's fake toggles, applied to the screen that replaced them.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const {
    palette: color,
    draftDarkness,
    appliedDarkness,
    setDraftDarkness,
    applyAppearance,
  } = useTheme();
  const styles = makeStyles(color);
  const { machine, project, capability, connectionState, disconnect, usageDay } = useWorkspace();

  // Read once rather than held in context: PrivacyShield applies it at launch
  // and this applies it on change, so the two never need to agree through
  // shared state. Starts guarded so the switch never flickers off-then-on.
  const [captureGuard, setCaptureGuard] = useState(true);
  useEffect(() => {
    void loadCaptureGuard().then(setCaptureGuard);
  }, []);

  const toggleCaptureGuard = (on: boolean) => {
    setCaptureGuard(on);
    void applyCaptureGuard(on);
    void saveCaptureGuard(on);
  };
  const connected = connectionState === 'connected' || connectionState === 'reconnecting';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>CONTROL SURFACE</Text>
        <Text style={styles.title}>Settings</Text>

        <Section title="This machine" styles={styles}>
          <Row
            icon="desktop-outline"
            label="Desktop"
            // Null until a desktop has actually been reached. Saying so is
            // better than showing a remembered name as though it were live.
            value={machine?.name ?? 'Not connected'}
            styles={styles}
          />
          <Row
            icon="wifi-outline"
            label="Connection"
            value={
              !connected
                ? connectionState === 'failed'
                  ? 'Unreachable'
                  : 'Offline'
                : machine?.connection === 'relay'
                  ? 'Relay'
                  : 'Local network'
            }
            styles={styles}
          />
          <Row
            icon="folder-open-outline"
            label="Project"
            // The path, not only the name. The desktop sends it and nothing
            // rendered it, so two checkouts of the same repository on the same
            // machine were indistinguishable here - which is precisely when
            // you most want to know which one an agent is about to touch.
            value={project?.path ?? project?.name ?? '—'}
            styles={styles}
          />
          <Row
            icon="git-branch-outline"
            label="Branch"
            value={project?.branch ?? '—'}
            styles={styles}
          />
        </Section>

        <Section title="Usage today" styles={styles}>
          <Usage day={usageDay} styles={styles} />
        </Section>

        <Section title="Access and safety" styles={styles}>
          <Row
            icon="shield-checkmark-outline"
            label="Agent access"
            value={capability === 'read-write' ? 'Read and write' : 'Read-only'}
            styles={styles}
          />
          <View style={styles.explanation}>
            <Ionicons name="git-branch-outline" size={18} color={color.textMuted} />
            <Text style={styles.explanationText}>
              When you allow a write, Axune uses a separate worktree and branch. You review the
              result before keeping or discarding it.
            </Text>
          </View>
        </Section>

        <Section title="Appearance" styles={styles}>
          <Text style={styles.sectionCopy}>Drag to choose how Axune looks on this phone.</Text>
          <ThemeSlider
            darkness={draftDarkness}
            appliedDarkness={appliedDarkness}
            setDarkness={setDraftDarkness}
            onApply={applyAppearance}
            styles={styles}
          />
        </Section>

        <Section title="Connection" styles={styles}>
          <Action
            icon="qr-code-outline"
            label="Pair another machine"
            detail="Scan the code shown by Axune Desktop."
            onPress={() => router.push('/pair')}
            styles={styles}
          />
          <Action
            icon="unlink-outline"
            label="Disconnect this machine"
            detail="Clears this pairing and the conversations stored on this phone."
            danger
            onPress={() =>
              Alert.alert(
                'Disconnect this machine?',
                'This phone will forget the desktop and the conversations it has stored. You can pair again with a new code.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Disconnect', style: 'destructive', onPress: disconnect },
                ],
              )
            }
            styles={styles}
          />
        </Section>

        <Section title="Privacy" styles={styles}>
          <View style={styles.row}>
            <Ionicons name="eye-off-outline" size={19} color={color.textMuted} />
            <View style={styles.actionCopy}>
              <Text style={styles.actionLabel}>Block screen recording</Text>
              <Text style={styles.actionDetail}>
                Axune appears blank in recordings and screenshots. Turn this off to record a demo.
              </Text>
            </View>
            <Switch
              value={captureGuard}
              onValueChange={toggleCaptureGuard}
              trackColor={{ true: color.claude, false: color.line }}
            />
          </View>
          <Text style={styles.privacy}>
            This phone receives the prompts you send, the agent's replies, which tools it ran, and
            what a write run changed. Your repository and your agent stay on the desktop.
            Conversations are stored encrypted, and Axune covers the screen whenever it is not in
            front — so the app switcher never keeps a picture of your code.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/**
 * What this machine consumed today, and the one thing worth doing about it.
 *
 * ## What it will not say
 *
 * Nothing here is a share of a plan's limit, and there is no bar filling up.
 * No provider reports what a plan allows or when it resets, so any percentage
 * would be invented - and an invented number that people stop questioning is
 * worse than no number at all. The same refusal is written into the ledger
 * that produces these totals.
 *
 * ## Why the reused/fresh split leads
 *
 * It is the only part anyone can act on. Measured on this project, a
 * conversation's first turn costs about $0.073 and its fourth about $0.022,
 * because by then the repository the agent read is reused rather than sent
 * again. Totals alone would say a day was expensive; this says which habit
 * made it so.
 */
function Usage({
  day,
  styles,
}: {
  day: UsageDay | null;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();

  if (!day || day.runs === 0) {
    return (
      <Text style={styles.sectionCopy}>
        {day
          ? 'No runs today. Totals are counted on your desktop, so they include runs this phone was not connected for.'
          : 'Connect to your desktop to see what today has used.'}
      </Text>
    );
  }

  const reused = day.cacheReadTokens;
  const fresh = day.inputTokens + day.cacheCreationTokens;
  const tokens = reused + fresh + day.outputTokens;

  return (
    <View style={styles.usageBody}>
      <View style={styles.usageHead}>
        <Text style={styles.usageTotal}>{compact(tokens)}</Text>
        <Text style={styles.usageTotalUnit}>
          tokens over {day.runs} {day.runs === 1 ? 'run' : 'runs'}
        </Text>
      </View>

      <Stat label="Reused from cache" value={compact(reused)} styles={styles} />
      <Stat label="Sent fresh" value={compact(fresh)} styles={styles} />
      {day.coldStarts > 0 ? (
        <Stat
          label="First run after a break"
          value={`${day.coldStarts} ${day.coldStarts === 1 ? 'run' : 'runs'}`}
          tint={color.claudeText}
          styles={styles}
        />
      ) : null}
      {/*
        Shown rather than folded into the total. A run that reported nothing is
        not a free run, and counting it as zero would make the figure read as
        complete when it is not.
      */}
      {day.unreported > 0 ? (
        <Stat
          label="Reported nothing"
          value={`${day.unreported} ${day.unreported === 1 ? 'run' : 'runs'}`}
          styles={styles}
        />
      ) : null}
      {/*
        Named, not just counted. The ledger stores the first line of the prompt
        for exactly this: a number tells you the day was expensive, and the
        prompt tells you which question made it so - which is the only version
        anyone can act on.
      */}
      {day.heaviest ? (
        <View style={styles.usageHeaviest}>
          <Stat label="Heaviest run" value={compact(day.heaviest.tokens)} styles={styles} />
          <Text style={styles.usageHeaviestPrompt} numberOfLines={2}>
            {day.heaviest.prompt}
          </Text>
        </View>
      ) : null}

      <Text style={styles.usageNote}>
        {approxCost(day.costUsd) ?? ''}
        {day.costUsd > 0 ? ' · ' : ''}
        Continuing a conversation costs about a third of starting one, because the agent still
        remembers what it read.
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  tint,
  styles,
}: {
  label: string;
  value: string;
  tint?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.usageStat}>
      <Text style={[styles.usageStatLabel, tint ? { color: tint } : null]}>{label}</Text>
      <Text style={[styles.usageStatValue, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

function Row({
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
    <View style={styles.row}>
      <Ionicons name={icon} size={19} color={color.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Action({
  icon,
  label,
  detail,
  onPress,
  danger,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  onPress: () => void;
  danger?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={19} color={danger ? color.danger : color.textMuted} />
      <View style={styles.actionCopy}>
        <Text style={[styles.actionLabel, danger && { color: color.danger }]}>{label}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={color.textSoft} />
    </Pressable>
  );
}

/**
 * The appearance control: a continuous scale rather than a switch.
 *
 * Dragging previews without committing, which is why the caption changes and
 * why there is an apply button at all - the palette under your thumb is the
 * draft, and the app is still painted with what was applied.
 */
function ThemeSlider({
  darkness,
  appliedDarkness,
  setDarkness,
  onApply,
  styles,
}: {
  darkness: number;
  appliedDarkness: number;
  setDarkness: (value: number) => void;
  onApply: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  const [width, setWidth] = useState(1);
  const update = (x: number) => setDarkness(Math.max(0, Math.min(1, x / width)));
  const pending = Math.abs(appliedDarkness - darkness) >= 0.01;

  return (
    <View style={styles.sliderWrap}>
      <View style={styles.swatchRow}>
        <View style={[styles.swatch, { backgroundColor: previewColor(darkness) }]} />
        <View>
          <Text style={styles.swatchTitle}>{Math.round(darkness * 100)}% dark</Text>
          <Text style={styles.swatchDetail}>
            {pending ? 'Preview only until you apply' : 'Applied'}
          </Text>
        </View>
      </View>

      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => update(event.nativeEvent.locationX)}
        onResponderMove={(event) => update(event.nativeEvent.locationX)}
        style={styles.sliderHitArea}
      >
        <View style={styles.sliderTrack}>
          <View
            style={[styles.sliderFill, { width: `${darkness * 100}%`, backgroundColor: color.text }]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.sliderThumb,
              { left: `${darkness * 100}%`, borderColor: color.panel, backgroundColor: color.text },
            ]}
          />
        </View>
      </View>

      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabel}>Paper</Text>
        <Text style={styles.sliderLabel}>Graphite</Text>
        <Text style={styles.sliderLabel}>Black</Text>
      </View>

      <Pressable
        onPress={onApply}
        disabled={!pending}
        style={[styles.apply, { backgroundColor: color.text }, !pending && styles.applyDisabled]}
      >
        <Text style={[styles.applyText, { color: color.panel }]}>Apply appearance</Text>
      </Pressable>
    </View>
  );
}

/** The swatch is a plain grey ramp, so it reads as the scale rather than the brand. */
function previewColor(darkness: number): string {
  const value = Math.round(247 + (17 - 247) * darkness);
  return `rgb(${value}, ${value}, ${value})`;
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: {
      color: color.text,
      fontSize: 31,
      letterSpacing: -1,
      fontWeight: '600',
      marginTop: 6,
    },
    section: { marginTop: spacing.lg },
    sectionTitle: {
      color: color.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.35,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: color.panel,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      minHeight: 52,
      paddingVertical: 10,
    },
    rowLabel: { color: color.text, fontSize: 15, flex: 1 },
    rowValue: { color: color.text, fontSize: 15, fontWeight: '700', maxWidth: '55%' },
    actionCopy: { flex: 1 },
    actionLabel: { color: color.text, fontSize: 15, fontWeight: '600' },
    actionDetail: { color: color.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
    explanation: {
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.md,
      paddingTop: 0,
      alignItems: 'flex-start',
    },
    explanationText: { color: color.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
    usageBody: { gap: 10, padding: spacing.md },
    usageHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    usageTotal: { color: color.text, fontSize: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
    usageTotalUnit: { color: color.textSoft, fontSize: 12.5 },
    usageStat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    usageStatLabel: { color: color.textMuted, fontSize: 12.5 },
    usageStatValue: { color: color.text, fontSize: 12.5, fontVariant: ['tabular-nums'] },
    usageHeaviest: { gap: 2 },
    usageHeaviestPrompt: { color: color.textSoft, fontSize: 11.5, fontStyle: 'italic' },
    usageNote: { color: color.textSoft, fontSize: 11.5, lineHeight: 17 },
    sectionCopy: { color: color.textMuted, fontSize: 13, padding: spacing.md, paddingBottom: 0 },
    privacy: { color: color.textMuted, fontSize: 13, lineHeight: 20, padding: spacing.md },

    sliderWrap: { padding: spacing.md, gap: 12 },
    swatchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    swatch: {
      width: 42,
      height: 42,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: color.line,
    },
    swatchTitle: { color: color.text, fontSize: 15, fontWeight: '700' },
    swatchDetail: { color: color.textMuted, fontSize: 12.5, marginTop: 2 },
    // A tall hit area around a thin track: the track is the thing you see, this
    // is the thing you can actually hit with a thumb.
    sliderHitArea: { paddingVertical: 14, justifyContent: 'center' },
    sliderTrack: { height: 6, borderRadius: 3, backgroundColor: color.panelAlt },
    sliderFill: { height: 6, borderRadius: 3 },
    sliderThumb: {
      position: 'absolute',
      top: -9,
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 3,
      marginLeft: -12,
    },
    sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    sliderLabel: { color: color.textMuted, fontSize: 12, fontWeight: '600' },
    apply: {
      height: 47,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    applyDisabled: { opacity: 0.4 },
    applyText: { fontSize: 14, fontWeight: '700' },
  });
