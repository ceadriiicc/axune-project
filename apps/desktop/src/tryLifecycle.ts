/**
 * Proves the desktop can be launched by someone who is not a developer.
 *
 *   npm --prefix apps/desktop run try:lifecycle
 *
 * Everything here exists because the app stopped being something run from a
 * terminal in a checkout. Two assumptions were baked into that: that
 * `process.cwd()` means the project, and that the settings file is always
 * well-formed because nothing else writes it.
 *
 * The settings file is read during startup, before there is a window to show an
 * error in, so a damaged one must degrade rather than throw. An app that will
 * not open cannot be used to fix its own settings.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AxuneServer } from './core/AxuneServer';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from './core/desktopSettings';
import { DeviceIdentity } from './core/DeviceIdentity';
import { PairingManager } from './core/PairingManager';
import { SessionStore } from './core/SessionStore';

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

console.log('\nthe desktop survives its own settings file\n');

check('a first run has no project and adds nothing to startup', () => {
  const fresh = parseSettings(null);
  if (fresh.projectPath !== null) return `FAIL: invented a project: ${fresh.projectPath}`;
  // Software that puts itself in startup uninvited is software people
  // uninstall. The tray makes turning it on one click.
  if (fresh.launchOnLogin !== false) return 'FAIL: opted itself into launch on login';
  return 'no project, no login item';
});

check('a damaged file falls back rather than failing to start', () => {
  for (const raw of ['', '{', 'null', 'undefined', '[]', '[1,2]', '"a string"', '42', '{]']) {
    const parsed = parseSettings(raw);
    if (parsed.projectPath !== DEFAULT_SETTINGS.projectPath || parsed.launchOnLogin !== false) {
      return `FAIL: ${JSON.stringify(raw)} produced ${JSON.stringify(parsed)}`;
    }
  }
  return '9 malformed files all became the defaults';
});

check('one bad field does not discard the other', () => {
  // Someone whose launchOnLogin arrived as a string should not also lose the
  // project they had open - that is a settings file eating itself.
  const kept = parseSettings(JSON.stringify({ projectPath: 'C:/dev/axune', launchOnLogin: 'yes' }));
  if (kept.projectPath !== 'C:/dev/axune') return `FAIL: lost the project: ${kept.projectPath}`;
  if (kept.launchOnLogin !== false) return 'FAIL: a string was treated as true';

  const other = parseSettings(JSON.stringify({ projectPath: 42, launchOnLogin: true }));
  if (other.projectPath !== null) return `FAIL: a number became a path: ${other.projectPath}`;
  if (other.launchOnLogin !== true) return 'FAIL: lost a valid login preference';
  return 'each field survives the other being wrong';
});

check('an empty path is not a path', () => {
  // It would resolve to somewhere surprising rather than failing, which is the
  // worst shape of wrong: the app opens, on the wrong project, silently.
  for (const raw of ['', '   ', '\t']) {
    const parsed = parseSettings(JSON.stringify({ projectPath: raw }));
    if (parsed.projectPath !== null) return `FAIL: ${JSON.stringify(raw)} was kept as a path`;
  }
  return 'blank and whitespace paths fall back to the working directory';
});

check('launch on login is only ever an explicit true', () => {
  // Truthy values must not opt someone in. "false" and 0 are the ones that
  // would, under a looser check.
  for (const value of ['true', 1, 'on', {}, [], 'false', 0, null]) {
    const parsed = parseSettings(JSON.stringify({ launchOnLogin: value }));
    if (parsed.launchOnLogin !== false) return `FAIL: ${JSON.stringify(value)} opted in`;
  }
  if (parseSettings(JSON.stringify({ launchOnLogin: true })).launchOnLogin !== true) {
    return 'FAIL: an explicit true was ignored';
  }
  return '8 truthy and falsy values rejected; only boolean true opts in';
});

check('a round trip keeps both settings exactly', () => {
  const original = { projectPath: 'D:/work/thing', launchOnLogin: true };
  const back = parseSettings(serializeSettings(original));
  if (back.projectPath !== original.projectPath) return `FAIL: path became ${back.projectPath}`;
  if (back.launchOnLogin !== true) return 'FAIL: the login preference was lost';
  return 'both survive storage';
});

// ---- what a folder that is not a repository is promised ------------------

function serverFor(isGitRepo: boolean): AxuneServer {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new AxuneServer(
    new PairingManager(),
    { name: 'probe', path: tmpdir(), branch: isGitRepo ? 'main' : '(not a git repo)', isGitRepo },
    // Throwaway state, so a test never writes to the real desktop's devices.
    new SessionStore(join(tmpdir(), `axune-lifecycle-${stamp}.json`)),
    new DeviceIdentity(join(tmpdir(), `axune-lifecycle-id-${stamp}.json`)),
  );
}

check('a plain folder is not advertised as writable', () => {
  // A write run needs a worktree and a worktree needs a repository. `startRun`
  // already declined to create one for a plain folder - but `capability()`
  // returned 'read-write' regardless, so the phone offered a write toggle, the
  // run quietly went ahead read-only, and nothing said so. The guard was
  // right; the promise above it was not.
  const plain = serverFor(false).capability();
  if (plain !== 'read-only') return `FAIL: a non-repository claims ${plain}`;

  const repo = serverFor(true).capability();
  if (repo !== 'read-write') return `FAIL: a real repository claims ${repo}`;
  return 'read-only for a plain folder, read-write for a repository';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
