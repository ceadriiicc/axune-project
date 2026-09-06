import { isAbsolute, relative, resolve } from 'node:path';

import { isReadOnlyShellCommand } from './readOnlyShell';

/**
 * The rules that make letting an agent edit code from a phone defensible.
 *
 * Worktree isolation alone is not enough. It controls where the agent *starts*,
 * not where it can reach: file tools take absolute paths, and a shell is a
 * shell. These checks bound what a run can touch regardless of what it decides
 * to do.
 *
 * Everything here fails closed. A wrongly refused operation costs the agent one
 * turn and an explanation; a wrongly allowed one can cost the user their
 * credentials or their working tree.
 */

/** Tools whose input names a path we must confine. */
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'edit_file_path'];

/**
 * Commands refused in every mode, including write runs.
 *
 * Deletion is absent from the allowed set on purpose: an agent that needs a
 * file gone can say so, and a person can do it. Losing one turn of agent
 * autonomy is a fair trade for never having `rm -rf` behind a phone screen.
 */
const NEVER_ALLOWED = new Set([
  'rm',
  'rmdir',
  'del',
  'rd',
  'sudo',
  'doas',
  'runas',
  'chmod',
  'chown',
  'icacls',
  'takeown',
  'curl',
  'wget',
  'iwr',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'kill',
  'taskkill',
  'shutdown',
  'reboot',
  'diskpart',
  'format',
  'mkfs',
  'dd',
  'reg',
  'regedit',
  'schtasks',
  'crontab',
  'systemctl',
  'launchctl',
]);

/** Commands a write run may run beyond the read-only set. */
const WRITE_SAFE = new Set([
  'mkdir',
  'cp',
  'copy',
  'mv',
  'move',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'tsc',
  'jest',
  'vitest',
  'pytest',
  'go',
  'cargo',
  'make',
  'prettier',
  'eslint',
]);

/** Package-manager subcommands that reach the network or publish. */
const BLOCKED_PACKAGE_SUBCOMMANDS = new Set(['publish', 'login', 'adduser', 'token', 'config']);

/** Git subcommands a write run may use. Nothing that rewrites or leaves the machine. */
const WRITE_SAFE_GIT = new Set(['add', 'commit', 'status', 'diff', 'log', 'show', 'stash']);

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Confine a tool's file argument to the directory the run owns.
 *
 * Without this, worktree isolation only decides where the agent begins. `Write`
 * with an absolute path could reach the user's real repository, their SSH keys,
 * or anything else on the machine.
 */
export function checkPath(root: string, input: Record<string, unknown>): PolicyDecision {
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value !== 'string' || !value) continue;

    const target = isAbsolute(value) ? resolve(value) : resolve(root, value);
    const rel = relative(resolve(root), target);

    // Empty means the root itself; a leading ".." or an absolute result means
    // the path climbed out of it.
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return {
        allowed: false,
        reason: `Axune confines this run to ${root}. ${value} is outside it.`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Whether a shell command is acceptable for the mode the run is in.
 *
 * Read-only runs get the strict classifier. Write runs get a slightly wider
 * set — build tools, package scripts, git add and commit — but the same refusal
 * of anything that can chain, escalate, delete, or reach the network.
 */
export function checkCommand(command: unknown, mode: 'read' | 'write'): PolicyDecision {
  if (typeof command !== 'string' || !command.trim()) {
    return { allowed: false, reason: 'Empty command.' };
  }

  if (isReadOnlyShellCommand(command)) return { allowed: true };

  if (mode === 'read') {
    return { allowed: false, reason: 'This run is read-only. Inspect and report instead.' };
  }

  // The classifier already refuses anything containing shell control characters,
  // so by here the command is a single simple invocation.
  if (/[;&|><`$(){}]/.test(command)) {
    return { allowed: false, reason: 'Chained or redirected commands are not allowed.' };
  }

  const tokens = command.trim().split(/\s+/);
  const head = tokens[0] ?? '';
  const name = head.replace(/^.*[\\/]/, '').toLowerCase();
  const rest = tokens.slice(1);

  if (NEVER_ALLOWED.has(name)) {
    return { allowed: false, reason: `${name} is never permitted from Axune.` };
  }

  if (name === 'git') {
    const subcommand = rest.find((token) => !token.startsWith('-'))?.toLowerCase();
    if (!subcommand || !WRITE_SAFE_GIT.has(subcommand)) {
      return {
        allowed: false,
        reason: `git ${subcommand ?? ''} is not permitted — pushing and history rewriting stay with the user.`,
      };
    }
    return { allowed: true };
  }

  if (['npm', 'pnpm', 'yarn', 'npx'].includes(name)) {
    const subcommand = rest.find((token) => !token.startsWith('-'))?.toLowerCase();
    if (subcommand && BLOCKED_PACKAGE_SUBCOMMANDS.has(subcommand)) {
      return { allowed: false, reason: `${name} ${subcommand} is not permitted.` };
    }
    return { allowed: true };
  }

  if (WRITE_SAFE.has(name)) return { allowed: true };

  return { allowed: false, reason: `${name} is not on the permitted list for a write run.` };
}

/**
 * A ceiling on how long a run may go.
 *
 * A confused agent can loop for a long time, and every turn spends the user's
 * own subscription allowance. This is not a safety boundary so much as a
 * promise that a phone-started run cannot quietly run all afternoon.
 */
export const MAX_TURNS = 60;
