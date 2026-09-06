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

    const status = await statusCounts(repo);

    return {
      lastCommitMessage: subject ?? '',
      lastCommitAt: Number(timestamp ?? 0) * 1000,
      lastCommitHash: hash,
      ...status,
      ...(await diffScale(repo)),
      ...(await aheadBehind(repo)),
      inProgress: await operationInProgress(repo),
      detachedHead: await isDetachedHead(repo),
    };
  } catch {
    return undefined;
  }
}

/**
 * Porcelain status split into the categories worth showing separately.
 * Conflicts get their own count because they are the one state that should
 * interrupt someone rather than sit quietly in a metric row.
 */
async function statusCounts(
  repo: string,
): Promise<{ dirtyFiles: number; untrackedFiles: number; conflicts: number }> {
  try {
    const output = await git(repo, ['status', '--porcelain']);
    const lines = output ? output.split('\n').filter((line) => line.trim().length > 0) : [];

    let dirtyFiles = 0;
    let untrackedFiles = 0;
    let conflicts = 0;

    for (const line of lines) {
      const code = line.slice(0, 2);
      if (code === '??') untrackedFiles += 1;
      else if (code.includes('U') || code === 'AA' || code === 'DD') conflicts += 1;
      else dirtyFiles += 1;
    }

    return { dirtyFiles, untrackedFiles, conflicts };
  } catch {
    return { dirtyFiles: 0, untrackedFiles: 0, conflicts: 0 };
  }
}

/** Lines changed in the working tree, for a sense of how big the change is. */
async function diffScale(repo: string): Promise<{ insertions: number; deletions: number }> {
  try {
    const output = await git(repo, ['diff', '--numstat', 'HEAD']);
    let insertions = 0;
    let deletions = 0;
    for (const line of output.split('\n')) {
      const [added, removed] = line.trim().split(/\s+/);
      insertions += Number(added) || 0;
      deletions += Number(removed) || 0;
    }
    return { insertions, deletions };
  } catch {
    return { insertions: 0, deletions: 0 };
  }
}

/** Rebase, merge or cherry-pick left half-finished — worth surfacing loudly. */
async function operationInProgress(
  repo: string,
): Promise<'rebase' | 'merge' | 'cherry-pick' | null> {
  const markers: Array<['rebase' | 'merge' | 'cherry-pick', string]> = [
    ['merge', 'MERGE_HEAD'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'],
    ['rebase', 'REBASE_HEAD'],
  ];
  for (const [kind, marker] of markers) {
    try {
      await git(repo, ['rev-parse', '--verify', '--quiet', marker]);
      return kind;
    } catch {
      // Marker absent; try the next.
    }
  }
  return null;
}

async function isDetachedHead(repo: string): Promise<boolean> {
  try {
    return (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])) === 'HEAD';
  } catch {
    return false;
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
