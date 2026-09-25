import type { AgentEvent, AgentId, ChangeSet, RunUsage } from '@axune/protocol';

/**
 * What a run looks like on the phone, and how an event changes it.
 *
 * Extracted from WorkspaceContext because that file imports React Native and
 * therefore cannot be loaded under Node - which meant the one part of it with
 * real behaviour, and the only part whose cost grows with the size of a run,
 * could not be tested at all. Every extraction like this in the project so far
 * has found something on its first run.
 */
export interface LiveRun {
  runId: string;
  prompt: string;
  /** Streamed assistant text, accumulated from message_delta. */
  text: string;
  activity: ActivityLine[];
  /**
   * Which agent produced this run.
   *
   * Every `AgentEvent` has carried this since the protocol was written and the
   * phone threw it away on arrival, so four separate places hardcoded
   * `AGENTS.claude` and rendered every run as Claude Code in Claude's colours.
   * Invisible while there is one agent, and the first thing that breaks when
   * there are two.
   */
  agentId: AgentId;
  status: 'working' | 'finished' | 'stopped' | 'failed';
  outcome: string | null;
  /**
   * Why it failed, in words, when the desktop said.
   *
   * Separate from `outcome`, which carries either a status word from
   * `run_finished` or an error message from `error`, depending on which
   * arrived last. That overloading is how the reason went missing: the message
   * was stored and then never read, so a failed run rendered as the single
   * word "failed" while the desktop had already sent an explanation.
   */
  error: string | null;
  /** For elapsed time, and for spotting a run that has gone quiet. */
  startedAt: number | null;
  lastEventAt: number | null;
  /** True when this run was allowed to edit files. */
  write: boolean;
  /** What it produced, once finished. Null while running or for read runs. */
  changes: ChangeSet | null;
  /**
   * What this run consumed, when the provider said.
   *
   * Null rather than zero when absent: a run whose usage was not reported must
   * read as unknown, not as free.
   */
  usage: RunUsage | null;
  /** Set once the user has kept or discarded the branch. */
  decision: 'keep' | 'discard' | null;
  /**
   * Part of this run is permanently missing from what the phone holds.
   *
   * Set when the desktop says its replay could not go back far enough - a long
   * run whose earliest events were trimmed out of the registry before this
   * phone asked for them. It is not a failure and not a truncation for storage:
   * the run ran fine, and what is shown is genuinely incomplete.
   *
   * Carried on the run rather than shown as a banner, because a banner is gone
   * by the time anyone scrolls back to read the reply - and a reply missing its
   * middle with nothing saying so is indistinguishable from a complete one.
   */
  incomplete: boolean;
}

export interface ActivityLine {
  id: string;
  label: string;
  ok: boolean | null;
  /** The file or command, so "Read" can say what it read. */
  detail?: string;
  /**
   * The provider's id for this tool call, so finishing one updates the row it
   * started rather than adding another.
   */
  callId?: string;
}

/**
 * One event applied to one run.
 *
 * Pure, and exported so it can be attacked at the size a real run reaches
 * rather than the size a test usually does - which is how the quadratic scan
 * and the uncapped activity list above were found.
 */
export function reduceRun(run: LiveRun, event: AgentEvent, at: number = Date.now()): LiveRun {
  switch (event.type) {
    case 'run_started':
      // `at`, not `Date.now()`: a replayed run_started must not restart the
      // clock at the moment of replay.
      //
      // Text and activity are cleared, which matters only on a full replay.
      // `message_delta` appends, so replaying a run from its beginning onto a
      // copy that already holds part of the reply concatenates the two - the
      // reply comes back reading "The answer is parThe answer is partly yes."
      // Seeing run_started at all means the run is being told from the start,
      // so whatever was accumulated before it is about to be re-sent.
      //
      // A live run is unaffected: it is created empty and run_started arrives
      // once. A partial reconnect is unaffected: run_started has already been
      // seen, so it is not in the replayed slice.
      return {
        ...run,
        prompt: event.prompt || run.prompt,
        status: 'working',
        startedAt: at,
        text: '',
        activity: [],
        error: null,
      };
    case 'message_delta':
      return { ...run, text: run.text + event.text };
    case 'tool_started':
      return {
        ...run,
        activity: trim([
          ...run.activity,
          {
            id: `${event.seq}`,
            callId: event.toolCallId,
            label: event.toolName,
            ok: null,
            detail: shortDetail(event.input),
          },
        ]),
      };
    case 'tool_finished': {
      // Searched newest-first. A tool finishes close to when it started, so the
      // row being resolved is almost always near the end - and scanning from
      // the front made this quadratic over a long run: 4x the calls cost 10x
      // the time before the list was capped and this was reversed.
      // Resolve the row this call started rather than appending another. The
      // list previously grew two entries per tool - "Read" then "done" - which
      // is how a handful of file reads became a screen of noise.
      let index = -1;
      for (let i = run.activity.length - 1; i >= 0; i -= 1) {
        const line = run.activity[i]!;
        if (line.callId === event.toolCallId && line.ok === null) {
          index = i;
          break;
        }
      }
      // Why, when it did not work. The desktop sends `Denied: <reason>` here
      // and the reason was thrown away, so a refusal rendered as a row saying
      // "denied" and nothing else - on the one screen where knowing what was
      // refused is the entire point. Kept only for failures: a successful
      // tool's output is file contents, which belongs in the reply rather than
      // in a status line.
      const reason = !event.ok && event.output ? shortReason(event.output) : undefined;

      if (index < 0) {
        // A finish with no start: worth showing rather than dropping, since it
        // means the desktop refused something before the call was announced.
        return {
          ...run,
          activity: [
            ...run.activity,
            {
              id: `${event.seq}`,
              label: event.ok ? 'done' : 'denied',
              ok: event.ok,
              ...(reason ? { detail: reason } : {}),
            },
          ],
        };
      }
      const activity = [...run.activity];
      activity[index] = {
        ...activity[index]!,
        ok: event.ok,
        // The path a Read announced is less useful than the reason it was
        // refused, so a failure's reason replaces it.
        ...(reason ? { detail: reason } : {}),
      };
      return { ...run, activity };
    }
    case 'run_finished':
      return {
        ...run,
        status:
          event.outcome === 'completed'
            ? 'finished'
            : event.outcome === 'stopped'
              ? 'stopped'
              : 'failed',
        outcome: event.outcome,
        // Kept if the provider reported nothing this time, so a resumed run
        // does not lose the figure it already had.
        usage: event.usage ?? run.usage,
      };
    case 'error':
      // A recoverable error is a note, not an ending - the run carries on, and
      // marking it failed here would have the card contradict the reply still
      // arriving underneath it.
      return event.recoverable
        ? { ...run, error: event.message }
        : { ...run, status: 'failed', outcome: event.message, error: event.message };
    default:
      return run;
  }
}

/**
 * A tool failure, short enough for one line.
 *
 * Tool output can be a stack trace or a page of shell noise. The first
 * non-empty line is nearly always the sentence worth reading - "Denied: this
 * run is read-only" - and what follows is context nobody scrolls a status row
 * to find.
 */
function shortReason(output: string): string {
  const first = output.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const trimmed = first.replace(/^Denied:\s*/i, '');
  return trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
}

/** Pull a filename or command out of a tool input for a one-line label. */
function shortDetail(input: string): string | undefined {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const value = parsed['file_path'] ?? parsed['pattern'] ?? parsed['command'];
    if (typeof value !== 'string') return undefined;
    // Both separators: these paths come from a Windows desktop, so splitting on
    // the forward slash alone leaves the whole `C:\dev\axune\...` prefix in a
    // label meant to be a filename. The backslash was lost moving this file.
    const tail = value.split(/[\\/]/).pop() ?? value;
    return tail.length > 42 ? `${tail.slice(0, 42)}…` : tail;
  } catch {
    return undefined;
  }
}

/**
 * How many tool rows a live run keeps.
 *
 * `threadShrink` caps this at 120 when writing to disk, and nothing capped it
 * while a run was in flight - so a read-heavy investigation grew the array
 * without bound and every completion scanned all of it. Larger than the
 * persisted cap on purpose: what is on screen during a run should not be
 * narrower than what survives it.
 */
const MAX_LIVE_ACTIVITY = 200;

function trim(lines: ActivityLine[]): ActivityLine[] {
  return lines.length > MAX_LIVE_ACTIVITY ? lines.slice(-MAX_LIVE_ACTIVITY) : lines;
}
