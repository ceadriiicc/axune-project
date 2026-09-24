import type { AgentId } from '@axune/protocol';

import { color } from './theme';

/**
 * How each agent looks on the phone.
 *
 * ## Keyed by the protocol's own ids, deliberately
 *
 * This used to define its own `AgentId` of `'claude' | 'codex'` while every
 * event on the wire carries `'claude-code' | 'codex' | 'gemini-cli'`. Nothing
 * mapped between them, so `AGENTS['claude-code']` was `undefined` — and the one
 * file that indexed this map by an event's id was dead code, which is the only
 * reason it never crashed.
 *
 * Importing the protocol type instead of restating it means a new agent cannot
 * be added to the wire without the compiler demanding a look for it here.
 * `Record<AgentId, …>` is doing real work: it will not compile with an agent
 * missing.
 */
export interface AgentLook {
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

export const AGENTS: Record<AgentId, AgentLook> = {
  'claude-code': {
    id: 'claude-code',
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
  // No dedicated palette yet: the theme defines warm sand for Claude and teal
  // for Codex, and a third agent was never designed for. Purple is borrowed
  // rather than invented so Gemini is visibly *not* either of the other two,
  // which is the only property that matters until it earns a real one.
  'gemini-cli': {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    glyph: '◇',
    accent: color.purpleIconBg,
    accentStrong: color.purpleIconBg,
    accentText: color.purpleIconText,
    bubbleBg: color.panelAlt,
    bubbleText: color.text,
    iconBg: color.purpleIconBg,
    iconText: color.purpleIconText,
  },
};

/**
 * Display order. Claude first because it is the one that is built; the rest
 * follow in the order they became real.
 */
export const AGENT_ORDER: AgentId[] = ['claude-code', 'codex', 'gemini-cli'];

/**
 * A look for an id that is not one we know.
 *
 * The desktop decides which agents exist, so a newer desktop can name one this
 * build has never heard of. Rendering nothing would make a real run invisible;
 * this makes it visible and obviously unstyled.
 */
export function lookFor(agentId: string): AgentLook {
  return (
    AGENTS[agentId as AgentId] ?? {
      id: agentId as AgentId,
      name: agentId,
      glyph: '•',
      accent: color.neutralIconBg,
      accentStrong: color.neutralIconBg,
      accentText: color.textMuted,
      bubbleBg: color.panelAlt,
      bubbleText: color.text,
      iconBg: color.neutralIconBg,
      iconText: color.neutralIconText,
    }
  );
}
