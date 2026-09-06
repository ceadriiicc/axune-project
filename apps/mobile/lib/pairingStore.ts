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
  url: string;
  sessionToken: string;
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
    if (!parsed.url || !parsed.sessionToken) return null;
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
