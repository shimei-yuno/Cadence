const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cadenceBridge', {
  boot: () => ipcRenderer.invoke('boot'),
  getVaults: () => ipcRenderer.invoke('get-vaults'),
  openFile: () => ipcRenderer.invoke('open-file'),
  newFile: () => ipcRenderer.invoke('new-file'),
  switchVault: (id) => ipcRenderer.invoke('switch-vault', id),
  closeVault: (id) => ipcRenderer.invoke('close-vault', id),
  deleteVaultFile: (id) => ipcRenderer.invoke('delete-vault-file', id),
  renameVault: (id, name) => ipcRenderer.invoke('rename-vault', id, name),
  reorderVaults: (orderedIds) => ipcRenderer.invoke('reorder-vaults', orderedIds),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openUpdateUrl: (url) => ipcRenderer.invoke('open-update-url', url)
});
