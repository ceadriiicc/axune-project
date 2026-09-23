import { statSync } from 'node:fs';

/**
 * What state the chosen project folder is actually in.
 *
 * Lives here rather than in `main.ts` because that module calls Electron at
 * import time, so nothing in it can be tested. This is the part with a way to
 * go wrong, and the way it goes wrong is quiet: `isGitRepo` is what
 * `capability()` consults to decide whether the phone may ask for a write run.
 */

/** A folder that is there but is not a repository. */
export const NOT_A_REPO = '(not a git repo)';

/** A folder that is not there at all - renamed, deleted, or on a drive that is gone. */
export const FOLDER_MISSING = '(folder not found)';

/**
 * Branch labels that mean "there is no repository here".
 *
 * A set rather than a comparison against one of them. The check was
 * `branch !== '(not a git repo)'`, which was correct while that was the only
 * sentinel and would have called a missing folder a git repository the moment
 * a second one existed - turning writes back on for a folder that cannot take
 * them, silently, because nothing downstream re-checks.
 */
const SENTINELS = new Set<string>([NOT_A_REPO, FOLDER_MISSING]);

export function isRepoBranch(branch: string): boolean {
  return !SENTINELS.has(branch);
}

/**
 * Is the project directory there and readable?
 *
 * A remembered project can disappear between launches: a folder renamed, a USB
 * drive unplugged, a network share not mounted yet after a reboot. Reported
 * separately from "not a repository" because they need different answers - one
 * is a choice someone made, the other means their project is gone.
 */
export function projectReadable(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // Missing, unreadable, or a path the process is not allowed to stat. All
    // three mean the same thing here: do not pretend there is a project.
    return false;
  }
}
