import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitSnapshot } from '@axune/protocol';

const execFileAsync = promisify(execFile);

/**
 * Reads the state of the work, for the phone to show at a glance.
 *
 * Every command here is read-only and cheap. Failure is never fatal: a missing
 * snapshot means Home shows less, which is far better than a Home that cannot
 * load because a repository is in an odd state — mid-rebase, no commits yet, no
 * upstream configured.
 */
export async function readGitSnapshot(repo: string): Promise<GitSnapshot | undefined> {
  try {
    const [subject, timestamp, hash] = (
      await git(repo, ['log', '-1', '--format=%s%n%ct%n%h'])
    ).split('\n');

    if (!hash) return undefined; // A repository with no commits yet.

    return {
      lastCommitMessage: subject ?? '',
      lastCommitAt: Number(timestamp ?? 0) * 1000,
      lastCommitHash: hash,
      dirtyFiles: await countDirtyFiles(repo),
      ...(await aheadBehind(repo)),
    };
  } catch {
    return undefined;
  }
}

async function countDirtyFiles(repo: string): Promise<number> {
  try {
    const output = await git(repo, ['status', '--porcelain']);
    return output ? output.split('\n').filter((line) => line.trim().length > 0).length : 0;
  } catch {
    return 0;
  }
}

async function aheadBehind(repo: string): Promise<{ ahead: number | null; behind: number | null }> {
  try {
    // Fails when the branch has no upstream, which is common and not an error.
    const output = await git(repo, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    const [behind, ahead] = output.split(/\s+/).map(Number);
    return {
      ahead: Number.isFinite(ahead) ? ahead! : null,
      behind: Number.isFinite(behind) ? behind! : null,
    };
  } catch {
    return { ahead: null, behind: null };
  }
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    timeout: 10_000,
    windowsHide: true,
  });
  return stdout.trim();
}
