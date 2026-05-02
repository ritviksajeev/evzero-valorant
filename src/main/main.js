/* ============================================
   evzero desktop — main process
   ============================================
   Responsibilities:
     - Single window lifecycle (no game overlay, ever)
     - System tray icon + menu
     - Global hotkey to summon/hide window
     - Optional auto-launch on login

   Anti-cheat boundaries we do NOT cross:
     - No reading game memory
     - No DLL injection
     - No input simulation
     - No drawing over the Valorant window
     - No requirement to run as Administrator
   We are a passive HTTP client + tray-resident window. That's it.
   ============================================ */

const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Single-instance lock — second launch focuses the existing window instead of spawning.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

const isDev = process.argv.includes('--dev');
const HOTKEY = 'CommandOrControl+Shift+V';

let mainWindow = null;
let tray = null;
let isQuitting = false;

function iconPath(name) {
  // Falls back gracefully if the asset is missing (e.g. before icons are
  // generated). Electron will use a default icon in that case.
  const p = path.join(__dirname, '..', '..', 'assets', name);
  return fs.existsSync(p) ? p : null;
}

function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#050507', // matches website --bg-0
    title: 'evzero',
    icon: iconPath('icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // External links open in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing the window hides it to tray instead of quitting (until tray Quit).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function toggleWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show evzero', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: `Hotkey: ${HOTKEY.replace('CommandOrControl', 'Ctrl')}`, enabled: false },
    { label: 'Open evzero.org', click: () => shell.openExternal('https://evzero.org/valorant/') },
    { type: 'separator' },
    { label: 'Quit evzero', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  // Try a couple of icon sizes — Electron picks the closest match for the
  // tray DPI. If neither exists we let Electron use a placeholder.
  const icon = nativeImage.createFromPath(iconPath('tray.png') || '');
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('evzero — Valorant tracker');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);
}

// ---- IPC: tiny safe surface for the renderer ----------------------------
// The renderer can ASK for these things via window.evzero.*; the main process
// never trusts arbitrary data back. No filesystem writes from the renderer.

ipcMain.handle('evzero:get-version', () => app.getVersion());
ipcMain.handle('evzero:get-platform', () => process.platform);
ipcMain.handle('evzero:open-external', (_e, url) => {
  // Whitelist — only allow https urls to known hosts.
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (!/(^|\.)evzero\.org$|(^|\.)valorant-api\.com$|(^|\.)henrikdev\.xyz$|(^|\.)github\.com$/.test(u.hostname)) return false;
    shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

// Auto-launch toggle from renderer settings UI (later).
ipcMain.handle('evzero:set-auto-launch', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  tray?.setContextMenu(buildTrayMenu());
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('evzero:get-auto-launch', () => app.getLoginItemSettings().openAtLogin);

// ---- App lifecycle ------------------------------------------------------

app.on('second-instance', () => {
  // User tried to launch twice — focus the existing window.
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  globalShortcut.register(HOTKEY, toggleWindow);
});

app.on('window-all-closed', (e) => {
  // Stay alive in the tray on Windows/Linux; macOS apps usually stay alive too.
  // Only quit when isQuitting is set via tray.
  if (!isQuitting) e.preventDefault();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
