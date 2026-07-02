const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameSave', {
  write: (slot, envelopeJson) => ipcRenderer.invoke('save:write', slot, envelopeJson),
  read: (slot) => ipcRenderer.invoke('save:read', slot),
  list: () => ipcRenderer.invoke('save:list'),
  delete: (slot) => ipcRenderer.invoke('save:delete', slot),
  onExitSaveRequest: (callback) => {
    ipcRenderer.on('exit-save:request', () => {
      Promise.resolve(callback()).finally(() => {
        ipcRenderer.send('exit-save:done');
      });
    });
  },
});
