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
  /**
   * The run that was still working when this was written, if any.
   *
   * Without it a run interrupted by a force-quit is lost for good. `trimRun`
   * rewrites its status to `stopped` - correctly, since it is certainly not
   * working now - and that rewrite is the only record that it ever was. The
   * desktop kept going and holds the result; nothing on the phone knew to ask.
   *
   * So the id is captured before the rewrite happens, and the client resumes
   * with it rather than with `none`. At most one run is ever working at a time,
   * which is why this is a single id rather than a list.
   */
  interruptedRunId: string | null;
  savedAt: number;
}

/**
 * What a caller supplies. `interruptedRunId` is derived here rather than passed
 * in, because it is a fact about the conversation being saved and not a
 * separate decision - asking every call site to work it out is how two of them
 * end up disagreeing.
 */
export type WorkspaceToSave = Omit<PersistedWorkspace, 'savedAt' | 'interruptedRunId'>;

/**
 * Reduce a whole workspace to the version that goes on disk.
 *
 * Order matters: newest threads survive and oldest are dropped, because the
 * conversation set aside an hour ago is the one someone comes back for.
 */
export function shrink(state: WorkspaceToSave): PersistedWorkspace {
  // Captured before `trimRun` rewrites the status, which is the moment the
  // information stops existing.
  const interrupted = state.conversation.find((run) => run.status === 'working') ?? null;

  const payload: PersistedWorkspace = {
    // The open conversation is what the user is looking at, so it is kept at
    // full size and never traded away for room to store archives.
    conversation: state.conversation.slice(-MAX_RUNS_PER_THREAD).map((run) => trimRun(run, MAX_TEXT)),
    conversationId: state.conversationId,
    threads: [],
    history: state.history.slice(0, MAX_HISTORY),
    projectName: state.projectName,
    interruptedRunId: interrupted?.runId ?? null,
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
    conversation: raw.conversation.filter(isRun).map(reviveRun),
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
    threads: raw.threads.filter(isThread).map((thread) => ({
      ...thread,
      runs: thread.runs.filter(isRun).map(reviveRun),
    })),
    history: Array.isArray(raw.history) ? raw.history.filter(isSummary) : [],
    projectName: typeof raw.projectName === 'string' ? raw.projectName : null,
    // Absent in files written before this existed, which is not an error - it
    // means that launch had nothing in flight worth asking about.
    interruptedRunId: typeof raw.interruptedRunId === 'string' ? raw.interruptedRunId : null,
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
    // A thread written by a build that predates this field arrives without it.
    // Defaulted here rather than left undefined so a restored run cannot be a
    // shape the rest of the app does not expect.
    error: run.error ?? null,
    // Defaulted for the same reason as error: a thread from a build before
    // usage existed must not come back as a shape the app does not expect.
    usage: run.usage ?? null,
    // Persisted rather than recomputed: the desktop's registry may well have
    // forgotten the run entirely by the next launch, so if this is not carried
    // across, a reply missing its middle quietly becomes a complete-looking one.
    incomplete: run.incomplete ?? false,
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

/**
 * Fill in fields a file written by an older build does not have.
 *
 * `trimRun` defaults these on the way *out*, with a comment saying a restored
 * run must not be a shape the rest of the app does not expect - but a file
 * written before a field existed has never been through `trimRun` with that
 * field in it. So the defaulting has to happen on the way *in* as well, and
 * this is the only place that sees every restored run.
 *
 * Found when `incomplete` arrived and came back `undefined`; `error` and
 * `usage` had the same hole and were merely harmless about it, because a
 * falsy check happened to do the right thing for both.
 */
function reviveRun(run: LiveRun): LiveRun {
  return {
    ...run,
    error: run.error ?? null,
    usage: run.usage ?? null,
    changes: run.changes ?? null,
    decision: run.decision ?? null,
    activity: Array.isArray(run.activity) ? run.activity : [],
    incomplete: run.incomplete ?? false,
  };
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
