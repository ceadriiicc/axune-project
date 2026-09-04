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
    | { type: 'run_finished'; outcome: 'completed' | 'stopped' | 'failed' }
    | { type: 'error'; message: string; recoverable: boolean }
  );

export type AgentEventType = AgentEvent['type'];

export type ApprovalRisk = 'read' | 'write' | 'command' | 'network';

export type RunStatus = 'starting' | 'working' | 'waiting' | 'finished' | 'failed' | 'stopped';
