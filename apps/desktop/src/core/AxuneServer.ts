import { randomUUID } from 'node:crypto';
import { hostname, platform } from 'node:os';

import {
  ClaudeCodeAdapter,
  GeminiAdapter,
  type AgentAdapter,
  type RunningRun,
} from '@axune/agent-core';
import { WorktreeManager, type Worktree } from '@axune/git-core';
import {
  PROTOCOL_VERSION,
  type Capability,
  type MachineSummary,
  type AgentEvent,
  type AgentId,
  type AgentStatus,
  type ClientMessage,
  type ProjectSummary,
  type ServerMessage,
} from '@axune/protocol';
import { WebSocketServer, type WebSocket } from 'ws';

import { ActivityLog } from './ActivityLog';
import { EgressLedger } from './EgressLedger';
import { GitWatcher } from './GitWatcher';
import { readGitSnapshot } from './gitSnapshot';
import { PairingManager } from './PairingManager';
import { RunRegistry } from './RunRegistry';
import { SessionStore } from './SessionStore';

/**
 * The desktop half of Axune: accepts one paired phone, runs agents against the
 * selected project, and streams events back.
 *
 * Deliberately dumb about agents — it holds adapters and forwards their events.
 * Anything provider-specific belongs in the adapter, not here.
 */
export class AxuneServer {
  private wss: WebSocketServer | null = null;
  private readonly registry = new RunRegistry();
  /**
   * Every adapter this desktop can drive, keyed by the id the phone asks for.
   *
   * Deliberately a map rather than a field per provider: the phone already
   * sends `agentIds` and this is what makes the desktop honour it. Until now
   * that field was accepted and ignored, and every run went to Claude Code
   * whatever was requested - which meant a second agent could not have been
   * reached even once its adapter existed.
   */
  private readonly adapters = new Map<AgentId, AgentAdapter>([
    ['claude-code', new ClaudeCodeAdapter()],
    // Registered whether or not the CLI is present. Detection reports it as
    // missing, which is a better answer than pretending the agent does not
    // exist - the phone can then say "not installed" rather than "unknown
    // agent", and the difference matters to someone deciding what to install.
    ['gemini-cli', new GeminiAdapter()],
  ]);
  private readonly running = new Map<string, RunningRun>();
  /** Sockets that have completed pairing, with their session token. */
  private readonly authed = new WeakMap<WebSocket, string>();
  /** Observers for the local UI — the terminal now, the Electron window later. */
  private readonly eventListeners = new Set<(event: AgentEvent) => void>();
  private readonly connectionListeners = new Set<(state: string) => void>();

  private readonly activity = new ActivityLog();
  /**
   * What each run sent off this machine. Lazy for the same reason as
   * `worktrees`: constructor parameter properties are assigned after field
   * initialisers, so building it eagerly reads an undefined project.
   */
  private egressLedger: EgressLedger | null = null;

  private get egress(): EgressLedger {
    this.egressLedger ??= new EgressLedger(this.project.path);
    return this.egressLedger;
  }
  private watcher: GitWatcher | null = null;
  /**
   * Lazy: constructor parameter properties are assigned after field
   * initialisers run, so building this eagerly reads an undefined project.
   */
  private worktreesCache: WorktreeManager | null = null;
  /** Worktrees belonging to runs that have finished but not been resolved. */
  private readonly pending = new Map<string, Worktree>();

  constructor(
    readonly pairing: PairingManager,
    private project: ProjectSummary,
    private readonly store: SessionStore = new SessionStore(),
  ) {
    // Devices trusted in an earlier run of the desktop are still trusted, so a
    // restart does not force the phone to rescan a QR code.
    for (const token of this.store.trustedTokens()) this.pairing.trust(token);
  }

  async start(port: number): Promise<number> {
    // Bound to all interfaces so the phone can reach it over the LAN. It is
    // never exposed beyond that: an unpaired socket can do nothing at all.
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (socket) => this.onConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', resolve);
      this.wss!.once('error', (error) => {
        // The port is taken, most likely by another Axune. Drop the dead
        // server so a caller can retry on a different port with a clean slate.
        this.wss?.close();
        this.wss = null;
        reject(error);
      });
    });

    // Watch the repository even with no phone connected — the changes worth
    // reporting are the ones that happen while the user is away.
    if (this.project.isGitRepo) {
      this.watcher = new GitWatcher(this.project.path, this.activity, () => this.project.branch);
      await this.watcher.start();
    }
    this.activity.onEvent((event) => this.broadcast({ type: 'activity_event', event }));

    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : port;
  }

  async stop(): Promise<void> {
    this.watcher?.stop();
    for (const run of this.running.values()) await run.stop().catch(() => undefined);
    this.running.clear();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()) ?? resolve());
    this.wss = null;
  }

  /** Watch agent events locally. The desktop shows the same run the phone does. */
  onEvent(listener: (event: AgentEvent) => void): void {
    this.eventListeners.add(listener);
  }

  /** Watch pairing and connection changes, for the desktop's own status display. */
  onConnectionChange(listener: (state: string) => void): void {
    this.connectionListeners.add(listener);
  }

  private announce(state: string): void {
    for (const listener of this.connectionListeners) listener(state);
  }

  setProject(project: ProjectSummary): void {
    this.project = project;
    this.broadcast({ type: 'project_changed', project });
  }

  /** The machine the phone is controlling. Shown so the user knows which computer. */
  machine(): MachineSummary {
    return { name: hostname(), platform: platform(), connection: 'local' };
  }

  /**
   * Writing is allowed because it is contained: an editing run happens on its
   * own branch in its own worktree, so the user's working tree is never the
   * thing being changed.
   */
  capability(): Capability {
    return 'read-write';
  }

  private get worktrees(): WorktreeManager {
    if (!this.worktreesCache) this.worktreesCache = new WorktreeManager(this.project.path);
    return this.worktreesCache;
  }

  /**
   * The project with a freshly read git snapshot. Read on demand rather than
   * cached, since the whole point is that it is current when the phone looks.
   */
  private async projectNow(): Promise<ProjectSummary> {
    if (!this.project.isGitRepo) return this.project;
    return { ...this.project, git: await readGitSnapshot(this.project.path) };
  }

  async agentStatuses(): Promise<AgentStatus[]> {
    // Detected in parallel: each one shells out to a CLI, and the phone should
    // not wait for them in series to draw its status row.
    return Promise.all(
      [...this.adapters].map(async ([agentId, adapter]) => {
        const detection = await adapter.detect();
        return {
          agentId,
          installed: detection.installed,
          version: detection.version,
          authenticated: detection.authenticated,
        };
      }),
    );
  }

  private onConnection(socket: WebSocket): void {
    socket.on('close', () => {
      if (this.authed.has(socket)) {
        this.activity.record('device.disconnected', 'Phone disconnected');
        this.announce('device disconnected');
      }
    });
    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return; // Unparseable input from an unpaired socket is simply ignored.
      }
      void this.handle(socket, message);
    });
  }

  private async handle(socket: WebSocket, message: ClientMessage): Promise<void> {
    if (message.type === 'pair') {
      const result = this.pairing.redeem(message.token, message.deviceName, message.protocolVersion);
      if (!result.ok) {
        return this.send(socket, { type: 'pair_rejected', reason: result.reason, detail: result.detail });
      }
      this.authed.set(socket, result.sessionToken);
      this.store.trustDevice(result.sessionToken, message.deviceName);
      this.activity.record('device.paired', `${message.deviceName} paired`);
      this.announce(`${message.deviceName} paired`);
      this.sendActivity(socket, message.lastSeenAt);
      void this.sendBranches(socket);
      return this.send(socket, {
        type: 'paired',
        sessionToken: result.sessionToken,
        project: await this.projectNow(),
        agents: await this.agentStatuses(),
        machine: this.machine(),
        capability: this.capability(),
        protocolVersion: PROTOCOL_VERSION,
      });
    }

    if (message.type === 'resume') {
      // A reconnecting phone presents the session token it already holds.
      if (!this.pairing.isPaired(message.token)) {
        return this.send(socket, {
          type: 'pair_rejected',
          reason: 'bad_token',
          detail: 'This device is not paired. Scan the QR code again.',
        });
      }
      this.authed.set(socket, message.token);
      // Keeps this phone at the top of the trusted list, so expiry retires the
      // tokens of devices that never come back rather than the one in use.
      this.store.touchDevice(message.token);
      this.announce(`device reconnected, replaying run ${message.runId.slice(0, 8)}`);
      this.sendActivity(socket, message.lastSeenAt);
      void this.sendBranches(socket);

      const slice = this.registry.since(message.runId, message.lastSeq);
      this.send(socket, {
        type: 'resumed',
        runId: message.runId,
        fromSeq: message.lastSeq,
        missedEvents: slice.events.length,
      });
      for (const event of slice.events) {
        this.send(socket, { type: 'event', event, replayed: true });
      }

      // A resumed device knows its token but not what the desktop is pointed
      // at — the project may have changed while it was away.
      this.send(socket, { type: 'project_changed', project: await this.projectNow() });
      this.send(socket, { type: 'agents_changed', agents: await this.agentStatuses() });
      this.send(socket, {
        type: 'machine_changed',
        machine: this.machine(),
        capability: this.capability(),
      });
      return;
    }

    // Everything below requires a paired socket.
    if (!this.authed.has(socket)) return;

    if (message.type === 'ping') return this.send(socket, { type: 'pong' });

    if (message.type === 'start_run') return void this.startRun(message);

    if (message.type === 'stop_run') {
      const run = this.running.get(message.runId);
      await run?.stop().catch(() => undefined);
      return;
    }

    if (message.type === 'delete_branch') {
      await this.worktrees.deleteBranch(message.branch).catch(() => undefined);
      this.activity.record('run.stopped', 'Deleted a branch', message.branch);
      await this.sendBranches(socket);
      return;
    }

    if (message.type === 'resolve_changes') {
      const worktree = this.pending.get(message.runId);
      if (!worktree) return;
      this.pending.delete(message.runId);

      if (message.decision === 'discard') {
        await this.worktrees.discard(worktree);
        this.activity.record('run.stopped', 'Discarded agent changes', worktree.branch);
      } else {
        this.activity.record('run.completed', 'Kept agent changes', worktree.branch);
      }
      this.broadcast({ type: 'project_changed', project: await this.projectNow() });
      await this.sendBranches(socket);
      return;
    }
  }

  private async startRun(message: Extract<ClientMessage, { type: 'start_run' }>): Promise<void> {
    if (this.running.has(message.runId)) return; // Idempotent: a retried start must not double-run.

    this.registry.open(message.runId);

    // Honour what the phone asked for. Paired Mode fans one prompt out to
    // several agents at once and is not built, so more than one id is refused
    // rather than quietly answered by a single agent — a phone showing one
    // reply to a paired request would look like the feature works.
    const requested = message.agentIds ?? [];
    if (requested.length > 1) {
      return this.failRun(
        message,
        'claude-code',
        'Running several agents on one prompt is not built yet. Ask one agent at a time.',
      );
    }
    const agentId: AgentId = requested[0] ?? 'claude-code';
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      return this.failRun(
        message,
        agentId,
        `This desktop has no adapter for ${agentId}. Installed: ${[...this.adapters.keys()].join(', ')}.`,
      );
    }

    // Refuse before spawning. Without this an uninstalled agent produces a raw
    // ENOENT from a child process, which reaches the phone as an unexplained
    // failure; the useful answer names the CLI and says it is missing.
    const detection = await adapter.detect();
    if (!detection.installed) {
      return this.failRun(message, agentId, `${agentId} is not installed on this machine. ${detection.detail}`);
    }

    // A write run gets its own branch and directory. Failing to create one is
    // not a reason to fall back to editing the user's tree — the run simply
    // stays read-only, which is the safe direction to fail in.
    let worktree: Worktree | null = null;
    if (message.write && this.project.isGitRepo) {
      worktree = await this.worktrees
        .create(agentId, message.runId)
        .catch(() => null);
    }
    const writing = Boolean(worktree);

    const run = adapter.start(
      {
        runId: message.runId,
        sessionId: message.sessionId,
        mode: message.mode,
        prompt: message.prompt,
        cwd: worktree?.path ?? this.project.path,
        branch: worktree?.branch ?? this.project.branch,
        readOnly: !writing,
        // Continue the same provider conversation when we have seen this Axune
        // session before, so the agent remembers the previous prompt.
        resumeSessionId: this.store.providerSession(message.sessionId, agentId),
      },
      (event: AgentEvent) => {
        this.registry.record(event);
        this.egress.observe(message.runId, agentId, event);

        // A refusal is worth keeping. It used to be broadcast to the phone and
        // then forgotten, so there was no record of what the policy layer
        // stopped or why - which is precisely what makes the rest of the
        // logging worth having, and what would have explained a run that spent
        // forty seconds being denied in near silence.
        if (event.type === 'tool_finished' && !event.ok) {
          this.activity.record('policy.denied', truncate(event.output ?? 'Denied', 120));
        }

        this.broadcast({ type: 'event', event });
        for (const listener of this.eventListeners) listener(event);
      },
    );

    this.activity.record('run.started', truncate(message.prompt));

    this.running.set(message.runId, run);
    void run.done
      .then(async (handle) => {
        const kind =
          handle.outcome === 'completed'
            ? 'run.completed'
            : handle.outcome === 'stopped'
              ? 'run.stopped'
              : 'run.failed';
        this.activity.record(kind, `Run ${handle.outcome}`, truncate(message.prompt));

        // Say what this run sent, in the same place everything else is
        // recorded. Null when it read nothing: a run that sent nothing should
        // not leave a note claiming otherwise.
        const sent = this.egress.close(message.runId);
        if (sent) this.activity.record('privacy.egress', sent, truncate(message.prompt));

        if (worktree) await this.reportChanges(worktree, message.runId, message.prompt);

        // A run often changes the working tree; tell the phone what it looks
        // like now rather than leaving a stale snapshot on screen.
        this.broadcast({ type: 'project_changed', project: await this.projectNow() });
        if (handle.providerSessionId) {
          this.store.rememberProviderSession(
            message.sessionId,
            agentId,
            handle.providerSessionId,
          );
        }
      })
      .finally(() => this.running.delete(message.runId));
  }

  /**
   * Refuse a run the desktop cannot serve, in the run's own event stream.
   *
   * The phone shows a prompt the instant it is sent, so a request that is
   * simply dropped leaves a bubble that spins for ever. It has to come back as
   * a finished, failed run with a reason a person can act on.
   */
  private failRun(
    message: Extract<ClientMessage, { type: 'start_run' }>,
    agentId: AgentId,
    reason: string,
  ): void {
    let seq = 0;
    const emit = (body: { type: 'error'; message: string; recoverable: boolean } | { type: 'run_finished'; outcome: 'failed' }) => {
      const event = {
        seq: seq++,
        runId: message.runId,
        sessionId: message.sessionId,
        agentId,
        ts: Date.now(),
        ...body,
      } as AgentEvent;
      this.registry.record(event);
      this.broadcast({ type: 'event', event });
      for (const listener of this.eventListeners) listener(event);
    };

    // No need to open the run explicitly: record() does it.
    emit({ type: 'error', message: reason, recoverable: false });
    emit({ type: 'run_finished', outcome: 'failed' });
    this.activity.record('run.failed', reason, truncate(message.prompt));
  }

  /**
   * Commit whatever the agent wrote, describe it, and hand the branch to the
   * phone to keep or throw away. The worktree directory is released either way;
   * the branch survives until the user decides.
   */
  private async reportChanges(worktree: Worktree, runId: string, prompt: string): Promise<void> {
    try {
      const files = await this.worktrees.changes(worktree);
      const patch = await this.worktrees.diff(worktree);
      const commit = await this.worktrees.commit(worktree, `Axune: ${truncate(prompt, 60)}`);
      const behindBy = await this.worktrees.behindBy(worktree);

      this.broadcast({
        type: 'changes',
        runId,
        result: {
          branch: worktree.branch,
          commit,
          files,
          insertions: files.reduce((sum, file) => sum + file.insertions, 0),
          deletions: files.reduce((sum, file) => sum + file.deletions, 0),
          patch,
          behindBy,
        },
      });

      await this.worktrees.release(worktree);

      if (commit) {
        this.pending.set(runId, worktree);
      } else {
        // Nothing was written, so there is no decision to make and no branch
        // worth keeping around.
        await this.worktrees.discard(worktree);
      }
    } catch {
      await this.worktrees.release(worktree).catch(() => undefined);
    }
  }

  /** Branches agents left behind, so kept work is findable from the app. */
  private async sendBranches(socket: WebSocket): Promise<void> {
    const branches = await this.worktrees
      .branches(this.project.branch)
      .catch(() => []);
    this.send(socket, { type: 'branches', branches });
  }

  /** Hand a freshly connected phone the backlog, and say how much is new. */
  private sendActivity(socket: WebSocket, lastSeenAt: number | undefined): void {
    this.send(socket, {
      type: 'activity',
      events: this.activity.recent(),
      sinceLastVisit: this.activity.countSince(lastSeenAt),
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    for (const socket of this.wss?.clients ?? []) {
      if (this.authed.has(socket)) this.send(socket, message);
    }
  }

  /** The activity stream, for the desktop's own display. */
  get activityLog(): ActivityLog {
    return this.activity;
  }

  /** Convenience for callers that want a run id without importing crypto. */
  static newRunId(): string {
    return randomUUID();
  }
}

/** Prompts can be long; activity rows get one line. */
function truncate(text: string, max = 90): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
