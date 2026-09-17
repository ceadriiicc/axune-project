import { Ionicons } from '@expo/vector-icons';
import type { Capability, MachineSummary, ProjectSummary } from '@axune/protocol';
import { useDemoTheme as useTheme } from './DemoAppearance';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DemoTabBar } from './DemoTabBar';

export function DemoSettings({
  machine,
  project,
  capability,
}: {
  machine: MachineSummary;
  project: ProjectSummary;
  capability: Capability;
}) {
  const { palette: color, draftDarkness, appliedDarkness, setDraftDarkness, applyAppearance } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={styles.kicker}>CONTROL SURFACE</Text>
          <Text style={styles.title}>Settings</Text>
        </View>
        <Section title="This machine" styles={styles}>
          <Row icon="desktop-outline" label="Desktop" value={machine.name} styles={styles} />
          <Row
            icon="wifi-outline"
            label="Connection"
            value={machine.connection === 'local' ? 'Local network' : 'Relay'}
            styles={styles}
          />
          <Row icon="folder-open-outline" label="Project" value={project.name} styles={styles} />
          <Row icon="git-branch-outline" label="Branch" value={project.branch} styles={styles} />
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
          <ThemeSlider darkness={draftDarkness} setDarkness={setDraftDarkness} appliedDarkness={appliedDarkness} onApply={applyAppearance} styles={styles} />
        </Section>
        <Section title="Connection actions" styles={styles}>
          <Action
            icon="qr-code-outline"
            label="Pair another machine"
            detail="Scan a QR code from Axune Desktop."
            styles={styles}
          />
          <Action
            icon="unlink-outline"
            label="Disconnect this machine"
            detail="Clears this pairing and stored conversations from this phone."
            danger
            styles={styles}
          />
        </Section>
        <Section title="Privacy" styles={styles}>
          <Text style={styles.privacy}>
            Your phone can receive the prompts you send, agent responses, tool activity, and
            change-review information from the connected desktop.
          </Text>
        </Section>
      </ScrollView>
      <DemoTabBar />
    </View>
  );
}
function ThemeSlider({ darkness, setDarkness, appliedDarkness, onApply, styles }: { darkness: number; setDarkness: (value: number) => void; appliedDarkness: number; onApply: () => void; styles: ReturnType<typeof makeStyles> }) {
  const { palette: color } = useTheme();
  const [width, setWidth] = useState(1);
  const update = (x: number) => setDarkness(Math.max(0, Math.min(1, x / width)));
  return (
    <View style={styles.sliderWrap}>
      <View style={styles.swatchRow}><View style={[styles.swatch, { backgroundColor: previewColor(darkness) }]} /><View><Text style={styles.swatchTitle}>{Math.round(darkness * 100)}% dark</Text><Text style={styles.swatchDetail}>{Math.abs(appliedDarkness - darkness) < 0.01 ? 'Applied to demo' : 'Preview only until you apply'}</Text></View></View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => update(event.nativeEvent.locationX)}
        onResponderMove={(event) => update(event.nativeEvent.locationX)}
        style={styles.sliderTrack}
      >
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
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabel}>Paper</Text><Text style={styles.sliderLabel}>Graphite</Text><Text style={styles.sliderLabel}>Black</Text>
      </View>
      <Pressable onPress={onApply} style={[styles.apply, { backgroundColor: color.text }]}><Text style={[styles.applyText, { color: color.panel }]}>Apply appearance</Text></Pressable>
    </View>
  );
}
function previewColor(darkness: number) { const value = Math.round(247 + (17 - 247) * darkness); return `rgb(${value}, ${value}, ${value})`; }
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
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
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
      <Ionicons name={icon} size={18} color={color.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}
function Action({
  icon,
  label,
  detail,
  danger = false,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  danger?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons name={icon} size={19} color={danger ? color.danger : color.text} />
      <View style={styles.flex}>
        <Text style={[styles.actionLabel, danger && { color: color.danger }]}>{label}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={color.textSoft} />
    </Pressable>
  );
}
const makeStyles = (color: ReturnType<typeof useTheme>['palette']) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    content: { padding: 22, paddingTop: 68, paddingBottom: 110, gap: 22 },
    kicker: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: color.text, fontSize: 31, letterSpacing: -1, fontWeight: '600', marginTop: 6 },
    section: { gap: 9 },
    sectionTitle: {
      color: color.textMuted,
      fontSize: 12,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      fontWeight: '700',
      paddingHorizontal: 3,
    },
    card: {
      backgroundColor: color.panel,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: color.line,
      overflow: 'hidden',
    },
    row: {
      minHeight: 50,
      paddingHorizontal: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: color.line,
    },
    rowLabel: { color: color.textMuted, fontSize: 13 },
    rowValue: { color: color.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1 },
    explanation: { flexDirection: 'row', gap: 10, padding: 14, backgroundColor: color.panelAlt },
    explanationText: { color: color.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
    sectionCopy: { color: color.textMuted, fontSize: 13, padding: 15, paddingBottom: 0 },
    sliderWrap: { padding: 18, paddingTop: 20, gap: 10 },
    swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    swatch: { height: 34, width: 34, borderRadius: 11, borderWidth: 1, borderColor: color.lineStrong },
    swatchTitle: { color: color.text, fontSize: 13, fontWeight: '700' },
    swatchDetail: { color: color.textMuted, fontSize: 12, marginTop: 2 },
    sliderTrack: {
      height: 7,
      borderRadius: 4,
      backgroundColor: color.panelAlt,
      justifyContent: 'center',
    },
    sliderFill: { position: 'absolute', left: 0, height: 7, borderRadius: 4 },
    sliderStop: { position: 'absolute', marginLeft: -3.5, height: 7, width: 7, borderRadius: 4 },
    sliderThumb: {
      position: 'absolute',
      marginLeft: -12,
      height: 24,
      width: 24,
      borderRadius: 12,
      borderWidth: 3,
    },
    sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    sliderLabel: { fontSize: 12, fontWeight: '700' },
    apply: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    applyText: { fontSize: 13, fontWeight: '700' },
    action: {
      padding: 15,
      minHeight: 66,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      borderBottomWidth: 1,
      borderBottomColor: color.line,
    },
    flex: { flex: 1 },
    actionLabel: { color: color.text, fontSize: 14, fontWeight: '700' },
    actionDetail: { color: color.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
    privacy: { color: color.textMuted, padding: 15, fontSize: 13, lineHeight: 19 },
    pressed: { opacity: 0.68, transform: [{ scale: 0.99 }] },
  });
