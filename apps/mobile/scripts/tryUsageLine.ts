/**
 * Proves the usage line does not claim more than it knows.
 *
 *   npm --prefix apps/mobile run try:usage-line
 *
 * Every figure here is measured from real runs against this repository, so a
 * change that looks harmless can be checked against what the provider actually
 * reported rather than against an invented example.
 *
 * The failure worth guarding is not a wrong total - it is a confident
 * explanation of the wrong thing. Telling someone a run was a cold start when
 * it simply read twenty files teaches them to distrust every number beside it.
 */
import { approxCost, compact, describeUsage } from '../lib/usageLine';
import { IDLE_GAP_MS, type RunUsage } from '@axune/protocol';

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

const usage = (over: Partial<RunUsage>): RunUsage => ({
  inputTokens: 4,
  outputTokens: 40,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0.02,
  turns: 1,
  durationMs: 3_000,
  ...over,
});

const MINUTE = 60 * 1000;

console.log('\nthe usage line does not claim more than it knows\n');

check('a warm first turn is not called idle', () => {
  const line = describeUsage(usage({ cacheCreationTokens: 5_416, cacheReadTokens: 37_580 }), 5 * MINUTE);
  if (line.idle) return 'FAIL: called a warm turn idle';
  return `${line.text}, not idle`;
});

check('a settled turn shows almost nothing sent fresh', () => {
  const line = describeUsage(usage({ cacheCreationTokens: 38, cacheReadTokens: 43_077 }), MINUTE);
  if (line.idle) return 'FAIL: called it idle';
  if (line.fresh > 100) return `FAIL: reported ${line.fresh} fresh`;
  return `${line.text}, ${line.fresh} sent fresh`;
});

check('a genuinely cold run after a long gap is explained', () => {
  // Measured: the run that started this whole investigation.
  const line = describeUsage(usage({ inputTokens: 2, cacheCreationTokens: 47_474, cacheReadTokens: 0, costUsd: 0.476 }), 3 * 60 * MINUTE);
  if (!line.idle) return 'FAIL: a run that reused nothing after three hours was not explained';
  return `${line.text}, idle`;
});

check('a run that merely read a lot of files is NOT called idle', () => {
  // The distinction the two-signal rule exists for. Measured from the same
  // session: low reuse, but seconds after the previous turn - so the cache was
  // warm and the fresh tokens were file contents, not a cold start.
  const line = describeUsage(usage({ cacheCreationTokens: 47_005, cacheReadTokens: 43_072, costUsd: 0.5 }), 30 * 1000);
  if (line.idle) return 'FAIL: blamed an idle cache for tokens the agent spent reading files';
  return `${line.tokens} tokens with reuse below half, and no claim made about why`;
});

check('low reuse alone never earns the claim', () => {
  const justInside = describeUsage(usage({ cacheCreationTokens: 47_000, cacheReadTokens: 0 }), IDLE_GAP_MS - 1);
  const justOutside = describeUsage(usage({ cacheCreationTokens: 47_000, cacheReadTokens: 0 }), IDLE_GAP_MS);
  if (justInside.idle) return 'FAIL: claimed idle inside the cache lifetime';
  if (!justOutside.idle) return 'FAIL: withheld the claim past the cache lifetime';
  return 'the claim turns on at the cache lifetime and not before';
});

check('the first run of a session has no previous turn to compare', () => {
  const line = describeUsage(usage({ cacheCreationTokens: 47_000, cacheReadTokens: 0 }), null);
  if (!line.idle) return 'FAIL: a cold first run of the day went unexplained';
  return 'no previous turn is treated as a long gap, which is what it is';
});

check('a small run is never judged on its cache', () => {
  // A failed or trivial run reuses nothing because there was nothing to reuse.
  const line = describeUsage(usage({ cacheCreationTokens: 200, cacheReadTokens: 0 }), 5 * 60 * MINUTE);
  if (line.idle) return 'FAIL: read noise as a cold start';
  return `${line.tokens} tokens is too small to judge, and no claim was made`;
});

check('totals are the provider numbers, not a subset', () => {
  const line = describeUsage(usage({ inputTokens: 4, outputTokens: 347, cacheCreationTokens: 5_416, cacheReadTokens: 37_580 }), MINUTE);
  if (line.tokens !== 43_347) return `FAIL: totalled ${line.tokens}, expected 43347`;
  if (line.reused + line.fresh + 347 !== line.tokens) return 'FAIL: the split does not add up to the total';
  return `${line.tokens} tokens, and reused plus fresh plus output equals it`;
});

check('cost is never shown as a bill', () => {
  const shown = approxCost(0.073);
  if (shown !== '≈$0.07 of API equivalent') return `FAIL: rendered ${shown}`;
  // A subscription is not billed per run. Dropping the qualifier would assert
  // a charge that never appears on a statement.
  if (!shown.includes('equivalent')) return 'FAIL: rendered a bare dollar figure';
  if (!approxCost(0.0001)?.startsWith('≈$0.01')) return `FAIL: a real cost rendered as ${approxCost(0.0001)}`;
  if (approxCost(null) !== null) return 'FAIL: invented a cost for a run that reported none';
  return shown;
});

check('token counts round without lying about scale', () => {
  if (compact(999) !== '999') return `FAIL: ${compact(999)}`;
  if (compact(43_115) !== '43.1k') return `FAIL: ${compact(43_115)}`;
  if (compact(138_000) !== '138k') return `FAIL: ${compact(138_000)}`;
  if (compact(2_400_000) !== '2.4M') return `FAIL: ${compact(2_400_000)}`;
  return '999, 43.1k, 138k, 2.4M';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
