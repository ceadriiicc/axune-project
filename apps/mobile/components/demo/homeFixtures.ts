import type {
  ActivityEvent,
  AgentBranch,
  AgentStatus,
  GitSnapshot,
  ProjectSummary,
} from '@axune/protocol';
import type { LiveRun, RunSummary, Thread } from '@/lib/WorkspaceContext';

const now = Date.now();

export const demoGit: GitSnapshot = {
  lastCommitMessage: 'Refine mobile navigation hierarchy',
  lastCommitHash: '3bd14a7',
  lastCommitAt: now - 1000 * 60 * 42,
  dirtyFiles: 4,
  untrackedFiles: 1,
  insertions: 186,
  deletions: 43,
  ahead: 2,
  behind: 0,
  conflicts: 2,
  inProgress: 'rebase',
  detachedHead: false,
};

export const demoProject: ProjectSummary = {
  name: 'axune',
  path: 'C:/dev/axune',
  branch: 'feature/mobile-home',
  isGitRepo: true,
  git: demoGit,
};

export const demoAgents: AgentStatus[] = [
  { agentId: 'claude-code', installed: true, version: '2.1.18', authenticated: 'unknown' },
];

export const demoLiveRun: LiveRun = {
  runId: 'demo-live-run',
  prompt: 'Map the mobile navigation and identify the next useful screen.',
  text: 'I am tracing the current navigation and comparing it with the session flow.',
  activity: [
    { id: 'read', label: 'Read', detail: 'app/(tabs)/_layout.tsx', ok: true },
    { id: 'search', label: 'Search', detail: 'sessions', ok: null },
  ],
  status: 'working',
  outcome: null,
  startedAt: now - 1000 * 60 * 8,
  lastEventAt: now - 1000 * 12,
  write: false,
  changes: null,
  decision: null,
};

export const demoHistory: RunSummary[] = [
  {
    runId: 'demo-finished-run',
    prompt: 'Explain why the pairing reconnect failed.',
    startedAt: now - 1000 * 60 * 120,
    finishedAt: now - 1000 * 60 * 105,
    outcome: 'completed',
    excerpt: 'The device was retaining an old address before trying the hostname candidate.',
    filesRead: 6,
    commands: 2,
  },
];

export const demoThreads: Thread[] = [
  {
    id: 'navigation-review',
    startedAt: now - 1000 * 60 * 60 * 3,
    runs: [
      {
        ...demoLiveRun,
        runId: 'navigation-review-run',
        status: 'finished',
        outcome: 'completed',
        text: 'The app currently has a useful Home, Sessions, and pairing flow. The session screen should make progress and decisions easier to scan.',
        startedAt: now - 1000 * 60 * 60 * 3,
        lastEventAt: now - 1000 * 60 * 60 * 2,
      },
    ],
  },
  {
    id: 'reconnect-debug',
    startedAt: now - 1000 * 60 * 60 * 26,
    runs: [
      {
        ...demoLiveRun,
        runId: 'reconnect-debug-run',
        prompt: 'Explain why the pairing reconnect failed.',
        status: 'finished',
        outcome: 'completed',
        text: 'The device retained an obsolete address before trying the hostname candidate.',
        startedAt: now - 1000 * 60 * 60 * 26,
        lastEventAt: now - 1000 * 60 * 60 * 25,
      },
    ],
  },
];

export const demoActivity: ActivityEvent[] = [
  {
    id: 'demo-activity-1',
    at: now - 1000 * 60 * 8,
    kind: 'run.started',
    summary: 'Claude started a read-only run',
    detail: 'Mobile navigation review',
  },
  {
    id: 'demo-activity-2',
    at: now - 1000 * 60 * 42,
    kind: 'git.commit',
    summary: 'New commit on feature/mobile-home',
    detail: '3bd14a7',
  },
];

export const demoBranches: AgentBranch[] = [
  {
    name: 'axune/claude-code/demo-run',
    subject: 'Refine mobile navigation hierarchy',
    at: now - 1000 * 60 * 60 * 3,
    files: 5,
  },
];
