/**
 * Proves what the phone stores, without a phone.
 *
 *   npm --prefix apps/mobile run try:threads
 *
 * Persistence is the sort of thing that looks fine and is not: an oversized
 * write, a half-written file, or a run restored as still-working all pass a
 * typecheck and fail in the user's hands. Exercises the decisions in
 * `threadShrink`, which is why that logic is separate from the file access.
 */
import { reduceRun } from '../lib/runReducer';
import { revive, shrink } from '../lib/threadShrink';
import type { AgentEvent } from '@axune/protocol';
import type { LiveRun, Thread } from '../lib/WorkspaceContext';

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

const run = (over: Partial<LiveRun> = {}): LiveRun => ({
  runId: `run-${Math.random().toString(36).slice(2, 8)}`,
  prompt: 'what does this project do?',
  text: 'It is a phone-first remote control for coding agents.',
  activity: [],
  agentId: 'claude-code',
  error: null,
  status: 'finished',
  outcome: 'completed',
  startedAt: 1_700_000_000_000,
  lastEventAt: 1_700_000_001_000,
  write: false,
  changes: null,
  usage: null,
  decision: null,
  incomplete: false,
  ...over,
});

const thread = (id: string, runs: LiveRun[]): Thread => ({
  id,
  runs,
  startedAt: 1_700_000_000_000,
});

const workspace = (over: Partial<Parameters<typeof shrink>[0]> = {}) => ({
  conversation: [run()],
  conversationId: 'conv-1',
  threads: [thread('t1', [run()])],
  history: [],
  projectName: 'axune',
  ...over,
});

console.log('\nthread persistence\n');

check('a round trip keeps the conversation and its session id', () => {
  const stored = shrink(workspace());
  const back = revive(JSON.parse(JSON.stringify(stored)));
  if (!back) return 'FAIL: revive returned null';
  if (back.conversationId !== 'conv-1') return `FAIL: session id became ${back.conversationId}`;
  if (back.conversation.length !== 1) return `FAIL: ${back.conversation.length} runs survived`;
  return `${back.threads.length} thread, session id preserved`;
});

check('a run still working is restored as stopped, never as working', () => {
  const stored = shrink(workspace({ conversation: [run({ status: 'working', outcome: null })] }));
  const restored = stored.conversation[0]!;
  if (restored.status === 'working') return 'FAIL: comes back claiming to be working';
  return `restored as "${restored.status}" — ${restored.outcome}`;
});

check('an interrupted run is remembered so its result can be recovered', () => {
  // The whole point. `trimRun` rewrites a working run to stopped, and that
  // rewrite used to be the only trace that it had ever been running - so a run
  // the desktop went on to finish was unrecoverable, with the result sitting
  // one question away.
  const stored = shrink(
    workspace({ conversation: [run({ runId: 'run-live', status: 'working', outcome: null })] }),
  );
  if (stored.interruptedRunId !== 'run-live') {
    return `FAIL: remembered ${stored.interruptedRunId}`;
  }
  // Both must be true at once: honest about the status, and still able to ask.
  if (stored.conversation[0]!.status === 'working') {
    return 'FAIL: restored as working, which it certainly is not';
  }
  return 'stored as stopped, and the run id kept so the desktop can be asked';
});

check('nothing in flight means nothing to ask about', () => {
  // A stale id would make every launch replay a finished run from its start.
  const stored = shrink(workspace({ conversation: [run({ status: 'finished' })] }));
  if (stored.interruptedRunId !== null) return `FAIL: invented ${stored.interruptedRunId}`;
  return 'null, so the resume asks for nothing';
});

check('the interrupted run survives the round trip', () => {
  const stored = shrink(
    workspace({ conversation: [run({ runId: 'run-live', status: 'working', outcome: null })] }),
  );
  const back = revive(JSON.parse(JSON.stringify(stored)));
  if (back?.interruptedRunId !== 'run-live') return `FAIL: became ${back?.interruptedRunId}`;
  return 'run-live, through serialisation and back';
});

check('a file written before this existed still loads', () => {
  // Every phone upgrading to this build has one. Absent is not corrupt - it
  // means that launch had nothing in flight.
  const stored = shrink(workspace()) as unknown as Record<string, unknown>;
  delete stored['interruptedRunId'];
  const back = revive(JSON.parse(JSON.stringify(stored)));
  if (!back) return 'FAIL: an older file was rejected outright';
  if (back.interruptedRunId !== null) return `FAIL: ${back.interruptedRunId}`;
  return 'loads, with nothing to ask about';
});

check('recovering a run replays its reply once, not twice', () => {
  // The end of the story the three checks above begin, and the place it went
  // wrong first time. The phone asks the desktop for the whole run, because
  // sequence numbers live in memory and did not survive the restart - so every
  // `message_delta` arrives again, and `message_delta` appends. Without
  // `run_started` clearing what was accumulated, the reply comes back as
  // "The answer is parThe answer is partly yes."
  const ev = (e: Record<string, unknown>, seq: number) =>
    ({ runId: 'r1', sessionId: 's1', agentId: 'claude-code', seq, ts: 1000 + seq, ...e }) as AgentEvent;

  let recovered: LiveRun = run({
    runId: 'r1',
    text: 'The answer is par',
    status: 'stopped',
    outcome: 'interrupted when the app closed',
  });

  const replay = [
    ev({ type: 'run_started', prompt: 'explain this', mode: 'independent', branch: 'main', worktreePath: null }, 0),
    ev({ type: 'message_delta', text: 'The answer is par' }, 1),
    ev({ type: 'message_delta', text: 'tly yes.' }, 2),
    ev({ type: 'run_finished', outcome: 'completed' }, 3),
  ];
  for (const event of replay) recovered = reduceRun(recovered, event, event.ts!);

  if (recovered.text !== 'The answer is partly yes.') return `FAIL: "${recovered.text}"`;
  if (recovered.status !== 'finished') return `FAIL: came back ${recovered.status}`;
  return 'the run finished, and its reply is not doubled';
});

check('a reply known to be incomplete is never restored as whole', () => {
  // The desktop's registry is in memory and bounded. By the next launch it may
  // have forgotten this run entirely, so there is no second chance to learn
  // that part of it is missing - if the mark is not carried across, a reply
  // missing its beginning quietly becomes a complete-looking one.
  const stored = shrink(workspace({ conversation: [run({ incomplete: true })] }));
  const back = revive(JSON.parse(JSON.stringify(stored)));
  if (back?.conversation[0]?.incomplete !== true) return 'FAIL: came back looking whole';
  return 'still marked incomplete after a round trip';
});

check('a run from a build before this field loads as whole, not as broken', () => {
  const stored = shrink(workspace()) as unknown as Record<string, unknown>;
  (stored['conversation'] as Record<string, unknown>[])[0]!['incomplete'] = undefined;
  const back = revive(JSON.parse(JSON.stringify(stored)));
  if (!back) return 'FAIL: rejected an older file';
  if (back.conversation[0]?.incomplete !== false) {
    return `FAIL: ${back.conversation[0]?.incomplete}`;
  }
  return 'defaults to false rather than undefined';
});

check('a long reply is capped and says so', () => {
  const stored = shrink(workspace({ conversation: [run({ text: 'x'.repeat(200_000) })] }));
  const text = stored.conversation[0]!.text;
  if (text.length >= 200_000) return `FAIL: stored ${text.length} chars uncapped`;
  if (!text.includes('truncated')) return 'FAIL: capped silently, with no marker';
  return `${200_000} chars became ${text.length}, marked truncated`;
});

check('an undecided review keeps its diff rather than losing it', () => {
  const changes = {
    branch: 'axune/demo',
    commit: 'abc1234',
    files: [{ path: 'a.ts', status: 'modified' as const, insertions: 3, deletions: 1 }],
    insertions: 3,
    deletions: 1,
    patch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
    behindBy: 0,
  };
  const stored = shrink(workspace({ conversation: [run({ changes, decision: null })] }));
  const back = stored.conversation[0]!.changes;
  if (!back) return 'FAIL: the review was dropped';
  if (!back.patch.includes('+new')) return 'FAIL: the diff was emptied';
  return `branch ${back.branch} kept, diff intact, ${back.files.length} file listed`;
});

check('the whole file stays small enough to write on the JS thread', () => {
  const heavy = Array.from({ length: 40 }, (_, i) =>
    thread(`t${i}`, Array.from({ length: 40 }, () => run({ text: 'y'.repeat(60_000) }))),
  );
  const bytes = JSON.stringify(shrink(workspace({ threads: heavy }))).length;
  const worst = 40 * 40 * 60_000;
  if (bytes > 2_000_000) return `FAIL: ${(bytes / 1e6).toFixed(1)} MB is too large`;
  return `${(worst / 1e6).toFixed(0)} MB of runs stored as ${(bytes / 1e3).toFixed(0)} KB`;
});

check('a corrupt file yields no history instead of a crash', () => {
  const cases: unknown[] = [
    null,
    'not an object',
    {},
    { threads: 'nope', conversation: [] },
    { threads: [], conversation: [{ nonsense: true }] },
    { threads: [{ id: 't', runs: [null, { runId: 'r', text: 'ok' }] }], conversation: [] },
  ];
  for (const value of cases) {
    const back = revive(value);
    if (back === null) continue;
    if (back.conversation.some((entry) => typeof entry?.text !== 'string')) {
      return `FAIL: junk survived from ${JSON.stringify(value).slice(0, 40)}`;
    }
    if (back.threads.some((t) => t.runs.some((entry) => typeof entry?.text !== 'string'))) {
      return `FAIL: junk run survived inside a thread`;
    }
  }
  return `${cases.length} malformed files handled, none threw`;
});

check('the oldest threads are the ones dropped', () => {
  const many = Array.from({ length: 50 }, (_, i) => thread(`t${i}`, [run()]));
  const stored = shrink(workspace({ threads: many }));
  if (stored.threads.length >= 50) return `FAIL: kept all ${stored.threads.length}`;
  if (stored.threads[0]!.id !== 't0') return `FAIL: newest thread lost, kept ${stored.threads[0]!.id} first`;
  return `50 threads capped to ${stored.threads.length}, newest first`;
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
