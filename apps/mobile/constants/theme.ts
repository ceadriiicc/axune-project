// Axune brand tokens. Dark-only for MVP — see AXUNE build brief.
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
