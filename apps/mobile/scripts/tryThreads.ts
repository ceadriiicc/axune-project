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
import { revive, shrink } from '../lib/threadShrink';
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
  status: 'finished',
  outcome: 'completed',
  startedAt: 1_700_000_000_000,
  lastEventAt: 1_700_000_001_000,
  write: false,
  changes: null,
  decision: null,
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
