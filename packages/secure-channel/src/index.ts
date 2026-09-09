import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

/**
 * End-to-end encryption between the phone and the desktop.
 *
 * ## Why this exists
 *
 * Everything crossing the wire today is plain `ws://`: prompts, replies, and -
 * because `tool_finished` carries the whole tool result - the contents of files
 * an agent read. Anyone on the same Wi-Fi can read all of it. That is tolerable
 * on a trusted home network and unacceptable the moment a relay sits in the
 * middle, so this has to come before the relay rather than after it.
 *
 * ## What it protects against
 *
 * - **Passive listeners on the LAN.** Nothing readable crosses the wire.
 * - **A relay operator.** Keys are agreed end to end, so whatever sits in the
 *   middle forwards ciphertext it cannot read. That is the whole point of doing
 *   this first: it makes the relay's trustworthiness irrelevant.
 * - **Machine-in-the-middle at pairing.** The desktop's public key travels in
 *   the QR code, which is an out-of-band channel - a screen in the same room.
 *   An attacker who intercepts the socket cannot substitute their own key
 *   without also being on that screen.
 * - **Replay and reflection.** Each direction has its own key, and each message
 *   carries an authenticated counter that must strictly increase.
 *
 * ## What it does not protect against
 *
 * A compromised desktop or a compromised phone. If either endpoint is owned,
 * encryption between them is beside the point.
 *
 * ## Choices worth knowing
 *
 * X25519 for agreement, HKDF-SHA256 to derive, XChaCha20-Poly1305 to encrypt -
 * all from `@noble`, which is pure TypeScript. That matters: a native crypto
 * module would mean a new native build for the phone every time, and Expo
 * builds here have taken three attempts before. ChaCha rather than AES because
 * it does not depend on hardware AES to be fast or constant-time, and a phone
 * running interpreted JavaScript is exactly where that shows.
 *
 * XChaCha's 24-byte nonce is random per message rather than a counter. A
 * counter is smaller but has to be persisted correctly across restarts, and a
 * repeated nonce with the same key destroys the guarantee outright. Random is
 * the boring choice and boring is right here.
 */

/**
 * Where randomness comes from.
 *
 * Injected rather than taken from a global, because there is no single answer.
 * Node has `crypto.getRandomValues`; React Native does **not** provide it by
 * default and needs a module to supply one. Making it a parameter means the
 * crypto core is testable and reviewable now, with the phone's source decided
 * separately - and it means a caller can never accidentally get a weak one by
 * default, because there is no default.
 */
export type RandomBytes = (length: number) => Uint8Array;

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Which end of the conversation this is. Decides which key sends and which receives. */
export type Role = 'desktop' | 'phone';

/** One encrypted message on the wire. */
export interface Envelope {
  /** Message counter, authenticated. Must strictly increase per direction. */
  n: number;
  /** Base64url nonce, 24 bytes. */
  iv: string;
  /** Base64url ciphertext including the Poly1305 tag. */
  c: string;
}

const KEY_LENGTH = 32;
const NONCE_LENGTH = 24;

/** A fresh X25519 identity. The private half never leaves the device that made it. */
export function generateIdentity(random: RandomBytes): Identity {
  const privateKey = random(KEY_LENGTH);
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/**
 * An encrypted channel with one peer.
 *
 * Construct one per connection. Both ends must pass the same `salt` - in
 * practice the pairing token, which is single-use and already shared over the
 * QR - so that two sessions between the same two keys never derive the same
 * keys.
 */
export class SecureChannel {
  private readonly sendKey: Uint8Array;
  private readonly receiveKey: Uint8Array;
  private sendCounter = 0;
  private highestReceived = -1;

  constructor(
    role: Role,
    myPrivateKey: Uint8Array,
    theirPublicKey: Uint8Array,
    salt: string,
    private readonly random: RandomBytes,
  ) {
    const shared = x25519.getSharedSecret(myPrivateKey, theirPublicKey);
    const saltBytes = utf8(salt);

    // Two keys, not one. With a single key a message captured from the desktop
    // could be replayed back at it and would decrypt, since both ends would
    // hold the same secret. Separate directions make reflection impossible
    // rather than merely detectable.
    const desktopToPhone = hkdf(sha256, shared, saltBytes, utf8('axune d2p v1'), KEY_LENGTH);
    const phoneToDesktop = hkdf(sha256, shared, saltBytes, utf8('axune p2d v1'), KEY_LENGTH);

    this.sendKey = role === 'desktop' ? desktopToPhone : phoneToDesktop;
    this.receiveKey = role === 'desktop' ? phoneToDesktop : desktopToPhone;
  }

  /** Encrypt one message. */
  seal(plaintext: string): Envelope {
    const n = this.sendCounter++;
    const nonce = this.random(NONCE_LENGTH);
    // The counter is authenticated as associated data, so it cannot be edited
    // in flight to slip a message past the replay check.
    const cipher = xchacha20poly1305(this.sendKey, nonce, counterBytes(n));
    return { n, iv: toBase64Url(nonce), c: toBase64Url(cipher.encrypt(utf8(plaintext))) };
  }

  /**
   * Decrypt one message, or throw.
   *
   * Throws rather than returning null on purpose: a message that fails to
   * authenticate is either corruption or an attack, and there is no sensible
   * way for a caller to "handle" it other than dropping the connection.
   */
  open(envelope: Envelope): string {
    if (!Number.isInteger(envelope.n) || envelope.n < 0) {
      throw new Error('secure channel: message counter is not a whole number');
    }
    if (envelope.n <= this.highestReceived) {
      throw new Error(
        `secure channel: message ${envelope.n} replays or reorders behind ${this.highestReceived}`,
      );
    }

    const nonce = fromBase64Url(envelope.iv);
    if (nonce.length !== NONCE_LENGTH) {
      throw new Error(`secure channel: nonce is ${nonce.length} bytes, expected ${NONCE_LENGTH}`);
    }

    const cipher = xchacha20poly1305(this.receiveKey, nonce, counterBytes(envelope.n));
    // Throws if the tag does not verify, which covers tampering with the
    // ciphertext, the nonce, the counter, or the key being wrong.
    const plaintext = cipher.decrypt(fromBase64Url(envelope.c));

    // Advanced only after the message authenticates, so a forged high counter
    // cannot lock out the genuine peer.
    this.highestReceived = envelope.n;
    return new TextDecoder().decode(plaintext);
  }

  /** For diagnostics and tests. Never log the keys themselves. */
  get counters(): { sent: number; highestReceived: number } {
    return { sent: this.sendCounter, highestReceived: this.highestReceived };
  }
}

/**
 * A short, human-checkable fingerprint of a public key.
 *
 * For a "does this match what your desktop shows?" confirmation, which is the
 * fallback when a QR code is not the channel - over a relay, for instance.
 * Deliberately short enough to read aloud and long enough that finding a
 * collision is not worth anyone's afternoon.
 */
export function fingerprint(publicKey: Uint8Array): string {
  const digest = sha256(publicKey);
  return Array.from(digest.slice(0, 5))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .replace(/(.{5})/g, '$1 ')
    .trim();
}

/**
 * Base64url, implemented rather than borrowed.
 *
 * The global encoders exist in Node and in browsers but are not guaranteed in
 * React Native, and Buffer is Node-only. Depending on either is the kind of
 * thing that typechecks, passes every test on a desktop, and then fails on the
 * phone - the one place this has to work. Twenty lines is cheaper than learning
 * that from a device.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : undefined;

    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += ALPHABET[c & 0x3f];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    const value = ALPHABET.indexOf(character);
    // Anything outside the alphabet is corruption or an attack. Treating it as
    // a zero would hand the cipher a quietly wrong input instead of failing.
    if (value < 0) throw new Error(`secure channel: invalid base64url character "${character}"`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The counter as fixed-width associated data. */
function counterBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(n));
  return bytes;
}
