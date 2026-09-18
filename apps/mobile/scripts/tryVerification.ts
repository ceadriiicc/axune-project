/**
 * Proves the pairing choice cannot be guessed.
 *
 *   npm --prefix apps/mobile run try:verification
 *
 * The confirmation screen shows three codes and asks which one the desktop is
 * displaying. That only forces someone to look at the desktop if the real code
 * is genuinely indistinguishable from the decoys and genuinely unpredictable in
 * position. If either fails, the screen becomes a tap-through again - the exact
 * failure the single-code version had, but now wearing a costume.
 *
 * So each check attacks a way the answer could be inferred without looking:
 * shape, position, and duplicates.
 */
import { randomBytes } from 'node:crypto';

import { fingerprint, type RandomBytes } from '@axune/secure-channel';

import { withDecoys, randomCode } from '../lib/verificationCodes';

const nodeRandom: RandomBytes = (length) => Uint8Array.from(randomBytes(length));

/** The shape `fingerprint()` produces, and the shape a decoy must match. */
const SHAPE = /^[0-9A-F]{5} [0-9A-F]{5}$/;

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

const realCode = fingerprint(Uint8Array.from(randomBytes(32)));

console.log('\nthe pairing choice cannot be guessed\n');

check('the real code is always one of the three', () => {
  for (let i = 0; i < 2000; i += 1) {
    const options = withDecoys(realCode, nodeRandom);
    if (options.length !== 3) return `FAIL: got ${options.length} options`;
    if (!options.includes(realCode)) return 'FAIL: the real code was not offered';
    if (new Set(options).size !== 3) return `FAIL: duplicate options: ${options.join(', ')}`;
  }
  return '2000 draws, always three distinct options including the real one';
});

check('a decoy is indistinguishable from a real fingerprint', () => {
  // If decoys were a different shape, the eye would find the real one without
  // ever consulting the desktop.
  if (!SHAPE.test(realCode)) return `FAIL: the real code itself is off-shape: ${realCode}`;
  for (let i = 0; i < 2000; i += 1) {
    const decoy = randomCode(nodeRandom);
    if (!SHAPE.test(decoy)) return `FAIL: decoy is off-shape: ${JSON.stringify(decoy)}`;
  }
  return `2000 decoys, all matching ${SHAPE.source}`;
});

check('the real code is not biased toward a position', () => {
  // A lazy shuffle would put the answer in a predictable slot, and anyone
  // pairing twice would learn to tap there without reading anything.
  const draws = 30_000;
  const counts = [0, 0, 0];
  for (let i = 0; i < draws; i += 1) {
    counts[withDecoys(realCode, nodeRandom).indexOf(realCode)]! += 1;
  }
  const expected = draws / 3;
  // Generous but far tighter than any bias worth exploiting: a shuffle that
  // favoured a slot would miss this by a mile.
  const tolerance = expected * 0.06;
  const worst = Math.max(...counts.map((c) => Math.abs(c - expected)));
  if (worst > tolerance) {
    return `FAIL: positions ${counts.join('/')} across ${draws} draws, off by ${Math.round(worst)}`;
  }
  const percentages = counts.map((c) => ((c / draws) * 100).toFixed(1) + '%');
  return `${draws} draws landed ${percentages.join(' / ')}`;
});

check('two pairings do not offer the same decoys', () => {
  const first = withDecoys(realCode, nodeRandom).filter((c) => c !== realCode);
  const second = withDecoys(realCode, nodeRandom).filter((c) => c !== realCode);
  if (first.some((c) => second.includes(c))) {
    return `FAIL: a decoy repeated across pairings: ${first.join(', ')} vs ${second.join(', ')}`;
  }
  return 'fresh decoys each time';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
