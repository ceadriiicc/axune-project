import { WebSocketServer, type WebSocket } from 'ws';

import {
  parseRelayMessage,
  RELAY_PROTOCOL_VERSION,
  type RelayStatus,
} from './protocol';

/**
 * A byte-forwarder that lets a phone reach a desktop it cannot see.
 *
 * ## What it does
 *
 * A desktop connects outward and registers under its public key. A phone
 * connects and asks for that key. From the moment both are present, every frame
 * from one socket is copied to the other **without being parsed**. The relay
 * has no idea what a run is.
 *
 * ## What it deliberately does not do
 *
 * No database, no accounts, no persistence. Everything is in memory and dies
 * with the process, which is the point: a relay that stores nothing cannot leak
 * what it stored. A desktop that reconnects simply registers again.
 *
 * It also does not authenticate the desktop. That sounds worse than it is and
 * the reasoning should be explicit rather than assumed:
 *
 * - An impostor who registers under someone else's public key can stop the real
 *   desktop being reachable. That is denial of service, and it is real.
 * - It cannot read anything. The phone pins the desktop's key from the QR and
 *   the channel is agreed end to end, so an impostor who forwards frames is
 *   forwarding ciphertext to a party that will fail to open it.
 * - Fixing the first properly needs a signature, and the existing identity is
 *   X25519 - key agreement, not signatures. Adding an Ed25519 key beside it is
 *   the right answer and is deliberately not in this first version, because
 *   shipping the smallest thing that can be tested beats shipping the complete
 *   thing that cannot.
 *
 * **First registration wins** while a desktop is connected, so the common case -
 * someone else guessing your key after you are online - fails. The window is a
 * desktop that is offline.
 */
export class RelayServer {
  private wss: WebSocketServer | null = null;

  /** Desktops, by public key. One socket each; a second registration is refused. */
  private readonly desktops = new Map<string, WebSocket>();
  /** Whichever socket each socket is currently piped to. */
  private readonly partners = new WeakMap<WebSocket, WebSocket>();
  /** What a socket registered as, so a disconnect can clean up its entry. */
  private readonly registeredAs = new WeakMap<WebSocket, string>();

  /** Bytes forwarded, for the operator's own sense of scale. Never contents. */
  private forwarded = 0;

  async start(port: number): Promise<number> {
    this.wss = new WebSocketServer({ port, maxPayload: 8 * 1024 * 1024 });
    this.wss.on('connection', (socket) => this.onConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', resolve);
      this.wss!.once('error', (error) => {
        this.wss?.close();
        this.wss = null;
        reject(error);
      });
    });

    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : port;
  }

  async stop(): Promise<void> {
    const server = this.wss;
    this.wss = null;
    this.desktops.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Desktops currently reachable. For a health endpoint, not for anyone else. */
  get onlineDesktops(): number {
    return this.desktops.size;
  }

  get bytesForwarded(): number {
    return this.forwarded;
  }

  private send(socket: WebSocket, message: RelayStatus): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The socket went away mid-reply. Nothing to do and nothing to log.
    }
  }

  private onConnection(socket: WebSocket): void {
    socket.on('message', (raw) => this.onMessage(socket, raw));
    socket.on('close', () => this.onClose(socket));
    // Without this an ECONNRESET from either side takes the whole relay down,
    // and a relay that dies when one phone loses signal is not a relay.
    socket.on('error', () => undefined);
  }

  private onMessage(socket: WebSocket, raw: unknown): void {
    const partner = this.partners.get(socket);

    // Already paired: forward, never parse. This branch is first on purpose -
    // it is the hot path, and it is the one where looking inside would be a
    // privacy failure rather than a bug.
    if (partner) {
      if (partner.readyState !== partner.OPEN) return;
      const data = raw as Buffer | string;
      this.forwarded += typeof data === 'string' ? data.length : data.byteLength;
      try {
        partner.send(data);
      } catch {
        // Partner gone; the close handler will tear the pair down.
      }
      return;
    }

    const message = parseRelayMessage(String(raw));
    if (!message) {
      return this.send(socket, {
        type: 'relay_status',
        ok: false,
        reason: 'malformed',
        detail: 'Expected a register or connect message.',
      });
    }
    if (message.protocolVersion !== RELAY_PROTOCOL_VERSION) {
      return this.send(socket, {
        type: 'relay_status',
        ok: false,
        reason: 'version_mismatch',
        detail: `This relay speaks ${RELAY_PROTOCOL_VERSION}, you speak ${message.protocolVersion}.`,
      });
    }

    if (message.type === 'register') {
      const existing = this.desktops.get(message.publicKey);
      if (existing && existing.readyState === existing.OPEN) {
        // First registration wins while it is live, so a second desktop cannot
        // silently take over an online one.
        return this.send(socket, {
          type: 'relay_status',
          ok: false,
          reason: 'busy',
          detail: 'A desktop is already registered under that key.',
        });
      }
      this.desktops.set(message.publicKey, socket);
      this.registeredAs.set(socket, message.publicKey);
      return this.send(socket, { type: 'relay_status', ok: true });
    }

    // A phone asking for a desktop.
    const desktop = this.desktops.get(message.publicKey);
    if (!desktop || desktop.readyState !== desktop.OPEN) {
      return this.send(socket, {
        type: 'relay_status',
        ok: false,
        reason: 'unknown_desktop',
        detail: 'That desktop is not connected to this relay.',
      });
    }

    // One phone per desktop. Without this a second phone would silently
    // re-point the desktop at itself, and the first phone would go quiet with
    // no explanation - its frames still sent, and delivered nowhere.
    if (this.partners.has(desktop)) {
      return this.send(socket, {
        type: 'relay_status',
        ok: false,
        reason: 'busy',
        detail: 'That desktop is already connected to another phone.',
      });
    }

    this.partners.set(socket, desktop);
    this.partners.set(desktop, socket);
    this.send(socket, { type: 'relay_status', ok: true });
  }

  private onClose(socket: WebSocket): void {
    const key = this.registeredAs.get(socket);
    // Only if this socket is still the registered one. A desktop that dropped
    // and came back has already replaced the entry, and a late close event from
    // the dead socket must not evict the live one.
    if (key && this.desktops.get(key) === socket) {
      this.desktops.delete(key);
    }

    const partner = this.partners.get(socket);
    if (partner) {
      this.partners.delete(socket);
      this.partners.delete(partner);
      // The other end learns the hard way, which is correct: a dropped socket
      // is exactly what the phone's reconnect logic already handles.
      try {
        partner.close();
      } catch {
        // Already closing.
      }
    }
  }
}
