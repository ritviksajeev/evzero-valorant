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
let crosshairOverlay = null; // Separate transparent click-through window
let tray = null;
let isQuitting = false;
let isPinned = true;     // alwaysOnTop default — toggle via tray or in-app
let isHud = false;       // overlay-HUD mode flag
let isClickThrough = false; // pass mouse events to whatever's underneath
// Cached "normal" geometry so we can restore it when leaving HUD mode.
let savedNormalBounds = null;

const HOTKEY_CLICK_THROUGH = 'CommandOrControl+Shift+L'; // L = "lock" mouse

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

  // 'screen-saver' is the highest practical level — keeps the widget above
  // borderless-windowed games. The 'floating' level can be eclipsed when the
  // game grabs DWM focus during fullscreen transitions, which manifested as
  // the widget randomly slipping behind Valorant.
  if (isPinned) mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Re-apply pin level whenever the window blurs/focuses — Windows clears the
  // "always on top" flag when the focused application changes (e.g. when you
  // alt-tab into the game). Re-applying on every transition keeps it stuck.
  const reapplyTopmost = () => {
    if (mainWindow && !mainWindow.isDestroyed() && isPinned) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  };
  mainWindow.on('blur',  reapplyTopmost);
  mainWindow.on('focus', reapplyTopmost);
  mainWindow.on('show',  reapplyTopmost);

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
    // Windows clears the always-on-top flag whenever a window is hidden and
    // restored — re-apply it explicitly so the hotkey toggle stays "pinned".
    if (isPinned) mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.focus();
  }
}

function setPinned(on) {
  isPinned = !!on;
  if (mainWindow) mainWindow.setAlwaysOnTop(isPinned, 'screen-saver');
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
    {
      label: 'Click-through (mouse passes through window)',
      type: 'checkbox',
      checked: isClickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: `Show / hide: ${HOTKEY.replace('CommandOrControl', 'Ctrl')}`, enabled: false },
    { label: `Click-through: ${HOTKEY_CLICK_THROUGH.replace('CommandOrControl', 'Ctrl')}`, enabled: false },
    { label: 'Open evzero.org', click: () => shell.openExternal('https://evzero.org/valorant/') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  // Prefer tray.png (32) and let nativeImage pick the @2x companion for HiDPI
  // automatically. addRepresentation isn't needed when both files exist with
  // the standard @2x suffix in the same directory.
  const trayPath = iconPath('tray.png') || iconPath('icon.png') || '';
  const icon = trayPath ? nativeImage.createFromPath(trayPath) : nativeImage.createEmpty();
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
  // Hide-then-show wraps the resize so Windows doesn't flash the snap-layout
  // size hint ("300×150") next to the cursor while the window changes shape.
  // Also passes animate=false to setBounds for the same reason.
  const wasVisible = mainWindow.isVisible();
  if (wasVisible) mainWindow.hide();
  if (isHud) {
    savedNormalBounds = mainWindow.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    mainWindow.setMinimumSize(220, 110);
    mainWindow.setBounds({
      x: workArea.x + workArea.width - HUD_W - 24,
      y: workArea.y + 24,
      width: HUD_W,
      height: HUD_H,
    }, false);
    if (!isPinned) setPinned(true); // HUD always wants always-on-top
  } else {
    mainWindow.setMinimumSize(WIN_MIN_W, WIN_MIN_H);
    if (savedNormalBounds) {
      mainWindow.setBounds(savedNormalBounds, false);
    } else {
      mainWindow.setSize(WIN_W, WIN_H, false);
    }
  }
  if (wasVisible) {
    mainWindow.show();
    if (isPinned) mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  mainWindow.webContents.send('evzero:hud-changed', isHud);
  tray?.setContextMenu(buildTrayMenu());
  return isHud;
}

ipcMain.handle('evzero:hud-toggle', () => setHudMode(!isHud));
ipcMain.handle('evzero:hud-get',    () => isHud);

// Click-through mode — when enabled, the whole window passes mouse events
// through to whatever's underneath. Useful when you have the widget pinned
// over the game and don't want stray clicks from gunfire registering on it.
// `forward: true` lets the page still receive mousemove (so hover effects
// still update) without intercepting clicks.
function setClickThrough(on) {
  isClickThrough = !!on;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
    mainWindow.webContents.send('evzero:click-through-changed', isClickThrough);
  }
  tray?.setContextMenu(buildTrayMenu());
  return isClickThrough;
}
ipcMain.handle('evzero:click-through-toggle', () => setClickThrough(!isClickThrough));
ipcMain.handle('evzero:click-through-get',    () => isClickThrough);

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

// ---- Crosshair overlay window -------------------------------------------
// A second BrowserWindow that's frameless, transparent, click-through, and
// pinned. Renders the user's crosshair preview in the centre of the screen.
// This is exactly the same Electron primitive Discord/OBS overlays use —
// nothing reads game memory, nothing injects, no input is intercepted.
// Click-through (`setIgnoreMouseEvents(true)`) means the window passes every
// click straight to the app under it, so it doesn't affect gameplay.

function createCrosshairOverlay() {
  if (crosshairOverlay && !crosshairOverlay.isDestroyed()) return crosshairOverlay;
  const { workArea } = screen.getPrimaryDisplay();
  crosshairOverlay = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    x: workArea.x,
    y: workArea.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  crosshairOverlay.setAlwaysOnTop(true, 'screen-saver');
  crosshairOverlay.setIgnoreMouseEvents(true, { forward: false });
  crosshairOverlay.loadFile(path.join(__dirname, '..', 'renderer', 'crosshair-overlay.html'));
  return crosshairOverlay;
}

ipcMain.handle('evzero:crosshair-overlay-show', (_e, payload) => {
  const w = createCrosshairOverlay();
  w.show();
  // Push the latest config to the overlay renderer.
  w.webContents.send('evzero:crosshair-config', payload || null);
  return true;
});
ipcMain.handle('evzero:crosshair-overlay-hide', () => {
  if (crosshairOverlay && !crosshairOverlay.isDestroyed()) crosshairOverlay.hide();
  return true;
});
ipcMain.handle('evzero:crosshair-overlay-update', (_e, payload) => {
  if (crosshairOverlay && !crosshairOverlay.isDestroyed()) {
    crosshairOverlay.webContents.send('evzero:crosshair-config', payload || null);
  }
  return true;
});
ipcMain.handle('evzero:crosshair-overlay-is-shown', () => {
  return !!(crosshairOverlay && !crosshairOverlay.isDestroyed() && crosshairOverlay.isVisible());
});

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
  // Click-through hotkey — must be a GLOBAL shortcut because the renderer
  // can't receive its own clicks once click-through is enabled.
  globalShortcut.register(HOTKEY_CLICK_THROUGH, () => setClickThrough(!isClickThrough));
});

app.on('window-all-closed', (e) => {
  if (!isQuitting) e.preventDefault();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
