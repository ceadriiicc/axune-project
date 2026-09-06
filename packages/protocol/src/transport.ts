// What travels over the wire between Axune Mobile and Axune Desktop.
//
// Kept separate from the agent event model on purpose: `events.ts` describes
// what an agent did, this describes how the two halves of Axune talk. An agent
// event is payload here, never the envelope.

import type { AgentEvent, AgentId, RunMode } from './events';

export const PROTOCOL_VERSION = 1;

/** Everything the desktop knows about a project the phone might drive. */
export interface ProjectSummary {
  name: string;
  path: string;
  branch: string;
  isGitRepo: boolean;
  /**
   * The state of the work itself, not just the connection.
   *
   * This is the reason to open Axune when away from the desk: where did I get
   * to, is anything uncommitted, is anything unpushed. Cheap to compute and
   * refreshed whenever the phone asks.
   */
  git?: GitSnapshot;
}

export interface GitSnapshot {
  /** Subject line of the most recent commit. */
  lastCommitMessage: string;
  /** Epoch ms of the most recent commit. */
  lastCommitAt: number;
  lastCommitHash: string;
  /** Files with uncommitted modifications, staged or not. */
  dirtyFiles: number;
  /** Files git does not track yet. */
  untrackedFiles: number;
  /** Lines added and removed in the working tree, for a sense of scale. */
  insertions: number;
  deletions: number;
  /** Commits on this branch not yet pushed. Null when there is no upstream. */
  ahead: number | null;
  /** Commits on the upstream not yet merged locally. */
  behind: number | null;
  /**
   * States that deserve to be loud. A healthy tree should be quiet; a tree
   * mid-rebase or with conflicts is the thing worth interrupting someone for.
   */
  conflicts: number;
  inProgress: 'rebase' | 'merge' | 'cherry-pick' | null;
  detachedHead: boolean;
}

/** The machine being remotely controlled. */
export interface MachineSummary {
  /** Hostname, so the user knows which computer this is. */
  name: string;
  platform: string;
  /** How the phone is reaching it. Remote arrives with the relay. */
  connection: 'local' | 'relay';
}

/** What agents are currently permitted to do to the project. */
export type Capability = 'read-only' | 'read-write';

export interface AgentStatus {
  agentId: AgentId;
  installed: boolean;
  version: string | null;
  /** Claude Code has no "am I logged in" command; `unknown` is honest. */
  authenticated: 'yes' | 'no' | 'unknown';
}

/** Phone → Desktop. */
export type ClientMessage =
  | {
      type: 'pair';
      token: string;
      deviceName: string;
      protocolVersion: number;
      /** Epoch ms of this device's previous visit, so the desktop can say what changed. */
      lastSeenAt?: number;
    }
  /**
   * Sent on reconnect. `lastSeq` is the highest sequence number the phone has
   * already seen for that run, so the desktop can replay only what was missed.
   * This is why every event carries `seq`.
   */
  | { type: 'resume'; token: string; runId: string; lastSeq: number; lastSeenAt?: number }
  | {
      type: 'start_run';
      runId: string;
      sessionId: string;
      prompt: string;
      agentIds: AgentId[];
      mode: RunMode;
      /**
       * Whether the agent may change files. A write run happens in its own
       * branch and worktree, never the user's working tree.
       */
      write?: boolean;
    }
  /** Keep the branch an agent produced, or throw it away. */
  | { type: 'resolve_changes'; runId: string; decision: 'keep' | 'discard' }
  | { type: 'stop_run'; runId: string }
  | { type: 'ping' };

/** Desktop → Phone. */
export type ServerMessage =
  /**
   * `sessionToken` is the credential the phone stores and presents on
   * reconnect. The one-time QR token is spent by pairing, so without this a
   * device could never resume — it would have to rescan after every drop.
   */
  | {
      type: 'paired';
      sessionToken: string;
      project: ProjectSummary;
      agents: AgentStatus[];
      machine: MachineSummary;
      capability: Capability;
      protocolVersion: number;
    }
  | { type: 'pair_rejected'; reason: 'bad_token' | 'expired' | 'version_mismatch'; detail: string }
  /** A replayed or live agent event. Replays carry `replayed: true`. */
  | { type: 'event'; event: AgentEvent; replayed?: boolean }
  /** Sent after a resume, before any replayed events, so the phone can show a gap honestly. */
  | { type: 'resumed'; runId: string; fromSeq: number; missedEvents: number }
  | { type: 'project_changed'; project: ProjectSummary }
  | { type: 'machine_changed'; machine: MachineSummary; capability: Capability }
  | { type: 'agents_changed'; agents: AgentStatus[] }
  /** Backlog of what happened, newest last. `sinceLastVisit` is how many are new. */
  | { type: 'activity'; events: ActivityEvent[]; sinceLastVisit: number }
  /** A single event as it happens, while the phone is connected. */
  | { type: 'activity_event'; event: ActivityEvent }
  /** What a write run produced, once it has finished. */
  | { type: 'changes'; runId: string; result: ChangeSet }
  | { type: 'pong' };

/**
 * Something that happened on the desktop while nobody was necessarily looking.
 *
 * One stream serves two features: "since you last checked" is this list
 * filtered by the phone's last visit, and "recent activity" is the same list
 * rendered chronologically. Building them as separate pipelines would mean two
 * sources of truth for the same facts.
 */
export interface ActivityEvent {
  id: string;
  at: number;
  kind: ActivityKind;
  /** One line, already written for a human. */
  summary: string;
  /** Optional second line — a commit hash, a run outcome, a branch name. */
  detail?: string;
}

export type ActivityKind =
  | 'run.started'
  | 'run.completed'
  | 'run.stopped'
  | 'run.failed'
  | 'git.commit'
  | 'git.branch'
  | 'git.dirty'
  | 'git.clean'
  | 'git.pushed'
  | 'device.paired'
  | 'device.disconnected';

/** The outcome of a write run: a branch, and what is on it. */
export interface ChangeSet {
  branch: string;
  /** Commit created on that branch, or null when the agent changed nothing. */
  commit: string | null;
  files: ChangedFile[];
  insertions: number;
  deletions: number;
  /** Unified diff, truncated for a phone. */
  patch: string;
}

export interface ChangedFile {
  path: string;
  insertions: number;
  deletions: number;
  status: 'modified' | 'created' | 'deleted';
}

/** What the desktop encodes into the pairing QR code. */
export interface PairingPayload {
  /** Always "axune" — lets the scanner reject unrelated QR codes immediately. */
  kind: 'axune';
  protocolVersion: number;
  /** ws://<lan-ip>:<port> */
  url: string;
  token: string;
  /** Epoch ms after which the desktop will refuse this token. */
  expiresAt: number;
  projectName: string;
}
