/**
 * Whether the screen should be covered right now.
 *
 * ## Why this exists
 *
 * iOS photographs the app when it leaves the foreground, to draw the card you
 * see in the app switcher, and writes that image to disk. Axune's foreground is
 * frequently a run transcript quoting source, so that snapshot is a copy of
 * private code sitting outside the app - readable by anyone who picks the phone
 * up and double-taps home, without unlocking anything Axune controls.
 *
 * It is the only privacy gap on the list that a bystander can exploit without
 * touching the device's storage at all.
 *
 * ## Why a pure function
 *
 * The component that draws the cover cannot be tested - it needs React Native.
 * The decision can be, and the decision is where the bug would live: getting
 * `inactive` wrong means the cover appears only *after* the snapshot is taken,
 * which looks like it works and does nothing.
 *
 * ## The state that matters is `inactive`, not `background`
 *
 * On iOS the sequence when the app switcher is invoked is `active` ->
 * `inactive` -> `background`, and the snapshot is taken around the transition.
 * Shielding only on `background` is too late. That is the whole reason this
 * distinction is worth a file.
 *
 * Android has no `inactive`; it goes straight to `background`. Covering on a
 * state that platform never emits costs nothing.
 */

/**
 * What React Native's AppState reports. Typed as a string rather than a union
 * because an unrecognised value must be handled, not excluded by the compiler:
 * the compiler is not what delivers the value at runtime.
 */
export type AppStateName = string;

/**
 * Cover the screen unless the app is definitely in the foreground.
 *
 * Deliberately inverted - an allow-list of one rather than a deny-list. A future
 * platform state nobody here has heard of covers the screen, which is a wasted
 * frame; the deny-list version leaks. Scope by what is known safe, not by
 * enumerating what is known dangerous, which is the same rule the agent policies
 * follow.
 */
export function shouldShield(state: AppStateName | null | undefined): boolean {
  return state !== 'active';
}

/**
 * Whether a transition needs the cover drawn before the frame is handed over.
 *
 * Exists so the caller does not have to remember that `inactive` is the
 * important one; a reader seeing only `background` in the component would
 * reasonably assume that was sufficient.
 */
export function isSnapshotRisk(state: AppStateName | null | undefined): boolean {
  return state === 'inactive' || state === 'background';
}
