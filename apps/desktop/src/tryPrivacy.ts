/**
 * Proves the privacy record says true things.
 *
 *   npm --prefix apps/desktop run try:privacy
 *
 * A ledger that under-reports is worse than none, because it invites trust it
 * has not earned. So these checks care less about the happy path than about the
 * ways a record can quietly lie: counting a file it never sent, missing one it
 * did, or writing the contents down while claiming to store only sizes.
 *
 * Uses a throwaway ledger file and synthetic events - no agent, no usage.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentEvent } from '@axune/protocol';

import { EgressLedger } from './core/EgressLedger';

const scratch = mkdtempSync(join(tmpdir(), 'axune-privacy-'));
const ledgerFile = join(scratch, 'egress.json');
const PROJECT = 'C:/dev/axune';

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

let seq = 0;
const ev = (body: Record<string, unknown>): AgentEvent =>
  ({ seq: seq++, runId: 'r1', sessionId: 's1', agentId: 'claude-code', ts: Date.now(), ...body }) as AgentEvent;

const fresh = () => new EgressLedger(PROJECT, ledgerFile);

console.log('\nprivacy record\n');

check('a file read is recorded, with its size and a relative path', () => {
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: 't1', toolName: 'Read', input: JSON.stringify({ file_path: 'C:/dev/axune/README.md' }) }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: 't1', ok: true, output: 'x'.repeat(2048) }));
  const line = l.close('r1');
  if (!line) return 'FAIL: reported nothing';
  const entry = l.recent(1)[0]!;
  if (entry.files[0]!.path !== 'README.md') return `FAIL: path stored as ${entry.files[0]!.path}`;
  if (entry.totalBytes !== 2048) return `FAIL: ${entry.totalBytes} bytes, expected 2048`;
  return `"${line}" - path relative to the project, not absolute`;
});

check('contents are never written to the ledger file', () => {
  const secret = 'SUPER_SECRET_VALUE_9d2f';
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: 't1', toolName: 'Read', input: JSON.stringify({ file_path: 'C:/dev/axune/src/config.ts' }) }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: 't1', ok: true, output: `const key = "${secret}"` }));
  l.close('r1');
  const onDisk = readFileSync(ledgerFile, 'utf8');
  if (onDisk.includes(secret)) return 'FAIL: the ledger stored the file contents';
  if (!onDisk.includes('src/config.ts')) return 'FAIL: the path was not recorded';
  return 'the path is on disk, the contents are not';
});

check('a refused read is not counted as sent', () => {
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: 't1', toolName: 'Read', input: JSON.stringify({ file_path: 'C:/dev/axune/.env' }) }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: 't1', ok: false, output: 'Denied: secret file' }));
  const line = l.close('r1');
  return line === null ? 'nothing reported, because nothing was sent' : `FAIL: claimed "${line}"`;
});

check('a command is not attributed to a file', () => {
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: 't1', toolName: 'Bash', input: JSON.stringify({ command: 'cat README.md' }) }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: 't1', ok: true, output: 'x'.repeat(500) }));
  const line = l.close('r1');
  return line === null
    ? 'Bash output is not claimed as a file read'
    : `FAIL: attributed a command to a file - "${line}"`;
});

check('the same file read twice accumulates rather than duplicating', () => {
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  for (const id of ['t1', 't2']) {
    l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: id, toolName: 'Read', input: JSON.stringify({ file_path: 'C:/dev/axune/README.md' }) }));
    l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: id, ok: true, output: 'x'.repeat(100) }));
  }
  l.close('r1');
  const entry = l.recent(1)[0]!;
  if (entry.files.length !== 1) return `FAIL: ${entry.files.length} rows for one file`;
  if (entry.totalBytes !== 200) return `FAIL: ${entry.totalBytes} bytes, expected 200`;
  if (entry.reads !== 2) return `FAIL: ${entry.reads} reads, expected 2`;
  return 'one row, 200 bytes, 2 reads';
});

check('the ledger survives a restart and can be cleared', () => {
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: 't1', toolName: 'Read', input: JSON.stringify({ file_path: 'C:/dev/axune/a.ts' }) }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: 't1', ok: true, output: 'abc' }));
  l.close('r1');

  const reopened = fresh();
  if (reopened.recent(5).length === 0) return 'FAIL: nothing survived the restart';
  reopened.clear();
  if (new EgressLedger(PROJECT, ledgerFile).recent(5).length !== 0) return 'FAIL: clear() left entries behind';
  return 'persisted across a restart, and clear() empties it';
});

check('a path outside the project is kept absolute rather than mangled', () => {
  const l = fresh();
  l.observe('r1', 'claude-code', ev({ type: 'run_started', prompt: 'x', mode: 'independent', branch: 'main', worktreePath: null }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_started', toolCallId: 't1', toolName: 'Read', input: JSON.stringify({ file_path: 'C:/Users/someone/notes.txt' }) }));
  l.observe('r1', 'claude-code', ev({ type: 'tool_finished', toolCallId: 't1', ok: true, output: 'abc' }));
  l.close('r1');
  const path = l.recent(1)[0]!.files[0]!.path;
  return path.includes('Users')
    ? `kept as ${path} - a read outside the project stays visible`
    : `FAIL: rewritten to ${path}`;
});

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
