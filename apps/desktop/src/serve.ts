/**
 * Axune Desktop, before it has a window.
 *
 *   npm --prefix apps/desktop run serve -- [repoPath]
 *
 * Prints the pairing QR straight into the terminal so the phone can be proven
 * against a real agent before any Electron UI exists. Same server, same
 * pairing, same adapter the windowed app will use — only the chrome is
 * missing. Building the UI first would mean debugging network problems and
 * layout problems at the same time, and they look alike from the outside.
 */
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import type { AgentEvent } from '@axune/protocol';
import qrcode from 'qrcode-terminal';

import { AxuneServer } from './core/AxuneServer';
import { PairingManager, lanAddress } from './core/PairingManager';
import { AXUNE_PORT } from './core/port';

const execFileAsync = promisify(execFile);

async function main() {
  const repo = process.argv[2] ?? process.cwd();
  const branch = await currentBranch(repo);

  const pairing = new PairingManager(10 * 60 * 1000); // Longer TTL while pairing by hand.
  const server = new AxuneServer(pairing, {
    name: basename(repo),
    path: repo,
    branch,
    isGitRepo: branch !== '(not a git repo)',
  });

  server.onEvent((event) => renderEvent(event));
  server.onConnectionChange((state) => console.log(`\n[axune] ${state}\n`));

  const port = await server.start(AXUNE_PORT);
  const payload = pairing.issue(port, basename(repo));

  console.log(`\n  Axune Desktop`);
  console.log(`  project : ${basename(repo)}  (${branch})`);
  console.log(`  path    : ${repo}`);

  const agents = await server.agentStatuses();
  for (const agent of agents) {
    console.log(
      `  agent   : ${agent.agentId} ${agent.installed ? '●' : '○'} ${agent.version ?? 'not found'}`,
    );
  }

  console.log(`  listening on ws://${lanAddress()}:${port}\n`);
  console.log('  Scan this in Axune on your iPhone:\n');

  // The QR carries the whole payload, so the phone needs nothing typed in.
  qrcode.generate(JSON.stringify(payload), { small: true }, (qr: string) => {
    console.log(qr.replace(/^/gm, '  '));
    const minutes = Math.round((payload.expiresAt - Date.now()) / 60_000);
    console.log(`  code expires in ${minutes} minutes · single use`);
    console.log('\n  Waiting for a phone…  (Ctrl+C to stop)\n');
  });

  process.on('SIGINT', () => {
    console.log('\n[axune] shutting down…');
    void server.stop().then(() => process.exit(0));
  });
}

/**
 * Elapsed milliseconds since each run began, so the terminal can answer "why
 * did that take so long" without guesswork.
 *
 * Added after a prompt from the phone took 37 seconds to show its first word,
 * while the same prompt measured 8 seconds driving the adapter directly. A
 * number beside every event is the cheapest way to find the missing time.
 */
const runStarts = new Map<string, number>();
const firstTextSeen = new Set<string>();

function since(runId: string): string {
  const started = runStarts.get(runId);
  return started === undefined ? "      " : String(Date.now() - started).padStart(6);
}

function renderEvent(event: AgentEvent) {
  switch (event.type) {
    case 'run_started':
      runStarts.set(event.runId, Date.now());
      firstTextSeen.delete(event.runId);
      return void console.log(`\n[run] ${event.prompt}\n`);
    case 'working':
      return void console.log(`  ${since(event.runId)} ms  working`);
    case 'message_delta':
      if (!firstTextSeen.has(event.runId)) {
        firstTextSeen.add(event.runId);
        console.log(`\n  ${since(event.runId)} ms  FIRST TEXT\n`);
      }
      return void process.stdout.write(event.text);
    case 'tool_started':
      return void console.log(`\n  ${since(event.runId)} ms  -> ${event.toolName}`);
    case 'tool_finished':
      return void console.log(`  ${since(event.runId)} ms  <- ${event.ok ? 'ok' : 'denied'}`);
    case 'run_finished':
      return void console.log(`\n  ${since(event.runId)} ms  [run] ${event.outcome}\n`);
    case 'error':
      return void console.log(`\n  ${since(event.runId)} ms  [error] ${event.message}\n`);
    default:
      return;
  }
}

async function currentBranch(repo: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim() || 'main';
  } catch {
    return '(not a git repo)';
  }
}

main().catch((error) => {
  console.error('axune desktop failed:', error);
  process.exit(1);
});
