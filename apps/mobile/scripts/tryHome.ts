/**
 * Proves a damaged Home layout cannot hide something or render nothing.
 *
 *   npm --prefix apps/mobile run try:home
 *
 * The arrangement is read back from storage, so it is attacker-free but not
 * fault-free: a truncated write, an older build with different cards, or a
 * hand-edited value all arrive here. The failures worth guarding are quiet
 * ones - a card silently missing, the same card twice, or a Home that opens
 * empty and reads as broken rather than customised.
 *
 * Also checks what Next up says, because that card exists to be believed: it
 * earns nothing if it reports work that is not waiting, and it costs a great
 * deal if it stays quiet when something is.
 */
import type { GitSnapshot } from '@axune/protocol';

import {
  availableWidgets,
  DEFAULT_LAYOUT,
  moveWidget,
  parseLayout,
  serializeLayout,
  WIDGETS,
  type WidgetId,
} from '../lib/homeLayout';
import { nextAdvice } from '../lib/nextAdvice';

let failures = 0;

function check(name: string, run: () => string): void {
  const detail = run();
  const bad = detail.startsWith('FAIL');
  if (bad) failures += 1;
  console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
}

const quiet: GitSnapshot = {
  lastCommitMessage: 'fine',
  lastCommitAt: Date.now(),
  lastCommitHash: 'abc1234',
  dirtyFiles: 0,
  untrackedFiles: 0,
  insertions: 0,
  deletions: 0,
  ahead: 0,
  behind: 0,
  conflicts: 0,
  inProgress: null,
  detachedHead: false,
};

console.log('\na damaged Home layout cannot hide anything\n');

check('a round trip keeps the arrangement exactly', () => {
  const layout: WidgetId[] = ['recent', 'next', 'agents'];
  const back = parseLayout(serializeLayout(layout));
  if (back.join(',') !== layout.join(',')) return `FAIL: got ${back.join(',')}`;
  return 'order and contents survive storage';
});

check('junk falls back rather than failing', () => {
  // A Home that throws on a bad string is a Home that cannot open.
  for (const raw of ['', 'null', '{}', '[', 'undefined', '"next"', '42', '[1,2,3]']) {
    const parsed = parseLayout(raw);
    if (parsed.length === 0) return `FAIL: ${JSON.stringify(raw)} produced an empty Home`;
    if (parsed.join(',') !== DEFAULT_LAYOUT.join(',')) {
      return `FAIL: ${JSON.stringify(raw)} produced ${parsed.join(',')}`;
    }
  }
  return '8 malformed values all fell back to the default';
});

check('an unknown card from another build is dropped, not rendered', () => {
  // Rendering one would give an empty frame with a title and no content.
  const parsed = parseLayout(JSON.stringify(['next', 'telemetry', 'now', 'weather']));
  if (parsed.includes('telemetry' as WidgetId)) return 'FAIL: kept an unknown card';
  if (parsed.join(',') !== 'next,now') return `FAIL: got ${parsed.join(',')}`;
  return 'unknown ids removed, known ones kept in order';
});

check('the same card cannot appear twice', () => {
  const parsed = parseLayout(JSON.stringify(['now', 'now', 'next', 'now']));
  if (parsed.length !== new Set(parsed).size) return `FAIL: duplicates survived: ${parsed.join(',')}`;
  if (parsed.join(',') !== 'now,next') return `FAIL: got ${parsed.join(',')}`;
  return 'duplicates collapsed, first position kept';
});

check('removing every card is respected, not overridden', () => {
  // Someone who cleared their Home meant it. Replacing that with the default
  // would look like the app refusing to do as it was told.
  const parsed = parseLayout('[]');
  if (parsed.length !== 0) return `FAIL: an empty Home became ${parsed.join(',')}`;
  return 'a deliberately empty Home stays empty';
});

check('moving a card off either end does nothing', () => {
  const layout: WidgetId[] = ['next', 'now', 'health'];
  if (moveWidget(layout, 'next', -1).join(',') !== 'next,now,health') return 'FAIL: moved past the top';
  if (moveWidget(layout, 'health', 1).join(',') !== 'next,now,health') return 'FAIL: moved past the bottom';
  if (moveWidget(layout, 'now', -1).join(',') !== 'now,next,health') return 'FAIL: a valid move failed';
  return 'the ends hold and a valid move works';
});

check('every card is reachable from the add sheet', () => {
  // A card that is removable but not addable is a one-way door.
  const missing = availableWidgets([]);
  if (missing.length !== WIDGETS.length) return `FAIL: only ${missing.length} of ${WIDGETS.length} offered`;
  const onHome = availableWidgets([...WIDGETS]);
  if (onHome.length !== 0) return 'FAIL: offered a card already on Home';
  return `all ${WIDGETS.length} cards can be added back`;
});

// ---- what Next up claims -------------------------------------------------

check('a quiet repository says nothing is waiting', () => {
  if (nextAdvice(quiet) !== null) return 'FAIL: invented work on a clean repository';
  if (nextAdvice(undefined) !== null) return 'FAIL: invented work with no snapshot at all';
  return 'silent when there is nothing to say';
});

check('the worst problem is the one reported', () => {
  // Conflicts and an unpushed commit at once must report the conflicts: the
  // ordering is what stops the card telling you the least useful true thing.
  const messy: GitSnapshot = { ...quiet, conflicts: 2, ahead: 3, behind: 1 };
  const advice = nextAdvice(messy);
  if (!advice?.title.includes('conflicts')) return `FAIL: reported "${advice?.title}"`;
  if (advice.tone !== 'danger') return `FAIL: conflicts were toned ${advice.tone}`;

  const detached: GitSnapshot = { ...quiet, detachedHead: true, ahead: 5 };
  if (!nextAdvice(detached)?.title.includes('detached')) return 'FAIL: detached HEAD was outranked';
  return 'conflicts beat unpushed work, detached HEAD beats unpushed work';
});

check('counts read correctly at one', () => {
  // "1 conflicts are waiting" is the kind of detail that makes people stop
  // believing the rest of the sentence.
  const one = nextAdvice({ ...quiet, conflicts: 1 });
  if (!one?.body.startsWith('1 conflict is')) return `FAIL: "${one?.body}"`;
  const many = nextAdvice({ ...quiet, conflicts: 3 });
  if (!many?.body.startsWith('3 conflicts are')) return `FAIL: "${many?.body}"`;
  const ahead = nextAdvice({ ...quiet, ahead: 1 });
  if (!ahead?.body.includes('1 commit only')) return `FAIL: "${ahead?.body}"`;
  return 'singular and plural both read as English';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
