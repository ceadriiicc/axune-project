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
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AgentEvent } from '@axune/protocol';
import qrcode from 'qrcode-terminal';

import { AxuneServer } from './core/AxuneServer';
import { PairingManager, lanAddress } from './core/PairingManager';
import { AXUNE_PORT } from './core/port';

const execFileAsync = promisify(execFile);

async function main() {
  const repo = process.argv[2] ?? (await repoRoot(process.cwd()));
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

  console.log(`
  Axune Desktop`);
  console.log(`  project : ${basename(repo)}  (${branch})`);
  console.log(`  path    : ${repo}`);

  const agents = await server.agentStatuses();
  for (const agent of agents) {
    console.log(
      `  agent   : ${agent.agentId} ${agent.installed ? "●" : "○"} ${agent.version ?? 'not found'}`,
    );
  }

  console.log(`  listening on ws://${lanAddress()}:${port}
`);

  /**
   * Show a pairing code only when one is actually needed.
   *
   * A QR on screen is a credential sitting in the room, and printing one on
   * every launch teaches the user to scan out of habit - which is how twelve
   * live device tokens accumulated in a single evening. If a phone is already
   * trusted, the honest thing to display is that it is expected back.
   */
  const showCode = () => {
    const payload = pairing.issue(port, basename(repo));
    console.log('  Scan this in Axune on your iPhone:');
    console.log('');
    qrcode.generate(JSON.stringify(payload), { small: true }, (qr: string) => {
      console.log(qr.replace(/^/gm, '  '));
      const minutes = Math.round((payload.expiresAt - Date.now()) / 60_000);
      console.log(`  code expires in ${minutes} minutes, single use`);
      console.log('');
      console.log('  Waiting for a phone...  (Ctrl+C to stop)');
      console.log('');
    });
  };

  if (server.pairing.pairedCount === 0) {
    showCode();
  } else {
    const n = server.pairing.pairedCount;
    console.log(`  ${n} trusted ${n === 1 ? 'device' : 'devices'}, waiting for one to reconnect.`);
    console.log('  No pairing code shown, because none is needed.');
    console.log("  Press 'p' for a new code, or Ctrl+C to stop.");
    console.log('');

    // Only when a terminal is attached; piped output has no keypresses.
    if (process.stdin.isTTY) {
      const ETX = String.fromCharCode(3);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (chunk) => {
        const key = String(chunk);
        if (key === 'p' || key === 'P') {
          console.log('');
          showCode();
        }
        // Raw mode swallows the usual interrupt, so handle it here.
        if (key === ETX) process.emit('SIGINT');
      });
    }
  }

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

/**
 * The repository this desktop should point an agent at.
 *
 * Not `process.cwd()`: `npm --prefix apps/desktop run serve` sets the working
 * directory to the package, which silently confined a run to `apps/desktop`.
 * The agent then spent forty seconds being refused every attempt to read the
 * real project before it could answer at all - which looked like latency and
 * was a boundary drawn in the wrong place.
 *
 * Falls back to the working directory, since a non-repository is a legitimate
 * thing to point at and the caller is told either way.
 */
async function repoRoot(from: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', from, 'rev-parse', '--show-toplevel'], {
      timeout: 10_000,
      windowsHide: true,
    });
    const root = stdout.trim();
    return root ? resolve(root) : from;
  } catch {
    return from;
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
