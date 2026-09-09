import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { color, palettes, type Palette } from '@/constants/theme';

import { loadThemeMode, saveThemeMode, type ThemeMode } from './themeStore';

/**
 * The palette in force, and the control that changes it.
 *
 * ## Why this exists rather than a static import
 *
 * Every component reached for `color` from `constants/theme` directly, which
 * `StyleSheet.create` then captured at module load. That is fine for a single
 * fixed theme and impossible to switch at runtime: the styles are already
 * built by the time anyone taps anything. A component has to read its colours
 * through this hook to respond to the toggle at all.
 *
 * ## The contract
 *
 * `useTheme()` returns the active `palette`, which has exactly the same keys as
 * the old `color` object - so migrating a component is mechanical: take the
 * palette from the hook and build its styles from that instead of from the
 * import. Nothing else about a component needs to change.
 *
 * `system` is the default because a tool opened at a desk in the morning and in
 * bed at night should not have to be told twice.
 */
export interface ThemeState {
  /** What the user chose: system, light, or dark. */
  mode: ThemeMode;
  /** What that resolves to right now. `system` follows the phone. */
  scheme: 'light' | 'dark';
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  /**
   * Flips between light and dark, leaving `system` behind.
   *
   * For a single-button control: the first tap on a phone in dark mode should
   * give light, not "system", which would appear to do nothing.
   */
  toggle: () => void;
  /** False until the stored preference has been read, so nothing flashes. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadThemeMode().then((stored) => {
      if (!cancelled) {
        setModeState(stored);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheme: 'light' | 'dark' =
    mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void saveThemeMode(next);
  }, []);

  const toggle = useCallback(() => {
    setMode(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme, setMode]);

  const value = useMemo<ThemeState>(
    () => ({ mode, scheme, palette: palettes[scheme], setMode, toggle, ready }),
    [mode, scheme, setMode, toggle, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The active theme.
 *
 * Falls back to the dark palette outside a provider rather than throwing. A
 * component rendering the wrong colours is a visible bug someone fixes; a
 * component that crashes the screen because a provider was missed is a worse
 * trade for an appearance concern.
 */
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return {
    mode: 'system',
    scheme: 'dark',
    palette: color,
    setMode: () => undefined,
    toggle: () => undefined,
    ready: true,
  };
}
