import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';

import { parseCaptureGuard, serializeCaptureGuard } from './screenShield';

/**
 * Whether the screen may be recorded.
 *
 * `PrivacyShield` covers the app when it leaves the foreground, which stops the
 * app-switcher snapshot. It cannot stop a screen recording taken while you are
 * looking at a run, and on iOS nothing in JavaScript can - this needs the
 * native module, which is why it arrives later than the rest of P10.
 *
 * ## Why it is a setting rather than always on
 *
 * `preventScreenCaptureAsync` blanks the app in screen recordings. That is the
 * point, and it also makes it impossible to record a demo of Axune - which is a
 * thing Cedric will want to do, so a permanently-on guard would eventually be
 * worked around by turning something else off, or by not shipping the guard at
 * all. A switch that is on by default and can be turned off for ten minutes is
 * stronger than an absolute rule people resent.
 *
 * Default on, because the failure is silent: nobody notices a recording that
 * captured their source until it is already shared.
 */
const KEY = 'axune.captureGuard.v1';

export async function loadCaptureGuard(): Promise<boolean> {
  try {
    return parseCaptureGuard(await SecureStore.getItemAsync(KEY));
  } catch {
    // Storage refused, or this is the web build. Guarded is the safe answer.
    return true;
  }
}

export async function saveCaptureGuard(on: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, serializeCaptureGuard(on), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The choice still applies for this session; it will not survive a relaunch.
  }
}

/**
 * Apply the setting to the running app.
 *
 * Failures are swallowed on purpose. The module is unavailable on web and in
 * Expo Go, and an unhandled rejection during launch would be a far worse
 * outcome than an unguarded screen on a platform that cannot record one
 * meaningfully anyway.
 */
export async function applyCaptureGuard(on: boolean): Promise<void> {
  try {
    if (on) await ScreenCapture.preventScreenCaptureAsync();
    else await ScreenCapture.allowScreenCaptureAsync();
  } catch {
    // Nothing useful to do, and nothing the person can act on.
  }
}
