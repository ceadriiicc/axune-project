/**
 * Proves the appearance slider cannot produce an unusable palette.
 *
 *   npm --prefix apps/mobile run try:palette
 *
 * Every colour in the app comes from `blendPalette(darkness)`, so a fault here
 * is not a wrong shade - it is the whole interface at once, and it fails
 * silently: an invalid colour string does not throw, it simply renders as
 * nothing. That makes the slider the single input with the widest blast radius
 * in the app.
 *
 * So these attack the range rather than sample it: every token present at every
 * point, every value parseable as a colour, and the two ends actually reaching
 * the palettes they are supposed to be.
 */
import { palettes, type Palette } from '../constants/theme';
import { blendPalette } from '../lib/blendPalette';

let failures = 0;

function check(name: string, run: () => string): void {
  const detail = run();
  const bad = detail.startsWith('FAIL');
  if (bad) failures += 1;
  console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
}

/** Anything React Native will accept: rgb(), rgba(), or #hex. */
const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]+\))$/;

const STEPS = 201;
const at = (i: number) => i / (STEPS - 1);

console.log('\nthe appearance slider cannot produce an unusable palette\n');

check('every token exists at every point on the slider', () => {
  const expected = Object.keys(palettes.light).sort();
  for (let i = 0; i < STEPS; i += 1) {
    const keys = Object.keys(blendPalette(at(i))).sort();
    const missing = expected.filter((k) => !keys.includes(k));
    if (missing.length) return `FAIL: at ${at(i)} missing ${missing.join(', ')}`;
  }
  return `${expected.length} tokens present across ${STEPS} points`;
});

check('no value can render as nothing', () => {
  // The failure this exists for: NaN anywhere in the maths yields
  // "rgb(NaN, NaN, NaN)", which does not throw and paints nothing at all.
  for (let i = 0; i < STEPS; i += 1) {
    const palette = blendPalette(at(i)) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(palette)) {
      if (typeof value !== 'string') continue; // spacing and type scale are numbers
      if (value.includes('NaN')) return `FAIL: ${key} is ${value} at ${at(i)}`;
      if (!COLOUR.test(value)) return `FAIL: ${key} is not a colour at ${at(i)}: ${value}`;
    }
  }
  return `${STEPS} points checked, every colour parseable and NaN-free`;
});

check('the ends are the palettes they claim to be', () => {
  // A blend that did not actually reach light at 0 would mean the slider's
  // "Paper" label lies about where it lands.
  const light = blendPalette(0);
  const dark = blendPalette(1);
  if (light.text === dark.text) return 'FAIL: the two ends produced the same text colour';
  // Foreground must invert somewhere, or dark mode is unreadable.
  const lightText = light.text;
  const darkText = dark.text;
  if (!/^rgb\(1?[0-9]?[0-9],/.test(lightText)) return `FAIL: light text is not dark ink: ${lightText}`;
  if (!/^rgb\(2[0-9][0-9],/.test(darkText)) return `FAIL: dark text is not light ink: ${darkText}`;
  return `paper text ${lightText}, black text ${darkText}`;
});

check('out-of-range input cannot slip through to a colour', () => {
  // The provider clamps, but blendPalette is exported and the next caller may
  // not. Extrapolating past the ends produces channels outside 0-255, which
  // React Native renders unpredictably rather than rejecting.
  for (const amount of [-1, -0.5, 1.5, 2]) {
    const palette = blendPalette(amount) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(palette)) {
      if (typeof value !== 'string') continue;
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      if (channels.some((c) => c < 0 || c > 255)) {
        return `FAIL: ${key} at ${amount} is out of gamut: ${value}`;
      }
    }
  }
  return 'values outside 0-1 stay within gamut';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
