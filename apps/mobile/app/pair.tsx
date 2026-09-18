import { fingerprint, fromBase64Url } from '@axune/secure-channel';
import type { PairingPayload } from '@axune/protocol';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TopBar } from '@/components/ui/TopBar';
import { type Palette, radius, spacing } from '@/constants/theme';
import { phoneRandom } from '@/lib/random';
import { withDecoys } from '@/lib/verificationCodes';
import { useTheme } from '@/lib/ThemeContext';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Scans the QR code shown by Axune Desktop, then asks before trusting it.
 *
 * The camera is the only way in: pairing codes are never typed, so there is no
 * short code to guess and nothing to shoulder-surf beyond the screen itself.
 *
 * Scanning no longer pairs on its own. The QR carries the desktop's public key,
 * and that key is what every later reconnect is pinned to - so the moment of
 * scanning is the one moment a person can still check they are pointing at
 * their own machine. Pairing straight from the scan spent that moment silently.
 */
export default function PairScreen() {
  const router = useRouter();
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  const { pair, connectionState, connectionDetail } = useWorkspace();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  /** Scanned, shown, and waiting to be confirmed or rejected. */
  const [pending, setPending] = useState<PairingPayload | null>(null);
  // A QR code fires continuously while it is in frame; handle it once.
  const handled = useRef(false);

  const onScanned = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      setError('That QR code is not an Axune pairing code.');
      return;
    }

    if (!payload || typeof payload !== 'object' || (payload as { kind?: string }).kind !== 'axune') {
      setError('That QR code is not an Axune pairing code.');
      return;
    }

    const scanned = payload as PairingPayload;
    if (!scanned.publicKey) {
      // Refused rather than paired in the clear. Without a key there is nothing
      // to pin, so every later reconnect would trust whoever answered.
      setError('That desktop is too old to encrypt the link. Update Axune Desktop.');
      return;
    }

    handled.current = true;
    setError(null);
    setPending(scanned);
  }, []);

  /** Go back to the camera, leaving nothing sent and nothing stored. */
  const reject = useCallback(() => {
    setPending(null);
    handled.current = false;
  }, []);

  const confirm = useCallback(() => {
    if (!pending) return;
    pair(pending);
    router.replace('/workspace');
  }, [pending, pair, router]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Pair" onBack={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Pair" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.heading}>Camera access needed</Text>
          <Text style={styles.body}>
            Axune reads the pairing code shown by Axune Desktop. The camera is used for nothing
            else.
          </Text>
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Allow camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (pending) return <Confirm payload={pending} onConfirm={confirm} onReject={reject} />;

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar title="Scan to pair" onBack={() => router.back()} />

      <View style={styles.viewfinder}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
        />
        <View style={styles.reticle} pointerEvents="none" />
      </View>

      <Text style={styles.hint}>
        Run <Text style={styles.mono}>npm run desktop</Text> on your computer and point the camera
        at the code it shows.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {connectionState === 'failed' && connectionDetail ? (
        <Text style={styles.error}>{connectionDetail}</Text>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The last step before this phone trusts a machine.
 *
 * Three codes, one of which is real, and you tap the one your desktop is
 * showing. The first version of this screen displayed the real code alone with
 * "pair only if they match" underneath, and the honest result was that it got
 * tapped straight through without anyone looking at the desktop at all - a
 * security check presented as decoration, which is worse than no check, because
 * it looks like protection that is not happening.
 *
 * Choosing between three cannot be done without reading the desktop's screen,
 * and that screen is the one surface an attacker on the network cannot repaint.
 * A code shown only here would prove nothing either way, since whatever
 * produced the QR also produced the code derived from it.
 *
 * Pairing happens once per device, so the cost of getting this right is a few
 * seconds, once.
 */
function Confirm({
  payload,
  onConfirm,
  onReject,
}: {
  payload: PairingPayload;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const router = useRouter();
  const { palette: color } = useTheme();
  const styles = makeStyles(color);
  const [wrong, setWrong] = useState(false);

  // The key was checked for presence before this screen was reached, but a
  // malformed one must not take the app down mid-pairing.
  const real = useMemo(() => {
    try {
      return fingerprint(fromBase64Url(payload.publicKey));
    } catch {
      return null;
    }
  }, [payload.publicKey]);

  // Decoys are drawn once and kept, so the options do not reshuffle underneath
  // someone who is mid-comparison.
  const choices = useMemo(() => (real ? withDecoys(real, phoneRandom) : []), [real]);

  const address = payload.urls?.[0] ?? payload.url;

  if (!real) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Confirm desktop" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.confirmBody}>
          <Text style={styles.eyebrow}>CANNOT VERIFY</Text>
          <Text style={styles.project}>{payload.projectName}</Text>
          <Text style={styles.codeHelp}>
            This pairing code could not be read, so there is nothing to check it against. Show a
            fresh code on your desktop rather than pairing with this one.
          </Text>
          <Pressable style={styles.secondary} onPress={onReject}>
            <Text style={styles.secondaryText}>Back to the camera</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar title="Confirm desktop" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.confirmBody} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>IS THIS YOUR MACHINE?</Text>
        <Text style={styles.project}>{payload.projectName}</Text>
        <Text style={styles.address} numberOfLines={1}>
          {address}
        </Text>

        <Text style={styles.instruction}>
          Your desktop is showing one of these. Tap the one you can see.
        </Text>

        {choices.map((choice) => (
          <Pressable
            key={choice}
            style={styles.choice}
            onPress={() => (choice === real ? onConfirm() : setWrong(true))}
          >
            <Text style={styles.choiceText}>{choice}</Text>
          </Pressable>
        ))}

        {wrong ? (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>That code is not on your desktop.</Text>
            <Text style={styles.warningBody}>
              Either it was a mis-tap, or this QR code did not come from the machine you think it
              did. Check your desktop screen before trying again.
            </Text>
          </View>
        ) : (
          <Text style={styles.reassure}>
            Nothing has been sent yet. Axune connects only after you choose.
          </Text>
        )}

        <Pressable style={styles.secondary} onPress={onReject}>
          <Text style={styles.secondaryText}>This is not my desktop</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (color: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg, padding: spacing.lg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    heading: { color: color.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
    body: {
      color: color.textMuted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
    },
    button: {
      marginTop: spacing.sm,
      backgroundColor: color.claude,
      borderRadius: radius.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.xl,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: color.bg, fontWeight: '700', fontSize: 15 },
    viewfinder: {
      aspectRatio: 1,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: color.panelAlt,
      borderWidth: 1,
      borderColor: color.line,
    },
    reticle: {
      position: 'absolute',
      top: '15%',
      left: '15%',
      right: '15%',
      bottom: '15%',
      borderWidth: 2,
      borderColor: color.codex,
      borderRadius: radius.md,
    },
    hint: {
      marginTop: spacing.lg,
      color: color.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    mono: { color: color.claudeText },
    error: { marginTop: spacing.md, color: color.danger, fontSize: 13, textAlign: 'center' },

    confirmBody: { paddingTop: spacing.lg, gap: spacing.xs },
    eyebrow: {
      color: color.textSoft,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    project: {
      color: color.text,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '800',
      letterSpacing: -0.9,
      marginTop: 4,
    },
    address: { color: color.textMuted, fontSize: 13, marginTop: 2 },
    codeCard: {
      marginTop: spacing.lg,
      padding: spacing.lg,
      borderRadius: radius.xl,
      backgroundColor: color.panel,
      borderWidth: 1,
      borderColor: color.line,
      alignItems: 'center',
    },
    codeLabel: {
      color: color.textSoft,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    code: {
      color: color.text,
      fontSize: 32,
      fontWeight: '800',
      letterSpacing: 3,
      marginTop: spacing.sm,
    },
    codeBad: {
      color: color.danger,
      fontSize: 24,
      fontWeight: '700',
      marginTop: spacing.sm,
    },
    codeHelp: {
      color: color.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
    instruction: {
      color: color.text,
      fontSize: 15,
      lineHeight: 22,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    // Wide, tall, and evenly weighted: none of the three may look more like the
    // answer than the others, or the eye picks one without reading the desktop.
    choice: {
      height: 62,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.panel,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
    },
    choiceText: { color: color.text, fontSize: 24, fontWeight: '700', letterSpacing: 3 },
    warning: {
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.danger,
    },
    warningTitle: { color: color.danger, fontSize: 15, fontWeight: '700' },
    warningBody: { color: color.textMuted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
    reassure: {
      color: color.textSoft,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
    secondary: { marginTop: spacing.sm, paddingVertical: 13, alignItems: 'center' },
    secondaryText: { color: color.textMuted, fontSize: 14, fontWeight: '600' },
  });
