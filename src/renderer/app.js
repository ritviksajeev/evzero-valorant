/* ============================================
   evzero desktop renderer
   ============================================
   The shell UI for v0.1: shows a hero, an "Open tracker" button that loads
   the live evzero.org/valorant tracker inside a sandboxed iframe, and a
   couple of safe settings. v0.2 will inline the tracker renderer so it works
   fully offline (no iframe, no network dependency for the UI shell).

   This file only uses the small `window.evzero.*` bridge exposed by
   preload.js. No Node, no fs, no ipc directly.
   ============================================ */

(function () {
  'use strict';

  // ---- DOM refs -------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const versionEl = $('version');
  const platformEl = $('platform');
  const openTrackerBtn = $('open-tracker');
  const openWebBtn = $('open-web');
  const trackerPanel = $('tracker-panel');
  const trackerFrame = $('tracker-frame');
  const trackerClose = $('tracker-close');
  const autoLaunchEl = $('auto-launch');

  // ---- Bridge -> main process -----------------------------------------
  const evz = window.evzero || {};
  if (!evz.isDesktop) {
    console.warn('[evzero] preload bridge missing; running outside Electron?');
  }

  // Populate version + platform metadata.
  if (evz.getVersion) {
    evz.getVersion().then((v) => { versionEl.textContent = `v${v}`; });
  }
  if (evz.getPlatform) {
    evz.getPlatform().then((p) => { platformEl.textContent = p; });
  }

  // Auto-launch toggle reflects the current OS setting.
  if (evz.getAutoLaunch && evz.setAutoLaunch) {
    evz.getAutoLaunch().then((on) => { autoLaunchEl.checked = !!on; });
    autoLaunchEl.addEventListener('change', () => {
      evz.setAutoLaunch(autoLaunchEl.checked).then((actual) => {
        autoLaunchEl.checked = !!actual;
      });
    });
  } else {
    autoLaunchEl.disabled = true;
  }

  // ---- Tracker panel: load the hosted tracker in a sandboxed iframe ---
  // v0.2 will replace this with an inlined renderer (no network needed for
  // the UI shell, only for the API calls themselves).
  const TRACKER_URL = 'https://evzero.org/valorant/';

  function openTracker() {
    if (!trackerFrame.src) {
      trackerFrame.src = TRACKER_URL;
    }
    trackerPanel.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  function closeTracker() {
    trackerPanel.hidden = true;
    document.documentElement.style.overflow = '';
  }

  openTrackerBtn.addEventListener('click', openTracker);
  trackerClose.addEventListener('click', closeTracker);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !trackerPanel.hidden) closeTracker();
  });

  // ---- External link button -------------------------------------------
  openWebBtn.addEventListener('click', () => {
    if (evz.openExternal) {
      evz.openExternal('https://evzero.org/valorant/');
    } else {
      window.open('https://evzero.org/valorant/', '_blank');
    }
  });
})();
