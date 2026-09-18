import { palettes, type Palette } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import { loadDarkness, saveDarkness } from '@/lib/themeStore';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

interface DemoAppearance {
  palette: Palette;
  draftDarkness: number;
  appliedDarkness: number;
  setDraftDarkness: (value: number) => void;
  applyAppearance: () => void;
}

const Context = createContext<DemoAppearance | null>(null);

/** A continuous palette between Axune's existing light and dark tokens. */
export function DemoAppearanceProvider({ children }: { children: React.ReactNode }) {
  const { scheme } = useTheme();
  const initial = scheme === 'dark' ? 1 : 0;
  const [draftDarkness, setDraftDarknessState] = useState(initial);
  const [appliedDarkness, setAppliedDarkness] = useState(initial);

  /**
   * A chosen appearance survives a relaunch; an unchosen one follows the phone.
   *
   * The slider used to live in React state alone, so every restart threw the
   * choice away and snapped back to the system's light or dark. Persisting it
   * is what makes it a setting rather than a toy - and it follows the rule
   * `ThemeMode` already states: the system default is never wrong, an explicit
   * override is remembered.
   *
   * Null from the store means never chosen, which is deliberately not the same
   * as having chosen zero.
   */
  useEffect(() => {
    let cancelled = false;
    void loadDarkness().then((stored) => {
      if (cancelled || stored === null) return;
      setDraftDarknessState(stored);
      setAppliedDarkness(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const palette = useMemo(() => blendPalette(appliedDarkness), [appliedDarkness]);
  const value = useMemo<DemoAppearance>(
    () => ({
      palette,
      draftDarkness,
      appliedDarkness,
      setDraftDarkness: (next) => setDraftDarknessState(Math.max(0, Math.min(1, next))),
      applyAppearance: () => {
        setAppliedDarkness(draftDarkness);
        // Written on apply rather than on drag: the draft is a preview, and
        // saving every frame of a slider would write hundreds of times.
        void saveDarkness(draftDarkness);
      },
    }),
    [appliedDarkness, draftDarkness, palette],
  );
  return (
    <Context.Provider value={value}>
      <View style={styles.fill}>{children}</View>
    </Context.Provider>
  );
}

export function useDemoTheme(): DemoAppearance {
  const value = useContext(Context);
  if (value) return value;
  return {
    palette: palettes.dark,
    draftDarkness: 1,
    appliedDarkness: 1,
    setDraftDarkness: () => undefined,
    applyAppearance: () => undefined,
  };
}

function blendPalette(amount: number): Palette {
  const mixed = Object.fromEntries(
    Object.keys(palettes.light).map((key) => [
      key,
      blend(palettes.light[key as keyof Palette], palettes.dark[key as keyof Palette], amount),
    ]),
  ) as Palette;
  const darkForeground = amount < 0.62;
  return {
    ...mixed,
    // Neutrals are designed as a scale, not mechanically blended brand tokens.
    bg: rgb([246, 240, 228], [10, 13, 17], amount),
    screen: rgb([255, 250, 242], [15, 19, 24], amount),
    // In darkness, surfaces rise in luminance so hierarchy remains visible.
    panel: rgb([255, 252, 246], [24, 30, 38], amount),
    panelAlt: rgb([235, 226, 209], [34, 42, 52], amount),
    line: darkForeground ? 'rgba(15, 23, 32, 0.16)' : 'rgba(255, 255, 255, 0.12)',
    lineStrong: darkForeground ? 'rgba(15, 23, 32, 0.32)' : 'rgba(255, 255, 255, 0.24)',
    text: darkForeground ? 'rgb(14, 20, 27)' : 'rgb(246, 248, 250)',
    // Secondary text is deliberately stronger than decorative text, including at grey midpoints.
    textMuted: darkForeground ? 'rgb(53, 67, 82)' : 'rgb(195, 205, 216)',
    textSoft: darkForeground ? 'rgb(85, 100, 116)' : 'rgb(151, 165, 180)',
    // Claude is deliberately orange, not beige: identity needs to survive the cream surface.
    claude: rgb([211, 103, 25], [247, 157, 76], amount),
    claudeStrong: rgb([181, 75, 12], [224, 117, 39], amount),
    claudeText: rgb([144, 57, 8], [255, 194, 137], amount),
    claudeBubble: rgb([255, 232, 205], [83, 43, 18], amount),
    claudeBubbleText: rgb([79, 35, 10], [255, 235, 216], amount),
    claudeIconBg: rgb([255, 215, 169], [103, 52, 18], amount),
    claudeIconText: rgb([119, 49, 9], [255, 213, 171], amount),
  };
}

function rgb(
  light: [number, number, number],
  dark: [number, number, number],
  amount: number,
): string {
  return `rgb(${light.map((channel, index) => Math.round(channel + (dark[index]! - channel) * amount)).join(', ')})`;
}

function blend(light: string, dark: string, amount: number): string {
  const a = parseColor(light);
  const b = parseColor(dark);
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount);
  const alpha = a[3] + (b[3] - a[3]) * amount;
  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha.toFixed(3)})`;
}

function parseColor(value: string): [number, number, number, number] {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }
  const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
