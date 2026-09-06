import { randomUUID } from 'node:crypto';

import { ClaudeCodeAdapter, type RunningRun } from '@axune/agent-core';
import {
  PROTOCOL_VERSION,
  type AgentEvent,
  type AgentStatus,
  type ClientMessage,
  type ProjectSummary,
  type ServerMessage,
} from '@axune/protocol';
import { WebSocketServer, type WebSocket } from 'ws';

import { PairingManager } from './PairingManager';
import { RunRegistry } from './RunRegistry';

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
  private readonly claude = new ClaudeCodeAdapter();
  private readonly running = new Map<string, RunningRun>();
  /** Sockets that have completed pairing, with their session token. */
  private readonly authed = new WeakMap<WebSocket, string>();
  /** Observers for the local UI — the terminal now, the Electron window later. */
  private readonly eventListeners = new Set<(event: AgentEvent) => void>();
  private readonly connectionListeners = new Set<(state: string) => void>();

  constructor(
    readonly pairing: PairingManager,
    private project: ProjectSummary,
  ) {}

  async start(port: number): Promise<number> {
    // Bound to all interfaces so the phone can reach it over the LAN. It is
    // never exposed beyond that: an unpaired socket can do nothing at all.
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (socket) => this.onConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', resolve);
      this.wss!.once('error', reject);
    });

    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : port;
  }

  async stop(): Promise<void> {
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

  async agentStatuses(): Promise<AgentStatus[]> {
    const detection = await this.claude.detect();
    return [
      {
        agentId: 'claude-code',
        installed: detection.installed,
        version: detection.version,
        authenticated: detection.authenticated,
      },
    ];
  }

  private onConnection(socket: WebSocket): void {
    socket.on('close', () => {
      if (this.authed.has(socket)) this.announce('device disconnected');
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
      this.announce(`${message.deviceName} paired`);
      return this.send(socket, {
        type: 'paired',
        sessionToken: result.sessionToken,
        project: this.project,
        agents: await this.agentStatuses(),
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
      this.announce(`device reconnected, replaying run ${message.runId.slice(0, 8)}`);

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
      return;
    }

    // Everything below requires a paired socket.
    if (!this.authed.has(socket)) return;

    if (message.type === 'ping') return this.send(socket, { type: 'pong' });

    if (message.type === 'start_run') return this.startRun(message);

    if (message.type === 'stop_run') {
      const run = this.running.get(message.runId);
      await run?.stop().catch(() => undefined);
      return;
    }
  }

  private startRun(message: Extract<ClientMessage, { type: 'start_run' }>): void {
    if (this.running.has(message.runId)) return; // Idempotent: a retried start must not double-run.

    this.registry.open(message.runId);

    const run = this.claude.start(
      {
        runId: message.runId,
        sessionId: message.sessionId,
        mode: message.mode,
        prompt: message.prompt,
        cwd: this.project.path,
        branch: this.project.branch,
        // Phase 1 is read-only. Write access waits for worktree isolation, so a
        // second agent cannot trample the first one's working tree.
        readOnly: true,
      },
      (event: AgentEvent) => {
        this.registry.record(event);
        this.broadcast({ type: 'event', event });
        for (const listener of this.eventListeners) listener(event);
      },
    );

    this.running.set(message.runId, run);
    void run.done.finally(() => this.running.delete(message.runId));
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    for (const socket of this.wss?.clients ?? []) {
      if (this.authed.has(socket)) this.send(socket, message);
    }
  }

  /** Convenience for callers that want a run id without importing crypto. */
  static newRunId(): string {
    return randomUUID();
  }
}
