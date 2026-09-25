// What travels over the wire between Axune Mobile and Axune Desktop.
//
// Kept separate from the agent event model on purpose: `events.ts` describes
// what an agent did, this describes how the two halves of Axune talk. An agent
// event is payload here, never the envelope.

import type { AgentEvent, AgentId, RunMode } from './events';

export const PROTOCOL_VERSION = 1;

/** Everything the desktop knows about a project the phone might drive. */
/**
 * One day's consumption, totalled on the desktop.
 *
 * Lives in the protocol rather than on either side because both render it and a
 * drift between them would be invisible: a phone that summed the same runs
 * slightly differently would simply show a different number, with nothing to
 * say which was right.
 *
 * The desktop is the only place this can be totalled honestly. It sees every
 * run whether a phone was watching or not, and its ledger is bounded by age
 * rather than by count - a total computed from a trimmed list is not a total.
 *
 * Deliberately carries no share of a plan's limit. Nothing the provider reports
 * says what a plan allows or when it resets, so a percentage would be invented,
 * and a made-up number that people stop questioning is worse than no number.
 */
export interface UsageDay {
  /** Local YYYY-MM-DD. Local because "today" is a human question, not a UTC one. */
  date: string;
  runs: number;
  /** Runs that finished without the provider reporting anything - never counted as free. */
  unreported: number;
  /**
   * Runs that re-sent what an earlier run had cached, after a gap long enough
   * to explain it. See `isIdleStart` - the claim needs both signals.
   */
  coldStarts: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** At published API rates. A subscription is not billed per run. */
  costUsd: number;
  heaviest: { prompt: string; tokens: number } | null;
}

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
  /**
   * One line a person can act on, from the adapter's own detection.
   *
   * The adapters have always produced this - "gemini not found on PATH: ..." -
   * and `agentStatuses` threw it away, so both the window and the phone could
   * say an agent was missing and never why. "Not installed" is a status; this
   * is the difference between a status and something you can do next.
   */
  detail?: string;
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
  /** Delete a branch an agent produced that was never merged. */
  | { type: 'delete_branch'; branch: string }
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
  /**
   * `not_paired` is not a pairing failure but a command sent before pairing.
   * It shares this message because the phone's handling is already right for
   * it: stop retrying, show the detail. Previously such a command was dropped
   * by a bare `return`, which is correct security and terrible behaviour - the
   * phone waited for a reply that was never coming.
   */
  | {
      type: 'pair_rejected';
      reason: 'bad_token' | 'expired' | 'version_mismatch' | 'not_paired';
      detail: string;
    }
  /** A replayed or live agent event. Replays carry `replayed: true`. */
  | { type: 'event'; event: AgentEvent; replayed?: boolean }
  /** Sent after a resume, before any replayed events, so the phone can show a gap honestly. */
  /**
   * `missedEvents` is how many events are about to be replayed - a catch-up
   * figure, not a loss. `gap` is the loss: true when the desktop no longer
   * holds part of this run and the replay will be incomplete.
   *
   * The registry computed `gap` from the day it was written, with a comment
   * saying a replay should admit it rather than pretend the run started later
   * than it did. Nothing carried it, so the phone rendered a run missing its
   * middle as a complete one.
   */
  | { type: 'resumed'; runId: string; fromSeq: number; missedEvents: number; gap: boolean }
  | { type: 'project_changed'; project: ProjectSummary }
  | { type: 'machine_changed'; machine: MachineSummary; capability: Capability }
  | { type: 'agents_changed'; agents: AgentStatus[] }
  /** Backlog of what happened, newest last. `sinceLastVisit` is how many are new. */
  | { type: 'activity'; events: ActivityEvent[]; sinceLastVisit: number }
  /** A single event as it happens, while the phone is connected. */
  | { type: 'activity_event'; event: ActivityEvent }
  /** What a write run produced, once it has finished. */
  | { type: 'changes'; runId: string; result: ChangeSet }
  /** Branches agents have produced and the user chose to keep. */
  | { type: 'branches'; branches: AgentBranch[] }
  /**
   * Today's totals, pushed rather than polled: sent once on pairing and again
   * whenever a run finishes, so the figure a phone shows is never older than
   * the last run it knows about.
   */
  | { type: 'usage_day'; day: UsageDay }
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
  | 'device.disconnected'
  /** A tool call the policy layer refused, kept with its reason. */
  | 'policy.denied'
  /** What a run sent off this machine: which files, how many bytes. */
  | 'privacy.egress';

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
  /**
   * Commits the base branch gained while the agent was working.
   *
   * The agent branched from a snapshot. If the user committed at their desk
   * meanwhile, this work is built on older code — harmless while every change
   * is reviewed, but the reviewer should know.
   */
  behindBy: number;
}

/** A branch left behind by a kept write run. */
export interface AgentBranch {
  name: string;
  subject: string;
  at: number;
  files: number;
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
  /** ws://<lan-ip>:<port>. Kept as the single address an older phone reads. */
  url: string;
  /**
   * Every address this desktop can be reached at, best first.
   *
   * A phone stored one IP at pairing and treated it as permanent, but DHCP
   * disagrees: this machine moved across three addresses in two days, and each
   * move silently broke reconnection and cost a QR rescan. "Pair once" cannot
   * survive a router reboot on an IP alone.
   *
   * The first entry is normally `ws://<hostname>.local:<port>`, which iOS
   * resolves through its own mDNS resolver with no extra native module - so the
   * phone can find the machine by name after it moves. The IP follows as a
   * fallback for networks where mDNS is blocked.
   *
   * Optional so that an older phone paired with a newer desktop, or the
   * reverse, simply falls back to `url`.
   */
  urls?: string[];
  token: string;
  /** Epoch ms after which the desktop will refuse this token. */
  expiresAt: number;
  projectName: string;
  /**
   * The desktop's long-term X25519 public key, base64url.
   *
   * This is what makes the link authenticated rather than merely encrypted. The
   * QR is an out-of-band channel: an attacker on the network can see and alter
   * packets but cannot alter the pixels on the monitor, so a key read from here
   * is one they cannot substitute. Plain Diffie-Hellman without it agrees a
   * sound key with whoever answers - which on a hostile network is the attacker.
   *
   * The phone stores it and pins it for every later reconnect, when there is no
   * QR to read.
   */
  publicKey: string;
}

/**
 * The handshake, and the only two frames that ever travel in the clear.
 *
 * Everything else - including the pairing token, which used to cross the LAN in
 * plaintext - is carried inside a `SealedFrame`. There is deliberately **no
 * downgrade path**: a desktop that receives an unsealed `pair` after the
 * handshake closes the socket. Encryption a peer is allowed to skip is
 * encryption an attacker will ask it to skip, and "it still works on old
 * phones" is the sentence that ends every transport security story badly.
 */
export interface ClientHello {
  type: 'hello';
  protocolVersion: number;
  /**
   * The phone's X25519 public key, base64url. Ephemeral: a fresh pair per
   * connection, so a key recovered later cannot decrypt traffic captured today.
   * Public by definition, so sending it in the clear costs nothing.
   */
  publicKey: string;
  /**
   * Per-connection HKDF salt, base64url, chosen by the phone.
   *
   * Non-secret on purpose - HKDF salts are not required to be secret, only
   * unique - which is what lets the token move *inside* the encrypted channel.
   * An earlier design used the pairing token as the salt and could not: the
   * desktop would have had to know the token to derive the keys it needed in
   * order to decrypt the message carrying the token.
   */
  salt: string;
}

/** Desktop → Phone, in the clear, answering a hello. */
export type ServerHello =
  | { type: 'hello_ok' }
  | {
      type: 'hello_rejected';
      reason: 'version_mismatch' | 'malformed' | 'unencrypted';
      detail: string;
    };

/**
 * One encrypted frame. Structurally identical to the secure-channel package's
 * `Envelope`, and repeated here rather than imported so that `@axune/protocol`
 * - which every part of Axune depends on - does not drag a crypto library into
 * every consumer. The two are checked against each other by the handshake test.
 */
export interface SealedEnvelope {
  /** Message counter, authenticated, strictly increasing per direction. */
  n: number;
  /** Base64url nonce, 24 bytes. */
  iv: string;
  /** Base64url ciphertext including the Poly1305 tag. */
  c: string;
}

export interface SealedFrame {
  type: 'sealed';
  envelope: SealedEnvelope;
}

/** What actually appears on the wire, in either direction. */
export type WireFrame = ClientHello | ServerHello | SealedFrame;
