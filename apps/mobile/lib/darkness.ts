/**
 * Reading a stored darkness preference back safely.
 *
 * Kept apart from `themeStore` so it can be tested at all: that module imports
 * expo-secure-store, which drags React Native in and cannot run under Node.
 * The storage call is trivial; this is the part with a way to go wrong.
 *
 * The failure it guards against is quiet and total. `blendPalette` mixes every
 * colour token against this number, so a NaN here does not throw - it produces
 * an entire palette of invalid colours, and the app renders with nothing
 * visible at all.
 */
export function parseDarkness(raw: string | null): number | null {
  // Never chosen. Deliberately not the same as having chosen zero: the caller
  // follows the phone in this case, exactly as ThemeMode's `system` does.
  if (raw === null) return null;

  // Number('') and Number(' ') are both 0, not NaN. Without this an empty or
  // truncated value would read as "deliberately chose paper white" and would
  // silently override the phone's own setting on every launch - the one wrong
  // answer that looks exactly like a right one.
  if (raw.trim() === '') return null;

  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  if (amount < 0 || amount > 1) return null;
  return amount;
}
