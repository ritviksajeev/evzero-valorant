/* ============================================
   evzero/valorant — preload bridge
   ============================================
   Exposes a tiny, validated API to the renderer via contextBridge. The
   renderer has NO direct access to Node, fs, child_process, ipc, or any
   other privileged surface. Anything the renderer can do via window.evzero.*
   is what the main process explicitly handles in main.js.
   ============================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evzero', {
  // Metadata
  getVersion:  () => ipcRenderer.invoke('evzero:get-version'),
  getPlatform: () => ipcRenderer.invoke('evzero:get-platform'),

  // External link opener (whitelisted host check happens main-side)
  openExternal: (url) => ipcRenderer.invoke('evzero:open-external', url),

  // Window controls — drive the custom titlebar
  windowMinimize:  () => ipcRenderer.invoke('evzero:window-minimize'),
  windowClose:     () => ipcRenderer.invoke('evzero:window-close'),
  windowTogglePin: () => ipcRenderer.invoke('evzero:window-toggle-pin'),
  windowGetPin:    () => ipcRenderer.invoke('evzero:window-get-pin'),

  // Overlay-HUD mode (compact 300x150 widget)
  hudToggle: () => ipcRenderer.invoke('evzero:hud-toggle'),
  hudGet:    () => ipcRenderer.invoke('evzero:hud-get'),
  // Listener for hud-mode changes triggered from outside the renderer (tray menu).
  onHudChanged: (cb) => {
    const handler = (_e, on) => cb(!!on);
    ipcRenderer.on('evzero:hud-changed', handler);
    return () => ipcRenderer.removeListener('evzero:hud-changed', handler);
  },

  // Native OS notification — used when live mode detects a new match.
  notify: (opts) => ipcRenderer.invoke('evzero:notify', opts),

  // Auto-launch toggle
  getAutoLaunch: () => ipcRenderer.invoke('evzero:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('evzero:set-auto-launch', enabled),

  // Marker so the renderer knows it's running inside Electron rather than a
  // browser tab. Same source files can be shared with the website later.
  isDesktop: true,
});
