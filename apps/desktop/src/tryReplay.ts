/**
 * Proves a reconnect is told the truth about what it missed.
 *
 *   npm --prefix apps/desktop run try:replay
 *
 * `RunRegistry` is what makes point twelve of the Phase 1 definition of done -
 * "reconnecting does not corrupt the session" - true, and it had no tests.
 *
 * The failure it exists to prevent is silent by construction. A replay that
 * cannot go back far enough still returns events, still renders, and still
 * reads as a whole reply; the only thing missing is the part nobody can see is
 * missing. So these check what the registry *says about itself*, not just what
 * it returns.
 */
import type { AgentEvent } from '@axune/protocol';

import { RunRegistry } from './core/RunRegistry';

let failures = 0;

function check(name: string, run: () => string): void {
  try {
    const detail = run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw: ${String(error)}`);
  }
}

const event = (seq: number, runId = 'r1'): AgentEvent =>
  ({
    runId,
    sessionId: 's1',
    agentId: 'claude-code',
    seq,
    ts: 1_000 + seq,
    type: 'message_delta',
    text: `chunk ${seq}`,
  }) as AgentEvent;

/** A run of `count` events under a registry holding at most `cap` of them. */
const runOf = (count: number, cap = 5_000) => {
  const registry = new RunRegistry(cap);
  for (let seq = 0; seq < count; seq += 1) registry.record(event(seq));
  return registry;
};

console.log('\na reconnect is told the truth about what it missed\n');

check('a short run replays whole, and says nothing was lost', () => {
  const slice = runOf(10).since('r1', -1);
  if (slice.events.length !== 10) return `FAIL: ${slice.events.length} events`;
  if (slice.gap) return 'FAIL: claimed a gap in a run that was never trimmed';
  return '10 events, no gap';
});

check('a trimmed run asked for everything admits the gap', () => {
  // The regression. A phone recovering a run after a restart has no sequence
  // numbers - they lived in memory - so it asks from -1. A `lastSeq >= 0` guard
  // meant that request could never report a gap, and the run came back looking
  // complete with its beginning silently gone.
  const slice = runOf(200, 50).since('r1', -1);
  if (!slice.gap) return 'FAIL: 150 events were dropped and the replay claimed to be whole';
  if (slice.events.length !== 50) return `FAIL: ${slice.events.length} events held`;
  return `kept the last 50 of 200, and said so`;
});

check('a partial reconnect that lost nothing reports no gap', () => {
  // The ordinary case: a phone drops off Wi-Fi briefly and comes back.
  const slice = runOf(100).since('r1', 60);
  if (slice.gap) return 'FAIL: claimed a gap';
  if (slice.events.length !== 39) return `FAIL: ${slice.events.length} events after seq 60`;
  return '39 events after seq 60, nothing lost';
});

check('a phone that fell too far behind is told so', () => {
  // Away long enough that the events it needed next were trimmed.
  const slice = runOf(300, 50).since('r1', 10);
  if (!slice.gap) return 'FAIL: the events after seq 10 are gone and it claimed otherwise';
  return 'gap reported, rather than resuming from the wrong place';
});

check('a replay never re-sends what the phone already has', () => {
  const slice = runOf(20).since('r1', 14);
  if (slice.events.some((e) => e.seq <= 14)) return 'FAIL: re-sent seen events';
  if (slice.events[0]?.seq !== 15) return `FAIL: started at ${slice.events[0]?.seq}`;
  return 'starts at seq 15, the first it had not seen';
});

check('a run the desktop never knew is empty, not a gap', () => {
  // A phone asking about a run from a previous desktop process. Empty is the
  // honest answer; a gap would imply the desktop had held it and lost part.
  const slice = new RunRegistry().since('unknown-run', -1);
  if (slice.events.length !== 0) return 'FAIL: invented events';
  if (slice.gap) return 'FAIL: claimed to have lost something it never had';
  return 'no events, no gap, no claim';
});

check('a finished run is still replayable', () => {
  // What makes recovering a run after a force-quit possible at all: the
  // registry caps events per run but never discards a run.
  const registry = runOf(5);
  registry.record({ ...event(5), type: 'run_finished', outcome: 'completed' } as AgentEvent);
  const slice = registry.since('r1', -1);
  if (!slice.finished) return 'FAIL: did not report the run as finished';
  if (slice.events.length !== 6) return `FAIL: ${slice.events.length} events`;
  return 'finished, and all 6 events still there to replay';
});

check('one run cannot grow memory without bound', () => {
  const registry = runOf(10_000, 100);
  const slice = registry.since('r1', -1);
  if (slice.events.length !== 100) return `FAIL: held ${slice.events.length}`;
  if (!slice.gap) return 'FAIL: trimmed 9900 events without saying so';
  return 'capped at 100, gap reported';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
