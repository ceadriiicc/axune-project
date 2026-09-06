import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { TopBar } from '@/components/ui/TopBar';
import { color, radius, spacing } from '@/constants/theme';
import { useWorkspace } from '@/lib/WorkspaceContext';

/**
 * Scans the QR code shown by Axune Desktop.
 *
 * The camera is the only way in: pairing codes are never typed, so there is no
 * short code to guess and nothing to shoulder-surf beyond the screen itself.
 */
export default function PairScreen() {
  const router = useRouter();
  const { pair, connectionState, connectionDetail } = useWorkspace();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // A QR code fires continuously while it is in frame; pair once.
  const handled = useRef(false);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
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

      handled.current = true;
      setError(null);
      pair(payload as Parameters<typeof pair>[0]);
      router.replace('/workspace');
    },
    [pair, router],
  );

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
            Axune reads the pairing code shown by Axune Desktop. The camera is used for nothing else.
          </Text>
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Allow camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
        Run <Text style={styles.mono}>npm run desktop</Text> on your computer and point the camera at
        the code it shows.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {connectionState === 'failed' && connectionDetail ? (
        <Text style={styles.error}>{connectionDetail}</Text>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg, padding: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  heading: { color: color.text, fontSize: 20, fontWeight: '700' },
  body: {
    color: color.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  button: {
    marginTop: spacing.sm,
    backgroundColor: color.claude,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: '#1e1b18', fontWeight: '700', fontSize: 15 },
  viewfinder: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
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
});
