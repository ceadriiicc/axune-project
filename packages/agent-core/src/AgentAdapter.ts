import type { AgentEvent, AgentId, RunMode } from '@axune/protocol';

/**
 * What every provider adapter must implement.
 *
 * The whole point of this interface is that nothing above it knows which
 * provider is running. Adapters translate their provider's output into the
 * shared event model in @axune/protocol; mobile only ever sees those events.
 */
export interface AgentAdapter {
  readonly agentId: AgentId;

  /** Is the provider's CLI installed and usable on this machine? */
  detect(): Promise<DetectionResult>;

  /**
   * Start a run and return immediately with a handle.
   *
   * Returns synchronously rather than resolving at the end, because the phone
   * has a Stop button: the caller must be able to interrupt a run that is
   * still going. An adapter whose only entry point resolved on completion
   * could not support that.
   *
   * Events arrive on `onEvent` as they happen, in `seq` order.
   */
  start(request: RunRequest, onEvent: (event: AgentEvent) => void): RunningRun;
}

export interface DetectionResult {
  installed: boolean;
  /** Version string when it could be determined. */
  version: string | null;
  /**
   * Whether the provider looks authenticated. Deliberately optimistic: Claude
   * Code has no documented "am I logged in" command, so this cannot be proven
   * without starting a run. `unknown` is an honest answer.
   */
  authenticated: 'yes' | 'no' | 'unknown';
  detail: string;
}

export interface RunRequest {
  runId: string;
  sessionId: string;
  mode: RunMode;
  prompt: string;
  /** Absolute path to the Git repository the agent works against. */
  cwd: string;
  branch: string;
  /** Phase 1 is read-only. Write access arrives with worktree isolation. */
  readOnly: boolean;
  /** Resume a previous provider-side session rather than starting fresh. */
  resumeSessionId?: string;
}

export interface RunHandle {
  runId: string;
  /** The provider's own session id, needed to resume after a reconnect. */
  providerSessionId: string | null;
  outcome: 'completed' | 'stopped' | 'failed';
}

/**
 * Returned by `start` so a run can be stopped while it is still going.
 *
 * `done` resolves once the run reaches a terminal state, including when it was
 * stopped - a stop is an outcome, not an error.
 */
export interface RunningRun {
  runId: string;
  stop(): Promise<void>;
  done: Promise<RunHandle>;
}
