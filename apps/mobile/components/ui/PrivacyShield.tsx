import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { spacing } from '@/constants/theme';
import { shouldShield } from '@/lib/screenShield';
import { useTheme } from '@/lib/ThemeContext';

/**
 * Covers the screen whenever the app is not in the foreground.
 *
 * iOS photographs the app on its way out to draw the app-switcher card, and
 * writes that image to disk. With a run transcript on screen that image is a
 * copy of private source, sitting where anyone holding the phone can see it
 * without unlocking anything Axune controls.
 *
 * The decision of *when* lives in `screenShield` so it can be tested under Node;
 * this file is only the drawing, which cannot be.
 *
 * **What this does not do.** The cover is drawn by React in response to an
 * AppState event, and iOS decides when to take its snapshot. On a slow frame the
 * snapshot can win. This narrows the window rather than closing it, and the
 * honest closing of it is `expo-screen-capture`, which needs a native build.
 * Worth saying plainly, because a cover that *usually* works is exactly the kind
 * of control someone would otherwise assume was absolute.
 */
export function PrivacyShield() {
  const { palette: color } = useTheme();
  const [state, setState] = useState(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', setState);
    return () => sub.remove();
  }, []);

  if (!shouldShield(state)) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: color.bg }]}
      // The app is leaving the foreground, so nothing below should receive a
      // stray touch on the way out.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.mark, { color: color.textMuted }]}>Axune</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    // Above every screen and every modal. The cover is worthless if a sheet
    // rendered later sits on top of it.
    zIndex: 9999,
    elevation: 9999,
    padding: spacing.lg,
  },
  mark: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
