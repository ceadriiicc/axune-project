import type { GitSnapshot } from '@axune/protocol';

import type { ActivityLog } from './ActivityLog';
import { readGitSnapshot } from './gitSnapshot';

/**
 * Notices repository changes and records them, whether or not a phone is
 * connected.
 *
 * This is the part that makes "since you last checked" mean anything: the
 * interesting changes happen while the user is away, so the desktop has to be
 * watching then, not only when someone is looking.
 *
 * Polling rather than filesystem watching on purpose — a git poll is two cheap
 * commands, while watching a repository tree means thousands of handles and a
 * storm of events on every branch switch or npm install.
 */
export class GitWatcher {
  private previous: GitSnapshot | undefined;
  private previousBranch: string | undefined;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: string,
    private readonly log: ActivityLog,
    private readonly branchOf: () => string,
    private readonly intervalMs = 20_000,
  ) {}

  async start(): Promise<void> {
    // Seed silently: the state at startup is not news.
    this.previous = await readGitSnapshot(this.repo);
    this.previousBranch = this.branchOf();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const next = await readGitSnapshot(this.repo);
    if (!next) return;

    const before = this.previous;
    this.previous = next;

    const branch = this.branchOf();
    if (this.previousBranch && branch !== this.previousBranch) {
      this.log.record('git.branch', `Switched to ${branch}`, `from ${this.previousBranch}`);
    }
    this.previousBranch = branch;

    if (!before) return;

    if (next.lastCommitHash !== before.lastCommitHash) {
      this.log.record('git.commit', next.lastCommitMessage, next.lastCommitHash);
    }

    // Pushing shows up as the ahead count falling without a new commit.
    if (
      before.ahead !== null &&
      next.ahead !== null &&
      next.ahead < before.ahead &&
      next.lastCommitHash === before.lastCommitHash
    ) {
      const pushed = before.ahead - next.ahead;
      this.log.record('git.pushed', `Pushed ${pushed} commit${pushed === 1 ? '' : 's'}`);
    }

    const beforeDirty = before.dirtyFiles + before.untrackedFiles;
    const nextDirty = next.dirtyFiles + next.untrackedFiles;

    // Only the transitions are worth recording. A tree that stays dirty is not
    // news every twenty seconds.
    if (beforeDirty === 0 && nextDirty > 0) {
      this.log.record('git.dirty', `${nextDirty} file${nextDirty === 1 ? '' : 's'} changed`);
    } else if (beforeDirty > 0 && nextDirty === 0) {
      this.log.record('git.clean', 'Working tree is clean');
    }
  }
}
