/**
 * Proves a stored appearance cannot render the app invisible.
 *
 *   npm --prefix apps/mobile run try:appearance
 *
 * The darkness preference is a number read back from storage and then mixed
 * into every colour token by `blendPalette`. That makes a bad value uniquely
 * nasty: it does not throw, it produces a full palette of invalid colours, and
 * the app opens with nothing visible on it - a failure with no error attached.
 *
 * So these attack the read rather than exercise it: values that are not
 * numbers, values outside the range, and the difference between "never chosen"
 * and "chose zero", which are the same falsy thing to a careless check and must
 * not be.
 */
import { parseDarkness } from '../lib/darkness';

let failures = 0;

function check(name: string, run: () => string): void {
  const detail = run();
  const bad = detail.startsWith('FAIL');
  if (bad) failures += 1;
  console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
}

console.log('\na stored appearance cannot render the app invisible\n');

check('a real choice is read back exactly', () => {
  for (const value of ['0', '0.5', '1', '0.37']) {
    if (parseDarkness(value) !== Number(value)) return `FAIL: ${value} came back wrong`;
  }
  return '0, 0.37, 0.5 and 1 all survive the round trip';
});

check('never chosen is not the same as chose zero', () => {
  // A careless `if (!stored)` would treat these identically, and someone who
  // deliberately picked paper-white would be handed the system theme on every
  // launch instead.
  if (parseDarkness(null) !== null) return 'FAIL: absent should be null';
  if (parseDarkness('0') !== 0) return 'FAIL: an explicit zero was discarded';
  return 'absent reads null, an explicit 0 reads 0';
});

check('junk never reaches the palette', () => {
  // This is the one that matters: Number('') is 0 and Number('x') is NaN, and
  // NaN blended across every token is an app with no colours.
  const junk = ['', ' ', 'dark', 'NaN', 'null', 'undefined', '0.5abc', '1e999', '-0.0001', '1.0001', '2', '-1'];
  for (const value of junk) {
    const parsed = parseDarkness(value);
    if (parsed !== null) return `FAIL: ${JSON.stringify(value)} parsed to ${parsed}`;
  }
  return `${junk.length} junk values all rejected, including '' and '1e999'`;
});

check('nothing that survives can produce a NaN blend', () => {
  // The property the palette actually depends on, asserted directly rather
  // than inferred from the cases above.
  for (let i = 0; i <= 1000; i += 1) {
    const parsed = parseDarkness(String(i / 1000));
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return `FAIL: ${i / 1000} produced ${parsed}`;
    }
  }
  return '1001 values across the range, all finite and in bounds';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
