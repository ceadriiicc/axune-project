import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import type { AgentEvent } from '@axune/protocol';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';

import { AxuneServer } from '../src/core/AxuneServer';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  type DesktopSettings,
} from '../src/core/desktopSettings';
import { PairingManager, lanAddress } from '../src/core/PairingManager';
import { FOLDER_MISSING, NOT_A_REPO, isRepoBranch, projectReadable } from '../src/core/projectProbe';
import { AXUNE_PORT, listenOnKnownPort } from '../src/core/port';

const execFileAsync = promisify(execFile);

/**
 * Axune Desktop.
 *
 * The window is deliberately thin: every capability it exposes already existed
 * and was tested headlessly before this file was written, so a bug here is a
 * display bug rather than a broken product. The desktop's real job is to be the
 * thing that holds the repository and the agents — the UI just makes it
 * possible to pick a project and see what is happening without a terminal.
 *
 * ## Why it now lives in the tray
 *
 * Closing the window used to quit the app, which stopped the server, which
 * dropped the phone. That is correct behaviour for a tool you run while you
 * watch it and wrong for the thing the phone talks to: Axune is only useful
 * when it is already running, because the whole point is checking on a run from
 * somewhere else. So the window closes to the tray and only the tray's Quit
 * actually stops the server — with the phone told, rather than simply dropped.
 */
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: AxuneServer | null = null;
let pairing: PairingManager | null = null;
let projectPath = process.cwd();
/**
 * The port actually bound, which is not always the one we asked for.
 *
 * `new-code` previously issued a pairing payload containing `AXUNE_PORT`
 * regardless of what the server bound. If the well-known port was taken and the
 * fallback ran, that QR code carried an address nothing was listening on — and
 * the failure appeared on the phone, as a pairing that scanned fine and then
 * timed out.
 */
let boundPort = AXUNE_PORT;
/** Set only by the tray's Quit, so closing the window hides instead. */
let quitting = false;
let settings: DesktopSettings = { ...DEFAULT_SETTINGS };

function settingsFile(): string {
  return join(app.getPath('userData'), 'desktop-settings.json');
}

function loadSettings(): DesktopSettings {
  try {
    return parseSettings(readFileSync(settingsFile(), 'utf8'));
  } catch {
    // Missing on first run, which is not an error worth reporting.
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  try {
    writeFileSync(settingsFile(), serializeSettings(settings));
  } catch {
    // The choice still applies for this session. Failing to remember a
    // preference is not worth interrupting anyone over.
  }
}

/**
 * The branch, or a sentinel saying why there isn't one.
 *
 * A remembered project can disappear between launches - a folder renamed, a
 * USB drive unplugged, a network share not mounted yet after a reboot. That
 * used to report `(not a git repo)`, the same thing said about a perfectly
 * good folder that simply is not a repository, and the two need different
 * answers: one is a choice, the other means the project is gone.
 */
async function currentBranch(repo: string): Promise<string> {
  if (!projectReadable(repo)) return FOLDER_MISSING;
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim() || 'main';
  } catch {
    return NOT_A_REPO;
  }
}

function send(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

async function startServer(repo: string): Promise<void> {
  await server?.stop();

  projectPath = repo;
  settings.projectPath = repo;
  saveSettings();

  const branch = await currentBranch(repo);

  pairing = new PairingManager(10 * 60 * 1000);
  server = new AxuneServer(pairing, {
    name: basename(repo),
    path: repo,
    branch,
    // Checked against every sentinel rather than against one of them. This was
    // `branch !== '(not a git repo)'`, which would have called a folder that
    // does not exist a git repository the moment a second sentinel existed -
    // and `capability()` trusts this to decide whether writes are offered.
    isGitRepo: isRepoBranch(branch),
  });

  server.onEvent((event: AgentEvent) => send('agent-event', event));
  server.onConnectionChange((state: string) => send('connection', state));
  server.activityLog.onEvent((event) => send('activity', event));

  // Through the helper rather than binding directly. The well-known port is
  // routinely taken — by a harness, or by an Axune that has not finished
  // shutting down — and binding it directly threw, which killed startup on a
  // condition that is ordinary rather than exceptional.
  const bound = await listenOnKnownPort(server, AXUNE_PORT);
  boundPort = bound.port;

  const payload = pairing.issue(boundPort, basename(repo));

  send('ready', {
    project: { name: basename(repo), path: repo, branch },
    agents: await server.agentStatuses(),
    pairing: payload,
    address: `ws://${lanAddress()}:${boundPort}`,
    // Surfaced rather than swallowed: a phone paired to the usual port cannot
    // reach this one without rescanning, so silence here would look like the
    // phone being broken.
    portFallback: bound.wasPreferred ? null : boundPort,
    // The number the phone asks you to match after scanning.
    //
    // The phone has always shown three codes and asked which one the desktop
    // displays; the desktop has never displayed any of them. `DeviceIdentity`
    // has computed this all along and `tryTransport` asserts both ends derive
    // the same value - two things agreeing with each other while neither
    // reached the window. `npm run serve` prints it, which is why nobody
    // noticed.
    //
    // It is the worst possible thing to leave missing: a verification step you
    // cannot complete teaches people to tap any of the three to get past it,
    // which is precisely the check that catches a substituted desktop.
    fingerprint: server.identity.fingerprint,
  });

  // A remembered project that has since vanished is worth saying out loud
  // rather than leaving as a branch label nobody reads. The server keeps
  // running: the phone can still reach this desktop and pick another project,
  // which it could not do if startup refused.
  if (!projectReadable(repo)) {
    send(
      'error',
      `The project folder ${repo} is not there any more. Choose another with Change…`,
    );
  }
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Axune — ${basename(projectPath)}`, enabled: false },
      { type: 'separator' },
      { label: 'Show window', click: () => showWindow() },
      { label: 'Open project folder', click: () => void shell.openPath(projectPath) },
      { type: 'separator' },
      {
        label: 'Start Axune when I log in',
        type: 'checkbox',
        checked: settings.launchOnLogin,
        click: (item) => {
          settings.launchOnLogin = item.checked;
          saveSettings();
          applyLoginItem();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Axune',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.setToolTip(`Axune — ${basename(projectPath)}`);
}

function applyLoginItem(): void {
  // No-op in development: registering a login item that points at an Electron
  // binary inside node_modules would survive the checkout being deleted.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.launchOnLogin, openAsHidden: true });
}

function createTray(): void {
  // Built from the app icon rather than a separate asset, resized here because
  // a tray image must be small and macOS wants it at template size.
  const source = join(__dirname, '..', 'assets', 'tray.png');
  let image = nativeImage.createFromPath(source);
  if (image.isEmpty()) {
    // A missing icon must not take the tray with it — without a tray there is
    // no way to quit, and the app would have to be killed from Task Manager.
    image = nativeImage.createEmpty();
  } else {
    image = image.resize({ width: 16, height: 16 });
  }

  tray = new Tray(image);
  refreshTray();
  tray.on('click', () => showWindow());
}

function showWindow(): void {
  if (!window || window.isDestroyed()) {
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#11161d',
    title: 'Axune',
    autoHideMenuBar: true,
    webPreferences: {
      preload: `${__dirname}/preload.cjs`,
      // The renderer shows agent output, which is untrusted text. It gets no
      // Node access at all; everything it can do goes through named IPC.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void window.loadFile(`${__dirname}/../renderer/index.html`);

  // Closing hides. The server keeps running, because a phone that can only
  // reach a desktop with a window open is a phone that cannot be used from
  // another room, which is the entire product.
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
  });

  window.on('closed', () => {
    window = null;
  });
}

// One Axune per machine. Two would fight over the port, and the second would
// silently land on the fallback — so the phone would reach whichever won,
// which is not a coin toss anybody wants in a pairing.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    settings = loadSettings();
    // A remembered project, or the working directory on first run. `cwd` is
    // meaningless once this is launched from a shortcut rather than a terminal.
    projectPath = settings.projectPath ?? process.cwd();

    createWindow();
    createTray();
    applyLoginItem();

    await startServer(projectPath).catch((error) => send('error', String(error)));

    // The LAN address is printed in the QR and shown in the window, and it
    // changes when the machine wakes on a different network. Re-announcing it
    // costs nothing and stops the window quietly displaying an address that
    // stopped being true while the laptop was shut.
    powerMonitor.on('resume', () => {
      send('address', `ws://${lanAddress()}:${boundPort}`);
    });

    ipcMain.handle('choose-project', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Choose a project',
        properties: ['openDirectory'],
        defaultPath: projectPath,
      });
      if (result.canceled || !result.filePaths[0]) return null;
      await startServer(result.filePaths[0]);
      refreshTray();
      return result.filePaths[0];
    });

    /** A fresh pairing code, for when the previous one expired. */
    ipcMain.handle('new-code', async () => {
      if (!pairing || !server) return null;
      // The bound port, not the preferred one. These differ exactly when it
      // matters most, and the difference used to reach the phone as a QR code
      // that scanned perfectly and then timed out.
      return pairing.issue(boundPort, basename(projectPath));
    });

    ipcMain.handle('open-project', () => shell.openPath(projectPath));
  });
}

app.on('before-quit', () => {
  quitting = true;
});

// Deliberately empty of `app.quit()`. On every platform Axune keeps running in
// the tray when its window closes; quitting is the tray's job alone.
app.on('window-all-closed', () => undefined);

app.on('quit', () => {
  void server?.stop();
});
