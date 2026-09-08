/**
 * Does a desktop restart cost the phone a re-scan?
 *
 *   npm --prefix apps/desktop run try:restart
 *
 * Trusted devices are meant to survive a restart — the QR is first contact,
 * not a daily ritual. Seven re-pairs were recorded in one evening's session,
 * so the claim needs proving rather than reading. Uses a throwaway state file
 * so the real trusted-device list is never touched.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerMessage } from '@axune/protocol';
import { PROTOCOL_VERSION } from '@axune/protocol';
import { WebSocket } from 'ws';

import { AxuneServer } from './core/AxuneServer';
import { PairingManager } from './core/PairingManager';
import { SessionStore } from './core/SessionStore';

const scratch = mkdtempSync(join(tmpdir(), 'axune-restart-'));
const statePath = join(scratch, 'desktop-state.json');

const project = {
  name: 'axune',
  path: process.argv[2] ?? 'C:/dev/axune',
  branch: 'main',
  isGitRepo: true,
};

let failures = 0;

async function main() {
  console.log(`state file : ${statePath}\n`);

  // ---- first launch: pair once, the way a QR scan does ------------------
  const first = new AxuneServer(new PairingManager(), { ...project }, new SessionStore(statePath));
  const portA = await first.start(0);
  const payload = first.pairing.issue(portA, 'axune');

  let sessionToken = '';
  await check('a QR token pairs on first launch', async () => {
    const sock = await connect(portA);
    sock.send(
      JSON.stringify({
        type: 'pair',
        token: payload.token,
        deviceName: 'iPhone',
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    const reply = await waitFor(sock, ['paired', 'pair_rejected'], 5000);
    sock.close();
    if (reply?.type !== 'paired') return `FAIL: got ${reply?.type ?? 'nothing'}`;
    sessionToken = reply.sessionToken;
    return `paired, session ${sessionToken.slice(0, 10)}…`;
  });

  await first.stop();
  console.log('\n  — desktop stopped, as if Ctrl+C —\n');

  // ---- second launch: a brand new PairingManager, same state file -------
  const second = new AxuneServer(new PairingManager(), { ...project }, new SessionStore(statePath));
  const portB = await second.start(0);
  // A fresh code is minted on every launch and deliberately not redeemed —
  // the phone should never need it.
  second.pairing.issue(portB, 'axune');

  await check('the same phone resumes without rescanning', async () => {
    const sock = await connect(portB);
    sock.send(JSON.stringify({ type: 'resume', token: sessionToken, runId: 'none', lastSeq: -1 }));
    const reply = await waitFor(sock, ['resumed', 'pair_rejected'], 5000);
    sock.close();
    if (reply?.type === 'resumed') return 'resumed on the stored session token';
    if (reply?.type === 'pair_rejected') return `FAIL: rejected — ${reply.detail}`;
    return `FAIL: got ${reply?.type ?? 'nothing'}`;
  });

  await check('an unknown session token is still refused', async () => {
    const sock = await connect(portB);
    sock.send(
      JSON.stringify({ type: 'resume', token: 'not-a-real-token', runId: 'none', lastSeq: -1 }),
    );
    const reply = await waitFor(sock, ['resumed', 'pair_rejected'], 5000);
    sock.close();
    return reply?.type === 'pair_rejected'
      ? `refused: ${reply.reason}`
      : `FAIL: got ${reply?.type ?? 'nothing'}`;
  });

  // ---- the desktop must route a run to the agent that was asked for ----
  // `agentIds` was accepted and ignored until 2026-09-09: every run went to
  // Claude Code whatever the phone requested, so a second agent could not have
  // been reached even once its adapter existed. Both refusals below have to
  // arrive as a finished run, because the phone renders the prompt the moment
  // it is sent and a dropped request spins for ever.
  await check('a run for an agent with no adapter is refused, not dropped', async () => {
    const sock = await connect(portB);
    sock.send(JSON.stringify({ type: 'resume', token: sessionToken, runId: 'none', lastSeq: -1 }));
    if (!(await waitFor(sock, ['resumed'], 5000))) {
      sock.close();
      return 'FAIL: could not resume to send the run';
    }
    sock.send(
      JSON.stringify({
        type: 'start_run',
        runId: 'unknown-agent-run',
        sessionId: 'routing-test',
        prompt: 'anything',
        agentIds: ['codex'],
        mode: 'independent',
        write: false,
      }),
    );
    const outcome = await runOutcome(sock, 'unknown-agent-run', 8000);
    sock.close();
    if (!outcome) return 'FAIL: the run never finished - the phone would spin';
    if (outcome.finished !== 'failed') return `FAIL: outcome was ${outcome.finished}`;
    if (!/no adapter for codex/i.test(outcome.error ?? '')) {
      return `FAIL: unhelpful reason - ${outcome.error ?? 'none given'}`;
    }
    return `refused: ${outcome.error}`;
  });

  await check('a paired-mode request is refused rather than half-answered', async () => {
    const sock = await connect(portB);
    sock.send(JSON.stringify({ type: 'resume', token: sessionToken, runId: 'none', lastSeq: -1 }));
    if (!(await waitFor(sock, ['resumed'], 5000))) {
      sock.close();
      return 'FAIL: could not resume to send the run';
    }
    sock.send(
      JSON.stringify({
        type: 'start_run',
        runId: 'paired-run',
        sessionId: 'routing-test',
        prompt: 'anything',
        agentIds: ['claude-code', 'codex'],
        mode: 'paired',
        write: false,
      }),
    );
    const outcome = await runOutcome(sock, 'paired-run', 8000);
    sock.close();
    if (outcome?.finished !== 'failed') return `FAIL: outcome was ${outcome?.finished ?? 'never'}`;
    if (!/one agent at a time/i.test(outcome.error ?? '')) {
      return `FAIL: unhelpful reason - ${outcome.error ?? 'none given'}`;
    }
    return `refused: ${outcome.error}`;
  });

  await second.stop();

  // ---- the trusted list must not grow without limit --------------------
  // Every re-pair mints another bearer token for this machine. Twelve had
  // piled up after one evening of testing, all still valid, so expiry and a
  // cap were added - and are checked here by attempting to use them.
  await check('a device unseen for months is no longer trusted', async () => {
    const stale = join(scratch, 'stale-state.json');
    writeFileSync(
      stale,
      JSON.stringify({
        devices: {
          'ancient-token': {
            deviceName: 'old phone',
            pairedAt: 0,
            lastSeenAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
          },
          'recent-token': { deviceName: 'iPhone', pairedAt: 0, lastSeenAt: Date.now() },
        },
        providerSessions: {},
      }),
    );

    const third = new AxuneServer(new PairingManager(), { ...project }, new SessionStore(stale));
    const portC = await third.start(0);

    const tryToken = async (token: string) => {
      const sock = await connect(portC);
      sock.send(JSON.stringify({ type: 'resume', token, runId: 'none', lastSeq: -1 }));
      const reply = await waitFor(sock, ['resumed', 'pair_rejected'], 5000);
      sock.close();
      return reply?.type ?? 'nothing';
    };

    const ancient = await tryToken('ancient-token');
    const recent = await tryToken('recent-token');
    await third.stop();

    if (ancient !== 'pair_rejected') return `FAIL: a 90-day-old token still ${ancient}`;
    if (recent !== 'resumed') return `FAIL: the phone in daily use was ${recent}`;
    return 'the 90-day-old token is refused, the current one still resumes';
  });

  await check('the trusted list is capped', async () => {
    const crowded = join(scratch, 'crowded-state.json');
    const devices: Record<string, unknown> = {};
    for (let i = 0; i < 25; i += 1) {
      devices[`token-${i}`] = { deviceName: `phone ${i}`, pairedAt: i, lastSeenAt: Date.now() - i };
    }
    writeFileSync(crowded, JSON.stringify({ devices, providerSessions: {} }));

    const store = new SessionStore(crowded);
    const kept = store.trustedTokens();
    if (kept.length >= 25) return `FAIL: all ${kept.length} tokens kept`;
    // Sorted newest-first, so token-0 is the most recent and must survive.
    if (!kept.includes('token-0')) return 'FAIL: dropped the most recently used device';
    if (kept.includes('token-24')) return 'FAIL: kept the least recently used device';
    return `25 tokens reduced to ${kept.length}, most recent retained`;
  });

  rmSync(scratch, { recursive: true, force: true });

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? '✗' : '✓'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}\n      threw: ${String(error)}`);
  }
}

/**
 * Follow one run's events to its terminal state.
 *
 * Returns null if the run never finished, which is the failure worth catching:
 * a request the desktop silently drops leaves the phone spinning.
 */
function runOutcome(
  sock: WebSocket,
  runId: string,
  timeoutMs: number,
): Promise<{ finished: string; error?: string } | null> {
  return new Promise((resolve) => {
    let error: string | undefined;
    const finish = (result: { finished: string; error?: string } | null) => {
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
      if (message.type !== 'event' || message.event.runId !== runId) return;
      if (message.event.type === 'error') error = message.event.message;
      if (message.event.type === 'run_finished') finish({ finished: message.event.outcome, error });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('message', onMessage);
  });
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${port}`);
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });
}

/**
 * Wait for one of the message types being tested for.
 *
 * Not "the next message": the desktop pushes activity and branch updates
 * unprompted, and an earlier version of this harness reported a failure
 * purely because the git watcher spoke first.
 */
function waitFor(
  sock: WebSocket,
  types: readonly string[],
  timeoutMs: number,
): Promise<ServerMessage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onMessage = (raw: unknown) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(raw)) as ServerMessage;
      } catch {
        return;
      }
      if (types.includes(message.type)) finish(message);
    };
    const finish = (result: ServerMessage | null) => {
      clearTimeout(timer);
      sock.off('message', onMessage);
      resolve(result);
    };
    sock.on('message', onMessage);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
