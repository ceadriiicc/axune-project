// Axune brand tokens.
//
// Two palettes with identical keys, chosen at runtime by `lib/ThemeContext`.
// Dark-only was the MVP decision and Cedric replaced it on 2026-09-09 with a
// light default in the spirit of Claude's own interface, plus a toggle.
//
// A component must read its colours from `useTheme().palette`, never from the
// `color` export below: `StyleSheet.create` captures values at module load, so
// a static import can never respond to the toggle. `color` remains only as the
// dark palette's definition and as a fallback outside the provider.
export const color = {
  bg: '#11161d',
  screen: '#111820',
  panel: '#1a222c',
  panelAlt: '#202a36',
  surface: 'rgba(255,255,255,0.035)',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',

  text: '#f7f9fb',
  textMuted: '#b0bbc8',
  textSoft: '#7e8b9b',

  claude: '#d8ad7b',
  claudeStrong: '#c99358',
  claudeText: '#f0c291',
  claudeBubble: '#4e3b2b',
  claudeBubbleText: '#f7e8d6',
  claudeIconBg: '#60462d',
  claudeIconText: '#f0d8bf',

  codex: '#6eb8bb',
  codexStrong: '#4f9fa5',
  codexText: '#8ad8dc',
  codexBubble: '#274247',
  codexBubbleText: '#ddf6f7',
  codexIconBg: '#24474e',
  codexIconText: '#bfe8ea',

  neutralIconBg: '#3b434d',
  neutralIconText: '#e7edf3',
  purpleIconBg: '#453d72',
  purpleIconText: '#e5ddff',

  ok: '#7ac099',
  danger: '#cc7c7c',
  info: '#b5dcff',
} as const;

/**
 * The light palette. Paper rather than a spreadsheet: a warm off-white ground,
 * warm dark-grey text instead of black, and separation by tone and hairlines
 * rather than shadow.
 *
 * The agent identity colours are not inversions. Claude's muted sand was
 * chosen against near-black and is close to invisible on off-white, so it
 * deepens to a terracotta that still reads as the same identity; Codex's teal
 * does the same. Anything carrying text meaning is darkened until it is
 * legible on the ground it sits on, and no state is signalled by colour alone.
 */
export const lightColor: Palette = {
  bg: '#f7f5ef',
  screen: '#faf9f5',
  panel: '#ffffff',
  panelAlt: '#f2efe7',
  surface: 'rgba(38,34,28,0.028)',
  line: 'rgba(38,34,28,0.10)',
  lineStrong: 'rgba(38,34,28,0.20)',

  text: '#26241f',
  textMuted: '#5c584f',
  textSoft: '#8a857a',

  claude: '#b3763c',
  claudeStrong: '#955d29',
  claudeText: '#7d4c1d',
  claudeBubble: '#f4e6d4',
  claudeBubbleText: '#3a2a17',
  claudeIconBg: '#ecd8bd',
  claudeIconText: '#6b4620',

  codex: '#3d8d93',
  codexStrong: '#2c7176',
  codexText: '#1e5d63',
  codexBubble: '#ddeff0',
  codexBubbleText: '#16373a',
  codexIconBg: '#cde6e8',
  codexIconText: '#1d585d',

  neutralIconBg: '#e5e2da',
  neutralIconText: '#3a3833',
  purpleIconBg: '#e3ddf6',
  purpleIconText: '#3a3070',

  ok: '#3c8557',
  danger: '#ab453c',
  info: '#2c6b9f',
};

/** Every colour token, with the same keys in both palettes. */
export type Palette = { [K in keyof typeof color]: string };

export const palettes: Record<'light' | 'dark', Palette> = {
  dark: color,
  light: lightColor,
};

export const radius = {
  sm: 14,
  md: 18,
  lg: 22,
  xl: 30,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
} as const;

export const font = {
  title: 30,
  heading: 20,
  subheading: 17,
  body: 15,
  label: 13,
  caption: 12,
} as const;
