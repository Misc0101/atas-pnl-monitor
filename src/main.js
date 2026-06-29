const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const DEFAULT_DATA_FILE = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'ATAS', 'Database', 'HistoryMyTrade.cdb'
);

let dataFile  = DEFAULT_DATA_FILE;
let win       = null;
let watcher   = null;
let pollTimer = null;
let lastMtime = null;
let debTimer  = null;
let cfgPath   = null;

function getCfgPath() {
  if (!cfgPath) cfgPath = path.join(app.getPath('userData'), 'config.json');
  return cfgPath;
}

function loadCfg() {
  try {
    const p = getCfgPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error('loadCfg:', e.message); }
  return {};
}

function saveCfg(cfg) {
  try { fs.writeFileSync(getCfgPath(), JSON.stringify(cfg, null, 2), 'utf8'); }
  catch (e) { console.error('saveCfg:', e.message); }
}

function isFiniteNum(v) {
  return Number.isFinite(v);
}

function titlebarPointOnScreen(x, y, w) {
  const cx = x + w / 2;
  const cy = y + 20;
  return screen.getAllDisplays().some(d => {
    const b = d.bounds;
    return cx >= b.x && cx < b.x + b.width &&
           cy >= b.y && cy < b.y + b.height;
  });
}

function centeredBounds(w, h) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + Math.max(0, (area.width - w) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - h) / 2))
  };
}

function safeWindowBounds(bounds, fallbackW, fallbackH, minW, minH) {
  const w = Math.max(minW, Math.round(isFiniteNum(bounds?.w) ? bounds.w : fallbackW));
  const h = Math.max(minH, Math.round(isFiniteNum(bounds?.h) ? bounds.h : fallbackH));
  const hasPos = isFiniteNum(bounds?.x) && isFiniteNum(bounds?.y);

  if (hasPos && titlebarPointOnScreen(bounds.x, bounds.y, w)) {
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), w, h };
  }

  return { ...centeredBounds(w, h), w, h };
}

function createWindow() {
  const cfg = loadCfg();
  const fl  = cfg.fullLayout;  // 上次完整界面的位置和尺寸

  // 恢复自定义数据文件路径
  if (cfg.dataFile) dataFile = cfg.dataFile;

  const safeFull = safeWindowBounds(fl, 1100, 800, 380, 280);
  const opts = {
    width:     safeFull.w,
    height:    safeFull.h,
    x:         safeFull.x,
    y:         safeFull.y,
    minWidth:  380, minHeight: 280,
    frame: false, backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  };

  win = new BrowserWindow(opts);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  startWatching();
}

function notifyChange() {
  if (win && !win.isDestroyed()) win.webContents.send('file-changed');
}

function schedNotify() {
  if (debTimer) clearTimeout(debTimer);
  debTimer = setTimeout(() => { debTimer = null; notifyChange(); }, 400);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    try {
      if (!fs.existsSync(dataFile)) return;
      const mtime = fs.statSync(dataFile).mtimeMs;
      if (lastMtime !== null && mtime !== lastMtime) schedNotify();
      lastMtime = mtime;
    } catch (_) {}
  }, 1500);
}

function startWatching() {
  if (watcher)   { try { watcher.close(); } catch (_) {} watcher = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  lastMtime = null;
  try {
    watcher = fs.watch(dataFile, { persistent: true }, (ev) => {
      if (ev === 'change' || ev === 'rename') schedNotify();
    });
    watcher.on('error', () => {
      if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
      startPolling();
    });
  } catch (_) { startPolling(); }
}

// ── IPC ─────────────────────────────────────────
ipcMain.handle('read-file', () => {
  try {
    if (!fs.existsSync(dataFile)) return { ok: false, err: 'File not found:\n' + dataFile };
    return { ok: true, data: fs.readFileSync(dataFile, 'utf8') };
  } catch (e) { return { ok: false, err: e.message }; }
});

ipcMain.handle('get-config', () => loadCfg());
ipcMain.handle('save-config', (_, cfg) => { saveCfg(cfg); return true; });

// 获取数据文件信息
ipcMain.handle('get-file-info', () => ({
  current:   dataFile,
  isDefault: dataFile === DEFAULT_DATA_FILE,
  defaultPath: DEFAULT_DATA_FILE
}));

// 打开系统文件选择对话框
ipcMain.handle('choose-file', async () => {
  if (!win || win.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(win, {
    title: '选择 ATAS 交易记录文件',
    filters: [
      { name: 'CDB 文件', extensions: ['cdb'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// 切换数据文件路径
ipcMain.handle('set-data-file', (_, newPath) => {
  dataFile = newPath || DEFAULT_DATA_FILE;
  const cfg = loadCfg();
  if (dataFile === DEFAULT_DATA_FILE) delete cfg.dataFile;
  else cfg.dataFile = dataFile;
  saveCfg(cfg);
  startWatching();
  notifyChange();
  return true;
});

// 获取当前窗口的位置 + 尺寸
ipcMain.handle('win-get-bounds', () => {
  if (!win || win.isDestroyed()) return null;
  const b = win.getBounds();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});

// 设置窗口位置 + 尺寸（瞬跳）
ipcMain.on('win-set-bounds', (_, bounds) => {
  if (!win || win.isDestroyed()) return;
  const b = safeWindowBounds(bounds, 420, 320, 200, 150);
  win.setBounds({ x: b.x, y: b.y, width: b.w, height: b.h });
});

ipcMain.on('window-minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
ipcMain.on('window-close',    () => { if (win && !win.isDestroyed()) win.close(); });
ipcMain.on('window-set-top',  (_, f) => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!f); });

// ── Lifecycle ────────────────────────────────────
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (watcher)   { try { watcher.close(); } catch (_) {} }
  if (pollTimer) clearInterval(pollTimer);
  if (debTimer)  clearTimeout(debTimer);
  app.quit();
});
