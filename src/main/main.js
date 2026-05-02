/* ============================================
   evzero/valorant — main process (overlay edition)
   ============================================
   Compact frameless always-on-top widget. Lives at a corner of the screen
   beside a borderless-windowed Valorant. Vanguard-safe by design — passive
   HTTP client only, no game process interaction whatsoever.

   Anti-cheat boundaries we do NOT cross:
     - No reading game memory
     - No DLL injection or hooking
     - No drawing inside the game's render context
     - No input simulation
     - No requirement to run as Administrator
     - No Riot client local API or lockfile
   The window is just a regular Electron window with `alwaysOnTop`. Same
   pattern Discord, Spotify, OBS, etc. use — Vanguard does not flag this.
   ============================================ */

const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, shell, ipcMain, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

const isDev = process.argv.includes('--dev');
const HOTKEY = 'CommandOrControl+Shift+V';

// Compact widget dimensions — chosen to sit comfortably beside a 1920x1080
// game without obscuring central content. Resizable so users can shrink
// further if they want a minimal HUD-style stack.
const WIN_W = 420;
const WIN_H = 680;
const WIN_MIN_W = 340;
const WIN_MIN_H = 480;

// HUD ("overlay") mode dimensions — tiny floating widget that sits at a corner
// of the screen during gameplay. Just a smaller window state; no game-process
// interaction, so Vanguard treats it identically to the full widget.
const HUD_W = 300;
const HUD_H = 150;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let isPinned = true; // alwaysOnTop default — toggle via tray or in-app
let isHud = false;   // overlay-HUD mode flag
// Cached "normal" geometry so we can restore it when leaving HUD mode.
let savedNormalBounds = null;

function iconPath(name) {
  const p = path.join(__dirname, '..', '..', 'assets', name);
  return fs.existsSync(p) ? p : null;
}

function defaultPosition() {
  // Snap to top-right of the primary work area on first launch.
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIN_W - 24,
    y: workArea.y + 80,
  };
}

function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const pos = defaultPosition();
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    minWidth: WIN_MIN_W,
    minHeight: WIN_MIN_H,
    x: pos.x,
    y: pos.y,
    backgroundColor: '#050507',
    title: 'evzero/valorant',
    icon: iconPath('icon.png'),
    frame: false,            // no native chrome — we draw our own titlebar
    titleBarStyle: 'hidden',
    transparent: false,      // opaque background keeps Windows resize smooth
    alwaysOnTop: isPinned,
    skipTaskbar: false,
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Use a sane window level — sits above normal apps but below screen savers
  // so we never float over critical OS UI.
  if (isPinned) mainWindow.setAlwaysOnTop(true, 'floating');

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

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

function setPinned(on) {
  isPinned = !!on;
  if (mainWindow) mainWindow.setAlwaysOnTop(isPinned, 'floating');
  tray?.setContextMenu(buildTrayMenu());
  return isPinned;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show widget', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: isPinned,
      click: (item) => setPinned(item.checked),
    },
    {
      label: 'Overlay HUD mode',
      type: 'checkbox',
      checked: isHud,
      click: (item) => setHudMode(item.checked),
    },
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
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(iconPath('tray.png') || '');
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('evzero/valorant');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);
}

// ---- IPC: tiny safe surface for the renderer ----------------------------

ipcMain.handle('evzero:get-version', () => app.getVersion());
ipcMain.handle('evzero:get-platform', () => process.platform);

ipcMain.handle('evzero:open-external', (_e, url) => {
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

// Custom-titlebar window controls.
ipcMain.handle('evzero:window-minimize',   () => mainWindow?.minimize());
ipcMain.handle('evzero:window-close',      () => mainWindow?.hide());
ipcMain.handle('evzero:window-toggle-pin', () => setPinned(!isPinned));
ipcMain.handle('evzero:window-get-pin',    () => isPinned);

// Overlay-HUD mode — shrinks the window to a compact 300x150 widget pinned
// to the top-right of the work area. Toggling back restores the previous
// geometry so the user's drag position is preserved.
function setHudMode(on) {
  isHud = !!on;
  if (!mainWindow) return isHud;
  if (isHud) {
    savedNormalBounds = mainWindow.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    mainWindow.setMinimumSize(220, 110);
    mainWindow.setBounds({
      x: workArea.x + workArea.width - HUD_W - 24,
      y: workArea.y + 24,
      width: HUD_W,
      height: HUD_H,
    }, true);
    if (!isPinned) setPinned(true); // HUD always wants always-on-top
  } else {
    mainWindow.setMinimumSize(WIN_MIN_W, WIN_MIN_H);
    if (savedNormalBounds) {
      mainWindow.setBounds(savedNormalBounds, true);
    } else {
      mainWindow.setSize(WIN_W, WIN_H, true);
    }
  }
  mainWindow.webContents.send('evzero:hud-changed', isHud);
  tray?.setContextMenu(buildTrayMenu());
  return isHud;
}

ipcMain.handle('evzero:hud-toggle', () => setHudMode(!isHud));
ipcMain.handle('evzero:hud-get',    () => isHud);

// Native OS notification — used when live mode detects a new match.
ipcMain.handle('evzero:notify', (_e, opts) => {
  if (!Notification.isSupported()) return false;
  const o = (opts && typeof opts === 'object') ? opts : {};
  // Strict whitelist of fields — never let the renderer drop in arbitrary
  // payload like file paths or actions.
  const n = new Notification({
    title: String(o.title || 'evzero').slice(0, 80),
    body:  String(o.body  || '').slice(0, 200),
    silent: false,
  });
  n.on('click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  n.show();
  return true;
});

ipcMain.handle('evzero:set-auto-launch', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  tray?.setContextMenu(buildTrayMenu());
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('evzero:get-auto-launch', () => app.getLoginItemSettings().openAtLogin);

// ---- App lifecycle ------------------------------------------------------

app.on('second-instance', () => {
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
  if (!isQuitting) e.preventDefault();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
