import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only surface the renderer gets.
 *
 * It displays agent output, which is untrusted text, so it has no Node access
 * and no general IPC — just these named calls and event subscriptions.
 */
contextBridge.exposeInMainWorld('axune', {
  chooseProject: () => ipcRenderer.invoke('choose-project'),
  newCode: () => ipcRenderer.invoke('new-code'),
  openProject: () => ipcRenderer.invoke('open-project'),
  on: (channel: string, handler: (payload: unknown) => void) => {
    const allowed = ['ready', 'agent-event', 'connection', 'activity', 'error'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => handler(payload));
  },
});
