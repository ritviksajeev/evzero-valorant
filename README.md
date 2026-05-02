# evzero/valorant

Compact frameless **overlay widget** for Valorant stats. Sits always-on-top in a corner of your screen, built to live alongside a borderless-windowed game session. Shares the [evzero.org/valorant](https://evzero.org/valorant/) backend.

## Status

**v0.2** — frameless overlay. 420×680 widget with custom titlebar, drag region, pinning, tray, global hotkey. Native search + match list talking directly to the proxy backend (no iframe).

## What it does

- Compact always-on-top widget, frameless and clean
- Search any Riot ID — name + tag + region
- Profile card with current rank, peak rank, last-played agent
- 10 most recent matches, one-line each, win/loss colour strip
- Lives in your system tray, summon with `Ctrl+Shift+V`
- Auto-restores the last player you looked up when reopened
- Pin/unpin always-on-top from the titlebar
- Optional launch at login
- Drag from anywhere in the titlebar; click outside hides to tray

## What it never does

This is the explicit non-goal list. None of these will ever be added.

- ❌ Read game memory
- ❌ DLL injection or any kind of hooking
- ❌ Draw inside the Valorant render context
- ❌ Simulate keyboard or mouse input
- ❌ Require Administrator privileges
- ❌ Use the Riot client local API or lockfile (gray-area, opt-out forever)

The widget is a regular Electron window with `alwaysOnTop`. Same pattern Discord/Spotify/OBS use — Vanguard does not flag this.

## Running locally

```bash
npm install
npm run dev   # opens with DevTools detached
npm start     # opens normally
```

## Packaging

```bash
npm run make:win   # builds an NSIS installer in ./dist
```

## Architecture

```
src/
├─ main/
│  ├─ main.js     # window (frameless, alwaysOnTop), tray, hotkey, window-control IPC
│  └─ preload.js  # contextBridge → window.evzero.* (8 calls, validated host whitelist)
└─ renderer/
   ├─ index.html  # custom titlebar + compact widget UI
   ├─ styles.css  # overlay-tuned: small type, glass titlebar, compact cards
   └─ app.js      # search, profile render, match list — talks to the proxy directly
```

## Licence

MIT
