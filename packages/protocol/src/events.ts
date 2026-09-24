// The one event model every agent adapter translates its provider output into.
// Mobile never parses provider-specific terminal output — it only reads these events.

export type AgentId = 'claude-code' | 'codex' | 'gemini-cli';

export type RunMode = 'paired' | 'independent';

export interface EventEnvelope {
  /** Monotonic per-run sequence number, used to detect gaps after a reconnect. */
  seq: number;
  runId: string;
  sessionId: string;
  agentId: AgentId;
  /** Epoch milliseconds, set on the desktop. */
  ts: number;
}

export type AgentEvent = EventEnvelope &
  (
    | { type: 'run_started'; prompt: string; mode: RunMode; branch: string; worktreePath: string | null }
    | { type: 'working'; label: string }
    | { type: 'waiting'; label: string }
    | { type: 'message_delta'; text: string }
    | { type: 'tool_started'; toolCallId: string; toolName: string; input: string }
    | { type: 'tool_finished'; toolCallId: string; ok: boolean; output: string }
    | { type: 'command_started'; commandId: string; command: string; cwd: string }
    | { type: 'command_output'; commandId: string; stream: 'stdout' | 'stderr'; chunk: string }
    | { type: 'file_changed'; path: string; change: 'created' | 'modified' | 'deleted' }
    | { type: 'approval_requested'; approvalId: string; summary: string; risk: ApprovalRisk; detail: string }
    | { type: 'approval_resolved'; approvalId: string; decision: 'approved' | 'rejected'; decidedBy: 'user' | 'timeout' }
    | {
        type: 'run_finished';
        outcome: 'completed' | 'stopped' | 'failed';
        /** What the run consumed, when the provider said. Absent when it did not. */
        usage?: RunUsage;
      }
    | { type: 'error'; message: string; recoverable: boolean }
  );

export type AgentEventType = AgentEvent['type'];

export type ApprovalRisk = 'read' | 'write' | 'command' | 'network';

export type RunStatus = 'starting' | 'working' | 'waiting' | 'finished' | 'failed' | 'stopped';

/**
 * What one run consumed.
 *
 * ## Why this exists
 *
 * Axune drives an agent on the user's own subscription, so a run is not billed
 * and cannot produce a surprise invoice. What it can produce is a surprise
 * *limit*: an allowance spent on a loop nobody noticed, and then runs that fail
 * for a reason the phone cannot explain.
 *
 * The provider already reports all of this at the end of every run and Axune
 * discarded it, inspecting the result message for its subtype and nothing else.
 * A trivial "reply with one word" prompt turned out to consume 37,242 tokens -
 * almost all of it cache creation - which is exactly the sort of number that
 * makes "why did I run out after six questions" answerable rather than
 * mysterious.
 *
 * ## On the cost figure
 *
 * `costUsd` is what the same work would have cost through the API. It is **not**
 * a charge: nothing here is billed to anyone, because the run happens on a
 * subscription the user already pays for. It is carried because it is the one
 * number that makes token counts comparable across models, and it must be
 * labelled as an equivalent wherever it is shown - presenting it as money spent
 * would be a lie about how the product works.
 */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  /** Written to the provider's cache. Usually the largest number by far. */
  cacheCreationTokens: number;
  /** Served from cache - the cheap half, and what a resumed conversation reuses. */
  cacheReadTokens: number;
  /** API-equivalent cost, not a charge. See above. */
  costUsd: number | null;
  /** Provider turns, which is not the same as tool calls. */
  turns: number | null;
  durationMs: number | null;
}

/** Every token this run moved, cached or not. The single number worth showing first. */
export function totalTokens(usage: RunUsage): number {
  return (
    usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
  );
}
