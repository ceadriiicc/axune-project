/**
 * Decides whether a shell command only reads.
 *
 * Denying Bash outright makes a read-only run clumsy: the agent loses `ls`,
 * `git log` and `git diff`, and compensates by hammering Glob and Read to
 * reconstruct what one command would have told it. Allowing Bash outright hands
 * over `rm -rf`. So the command itself is inspected.
 *
 * The parsing is deliberately paranoid rather than clever. Shell command
 * classification is a well-known source of bypasses — `ls; rm -rf /`,
 * `ls && rm x`, `echo $(rm x)`, backticks, redirection — so anything that could
 * chain, substitute or redirect is refused outright rather than parsed. A
 * legitimate command that gets refused costs the agent one Glob; a bypass costs
 * the user their working tree.
 */

/** Characters that let one command become several, or write to a file. */
const SHELL_CONTROL = /[;&|><`$(){}]/;

/** Commands that cannot modify anything, whatever their arguments. */
const READ_ONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'file',
  'stat',
  'du',
  'df',
  'pwd',
  'which',
  'where',
  'echo',
  'date',
  'tree',
  'diff',
  'sort',
  'uniq',
  'basename',
  'dirname',
  'realpath',
  'node',
  'python',
]);

/**
 * Git subcommands that only read. Everything else — commit, checkout, reset,
 * clean, push, stash, config — is treated as a write, because several of them
 * can destroy uncommitted work.
 */
const READ_ONLY_GIT = new Set([
  'log',
  'status',
  'diff',
  'show',
  'branch',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'blame',
  'describe',
  'shortlog',
  'tag',
  'remote',
  'reflog',
  'cat-file',
  'count-objects',
]);

/** `node -e` / `python -c` can do anything; only version checks are allowed. */
const INTERPRETER_SAFE_FLAGS = new Set(['-v', '--version']);

export function isReadOnlyShellCommand(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const command = raw.trim();
  if (!command) return false;

  // Anything that can chain, substitute or redirect is refused without further
  // analysis. This is the check that makes the rest of the function safe.
  if (SHELL_CONTROL.test(command)) return false;

  const tokens = command.split(/\s+/);
  const [head, ...rest] = tokens;
  if (!head) return false;

  // A leading environment assignment (FOO=bar cmd) is a write vector into the
  // command's behaviour; not worth reasoning about.
  if (head.includes('=')) return false;

  const name = head.replace(/^.*[\\/]/, '').toLowerCase();

  if (name === 'git') {
    // `git -C <path> log` is common; skip leading global flags and their values.
    let index = 0;
    while (index < rest.length && rest[index]!.startsWith('-')) {
      index += rest[index] === '-C' ? 2 : 1;
    }
    const subcommand = rest[index]?.toLowerCase();
    return subcommand ? READ_ONLY_GIT.has(subcommand) : false;
  }

  if (name === 'node' || name === 'python' || name === 'python3') {
    // Running a script or an inline expression is arbitrary code execution.
    return rest.length === 1 && INTERPRETER_SAFE_FLAGS.has(rest[0]!);
  }

  return READ_ONLY_COMMANDS.has(name);
}
