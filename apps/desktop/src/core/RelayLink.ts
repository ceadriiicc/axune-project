import { EventEmitter } from 'node:events';

import { RELAY_PROTOCOL_VERSION, type RelayStatus } from '@axune/relay';
import WebSocket from 'ws';

/**
 * Reaches a phone that is not on this network, through a relay.
 *
 * ## Why this is shaped like a socket
 *
 * `AxuneServer` accepts inbound connections and knows nothing about where they
 * came from - it takes a socket, does a handshake on it, and refuses everything
 * until a device proves it is paired. All of that is exactly as correct over a
 * relay as it is over the LAN, and the way to keep it that way is to hand the
 * server something that behaves like a socket rather than teach it a second
 * transport.
 *
 * So this dials out, registers, and then presents the far end as a socket. The
 * server does not know the difference, which means the encryption, the pairing
 * check, device trust and event replay all apply over the relay without a line
 * of new security code. That was the whole reason the channel was built before
 * the relay rather than after.
 *
 * ## What the relay is trusted with
 *
 * Nothing it could abuse. It sees a public key that already travels in a QR
 * code, and sealed frames it has no key for. It can drop the connection, and it
 * can see that this desktop is online and roughly how much traffic flows - which
 * is the honest cost of being reachable from outside, and is why the relay is
 * opt-in rather than always on.
 */
export interface RelayLinkOptions {
  /** ws:// or wss:// address of the relay. */
  url: string;
  /** This desktop's long-term public key, base64url - the same one in the QR. */
  publicKey: string;
  /** Overridable so the suite can drive a stub. */
  connect?: (url: string) => WebSocket;
}

/**
 * The subset of a `ws` socket that `AxuneServer` actually uses.
 *
 * Deliberately a list rather than a cast: if the server starts relying on
 * something else, this fails to compile instead of failing at runtime on a
 * phone that is far from the desk.
 */
export interface SocketLike extends EventEmitter {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
  readonly OPEN: number;
}

/**
 * How long to wait before trying the relay again.
 *
 * A relay is a machine someone else operates, so it will restart, be deployed
 * over, and lose its network. Backing off rather than hammering it is the
 * difference between a reconnect and a self-inflicted outage - and the ceiling
 * matters more than the floor: a desktop that gives up is a desktop that cannot
 * be reached until someone walks over to it.
 */
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class RelayLink {
  private socket: WebSocket | null = null;
  private virtual: VirtualSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  /** Set once the relay has accepted the registration. */
  private registered = false;

  constructor(
    private readonly options: RelayLinkOptions,
    /** Called with a socket-like object each time a phone arrives through the relay. */
    private readonly onSocket: (socket: SocketLike) => void,
    /** Reported so the window can say whether the relay is reachable. */
    private readonly onState: (state: 'connecting' | 'online' | 'offline', detail?: string) => void,
  ) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.registered = false;
    try {
      this.socket?.close();
    } catch {
      // Already gone.
    }
    this.socket = null;
    this.virtual = null;
  }

  get online(): boolean {
    return this.registered;
  }

  private open(): void {
    if (this.stopped) return;
    this.onState('connecting');

    const socket = (this.options.connect ?? ((url: string) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    this.registered = false;

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'register',
          protocolVersion: RELAY_PROTOCOL_VERSION,
          publicKey: this.options.publicKey,
        }),
      );
    });

    socket.on('message', (raw: unknown) => this.onMessage(String(raw)));
    socket.on('error', () => undefined); // Handled by close, which always follows.
    socket.on('close', () => {
      this.registered = false;
      this.virtual?.emit('close');
      this.virtual = null;
      this.onState('offline');
      this.retry();
    });
  }

  private onMessage(raw: string): void {
    // Before registration the only thing that can arrive is the relay's answer.
    if (!this.registered) {
      let status: RelayStatus | null = null;
      try {
        const parsed = JSON.parse(raw) as { type?: string };
        if (parsed.type === 'relay_status') status = parsed as RelayStatus;
      } catch {
        status = null;
      }

      if (!status) {
        // Anything else at this point means the relay is not the thing we think
        // it is. Refusing loudly beats forwarding frames into it.
        this.onState('offline', 'The relay sent something unexpected before registering.');
        try {
          this.socket?.close();
        } catch {
          // Already closing.
        }
        return;
      }

      if (!status.ok) {
        // A refusal here is usually actionable - another desktop holding this
        // key, or a relay speaking a different version - so it is carried up
        // rather than retried in silence.
        this.onState('offline', status.detail ?? status.reason ?? 'The relay refused.');
        return;
      }

      this.registered = true;
      this.attempt = 0;
      this.onState('online');
      return;
    }

    // Registered: everything from here is a frame from a phone. The virtual
    // socket is created on the first one rather than at registration, because
    // until a phone actually speaks there is no connection for the server to
    // accept - and handing it an idle socket would have it time out a device
    // that was never there.
    if (!this.virtual) {
      this.virtual = new VirtualSocket((data) => {
        try {
          this.socket?.send(data);
        } catch {
          // The relay went away; close will follow and the server will clean up.
        }
      });
      this.onSocket(this.virtual);
    }
    this.virtual.emit('message', raw);
  }

  private retry(): void {
    if (this.stopped || this.timer) return;
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!;
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, wait);
    this.timer.unref?.();
  }
}

/**
 * A socket the server can talk to, whose other end is the relay.
 *
 * Only the four things `AxuneServer` uses. `readyState` and `OPEN` are here
 * because the server checks them before writing, and a virtual socket that
 * always claimed to be open would make it write into a closed relay.
 */
class VirtualSocket extends EventEmitter implements SocketLike {
  private open_ = true;

  constructor(private readonly write: (data: string) => void) {
    super();
    this.on('close', () => {
      this.open_ = false;
    });
  }

  send(data: string): void {
    if (this.open_) this.write(data);
  }

  close(): void {
    this.open_ = false;
    this.emit('close');
  }

  get readyState(): number {
    return this.open_ ? 1 : 3;
  }

  get OPEN(): number {
    return 1;
  }
}
