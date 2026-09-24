import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { AgentId, RunUsage } from '@axune/protocol';

/**
 * What every run consumed.
 *
 * ## Why a ledger rather than a running total
 *
 * The obvious version adds usage up on the phone as runs finish. It is wrong in
 * three ways at once, all of them silent and all of them in the same direction:
 * stored history is capped, so a heavy day trims exactly the runs worth
 * counting; a run whose `run_finished` never reached the phone contributes
 * nothing; and a phone that was disconnected when a run happened never sees it
 * at all. The result looks precise and under-reports.
 *
 * The desktop has none of those problems. It sees every run whether a phone is
 * watching or not, and a ledger it owns can refuse to be trimmed by size.
 *
 * ## What it can and cannot tell you
 *
 * **Exact:** what Axune consumed, per run and per day, and which run was
 * expensive. These numbers are the provider's own, not estimates.
 *
 * **Not knowable, by anything available here:** how much of a plan is left,
 * when a limit resets, or what Claude Code run directly in a terminal used.
 * None of that is reported by the provider or visible to Axune, so nothing in
 * this file or above it may imply a percentage of a cap. A progress bar toward
 * a limit would be invented, and inventing it is worse than omitting it -
 * someone would stop asking questions based on a number that was made up.
 *
 * ## Unreported runs are recorded as unreported
 *
 * A run that failed before the provider answered has no usage. It is stored
 * with `usage: null` rather than zeroes, and counted separately, so a day's
 * total can say "and three runs reported nothing" instead of quietly implying
 * they were free. That distinction is the whole difference between a figure
 * worth acting on and a decorative one.
 */
export interface UsageEntry {
  runId: string;
  agentId: AgentId;
  /** First line of the prompt, so an expensive run can be recognised. Never the whole thing. */
  prompt: string;
  finishedAt: number;
  /** Null when the provider reported nothing - not zero. */
  usage: RunUsage | null;
}

export interface UsageDay {
  /** Local date, YYYY-MM-DD. Local because "today" is a human question. */
  date: string;
  runs: number;
  /** Runs that finished without the provider reporting anything. */
  unreported: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  heaviest: { prompt: string; tokens: number } | null;
}

export class UsageLedger {
  private entries: UsageEntry[] = [];

  constructor(
    private readonly file = defaultPath(),
    /**
     * Bounded by age only, deliberately.
     *
     * The other ledgers here also cap by count, which is right for them: an
     * activity feed is read newest-first and an old entry is merely stale. A
     * count cap on this one would corrupt the thing it exists to produce,
     * because a total computed from a trimmed list is not a total. Thirty days
     * of runs is a few hundred kilobytes at worst.
     */
    private readonly maxAgeMs = 30 * 24 * 60 * 60 * 1000,
  ) {
    this.load();
    this.prune();
  }

  /** Record one finished run. Called whatever the outcome, including failures. */
  record(runId: string, agentId: AgentId, prompt: string, usage: RunUsage | null): void {
    this.entries.push({
      runId,
      agentId,
      prompt: firstLine(prompt),
      finishedAt: Date.now(),
      usage,
    });
    this.prune();
    this.save();
  }

  /** Every entry, oldest first. For the suite and for a future detail view. */
  all(): UsageEntry[] {
    return [...this.entries];
  }

  /**
   * One day's totals.
   *
   * Local dates on purpose: a run at 23:50 belongs to the day the person
   * thinks it does, not to whatever UTC says.
   */
  day(when: Date = new Date()): UsageDay {
    const date = localDate(when);
    const totals: UsageDay = {
      date,
      runs: 0,
      unreported: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      heaviest: null,
    };

    for (const entry of this.entries) {
      if (localDate(new Date(entry.finishedAt)) !== date) continue;
      totals.runs += 1;
      if (!entry.usage) {
        totals.unreported += 1;
        continue;
      }
      const u = entry.usage;
      totals.inputTokens += u.inputTokens;
      totals.outputTokens += u.outputTokens;
      totals.cacheCreationTokens += u.cacheCreationTokens;
      totals.cacheReadTokens += u.cacheReadTokens;
      totals.costUsd += u.costUsd ?? 0;

      const tokens = u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
      if (!totals.heaviest || tokens > totals.heaviest.tokens) {
        totals.heaviest = { prompt: entry.prompt, tokens };
      }
    }

    return totals;
  }

  /** Forget everything. Part of "forget this machine", like the other ledgers. */
  clear(): number {
    const removed = this.entries.length;
    this.entries = [];
    this.save();
    return removed;
  }

  private prune(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    const kept = this.entries.filter((entry) => entry.finishedAt >= cutoff);
    if (kept.length !== this.entries.length) this.entries = kept;
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      // Total, like every other read of a file this project owns: a damaged
      // ledger must cost the history, never the launch.
      this.entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.entries));
    } catch {
      // Out of space, or a directory that vanished. Losing a usage record is
      // not worth interrupting a run over.
    }
  }
}

function isEntry(value: unknown): value is UsageEntry {
  const entry = value as UsageEntry | null;
  return Boolean(
    entry && typeof entry.runId === 'string' && typeof entry.finishedAt === 'number',
  );
}

/** Local YYYY-MM-DD. Not toISOString, which is UTC and shifts the boundary. */
function localDate(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

function firstLine(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function defaultPath(): string {
  const base = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
  return join(base, 'Axune', 'usage.json');
}
