import type { InsightSummary, Session, SuggestedPrompt } from './types';

export const SESSIONS: Session[] = [
  {
    id: 'product',
    title: 'Product direction sprint',
    project: 'Mediway',
    branch: 'main',
    mode: 'paired',
    updatedAtLabel: 'Today, 9:41 AM',
    icon: 'product',
    prompt: 'What are the top 3 opportunities for our product in the next 12 months?',
    turns: [
      {
        agentId: 'claude',
        answer:
          '1. Expand into adjacent use cases to increase product stickiness.\n\n2. Build strategic partnerships to accelerate distribution.\n\n3. Invest in AI-driven features to differentiate and save users time.',
        followUp: 'Want me to elaborate on any of these?',
      },
      {
        agentId: 'codex',
        answer:
          '1. Enter underserved segments with tailored solutions.\n\n2. Strengthen integrations to become part of core workflows.\n\n3. Improve onboarding experience to drive activation and retention.',
        followUp: "I can break these down further if you'd like.",
      },
    ],
  },
  {
    id: 'code',
    title: 'Code review and implementation',
    project: 'Mediway',
    branch: 'feature/appointments',
    mode: 'paired',
    updatedAtLabel: 'Yesterday, 3:15 PM',
    icon: 'code',
    prompt: 'Review this mobile UI code and suggest the best improvements.',
    turns: [
      {
        agentId: 'claude',
        answer:
          '1. Tighten component extraction for repeated cards and toggles.\n\n2. Improve spacing consistency and hit areas for buttons.\n\n3. Add a stronger state system for paired vs independent interactions.',
        followUp: 'I can start with the component extraction if you want.',
      },
      {
        agentId: 'codex',
        answer:
          '1. Standardize design tokens for colors, radius, and spacing.\n\n2. Separate navigation, screen data, and message logic for maintainability.\n\n3. Add accessibility passes for labels, contrast, and tap targets.',
        followUp: 'Happy to open a diff for the token pass.',
      },
    ],
  },
  {
    id: 'gtm',
    title: 'Go-to-market strategy',
    project: 'Mediway',
    branch: 'main',
    mode: 'independent',
    updatedAtLabel: 'May 12, 2025 • 10:30 AM',
    icon: 'research',
    prompt: 'Outline a go-to-market plan for the next release.',
    turns: [
      {
        agentId: 'claude',
        answer:
          '1. Define the audience clearly.\n\n2. Build a short launch sequence with credibility assets.\n\n3. Focus on one strong conversion path.',
        followUp: 'Want a draft launch timeline?',
      },
      {
        agentId: 'codex',
        answer:
          '1. Lead with positioning and product clarity.\n\n2. Build a simple audience-specific landing page.\n\n3. Support it with content, outreach, and onboarding.',
        followUp: 'I can sketch the landing page structure next.',
      },
    ],
  },
  {
    id: 'research',
    title: 'Customer research insights',
    project: 'Mediway',
    branch: 'main',
    mode: 'independent',
    updatedAtLabel: 'May 10, 2025',
    icon: 'research',
    prompt: 'Summarize the recurring themes from recent customer interviews.',
    turns: [
      {
        agentId: 'claude',
        answer:
          '1. Scheduling friction comes up in most interviews.\n\n2. Users want faster confirmation after booking.\n\n3. Trust signals matter more than feature count.',
        followUp: 'I can group these by persona if useful.',
      },
      {
        agentId: 'codex',
        answer:
          '1. Appointment reminders are frequently requested.\n\n2. Support response time is a recurring complaint.\n\n3. Mobile users drop off during long forms.',
        followUp: 'Want me to map these to backlog items?',
      },
    ],
  },
];

export function getSession(id: string): Session | undefined {
  return SESSIONS.find((s) => s.id === id);
}

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { id: 'validate', label: 'Validate a product idea', glyph: '◌', text: 'Validate a product idea' },
  { id: 'review', label: 'Review this code', glyph: '</>', text: 'Review this code' },
  { id: 'market', label: 'Market analysis', glyph: '▤', text: 'Market analysis' },
  { id: 'improve', label: 'Improve this content', glyph: '✎', text: 'Improve this content' },
  { id: 'launch', label: 'Create a launch plan', glyph: '✈', text: 'Create a launch plan' },
];

const FAKE_REPLIES: Record<'claude' | 'codex', (prompt: string) => string> = {
  claude: (prompt) => {
    if (/launch/i.test(prompt))
      return '1. Define the audience clearly.\n\n2. Build a short launch sequence with credibility assets.\n\n3. Focus on one strong conversion path.';
    if (/code|review/i.test(prompt))
      return '1. Reduce repeated UI code into reusable components.\n\n2. Improve state handling between views.\n\n3. Clean up naming for easier maintenance.';
    if (/market/i.test(prompt))
      return '1. Start with the narrowest paying user group.\n\n2. Validate demand with direct outreach.\n\n3. Learn which workflow hurts enough to pay for.';
    if (/improve|content/i.test(prompt))
      return '1. Tighten the opening line so the value is obvious immediately.\n\n2. Cut sections that repeat the same point.\n\n3. End with one clear next step.';
    return '1. Clarify the desired outcome.\n\n2. Structure the request into criteria.\n\n3. Then compare options based on those criteria.';
  },
  codex: (prompt) => {
    if (/launch/i.test(prompt))
      return '1. Lead with positioning and product clarity.\n\n2. Build a simple audience-specific landing page.\n\n3. Support it with content, outreach, and onboarding.';
    if (/code|review/i.test(prompt))
      return '1. Centralize design tokens and layout rules.\n\n2. Separate interaction logic from presentation.\n\n3. Add accessible labels and predictable navigation.';
    if (/market/i.test(prompt))
      return '1. Size the niche and understand willingness to pay.\n\n2. Identify obvious competitors and alternatives.\n\n3. Find a message that makes the product instantly clear.';
    if (/improve|content/i.test(prompt))
      return '1. Lead with the strongest claim first.\n\n2. Simplify sentence structure throughout.\n\n3. Add a single, specific call to action.';
    return '1. Define what good looks like.\n\n2. Compare trade-offs, not just features.\n\n3. Choose the option with the strongest long-term leverage.';
  },
};

export function fakeAgentReply(agentId: 'claude' | 'codex', prompt: string): string {
  return FAKE_REPLIES[agentId](prompt);
}

export function fakeInsights(session: Pick<Session, 'title'>): InsightSummary {
  return {
    agreements:
      'Both agents emphasize expanding into new markets, strengthening integrations, and improving user experience to drive growth.',
    claudeAdds:
      'Claude highlights strategic partnerships and AI-driven features as key areas to create competitive advantage.',
    codexAdds:
      'Codex focuses on underserved segments and onboarding improvements to boost activation and retention.',
    recommendation: `Validate opportunities in adjacent use cases and prioritize one high-impact area to prototype for "${session.title}".`,
  };
}
