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
export class SessionStore {
  private state: PersistedState = { devices: {}, providerSessions: {} };

  constructor(private readonly file = defaultPath()) {
    this.load();
  }

  // ---- trusted devices -------------------------------------------------

  trustDevice(sessionToken: string, deviceName: string): void {
    this.state.devices[sessionToken] = { deviceName, pairedAt: Date.now() };
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
    this.state.providerSessions[`${sessionId}:${agentId}`] = providerSessionId;
    this.save();
  }

  providerSession(sessionId: string, agentId: string): string | undefined {
    return this.state.providerSessions[`${sessionId}:${agentId}`];
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
  devices: Record<string, { deviceName: string; pairedAt: number }>;
  providerSessions: Record<string, string>;
}

function defaultPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'Axune', 'desktop-state.json');
}
