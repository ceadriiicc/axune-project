/**
 * Does the agent remember the previous prompt?
 *
 *   npm --prefix apps/desktop run try:continuity
 *
 * Sends two prompts in one Axune session, where the second only makes sense if
 * the first is remembered. Without provider session resumption the agent has no
 * idea what "that number" refers to, which is exactly the failure this checks.
 */
import { randomUUID } from 'node:crypto';

import type { ServerMessage } from '@axune/protocol';
import { WebSocket } from 'ws';

import { AxuneServer } from './core/AxuneServer';
import { PairingManager } from './core/PairingManager';
import { SessionStore } from './core/SessionStore';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  // A throwaway store, so a test never pollutes the real desktop's trusted
  // devices or session history.
  const store = new SessionStore(join(tmpdir(), `axune-continuity-${Date.now()}.json`));
  const pairing = new PairingManager();
  const server = new AxuneServer(
    pairing,
    { name: 'axune', path: process.cwd(), branch: 'main', isGitRepo: true },
    store,
  );

  const port = await server.start(0);
  const payload = pairing.issue(port, 'axune');
  const phone = await connect(port);

  phone.send(
    JSON.stringify({ type: 'pair', token: payload.token, deviceName: 'test', protocolVersion: 1 }),
  );
  await waitFor(phone, (m) => m.type === 'paired');

  // One conversation id for both prompts — this is the thing under test.
  const conversationId = randomUUID();

  console.log('\n1) "Remember the number 7fx91. Just acknowledge."');
  const first = await runPrompt(phone, conversationId, 'Remember the number 7fx91. Just acknowledge it in one short sentence.');
  console.log(`   → ${first.trim().slice(0, 160)}`);

  console.log('\n2) "What number did I ask you to remember?"');
  const second = await runPrompt(phone, conversationId, 'What number did I ask you to remember? Answer in one short sentence.');
  console.log(`   → ${second.trim().slice(0, 160)}`);

  const remembered = /7fx91/i.test(second);
  console.log('\n' + '─'.repeat(64));
  console.log(remembered ? '✔ continuity works — the agent recalled the number' : '✖ NO CONTINUITY — the second prompt started a fresh conversation');
  console.log(`  provider session stored: ${store.providerSession(conversationId, 'claude-code') ? 'yes' : 'no'}`);

  phone.close();
  await server.stop();
}

function runPrompt(phone: WebSocket, sessionId: string, prompt: string): Promise<string> {
  const runId = randomUUID();
  let text = '';
  return new Promise((resolve) => {
    const onMessage = (raw: unknown) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type !== 'event' || msg.event.runId !== runId) return;
      if (msg.event.type === 'message_delta') text += msg.event.text;
      if (msg.event.type === 'run_finished') {
        phone.off('message', onMessage);
        resolve(text);
      }
    };
    phone.on('message', onMessage);
    phone.send(
      JSON.stringify({
        type: 'start_run',
        runId,
        sessionId,
        prompt,
        agentIds: ['claude-code'],
        mode: 'independent',
      }),
    );
  });
}

function connect(port: number): Promise<WebSocket> {
  const sock = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });
}

function waitFor(sock: WebSocket, predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const onMessage = (raw: unknown) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (!predicate(msg)) return;
      sock.off('message', onMessage);
      resolve(msg);
    };
    sock.on('message', onMessage);
  });
}

main().catch((error) => {
  console.error('continuity test failed:', error);
  process.exit(1);
});
