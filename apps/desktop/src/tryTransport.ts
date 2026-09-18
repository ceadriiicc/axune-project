/**
 * Proves the desktop half end to end with a fake phone, before Electron and
 * before the real phone exist.
 *
 *   npm --prefix apps/desktop run try
 *
 * Exercises the four things Phase 1 has to get right:
 *   1. an unpaired socket can do nothing
 *   2. a valid QR token pairs, and a reused one is rejected
 *   3. a real Claude Code run streams over the wire
 *   4. a reconnect replays exactly what was missed, by seq
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerMessage } from '@axune/protocol';
import { WebSocket } from 'ws';

import { AxuneServer } from './core/AxuneServer';
import { DeviceIdentity } from './core/DeviceIdentity';
import { PairingManager, lanAddress } from './core/PairingManager';
import { listenOnKnownPort } from './core/port';
import { SessionStore } from './core/SessionStore';
import { FakePhone } from './testing/FakePhone';
import { fingerprint, fromBase64Url } from '@axune/secure-channel';

const REPO = process.argv[2] ?? 'C:/dev/axune';
const PROMPT =
  process.argv[3] ?? 'In one short sentence, what is this project? Do not modify anything.';

async function main() {
  const pairing = new PairingManager();
  const server = new AxuneServer(pairing, {
    name: 'axune',
    path: REPO,
    branch: 'main',
    isGitRepo: true,
  },
    // Throwaway state, so a test never writes to the real desktop's trusted
    // devices. This used to use the defaults, and every run left a live
    // session token on the machine.
    new SessionStore(join(tmpdir(), `axune-transport-${Date.now()}.json`)),
    new DeviceIdentity(join(tmpdir(), `axune-transport-identity-${Date.now()}.json`)),
  );

  // The well-known port, so a phone already paired with this machine can
  // join the harness without rescanning a QR code.
  const { port, wasPreferred } = await listenOnKnownPort(server);
  if (!wasPreferred) {
    console.log('note: the usual port was busy, so a paired phone cannot reach this run.');
  }
  const payload = pairing.issue(port, 'axune');
  console.log(`server   : ws://${lanAddress()}:${port}`);
  console.log(`qr token : ${payload.token.slice(0, 12)}…  (expires in 2 min)\n`);

  // 1 — an unpaired socket must be inert.
  await check('the code on screen is the code the phone will show', async () => {
    // The verification step is only worth a tap if both ends derive the same
    // code from the same key. If they ever disagreed, the screen would be
    // teaching people to ignore a mismatch - which is worse than showing no
    // code at all, because it trains away the one check that catches a
    // substituted desktop.
    const onScreen = server.identity.fingerprint;
    // Exactly what the phone does with the payload it scans.
    const onPhone = fingerprint(fromBase64Url(payload.publicKey));
    if (onScreen !== onPhone) {
      return `MISMATCH: desktop prints ${onScreen}, phone derives ${onPhone}`;
    }
    if (!/^[0-9A-F]{5} [0-9A-F]{5}$/.test(onPhone)) {
      return `MISMATCH: ${onPhone} is not a shape anyone can compare at a glance`;
    }
    // And a different machine must not land on the same code, or comparing
    // them would be theatre.
    const other = new DeviceIdentity(join(tmpdir(), `axune-fp-${Date.now()}.json`));
    if (other.fingerprint === onPhone) {
      return 'MISMATCH: a different identity produced the same code';
    }
    return `${onPhone} on both, and a different machine shows ${other.fingerprint}`;
  });

  await check('unpaired socket is ignored', async () => {
    const sock = await connect(port, server.identity.publicKeyEncoded);
    sock.send(JSON.stringify({ type: 'start_run', runId: 'x', sessionId: 'x', prompt: 'hi', agentIds: [], mode: 'independent' }));
    const reply = await waitFor(sock, [], 800);
    sock.close();
    return reply === null ? 'no response, as required' : `LEAK: got ${reply.type}`;
  });

  // 2 — a bad token is refused.
  await check('bad token rejected', async () => {
    const sock = await connect(port, server.identity.publicKeyEncoded);
    sock.send(JSON.stringify({ type: 'pair', token: 'wrong', deviceName: 'fake', protocolVersion: 1 }));
    const reply = await waitFor(sock, ['pair_rejected', 'paired'], 5000);
    sock.close();
    return reply?.type === 'pair_rejected' ? `rejected: ${reply.reason}` : `UNEXPECTED: ${reply?.type}`;
  });

  // 3 — the real token pairs.
  const phone = await connect(port, server.identity.publicKeyEncoded);
  let sessionToken = '';
  await check('valid token pairs', async () => {
    phone.send(JSON.stringify({ type: 'pair', token: payload.token, deviceName: 'iPhone (fake)', protocolVersion: 1 }));
    const reply = await waitFor(phone, ['paired', 'pair_rejected'], 20_000);
    if (reply?.type !== 'paired') return `UNEXPECTED: ${reply?.type}`;
    sessionToken = reply.sessionToken;
    const claude = reply.agents.find((a) => a.agentId === 'claude-code');
    return `project=${reply.project.name} claude installed=${claude?.installed} v=${claude?.version}`;
  });

  // 4 — the same token cannot be used twice.
  await check('token cannot be reused', async () => {
    const sock = await connect(port, server.identity.publicKeyEncoded);
    sock.send(JSON.stringify({ type: 'pair', token: payload.token, deviceName: 'attacker', protocolVersion: 1 }));
    const reply = await waitFor(sock, ['pair_rejected', 'paired'], 5000);
    sock.close();
    return reply?.type === 'pair_rejected' ? `rejected: ${reply.reason}` : `LEAK: ${reply?.type}`;
  });

  // 5 — a real agent run streams over the wire.
  console.log('\n── live run ──────────────────────────────────────────────');
  const runId = randomUUID();
  const seen: number[] = [];
  let text = '';

  phone.send(
    JSON.stringify({
      type: 'start_run',
      runId,
      sessionId: randomUUID(),
      prompt: PROMPT,
      agentIds: ['claude-code'],
      mode: 'independent',
    }),
  );

  await new Promise<void>((resolve) => {
    const onMessage = (raw: unknown) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type !== 'event') return;
      seen.push(msg.event.seq);
      if (msg.event.type === 'message_delta') {
        text += msg.event.text;
        process.stdout.write(msg.event.text);
      }
      if (msg.event.type === 'tool_started') console.log(`\n  → ${msg.event.toolName}`);
      if (msg.event.type === 'run_finished') {
        console.log(`\n  run_finished: ${msg.event.outcome}`);
        phone.off('message', onMessage);
        resolve();
      }
    };
    phone.on('message', onMessage);
  });

  console.log('──────────────────────────────────────────────────────────');
  console.log(`streamed : ${seen.length} events, seq ${Math.min(...seen)}..${Math.max(...seen)}, ${text.length} chars\n`);

  // 6 — reconnect and replay only what was missed.
  const cutoff = Math.floor(Math.max(...seen) / 2);
  await check(`reconnect replays events after seq ${cutoff}`, async () => {
    const reconnected = await connect(port, server.identity.publicKeyEncoded);
    reconnected.send(JSON.stringify({ type: 'resume', token: sessionToken || 'unknown', runId, lastSeq: cutoff }));
    const first = await waitFor(reconnected, ['resumed', 'pair_rejected'], 5000);
    reconnected.close();
    if (first?.type === 'pair_rejected') return `FAIL: resume refused the session token from pairing (${first.reason})`;
    if (first?.type !== 'resumed') return `UNEXPECTED: ${first?.type}`;
    const expected = seen.filter((s) => s > cutoff).length;
    return first.missedEvents === expected
      ? `replayed ${first.missedEvents} events, matches ${expected} missed`
      : `MISMATCH: replayed ${first.missedEvents}, expected ${expected}`;
  });

  phone.close();
  await server.stop();
  console.log('\nserver stopped cleanly.');
}

async function check(label: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    const bad = /LEAK|UNEXPECTED|MISMATCH/.test(detail);
    console.log(`${bad ? '✖' : '✔'} ${label}\n    ${detail}`);
  } catch (error) {
    console.log(`✖ ${label}\n    threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Open a connection that speaks the real encrypted protocol.
 *
 * The desktop refuses plaintext outright, so a raw socket here would simply
 * be closed on. `desktopPublicKey` is whatever the QR would have carried.
 */
function connect(port: number, desktopPublicKey: string): Promise<FakePhone> {
  return FakePhone.connect(port, desktopPublicKey);
}

/**
 * Wait for one of the message types under test.
 *
 * Deliberately not "the next message": the desktop pushes activity and branch
 * updates unprompted, and an earlier version of this suite reported pairing as
 * broken purely because the git watcher spoke first - which then cascaded into
 * a false pass on the replay check, since no session token was ever captured.
 *
 * An empty `types` means any message at all, for the checks that assert
 * silence.
 */
function waitFor(
  sock: FakePhone,
  types: readonly string[],
  timeoutMs: number,
): Promise<ServerMessage | null> {
  return new Promise((resolve) => {
    const finish = (result: ServerMessage | null) => {
      clearTimeout(timer);
      sock.off('message', onMessage);
      resolve(result);
    };
    const onMessage = (raw: unknown) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(raw)) as ServerMessage;
      } catch {
        return;
      }
      if (types.length === 0 || types.includes(message.type)) finish(message);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('message', onMessage);
  });
}

main().catch((error) => {
  console.error('transport test failed:', error);
  process.exit(1);
});
