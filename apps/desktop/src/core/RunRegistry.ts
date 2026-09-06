import type { AgentEvent } from '@axune/protocol';

/**
 * Keeps every event a run has emitted, so a phone that drops off Wi-Fi can
 * reconnect and be caught up rather than losing the run.
 *
 * This is point twelve of the Phase 1 definition of done — "reconnecting does
 * not corrupt the session" — and it is the reason every event carries a
 * monotonic `seq`. Without a buffer, a reconnect can only either replay
 * everything or miss whatever arrived while the socket was down.
 */
export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();

  /** Per-run cap, so a long run cannot grow memory without bound. */
  constructor(private readonly maxEventsPerRun = 5_000) {}

  open(runId: string): void {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, { runId, events: [], droppedBefore: 0, finished: false });
    }
  }

  record(event: AgentEvent): void {
    this.open(event.runId);
    const record = this.runs.get(event.runId)!;
    record.events.push(event);

    if (record.events.length > this.maxEventsPerRun) {
      const overflow = record.events.length - this.maxEventsPerRun;
      record.events.splice(0, overflow);
      // Remember what was discarded so a replay can admit the gap instead of
      // pretending the run started later than it did.
      record.droppedBefore = record.events[0]?.seq ?? record.droppedBefore;
    }

    if (event.type === 'run_finished') record.finished = true;
  }

  /**
   * Events the phone has not seen yet. `lastSeq` is the highest it holds; pass
   * -1 for "I have nothing".
   */
  since(runId: string, lastSeq: number): ReplaySlice {
    const record = this.runs.get(runId);
    if (!record) return { events: [], gap: false, finished: false };

    const events = record.events.filter((e) => e.seq > lastSeq);
    // A gap exists when the oldest event we still hold is newer than the next
    // one the phone expects — the missing events were trimmed.
    const oldestHeld = record.events[0]?.seq ?? 0;
    const gap = lastSeq >= 0 && oldestHeld > lastSeq + 1;

    return { events, gap, finished: record.finished };
  }

  isKnown(runId: string): boolean {
    return this.runs.has(runId);
  }

  forget(runId: string): void {
    this.runs.delete(runId);
  }

  get size(): number {
    return this.runs.size;
  }
}

interface RunRecord {
  runId: string;
  events: AgentEvent[];
  droppedBefore: number;
  finished: boolean;
}

export interface ReplaySlice {
  events: AgentEvent[];
  /** True when some events were trimmed and cannot be replayed. */
  gap: boolean;
  finished: boolean;
}
