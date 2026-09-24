/**
 * Asks the agent what tools it actually has, and fails when that changes.
 *
 *   npm --prefix apps/desktop run try:surface
 *
 * **This one costs a real agent call**, which is why it is not in the default
 * set. Run it after upgrading the Agent SDK or Claude Code.
 *
 * ## Why it exists
 *
 * Axune's tool policy was a deny-list of two names for as long as there were
 * few tools worth naming. Asked directly, the SDK reported twenty-six - among
 * them a second shell, two ways to spawn further agents, four that leave the
 * machine and one that schedules execution for later. None had been considered,
 * because nothing ever asked.
 *
 * The policy is an allow-list now, so a new tool is refused rather than
 * permitted, and that is the important fix. But a refusal nobody sees is still
 * a surprise waiting: a tool the agent wants and cannot have shows up as a run
 * behaving oddly, not as a decision. This makes the surface growing an event
 * someone reads, at the moment it grows, rather than a discovery months later.
 *
 * It deliberately fails on *any* change, including tools disappearing - an
 * allow-list naming a tool that no longer exists is stale in the direction that
 * looks fine.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { checkTool } from '@axune/agent-core';

/**
 * The surface as reviewed on 2026-09-24 against Claude Code with the Agent SDK
 * bundled at that date. Update this list only after reading what each new tool
 * does and deciding - that decision is the entire point of the check.
 */
const REVIEWED = [
  'Bash', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync', 'EnterWorktree',
  'ExitWorktree', 'Glob', 'Grep', 'ListAgents', 'Monitor', 'PowerShell',
  'PushNotification', 'Read', 'RemoteTrigger', 'ReportFindings', 'ScheduleWakeup',
  'SendMessage', 'ShareOnboardingGuide', 'Skill', 'Task', 'TaskStop', 'ToolSearch',
  'WebFetch', 'WebSearch', 'Workflow',
  // Permitted in a write run. Absent from an earlier reading of this list only
  // because that probe passed `disallowedTools`, which hides them.
  'Write', 'Edit', 'NotebookEdit',
];

/**
 * `MultiEdit` is named in Axune's write allow-list and is NOT offered by this
 * CLI. Harmless - permitting a tool that does not exist grants nothing - and
 * left in place rather than removed, because a CLI that reintroduces it should
 * find it already considered. Noted here so the absence is a record rather than
 * a puzzle for whoever next reads both lists.
 */
const KNOWN_ABSENT = ['MultiEdit'];

async function surface(): Promise<string[]> {
  const stream = query({
    prompt: 'Reply with only the word: ok',
    options: {
      cwd: process.cwd(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'default',
      allowedTools: [],
      maxTurns: 1,
      settingSources: ['project'],
    },
  });

  for await (const message of stream) {
    const m = message as { type: string; tools?: string[] };
    if (m.type === 'system' && Array.isArray(m.tools)) return m.tools;
  }
  throw new Error('the SDK never reported its tool list');
}

async function main() {
  console.log('\nwhat the agent can actually reach\n');

  const tools = await surface();
  const added = tools.filter((t) => !REVIEWED.includes(t));
  const gone = REVIEWED.filter((t) => !tools.includes(t) && !KNOWN_ABSENT.includes(t));

  const permitted = tools.filter((t) => checkTool(t, 'write').allowed);
  const refused = tools.length - permitted.length;

  console.log(`  the agent offers ${tools.length} tools`);
  console.log(`  Axune permits    ${permitted.length}: ${permitted.join(', ')}`);
  console.log(`  Axune refuses    ${refused}\n`);

  if (added.length > 0) {
    console.log(`  x ${added.length} tool(s) have appeared since this was last reviewed:`);
    console.log(`      ${added.join(', ')}`);
    console.log('      Read what each one does, decide, then update REVIEWED.\n');
  }
  if (gone.length > 0) {
    console.log(`  x ${gone.length} reviewed tool(s) no longer exist: ${gone.join(', ')}`);
    console.log('      An allow-list naming a tool that is gone is stale.\n');
  }

  // A surface that grew is the finding. A surface where nothing is refused
  // means the allow-list stopped doing anything, which is worse.
  if (refused === 0) {
    console.log('  x nothing was refused at all - the allow-list is not being applied\n');
    process.exit(1);
  }

  const ok = added.length === 0 && gone.length === 0;
  console.log(ok ? '  ok the surface is unchanged since it was reviewed\n' : '');
  process.exit(ok ? 0 : 1);
}

void main();
