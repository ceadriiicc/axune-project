/**
 * A real agent writing code, safely.
 *
 *   npm --prefix apps/desktop run try:write
 *
 * The point under test is not that Claude Code can edit a file — it obviously
 * can. It is that an editing run lands on its own branch and leaves the user's
 * working tree exactly as it was, because that is the property that makes
 * letting an agent write from a phone reasonable.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import type { ServerMessage } from '@axune/protocol';
import { WebSocket } from 'ws';

import { AxuneServer } from './core/AxuneServer';
import { PairingManager } from './core/PairingManager';

const execFileAsync = promisify(execFile);
const REPO = process.argv[2] ?? 'C:/dev/axune';

async function main() {
  const before = await status(REPO);
  const beforeBranch = await branch(REPO);
  console.log(`repo   : ${REPO}`);
  console.log(`branch : ${beforeBranch}, ${before.length} dirty file(s)\n`);

  const pairing = new PairingManager();
  const server = new AxuneServer(pairing, {
    name: 'axune',
    path: REPO,
    branch: beforeBranch,
    isGitRepo: true,
  });

  const port = await server.start(0);
  const payload = pairing.issue(port, 'axune');
  const phone = await connect(port);

  phone.send(
    JSON.stringify({ type: 'pair', token: payload.token, deviceName: 'test', protocolVersion: 1 }),
  );
  await waitFor(phone, (m) => m.type === 'paired');

  const runId = randomUUID();
  console.log('asking the agent to write a file…\n');

  const changes = await new Promise<Extract<ServerMessage, { type: 'changes' }> | null>(
    (resolve) => {
      const timeout = setTimeout(() => resolve(null), 240_000);
      const onMessage = (raw: unknown) => {
        const msg = JSON.parse(String(raw)) as ServerMessage;
        if (msg.type === 'event' && msg.event.type === 'tool_started') {
          console.log(`  → ${msg.event.toolName}`);
        }
        if (msg.type === 'changes' && msg.runId === runId) {
          clearTimeout(timeout);
          phone.off('message', onMessage);
          resolve(msg);
        }
      };
      phone.on('message', onMessage);

      phone.send(
        JSON.stringify({
          type: 'start_run',
          runId,
          sessionId: randomUUID(),
          prompt:
            'Create a file called AXUNE_WRITE_TEST.md containing one sentence saying this was written by an agent. Change nothing else.',
          agentIds: ['claude-code'],
          mode: 'independent',
          write: true,
        }),
      );
    },
  );

  console.log('\n' + '─'.repeat(62));

  if (!changes) {
    console.log('✖ no change set returned');
  } else {
    const { result } = changes;
    console.log(`branch : ${result.branch}`);
    console.log(`commit : ${result.commit ?? '(nothing written)'}`);
    console.log(`files  : ${result.files.length}`);
    for (const file of result.files) {
      console.log(`   ${file.status.padEnd(9)} ${file.path}  +${file.insertions} −${file.deletions}`);
    }
    console.log(`patch  : ${result.patch.length} bytes`);
  }

  const after = await status(REPO);
  const afterBranch = await branch(REPO);
  const isolated = after.length === before.length && afterBranch === beforeBranch;
  console.log(
    isolated
      ? `\n✔ working tree untouched — still ${after.length} dirty on ${afterBranch}`
      : `\n✖ LEAK: ${before.length} → ${after.length} dirty, ${beforeBranch} → ${afterBranch}`,
  );

  // Clean up: discard the branch the test produced.
  if (changes?.result.commit) {
    phone.send(JSON.stringify({ type: 'resolve_changes', runId, decision: 'discard' }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log('discarded the test branch.');
  }

  phone.close();
  await server.stop();
}

async function status(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, 'status', '--porcelain'], {
    windowsHide: true,
  });
  return stdout.split('\n').filter((line) => line.trim());
}

async function branch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    windowsHide: true,
  });
  return stdout.trim();
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
  console.error('write test failed:', error);
  process.exit(1);
});
