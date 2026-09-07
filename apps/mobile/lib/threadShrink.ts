import type { LiveRun, RunSummary, Thread } from './WorkspaceContext';

/**
 * What gets stored, and what gets left out.
 *
 * Kept apart from the file access in `threadStore` so it can be exercised in
 * plain Node. Caps and validation are exactly the code that fails silently:
 * a bad shape here either loses a conversation or crashes the app on launch,
 * and neither shows up in a typecheck.
 */

/** Bumped when the shape changes, so an old file is ignored rather than misread. */
const FILE = 'threads.v1.json';

/**
 * Caps. Agent output is unbounded — a single run can emit tens of thousands of
 * characters, and this file is read and written on the JS thread. These keep it
 * to a few hundred kilobytes at worst, at the price of truncating the oldest
 * and longest material.
 */
const MAX_THREADS = 20;
const MAX_RUNS_PER_THREAD = 30;
const MAX_TEXT = 16_000;
const MAX_ACTIVITY = 120;
const MAX_PATCH = 6_000;
const MAX_HISTORY = 60;
/**
 * Archived threads get a tighter cap than the open conversation. They are read
 * for their gist and reopened for their session id; the full exchange is still
 * on the desktop.
 */
const MAX_ARCHIVED_TEXT = 5_000;
/**
 * A ceiling on the whole file.
 *
 * Per-run caps alone are not enough: twenty threads of thirty capped runs came
 * to nearly ten megabytes, written synchronously on the JS thread every couple
 * of seconds. Dropping the oldest whole conversations is the honest way to stay
 * under it - a shorter list is visible, whereas quietly gutting every thread
 * would leave them all looking complete.
 */
const MAX_TOTAL_CHARS = 600_000;

export interface PersistedWorkspace {
  /** The conversation that was open, so a force-quit mid-thread loses nothing. */
  conversation: LiveRun[];
  /** The id the desktop keys the agent's resumable session off. */
  conversationId: string | null;
  threads: Thread[];
  history: RunSummary[];
  /** Which project these belong to, so restored threads are never mislabelled. */
  projectName: string | null;
  savedAt: number;
}

/**
 * Reduce a whole workspace to the version that goes on disk.
 *
 * Order matters: newest threads survive and oldest are dropped, because the
 * conversation set aside an hour ago is the one someone comes back for.
 */
export function shrink(state: Omit<PersistedWorkspace, 'savedAt'>): PersistedWorkspace {
  const payload: PersistedWorkspace = {
    // The open conversation is what the user is looking at, so it is kept at
    // full size and never traded away for room to store archives.
    conversation: state.conversation.slice(-MAX_RUNS_PER_THREAD).map((run) => trimRun(run, MAX_TEXT)),
    conversationId: state.conversationId,
    threads: [],
    history: state.history.slice(0, MAX_HISTORY),
    projectName: state.projectName,
    savedAt: Date.now(),
  };

  let used = JSON.stringify(payload).length;

  // Newest first, so running out of room costs the oldest conversation rather
  // than the one set aside a moment ago.
  for (const thread of state.threads.slice(0, MAX_THREADS)) {
    const trimmed: Thread = {
      ...thread,
      runs: thread.runs.slice(-MAX_RUNS_PER_THREAD).map((run) => trimRun(run, MAX_ARCHIVED_TEXT)),
    };
    const cost = JSON.stringify(trimmed).length;
    if (used + cost > MAX_TOTAL_CHARS) break;
    payload.threads.push(trimmed);
    used += cost;
  }

  return payload;
}

/**
 * Rebuild a workspace from whatever was on disk.
 *
 * Treats the file as untrusted: it may come from a crashed save, a previous
 * version of the app, or a write that ran out of space halfway. Anything
 * that does not look right is dropped rather than handed to the UI.
 */
export function revive(parsed: unknown): PersistedWorkspace | null {
  const raw = parsed as Partial<PersistedWorkspace> | null;
  if (!raw || !Array.isArray(raw.threads) || !Array.isArray(raw.conversation)) return null;
  return {
    conversation: raw.conversation.filter(isRun),
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
    threads: raw.threads.filter(isThread).map((thread) => ({
      ...thread,
      runs: thread.runs.filter(isRun),
    })),
    history: Array.isArray(raw.history) ? raw.history.filter(isSummary) : [],
    projectName: typeof raw.projectName === 'string' ? raw.projectName : null,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

/**
 * Shrink one run to something worth storing.
 *
 * The patch is the largest thing a run carries, and it is kept rather than
 * dropped: an undecided review is the single worst thing to lose, since the
 * user came back specifically to answer it. Capped instead, with the cap
 * stated in the text so a truncated diff is never mistaken for a whole one.
 */
function trimRun(run: LiveRun, textLimit: number): LiveRun {
  return {
    ...run,
    text: cap(run.text, textLimit, 'reply'),
    activity: run.activity.slice(-MAX_ACTIVITY),
    changes: run.changes
      ? { ...run.changes, patch: cap(run.changes.patch, MAX_PATCH, 'diff') }
      : null,
    // A run still working when the app closed is not working now, and must
    // not come back claiming to be. Its events live on the desktop, not here.
    ...(run.status === 'working'
      ? { status: 'stopped' as const, outcome: run.outcome ?? 'interrupted when the app closed' }
      : {}),
  };
}

function cap(value: string, limit: number, what: string): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}

… ${what} truncated to fit on the device`;
}

function isRun(value: unknown): value is LiveRun {
  const run = value as LiveRun | null;
  return Boolean(run && typeof run.runId === 'string' && typeof run.text === 'string');
}

function isThread(value: unknown): value is Thread {
  const thread = value as Thread | null;
  return Boolean(thread && typeof thread.id === 'string' && Array.isArray(thread.runs));
}

function isSummary(value: unknown): value is RunSummary {
  const summary = value as RunSummary | null;
  return Boolean(summary && typeof summary.runId === 'string' && typeof summary.prompt === 'string');
}
