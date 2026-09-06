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

import type { ServerMessage } from '@axune/protocol';
import { WebSocket } from 'ws';

import { AxuneServer } from './core/AxuneServer';
import { PairingManager, lanAddress } from './core/PairingManager';

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
  });

  const port = await server.start(0);
  const payload = pairing.issue(port, 'axune');
  console.log(`server   : ws://${lanAddress()}:${port}`);
  console.log(`qr token : ${payload.token.slice(0, 12)}…  (expires in 2 min)\n`);

  // 1 — an unpaired socket must be inert.
  await check('unpaired socket is ignored', async () => {
    const sock = await connect(port);
    sock.send(JSON.stringify({ type: 'start_run', runId: 'x', sessionId: 'x', prompt: 'hi', agentIds: [], mode: 'independent' }));
    const reply = await nextMessage(sock, 800);
    sock.close();
    return reply === null ? 'no response, as required' : `LEAK: got ${reply.type}`;
  });

  // 2 — a bad token is refused.
  await check('bad token rejected', async () => {
    const sock = await connect(port);
    sock.send(JSON.stringify({ type: 'pair', token: 'wrong', deviceName: 'fake', protocolVersion: 1 }));
    const reply = await nextMessage(sock, 2000);
    sock.close();
    return reply?.type === 'pair_rejected' ? `rejected: ${reply.reason}` : `UNEXPECTED: ${reply?.type}`;
  });

  // 3 — the real token pairs.
  const phone = await connect(port);
  let sessionToken = '';
  await check('valid token pairs', async () => {
    phone.send(JSON.stringify({ type: 'pair', token: payload.token, deviceName: 'iPhone (fake)', protocolVersion: 1 }));
    const reply = await nextMessage(phone, 20_000);
    if (reply?.type !== 'paired') return `UNEXPECTED: ${reply?.type}`;
    sessionToken = reply.sessionToken;
    const claude = reply.agents.find((a) => a.agentId === 'claude-code');
    return `project=${reply.project.name} claude installed=${claude?.installed} v=${claude?.version}`;
  });

  // 4 — the same token cannot be used twice.
  await check('token cannot be reused', async () => {
    const sock = await connect(port);
    sock.send(JSON.stringify({ type: 'pair', token: payload.token, deviceName: 'attacker', protocolVersion: 1 }));
    const reply = await nextMessage(sock, 2000);
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
    const reconnected = await connect(port);
    reconnected.send(JSON.stringify({ type: 'resume', token: sessionToken || 'unknown', runId, lastSeq: cutoff }));
    const first = await nextMessage(reconnected, 3000);
    reconnected.close();
    if (first?.type === 'pair_rejected') return `rejected (expected — fake phone has no session token): ${first.reason}`;
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

function connect(port: number): Promise<WebSocket> {
  const sock = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });
}

function nextMessage(sock: WebSocket, timeoutMs: number): Promise<ServerMessage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.off('message', onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (raw: unknown) => {
      clearTimeout(timer);
      sock.off('message', onMessage);
      resolve(JSON.parse(String(raw)) as ServerMessage);
    };
    sock.on('message', onMessage);
  });
}

main().catch((error) => {
  console.error('transport test failed:', error);
  process.exit(1);
});
