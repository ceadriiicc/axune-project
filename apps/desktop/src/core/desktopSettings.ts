/**
 * What the desktop remembers between launches.
 *
 * ## Why this exists at all
 *
 * `projectPath` defaulted to `process.cwd()`. Run from a checkout that is
 * correct by accident; run from a Start menu shortcut it is whatever directory
 * Windows happened to hand the process, usually `C:\` or `system32`. So the
 * app would open on the wrong project, or on no project, the moment it stopped
 * being launched by a developer from a terminal - which is precisely the
 * transition this stage is about.
 *
 * ## Why parsing is total
 *
 * This file is read during startup, before a window exists to show an error in.
 * A settings file damaged by a crash mid-write, or left by an older build with
 * a different shape, must degrade to defaults rather than prevent the app from
 * starting. An app that will not open cannot be used to fix its own settings.
 *
 * Kept free of Electron so it can be tested under Node - the same split as the
 * phone's stores, and for the same reason.
 */

export interface DesktopSettings {
  /** The last project opened, or null to fall back to the working directory. */
  projectPath: string | null;
  /** Whether Axune starts with the machine. */
  launchOnLogin: boolean;
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  projectPath: null,
  // Off by default. Something that adds itself to startup without being asked
  // is the behaviour people uninstall software over, and the tray menu makes
  // turning it on a single click.
  launchOnLogin: false,
};

/**
 * Read stored settings, surviving anything.
 *
 * Each field is validated independently so one bad value does not discard the
 * others: someone whose `launchOnLogin` arrived as a string should not also
 * lose the project they had open.
 */
export function parseSettings(raw: string | null | undefined): DesktopSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_SETTINGS };
  }

  const record = parsed as Record<string, unknown>;
  const projectPath = record['projectPath'];
  const launchOnLogin = record['launchOnLogin'];

  return {
    // An empty string is not a path, and would resolve to somewhere surprising.
    projectPath: typeof projectPath === 'string' && projectPath.trim() ? projectPath : null,
    launchOnLogin: launchOnLogin === true,
  };
}

export function serializeSettings(settings: DesktopSettings): string {
  return JSON.stringify(settings, null, 2);
}
