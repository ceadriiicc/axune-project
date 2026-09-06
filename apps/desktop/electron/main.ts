import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import type { AgentEvent } from '@axune/protocol';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import { AxuneServer } from '../src/core/AxuneServer';
import { PairingManager, lanAddress } from '../src/core/PairingManager';

const execFileAsync = promisify(execFile);
const PORT = 8790;

/**
 * Axune Desktop.
 *
 * The window is deliberately thin: every capability it exposes already existed
 * and was tested headlessly before this file was written, so a bug here is a
 * display bug rather than a broken product. The desktop's real job is to be the
 * thing that holds the repository and the agents — the UI just makes it
 * possible to pick a project and see what is happening without a terminal.
 */
let window: BrowserWindow | null = null;
let server: AxuneServer | null = null;
let pairing: PairingManager | null = null;
let projectPath = process.cwd();

async function currentBranch(repo: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim() || 'main';
  } catch {
    return '(not a git repo)';
  }
}

function send(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

async function startServer(repo: string): Promise<void> {
  await server?.stop();

  projectPath = repo;
  const branch = await currentBranch(repo);

  pairing = new PairingManager(10 * 60 * 1000);
  server = new AxuneServer(pairing, {
    name: basename(repo),
    path: repo,
    branch,
    isGitRepo: branch !== '(not a git repo)',
  });

  server.onEvent((event: AgentEvent) => send('agent-event', event));
  server.onConnectionChange((state: string) => send('connection', state));
  server.activityLog.onEvent((event) => send('activity', event));

  const port = await server.start(PORT);
  const payload = pairing.issue(port, basename(repo));

  send('ready', {
    project: { name: basename(repo), path: repo, branch },
    agents: await server.agentStatuses(),
    pairing: payload,
    address: `ws://${lanAddress()}:${port}`,
  });
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
  window.on('closed', () => {
    window = null;
  });
}

app.whenReady().then(async () => {
  createWindow();
  await startServer(projectPath).catch((error) => send('error', String(error)));

  ipcMain.handle('choose-project', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a project',
      properties: ['openDirectory'],
      defaultPath: projectPath,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await startServer(result.filePaths[0]);
    return result.filePaths[0];
  });

  /** A fresh pairing code, for when the previous one expired. */
  ipcMain.handle('new-code', async () => {
    if (!pairing || !server) return null;
    return pairing.issue(PORT, basename(projectPath));
  });

  ipcMain.handle('open-project', () => shell.openPath(projectPath));
});

app.on('window-all-closed', () => {
  void server?.stop();
  app.quit();
});
