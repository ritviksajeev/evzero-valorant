# evzero/valorant

Compact frameless **overlay widget** for Valorant stats. Sits always-on-top alongside a borderless-windowed game session. Two layouts in one app: a **420×680 widget** for full info, a **300×150 HUD** for in-game glance. Shares the [evzero.org/valorant](https://evzero.org/valorant/) backend.

## Status

**v0.4** — view tabs, crosshair builder + overlay, "Your Riot ID" auto-load, bug fixes.

## Features

**Tabs** at the top of the widget switch between focused views — adds new ones over time without bloating any single panel.

**Tracker view**

Tracker mode (420×680, frameless, always-on-top)
- Profile card: PFP, name, rank, peak rank, recent agent
- Stats summary row: WR / KDA / ACS / HS%
- Mode filter: Comp / Unrated / DM / All — re-fetches the queue on switch
- Match list (12 most recent), one-line each, click any to expand the full 10-player scoreboard inline
- Saved players: pin a player → quick-search chip above the search row
- Live mode: polls every 30s, visible countdown, fresh-row pulse + native OS notification when a new match lands
- Settings popover (gear icon): pin, launch-at-login, notifications toggle, hotkey hint, version

**Crosshair view**

- Settings UI (color, outline, dot, inner lines, outer lines) with live SVG preview
- Generates a Valorant share-code string ready to paste into in-game settings
- Six built-in presets (Default / Dot only / Tight plus / Open cross / tarik / TenZ)
- **Optional transparent overlay window** — toggleable click-through full-screen
  window that draws your crosshair at screen centre. Useful when you want to
  preview without alt-tabbing into the game. Same Electron primitive Discord
  uses for its overlay; Vanguard ignores it.

**Settings popover** (gear icon)

- "Your Riot ID" — set once, auto-loads on every launch (search bar still
  looks up other players)
- Always-on-top toggle
- Launch at login
- Notifications on new match

**Overlay HUD mode** (300×150, even more compact)
- Toggle from the titlebar HUD button (or tray menu)
- Just the essentials: rank icon, name, current rank, RR, last match result + KDA
- Drag to position; fits in any corner of a 1920×1080 game without obscuring the centre
- One-click back to widget mode

**Common**
- Custom titlebar with drag region, minimize, hide-to-tray, pin, HUD toggle, settings
- Lives in the system tray, summon with `Ctrl+Shift+V`
- Auto-restores last player on launch
- Single-instance — re-launch focuses the existing window

## What it never does

This is the explicit non-goal list. None of these will ever be added.

- ❌ Read game memory
- ❌ DLL injection or any kind of hooking
- ❌ Draw inside the Valorant render context
- ❌ Simulate keyboard or mouse input
- ❌ Require Administrator privileges
- ❌ Use the Riot client local API or lockfile

The widget — including HUD mode — is a regular Electron window with `alwaysOnTop`. Same pattern Discord/Spotify/OBS use. Vanguard treats it as ordinary window chrome and ignores it entirely.

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
│  ├─ main.js     # frameless window + HUD-mode resize, tray, hotkey,
│  │              # window-control IPC, native notifications
│  └─ preload.js  # contextBridge → window.evzero.* (12 calls, host whitelist)
└─ renderer/
   ├─ index.html  # widget UI + HUD shell + settings popover
   ├─ styles.css  # both layouts; body.hud activates the HUD shell rules
   └─ app.js      # search, profile + stats + matches, live mode, favs,
                  # mode filter, scoreboard expand, HUD reactivity
```

## Hotkeys

| Action | Default |
|---|---|
| Show / hide widget | `Ctrl+Shift+V` |
| Expand match row (when focused) | `Enter` / `Space` |

## Licence

MIT
