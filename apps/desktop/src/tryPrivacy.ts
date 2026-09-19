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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentEvent } from '@axune/protocol';

import { ActivityLog } from './core/ActivityLog';
import { EgressLedger } from './core/EgressLedger';
import { SessionStore, deviceKey } from './core/SessionStore';

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

// ---- retention: bounded by age, not only by count ----------------------

check('an old activity entry expires even when there is room for it', () => {
  const file = join(scratch, 'activity-age.json');
  // Well under the 300-entry cap, so only age can remove these.
  const old = { id: 'a', at: Date.now() - 60 * 24 * 60 * 60 * 1000, kind: 'git.commit', summary: 'from two months ago' };
  const fresh = { id: 'b', at: Date.now(), kind: 'git.commit', summary: 'today' };
  writeFileSync(file, JSON.stringify([old, fresh]));

  const log = new ActivityLog(file, 300);
  const kept = log.recent(40);
  if (kept.length !== 1) return `FAIL: ${kept.length} entries survived, expected 1`;
  if (kept[0]!.summary !== 'today') return `FAIL: kept the wrong one (${kept[0]!.summary})`;
  return 'a two-month-old entry was dropped although only two existed';
});

check('a recent activity entry is not expired', () => {
  const file = join(scratch, 'activity-fresh.json');
  writeFileSync(file, JSON.stringify([{ id: 'a', at: Date.now() - 1000, kind: 'run.started', summary: 'a moment ago' }]));
  const kept = new ActivityLog(file, 300).recent(40);
  return kept.length === 1 ? 'kept, as it should be' : `FAIL: dropped a fresh entry (${kept.length} left)`;
});

check('an old egress record expires', () => {
  const file = join(scratch, 'egress-age.json');
  const stale = { runId: 'r', agentId: 'claude-code', at: 0, finishedAt: Date.now() - 60 * 24 * 60 * 60 * 1000, reads: 1, totalBytes: 10, files: [{ path: 'a.ts', bytes: 10 }] };
  const fresh = { runId: 'r2', agentId: 'claude-code', at: 0, finishedAt: Date.now(), reads: 1, totalBytes: 10, files: [{ path: 'b.ts', bytes: 10 }] };
  writeFileSync(file, JSON.stringify([stale, fresh]));
  const entries = new EgressLedger(PROJECT, file).recent(20);
  if (entries.length !== 1) return `FAIL: ${entries.length} survived, expected 1`;
  return 'a record of what was sent two months ago is gone';
});

check('a provider session written by an older version survives the upgrade', () => {
  const file = join(scratch, 'store-migrate.json');
  // The old shape: a bare id with no timestamp.
  writeFileSync(file, JSON.stringify({ devices: {}, providerSessions: { 'sess:claude-code': 'provider-abc' } }));
  const store = new SessionStore(file);
  const id = store.providerSession('sess', 'claude-code');
  if (id !== 'provider-abc') return `FAIL: lost it on migration, got ${String(id)}`;
  return 'migrated rather than discarded - an upgrade must not delete resumable conversations';
});

check('an old provider session expires', () => {
  const file = join(scratch, 'store-old-session.json');
  const longAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
  writeFileSync(file, JSON.stringify({ devices: {}, providerSessions: { 'sess:claude-code': { id: 'provider-abc', at: longAgo } } }));
  const store = new SessionStore(file);
  return store.providerSession('sess', 'claude-code') === undefined
    ? 'a two-month-old session id is forgotten'
    : 'FAIL: kept indefinitely';
});

// ---- tokens at rest ------------------------------------------------------

check('a stored device yields no usable token', () => {
  // The breach attempt, not an inspection: read the file the way anything
  // running as this user could, and look for the credential in it. Until this
  // change the token *was* the key of the devices map, so it sat in plain text
  // on disk granting full control of the machine to whatever found it.
  const file = join(scratch, 'store-hashed.json');
  const token = 'a-session-token-that-grants-control';
  const store = new SessionStore(file);
  store.trustDevice(token, 'iPhone');

  const onDisk = readFileSync(file, 'utf8');
  if (onDisk.includes(token)) return 'FAIL: the raw token is sitting in the file';
  if (!onDisk.includes(deviceKey(token))) return 'FAIL: the device was not stored under its hash';

  // And the desktop must still recognise the phone that presents it.
  if (!store.isTrusted(token)) return 'FAIL: a trusted device stopped being recognised';
  if (store.deviceName(token) !== 'iPhone') return 'FAIL: the device name was lost';
  return 'the token is absent from disk and the device is still recognised';
});

check('a store written before hashing upgrades itself', () => {
  // An older file keyed devices by the raw token. It must migrate in place
  // rather than silently dropping the pairing, which would cost a re-pair and
  // look like data loss.
  const file = join(scratch, 'store-legacy.json');
  const token = 'legacy-session-token';
  writeFileSync(
    file,
    JSON.stringify({
      devices: { [token]: { deviceName: 'Old iPhone', pairedAt: Date.now(), lastSeenAt: Date.now() } },
      providerSessions: {},
    }),
  );

  const store = new SessionStore(file);
  if (!store.isTrusted(token)) return 'FAIL: the migrated device is no longer recognised';

  store.trustDevice('another', 'iPad'); // force a save so the upgrade lands on disk
  const onDisk = readFileSync(file, 'utf8');
  if (onDisk.includes(token)) return 'FAIL: the legacy raw token survived the upgrade';
  return 'the legacy pairing still works and its token is gone from disk';
});

check('one device can be revoked without touching the others', () => {
  // The gap before this: expire after thirty days, or forget everything. A
  // lost phone holds a live token until one of those happens, and nobody
  // re-pairs every other device to deal with it.
  const file = join(scratch, 'store-revoke.json');
  const store = new SessionStore(file);
  store.trustDevice('keep-me', 'iPhone');
  store.trustDevice('lost-phone', 'Old iPad');

  const lost = store.devices().find((d) => d.name === 'Old iPad');
  if (!lost) return 'FAIL: the device list did not report it';
  if (!store.forgetDevice(lost.key)) return 'FAIL: revoking reported failure';

  if (store.isTrusted('lost-phone')) return 'FAIL: the revoked device is still trusted';
  if (!store.isTrusted('keep-me')) return 'FAIL: revoking one took another with it';
  if (store.forgetDevice(lost.key)) return 'FAIL: revoking twice reported success';

  const reopened = new SessionStore(file);
  if (reopened.isTrusted('lost-phone')) return 'FAIL: the revoked device came back after a restart';
  return 'the lost device is gone, the other survived, and it stayed gone';
});

// ---- the wipe -----------------------------------------------------------

check('forgetting everything removes it all, and says what went', () => {
  const file = join(scratch, 'store-wipe.json');
  const store = new SessionStore(file);
  store.trustDevice('token-1', 'iPhone');
  store.trustDevice('token-2', 'iPad');
  store.rememberProviderSession('sess', 'claude-code', 'provider-abc');

  const removed = store.forgetEverything();
  if (removed.devices !== 2) return `FAIL: reported ${removed.devices} devices, expected 2`;
  if (removed.providerSessions !== 1) return `FAIL: reported ${removed.providerSessions} sessions`;
  if (store.trustedKeys().length !== 0) return 'FAIL: a device survived the wipe';
  if (store.providerSession('sess', 'claude-code')) return 'FAIL: a session survived the wipe';

  // And it must stay gone across a restart, not merely be cleared in memory.
  const reopened = new SessionStore(file);
  if (reopened.trustedKeys().length !== 0) return 'FAIL: devices came back after a restart';
  return `reported ${removed.devices} devices and ${removed.providerSessions} conversation, and none returned`;
});

check('a wiped activity log reports how much it removed', () => {
  const file = join(scratch, 'activity-wipe.json');
  const log = new ActivityLog(file, 300);
  log.record('run.started', 'one');
  log.record('run.completed', 'two');
  const removed = log.clear();
  if (removed !== 2) return `FAIL: reported ${removed}, expected 2`;
  if (new ActivityLog(file, 300).recent(40).length !== 0) return 'FAIL: entries survived a restart';
  return 'reported 2 removed, and none came back';
});

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
