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

  /**
   * Stage new files as "intent to add" so they appear in diffs.
   *
   * Without this a file the agent created is invisible to `git diff` — the
   * review would say "1 file created" and show nothing, which is worse than
   * useless when the whole point is deciding whether to keep the work.
   */
  private async includeUntracked(worktree: Worktree): Promise<void> {
    await this.git(['add', '--intent-to-add', '--all'], worktree.path).catch(() => undefined);
  }

  /** Files the agent touched, with the scale and kind of each change. */
  async changes(worktree: Worktree): Promise<FileChange[]> {
    await this.includeUntracked(worktree);

    // Two passes: numstat gives the line counts, name-status gives the kind.
    // Intent-to-add makes a created file look tracked, so without the second
    // pass everything reports as "modified" and a review cannot tell a new
    // file from an edited one.
    const [numstat, nameStatus] = await Promise.all([
      this.git(['diff', '--numstat', worktree.base], worktree.path).catch(() => ''),
      this.git(['diff', '--name-status', worktree.base], worktree.path).catch(() => ''),
    ]);

    const kinds = new Map<string, FileChange['status']>();
    for (const line of nameStatus.split('\n')) {
      const [code, path] = line.split('\t');
      if (!path) continue;
      kinds.set(path, code?.startsWith('A') ? 'created' : code?.startsWith('D') ? 'deleted' : 'modified');
    }

    return numstat
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [added, removed, path] = line.split('\t');
        return {
          path: path ?? '',
          insertions: Number(added) || 0,
          deletions: Number(removed) || 0,
          status: kinds.get(path ?? '') ?? 'modified',
        };
      });
  }

  /** The patch itself, for review before anything is merged. */
  async diff(worktree: Worktree, maxBytes = 200_000): Promise<string> {
    await this.includeUntracked(worktree);
    const patch = await this.git(['diff', worktree.base], worktree.path).catch(() => '');
    return patch.length > maxBytes ? `${patch.slice(0, maxBytes)}\n… diff truncated` : patch;
  }

  /**
   * Commit whatever the agent changed, so the work survives the worktree being
   * removed. Returns null when it changed nothing.
   */
  async commit(worktree: Worktree, subject: string, body?: string): Promise<string | null> {
    await this.git(['add', '-A'], worktree.path);
    const staged = await this.git(['diff', '--cached', '--name-only'], worktree.path);
    if (!staged.trim()) return null;

    // Subject stays short for logs; the body carries the prompt in full, since
    // a truncated subject is a poor record of intent for something permanent.
    const args = ['commit', '-m', subject];
    if (body && body.trim() && body.trim() !== subject) args.push('-m', body.trim());

    // Say who wrote this. Without a trailer an agent's commit is
    // indistinguishable from one the developer typed, and nobody auditing the
    // repository a year from now can tell which is which. A trailer is
    // deliberately additive: authorship stays whatever git is configured to
    // use, so nothing is misattributed to a person who did not write it, and
    // the marker is greppable.
    args.push('-m', `Axune-Agent: ${worktree.agentId}
Axune-Run: ${worktree.runId}`);

    await this.git(args, worktree.path);
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

  /**
   * Branches Axune has produced, newest first.
   *
   * Kept work is otherwise invisible — it exists only if you happen to run
   * `git branch`. Anything an agent wrote and a user chose to keep should be
   * findable from the app that created it.
   */
  async branches(defaultBranch = 'main'): Promise<AgentBranch[]> {
    const output = await this.git([
      'branch',
      '--list',
      'axune/*',
      '--sort=-committerdate',
      '--format=%(refname:short)|%(committerdate:unix)|%(subject)',
    ]).catch(() => '');

    const rows = output.split('\n').filter((line) => line.trim());

    return Promise.all(
      rows.map(async (row) => {
        const [name = '', at = '0', ...rest] = row.split('|');
        const stat = await this.git([
          'diff',
          '--shortstat',
          `${defaultBranch}...${name}`,
        ]).catch(() => '');
        return {
          name,
          subject: rest.join('|'),
          at: Number(at) * 1000,
          files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0),
        };
      }),
    );
  }

  /** Delete a branch by name, for cleaning up work that was never merged. */
  async deleteBranch(name: string): Promise<void> {
    // Only ever Axune's own branches. A stray name must never reach here.
    if (!name.startsWith('axune/')) throw new Error(`Refusing to delete ${name}`);
    await this.git(['branch', '-D', name]);
  }

  /**
   * How far the branch's base has fallen behind since the agent started.
   * Zero means the work is still built on current code.
   */
  async behindBy(worktree: Worktree): Promise<number> {
    const output = await this.git(['rev-list', '--count', `${worktree.base}..HEAD`]).catch(() => '0');
    return Number(output) || 0;
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

export interface AgentBranch {
  name: string;
  subject: string;
  at: number;
  files: number;
}

export interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
  status: 'modified' | 'created' | 'deleted';
}
