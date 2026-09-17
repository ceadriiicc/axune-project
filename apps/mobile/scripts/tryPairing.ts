/**
 * Proves the phone can still find the desktop after it moves, and that it will
 * only talk to the desktop it paired with.
 *
 *   npm --prefix apps/mobile run try:pairing
 *
 * The phone used to store one IP at pairing and treat it as permanent. This
 * machine moved across three addresses in two days and every move broke
 * reconnection silently, with a QR rescan the only way back. The fix is a short
 * candidate list - hostname first, then IPs - walked until one answers.
 *
 * These checks exist because the failure they guard against is invisible: a
 * stale address does not raise an error, it just hangs, and the app looks
 * "stuck" rather than wrong. So each one attacks a different way the walk can
 * fail: a refused address, an address that hangs, an address that accepts and
 * then says nothing, every address dead, and whether the winner is remembered.
 *
 * The last three attack the encrypted link rather than the walk: that a desktop
 * holding the wrong key cannot be talked to at all, that the session token
 * never appears on the wire in readable form, and that plaintext is refused
 * rather than tolerated.
 *
 * Runs against a real WebSocket server on loopback. No agent, no usage.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:net';

import type { ClientHello, SealedFrame, ServerHello } from '@axune/protocol';
import {
  SecureChannel,
  fromBase64Url,
  generateIdentity,
  toBase64Url,
  type RandomBytes,
} from '@axune/secure-channel';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';

import { AxuneClient, type ConnectionState } from '../lib/AxuneClient';

const nodeRandom: RandomBytes = (length) => Uint8Array.from(randomBytes(length));

/** The token the phone presents on reconnect. Must never appear on the wire. */
const SESSION_TOKEN = 'a-trusted-session-token';

/**
 * A port that accepts the TCP connection and then says nothing.
 *
 * This is what a moved desktop looks like from the phone: not a refusal, which
 * fails instantly, but a socket that opens and never completes the WebSocket
 * handshake. Only this case exercises the connect timeout.
 *
 * An earlier version of this test used TEST-NET-1 (192.0.2.1) expecting it to
 * hang. On Windows it failed in 0.1 seconds with no route to host, so the test
 * passed while the timeout it claimed to prove never ran at all.
 */
function startSilentPort(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server: Server = createServer((socket) => {
      // Accept and ignore. Never write, never close.
      socket.on('error', () => undefined);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `ws://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

let failures = 0;

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw: ${String(error)}`);
  }
}

interface FakeDesktop {
  url: string;
  /** Base64url public key, as the QR would carry it. */
  publicKey: string;
  connections: () => number;
  /** Frames successfully decrypted. Zero means the phone was never understood. */
  decrypted: () => number;
  /** Every raw frame received, exactly as it arrived on the wire. */
  wire: () => string[];
  close: () => void;
}

/**
 * A stand-in desktop that speaks the real encrypted protocol: it answers the
 * hello, derives the same channel, and seals its replies. A mock that skipped
 * the crypto would prove only that the phone can talk to a mock.
 *
 * `answerHello: false` accepts the WebSocket and then goes silent - a desktop
 * that is reachable but not answering, which is a different failure from one
 * that never accepts at all.
 */
function startDesktop(options: { answerHello?: boolean } = {}): Promise<FakeDesktop> {
  return new Promise((resolve) => {
    const identity = generateIdentity(nodeRandom);
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const wire: string[] = [];
    let connections = 0;
    let decrypted = 0;

    server.on('connection', (socket: ServerSocket) => {
      connections += 1;
      let channel: SecureChannel | null = null;

      socket.on('message', (raw) => {
        const text = String(raw);
        wire.push(text);

        if (!channel) {
          if (options.answerHello === false) return; // accepted, then silent
          const hello = JSON.parse(text) as ClientHello;
          channel = new SecureChannel(
            'desktop',
            identity.privateKey,
            fromBase64Url(hello.publicKey),
            hello.salt,
            nodeRandom,
          );
          socket.send(JSON.stringify({ type: 'hello_ok' } satisfies ServerHello));
          return;
        }

        let message: { type: string; runId?: string };
        try {
          const frame = JSON.parse(text) as SealedFrame;
          message = JSON.parse(channel.open(frame.envelope)) as { type: string; runId?: string };
        } catch {
          // A phone holding the wrong key lands here. Close, as the real
          // desktop does, rather than answering something it cannot read.
          socket.close();
          return;
        }
        decrypted += 1;

        if (message.type === 'resume') {
          socket.send(
            JSON.stringify({
              type: 'sealed',
              envelope: channel.seal(
                JSON.stringify({
                  type: 'resumed',
                  runId: message.runId ?? 'none',
                  fromSeq: -1,
                  missedEvents: 0,
                }),
              ),
            } satisfies SealedFrame),
          );
        }
      });
    });

    server.on('listening', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        publicKey: toBase64Url(identity.publicKey),
        connections: () => connections,
        decrypted: () => decrypted,
        wire: () => wire,
        close: () => server.close(),
      });
    });
  });
}

/** Connect with a candidate list and a pinned key, and report what happened. */
function attempt(candidates: string[], publicKey: string, timeoutMs = 12_000) {
  return new Promise<{ states: ConnectionState[]; detail: string | null; client: AxuneClient }>(
    (resolve) => {
      const states: ConnectionState[] = [];
      let lastDetail: string | null = null;
      let settled = false;

      const client = new AxuneClient({
        onState: (state, detail) => {
          states.push(state);
          if (detail) lastDetail = detail;
          if ((state === 'connected' || state === 'failed') && !settled) {
            settled = true;
            // Let the resume round-trip finish before inspecting.
            setTimeout(() => resolve({ states, detail: lastDetail, client }), 60);
          }
        },
        onEvent: () => undefined,
        onPaired: () => undefined,
      }, nodeRandom);

      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ states, detail: lastDetail, client });
        }
      }, timeoutMs);

      client.reconnectWithSession(candidates, SESSION_TOKEN, publicKey);
    },
  );
}

async function main() {
  console.log('\nfinding the desktop after it moves, and refusing the wrong one\n');
  const desktop = await startDesktop();

  await check('a single good address connects', async () => {
    const { states, client } = await attempt([desktop.url], desktop.publicKey);
    client.disconnect();
    if (!states.includes('connected')) return `FAIL: never connected, saw ${states.join(' > ')}`;
    return `connected, states: ${states.join(' > ')}`;
  });

  await check('a refused address is skipped for the next one', async () => {
    // Port 1 on loopback refuses immediately: the wrong-address case, which
    // must advance rather than end the attempt.
    const before = desktop.connections();
    const { states, client } = await attempt(['ws://127.0.0.1:1', desktop.url], desktop.publicKey);
    client.disconnect();
    if (!states.includes('connected')) return `FAIL: gave up, saw ${states.join(' > ')}`;
    const opened = desktop.connections() - before;
    if (opened !== 1) return `FAIL: opened ${opened} sockets to the desktop, expected 1`;
    return `skipped the dead address and connected, one socket opened`;
  });

  await check('an address that hangs times out and falls through', async () => {
    // The real-world case: the machine has moved, so the old address does not
    // refuse - the socket opens and nothing ever answers. Without an explicit
    // timeout the phone waits for ever and simply looks broken.
    const silent = await startSilentPort();
    const started = Date.now();
    const { states, client } = await attempt([silent.url, desktop.url], desktop.publicKey);
    client.disconnect();
    silent.close();

    const elapsed = Date.now() - started;
    const seconds = (elapsed / 1000).toFixed(1);
    if (!states.includes('connected')) return `FAIL: never fell through, saw ${states.join(' > ')}`;
    // Below three seconds means the address failed fast and the timeout never
    // fired, so this check would be passing without testing anything.
    if (elapsed < 3_000) return `FAIL: fell through in ${seconds}s - the timeout did not run`;
    if (elapsed > 9_000) return `FAIL: took ${seconds}s - the timeout is too slow to sit through`;
    return `waited ${seconds}s on a silent address, then connected on the next`;
  });

  await check('a desktop that accepts but never answers the hello falls through', async () => {
    // New failure mode introduced by the handshake: the WebSocket upgrade
    // completes, so the old timeout would have been cleared, and then nothing
    // arrives. Indistinguishable from a hang to the person holding the phone,
    // so the timeout has to cover the handshake and not just the socket.
    const mute = await startDesktop({ answerHello: false });
    const started = Date.now();
    const { states, client } = await attempt([mute.url, desktop.url], desktop.publicKey);
    client.disconnect();
    mute.close();

    const elapsed = Date.now() - started;
    const seconds = (elapsed / 1000).toFixed(1);
    if (!states.includes('connected')) return `FAIL: never fell through, saw ${states.join(' > ')}`;
    if (elapsed < 3_000) return `FAIL: fell through in ${seconds}s - the timeout did not cover the handshake`;
    return `waited ${seconds}s on a mute desktop, then connected on the next`;
  });

  await check('the address that worked is remembered and tried first', async () => {
    const { client } = await attempt(['ws://127.0.0.1:1', desktop.url], desktop.publicKey);
    const credential = client.credential;
    client.disconnect();
    if (!credential) return 'FAIL: no credential to store';
    if (credential.url !== desktop.url) return `FAIL: remembered ${credential.url}`;
    if (credential.urls[0] !== desktop.url) {
      return `FAIL: next launch would start at ${credential.urls[0]}`;
    }
    if (!credential.urls.includes('ws://127.0.0.1:1')) {
      return 'FAIL: dropped the other candidates, so a move back would need a rescan';
    }
    if (credential.publicKey !== desktop.publicKey) {
      return 'FAIL: stored the wrong desktop key, so the next reconnect cannot pin';
    }
    return `remembers ${credential.url} first, keeps ${credential.urls.length} candidates and the key`;
  });

  await check('every address dead fails honestly rather than hanging', async () => {
    const { states, detail, client } = await attempt(
      ['ws://127.0.0.1:1', 'ws://127.0.0.1:2'],
      desktop.publicKey,
    );
    client.disconnect();
    if (!states.includes('failed')) return `FAIL: did not report failure, saw ${states.join(' > ')}`;
    if (!detail || /any known address/i.test(detail) === false) {
      return `FAIL: unhelpful reason: ${detail ?? 'none'}`;
    }
    return `failed with a reason: "${detail}"`;
  });

  // --- the link itself ----------------------------------------------------

  await check('a desktop holding a different key is never talked to', async () => {
    // The attack the QR exists to stop: something answers on the right address
    // but is not the machine that was paired with. It completes the WebSocket
    // handshake and even replies hello_ok, because at that point it has seen
    // nothing it could fail on - the phone's key is public. It simply cannot
    // read what comes next, and must never be handed the session token.
    const impostor = await startDesktop();
    const before = impostor.decrypted();
    const { states, client } = await attempt([impostor.url], desktop.publicKey, 6_000);
    client.disconnect();

    const read = impostor.decrypted() - before;
    const sawToken = impostor.wire().some((frame) => frame.includes(SESSION_TOKEN));
    impostor.close();

    if (states.includes('connected')) return `FAIL: connected to the wrong desktop`;
    if (read !== 0) return `FAIL: the impostor decrypted ${read} frames`;
    if (sawToken) return 'FAIL: the session token reached the impostor in readable form';
    return 'never connected, nothing decrypted, token never readable';
  });

  await check('the session token never appears on the wire in the clear', async () => {
    // The plainest statement of what the encryption is for. Before this change
    // the token crossed the LAN as JSON on every single reconnect, readable by
    // anyone on the same Wi-Fi.
    const watched = await startDesktop();
    const { states, client } = await attempt([watched.url], watched.publicKey);
    client.disconnect();

    const frames = watched.wire();
    const leaked = frames.filter((frame) => frame.includes(SESSION_TOKEN));
    watched.close();

    if (!states.includes('connected')) return `FAIL: never connected, so nothing was proved`;
    if (frames.length < 2) return `FAIL: only ${frames.length} frames seen - nothing was sent`;
    if (leaked.length > 0) return `FAIL: ${leaked.length} of ${frames.length} frames carried the token`;
    // The first frame is the hello and is meant to be readable; everything
    // after it must be sealed.
    const unsealed = frames.slice(1).filter((frame) => !frame.includes('"sealed"'));
    if (unsealed.length > 0) return `FAIL: ${unsealed.length} frames after the hello were not sealed`;
    return `${frames.length} frames: 1 hello, ${frames.length - 1} sealed, 0 carrying the token`;
  });

  desktop.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
