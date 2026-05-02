# evzero desktop

Desktop companion for [evzero.org/valorant](https://evzero.org/valorant/) — Valorant tracker in a system-tray-resident window with a global hotkey.

## Status

**v0.1** — scaffold. Window + tray + hotkey + auto-launch. Tracker UI loads from the live website inside a sandboxed iframe.

## What it does

- Lookup any Riot ID using the same Henrik proxy as the website
- Lives in your system tray, summon with `Ctrl+Shift+V`
- Saved players + recent searches persist locally
- Native window — no browser tabs to lose
- Optional auto-launch on login

## What it never does

This is the explicit non-goal list. None of these will ever be added.

- ❌ Read game memory
- ❌ DLL injection or any kind of hooking
- ❌ Draw an overlay over the Valorant window
- ❌ Simulate keyboard or mouse input
- ❌ Require Administrator privileges
- ❌ Use the Riot client local API or lockfile (gray-area, opt-out forever)

The app is a passive HTTP client + tray-resident window. Nothing it does could plausibly conflict with Vanguard.

## Running locally

```bash
npm install
npm run dev      # opens with DevTools
npm start        # opens normally
```

## Packaging

```bash
npm run make:win # builds an NSIS installer in ./dist
```

## Architecture

```
src/
├─ main/
│  ├─ main.js     # Electron main process — window, tray, hotkey, IPC
│  └─ preload.js  # contextBridge — exposes `window.evzero.*` to renderer
└─ renderer/
   ├─ index.html  # shell UI
   ├─ styles.css  # reuses website palette and type system
   └─ app.js      # tracker panel + settings
```

## License

MIT
