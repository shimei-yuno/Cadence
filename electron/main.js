const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const updater = require('./updater');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

// Where we remember which vault files are tracked (Electron's own
// per-OS app-data folder — NOT the vault files themselves).
const configPath = path.join(app.getPath('userData'), 'cadence-config.json');

function readConfig(){
  try{
    const cfg = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'));
    // migrate old single-file config (pre-multi-vault) into the new shape
    if(cfg.lastFile && !cfg.vaults){
      const id = genId();
      cfg.vaults = [{ id, path: cfg.lastFile }];
      cfg.activeVaultId = id;
      delete cfg.lastFile;
    }
    cfg.vaults = cfg.vaults || [];
    return cfg;
  }
  catch(e){ return { vaults: [], activeVaultId: null }; }
}
function writeConfig(cfg){
  try{ fsSync.writeFileSync(configPath, JSON.stringify(cfg)); }catch(e){}
  writeVaultList(cfg);
}

// Plain-text list of the task files the tabs are tracking (UTF-16, one path
// per line). The Windows uninstaller reads it to offer deleting those files —
// see build/installer.nsh. The folder is named explicitly (rather than using
// userData) so the installer always knows where to look.
function writeVaultList(cfg){
  try{
    const dir = path.join(app.getPath('appData'), 'Cadence');
    fsSync.mkdirSync(dir, { recursive: true });
    const lines = (cfg.vaults || []).map(v => v && v.path).filter(Boolean);
    const text = lines.length ? lines.join('\r\n') + '\r\n' : '';
    fsSync.writeFileSync(path.join(dir, 'vault-paths.txt'), Buffer.from(text, 'utf16le'));
  }catch(e){}
}
function genId(){ return Math.random().toString(36).slice(2,10); }

function trackVault(cfg, filePath, name){
  let v = cfg.vaults.find(v => v.path === filePath);
  if(!v){
    v = { id: genId(), path: filePath, name: name || path.basename(filePath) };
    cfg.vaults.push(v);
  }
  cfg.activeVaultId = v.id;
  writeConfig(cfg);
  return v;
}

function createWindow(){
  const win = new BrowserWindow({
    width: 900,
    height: 920,
    minWidth: 460,
    minHeight: 520,
    backgroundColor: '#1E2320',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
}

app.whenReady().then(()=>{
  createWindow();
  app.on('activate', ()=>{
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', ()=>{
  if(process.platform !== 'darwin') app.quit();
});

// ---------- IPC handlers ----------

// Everything the renderer needs on launch in one round trip: the tracked
// vault list, which one was last active, and that vault's current content.
ipcMain.handle('boot', async ()=>{
  const cfg = readConfig();
  writeVaultList(cfg);   // existing installs get the uninstaller's file list on first launch
  let content = null, error = null;
  const active = cfg.vaults.find(v => v.id === cfg.activeVaultId);
  if(active){
    try{ content = await fs.readFile(active.path, 'utf-8'); }
    catch(e){ error = 'missing'; }
  }
  return { vaults: cfg.vaults, activeVaultId: cfg.activeVaultId, content, error };
});

ipcMain.handle('get-vaults', async ()=>{
  const cfg = readConfig();
  return { vaults: cfg.vaults, activeVaultId: cfg.activeVaultId };
});

// Opens a file picker and adds the chosen file as a new (or existing) tab.
ipcMain.handle('open-file', async ()=>{
  const res = await dialog.showOpenDialog({
    title: 'Open Cadence vault file',
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }]
  });
  if(res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  const cfg = readConfig();
  const v = trackVault(cfg, filePath);
  return { id: v.id, path: filePath, name: v.name, content };
});

// Creates a brand-new file and adds it as a new tab.
ipcMain.handle('new-file', async ()=>{
  const res = await dialog.showSaveDialog({
    title: 'Create Cadence vault file',
    defaultPath: 'tasks.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if(res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, '# Cadence tasks\n\n', 'utf-8');
  const cfg = readConfig();
  const v = trackVault(cfg, res.filePath);
  return { id: v.id, path: v.path, name: v.name };
});

// Switches the active tab and returns that vault's current file content.
ipcMain.handle('switch-vault', async (evt, id)=>{
  const cfg = readConfig();
  const v = cfg.vaults.find(v => v.id === id);
  if(!v) return null;
  cfg.activeVaultId = id;
  writeConfig(cfg);
  try{
    const content = await fs.readFile(v.path, 'utf-8');
    return { id: v.id, path: v.path, name: v.name, content };
  }catch(e){
    return { id: v.id, path: v.path, name: v.name, error: 'missing' };
  }
});

// Removes a file from the tracked tab list (does NOT delete it on disk).
ipcMain.handle('close-vault', async (evt, id)=>{
  const cfg = readConfig();
  cfg.vaults = cfg.vaults.filter(v => v.id !== id);
  if(cfg.activeVaultId === id){
    cfg.activeVaultId = cfg.vaults.length ? cfg.vaults[0].id : null;
  }
  writeConfig(cfg);
  return { vaults: cfg.vaults, activeVaultId: cfg.activeVaultId };
});

ipcMain.handle('rename-vault', async (evt, id, name)=>{
  const cfg = readConfig();
  const v = cfg.vaults.find(v => v.id === id);
  if(v) v.name = name;
  writeConfig(cfg);
  return true;
});

// Persists a new tab order (drag-and-drop reordering in the tab bar).
// `orderedIds` is the full list of vault ids in their new order.
ipcMain.handle('reorder-vaults', async (evt, orderedIds)=>{
  const cfg = readConfig();
  const byId = new Map(cfg.vaults.map(v => [v.id, v]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  // Keep any vault the renderer didn't mention (shouldn't normally happen,
  // but avoids silently dropping a tab if the lists ever get out of sync).
  for(const v of cfg.vaults){ if(!orderedIds.includes(v.id)) reordered.push(v); }
  cfg.vaults = reordered;
  writeConfig(cfg);
  return true;
});

// Removes a file from the tracked tab list AND deletes it from disk.
// (close-vault above only untracks it — this is the destructive variant,
// used by the tab's right-click "Delete file" option.)
ipcMain.handle('delete-vault-file', async (evt, id)=>{
  const cfg = readConfig();
  const v = cfg.vaults.find(v => v.id === id);
  if(!v) return null;
  try{ await fs.unlink(v.path); }
  catch(e){ /* already gone on disk — still untrack it below */ }
  cfg.vaults = cfg.vaults.filter(v => v.id !== id);
  if(cfg.activeVaultId === id){
    cfg.activeVaultId = cfg.vaults.length ? cfg.vaults[0].id : null;
  }
  writeConfig(cfg);
  return { vaults: cfg.vaults, activeVaultId: cfg.activeVaultId };
});

ipcMain.handle('write-file', async (evt, filePath, content)=>{
  await fs.writeFile(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('read-file', async (evt, filePath)=>{
  return fs.readFile(filePath, 'utf-8');
});

// Update checker (see updater.js)
updater.register();
