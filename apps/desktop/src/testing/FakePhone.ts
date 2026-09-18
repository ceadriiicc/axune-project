import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  PROTOCOL_VERSION,
  type ClientHello,
  type SealedFrame,
  type ServerHello,
} from '@axune/protocol';
import {
  SecureChannel,
  fromBase64Url,
  generateIdentity,
  toBase64Url,
  type RandomBytes,
} from '@axune/secure-channel';
import WebSocket from 'ws';

const nodeRandom: RandomBytes = (length) => Uint8Array.from(randomBytes(length));

/**
 * A phone, for the desktop's own test suites.
 *
 * The desktop no longer accepts plaintext, so a harness that opens a raw
 * WebSocket and sends JSON is talking to a socket that will close on it. This
 * performs the real handshake and then behaves like the socket used to:
 * `send` takes the same JSON string as before and seals it, and `message`
 * events carry the decrypted text, so `String(raw)` still yields JSON.
 *
 * Sharing one implementation across the four suites is deliberate. Four
 * hand-written handshakes would be four chances to write one that passes
 * against a server that is subtly wrong, and the point of these suites is to
 * catch exactly that.
 */
export class FakePhone extends EventEmitter {
  private channel: SecureChannel | null = null;

  private constructor(private readonly socket: WebSocket) {
    super();
  }

  /**
   * Open a socket and complete the handshake. Resolves once the channel
   * exists, so a caller can send immediately.
   *
   * `desktopPublicKey` is what the QR would have carried. Pass a different
   * key to play an attacker who reached the right address with the wrong
   * identity.
   */
  static connect(port: number, desktopPublicKey: string): Promise<FakePhone> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const phone = new FakePhone(socket);
    const theirKey = fromBase64Url(desktopPublicKey);

    return new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.once('open', () => {
        const ephemeral = generateIdentity(nodeRandom);
        const salt = toBase64Url(nodeRandom(16));
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: PROTOCOL_VERSION,
            publicKey: toBase64Url(ephemeral.publicKey),
            salt,
          } satisfies ClientHello),
        );

        socket.on('message', (raw) => {
          const text = String(raw);

          if (!phone.channel) {
            const reply = JSON.parse(text) as ServerHello;
            if (reply.type !== 'hello_ok') {
              return reject(new Error(`handshake refused: ${text}`));
            }
            phone.channel = new SecureChannel(
              'phone',
              ephemeral.privateKey,
              theirKey,
              salt,
              nodeRandom,
            );
            return resolve(phone);
          }

          let plaintext: string;
          try {
            const frame = JSON.parse(text) as SealedFrame;
            if (frame.type !== 'sealed') return;
            plaintext = phone.channel.open(frame.envelope);
          } catch (error) {
            // Surfaced rather than swallowed: a frame that will not open is
            // the single most interesting thing that can happen here, and a
            // suite that quietly ignored it would hang instead of failing.
            phone.emit('undecryptable', error);
            return;
          }
          phone.emit('message', plaintext);
        });
      });
    });
  }

  /** Seal and send. Takes the same JSON string the suites already build. */
  send(text: string): void {
    if (!this.channel) throw new Error('FakePhone.send before the handshake completed');
    this.socket.send(
      JSON.stringify({ type: 'sealed', envelope: this.channel.seal(text) } satisfies SealedFrame),
    );
  }

  /**
   * Send a frame exactly as given, bypassing the channel entirely.
   *
   * For the checks that attack the transport rather than use it - replaying a
   * captured frame, or trying plaintext after the handshake to prove the
   * desktop refuses to be downgraded.
   */
  sendRaw(text: string): void {
    this.socket.send(text);
  }

  close(): void {
    this.socket.close();
  }

  get readyState(): number {
    return this.socket.readyState;
  }
}
