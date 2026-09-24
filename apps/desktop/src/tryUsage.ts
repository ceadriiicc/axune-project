/**
 * Proves the usage ledger does not lie about a total.
 *
 *   npm --prefix apps/desktop run try:usage
 *
 * A usage figure is only worth having if it can be acted on, and the way it
 * becomes worthless is quiet: a cap that trims the runs worth counting, a
 * failed run counted as free, a run at 23:50 landing on tomorrow. Every one of
 * those produces a number that looks precise and under-reports.
 *
 * So these attack the arithmetic rather than exercise it. Uses a throwaway file
 * - no agent, no network, no usage of its own.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunUsage } from '@axune/protocol';

import { UsageLedger } from './core/UsageLedger';

const scratch = mkdtempSync(join(tmpdir(), 'axune-usage-'));
let failures = 0;
let n = 0;

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

const fresh = () => new UsageLedger(join(scratch, `usage-${n++}.json`));

const usage = (over: Partial<RunUsage> = {}): RunUsage => ({
  inputTokens: 100,
  outputTokens: 200,
  cacheCreationTokens: 1_000,
  cacheReadTokens: 500,
  costUsd: 0.05,
  turns: 2,
  durationMs: 4_000,
  ...over,
});

console.log('\nthe usage ledger does not lie about a total\n');

check('a day adds up to what was actually recorded', () => {
  const ledger = fresh();
  for (let i = 0; i < 5; i += 1) ledger.record(`r${i}`, 'claude-code', `question ${i}`, usage());
  const day = ledger.day();
  if (day.runs !== 5) return `FAIL: counted ${day.runs} runs`;
  if (day.inputTokens !== 500) return `FAIL: input ${day.inputTokens}`;
  if (day.cacheCreationTokens !== 5_000) return `FAIL: cache writes ${day.cacheCreationTokens}`;
  if (Math.abs(day.costUsd - 0.25) > 1e-9) return `FAIL: cost ${day.costUsd}`;
  return `5 runs, ${day.inputTokens + day.outputTokens + day.cacheCreationTokens + day.cacheReadTokens} tokens, $${day.costUsd.toFixed(2)}`;
});

check('a run that reported nothing is not counted as free', () => {
  // The distinction the whole design rests on. Storing zeroes would make a
  // failed run indistinguishable from a cheap one, and the total would read as
  // complete when it was not.
  const ledger = fresh();
  ledger.record('a', 'claude-code', 'worked', usage());
  ledger.record('b', 'claude-code', 'died before the provider answered', null);
  const day = ledger.day();
  if (day.runs !== 2) return `FAIL: ${day.runs} runs`;
  if (day.unreported !== 1) return `FAIL: ${day.unreported} unreported`;
  if (day.inputTokens !== 100) return `FAIL: the null run contributed ${day.inputTokens - 100}`;
  return '2 runs, 1 unreported, and the unreported one added nothing to the totals';
});

check('nothing is trimmed by count, however many runs there are', () => {
  // The reason this ledger exists. Every other store here caps by size, and a
  // total computed from a capped list is not a total.
  const ledger = fresh();
  for (let i = 0; i < 400; i += 1) ledger.record(`r${i}`, 'claude-code', 'q', usage());
  const day = ledger.day();
  if (day.runs !== 400) return `FAIL: kept only ${day.runs} of 400`;
  if (day.inputTokens !== 40_000) return `FAIL: input ${day.inputTokens}, expected 40000`;
  return '400 runs all counted';
});

check('an old run expires and stops being counted', () => {
  const file = join(scratch, 'ageing.json');
  const ledger = new UsageLedger(file, 60_000);
  ledger.record('old', 'claude-code', 'yesterday', usage());
  // Rewrite its timestamp to beyond the window, then reload.
  const rows = JSON.parse(readFileSync(file, 'utf8')) as { finishedAt: number }[];
  rows[0]!.finishedAt = Date.now() - 120_000;
  writeFileSync(file, JSON.stringify(rows));
  const reopened = new UsageLedger(file, 60_000);
  if (reopened.all().length !== 0) return `FAIL: ${reopened.all().length} survived the window`;
  return 'a run past the age limit is gone';
});

check('yesterday does not leak into today', () => {
  const file = join(scratch, 'days.json');
  const ledger = new UsageLedger(file);
  ledger.record('today', 'claude-code', 'now', usage());
  ledger.record('old', 'claude-code', 'then', usage({ inputTokens: 9_999 }));
  const rows = JSON.parse(readFileSync(file, 'utf8')) as { finishedAt: number }[];
  rows[1]!.finishedAt = Date.now() - 36 * 60 * 60 * 1000;
  writeFileSync(file, JSON.stringify(rows));

  const reopened = new UsageLedger(file);
  const day = reopened.day();
  if (day.runs !== 1) return `FAIL: today counted ${day.runs} runs`;
  if (day.inputTokens !== 100) return `FAIL: yesterday's 9999 leaked in`;
  return "today has 1 run; yesterday's is still stored but not counted";
});

check('the heaviest run is the heaviest, not the last', () => {
  const ledger = fresh();
  ledger.record('a', 'claude-code', 'small question', usage());
  ledger.record('b', 'claude-code', 'summarise every file in lib', usage({ cacheCreationTokens: 180_000 }));
  ledger.record('c', 'claude-code', 'another small one', usage());
  const day = ledger.day();
  if (!day.heaviest) return 'FAIL: no heaviest run';
  if (!day.heaviest.prompt.startsWith('summarise every file')) {
    return `FAIL: named "${day.heaviest.prompt}"`;
  }
  return `"${day.heaviest.prompt}" at ${(day.heaviest.tokens / 1000).toFixed(0)}k`;
});

check('only the first line of a prompt is stored', () => {
  // A ledger is not a second copy of what someone typed. It needs enough to
  // recognise an expensive run and no more.
  const ledger = fresh();
  ledger.record('a', 'claude-code', 'first line\nsecret second line\nthird', usage());
  const stored = ledger.all()[0]!;
  if (stored.prompt.includes('secret')) return `FAIL: stored "${stored.prompt}"`;
  if (stored.prompt !== 'first line') return `FAIL: stored "${stored.prompt}"`;

  const long = 'x'.repeat(500);
  ledger.record('b', 'claude-code', long, usage());
  if (ledger.all()[1]!.prompt.length > 81) return 'FAIL: a long prompt was stored whole';
  return 'first line only, capped at 80 characters';
});

check('a damaged file costs the history, not the launch', () => {
  const file = join(scratch, 'broken.json');
  writeFileSync(file, '{ this is not json');
  const ledger = new UsageLedger(file);
  if (ledger.all().length !== 0) return 'FAIL: junk survived';
  ledger.record('a', 'claude-code', 'after the damage', usage());
  if (ledger.day().runs !== 1) return 'FAIL: could not record after a bad read';
  return 'unreadable file became an empty ledger, and recording still works';
});

check('forgetting everything leaves nothing behind', () => {
  const file = join(scratch, 'wipe.json');
  const ledger = new UsageLedger(file);
  for (let i = 0; i < 3; i += 1) ledger.record(`r${i}`, 'claude-code', 'q', usage());
  const removed = ledger.clear();
  if (removed !== 3) return `FAIL: reported ${removed}`;
  if (new UsageLedger(file).all().length !== 0) return 'FAIL: entries came back after a reload';
  return 'reported 3 removed, and none returned';
});

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
