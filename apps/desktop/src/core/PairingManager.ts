import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';

import { PROTOCOL_VERSION, type PairingPayload } from '@axune/protocol';

/**
 * Issues the short-lived credential a phone presents to pair.
 *
 * Axune drives a program that can read a developer's whole machine, so the
 * desktop must never accept an unauthenticated socket. The rules here are
 * deliberately strict for a first version:
 *
 *  - tokens expire quickly, because a QR code left on screen is a credential
 *    sitting in the room;
 *  - a token pairs one device once, so a photographed code cannot be reused;
 *  - comparison is constant-time, so a token cannot be guessed byte by byte.
 */
export class PairingManager {
  private current: IssuedToken | null = null;
  private readonly paired = new Map<string, PairedDevice>();

  constructor(private readonly ttlMs = 2 * 60 * 1000) {}

  /** Mint a fresh token, invalidating any previous unused one. */
  issue(port: number, projectName: string): PairingPayload {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.current = { token, expiresAt, consumed: false };

    return {
      kind: 'axune',
      protocolVersion: PROTOCOL_VERSION,
      url: `ws://${lanAddress()}:${port}`,
      urls: reachableUrls(port),
      token,
      expiresAt,
      projectName,
    };
  }

  /** Validate a pairing attempt and, on success, bind a session token to the device. */
  redeem(token: string, deviceName: string, protocolVersion: number): RedeemResult {
    if (protocolVersion !== PROTOCOL_VERSION) {
      return {
        ok: false,
        reason: 'version_mismatch',
        detail: `Desktop speaks protocol ${PROTOCOL_VERSION}, phone speaks ${protocolVersion}.`,
      };
    }

    const issued = this.current;
    if (!issued || !constantTimeEquals(token, issued.token)) {
      return { ok: false, reason: 'bad_token', detail: 'That pairing code is not valid.' };
    }
    if (issued.consumed) {
      return { ok: false, reason: 'expired', detail: 'That pairing code has already been used.' };
    }
    if (Date.now() > issued.expiresAt) {
      return { ok: false, reason: 'expired', detail: 'That pairing code has expired. Show a new one.' };
    }

    issued.consumed = true;
    const sessionToken = randomBytes(32).toString('base64url');
    this.paired.set(sessionToken, { deviceName, pairedAt: Date.now() });
    return { ok: true, sessionToken, deviceName };
  }

  /**
   * Restore a device trusted in an earlier run of the desktop, so a restart
   * does not invalidate a phone that already paired.
   */
  trust(sessionToken: string, deviceName = 'known device'): void {
    this.paired.set(sessionToken, { deviceName, pairedAt: Date.now() });
  }

  /** Does this token belong to an already-paired device? Used on reconnect. */
  isPaired(sessionToken: string): boolean {
    for (const known of this.paired.keys()) {
      if (constantTimeEquals(sessionToken, known)) return true;
    }
    return false;
  }

  revokeAll(): void {
    this.paired.clear();
    this.current = null;
  }

  get pairedCount(): number {
    return this.paired.size;
  }
}

interface IssuedToken {
  token: string;
  expiresAt: number;
  consumed: boolean;
}

interface PairedDevice {
  deviceName: string;
  pairedAt: number;
}

export type RedeemResult =
  | { ok: true; sessionToken: string; deviceName: string }
  | { ok: false; reason: 'bad_token' | 'expired' | 'version_mismatch'; detail: string };

/** Comparison that does not leak how much of the token matched. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Every address this desktop answers on, best first.
 *
 * The hostname comes first deliberately. An IP is what the phone used to store,
 * and it is the thing that changes - three times in two days here, each time
 * breaking reconnection silently. `<hostname>.local` is resolved by iOS's own
 * mDNS resolver, needs no native module, and survives a new lease.
 *
 * The IP still follows, because mDNS is blocked on some networks and a name
 * that cannot be resolved is worse than an address that might be stale.
 */
export function reachableUrls(port: number): string[] {
  const urls = [`ws://${hostname()}.local:${port}`];
  for (const address of lanAddresses()) urls.push(`ws://${address}:${port}`);
  return urls;
}

/** Every non-loopback IPv4 address, so a machine on two networks is reachable on both. */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) found.push(address.address);
    }
  }
  return found;
}

/**
 * The LAN address the phone should dial. Loopback is useless in a QR code, so
 * it is skipped in favour of a real interface address.
 */
export function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}
