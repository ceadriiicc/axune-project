/**
 * The port the phone expects to find Axune on.
 *
 * The phone stores `ws://<lan-ip>:<port>` when it pairs and reuses it forever,
 * so the port is part of a credential's address, not an implementation detail.
 * Every entry point must agree on it: the test harnesses originally bound
 * ephemeral ports, which silently invalidated the stored pairing and made a
 * QR rescan the price of running a test. Twelve trusted devices accumulated in
 * one evening that way.
 */
export const AXUNE_PORT = 8790;

interface Listenable {
  start(port: number): Promise<number>;
}

/**
 * Bind the well-known port, or fall back to an ephemeral one.
 *
 * Falling back matters because two Axune processes at once is normal while
 * developing — the windowed app and a harness. The fallback is reported rather
 * than hidden, since a phone cannot reach the second one without rescanning.
 */
export async function listenOnKnownPort(
  server: Listenable,
  preferred = AXUNE_PORT,
): Promise<{ port: number; wasPreferred: boolean }> {
  try {
    return { port: await server.start(preferred), wasPreferred: true };
  } catch {
    return { port: await server.start(0), wasPreferred: false };
  }
}
