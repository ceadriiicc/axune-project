/**
 * Proves the phone can still find the desktop after it moves.
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
 * fail: a refused address, an address that hangs, every address dead, and
 * whether the winner is remembered.
 *
 * Runs against a real WebSocket server on loopback. No agent, no usage.
 */
import { createServer, type Server } from 'node:net';

import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';

import { AxuneClient, type ConnectionState } from '../lib/AxuneClient';

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

/**
 * A stand-in desktop. Answers `resume` the way AxuneServer does, and counts
 * connections so a test can prove only one socket is ever opened.
 */
function startDesktop(): Promise<{ url: string; connections: () => number; close: () => void }> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    let connections = 0;
    server.on('connection', (socket: ServerSocket) => {
      connections += 1;
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw)) as { type: string; runId?: string };
        if (message.type === 'resume') {
          socket.send(
            JSON.stringify({
              type: 'resumed',
              runId: message.runId ?? 'none',
              fromSeq: -1,
              missedEvents: 0,
            }),
          );
        }
      });
    });
    server.on('listening', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        connections: () => connections,
        close: () => server.close(),
      });
    });
  });
}

/** Connect with a candidate list and report what happened. */
function attempt(candidates: string[], timeoutMs = 12_000) {
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
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ states, detail: lastDetail, client });
        }
      }, timeoutMs);

      client.reconnectWithSession(candidates, 'a-trusted-session-token');
    },
  );
}

async function main() {
  console.log('\nfinding the desktop after it moves\n');
  const desktop = await startDesktop();

  await check('a single good address connects', async () => {
    const { states, client } = await attempt([desktop.url]);
    client.disconnect();
    if (!states.includes('connected')) return `FAIL: never connected, saw ${states.join(' > ')}`;
    return `connected, states: ${states.join(' > ')}`;
  });

  await check('a refused address is skipped for the next one', async () => {
    // Port 1 on loopback refuses immediately: the wrong-address case, which
    // must advance rather than end the attempt.
    const before = desktop.connections();
    const { states, client } = await attempt(['ws://127.0.0.1:1', desktop.url]);
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
    const { states, client } = await attempt([silent.url, desktop.url]);
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

  await check('the address that worked is remembered and tried first', async () => {
    const { client } = await attempt(['ws://127.0.0.1:1', desktop.url]);
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
    return `remembers ${credential.url} first, keeps ${credential.urls.length} candidates`;
  });

  await check('every address dead fails honestly rather than hanging', async () => {
    const { states, detail, client } = await attempt(['ws://127.0.0.1:1', 'ws://127.0.0.1:2']);
    client.disconnect();
    if (!states.includes('failed')) return `FAIL: did not report failure, saw ${states.join(' > ')}`;
    if (!detail || !/any known address/i.test(detail)) {
      return `FAIL: unhelpful reason: ${detail ?? 'none'}`;
    }
    return `failed with a reason: "${detail}"`;
  });

  desktop.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
