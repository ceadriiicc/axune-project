import { color } from './theme';

export type AgentId = 'claude' | 'codex';

export const AGENTS: Record<
  AgentId,
  {
    id: AgentId;
    name: string;
    glyph: string;
    accent: string;
    accentStrong: string;
    accentText: string;
    bubbleBg: string;
    bubbleText: string;
    iconBg: string;
    iconText: string;
  }
> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    glyph: '✺',
    accent: color.claude,
    accentStrong: color.claudeStrong,
    accentText: color.claudeText,
    bubbleBg: color.claudeBubble,
    bubbleText: color.claudeBubbleText,
    iconBg: color.claudeIconBg,
    iconText: color.claudeIconText,
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    glyph: '◌',
    accent: color.codex,
    accentStrong: color.codexStrong,
    accentText: color.codexText,
    bubbleBg: color.codexBubble,
    bubbleText: color.codexBubbleText,
    iconBg: color.codexIconBg,
    iconText: color.codexIconText,
  },
};

export const AGENT_ORDER: AgentId[] = ['claude', 'codex'];
