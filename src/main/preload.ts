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
};

contextBridge.exposeInMainWorld('dracula', api);
