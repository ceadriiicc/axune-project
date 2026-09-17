import * as SecureStore from 'expo-secure-store';

/**
 * Where the phone keeps its pairing.
 *
 * The session token is a credential that grants control of a developer's
 * machine, so it goes in the Keychain rather than plain storage. Losing it is
 * merely inconvenient — the phone rescans — so every failure here is swallowed
 * rather than surfaced.
 */
const KEY = 'axune.pairing.v1';

export interface StoredPairing {
  /** The address that last worked. */
  url: string;
  /**
   * Every address the desktop said it answers on, best first.
   *
   * Optional because a pairing stored by an earlier version has only `url`.
   * Reconnection walks this list, which is what lets a stored pairing survive
   * the machine changing IP - the thing that previously forced a QR rescan.
   */
  urls?: string[];
  sessionToken: string;
  /**
   * The desktop's public key, base64url, as read from the QR.
   *
   * Stored because a reconnect has no QR to read it from again, and without
   * it the phone has no way to tell the real desktop from anything else that
   * has taken that address since. Kept beside the session token rather than
   * in plain storage - not because a public key is secret, but because a
   * pairing that can be silently edited is a pairing that can be redirected.
   */
  publicKey: string;
  projectName: string;
  pairedAt: number;
}

export async function savePairing(pairing: StoredPairing): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(pairing), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Persistence is a convenience. If the Keychain refuses, the phone simply
    // pairs again next launch.
  }
}

export async function loadPairing(): Promise<StoredPairing | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPairing;
    // A pairing stored before the link was encrypted has no key to pin, and
    // there is no safe way to reconnect without one. Treated as no pairing at
    // all, so the phone offers a QR instead of quietly connecting in the
    // clear - the rescan costs seconds and is the honest outcome.
    if (!parsed.url || !parsed.sessionToken || !parsed.publicKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPairing(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing useful to do; the desktop can also revoke from its side.
  }
}

/**
 * When this device last looked at Home.
 *
 * Kept beside the pairing rather than in the credential blob so that reading it
 * never risks touching the token, and so clearing the pairing does not erase
 * the sense of "what changed while I was away".
 */
const LAST_SEEN_KEY = 'axune.lastSeenAt.v1';

export async function loadLastSeenAt(): Promise<number | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(LAST_SEEN_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function saveLastSeenAt(at: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_SEEN_KEY, String(at));
  } catch {
    // Losing this only means the next visit shows no "since" summary.
  }
}
