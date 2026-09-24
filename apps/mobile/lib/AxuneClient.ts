import type {
  ActivityEvent,
  AgentBranch,
  AgentEvent,
  AgentId,
  ChangeSet,
  AgentStatus,
  Capability,
  ClientMessage,
  MachineSummary,
  PairingPayload,
  ProjectSummary,
  ServerMessage,
  ClientHello,
  SealedFrame,
  ServerHello,
} from '@axune/protocol';
import { PROTOCOL_VERSION } from '@axune/protocol';
import {
  SecureChannel,
  fromBase64Url,
  generateIdentity,
  toBase64Url,
  type Identity,
  type RandomBytes,
} from '@axune/secure-channel';

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

  /**
   * The desktop's long-term public key, read from the QR at pairing and
   * stored for every reconnect after. This is the pin: the link is
   * encrypted *to this key*, so a machine that answers on the right address
   * without the matching private half cannot read a single frame.
   */
  private desktopPublicKey: Uint8Array | null = null;
  /** This connection's encrypted channel. Null until the handshake completes. */
  private channel: SecureChannel | null = null;
  /**
   * The phone's key for this connection only. Fresh every time, so traffic
   * captured today cannot be decrypted by a key recovered from the phone
   * tomorrow.
   */
  private ephemeral: Identity | null = null;
  private salt: string | null = null;

  /** Epoch ms of this device's previous visit, sent so the desktop can diff. */
  private lastSeenAt: number | undefined;

  /**
   * Randomness is injected rather than imported, for the same reason the
   * secure channel takes it as a parameter: there is no safe default to
   * fall back to, so there is no default at all. It also keeps this file
   * free of `expo-crypto`, which pulls React Native in behind it and cannot
   * be parsed by the Node harness that tests this class.
   */
  constructor(
    private readonly callbacks: ClientCallbacks,
    private readonly random: RandomBytes,
  ) {}

  setLastSeenAt(at: number | undefined): void {
    this.lastSeenAt = at;
  }

  /**
   * Reconnect with a pairing saved from a previous launch, skipping the QR
   * entirely. The one-time code is long spent; the session token is what makes
   * a device trusted.
   */
  reconnectWithSession(urls: string[], sessionToken: string, desktopPublicKey: string): void {
    this.candidates = urls;
    this.url = urls[0] ?? null;
    this.sessionToken = sessionToken;
    // There is no QR on a reconnect, so the key pinned at pairing is the
    // only thing that distinguishes the real desktop from whatever else
    // has taken that address since.
    this.desktopPublicKey = fromBase64Url(desktopPublicKey);
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
    if (!payload.publicKey) {
      // No key means no way to tell the desktop apart from anything else on
      // the network. Refused rather than paired in the clear: an app that
      // quietly accepts an unauthenticated link teaches nobody it did.
      return this.callbacks.onState(
        'failed',
        'That desktop is too old to encrypt the link. Update Axune Desktop.',
      );
    }
    this.desktopPublicKey = fromBase64Url(payload.publicKey);

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

  /**
   * Ask an agent something.
   *
   * `agentId` used to be hardcoded to `'claude-code'` here, which meant a
   * machine with only Codex installed could not be asked anything at all - the
   * desktop would answer that the agent was not available, and the phone had no
   * way to name a different one. It is a parameter now; the caller decides,
   * because the caller is the only part that knows what is installed.
   */
  startRun(
    runId: string,
    sessionId: string,
    prompt: string,
    write = false,
    agentId: AgentId = 'claude-code',
  ): void {
    this.activeRunId = runId;
    this.lastSeq.set(runId, -1);
    this.send({
      type: 'start_run',
      runId,
      sessionId,
      prompt,
      agentIds: [agentId],
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
  get credential(): {
    url: string;
    urls: string[];
    sessionToken: string;
    publicKey: string;
  } | null {
    return this.url && this.sessionToken && this.desktopPublicKey
      ? {
          url: this.url,
          urls: this.orderedCandidates(),
          sessionToken: this.sessionToken,
          publicKey: toBase64Url(this.desktopPublicKey),
        }
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
    // A new socket is a new channel. Carrying the old one over would reuse
    // its counters and make a fresh connection look like a replayed one.
    this.channel = null;

    // React Native's WebSocket has no connect timeout, so an unreachable
    // address hangs instead of failing. Without this the fallback would never
    // be reached and the phone would simply appear stuck.
    let settled = false;
    // The timeout now covers the handshake too, not just the socket. A
    // machine that accepts the connection and never answers the hello is
    // just as stuck as one that never accepts, and looks identical to the
    // person holding the phone.
    let handshaken = false;
    const timer = setTimeout(() => {
      if (handshaken) return;
      settled = true;
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // Already gone.
      }
      this.socket = null;
      this.channel = null;
      this.open(onOpen, attempt + 1);
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      settled = true;
      // Remember what worked, so the next launch starts here.
      this.url = target;
      this.reconnectAttempts = 0;
      // Open, but not yet trustworthy. Nothing is sent - not even the
      // session token - until the channel exists.
      this.sendHello(socket);
    };

    socket.onmessage = (raw) => {
      if (!this.channel) {
        return this.onHello(String(raw.data), () => {
          handshaken = true;
          clearTimeout(timer);
          onOpen();
        });
      }

      let message: ServerMessage;
      try {
        const frame = JSON.parse(String(raw.data)) as SealedFrame;
        if (frame?.type !== 'sealed') return;
        message = JSON.parse(this.channel.open(frame.envelope)) as ServerMessage;
      } catch {
        // A frame that will not open means the peer does not hold the key
        // the QR pinned. That is not a network glitch to retry through - it
        // is either the wrong machine or an attacker, and both deserve to
        // be told to the person rather than silently reconnected around.
        this.callbacks.onState('failed', 'Could not verify the desktop. Pair again.');
        this.disconnect();
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

  /**
   * Open the handshake: a fresh key pair and a fresh salt, in the clear.
   *
   * Both are safe to send unencrypted. A public key is public by
   * definition, and an HKDF salt is not required to be secret - only
   * unique. That is precisely what lets the session token travel *inside*
   * the channel instead of in front of it, which is where it used to be.
   */
  private sendHello(socket: WebSocket): void {
    this.ephemeral = generateIdentity(this.random);
    this.salt = toBase64Url(this.random(16));
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        publicKey: toBase64Url(this.ephemeral.publicKey),
        salt: this.salt,
      } satisfies ClientHello),
    );
  }

  /** Read the desktop's answer and, if it is a yes, derive the channel. */
  private onHello(raw: string, done: () => void): void {
    let reply: ServerHello;
    try {
      reply = JSON.parse(raw) as ServerHello;
    } catch {
      return;
    }

    if (reply?.type === 'hello_rejected') {
      this.callbacks.onState('failed', reply.detail);
      return this.disconnect();
    }
    if (reply?.type !== 'hello_ok') return;

    if (!this.desktopPublicKey || !this.ephemeral || !this.salt) {
      // Nothing to pin against. Connecting anyway would produce a link that
      // is encrypted to whoever answered, which is the illusion of safety.
      this.callbacks.onState('failed', 'No stored desktop key. Pair again.');
      return this.disconnect();
    }

    this.channel = new SecureChannel(
      'phone',
      this.ephemeral.privateKey,
      this.desktopPublicKey,
      this.salt,
      this.random,
    );
    done();
  }

  private send(message: ClientMessage): void {
    // No channel means no handshake, and nothing is worth saying to a peer
    // that has not proved which machine it is.
    if (this.socket?.readyState !== 1 || !this.channel) return;
    this.socket.send(
      JSON.stringify({
        type: 'sealed',
        envelope: this.channel.seal(JSON.stringify(message)),
      } satisfies SealedFrame),
    );
  }
}
