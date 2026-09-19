/**
 * Which cards are on Home, and in what order.
 *
 * Kept apart from the screen and free of React Native imports so it can be
 * tested under Node - the same reason verificationCodes and blendPalette live
 * out here. The screen is the part that cannot be tested; this is the part with
 * a way to go wrong.
 *
 * What can go wrong: this is read back from storage, and a layout that arrives
 * damaged must not be able to hide a card the person relies on, or show one
 * twice, or leave Home empty. So parsing is total - anything unrecognisable
 * becomes the default rather than an error, because a Home that fails to render
 * is worse than a Home that forgot an arrangement.
 */

/** Every card Home can show. The order here is the default order. */
export const WIDGETS = ['next', 'now', 'health', 'recent', 'activity', 'branches', 'agents'] as const;

export type WidgetId = (typeof WIDGETS)[number];

/**
 * What a fresh install shows.
 *
 * Deliberately not all of them. Home answers "what is happening and does it
 * need me" in the first screenful; branches and agents are reference, and a
 * Home that opens with seven cards answers nothing.
 */
export const DEFAULT_LAYOUT: WidgetId[] = ['next', 'now', 'health', 'recent'];

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && (WIDGETS as readonly string[]).includes(value);
}

/**
 * Read a stored layout, surviving anything.
 *
 * Unknown ids are dropped rather than rendered - a card this build does not
 * have would otherwise be an empty frame with a title. Duplicates are collapsed,
 * because the same card twice is a bug someone would report as flicker. An
 * empty result falls back to the default, since Home with nothing on it looks
 * broken rather than customised.
 */
export function parseLayout(raw: string | null): WidgetId[] {
  if (!raw) return [...DEFAULT_LAYOUT];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...DEFAULT_LAYOUT];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_LAYOUT];

  const seen = new Set<WidgetId>();
  for (const entry of parsed) {
    if (isWidgetId(entry)) seen.add(entry);
  }

  // An empty layout is a choice someone can legitimately make by removing every
  // card, so it is only replaced when the stored value gave us nothing usable
  // at all - not when it was a well-formed empty list.
  if (seen.size === 0) return parsed.length === 0 ? [] : [...DEFAULT_LAYOUT];
  return [...seen];
}

export function serializeLayout(layout: WidgetId[]): string {
  return JSON.stringify(layout);
}

/** Move one card up or down, ignoring a move off either end. */
export function moveWidget(layout: WidgetId[], id: WidgetId, direction: -1 | 1): WidgetId[] {
  const index = layout.indexOf(id);
  if (index < 0) return layout;
  const destination = index + direction;
  if (destination < 0 || destination >= layout.length) return layout;
  const next = [...layout];
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}

/** The cards not currently on Home, in their canonical order rather than insertion order. */
export function availableWidgets(layout: WidgetId[]): WidgetId[] {
  return WIDGETS.filter((id) => !layout.includes(id));
}
