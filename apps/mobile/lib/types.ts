import type { AgentId } from '@/constants/agents';

export type SessionMode = 'paired' | 'independent';

export type SessionIconKind = 'product' | 'code' | 'research' | 'insights';

export interface AgentTurn {
  agentId: AgentId;
  answer: string;
  followUp: string;
}

export interface Session {
  id: string;
  title: string;
  project: string;
  branch: string;
  mode: SessionMode;
  updatedAtLabel: string;
  icon: SessionIconKind;
  prompt: string;
  turns: AgentTurn[];
}

export interface InsightSummary {
  agreements: string;
  claudeAdds: string;
  codexAdds: string;
  recommendation: string;
}

export interface SuggestedPrompt {
  id: string;
  label: string;
  glyph: string;
  text: string;
}
