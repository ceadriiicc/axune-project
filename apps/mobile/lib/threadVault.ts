import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils';

import type { RandomBytes } from '@axune/secure-channel';

/**
 * Encryption for conversation history at rest.
 *
 * ## Why this exists
 *
 * `threadStore` keeps threads in `Paths.document`, which on iOS is included in
 * iCloud and iTunes backups. Conversations quote the repository, so the
 * practical effect was that source from a private project left the phone for
 * Apple's servers through a path nobody chose and nothing disclosed.
 *
 * The obvious fix - move the file to `Paths.cache`, which is not backed up -
 * costs the thing the store was built for. The cache directory is documented as
 * "files that can be deleted by the system when the device runs low on
 * storage", so archived conversations would start vanishing again, which is
 * exactly the loss that made persistence necessary in the first place.
 *
 * So the file stays where it survives, and what lands in the backup is
 * ciphertext. The key lives in the Keychain marked device-only, and Keychain
 * items marked that way are themselves excluded from backups. A restored device
 * therefore gets an envelope it cannot open.
 *
 * **What this does not protect against.** Anything that can read the Keychain on
 * the unlocked device can read the threads - this is not a passphrase, and it is
 * not meant to survive a compromised phone. It closes one specific hole: history
 * silently leaving the device inside a backup.
 *
 * ## Why hex rather than base64
 *
 * React Native has no dependable `btoa`, and `@noble` ships no base64 helper -
 * both checked rather than assumed. Hex doubles the file on disk, which against
 * a payload `threadShrink` already caps at 600 KB is a cost worth paying to
 * avoid carrying a polyfill for an encoding.
 *
 * Kept free of React Native imports so it can be tested under Node, which is the
 * only reason any of this has ever been caught before shipping. Randomness
 * arrives as a parameter for the same reason.
 */

/** XChaCha20-Poly1305: 256-bit key, 192-bit nonce. */
export const KEY_BYTES = 32;
const NONCE_BYTES = 24;

/**
 * Marks the envelope format. Present so a future change can be recognised
 * rather than guessed at, and so a plaintext `v1` file is never mistaken for a
 * damaged `v2` one.
 */
const VERSION = 'v2';

export function newVaultKey(random: RandomBytes): Uint8Array {
  const key = random(KEY_BYTES);
  // A short read would weaken every envelope written with it, silently.
  if (key.length !== KEY_BYTES) {
    throw new Error(`expected ${KEY_BYTES} random bytes for a vault key, got ${key.length}`);
  }
  return key;
}

export function encodeKey(key: Uint8Array): string {
  return bytesToHex(key);
}

/**
 * Read a key back from storage.
 *
 * Total, like everything else here: a truncated or hand-edited Keychain value
 * yields null and the caller mints a fresh key, losing the history rather than
 * failing to launch.
 */
export function decodeKey(encoded: string | null): Uint8Array | null {
  if (!encoded) return null;
  try {
    const key = hexToBytes(encoded);
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}

/**
 * Seal a string into a storable envelope.
 *
 * A fresh nonce is drawn on every write and never reused. Nonce reuse under
 * XChaCha20-Poly1305 is catastrophic rather than merely weak, and the reason a
 * counter was not used is that a counter has to survive the same crash the file
 * does - 24 random bytes have no such dependency.
 */
export function seal(plaintext: string, key: Uint8Array, random: RandomBytes): string {
  const nonce = random(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`expected ${NONCE_BYTES} random bytes for a nonce, got ${nonce.length}`);
  }
  const sealed = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  return `${VERSION}.${bytesToHex(nonce)}.${bytesToHex(sealed)}`;
}

/**
 * Open an envelope, or return null.
 *
 * Never throws. This runs during launch, and the failures it has to survive are
 * ordinary: a half-written file from a crash mid-save, a value from an older
 * build, or a key that no longer matches because the Keychain entry was lost in
 * a restore. Losing history is a disappointment; refusing to start is a broken
 * app.
 *
 * Poly1305 authentication means a tampered envelope fails here rather than
 * producing plausible rubbish further up.
 */
export function open(envelope: string | null, key: Uint8Array): string | null {
  if (!envelope) return null;
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;

  try {
    const nonce = hexToBytes(parts[1]!);
    const sealed = hexToBytes(parts[2]!);
    if (nonce.length !== NONCE_BYTES) return null;
    return bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(sealed));
  } catch {
    return null;
  }
}

/** Whether a stored value looks like one of our envelopes rather than plaintext JSON. */
export function isSealed(raw: string | null): boolean {
  return typeof raw === 'string' && raw.startsWith(`${VERSION}.`);
}
