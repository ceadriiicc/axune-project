import { palettes, type Palette } from '@/constants/theme';

/**
 * A palette anywhere on the scale between paper and black.
 *
 * Axune's appearance control is a continuous slider rather than a light/dark
 * switch, so the theme has to exist at every point between the two palettes,
 * not only at the ends. Cedric asked for the slider specifically; this is what
 * makes it possible.
 *
 * Lifted out of the demo so there is one implementation. Two of these would
 * drift, and the drift would show as the real app and the design reference
 * disagreeing about a colour - the least debuggable kind of difference.
 *
 * Pure, and free of React Native imports, so it can be tested under Node.
 */
export function blendPalette(unclamped: number): Palette {
  // Clamped here rather than trusting callers. The provider already limits the
  // slider, but this is exported, and extrapolating past either end produces
  // channels outside 0-255 - which React Native renders unpredictably instead
  // of rejecting. A NaN gets the same treatment: it becomes paper rather than
  // painting the entire interface with nothing.
  const amount = Number.isFinite(unclamped) ? Math.max(0, Math.min(1, unclamped)) : 0;

  const mixed = Object.fromEntries(
    Object.keys(palettes.light).map((key) => [
      key,
      blend(palettes.light[key as keyof Palette], palettes.dark[key as keyof Palette], amount),
    ]),
  ) as Palette;

  // Past this point the interface is dark enough that foreground and
  // background have to swap, rather than meeting in an unreadable middle.
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
    // Secondary text is deliberately stronger than decorative text, including
    // at the grey midpoints where a mechanical blend would wash it out.
    textMuted: darkForeground ? 'rgb(53, 67, 82)' : 'rgb(195, 205, 216)',
    textSoft: darkForeground ? 'rgb(85, 100, 116)' : 'rgb(151, 165, 180)',
    // Claude is deliberately orange, not beige: identity has to survive the
    // cream surface at the light end of the scale.
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
  const channel = (index: number) => Math.round(a[index]! + (b[index]! - a[index]!) * amount);
  const alpha = a[3]! + (b[3]! - a[3]!) * amount;
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
