import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The desktop's small amount of durable state.
 *
 * Two things need to outlive a restart:
 *
 *  - **Trusted devices.** A pairing QR is a one-time credential, which is right
 *    for first contact and wrong for every morning after. Without this, closing
 *    the desktop means rescanning, and a product nobody wants to re-pair daily.
 *  - **Provider session ids.** Claude Code can resume a conversation, but only
 *    if we remember its id. Without this every prompt is a fresh conversation
 *    and the agent has no memory of the last thing you asked.
 *
 * Stored in the user's profile, never in the repository — it holds credentials.
 */
/** A phone unseen for this long has to scan again. */
const MAX_DEVICE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** How many phones may be trusted at once. */
const MAX_DEVICES = 8;
/** How many conversations keep a resumable provider session. */
const MAX_PROVIDER_SESSIONS = 50;
/**
 * And how long one may live. Claude Code prunes its own session files well
 * before this, so a months-old id is a pointer to nothing that still records
 * that a conversation happened.
 */
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class SessionStore {
  private state: PersistedState = { devices: {}, providerSessions: {} };

  constructor(private readonly file = defaultPath()) {
    this.load();
  }

  // ---- trusted devices -------------------------------------------------

  trustDevice(sessionToken: string, deviceName: string): void {
    const now = Date.now();
    this.state.devices[sessionToken] = { deviceName, pairedAt: now, lastSeenAt: now };
    this.prune();
    this.save();
  }

  /**
   * Note that a trusted device is still in use, so pruning keeps the phone
   * that actually pairs with this machine and drops the ones that do not.
   */
  touchDevice(sessionToken: string): void {
    const device = this.state.devices[sessionToken];
    if (!device) return;
    device.lastSeenAt = Date.now();
    this.save();
  }

  isTrusted(sessionToken: string): boolean {
    return Boolean(this.state.devices[sessionToken]);
  }

  trustedTokens(): string[] {
    return Object.keys(this.state.devices);
  }

  deviceName(sessionToken: string): string | null {
    return this.state.devices[sessionToken]?.deviceName ?? null;
  }

  /** Used by a "forget this phone" action, and to recover from a leaked code. */
  revokeAll(): void {
    this.state.devices = {};
    this.save();
  }

  /**
   * Forget everything this store holds, and say what went.
   *
   * Every other record here expires on its own eventually; this is the control
   * for someone who does not want to wait. It reports counts rather than
   * succeeding silently, because "it says it deleted something" is the only
   * evidence a person has that a privacy control did anything at all.
   */
  forgetEverything(): { devices: number; providerSessions: number } {
    const removed = {
      devices: Object.keys(this.state.devices).length,
      providerSessions: Object.keys(this.state.providerSessions).length,
    };
    this.state = { devices: {}, providerSessions: {} };
    this.save();
    return removed;
  }

  // ---- provider session continuity ------------------------------------

  /**
   * Remember the provider's session id for an Axune session, so the next prompt
   * continues the same conversation instead of starting over.
   */
  rememberProviderSession(sessionId: string, agentId: string, providerSessionId: string): void {
    const key = `${sessionId}:${agentId}`;
    // Deleted first so the key moves to the end of the object: insertion order
    // is what `prune` uses to decide which conversations to forget.
    delete this.state.providerSessions[key];
    this.state.providerSessions[key] = { id: providerSessionId, at: Date.now() };
    this.prune();
    this.save();
  }

  providerSession(sessionId: string, agentId: string): string | undefined {
    return this.state.providerSessions[`${sessionId}:${agentId}`]?.id;
  }

  /**
   * Keep the trusted-device list small and current.
   *
   * Each entry is a bearer token that grants control of this machine, and
   * every re-pair mints another one without retiring the last. Twelve had
   * accumulated after a single evening of testing, all still valid. Since a
   * phone that has genuinely gone away never comes back for its token, the
   * only cost of forgetting one is a QR scan.
   */
  private prune(): void {
    const cutoff = Date.now() - MAX_DEVICE_AGE_MS;
    const entries = Object.entries(this.state.devices)
      .map(([token, device]) => [token, { ...device, lastSeenAt: device.lastSeenAt ?? device.pairedAt }] as const)
      .filter(([, device]) => device.lastSeenAt >= cutoff)
      .sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)
      .slice(0, MAX_DEVICES);
    this.state.devices = Object.fromEntries(entries);

    // Provider session ids are keyed by conversation and never expire on their
    // own. Insertion order is oldest first, so trimming the front drops the
    // conversations least likely to be returned to.
    const sessionCutoff = Date.now() - MAX_SESSION_AGE_MS;
    const sessions = Object.entries(this.state.providerSessions).filter(
      ([, session]) => session.at >= sessionCutoff,
    );
    this.state.providerSessions = Object.fromEntries(
      sessions.length > MAX_PROVIDER_SESSIONS ? sessions.slice(-MAX_PROVIDER_SESSIONS) : sessions,
    );
  }

  // ---- persistence -----------------------------------------------------

  private load(): void {
    try {
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.state = {
        devices: parsed.devices ?? {},
        providerSessions: migrateSessions(parsed.providerSessions),
      };
      // Expire on startup rather than only when something new is stored, so a
      // machine left alone for a month does not keep honouring old tokens.
      this.prune();
    } catch {
      // No file yet, or unreadable. Starting empty is correct — it means the
      // next phone has to pair, which is the safe direction to fail in.
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch {
      // Losing persistence degrades convenience, never correctness: the phone
      // simply has to pair again. Not worth crashing the desktop over.
    }
  }
}

interface PersistedState {
  devices: Record<string, StoredDevice>;
  /**
   * Stored with a timestamp so they expire by age as well as by count.
   *
   * Older files hold a bare string here. `load` migrates those rather than
   * discarding them: deleting a user's resumable conversations to satisfy a
   * schema change would be a worse outcome than keeping them one cycle longer.
   */
  providerSessions: Record<string, StoredSession>;
}

interface StoredSession {
  id: string;
  at: number;
}

interface StoredDevice {
  deviceName: string;
  pairedAt: number;
  /** Last time this device actually connected. Absent in files written before pruning existed. */
  lastSeenAt?: number;
}

/**
 * Read provider sessions written by an older version, which stored a bare id.
 *
 * Stamped with the current time rather than zero, so an upgrade does not
 * immediately expire every conversation someone could still resume. They get
 * one full cycle from the upgrade, which is the forgiving direction to fail in.
 */
function migrateSessions(stored: unknown): Record<string, StoredSession> {
  const out: Record<string, StoredSession> = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = { id: value, at: Date.now() };
    } else if (value && typeof value === 'object') {
      const session = value as Partial<StoredSession>;
      if (typeof session.id === 'string') {
        out[key] = { id: session.id, at: typeof session.at === 'number' ? session.at : Date.now() };
      }
    }
  }
  return out;
}

function defaultPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'Axune', 'desktop-state.json');
}
