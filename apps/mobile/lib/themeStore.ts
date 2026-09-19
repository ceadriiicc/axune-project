import * as SecureStore from 'expo-secure-store';

import { parseDarkness } from './darkness';
import { parseLayout, serializeLayout, type WidgetId } from './homeLayout';

/**
 * Which theme the user picked.
 *
 * `system` follows the phone, which is the right default for something opened
 * at a desk in the morning and in bed at night. The other two are deliberate
 * overrides and are remembered.
 *
 * Kept beside the pairing rather than in it: a theme preference is not a
 * credential, and forgetting the desktop should not reset how the app looks.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'axune.theme.v1';

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
    // Storage refused, or this is the web build. Following the system is the
    // safe answer: it is never wrong, only sometimes not what was asked for.
    return 'system';
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, mode, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The choice still applies for this session; it simply will not survive a
    // relaunch. Not worth surfacing an error over an appearance setting.
  }
}

const DARKNESS_KEY = 'axune.darkness.v1';

/**
 * How dark the interface should be, from 0 (paper) to 1 (black).
 *
 * The appearance control is a continuous slider rather than a light/dark
 * switch, so the preference is a number rather than one of three names. It is
 * stored separately from `ThemeMode` on purpose: they answer different
 * questions, and a future build that drops one should not have to migrate the
 * other.
 *
 * Null means the person has never chosen, which is not the same as choosing
 * zero - the caller follows the phone in that case, exactly as `system` does.
 */
export async function loadDarkness(): Promise<number | null> {
  try {
    return parseDarkness(await SecureStore.getItemAsync(DARKNESS_KEY));
  } catch {
    return null;
  }
}

export async function saveDarkness(amount: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(DARKNESS_KEY, String(amount), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // As above: the choice holds for this session and is simply forgotten.
  }
}

const LAYOUT_KEY = 'axune.home.v1';

/**
 * Which cards are on Home, and in what order.
 *
 * Stored for the same reason the appearance is: an arrangement that resets
 * every launch is not a setting, it is a toy. Kept beside the theme rather
 * than with the pairing, because forgetting the desktop should not rearrange
 * someone's Home.
 */
export async function loadHomeLayout(): Promise<WidgetId[]> {
  try {
    return parseLayout(await SecureStore.getItemAsync(LAYOUT_KEY));
  } catch {
    return parseLayout(null);
  }
}

export async function saveHomeLayout(layout: WidgetId[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAYOUT_KEY, serializeLayout(layout), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The arrangement holds for this session and is simply forgotten.
  }
}