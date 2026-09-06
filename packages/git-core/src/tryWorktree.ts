/**
 * Proves isolation before any agent is allowed to write.
 *
 *   npm --prefix packages/git-core run try -- [repoPath]
 *
 * The claim being tested is the one that makes writing from a phone
 * defensible: an agent editing in its worktree leaves the real working tree
 * exactly as it found it, and discarding the work is deleting a branch.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { WorktreeManager } from './WorktreeManager';

const execFileAsync = promisify(execFile);
const repo = process.argv[2] ?? process.cwd();

async function main() {
  const manager = new WorktreeManager(repo);

  const before = await status(repo);
  const beforeBranch = await branch(repo);
  console.log(`repo    : ${repo}`);
  console.log(`branch  : ${beforeBranch}`);
  console.log(`dirty   : ${before.length} file(s) before\n`);

  const worktree = await manager.create('claude-code', 'testrun-0001');
  console.log(`worktree: ${worktree.path}`);
  console.log(`branch  : ${worktree.branch} (from ${worktree.base.slice(0, 8)})\n`);

  // Stand in for an agent: create a file and modify an existing one.
  writeFileSync(join(worktree.path, 'AGENT_WROTE_THIS.md'), '# Written by an agent\n');
  const readme = join(worktree.path, 'README.md');
  writeFileSync(readme, `${readFileSync(readme, 'utf8')}\n<!-- agent edit -->\n`);

  const changes = await manager.changes(worktree);
  console.log('changes seen by Axune:');
  for (const change of changes) {
    console.log(`  ${change.status.padEnd(9)} ${change.path}  +${change.insertions} −${change.deletions}`);
  }

  const patch = await manager.diff(worktree);
  console.log(`\ndiff    : ${patch.split('\n').length} lines, ${patch.length} bytes`);

  const sha = await manager.commit(worktree, 'Agent changes from Axune test');
  console.log(`commit  : ${sha ?? '(nothing to commit)'}`);

  // The claim under test.
  const after = await status(repo);
  const afterBranch = await branch(repo);
  const isolated = after.length === before.length && afterBranch === beforeBranch;

  console.log('\n' + '─'.repeat(60));
  console.log(
    isolated
      ? `✔ real working tree untouched — still ${after.length} dirty file(s) on ${afterBranch}`
      : `✖ LEAK: tree went from ${before.length} to ${after.length} dirty, branch ${beforeBranch} → ${afterBranch}`,
  );

  await manager.release(worktree);
  const branches = await manager.list();
  console.log(`branch survives release: ${branches.includes(worktree.branch) ? 'yes' : 'no'}`);

  await manager.discard(worktree);
  const afterDiscard = await manager.list();
  console.log(`discard removes branch : ${afterDiscard.includes(worktree.branch) ? 'NO — leaked' : 'yes'}`);
}

async function status(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, 'status', '--porcelain'], {
    windowsHide: true,
  });
  return stdout.split('\n').filter((line) => line.trim());
}

async function branch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    windowsHide: true,
  });
  return stdout.trim();
}

main().catch((error) => {
  console.error('worktree test failed:', error);
  process.exit(1);
});
