import type {
  ActivityEvent,
  AgentBranch,
  AgentEvent,
  ChangeSet,
  AgentStatus,
  Capability,
  ClientMessage,
  MachineSummary,
  PairingPayload,
  ProjectSummary,
  ServerMessage,
} from '@axune/protocol';
import { PROTOCOL_VERSION } from '@axune/protocol';

/**
 * The phone's connection to Axune Desktop.
 *
 * Holds the session token and the highest `seq` seen per run, so a dropped
 * connection resumes rather than restarts. Phones lose Wi-Fi constantly —
 * walking out of a room must not cost a run.
 */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ClientCallbacks {
  onState: (state: ConnectionState, detail?: string) => void;
  onEvent: (event: AgentEvent, replayed: boolean) => void;
  onPaired: (project: ProjectSummary, agents: AgentStatus[]) => void;
  onGap?: (runId: string, missedEvents: number) => void;
  onProject?: (project: ProjectSummary) => void;
  onAgents?: (agents: AgentStatus[]) => void;
  onMachine?: (machine: MachineSummary, capability: Capability) => void;
  onActivity?: (events: ActivityEvent[], sinceLastVisit: number) => void;
  onActivityEvent?: (event: ActivityEvent) => void;
  onChanges?: (runId: string, result: ChangeSet) => void;
  onBranches?: (branches: AgentBranch[]) => void;
}

/**
 * How long to wait for one address before trying the next.
 *
 * Short enough that walking two or three candidates is imperceptible, long
 * enough for a sleeping laptop's Wi-Fi to answer.
 */
const CONNECT_TIMEOUT_MS = 3500;

export class AxuneClient {
  private socket: WebSocket | null = null;
  /**
   * The address that last worked. Preferred on every later attempt, because a
   * machine usually stays where it was found.
   */
  private url: string | null = null;
  /**
   * Every address the desktop said it answers on, best first - normally its
   * `.local` hostname, then its IP. Tried in order until one opens.
   */
  private candidates: string[] = [];
  private sessionToken: string | null = null;
  /** Highest seq seen per run, so a resume asks for exactly what it missed. */
  private readonly lastSeq = new Map<string, number>();
  private activeRunId: string | null = null;
  private reconnectAttempts = 0;
  private deliberateClose = false;

  /** Epoch ms of this device's previous visit, sent so the desktop can diff. */
  private lastSeenAt: number | undefined;

  constructor(private readonly callbacks: ClientCallbacks) {}

  setLastSeenAt(at: number | undefined): void {
    this.lastSeenAt = at;
  }

  /**
   * Reconnect with a pairing saved from a previous launch, skipping the QR
   * entirely. The one-time code is long spent; the session token is what makes
   * a device trusted.
   */
  reconnectWithSession(urls: string[], sessionToken: string): void {
    this.candidates = urls;
    this.url = urls[0] ?? null;
    this.sessionToken = sessionToken;
    this.deliberateClose = false;
    this.open(() => {
      // `resume` doubles as "authenticate me"; with no active run it simply
      // proves the device is still trusted.
      this.send({
        type: 'resume',
        token: sessionToken,
        runId: this.activeRunId ?? 'none',
        lastSeq: this.activeRunId ? (this.lastSeq.get(this.activeRunId) ?? -1) : -1,
        lastSeenAt: this.lastSeenAt,
      });
    });
  }

  /** First contact: redeem the one-time token from the QR code. */
  pair(payload: PairingPayload, deviceName: string): void {
    if (payload.kind !== 'axune') {
      return this.callbacks.onState('failed', 'That QR code is not an Axune pairing code.');
    }
    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      return this.callbacks.onState(
        'failed',
        `Version mismatch — the desktop speaks ${payload.protocolVersion}, this app speaks ${PROTOCOL_VERSION}.`,
      );
    }
    if (Date.now() > payload.expiresAt) {
      return this.callbacks.onState('failed', 'That pairing code has expired. Show a new one.');
    }

    // Prefer the ordered list when the desktop sent one. An older desktop sends
    // only `url`, so fall back rather than failing to pair at all.
    this.candidates = payload.urls?.length ? payload.urls : [payload.url];
    this.url = this.candidates[0] ?? payload.url;
    this.deliberateClose = false;
    this.open(() => {
      this.send({
        type: 'pair',
        token: payload.token,
        deviceName,
        protocolVersion: PROTOCOL_VERSION,
        lastSeenAt: this.lastSeenAt,
      });
    });
  }

  startRun(runId: string, sessionId: string, prompt: string, write = false): void {
    this.activeRunId = runId;
    this.lastSeq.set(runId, -1);
    this.send({
      type: 'start_run',
      runId,
      sessionId,
      prompt,
      agentIds: ['claude-code'],
      mode: 'independent',
      write,
    });
  }

  /** Keep the branch an agent produced, or throw it away. */
  resolveChanges(runId: string, decision: 'keep' | 'discard'): void {
    this.send({ type: 'resolve_changes', runId, decision });
  }

  deleteBranch(branch: string): void {
    this.send({ type: 'delete_branch', branch });
  }

  stopRun(runId: string): void {
    this.send({ type: 'stop_run', runId });
  }

  disconnect(): void {
    this.deliberateClose = true;
    this.socket?.close();
    this.socket = null;
    this.callbacks.onState('idle');
  }

  get isConnected(): boolean {
    return this.socket?.readyState === 1;
  }

  /**
   * The durable credential, once paired. Null until then.
   *
   * Carries every known address as well as the one that worked, so a stored
   * pairing survives the machine moving to a new IP.
   */
  get credential(): { url: string; urls: string[]; sessionToken: string } | null {
    return this.url && this.sessionToken
      ? { url: this.url, urls: this.orderedCandidates(), sessionToken: this.sessionToken }
      : null;
  }

  /** Last known good address first, then everything else the desktop offered. */
  private orderedCandidates(): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const candidate of [this.url, ...this.candidates]) {
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate);
        ordered.push(candidate);
      }
    }
    return ordered;
  }

  /**
   * Open a socket, trying each known address until one answers.
   *
   * A phone used to store a single IP and treat it as permanent. When the
   * desktop moved - three times in two days here - reconnection failed
   * silently and the only way back was scanning a QR code again. Walking a
   * short candidate list turns that into a two-second delay nobody notices.
   *
   * Sequential rather than parallel on purpose: opening several sockets at once
   * would leave the desktop holding more than one authenticated connection for
   * the same phone, which is the duplicate-event bug already fixed once.
   */
  private open(onOpen: () => void, attempt = 0): void {
    const candidates = this.orderedCandidates();
    const target = candidates[attempt];
    if (!target) {
      // Every address failed. Reported as failed rather than retried here; the
      // caller's backoff decides whether to try the whole list again.
      return this.callbacks.onState('failed', 'Could not reach this machine at any known address.');
    }
    this.callbacks.onState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    // Close whatever was open first. Without this, pairing while an old socket
    // is still alive - which is exactly what happens when the desktop's LAN
    // address changes and the phone rescans - leaves two authenticated
    // connections, and the desktop broadcasts every event down both. The app
    // then handles each event twice.
    if (this.socket) {
      const stale = this.socket;
      this.socket = null;
      stale.onclose = null;
      stale.onmessage = null;
      stale.onerror = null;
      try {
        stale.close();
      } catch {
        // Already closing. Nothing to do.
      }
    }

    const socket = new WebSocket(target);
    this.socket = socket;

    // React Native's WebSocket has no connect timeout, so an unreachable
    // address hangs instead of failing. Without this the fallback would never
    // be reached and the phone would simply appear stuck.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Already gone.
      }
      this.socket = null;
      this.open(onOpen, attempt + 1);
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      settled = true;
      clearTimeout(timer);
      // Remember what worked, so the next launch starts here.
      this.url = target;
      this.reconnectAttempts = 0;
      onOpen();
    };

    socket.onmessage = (raw) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(raw.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(message);
    };

    socket.onerror = () => {
      // onclose always follows, and that is where reconnection is handled.
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.deliberateClose) return;
      if (!settled) {
        // Refused before it ever opened: that address is wrong, not the
        // machine unreachable. Move to the next one immediately.
        settled = true;
        clearTimeout(timer);
        return this.open(onOpen, attempt + 1);
      }
      this.scheduleReconnect();
    };
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'paired':
        this.sessionToken = message.sessionToken;
        this.callbacks.onState('connected');
        this.callbacks.onMachine?.(message.machine, message.capability);
        this.callbacks.onPaired(message.project, message.agents);
        return;

      case 'pair_rejected':
        this.deliberateClose = true;
        this.callbacks.onState('failed', message.detail);
        return;

      case 'resumed':
        this.callbacks.onState('connected');
        if (message.missedEvents > 0) {
          this.callbacks.onGap?.(message.runId, message.missedEvents);
        }
        return;

      case 'project_changed':
        this.callbacks.onProject?.(message.project);
        return;

      case 'branches':
        this.callbacks.onBranches?.(message.branches);
        return;

      case 'changes':
        this.callbacks.onChanges?.(message.runId, message.result);
        return;

      case 'activity':
        this.callbacks.onActivity?.(message.events, message.sinceLastVisit);
        return;

      case 'activity_event':
        this.callbacks.onActivityEvent?.(message.event);
        return;

      case 'machine_changed':
        this.callbacks.onMachine?.(message.machine, message.capability);
        return;

      case 'agents_changed':
        this.callbacks.onAgents?.(message.agents);
        return;

      case 'event': {
        const { event } = message;
        const seen = this.lastSeq.get(event.runId) ?? -1;
        // Replays can overlap with what already arrived live; drop duplicates
        // rather than rendering the same text twice.
        if (event.seq <= seen) return;
        this.lastSeq.set(event.runId, event.seq);
        this.callbacks.onEvent(event, message.replayed === true);
        return;
      }

      default:
        return;
    }
  }

  private scheduleReconnect(): void {
    if (!this.sessionToken) {
      return this.callbacks.onState('idle');
    }
    // Back off, but stay responsive: a phone usually rejoins Wi-Fi in seconds.
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts += 1;
    this.callbacks.onState('reconnecting', `retrying in ${Math.round(delay / 1000)}s`);

    setTimeout(() => {
      this.open(() => {
        this.send({
          type: 'resume',
          token: this.sessionToken!,
          runId: this.activeRunId ?? 'none',
          lastSeq: this.activeRunId ? (this.lastSeq.get(this.activeRunId) ?? -1) : -1,
        });
      });
    }, delay);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }
}
