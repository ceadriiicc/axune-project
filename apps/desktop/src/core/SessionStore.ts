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
    this.state.providerSessions[key] = providerSessionId;
    this.prune();
    this.save();
  }

  providerSession(sessionId: string, agentId: string): string | undefined {
    return this.state.providerSessions[`${sessionId}:${agentId}`];
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
    const sessions = Object.entries(this.state.providerSessions);
    if (sessions.length > MAX_PROVIDER_SESSIONS) {
      this.state.providerSessions = Object.fromEntries(sessions.slice(-MAX_PROVIDER_SESSIONS));
    }
  }

  // ---- persistence -----------------------------------------------------

  private load(): void {
    try {
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.state = {
        devices: parsed.devices ?? {},
        providerSessions: parsed.providerSessions ?? {},
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
  providerSessions: Record<string, string>;
}

interface StoredDevice {
  deviceName: string;
  pairedAt: number;
  /** Last time this device actually connected. Absent in files written before pruning existed. */
  lastSeenAt?: number;
}

function defaultPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'Axune', 'desktop-state.json');
}
