import { contextBridge, ipcRenderer } from 'electron';
import type { NativeApi } from '../shared/format';

const api: NativeApi = {
  platform: process.platform,
  getLibrary: () => ipcRenderer.invoke('getLibrary'),
  chooseLibrary: () => ipcRenderer.invoke('chooseLibrary'),
  readSaves: (game) => ipcRenderer.invoke('readSaves', game),
  writeSave: (game, slot, json) => ipcRenderer.invoke('writeSave', game, slot, json),
  readPrefs: () => ipcRenderer.invoke('readPrefs'),
  writePrefs: (prefs) => ipcRenderer.invoke('writePrefs', prefs),
  setFullscreen: (on) => ipcRenderer.send('setFullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('isFullscreen'),
  quit: () => ipcRenderer.send('quit'),
  version: () => ipcRenderer.invoke('version'),
  importState: () => ipcRenderer.invoke('importState'),
  importPick: (kind) => ipcRenderer.invoke('importPick', kind),
  importClear: (kind) => ipcRenderer.invoke('importClear', kind),
  importStart: () => ipcRenderer.invoke('importStart'),
  importCancel: () => ipcRenderer.send('importCancel'),
  onImportProgress: (cb) => {
    ipcRenderer.removeAllListeners('importProgress');
    ipcRenderer.on('importProgress', (_e, p) => cb(p));
  },
};

contextBridge.exposeInMainWorld('dracula', api);
