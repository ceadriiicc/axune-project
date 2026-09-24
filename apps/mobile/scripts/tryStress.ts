/**
 * Proves the phone survives a run that is much larger than a demo.
 *
 *   npm --prefix apps/mobile run try:stress
 *
 * Everything else here is tested with a handful of events, which is the shape
 * of a test and not the shape of a real agent run. A read-heavy investigation
 * produces hundreds of tool calls and tens of thousands of text deltas, and the
 * failures that live at that size are not logic errors - they are the ones
 * where the code is correct and the phone stops responding.
 *
 * The specific suspicions this was written to settle:
 *
 *  - `tool_finished` resolves its row with `findIndex` over `run.activity`,
 *    which is a linear scan per completion over an array that grows with every
 *    call. That is quadratic, and `MAX_ACTIVITY` caps the list only when it is
 *    written to disk, so nothing bounds it while the run is live.
 *  - `message_delta` builds the reply with `run.text + event.text`, allocating
 *    a new string per delta.
 *  - A reconnect replays a whole run at once, so the cost of all of the above
 *    lands in a single burst rather than spread over the minutes it originally
 *    took.
 *
 * Measured rather than asserted: the numbers are printed so a regression shows
 * up as a change rather than a pass.
 */
import { reduceRun, type ActivityLine, type LiveRun } from '../lib/runReducer';
import { shrink } from '../lib/threadShrink';

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

const base = (): LiveRun => ({
  runId: 'r1',
  prompt: 'investigate this repository thoroughly',
  text: '',
  activity: [] as ActivityLine[],
  agentId: 'claude-code',
  error: null,
  status: 'working',
  outcome: null,
  startedAt: 1_700_000_000_000,
  lastEventAt: 1_700_000_000_000,
  write: false,
  changes: null,
  decision: null,
});

const event = (body: Record<string, unknown>, seq: number) =>
  ({
    seq,
    runId: 'r1',
    sessionId: 's1',
    agentId: 'claude-code',
    ts: 1_700_000_000_000 + seq,
    ...body,
  }) as never;

/** One tool call and its completion, as the desktop actually sends them. */
function toolPair(run: LiveRun, i: number): LiveRun {
  const started = reduceRun(
    run,
    event({ type: 'tool_started', toolCallId: `t${i}`, toolName: 'Read', input: `{"file":"src/f${i}.ts"}` }, i * 2),
  );
  return reduceRun(started, event({ type: 'tool_finished', toolCallId: `t${i}`, ok: true, output: 'x'.repeat(200) }, i * 2 + 1));
}

console.log('\na run much larger than a demo\n');

check('a thousand tool calls do not take quadratic time', () => {
  const time = (calls: number): number => {
    let run = base();
    const started = Date.now();
    for (let i = 0; i < calls; i += 1) run = toolPair(run, i);
    return Date.now() - started;
  };

  // Compared against itself at two sizes rather than against a fixed budget,
  // which would only measure how fast this machine is today.
  const small = Math.max(time(250), 1);
  const large = Math.max(time(1000), 1);
  const ratio = large / small;

  // Four times the work. Linear lands near 4, quadratic near 16.
  if (ratio > 9) {
    return `FAIL: 4x the calls cost ${ratio.toFixed(1)}x the time (${small}ms then ${large}ms) - quadratic`;
  }
  return `4x the calls cost ${ratio.toFixed(1)}x the time (${small}ms then ${large}ms)`;
});

check('the live activity list is bounded during a run', () => {
  // MAX_ACTIVITY is applied by threadShrink, which runs when persisting. While
  // a run is in flight nothing trims this, so a long investigation grows it
  // without limit - and every tool_finished scans all of it.
  let run = base();
  for (let i = 0; i < 2000; i += 1) run = toolPair(run, i);
  if (run.activity.length > 500) {
    return `FAIL: ${run.activity.length} rows held in memory during one run, uncapped`;
  }
  return `${run.activity.length} rows after 2000 tool calls`;
});

check('a very long reply assembles in reasonable time', () => {
  let run = base();
  const started = Date.now();
  // 20k deltas of ~40 chars is a long but unexceptional investigation.
  for (let i = 0; i < 20_000; i += 1) {
    run = reduceRun(run, event({ type: 'message_delta', text: 'the quick brown fox jumps over it. ' }, i));
  }
  const ms = Date.now() - started;
  if (run.text.length < 600_000) return `FAIL: lost text - ${run.text.length} chars`;
  if (ms > 4000) return `FAIL: ${ms}ms to assemble ${(run.text.length / 1000).toFixed(0)}k chars`;
  return `${(run.text.length / 1000).toFixed(0)}k chars in ${ms}ms`;
});

check('a pathological run still shrinks to something storable', () => {
  let run = base();
  for (let i = 0; i < 2000; i += 1) run = toolPair(run, i);
  for (let i = 0; i < 5000; i += 1) {
    run = reduceRun(run, event({ type: 'message_delta', text: 'y'.repeat(60) }, 100_000 + i));
  }
  const stored = shrink({
    conversation: [run],
    conversationId: 'c1',
    threads: [],
    history: [],
    projectName: 'axune',
  });
  const bytes = JSON.stringify(stored).length;
  if (bytes > 2_000_000) return `FAIL: ${(bytes / 1e6).toFixed(1)} MB written on the JS thread`;
  return `${(bytes / 1000).toFixed(0)} KB stored from a run with 2000 calls and 300k chars`;
});

check('duplicate and out-of-order events do not corrupt the run', () => {
  // A reconnect replays from a seq the phone claims to have; an off-by-one
  // there delivers events it already applied.
  let run = base();
  for (let i = 0; i < 50; i += 1) run = toolPair(run, i);
  const before = run.activity.length;

  // Replay the last ten pairs.
  for (let i = 40; i < 50; i += 1) run = toolPair(run, i);
  const after = run.activity.length;

  const unresolved = run.activity.filter((line) => line.ok === null).length;
  if (unresolved > 10) return `FAIL: ${unresolved} tool rows left unresolved by the replay`;
  return `${before} rows became ${after} after replaying 10 pairs, ${unresolved} unresolved`;
});

check('an event for an unknown run does not throw', () => {
  // The desktop can emit a finish for a call the phone never saw start, which
  // is what a mid-run reconnect looks like from here.
  let run = base();
  run = reduceRun(run, event({ type: 'tool_finished', toolCallId: 'never-started', ok: false, output: 'Denied: read-only' }, 1));
  const row = run.activity[run.activity.length - 1];
  if (!row) return 'FAIL: the orphan finish was dropped';
  if (row.detail !== 'read-only') return `FAIL: reason lost, got ${String(row.detail)}`;
  return `orphan finish shown as "${row.label}" with its reason kept`;
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
