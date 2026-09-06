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
  /** Commits on this branch not yet pushed. Null when there is no upstream. */
  ahead: number | null;
  /** Commits on the upstream not yet merged locally. */
  behind: number | null;
}

export interface AgentStatus {
  agentId: AgentId;
  installed: boolean;
  version: string | null;
  /** Claude Code has no "am I logged in" command; `unknown` is honest. */
  authenticated: 'yes' | 'no' | 'unknown';
}

/** Phone → Desktop. */
export type ClientMessage =
  | { type: 'pair'; token: string; deviceName: string; protocolVersion: number }
  /**
   * Sent on reconnect. `lastSeq` is the highest sequence number the phone has
   * already seen for that run, so the desktop can replay only what was missed.
   * This is why every event carries `seq`.
   */
  | { type: 'resume'; token: string; runId: string; lastSeq: number }
  | { type: 'start_run'; runId: string; sessionId: string; prompt: string; agentIds: AgentId[]; mode: RunMode }
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
      protocolVersion: number;
    }
  | { type: 'pair_rejected'; reason: 'bad_token' | 'expired' | 'version_mismatch'; detail: string }
  /** A replayed or live agent event. Replays carry `replayed: true`. */
  | { type: 'event'; event: AgentEvent; replayed?: boolean }
  /** Sent after a resume, before any replayed events, so the phone can show a gap honestly. */
  | { type: 'resumed'; runId: string; fromSeq: number; missedEvents: number }
  | { type: 'project_changed'; project: ProjectSummary }
  | { type: 'agents_changed'; agents: AgentStatus[] }
  | { type: 'pong' };

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
