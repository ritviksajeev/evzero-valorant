/* ============================================
   evzero/valorant — overlay renderer
   ============================================
   Compact native widget UI. Talks to the same Henrik proxy as the website
   (https://ev-production.up.railway.app/val/*) but renders a tighter view
   suited to a 420×680 always-on-top window — plus a 300×150 HUD overlay
   mode for in-game glance.

   Only uses the small `window.evzero.*` bridge exposed by preload.js.
   No Node, no fs, no ipc directly.
   ============================================ */

(function () {
  'use strict';

  // ---- Config --------------------------------------------------------
  const SERVER = 'https://ev-production.up.railway.app';
  const STORAGE_LAST    = 'evz-overlay-last';
  const STORAGE_REGION  = 'evz-overlay-region';
  const STORAGE_FAVS    = 'evz-overlay-favs';
  const STORAGE_MODE    = 'evz-overlay-mode';
  const STORAGE_NOTIFY  = 'evz-overlay-notify';
  const STORAGE_PRIMARY = 'evz-overlay-primary';   // {name, tag, region}
  const STORAGE_VIEW    = 'evz-overlay-view';      // 'tracker' | 'crosshair'
  const STORAGE_XH      = 'evz-overlay-xh';        // crosshair config

  const LIVE_INTERVAL_MS = 30_000;

  const AGENT_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : '';
  const CARD_PFP_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/playercards/${uuid}/smallart.png` : '';
  const TIER_TABLE = '03621f52-342b-cf4e-4f86-9350a49c6d04';
  const TIER_CDN = (tierId) =>
    (tierId == null) ? '' : `https://media.valorant-api.com/competitivetiers/${TIER_TABLE}/${tierId}/largeicon.png`;

  // ---- DOM refs -------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const form = $('search');
  const nameInput = $('name');
  const tagInput = $('tag');
  const regionSelect = $('region');
  const searchBtn = $('search-btn');
  const favBtn = $('fav-btn');
  const liveBtn = $('live-btn');
  const liveLabel = $('live-label');

  const statusEl = $('status');
  const statusText = statusEl.querySelector('.status-text');
  const liveCountdown = $('live-countdown');

  const profileEl = $('profile');
  const profilePfp = $('profile-pfp');
  const profileName = $('profile-name');
  const metaLevel = $('meta-level');
  const metaRegion = $('meta-region');
  const metaRecent = $('meta-recent');
  const metaRecentImg = $('meta-recent-img');
  const rankIcon = $('rank-icon');
  const rankTier = $('rank-tier');
  const rankRr = $('rank-rr');
  const peakIcon = $('peak-icon');
  const peakTier = $('peak-tier');
  const peakMeta = $('peak-meta');
  const statWr = $('stat-wr');
  const statKda = $('stat-kda');
  const statAcs = $('stat-acs');
  const statHs = $('stat-hs');

  const modesBar = $('modes');
  const matchesBlock = $('matches-block');
  const matchesList = $('matches-list');
  const matchesCount = $('matches-count');
  const sbOverlayBtn = $('sb-overlay-toggle');
  const sbOverlayLabel = $('sb-overlay-label');

  const favsWrap = $('favs');
  const favsList = $('favs-list');

  const tbSettings = $('tb-settings');
  const tbHud = $('tb-hud');
  const tbClickThrough = $('tb-clickthrough');
  const tbPin = $('tb-pin');
  const tbMin = $('tb-min');
  const tbClose = $('tb-close');
  const ctBanner = $('click-through-banner');
  const settingsPop = $('settings-pop');
  const setPin = $('set-pin');
  const setLaunch = $('set-launch');
  const setNotify = $('set-notify');
  const setVersion = $('set-version');
  const versionEl = $('version');
  const openWebBtn = $('open-web');

  // HUD shell
  const hudShell = $('hud-shell');
  const hudX = $('hud-x');
  const hudRankIcon = $('hud-rank-icon');
  const hudClickThroughBtn = $('hud-clickthrough');
  const hudName = $('hud-name');
  const hudRank = $('hud-rank');
  const hudRr = $('hud-rr');
  const hudLastResult = $('hud-last-result');
  const hudLastKda = $('hud-last-kda');

  const toastEl = $('toast');
  const toastTextEl = $('toast-text');

  // ---- Bridge --------------------------------------------------------
  const evz = window.evzero || {};

  // Wire metadata + persisted toggles via the bridge.
  if (evz.getVersion) {
    evz.getVersion().then((v) => { versionEl.textContent = `v${v}`; setVersion.textContent = `v${v}`; });
  }
  if (evz.windowGetPin) {
    evz.windowGetPin().then((on) => { tbPin.classList.toggle('active', !!on); setPin.checked = !!on; });
  }
  if (evz.getAutoLaunch) {
    evz.getAutoLaunch().then((on) => { setLaunch.checked = !!on; });
  }
  if (evz.hudGet) {
    evz.hudGet().then((on) => { applyHudUi(!!on); });
  }
  if (evz.onHudChanged) {
    evz.onHudChanged((on) => applyHudUi(!!on));
  }

  // Notification preference is purely client-side (the main process never
  // remembers it across launches).
  let notifyOn = (localStorage.getItem(STORAGE_NOTIFY) || '1') === '1';
  setNotify.checked = notifyOn;
  setNotify.addEventListener('change', () => {
    notifyOn = setNotify.checked;
    localStorage.setItem(STORAGE_NOTIFY, notifyOn ? '1' : '0');
  });

  setPin.addEventListener('change', async () => {
    const on = setPin.checked;
    await evz.windowTogglePin?.();
    // Re-sync from main in case the toggle didn't land where we expected.
    const actual = await evz.windowGetPin?.();
    setPin.checked = !!actual;
    tbPin.classList.toggle('active', !!actual);
  });
  setLaunch.addEventListener('change', async () => {
    const actual = await evz.setAutoLaunch?.(setLaunch.checked);
    setLaunch.checked = !!actual;
  });

  tbSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPop.hidden = !settingsPop.hidden;
    tbSettings.classList.toggle('active', !settingsPop.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!settingsPop.hidden && !settingsPop.contains(e.target) && e.target !== tbSettings && !tbSettings.contains(e.target)) {
      settingsPop.hidden = true;
      tbSettings.classList.remove('active');
    }
  });

  tbPin.addEventListener('click', async () => {
    const pinned = await evz.windowTogglePin?.();
    tbPin.classList.toggle('active', !!pinned);
    setPin.checked = !!pinned;
    toast(pinned ? 'Pinned on top' : 'Unpinned');
  });
  tbHud.addEventListener('click', async () => {
    await evz.hudToggle?.();
  });
  tbClickThrough.addEventListener('click', async () => {
    await evz.clickThroughToggle?.();
  });
  // Same toggle from inside the HUD shell so users in HUD mode aren't
  // forced back to the global hotkey.
  if (hudClickThroughBtn) {
    hudClickThroughBtn.addEventListener('click', async () => {
      await evz.clickThroughToggle?.();
    });
  }
  // The main process emits this whenever click-through changes — keep the
  // titlebar button + bottom banner in sync regardless of which control
  // (titlebar / hotkey / tray) the user used.
  if (evz.onClickThroughChanged) {
    evz.onClickThroughChanged((on) => {
      tbClickThrough.classList.toggle('active', on);
      hudClickThroughBtn?.classList.toggle('active', on);
      ctBanner.hidden = !on;
      if (on) toast('Click-through ON · Ctrl+Shift+L to disable');
    });
  }
  if (evz.clickThroughGet) {
    evz.clickThroughGet().then((on) => {
      tbClickThrough.classList.toggle('active', !!on);
      hudClickThroughBtn?.classList.toggle('active', !!on);
      ctBanner.hidden = !on;
    });
  }
  hudX.addEventListener('click', async () => {
    await evz.hudToggle?.();
  });
  tbMin.addEventListener('click', () => evz.windowMinimize?.());
  tbClose.addEventListener('click', () => evz.windowClose?.());
  openWebBtn.addEventListener('click', () => {
    evz.openExternal?.('https://evzero.org/valorant/');
  });

  function applyHudUi(on) {
    document.body.classList.toggle('hud', on);
    hudShell.hidden = !on;
    tbHud.classList.toggle('active', on);
  }

  // ---- Toast ---------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms = 1600) {
    if (document.body.classList.contains('hud')) return; // no toast in HUD
    toastTextEl.textContent = msg;
    toastEl.hidden = false;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { if (!toastEl.classList.contains('show')) toastEl.hidden = true; }, 250);
    }, ms);
  }

  function setStatus(kind, text) {
    statusEl.className = 'status ' + kind;
    statusText.textContent = text;
  }

  // ---- Utils ---------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function timeAgo(t) {
    const ms = typeof t === 'number' ? t : Date.parse(t);
    if (!ms || Number.isNaN(ms)) return '—';
    const d = (Date.now() - ms) / 1000;
    if (d < 60) return `${Math.floor(d)}s`;
    if (d < 3600) return `${Math.floor(d / 60)}m`;
    if (d < 86_400) return `${Math.floor(d / 3600)}h`;
    if (d < 604_800) return `${Math.floor(d / 86_400)}d`;
    return `${Math.floor(d / 604_800)}w`;
  }
  function fmtPct(n, d = 0) {
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(d)}%`;
  }
  function fmtNum(n, d = 0) {
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(d);
  }
  function matchStartMs(m) {
    const md = m && m.metadata || {};
    if (typeof md.game_start === 'number')   return md.game_start * 1000;
    if (typeof md.started_at === 'string')   return Date.parse(md.started_at) || 0;
    return 0;
  }
  function matchId(m) {
    const md = m && m.metadata || {};
    return md.matchid || md.match_id || md.game_id || String(matchStartMs(m) || '');
  }

  // ---- Proxy ---------------------------------------------------------
  async function proxy(path, params) {
    const qs = new URLSearchParams(params);
    let res;
    try {
      res = await fetch(`${SERVER}${path}?${qs}`);
    } catch {
      const err = new Error('Backend unreachable');
      err.status = 0;
      throw err;
    }
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const msg = (body && (body.error || body.errors?.[0]?.message)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---- Match helpers -------------------------------------------------
  function findSelf(match, puuid) {
    const players = match.players && (match.players.all_players || match.players);
    if (!Array.isArray(players)) return null;
    return players.find((p) => p && p.puuid === puuid) || null;
  }
  function matchResult(match, self) {
    if (!self || !match.teams) return 'unknown';
    const teams = Array.isArray(match.teams) ? match.teams : Object.values(match.teams);
    const myTeam = teams.find((t) =>
      String(t.team_id || t.team || '').toLowerCase() === String(self.team_id || self.team || '').toLowerCase()
    );
    if (!myTeam) return 'unknown';
    if (typeof myTeam.won === 'boolean') return myTeam.won ? 'win' : 'loss';
    const won = (myTeam.rounds && (myTeam.rounds.won ?? myTeam.rounds_won)) ?? myTeam.rounds_won;
    const lost = (myTeam.rounds && (myTeam.rounds.lost ?? myTeam.rounds_lost)) ?? myTeam.rounds_lost;
    if (won == null || lost == null) return 'unknown';
    if (won > lost) return 'win';
    if (won < lost) return 'loss';
    return 'draw';
  }
  function roundCount(match) {
    const teams = match.teams;
    if (!teams) return 0;
    const list = Array.isArray(teams) ? teams : Object.values(teams);
    let total = 0;
    for (const t of list) {
      total += (t.rounds?.won ?? t.rounds_won) || 0;
      total += (t.rounds?.lost ?? t.rounds_lost) || 0;
    }
    return total || (match.rounds && match.rounds.length) || 0;
  }
  function allPlayers(match) {
    const p = match && match.players;
    if (!p) return [];
    if (Array.isArray(p)) return p;
    if (Array.isArray(p.all_players)) return p.all_players;
    return [];
  }
  function resolvePlayerIdentity(p) {
    if (!p || typeof p !== 'object') return null;
    const trim = (v) => (typeof v === 'string' ? v.trim() : '');
    let name = trim(p.name) || trim(p.gameName) || trim(p.displayName);
    let tag  = trim(p.tag)  || trim(p.tagLine);
    if (!name && p.riot_id && typeof p.riot_id === 'object') {
      name = trim(p.riot_id.name) || trim(p.riot_id.gameName);
      tag  = tag || trim(p.riot_id.tag) || trim(p.riot_id.tagLine);
    }
    if (!name && typeof p.riot_id === 'string' && p.riot_id.includes('#')) {
      const [n, t] = p.riot_id.split('#');
      name = trim(n);
      tag  = tag || trim(t);
    }
    if (!name) return null;
    return { name, tag };
  }

  // ---- Per-match trend series ---------------------------------------
  // Returns parallel arrays (oldest first) with KDA / ACS / HS% per match.
  // Used by the sparkline renderer.
  function buildTrendSeries(matches, puuid) {
    const ordered = matches.slice().reverse(); // oldest left, newest right
    const kda = [], acs = [], hs = [];
    for (const m of ordered) {
      const self = findSelf(m, puuid);
      if (!self) continue;
      const s = self.stats || {};
      const k = s.kills || 0, d = s.deaths || 0, a = s.assists || 0;
      kda.push(d ? (k + a) / d : k + a);
      const rc = roundCount(m) || 1;
      acs.push(s.score ? s.score / rc : 0);
      const shots = (s.headshots || 0) + (s.bodyshots || 0) + (s.legshots || 0);
      hs.push(shots ? (s.headshots || 0) / shots : 0);
    }
    return { kda, acs, hs };
  }

  // Build an SVG polyline path (and a faint area fill) inside a 100x28 viewBox.
  // Caller writes the result into the pre-existing <svg> tag.
  function renderSparkline(svg, series, opts = {}) {
    if (!svg) return;
    if (!series || series.length < 2) {
      svg.innerHTML = '<text x="50" y="18" fill="rgba(255,255,255,0.25)" font-family="JetBrains Mono" font-size="8" text-anchor="middle">need 2+ matches</text>';
      return;
    }
    const W = 100, H = 28, PAD = 2;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = Math.max(max - min, 0.0001);
    const x = (i) => series.length === 1 ? W / 2 : (i / (series.length - 1)) * W;
    const y = (v) => PAD + (H - PAD * 2) * (1 - (v - min) / span);
    const points = series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    const area = `M 0,${H} ` +
      series.map((v, i) => `L ${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ') +
      ` L ${W},${H} Z`;

    const accent = opts.accent || '#a78bfa';
    const id = 'sg-' + Math.random().toString(36).slice(2, 8);
    svg.innerHTML = `
      <defs>
        <linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id})"/>
      <polyline points="${points}" fill="none" stroke="${accent}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${series.map((v, i) =>
        `<circle cx="${x(i).toFixed(2)}" cy="${y(v).toFixed(2)}" r="${i === series.length - 1 ? 1.6 : 0.9}" fill="${accent}" />`
      ).join('')}
    `;
  }

  function renderTrends(matches, puuid) {
    const wrap = document.getElementById('trends');
    if (!wrap) return;
    if (!matches || matches.length < 2) { wrap.hidden = true; return; }
    const series = buildTrendSeries(matches, puuid);
    wrap.hidden = false;
    renderSparkline(document.getElementById('trend-kda'), series.kda, { accent: '#a78bfa' });
    renderSparkline(document.getElementById('trend-acs'), series.acs, { accent: '#7ed99d' });
    renderSparkline(document.getElementById('trend-hs'),  series.hs,  { accent: '#f5b96a' });

    // Set a "delta vs first" hint on each label
    const meta = (cur, first, fmt, suffix = '') => {
      if (!Number.isFinite(cur) || !Number.isFinite(first)) return ['—', ''];
      const delta = cur - first;
      const cls = delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : '';
      const sign = delta >= 0 ? '+' : '';
      return [`${fmt(cur)}${suffix}  ${sign}${fmt(delta)}`, cls];
    };
    const last = (a) => a[a.length - 1];
    const first = (a) => a[0];

    const [kdaText, kdaCls] = meta(last(series.kda), first(series.kda), (n) => n.toFixed(2));
    const trendKdaMeta = document.getElementById('trend-kda-meta');
    trendKdaMeta.textContent = kdaText;
    trendKdaMeta.className = 'trend-meta ' + kdaCls;

    const [acsText, acsCls] = meta(last(series.acs), first(series.acs), (n) => Math.round(n).toString());
    const trendAcsMeta = document.getElementById('trend-acs-meta');
    trendAcsMeta.textContent = acsText;
    trendAcsMeta.className = 'trend-meta ' + acsCls;

    const [hsText, hsCls] = meta(last(series.hs), first(series.hs), (n) => (n * 100).toFixed(0), '%');
    const trendHsMeta = document.getElementById('trend-hs-meta');
    trendHsMeta.textContent = hsText;
    trendHsMeta.className = 'trend-meta ' + hsCls;
  }

  // ---- Aggregate stats over the match set ----------------------------
  function aggregate(matches, puuid) {
    let wins = 0, losses = 0, draws = 0;
    let k = 0, d = 0, a = 0;
    let hs = 0, bs = 0, ls = 0;
    let score = 0, rounds = 0;
    for (const m of matches) {
      const self = findSelf(m, puuid);
      if (!self) continue;
      const r = matchResult(m, self);
      if (r === 'win') wins++;
      else if (r === 'loss') losses++;
      else if (r === 'draw') draws++;
      const s = self.stats || {};
      k += s.kills || 0;
      d += s.deaths || 0;
      a += s.assists || 0;
      hs += s.headshots || 0;
      bs += s.bodyshots || 0;
      ls += s.legshots || 0;
      score += s.score || 0;
      rounds += roundCount(m);
    }
    const played = wins + losses + draws;
    const shots = hs + bs + ls;
    return {
      played, wins, losses,
      winrate: played ? wins / (wins + losses || played) : NaN,
      kda: d ? (k + a) / d : NaN,
      acs: rounds ? score / rounds : NaN,
      hsPct: shots ? hs / shots : NaN,
    };
  }

  // ---- Render --------------------------------------------------------
  function renderProfile(account, mmr, matches, fallbackName, fallbackTag) {
    const cardUuid = typeof account?.card === 'string' ? account.card : (account?.card?.id || '');
    const pfpUrl = cardUuid ? CARD_PFP_CDN(cardUuid) : '';
    if (pfpUrl) profilePfp.src = pfpUrl; else profilePfp.removeAttribute('src');

    const resolvedName = account?.name || fallbackName || '';
    const resolvedTag  = account?.tag  || fallbackTag  || '';
    profileName.textContent = `${resolvedName || '—'}${resolvedTag ? ` #${resolvedTag}` : ''}`;
    metaLevel.textContent = `Lvl ${account?.account_level ?? '—'}`;
    metaRegion.textContent = (account?.region || '—').toUpperCase();

    // Current rank
    const cur = mmr?.current;
    if (cur) {
      rankTier.textContent = cur.tier?.name || cur.currenttierpatched || 'Unranked';
      const rr = cur.rr ?? cur.ranking_in_tier ?? null;
      const last = cur.last_change ?? cur.mmr_change_to_last_game ?? null;
      rankRr.textContent = rr != null
        ? `${rr} RR${last != null ? `  ·  ${last >= 0 ? '+' : ''}${last}` : ''}`
        : '—';
      const icon = cur.images?.large || cur.images?.small || TIER_CDN(cur.tier?.id);
      if (icon) rankIcon.src = icon; else rankIcon.removeAttribute('src');
    } else {
      rankTier.textContent = 'Unranked';
      rankRr.textContent = '—';
      rankIcon.removeAttribute('src');
    }

    // Peak rank
    const peak = mmr?.peak;
    if (peak) {
      peakTier.textContent = peak.tier?.name || '—';
      const season = peak.season?.short || peak.season?.id || '';
      peakMeta.textContent = season ? `${String(season).toUpperCase()}  ·  Peak` : 'Peak';
      const icon = peak.images?.large || peak.images?.small || TIER_CDN(peak.tier?.id);
      if (icon) peakIcon.src = icon; else peakIcon.removeAttribute('src');
    } else {
      peakTier.textContent = '—';
      peakMeta.textContent = 'Peak';
      peakIcon.removeAttribute('src');
    }

    // Recent agent — image only with hover title
    const recent = Array.isArray(matches)
      ? matches.map((m) => ({ m, self: findSelf(m, account?.puuid) })).find((x) => x.self)
      : null;
    if (recent && recent.self) {
      const rid = (recent.self.agent && recent.self.agent.id) || recent.self.character_id || '';
      const rname = (recent.self.agent && recent.self.agent.name) || recent.self.character || '';
      if (rid) {
        metaRecentImg.src = AGENT_CDN(rid);
        metaRecentImg.title = rname || '';
        metaRecent.hidden = false;
      } else {
        metaRecent.hidden = true;
      }
    } else {
      metaRecent.hidden = true;
    }

    // Stats summary row
    const agg = aggregate(matches || [], account?.puuid);
    statWr.textContent  = Number.isFinite(agg.winrate) ? `${(agg.winrate * 100).toFixed(0)}%` : '—';
    statKda.textContent = Number.isFinite(agg.kda) ? agg.kda.toFixed(2) : '—';
    statAcs.textContent = Number.isFinite(agg.acs) ? Math.round(agg.acs) : '—';
    statHs.textContent  = Number.isFinite(agg.hsPct) ? `${(agg.hsPct * 100).toFixed(0)}%` : '—';

    profileEl.hidden = false;
    modesBar.hidden = false;

    // HUD: also push current state into the HUD shell so it's ready when toggled.
    hudName.textContent = `${resolvedName || '—'}${resolvedTag ? `#${resolvedTag}` : ''}`;
    hudRank.textContent = rankTier.textContent;
    hudRr.textContent = rankRr.textContent;
    if (rankIcon.getAttribute('src')) hudRankIcon.src = rankIcon.src; else hudRankIcon.removeAttribute('src');

    if (recent) {
      const r = matchResult(recent.m, recent.self);
      const s = recent.self.stats || {};
      hudLastResult.textContent = r === 'win' ? 'WIN' : r === 'loss' ? 'LOSS' : '—';
      hudLastResult.className = 'hud-last-result ' + (r === 'win' ? 'win' : r === 'loss' ? 'loss' : '');
      hudLastKda.textContent = `${s.kills ?? 0}/${s.deaths ?? 0}/${s.assists ?? 0}`;
    } else {
      hudLastResult.textContent = '—';
      hudLastResult.className = 'hud-last-result';
      hudLastKda.textContent = '—';
    }
  }

  // Serialise the most-recent match into the compact payload the scoreboard
  // overlay renderer expects. Keeping this small/explicit keeps the IPC
  // surface tight — only the strings we display, no nested raw objects.
  function buildScoreboardPayload(matches, puuid) {
    if (!matches || !matches.length) return null;
    const m = matches[0];
    const players = allPlayers(m);
    if (!players.length) return null;
    const totalRounds = roundCount(m) || 1;
    const teams = Array.isArray(m.teams) ? m.teams : (m.teams ? Object.values(m.teams) : []);
    const self = findSelf(m, puuid);
    const selfResult = self ? matchResult(m, self) : 'unknown';

    // Group players by team_id.
    const groups = new Map();
    for (const p of players) {
      const key = String(p.team_id || p.team || 'unknown').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const myTeam = self ? String(self.team_id || self.team || '').toLowerCase() : '';

    const teamObjs = [...groups.entries()].map(([key, ps]) => {
      ps.sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0));
      const teamMeta = teams.find((t) =>
        String(t.team_id || t.team || '').toLowerCase() === key
      );
      const score = (teamMeta && (teamMeta.rounds?.won ?? teamMeta.rounds_won)) ?? null;
      const won = teamMeta && typeof teamMeta.won === 'boolean' ? teamMeta.won : null;
      const rows = ps.map((p, i) => {
        const id = resolvePlayerIdentity(p);
        const aname = (p.agent && p.agent.name) || p.character || '';
        const isSelf = p.puuid === puuid;
        const fallback = !id && isSelf && lastCtx?.name
          ? null   // self uses lastCtx fallback below
          : (aname ? `${aname} player` : `Player ${i + 1}`);
        const finalName = id?.name || (isSelf && lastCtx?.name ? lastCtx.name : '');
        const finalTag  = id?.tag  || (isSelf && lastCtx?.tag  ? lastCtx.tag  : '');
        const s = p.stats || {};
        const acs = s.score && totalRounds ? Math.round(s.score / totalRounds) : null;
        return {
          self: isSelf,
          name: finalName,
          tag: finalTag,
          fallback,
          agentId: (p.agent && p.agent.id) || p.character_id || '',
          k: s.kills ?? 0,
          d: s.deaths ?? 0,
          a: s.assists ?? 0,
          acs,
        };
      });
      return {
        label: key.toUpperCase(),
        won,
        score,
        rows,
      };
    });
    // Self team first
    teamObjs.sort((a, b) => {
      if (a.label.toLowerCase() === myTeam) return -1;
      if (b.label.toLowerCase() === myTeam) return 1;
      return 0;
    });

    return {
      map: (m.metadata && (m.metadata.map?.name || m.metadata.map)) || 'Unknown',
      mode: (m.metadata && (m.metadata.queue?.name || m.metadata.queue || m.metadata.mode)) || '',
      selfResult,
      teams: teamObjs,
    };
  }

  function refreshScoreboardOverlay(matches, puuid) {
    const payload = buildScoreboardPayload(matches, puuid);
    try { localStorage.setItem('evz-overlay-scoreboard', JSON.stringify(payload || null)); } catch {}
    evz.scoreboardOverlayUpdate?.(payload);
  }

  // Sync the toggle button with the actual window state on launch and after
  // any toggle, so re-opening the app while the overlay is still visible
  // shows the correct active styling.
  let sbOverlayShown = false;
  function setSbOverlayBtn(on) {
    sbOverlayShown = on;
    sbOverlayBtn.classList.toggle('active', on);
    sbOverlayLabel.textContent = on ? 'Hide overlay' : 'Scoreboard overlay';
  }
  if (evz.scoreboardOverlayIsShown) {
    evz.scoreboardOverlayIsShown().then((on) => setSbOverlayBtn(!!on));
  }
  sbOverlayBtn.addEventListener('click', async () => {
    if (sbOverlayShown) {
      await evz.scoreboardOverlayHide?.();
      setSbOverlayBtn(false);
      toast('Scoreboard overlay hidden');
    } else {
      const payload = buildScoreboardPayload(
        lastCtx ? (window.__lastMatches || []) : [],
        lastCtx?.puuid
      );
      await evz.scoreboardOverlayShow?.(payload);
      setSbOverlayBtn(true);
      if (!lastCtx) toast('Search a player first to populate the overlay');
      else toast('Scoreboard overlay shown');
    }
  });

  function renderScoreboard(match, puuid) {
    const players = allPlayers(match);
    if (!players.length) return '<div class="match-empty">No scoreboard data.</div>';
    const totalRounds = roundCount(match) || 1;
    const allAnon = players.every((p) => !resolvePlayerIdentity(p));
    return players
      .slice()
      .sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0))
      .map((p, idx) => {
        const aid = (p.agent && p.agent.id) || p.character_id || '';
        const aname = (p.agent && p.agent.name) || p.character || '';
        const self = p.puuid === puuid;
        const s = p.stats || {};
        const acs = (s.score && totalRounds) ? Math.round(s.score / totalRounds) : null;
        let id = resolvePlayerIdentity(p);
        if (!id && self && lastCtx?.name) id = { name: lastCtx.name, tag: lastCtx.tag || '' };
        const nameHtml = id
          ? esc(id.name) + (id.tag ? ` <span class="anon">#${esc(id.tag)}</span>` : '')
          : `<span class="anon">${esc(aname || `Player ${idx + 1}`)}</span>`;
        return `
          <div class="match-row ${self ? 'self' : ''}">
            ${aid ? `<img src="${esc(AGENT_CDN(aid))}" alt="${esc(aname)}" title="${esc(aname)}"/>` : '<div></div>'}
            <div class="match-row-name">${nameHtml}</div>
            <div class="match-row-acs">${acs ?? '—'}</div>
            <div class="match-row-kda">${s.kills ?? 0}/${s.deaths ?? 0}/${s.assists ?? 0}</div>
          </div>
        `;
      })
      .join('') + (allAnon ? '<div class="match-empty" style="margin-top:6px;">Player names hidden by Riot for this match.</div>' : '');
  }

  function renderMatches(matches, puuid, freshIds = new Set()) {
    if (!matches.length) {
      matchesList.innerHTML = '<div class="match-empty">No recent matches.</div>';
      matchesCount.textContent = '0';
      matchesBlock.hidden = false;
      return;
    }
    matchesCount.textContent = String(matches.length);
    matchesList.innerHTML = matches.slice(0, 12).map((m, idx) => {
      const self = findSelf(m, puuid);
      if (!self) return '';
      const s = self.stats || {};
      const r = matchResult(m, self);
      const mapName = (m.metadata && (m.metadata.map?.name || m.metadata.map)) || 'Unknown';
      const started = m.metadata && (m.metadata.started_at || m.metadata.game_start_patched || m.metadata.game_start);
      const aid = (self.agent && self.agent.id) || self.character_id || '';
      const fresh = freshIds.has(matchId(m));
      return `
        <div class="match-wrap${fresh ? ' fresh' : ''}" data-result="${r}" data-idx="${idx}">
          <div class="match" tabindex="0" role="button" aria-expanded="false">
            <div class="match-strip"></div>
            ${aid ? `<img class="match-agent" src="${esc(AGENT_CDN(aid))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<div class="match-agent"></div>'}
            <div class="match-meta">
              <div class="match-map">${esc(mapName)}</div>
              <div class="match-sub">${timeAgo(started)} · ${r}</div>
            </div>
            <div class="match-kda">${s.kills ?? 0}<span class="sep">/</span>${s.deaths ?? 0}<span class="sep">/</span>${s.assists ?? 0}</div>
            <div class="match-chev">
              <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>
          <div class="match-details"><div class="match-details-inner"><div class="match-details-body" data-rendered="0"></div></div></div>
        </div>
      `;
    }).join('');
    matchesBlock.hidden = false;

    // Lazy scoreboard render on row expand
    matchesList.querySelectorAll('.match-wrap').forEach((wrap) => {
      const header = wrap.querySelector('.match');
      const body = wrap.querySelector('.match-details-body');
      const toggle = () => {
        const willOpen = !wrap.classList.contains('open');
        if (willOpen && body.dataset.rendered !== '1') {
          const i = Number(wrap.dataset.idx);
          body.innerHTML = renderScoreboard(matches[i], puuid);
          body.dataset.rendered = '1';
        }
        wrap.classList.toggle('open', willOpen);
        header.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      };
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  // ---- Favourites ----------------------------------------------------
  function readFavs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_FAVS) || '[]'); }
    catch { return []; }
  }
  function writeFavs(list) {
    try { localStorage.setItem(STORAGE_FAVS, JSON.stringify(list)); } catch { /* quota */ }
  }
  const favKey = (n, t) => `${n}#${t}`.toLowerCase();
  const isFav = (n, t) => readFavs().some((f) => favKey(f.name, f.tag) === favKey(n, t));
  function addFav(e) {
    const list = readFavs().filter((f) => favKey(f.name, f.tag) !== favKey(e.name, e.tag));
    list.unshift(e);
    writeFavs(list.slice(0, 6));
    renderFavs();
  }
  function removeFav(n, t) {
    writeFavs(readFavs().filter((f) => favKey(f.name, f.tag) !== favKey(n, t)));
    renderFavs();
  }
  function renderFavs() {
    const list = readFavs();
    if (!list.length) { favsWrap.hidden = true; favsList.innerHTML = ''; return; }
    favsWrap.hidden = false;
    favsList.innerHTML = list.map((f) => `
      <button type="button" class="fav-chip" data-name="${esc(f.name)}" data-tag="${esc(f.tag)}" data-region="${esc(f.region)}">
        <span>${esc(f.name)}</span>
        <span class="fav-chip-x" data-x="1" title="Remove">×</span>
      </button>
    `).join('');
  }
  favsList.addEventListener('click', (e) => {
    const chip = e.target.closest('.fav-chip');
    if (!chip) return;
    const name = chip.dataset.name, tag = chip.dataset.tag, region = chip.dataset.region;
    if (e.target.dataset.x) { removeFav(name, tag); return; }
    nameInput.value = name;
    tagInput.value = tag;
    if ([...regionSelect.options].some((o) => o.value === region)) regionSelect.value = region;
    runSearch(name, tag, region);
  });
  function refreshFavBtn() {
    if (!lastCtx) {
      favBtn.classList.remove('saved');
      return;
    }
    favBtn.classList.toggle('saved', isFav(lastCtx.name, lastCtx.tag));
  }
  favBtn.addEventListener('click', () => {
    if (!lastCtx) { toast('Search first'); return; }
    if (isFav(lastCtx.name, lastCtx.tag)) {
      removeFav(lastCtx.name, lastCtx.tag);
      toast('Removed');
    } else {
      addFav({ name: lastCtx.name, tag: lastCtx.tag, region: lastCtx.region });
      toast('Saved');
    }
    refreshFavBtn();
  });

  // ---- Mode filter ---------------------------------------------------
  let currentMode = localStorage.getItem(STORAGE_MODE) || 'competitive';
  function applyModeUi() {
    modesBar.querySelectorAll('.mode-pill').forEach((p) => {
      p.classList.toggle('active', (p.dataset.mode || '') === currentMode);
    });
  }
  modesBar.addEventListener('click', (e) => {
    const pill = e.target.closest('.mode-pill');
    if (!pill) return;
    const next = pill.dataset.mode || '';
    if (next === currentMode) return;
    currentMode = next;
    localStorage.setItem(STORAGE_MODE, currentMode);
    applyModeUi();
    if (lastCtx) {
      toast(`Loading ${pill.textContent.trim()}…`);
      runSearch(lastCtx.name, lastCtx.tag, lastCtx.region);
    } else {
      toast('Search first');
    }
  });
  applyModeUi();

  // ---- Search flow ---------------------------------------------------
  let inFlight = 0;
  let lastCtx = null;

  async function runSearch(name, tag, region, opts = {}) {
    const { silent = false, fromLive = false } = opts;
    const token = ++inFlight;
    if (!silent) {
      setStatus('loading', 'Fetching…');
      searchBtn.disabled = true;
    }

    try {
      let account;
      try {
        const accountRes = await proxy('/val/account', { name, tag });
        if (token !== inFlight) return;
        account = accountRes?.data;
        if (!account || !account.puuid) throw new Error('Not found');
      } catch (accErr) {
        const sameAsLast = lastCtx
          && lastCtx.name.toLowerCase() === name.toLowerCase()
          && lastCtx.tag.toLowerCase()  === tag.toLowerCase()
          && lastCtx.account;
        if (sameAsLast) {
          account = lastCtx.account;
        } else {
          throw accErr;
        }
      }

      const resolvedRegion = (account.region || region).toLowerCase();
      const matchParams = { region: resolvedRegion, platform: 'pc', name, tag, size: 12 };
      if (currentMode) matchParams.mode = currentMode;

      const [mmrRes, matchesRes] = await Promise.all([
        proxy('/val/mmr', { region: resolvedRegion, platform: 'pc', name, tag }).catch((e) => ({ __err: e })),
        proxy('/val/matches', matchParams).catch((e) => ({ __err: e })),
      ]);
      if (token !== inFlight) return;

      const mmr = mmrRes && !mmrRes.__err ? mmrRes.data : null;
      const matches = (matchesRes && !matchesRes.__err && Array.isArray(matchesRes.data)) ? matchesRes.data : [];

      // Detect new matches vs previous state for fresh animation + notification.
      const prevIds = fromLive && lastCtx ? lastCtx.matchIds : null;
      const freshIds = new Set();
      if (prevIds) {
        for (const m of matches) {
          const id = matchId(m);
          if (id && !prevIds.has(id)) freshIds.add(id);
        }
      }

      renderProfile(account, mmr, matches, name, tag);
      renderTrends(matches, account.puuid);
      renderMatches(matches, account.puuid, freshIds);
      // Stash so the scoreboard-overlay button can rebuild on demand.
      window.__lastMatches = matches;
      refreshScoreboardOverlay(matches, account.puuid);

      const ctxName = account.name || name;
      const ctxTag  = account.tag  || tag;
      lastCtx = {
        name: ctxName,
        tag: ctxTag,
        region: resolvedRegion,
        puuid: account.puuid,
        matchIds: new Set(matches.map(matchId).filter(Boolean)),
        account,
      };
      lastUpdatedAt = Date.now();
      refreshFavBtn();

      if (fromLive && freshIds.size > 0) {
        const newest = matches[0];
        const self = findSelf(newest, account.puuid);
        const r = matchResult(newest, self);
        const map = (newest.metadata && (newest.metadata.map?.name || newest.metadata.map)) || 'a match';
        const txt = `${r === 'win' ? 'WIN' : r === 'loss' ? 'LOSS' : 'Match'} on ${map}`;
        toast(`+${freshIds.size} new — ${txt}`);
        if (notifyOn) {
          evz.notify?.({ title: `evzero · ${ctxName}#${ctxTag}`, body: txt });
        }
      }

      if (!silent) setStatus('ok', `${ctxName}#${ctxTag}`);
      localStorage.setItem(STORAGE_LAST, `${ctxName}#${ctxTag}`);
      localStorage.setItem(STORAGE_REGION, resolvedRegion);
    } catch (err) {
      if (token !== inFlight) return;
      if (silent) {
        console.warn('[evz] silent refresh failed', err);
      } else {
        const msg = err.status === 0
          ? 'Backend unreachable'
          : err.status === 404
            ? 'Player not found'
            : err.status === 429
              ? 'Rate limited'
              : (err.message || 'Error');
        setStatus('error', msg);
      }
    } finally {
      if (token === inFlight) {
        if (!silent) searchBtn.disabled = false;
      }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const tag = tagInput.value.trim();
    const region = regionSelect.value;
    if (name.length < 3 || tag.length < 3) {
      setStatus('error', 'Enter Name#Tag');
      return;
    }
    runSearch(name, tag, region);
  });
  regionSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_REGION, regionSelect.value);
  });

  // ---- Live mode -----------------------------------------------------
  let liveMode = false;
  let livePollTimer = null;
  let liveCountdownTimer = null;
  let nextPollAt = 0;
  let lastUpdatedAt = 0;

  function refreshCountdown() {
    if (!liveMode) { liveCountdown.hidden = true; return; }
    const remaining = Math.max(0, Math.ceil((nextPollAt - Date.now()) / 1000));
    if (document.hidden) {
      liveCountdown.textContent = 'Live · paused';
    } else {
      liveCountdown.textContent = `Next in ${remaining}s`;
    }
    liveCountdown.hidden = false;
  }
  async function livePoll() {
    if (!liveMode || !lastCtx || document.hidden) return;
    nextPollAt = Date.now() + LIVE_INTERVAL_MS;
    refreshCountdown();
    await runSearch(lastCtx.name, lastCtx.tag, lastCtx.region, { silent: true, fromLive: true });
    refreshCountdown();
  }
  function setLive(on) {
    liveMode = !!on;
    clearInterval(livePollTimer);
    clearInterval(liveCountdownTimer);
    if (liveMode) {
      liveBtn.classList.add('active');
      liveLabel.textContent = 'Live';
      nextPollAt = Date.now() + LIVE_INTERVAL_MS;
      refreshCountdown();
      livePoll();
      livePollTimer = setInterval(livePoll, LIVE_INTERVAL_MS);
      liveCountdownTimer = setInterval(refreshCountdown, 1000);
      toast('Live ON · refreshing every 30s');
    } else {
      liveBtn.classList.remove('active');
      liveLabel.textContent = 'Live';
      liveCountdown.hidden = true;
      toast('Live OFF');
    }
  }
  liveBtn.addEventListener('click', () => {
    if (!lastCtx) { toast('Search first'); return; }
    setLive(!liveMode);
  });
  document.addEventListener('visibilitychange', () => {
    if (liveMode && !document.hidden) { livePoll(); refreshCountdown(); }
  });

  // ---- View tabs -----------------------------------------------------
  const tabsBar = document.getElementById('tabs');
  function setView(name) {
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.view === name)
    );
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('active', v.dataset.view === name)
    );
    localStorage.setItem(STORAGE_VIEW, name);
    if (name === 'crosshair') {
      // Make sure preview and code are up to date the first time we land here.
      renderCrosshair();
    }
  }
  tabsBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    setView(tab.dataset.view);
  });

  // Forget any previous maps cache — feature was removed.
  try { localStorage.removeItem('evz-maps-cache-v1'); } catch {}
  // Reset stored view if it's pointing at the removed maps tab.
  if (localStorage.getItem(STORAGE_VIEW) === 'maps') {
    localStorage.setItem(STORAGE_VIEW, 'tracker');
  }

  // ---- Primary account (auto-load on launch) -------------------------
  const setPrimaryName = document.getElementById('set-primary-name');
  const setPrimaryTag  = document.getElementById('set-primary-tag');
  const setPrimaryRegion = document.getElementById('set-primary-region');
  const setPrimarySave = document.getElementById('set-primary-save');

  function readPrimary() {
    try { return JSON.parse(localStorage.getItem(STORAGE_PRIMARY) || 'null'); }
    catch { return null; }
  }
  const primaryInit = readPrimary();
  if (primaryInit) {
    setPrimaryName.value = primaryInit.name || '';
    setPrimaryTag.value  = primaryInit.tag  || '';
    if ([...setPrimaryRegion.options].some((o) => o.value === primaryInit.region)) {
      setPrimaryRegion.value = primaryInit.region;
    }
  }
  setPrimarySave.addEventListener('click', () => {
    const n = setPrimaryName.value.trim();
    const t = setPrimaryTag.value.trim();
    const r = setPrimaryRegion.value;
    if (n.length < 3 || t.length < 3) { toast('Enter Name#Tag'); return; }
    localStorage.setItem(STORAGE_PRIMARY, JSON.stringify({ name: n, tag: t, region: r }));
    setPrimarySave.classList.add('saved');
    setPrimarySave.textContent = 'Saved ✓';
    setTimeout(() => {
      setPrimarySave.classList.remove('saved');
      setPrimarySave.textContent = 'Save as default';
    }, 1400);
    toast('Default account saved');
    // Pre-fill the search row with the primary so the user sees it loaded.
    nameInput.value = n;
    tagInput.value = t;
    if ([...regionSelect.options].some((o) => o.value === r)) regionSelect.value = r;
    runSearch(n, t, r);
  });

  // ---- Crosshair builder ---------------------------------------------
  // Single state object; UI inputs read into and write from this.
  // Generates a Valorant share-code in the standard format community has
  // reverse-engineered. Live SVG preview re-renders on every state change.
  const xhDefault = {
    color: '#FFFFFF',
    outline: true, outlineThick: 1, outlineOp: 0.5,
    dot: false, dotThick: 2, dotOp: 1,
    innerShow: true, innerThick: 2, innerLen: 6, innerOff: 3, innerOp: 1,
    outerShow: false, outerThick: 2, outerLen: 2, outerOff: 10, outerOp: 0.35,
    // Image-as-crosshair mode. When `imageUse` is on, the image (stored as a
    // base64 data URL so it survives reload + travels via IPC) replaces the
    // SVG shapes in both the in-app preview and the screen overlay. Doesn't
    // affect the Valorant share code — that stays driven by the SVG settings.
    imageUse: false,
    imageData: '',     // data:image/...;base64,...
    imageName: '',
    imageBytes: 0,
    imageSize: 32,     // rendered px
    imageOp: 1,
  };
  let xh = (() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_XH) || 'null');
      return stored ? Object.assign({}, xhDefault, stored) : { ...xhDefault };
    } catch { return { ...xhDefault }; }
  })();

  const xhPresets = {
    default: { ...xhDefault },
    dot: { ...xhDefault, innerShow: false, dot: true, dotThick: 3, dotOp: 1 },
    plus: { ...xhDefault, innerThick: 1, innerLen: 4, innerOff: 0, outline: false, dot: true, dotThick: 1 },
    open: { ...xhDefault, innerLen: 8, innerOff: 6 },
    tarik: { ...xhDefault, color: '#00FF00', innerThick: 1, innerLen: 4, innerOff: 2, outline: true, outlineThick: 1, outlineOp: 1, dot: false, outerShow: false },
    tenz: { ...xhDefault, color: '#00FFFF', innerThick: 1, innerLen: 6, innerOff: 3, outline: true, outlineThick: 1, outlineOp: 1, dot: true, dotThick: 1 },
  };

  // Wire each control to xh state
  function bindRange(id, key, fmt = (v) => Number(v).toString()) {
    const el = document.getElementById(id);
    const out = document.getElementById(id + '-val');
    el.value = xh[key];
    if (out) out.textContent = fmt(xh[key]);
    el.addEventListener('input', () => {
      xh[key] = parseFloat(el.value);
      if (out) out.textContent = fmt(xh[key]);
      onXhChange();
    });
  }
  function bindCheck(id, key) {
    const el = document.getElementById(id);
    el.checked = !!xh[key];
    el.addEventListener('change', () => { xh[key] = el.checked; onXhChange(); });
  }
  function bindColor(id, key) {
    const el = document.getElementById(id);
    el.value = xh[key];
    el.addEventListener('input', () => { xh[key] = el.value; onXhChange(); });
  }
  bindColor('xh-color', 'color');
  bindCheck('xh-outline', 'outline');
  bindRange('xh-outline-thick', 'outlineThick');
  bindRange('xh-outline-op',    'outlineOp', (v) => Number(v).toFixed(2));
  bindCheck('xh-dot', 'dot');
  bindRange('xh-dot-thick', 'dotThick');
  bindRange('xh-dot-op',    'dotOp', (v) => Number(v).toFixed(2));
  bindCheck('xh-inner-show', 'innerShow');
  bindRange('xh-inner-thick',  'innerThick');
  bindRange('xh-inner-length', 'innerLen');
  bindRange('xh-inner-offset', 'innerOff');
  bindRange('xh-inner-op',     'innerOp', (v) => Number(v).toFixed(2));
  bindCheck('xh-outer-show', 'outerShow');
  bindRange('xh-outer-thick',  'outerThick');
  bindRange('xh-outer-length', 'outerLen');
  bindRange('xh-outer-offset', 'outerOff');
  bindRange('xh-outer-op',     'outerOp', (v) => Number(v).toFixed(2));

  bindCheck('xh-image-use', 'imageUse');
  bindRange('xh-image-size', 'imageSize');
  bindRange('xh-image-op',   'imageOp', (v) => Number(v).toFixed(2));

  // ---- Image upload + persistence ------------------------------------
  // Max ~1 MB so it round-trips via localStorage (5 MB cap) and IPC without
  // pain. We refuse anything bigger and toast an error.
  const IMAGE_MAX_BYTES = 1024 * 1024;
  const xhImageDrop = document.getElementById('xh-image-drop');
  const xhImageFile = document.getElementById('xh-image-file');
  const xhImageDropEmpty = document.getElementById('xh-image-drop-empty');
  const xhImageDropLoaded = document.getElementById('xh-image-drop-loaded');
  const xhImageThumb = document.getElementById('xh-image-thumb');
  const xhImageName = document.getElementById('xh-image-name');
  const xhImageSizeInfo = document.getElementById('xh-image-size-info');
  const xhImageRemove = document.getElementById('xh-image-remove');

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function refreshImageDropUi() {
    const has = !!xh.imageData;
    xhImageDropEmpty.hidden = has;
    xhImageDropLoaded.hidden = !has;
    if (has) {
      xhImageThumb.src = xh.imageData;
      xhImageName.textContent = xh.imageName || 'image';
      xhImageSizeInfo.textContent = fmtBytes(xh.imageBytes || 0);
    }
  }
  function loadImageFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Not an image'); return; }
    if (file.size > IMAGE_MAX_BYTES) {
      toast(`Too large (${fmtBytes(file.size)}) · 1 MB max`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      xh.imageData = String(reader.result || '');
      xh.imageName = file.name;
      xh.imageBytes = file.size;
      // Auto-enable image mode when a file is loaded so it's instantly visible.
      xh.imageUse = true;
      document.getElementById('xh-image-use').checked = true;
      refreshImageDropUi();
      onXhChange();
      toast('Image loaded');
    };
    reader.onerror = () => toast('Failed to read file');
    reader.readAsDataURL(file);
  }
  // Click anywhere on the drop zone (when empty) opens the picker.
  xhImageDrop.addEventListener('click', (e) => {
    if (xh.imageData) return;
    xhImageFile.click();
  });
  xhImageFile.addEventListener('change', () => {
    const f = xhImageFile.files && xhImageFile.files[0];
    if (f) loadImageFile(f);
    xhImageFile.value = ''; // allow re-selecting the same file later
  });
  // Drag-and-drop straight into the zone.
  ['dragenter', 'dragover'].forEach((evt) =>
    xhImageDrop.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      xhImageDrop.classList.add('drag-over');
    })
  );
  ['dragleave', 'dragend', 'drop'].forEach((evt) =>
    xhImageDrop.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      xhImageDrop.classList.remove('drag-over');
    })
  );
  xhImageDrop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImageFile(f);
  });
  xhImageRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    xh.imageData = '';
    xh.imageName = '';
    xh.imageBytes = 0;
    xh.imageUse = false;
    document.getElementById('xh-image-use').checked = false;
    refreshImageDropUi();
    onXhChange();
    toast('Image removed');
  });
  refreshImageDropUi();

  // Crosshair category sub-tabs
  const xhCatTabs = document.getElementById('xh-cat-tabs');
  xhCatTabs.addEventListener('click', (e) => {
    const t = e.target.closest('.xh-cat-tab');
    if (!t) return;
    xhCatTabs.querySelectorAll('.xh-cat-tab').forEach((x) =>
      x.classList.toggle('active', x === t)
    );
    document.querySelectorAll('.xh-cat').forEach((c) => {
      c.hidden = (c.dataset.cat !== t.dataset.cat);
    });
  });

  // Presets
  document.getElementById('xh-presets').addEventListener('click', (e) => {
    const b = e.target.closest('.xh-preset');
    if (!b) return;
    xh = { ...xhPresets[b.dataset.preset] };
    syncControlsFromState();
    onXhChange();
    toast(`Preset: ${b.textContent.trim()}`);
  });

  function syncControlsFromState() {
    document.getElementById('xh-color').value = xh.color;
    document.getElementById('xh-outline').checked = !!xh.outline;
    document.getElementById('xh-outline-thick').value = xh.outlineThick;
    document.getElementById('xh-outline-thick-val').textContent = xh.outlineThick;
    document.getElementById('xh-outline-op').value = xh.outlineOp;
    document.getElementById('xh-outline-op-val').textContent = xh.outlineOp.toFixed(2);
    document.getElementById('xh-dot').checked = !!xh.dot;
    document.getElementById('xh-dot-thick').value = xh.dotThick;
    document.getElementById('xh-dot-thick-val').textContent = xh.dotThick;
    document.getElementById('xh-dot-op').value = xh.dotOp;
    document.getElementById('xh-dot-op-val').textContent = xh.dotOp.toFixed(2);
    document.getElementById('xh-inner-show').checked = !!xh.innerShow;
    document.getElementById('xh-inner-thick').value = xh.innerThick;
    document.getElementById('xh-inner-thick-val').textContent = xh.innerThick;
    document.getElementById('xh-inner-length').value = xh.innerLen;
    document.getElementById('xh-inner-length-val').textContent = xh.innerLen;
    document.getElementById('xh-inner-offset').value = xh.innerOff;
    document.getElementById('xh-inner-offset-val').textContent = xh.innerOff;
    document.getElementById('xh-inner-op').value = xh.innerOp;
    document.getElementById('xh-inner-op-val').textContent = xh.innerOp.toFixed(2);
    document.getElementById('xh-outer-show').checked = !!xh.outerShow;
    document.getElementById('xh-outer-thick').value = xh.outerThick;
    document.getElementById('xh-outer-thick-val').textContent = xh.outerThick;
    document.getElementById('xh-outer-length').value = xh.outerLen;
    document.getElementById('xh-outer-length-val').textContent = xh.outerLen;
    document.getElementById('xh-outer-offset').value = xh.outerOff;
    document.getElementById('xh-outer-offset-val').textContent = xh.outerOff;
    document.getElementById('xh-outer-op').value = xh.outerOp;
    document.getElementById('xh-outer-op-val').textContent = xh.outerOp.toFixed(2);
    document.getElementById('xh-image-use').checked = !!xh.imageUse;
    document.getElementById('xh-image-size').value = xh.imageSize;
    document.getElementById('xh-image-size-val').textContent = String(xh.imageSize);
    document.getElementById('xh-image-op').value = xh.imageOp;
    document.getElementById('xh-image-op-val').textContent = xh.imageOp.toFixed(2);
    refreshImageDropUi();
  }

  // Render the crosshair as an SVG. Coordinate space is centered at 0,0 with
  // ±100 viewBox; pixel sizes here scale relative to the preview area.
  // Image mode short-circuits the SVG-shape pass and renders an <image>.
  function renderCrosshair() {
    const svg = document.getElementById('xh-preview-svg');
    if (!svg) return;

    if (xh.imageUse && xh.imageData) {
      // SVG <image> centered at 0,0 with the user-chosen size + opacity.
      const sz = xh.imageSize;
      const half = sz / 2;
      svg.innerHTML = `<image href="${xh.imageData}" x="${-half}" y="${-half}" width="${sz}" height="${sz}" opacity="${xh.imageOp}" preserveAspectRatio="xMidYMid meet"/>`;
      return;
    }

    const out = [];
    const c = xh.color;
    const ot = xh.outlineThick;
    const op = xh.outlineOp;
    const drawLine = (x1, y1, x2, y2, thickness, opacity) => {
      // Outline pass first (thicker, semi-transparent black behind), then fill
      if (xh.outline && ot > 0) {
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${thickness + ot * 2}" stroke-opacity="${op}" stroke-linecap="square"/>`);
      }
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${thickness}" stroke-opacity="${opacity}" stroke-linecap="square"/>`);
    };

    if (xh.innerShow) {
      const t = xh.innerThick;
      const len = xh.innerLen;
      const off = xh.innerOff;
      const o = xh.innerOp;
      drawLine(-(off + len), 0, -off, 0, t, o);  // left
      drawLine(off, 0, off + len, 0, t, o);      // right
      drawLine(0, -(off + len), 0, -off, t, o);  // top
      drawLine(0, off, 0, off + len, t, o);      // bottom
    }
    if (xh.outerShow) {
      const t = xh.outerThick;
      const len = xh.outerLen;
      const off = xh.outerOff;
      const o = xh.outerOp;
      drawLine(-(off + len), 0, -off, 0, t, o);
      drawLine(off, 0, off + len, 0, t, o);
      drawLine(0, -(off + len), 0, -off, t, o);
      drawLine(0, off, 0, off + len, t, o);
    }
    if (xh.dot) {
      const r = xh.dotThick / 2;
      if (xh.outline && ot > 0) {
        out.push(`<rect x="${-r - ot}" y="${-r - ot}" width="${(r + ot) * 2}" height="${(r + ot) * 2}" fill="#000" fill-opacity="${op}"/>`);
      }
      out.push(`<rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" fill="${c}" fill-opacity="${xh.dotOp}"/>`);
    }
    svg.innerHTML = out.join('');
  }

  // Generate a Valorant share code from xh state.
  // Format pieces (community-known): primary profile prefix, then key-value
  // pairs separated by `;`. We emit only the keys that diverge from defaults
  // so the code stays compact (matches what in-game settings exports).
  function generateCode() {
    const colorHex = xh.color.replace('#', '').toUpperCase();
    // Valorant uses a custom-color code "u" with hex. "h;1" enables outline,
    // "0t/0l/0o/0a" inner, "1b" outer toggle, "d/dt/da" dot toggle/thickness/opacity
    const parts = ['0', 'P'];
    parts.push('c', '8');                      // 8 = custom
    parts.push('u', colorHex + 'FF');          // alpha appended
    parts.push('h', xh.outline ? '0' : '1');   // 0 = show outline, 1 = hide (Riot convention)
    parts.push('o', xh.outlineOp.toFixed(2));
    parts.push('t', String(xh.outlineThick));
    parts.push('d', xh.dot ? '1' : '0');
    if (xh.dot) {
      parts.push('z', String(xh.dotThick));
      parts.push('a', xh.dotOp.toFixed(2));
    }
    parts.push('0b', xh.innerShow ? '1' : '0');
    if (xh.innerShow) {
      parts.push('0t', String(xh.innerThick));
      parts.push('0l', String(xh.innerLen));
      parts.push('0o', String(xh.innerOff));
      parts.push('0a', xh.innerOp.toFixed(2));
      parts.push('0f', '0');
    }
    parts.push('1b', xh.outerShow ? '1' : '0');
    if (xh.outerShow) {
      parts.push('1t', String(xh.outerThick));
      parts.push('1l', String(xh.outerLen));
      parts.push('1o', String(xh.outerOff));
      parts.push('1a', xh.outerOp.toFixed(2));
      parts.push('1f', '0');
    }
    return parts.join(';');
  }

  function onXhChange() {
    try {
      localStorage.setItem(STORAGE_XH, JSON.stringify(xh));
    } catch (e) {
      // Image data may push us over the localStorage 5MB cap on rare large
      // GIFs. Persist without it as a fallback so other settings still save.
      console.warn('[xh] storage full, persisting without image', e);
      const slim = { ...xh, imageData: '', imageUse: false };
      try { localStorage.setItem(STORAGE_XH, JSON.stringify(slim)); } catch {}
    }
    renderCrosshair();
    // The Valorant share code only describes vanilla SVG settings — image
    // mode is desktop-overlay-only. Show a friendly note in the field so the
    // user knows the share code mirrors the SVG, not the image.
    const codeField = document.getElementById('xh-code');
    if (xh.imageUse && xh.imageData) {
      codeField.value = '(image mode — overlay only, no in-game share code)';
    } else {
      codeField.value = generateCode();
    }
    // Push the latest config to the overlay window if it's open. We strip
    // the imageData if it's huge to avoid blowing through the IPC channel
    // on every slider tick — the overlay reads it from localStorage on
    // startup and we only push deltas after the first send.
    evz.crosshairOverlayUpdate?.(xh);
  }

  // Copy code button
  const xhCopy = document.getElementById('xh-copy');
  xhCopy.addEventListener('click', async () => {
    const code = document.getElementById('xh-code').value;
    try {
      await navigator.clipboard.writeText(code);
      xhCopy.classList.add('copied');
      xhCopy.textContent = 'Copied';
      toast('Crosshair code copied — paste in Valorant settings');
      setTimeout(() => {
        xhCopy.classList.remove('copied');
        xhCopy.textContent = 'Copy';
      }, 1500);
    } catch {
      toast('Copy failed');
    }
  });

  // Overlay toggle (separate transparent click-through window)
  const xhOverlayBtn = document.getElementById('xh-overlay-toggle');
  const xhOverlayLabel = document.getElementById('xh-overlay-label');
  let xhOverlayShown = false;
  if (evz.crosshairOverlayIsShown) {
    evz.crosshairOverlayIsShown().then((on) => updateOverlayBtn(!!on));
  }
  function updateOverlayBtn(on) {
    xhOverlayShown = on;
    xhOverlayBtn.classList.toggle('active', on);
    xhOverlayLabel.textContent = on ? 'Overlay ON' : 'Show overlay';
  }
  xhOverlayBtn.addEventListener('click', async () => {
    if (xhOverlayShown) {
      await evz.crosshairOverlayHide?.();
      updateOverlayBtn(false);
      toast('Overlay hidden');
    } else {
      await evz.crosshairOverlayShow?.(xh);
      updateOverlayBtn(true);
      toast('Overlay shown — click-through, drag here to keep editing');
    }
  });

  // Initial render
  syncControlsFromState();
  renderCrosshair();
  document.getElementById('xh-code').value = generateCode();

  // ---- Bootstrap -----------------------------------------------------
  renderFavs();

  // Default view
  const startView = localStorage.getItem(STORAGE_VIEW) || 'tracker';
  setView(startView);

  const lastRegion = localStorage.getItem(STORAGE_REGION) || 'ap';
  if ([...regionSelect.options].some((o) => o.value === lastRegion)) {
    regionSelect.value = lastRegion;
  }

  // Auto-load order: primary account (if set) > last searched > nothing
  const primary = readPrimary();
  if (primary && primary.name && primary.tag) {
    nameInput.value = primary.name;
    tagInput.value  = primary.tag;
    if ([...regionSelect.options].some((o) => o.value === primary.region)) {
      regionSelect.value = primary.region;
    }
    setTimeout(() => runSearch(primary.name, primary.tag, regionSelect.value), 200);
  } else {
    const lastRiot = localStorage.getItem(STORAGE_LAST);
    if (lastRiot && lastRiot.includes('#')) {
      const [n, t] = lastRiot.split('#').map((s) => s.trim());
      if (n && t) {
        nameInput.value = n;
        tagInput.value = t;
        setTimeout(() => runSearch(n, t, regionSelect.value), 200);
      } else {
        setStatus('idle', 'Idle');
      }
    } else {
      setStatus('idle', 'Idle');
    }
  }
})();
