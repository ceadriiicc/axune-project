import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  fingerprint,
  fromBase64Url,
  generateIdentity,
  toBase64Url,
  type Identity,
  type RandomBytes,
} from '@axune/secure-channel';

/**
 * This desktop's long-term X25519 identity.
 *
 * The public half goes in the pairing QR, which is what makes the encrypted
 * link *authenticated* rather than merely encrypted. A key read off a screen
 * arrives out-of-band, so an attacker sitting on the network has no way to
 * substitute their own: they would have to alter the QR code on the monitor.
 * Diffie-Hellman without that pinning agrees a perfectly good key with whoever
 * happens to answer, which on a hostile network is the attacker.
 *
 * Therefore it must be **stable across restarts**. A key regenerated per launch
 * would agree fine on the first pairing and then fail every reconnect, because
 * the phone pinned a key the desktop no longer holds - the failure would look
 * like a pairing bug rather than the security check it is.
 */
export class DeviceIdentity {
  private identity: Identity | null = null;

  constructor(
    private readonly file = defaultPath(),
    private readonly random: RandomBytes = nodeRandom,
  ) {}

  /** Load the stored identity, or mint one on first run. */
  private load(): Identity {
    if (this.identity) return this.identity;

    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoredIdentity;
      const privateKey = fromBase64Url(parsed.privateKey);
      const publicKey = fromBase64Url(parsed.publicKey);
      // A truncated or hand-edited file must not silently become a weak key.
      if (privateKey.length === 32 && publicKey.length === 32) {
        this.identity = { privateKey, publicKey };
        return this.identity;
      }
    } catch {
      // No identity yet, or an unreadable one. Both mean: mint a fresh one.
      // Reusing a half-parsed key would be worse than pairing again.
    }

    this.identity = generateIdentity(this.random);
    this.save(this.identity);
    return this.identity;
  }

  /** The public half. Safe to print, to encode in a QR, to log. */
  get publicKey(): Uint8Array {
    return this.load().publicKey;
  }

  /** The public half as it travels: base64url, the same encoding the phone reads. */
  get publicKeyEncoded(): string {
    return toBase64Url(this.publicKey);
  }

  /**
   * Short human-readable digest of the public key, for a "does your phone show
   * the same code?" check. Not used by the protocol - the QR already pins the
   * key - but a person can compare six characters and cannot compare 32 bytes.
   */
  get fingerprint(): string {
    return fingerprint(this.publicKey);
  }

  /**
   * The private half, for deriving a shared secret. Never leaves this process:
   * there is deliberately no accessor that returns it encoded, because the only
   * legitimate use is as an argument to `new SecureChannel(...)` here on the
   * desktop.
   */
  get privateKey(): Uint8Array {
    return this.load().privateKey;
  }

  /**
   * Throw this identity away and mint a new one. Every paired phone is
   * invalidated, because each pinned the old public key - which is exactly what
   * "this machine may be compromised" should mean.
   */
  reset(): string {
    this.identity = generateIdentity(this.random);
    this.save(this.identity);
    return this.fingerprint;
  }

  private save(identity: Identity): void {
    mkdirSync(dirname(this.file), { recursive: true });
    // 0600 because this file is the machine's identity: anyone who can read it
    // can impersonate this desktop to every phone that ever paired with it.
    writeFileSync(
      this.file,
      JSON.stringify({
        privateKey: toBase64Url(identity.privateKey),
        publicKey: toBase64Url(identity.publicKey),
      } satisfies StoredIdentity),
      { mode: 0o600 },
    );
  }
}

interface StoredIdentity {
  privateKey: string;
  publicKey: string;
}

/**
 * Node's CSPRNG. The channel takes randomness as a parameter rather than
 * reaching for a global, so each side supplies the best source it actually has
 * - `node:crypto` here, `expo-crypto` on the phone.
 */
export const nodeRandom: RandomBytes = (length) => Uint8Array.from(randomBytes(length));

function defaultPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'Axune', 'identity.json');
}
