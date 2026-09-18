import type { RandomBytes } from '@axune/secure-channel';

/**
 * The three codes offered during pairing: the real one, and two decoys.
 *
 * Separated from the screen so it can be tested at all. Living inside
 * `pair.tsx` meant it could only be reached through a file that imports the
 * camera, which drags React Native in and cannot be run under Node - the same
 * trap that made `AxuneClient` untestable until randomness became a parameter.
 * It takes `RandomBytes` for exactly that reason, and because there is no safe
 * default to reach for.
 *
 * The decoys carry no cryptographic weight: an attacker gains nothing from
 * predicting them, because they never leave the phone. What they have to be is
 * **indistinguishable in shape**, so the eye cannot pick the real code out
 * without consulting the desktop - which is the entire point of the screen.
 */
export function withDecoys(real: string, random: RandomBytes): string[] {
  const options = [real];
  while (options.length < 3) {
    const candidate = randomCode(random);
    if (!options.includes(candidate)) options.push(candidate);
  }

  // Fisher-Yates. A biased shuffle would put the real code in a predictable
  // position, and anyone pairing twice would learn to tap there without
  // reading anything.
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = random(1)[0]! % (i + 1);
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return options;
}

/** A code shaped exactly like `fingerprint()` output: two groups of five hex. */
export function randomCode(random: RandomBytes): string {
  const hex = Array.from(random(5))
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join('')
    .slice(0, 10);
  return `${hex.slice(0, 5)} ${hex.slice(5)}`;
}
