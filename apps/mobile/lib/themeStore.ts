import * as SecureStore from 'expo-secure-store';

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
