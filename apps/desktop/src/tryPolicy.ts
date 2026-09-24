/**
 * Attempts the breach the tool policy is supposed to refuse.
 *
 *   npm --prefix apps/desktop run try:policy
 *
 * Written after asking the SDK what tools a run actually has. The answer was
 * 26, including a second shell, two ways to spawn further agents, four that
 * leave the machine and one that schedules execution for later. The policy at
 * the time named two of them.
 *
 * So these are not examples of the lists working. Each one is a route somebody
 * would take to get out, and the most important check is the last: that a tool
 * nobody has ever heard of is refused, because the surface grows with every CLI
 * release and nobody will be watching when it does.
 */
import { checkCommand, checkTool } from '@axune/agent-core';

let failures = 0;

function check(name: string, run: () => string): void {
  try {
    const detail = run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw: ${String(error)}`);
  }
}

console.log('\nthe tool policy refuses what it has never heard of\n');

check('a write run cannot reach a second shell', () => {
  // The hole this suite was written for. The command allow-list - which
  // refuses rm, curl, ssh, reg and shutdown - was reached only when the tool
  // was literally named Bash, so PowerShell walked past all of it.
  const verdict = checkTool('PowerShell', 'write');
  if (verdict.allowed) return 'FAIL: PowerShell permitted, bypassing the entire command allow-list';
  return `refused: ${verdict.reason}`;
});

check('nothing can spawn a further agent', () => {
  // Task and Workflow start agents whose own tool gating is not Axune's to
  // set, so permitting them hands away the boundary rather than widening it.
  for (const tool of ['Task', 'Workflow']) {
    for (const mode of ['read', 'write'] as const) {
      if (checkTool(tool, mode).allowed) return `FAIL: ${tool} permitted in ${mode} mode`;
    }
  }
  return 'Task and Workflow refused in both modes';
});

check('nothing reaches off this machine', () => {
  const offMachine = [
    'WebFetch', 'WebSearch', 'RemoteTrigger', 'PushNotification',
    'SendMessage', 'ShareOnboardingGuide', 'Artifact', 'DesignSync',
  ];
  for (const tool of offMachine) {
    for (const mode of ['read', 'write'] as const) {
      if (checkTool(tool, mode).allowed) return `FAIL: ${tool} permitted in ${mode} mode`;
    }
  }
  return `${offMachine.length} tools that leave the machine, all refused in both modes`;
});

check('nothing schedules execution for later', () => {
  // A run ends and its worktree is reviewed. Something scheduled outlives both.
  for (const tool of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'Monitor']) {
    if (checkTool(tool, 'write').allowed) return `FAIL: ${tool} permitted`;
  }
  return 'cron, wakeups and monitors all refused';
});

check('a read-only run cannot edit, and says why', () => {
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    const verdict = checkTool(tool, 'read');
    if (verdict.allowed) return `FAIL: ${tool} permitted in a read-only run`;
    if (!verdict.reason?.includes('read-only')) return `FAIL: unhelpful reason for ${tool}`;
  }
  return 'all four refused, each naming read-only as the cause';
});

check('a write run can still do its job', () => {
  // A boundary that refuses everything is not a boundary, it is a bug.
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Read', 'Glob', 'Grep']) {
    if (!checkTool(tool, 'write').allowed) return `FAIL: ${tool} refused in a write run`;
  }
  return 'editing, reading, searching and the shell all still permitted';
});

check('a tool nobody has heard of is refused', () => {
  // The structural property, and the only one that survives the next CLI
  // release. Every specific check above is a consequence of this one.
  const invented = ['ExfiltrateRepo', 'Mcp__notion__search', 'SomeToolShippedNextMonth', ''];
  for (const tool of invented) {
    for (const mode of ['read', 'write'] as const) {
      if (checkTool(tool, mode).allowed) return `FAIL: "${tool}" permitted in ${mode} mode`;
    }
  }
  return 'unknown tools are denied by default, in both modes';
});

check('a denial names the tool rather than reading as a malfunction', () => {
  const reason = checkTool('RemoteTrigger', 'write').reason ?? '';
  if (!reason.includes('RemoteTrigger')) return `FAIL: "${reason}"`;
  return `"${reason.slice(0, 64)}…"`;
});

check('the command allow-list still holds underneath', () => {
  // checkTool permits Bash; checkCommand is what makes that safe.
  for (const command of ['rm -rf /', 'curl http://x.test', 'ssh host', 'reg add HKLM', 'shutdown /s']) {
    if (checkCommand(command, 'write').allowed) return `FAIL: "${command}" permitted`;
  }
  if (checkCommand('git push origin main', 'write').allowed) return 'FAIL: git push permitted';
  if (!checkCommand('git status', 'write').allowed) return 'FAIL: git status refused';
  return 'destructive, networked and history-rewriting commands all refused';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
