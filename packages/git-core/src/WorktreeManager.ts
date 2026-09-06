import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Gives each editing agent its own branch and working directory.
 *
 * This is decision D3, made on day one and deliberately built before any agent
 * was allowed to write. Two reasons it is not optional:
 *
 *  - **Your editor.** An agent writing into the tree you have open will fight
 *    your unsaved buffers and can destroy work you never committed.
 *  - **Each other.** Paired Mode runs two agents at once. Sharing a tree means
 *    whichever writes second wins, silently, and the comparison is meaningless.
 *
 * A worktree is cheap — git shares the object store, so this costs a checkout,
 * not a clone — and discarding one is deleting a branch, which is what makes
 * letting an agent write from a phone defensible at all.
 */
export class WorktreeManager {
  constructor(private readonly repo: string) {}

  /**
   * Create an isolated worktree for a run, branched from the current HEAD.
   * The branch is named after the agent so it is obvious later who wrote it.
   */
  async create(agentId: string, runId: string): Promise<Worktree> {
    const short = runId.slice(0, 8);
    const branch = `axune/${agentId}-${short}`;
    const path = join(mkdtempSync(join(tmpdir(), 'axune-')), short);

    const base = await this.git(['rev-parse', 'HEAD']);
    await this.git(['worktree', 'add', '-b', branch, path, base]);

    return { branch, path, base, agentId, runId };
  }

  /** Files the agent touched, with the scale of each change. */
  async changes(worktree: Worktree): Promise<FileChange[]> {
    const output = await this.git(
      ['diff', '--numstat', worktree.base],
      worktree.path,
    ).catch(() => '');

    const tracked = output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [added, removed, path] = line.split('\t');
        return {
          path: path ?? '',
          insertions: Number(added) || 0,
          deletions: Number(removed) || 0,
          status: 'modified' as const,
        };
      });

    // Files git does not know about yet would otherwise be invisible, which is
    // exactly the case where an agent has created something new.
    const untracked = (await this.git(['ls-files', '--others', '--exclude-standard'], worktree.path)
      .catch(() => ''))
      .split('\n')
      .filter((line) => line.trim())
      .map((path) => ({ path, insertions: 0, deletions: 0, status: 'created' as const }));

    return [...tracked, ...untracked];
  }

  /** The patch itself, for review before anything is merged. */
  async diff(worktree: Worktree, maxBytes = 200_000): Promise<string> {
    const patch = await this.git(['diff', worktree.base], worktree.path).catch(() => '');
    return patch.length > maxBytes ? `${patch.slice(0, maxBytes)}\n… diff truncated` : patch;
  }

  /**
   * Commit whatever the agent changed, so the work survives the worktree being
   * removed. Returns null when it changed nothing.
   */
  async commit(worktree: Worktree, message: string): Promise<string | null> {
    await this.git(['add', '-A'], worktree.path);
    const staged = await this.git(['diff', '--cached', '--name-only'], worktree.path);
    if (!staged.trim()) return null;

    await this.git(['commit', '-m', message], worktree.path);
    return this.git(['rev-parse', '--short', 'HEAD'], worktree.path);
  }

  /**
   * Remove the working directory. The branch survives on purpose — the point of
   * isolation is that the work is still there to look at or merge later.
   */
  async release(worktree: Worktree): Promise<void> {
    await this.git(['worktree', 'remove', worktree.path, '--force']).catch(() => undefined);
  }

  /** Throw the branch away too. Only ever on an explicit discard. */
  async discard(worktree: Worktree): Promise<void> {
    await this.release(worktree);
    await this.git(['branch', '-D', worktree.branch]).catch(() => undefined);
  }

  async list(): Promise<string[]> {
    const output = await this.git(['branch', '--list', 'axune/*', '--format=%(refname:short)']);
    return output.split('\n').filter((line) => line.trim());
  }

  private async git(args: string[], cwd = this.repo): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }
}

export interface Worktree {
  branch: string;
  path: string;
  /** The commit this branched from, so diffs are against the right base. */
  base: string;
  agentId: string;
  runId: string;
}

export interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
  status: 'modified' | 'created';
}
