const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameSave', {
  write: (slot, envelopeJson) => ipcRenderer.invoke('save:write', slot, envelopeJson),
  read: (slot) => ipcRenderer.invoke('save:read', slot),
  list: () => ipcRenderer.invoke('save:list'),
  delete: (slot) => ipcRenderer.invoke('save:delete', slot),
  writeInternal: (slot, envelopeJson) => ipcRenderer.invoke('save:internal-write', slot, envelopeJson),
  readInternal: (slot) => ipcRenderer.invoke('save:internal-read', slot),
  deleteInternal: (slot) => ipcRenderer.invoke('save:internal-delete', slot),
  readProfile: () => ipcRenderer.invoke('profile:read'),
  writeProfile: (profile) => ipcRenderer.invoke('profile:write', profile),
  onExitSaveRequest: (callback) => {
    ipcRenderer.on('exit-save:request', () => {
      Promise.resolve(callback()).finally(() => {
        ipcRenderer.send('exit-save:done');
      });
    });
  },
});

// Sol requests stay in the Electron main process. No method ever returns the
// API key or accepts arbitrary URLs/request bodies from the renderer.
contextBridge.exposeInMainWorld('gameSol', {
  keyStatus: () => ipcRenderer.invoke('sol:key:status'),
  setKey: (key) => ipcRenderer.invoke('sol:key:set', key),
  clearKey: () => ipcRenderer.invoke('sol:key:clear'),
  requestAdvice: (payload) => ipcRenderer.invoke('sol:request', payload),
});
