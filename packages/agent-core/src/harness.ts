/**
 * Headless proof of the Phase 1 core, with no Electron and no phone involved.
 *
 *   npm --prefix packages/agent-core run try -- "<prompt>" [repoPath] [--stop-after=<ms>]
 *
 * Deliberately built before any UI: the risky part of Phase 1 is whether a real
 * Claude Code run against a real repository streams back and can be stopped.
 * Everything else is plumbing around that.
 *
 * `--raw` additionally prints each provider message type as it arrives, which is
 * how the adapter's normalisation gets checked against reality rather than docs.
 */
import { randomUUID } from 'node:crypto';

import type { AgentEvent } from '@axune/protocol';

import { ClaudeCodeAdapter } from './ClaudeCodeAdapter';

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  const prompt =
    positional[0] ??
    'Inspect this project and describe what it is in three sentences. Do not modify anything.';
  const cwd = positional[1] ?? process.cwd();
  const stopAfter = Number(flags.find((f) => f.startsWith('--stop-after='))?.split('=')[1] ?? 0);

  const adapter = new ClaudeCodeAdapter();

  const detection = await adapter.detect();
  console.log(`\ndetect → installed=${detection.installed} version=${detection.version} auth=${detection.authenticated}`);
  console.log(`         ${detection.detail}`);
  if (!detection.installed) process.exit(1);

  console.log(`\nrepo   → ${cwd}`);
  console.log(`prompt → ${prompt}`);
  if (stopAfter) console.log(`stop   → aborting after ${stopAfter}ms (testing the stop path)`);
  console.log('─'.repeat(72));

  const counts = new Map<string, number>();
  let textChars = 0;

  const running = adapter.start(
    {
      runId: randomUUID(),
      sessionId: randomUUID(),
      mode: 'independent',
      prompt,
      cwd,
      branch: 'main',
      readOnly: true,
    },
    (event: AgentEvent) => {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
      render(event);
      if (event.type === 'message_delta') textChars += event.text.length;
    },
  );

  if (stopAfter > 0) {
    setTimeout(() => {
      console.log('\n\n[harness] calling stop()…');
      void running.stop();
    }, stopAfter);
  }

  const result = await running.done;

  console.log('\n' + '─'.repeat(72));
  console.log(`outcome  : ${result.outcome}`);
  console.log(`session  : ${result.providerSessionId ?? '(none reported)'}`);
  console.log(`text     : ${textChars} chars streamed`);
  console.log('events   :', [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
}

function render(event: AgentEvent) {
  switch (event.type) {
    case 'run_started':
      return void console.log(`[${event.seq}] run_started`);
    case 'working':
      return void console.log(`[${event.seq}] ${event.label}\n`);
    case 'message_delta':
      return void process.stdout.write(event.text);
    case 'tool_started':
      return void console.log(`\n[${event.seq}] → ${event.toolName} ${truncate(event.input, 100)}`);
    case 'tool_finished':
      return void console.log(`[${event.seq}] ← ${event.ok ? 'ok' : 'DENIED'} ${truncate(event.output, 100)}`);
    case 'error':
      return void console.log(`\n[${event.seq}] error: ${event.message}`);
    case 'run_finished':
      return void console.log(`\n[${event.seq}] run_finished: ${event.outcome}`);
    default:
      return;
  }
}

function truncate(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

main().catch((error) => {
  console.error('\nharness failed:', error);
  process.exit(1);
});
