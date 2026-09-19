import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme, type ThemeState } from '@/lib/ThemeContext';

/**
 * The demo's appearance hook, now a thin pass-through to the real theme.
 *
 * The continuous darkness slider started here and has moved into
 * `ThemeContext`, where the shipping app can use it. This stays so the ten demo
 * components keep compiling unchanged while `app/demo/` is kept alive as the
 * design reference - but it holds no state and no palette of its own.
 *
 * Two implementations would drift, and the drift would appear as the real app
 * and the reference disagreeing about a colour, which is the least debuggable
 * kind of difference.
 */
export function DemoAppearanceProvider({ children }: { children: React.ReactNode }) {
  return <View style={styles.fill}>{children}</View>;
}

export function useDemoTheme(): ThemeState {
  return useTheme();
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
