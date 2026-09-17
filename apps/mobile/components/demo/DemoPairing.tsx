import { Ionicons } from '@expo/vector-icons';
import type { PairingPayload } from '@axune/protocol';
import { useDemoTheme } from './DemoAppearance';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function DemoPairing({ payload }: { payload: PairingPayload }) {
  const { palette: color } = useDemoTheme();
  const router = useRouter();
  const [stage, setStage] = useState<'scan' | 'confirm' | 'connecting' | 'done'>('scan');
  const styles = useMemo(() => makeStyles(color), [color]);
  if (stage === 'connecting')
    return (
      <Centered
        icon="radio-outline"
        title="Connecting to desktop"
        detail={`Looking for ${payload.projectName} on your network.`}
        styles={styles}
        action={() => setStage('done')}
        actionLabel="Continue"
      />
    );
  if (stage === 'done')
    return (
      <Centered
        icon="checkmark-circle-outline"
        title="Desktop connected"
        detail={`${payload.projectName} is ready on this phone.`}
        styles={styles}
        action={() => router.replace('/demo')}
        actionLabel="Open Home"
        success
      />
    );
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={23} color={color.text} />
        </Pressable>
        <Text style={styles.topTitle}>Pair a desktop</Text>
        <View style={styles.back} />
      </View>
      <View style={styles.body}>
        {stage === 'scan' ? (
          <>
            <Text style={styles.eyebrow}>FIRST CONNECTION</Text>
            <Text style={styles.title}>Bring your desktop into reach.</Text>
            <Text style={styles.detail}>
              Scan the pairing code shown by Axune Desktop. The code is short-lived and pairs this
              phone with one machine.
            </Text>
            <View style={styles.scan}>
              <View style={styles.corner} />
              <Ionicons name="qr-code-outline" size={70} color={color.text} />
              <Text style={styles.scanText}>Demo pairing code detected</Text>
            </View>
            <Pressable
              onPress={() => setStage('confirm')}
              style={[styles.primary, { backgroundColor: color.text }]}
            >
              <Text style={[styles.primaryText, { color: color.panel }]}>Review this desktop</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>CONFIRM DESKTOP</Text>
            <Text style={styles.title}>Is this the machine you expect?</Text>
            <Text style={styles.detail}>
              Confirm the desktop and project before this phone can control an agent there.
            </Text>
            <View style={styles.machine}>
              <View style={[styles.machineIcon, { backgroundColor: color.claudeIconBg }]}>
                <Ionicons name="desktop-outline" size={24} color={color.claudeIconText} />
              </View>
              <Text style={styles.machineName}>CEDRIC-DESKTOP</Text>
              <Text style={styles.machineMeta}>{payload.projectName}</Text>
              <Text style={styles.machineMeta}>Local network</Text>
            </View>
            <View style={styles.note}>
              <Ionicons name="shield-checkmark-outline" size={19} color={color.textMuted} />
              <Text style={styles.noteText}>
                Pairing lets this phone send prompts and receive agent output from this desktop.
              </Text>
            </View>
            <Pressable
              onPress={() => setStage('connecting')}
              style={[styles.primary, { backgroundColor: color.text }]}
            >
              <Text style={[styles.primaryText, { color: color.panel }]}>Trust and connect</Text>
            </Pressable>
            <Pressable onPress={() => setStage('scan')} style={styles.secondary}>
              <Text style={styles.secondaryText}>This is not my desktop</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
function Centered({
  icon,
  title,
  detail,
  action,
  actionLabel,
  success = false,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  action: () => void;
  actionLabel: string;
  success?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useDemoTheme();
  return (
    <View style={styles.page}>
      <View style={styles.center}>
        <View
          style={[
            styles.centerIcon,
            { backgroundColor: success ? color.claudeIconBg : color.panelAlt },
          ]}
        >
          <Ionicons name={icon} size={36} color={success ? color.ok : color.text} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <Pressable onPress={action} style={[styles.primary, { backgroundColor: color.text }]}>
          <Text style={[styles.primaryText, { color: color.panel }]}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
const makeStyles = (color: ReturnType<typeof useDemoTheme>['palette']) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: color.bg },
    top: {
      paddingTop: 57,
      paddingHorizontal: 18,
      paddingBottom: 13,
      borderBottomColor: color.line,
      borderBottomWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    topTitle: { color: color.text, fontSize: 15, fontWeight: '700' },
    body: { flex: 1, padding: 28, justifyContent: 'center', gap: 17 },
    eyebrow: { color: color.textSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1.3 },
    title: {
      color: color.text,
      fontSize: 29,
      letterSpacing: -0.8,
      lineHeight: 35,
      fontWeight: '600',
    },
    detail: { color: color.textMuted, fontSize: 15, lineHeight: 22 },
    scan: {
      height: 236,
      borderRadius: 24,
      borderWidth: 1.5,
      borderColor: color.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 13,
      backgroundColor: color.panel,
    },
    corner: {
      position: 'absolute',
      top: 17,
      left: 17,
      width: 26,
      height: 26,
      borderTopWidth: 3,
      borderLeftWidth: 3,
      borderColor: color.claudeStrong,
    },
    scanText: { color: color.textMuted, fontSize: 13, fontWeight: '600' },
    primary: {
      height: 50,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    primaryText: { fontSize: 15, fontWeight: '700' },
    machine: {
      backgroundColor: color.panel,
      borderColor: color.line,
      borderWidth: 1,
      borderRadius: 21,
      alignItems: 'center',
      padding: 22,
      gap: 6,
    },
    machineIcon: {
      height: 51,
      width: 51,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    machineName: { color: color.text, fontSize: 17, fontWeight: '700' },
    machineMeta: { color: color.textMuted, fontSize: 13 },
    note: {
      flexDirection: 'row',
      gap: 9,
      backgroundColor: color.panelAlt,
      padding: 13,
      borderRadius: 14,
    },
    noteText: { color: color.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
    secondary: { height: 38, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: color.textMuted, fontSize: 14, fontWeight: '600' },
    center: { flex: 1, padding: 30, alignItems: 'center', justifyContent: 'center', gap: 16 },
    centerIcon: {
      height: 78,
      width: 78,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 5,
    },
  });
