import { palettes, type Palette } from '@/constants/theme';
import { useTheme } from '@/lib/ThemeContext';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

interface DemoAppearance {
  palette: Palette;
  draftDarkness: number;
  appliedDarkness: number;
  setDraftDarkness: (value: number) => void;
  applyAppearance: () => void;
}

const Context = createContext<DemoAppearance | null>(null);

/** A demo-only continuous palette between Axune's existing light and dark tokens. */
export function DemoAppearanceProvider({ children }: { children: React.ReactNode }) {
  const { scheme } = useTheme();
  const initial = scheme === 'dark' ? 1 : 0;
  const [draftDarkness, setDraftDarknessState] = useState(initial);
  const [appliedDarkness, setAppliedDarkness] = useState(initial);
  const palette = useMemo(() => blendPalette(appliedDarkness), [appliedDarkness]);
  const value = useMemo<DemoAppearance>(() => ({
    palette,
    draftDarkness,
    appliedDarkness,
    setDraftDarkness: (next) => setDraftDarknessState(Math.max(0, Math.min(1, next))),
    applyAppearance: () => {
      setAppliedDarkness(draftDarkness);
    },
  }), [appliedDarkness, draftDarkness, palette]);
  return <Context.Provider value={value}><View style={styles.fill}>{children}</View></Context.Provider>;
}

export function useDemoTheme(): DemoAppearance {
  const value = useContext(Context);
  if (value) return value;
  return { palette: palettes.dark, draftDarkness: 1, appliedDarkness: 1, setDraftDarkness: () => undefined, applyAppearance: () => undefined };
}

function blendPalette(amount: number): Palette {
  return Object.fromEntries(Object.keys(palettes.light).map((key) => [key, blend(palettes.light[key as keyof Palette], palettes.dark[key as keyof Palette], amount)])) as Palette;
}

function blend(light: string, dark: string, amount: number): string {
  const a = parseColor(light); const b = parseColor(dark);
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount);
  const alpha = a[3] + (b[3] - a[3]) * amount;
  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha.toFixed(3)})`;
}

function parseColor(value: string): [number, number, number, number] {
  if (value.startsWith('#')) { const hex = value.slice(1); return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1]; }
  const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
