/* ============================================
   evzero/valorant — overlay renderer
   ============================================
   Compact native widget UI. Talks to the same Henrik proxy as the website
   (https://ev-production.up.railway.app/val/*) but renders a tighter view
   suited to a 420×680 always-on-top window.

   This file only uses the small `window.evzero.*` bridge exposed by
   preload.js. No Node, no fs, no ipc directly.
   ============================================ */

(function () {
  'use strict';

  // ---- config ---------------------------------------------------------
  const SERVER = 'https://ev-production.up.railway.app';
  const STORAGE_LAST = 'evz-overlay-last';
  const STORAGE_REGION = 'evz-overlay-region';

  const AGENT_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : '';
  const CARD_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/playercards/${uuid}/largeart.png` : '';
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

  const statusEl = $('status');
  const statusText = statusEl.querySelector('.status-text');

  const profileEl = $('profile');
  const profileBg = $('profile-bg');
  const profileName = $('profile-name');
  const metaLevel = $('meta-level');
  const metaRegion = $('meta-region');
  const rankIcon = $('rank-icon');
  const rankTier = $('rank-tier');
  const rankRr = $('rank-rr');
  const peakIcon = $('peak-icon');
  const peakTier = $('peak-tier');
  const peakMeta = $('peak-meta');
  const recentAgent = $('recent-agent');
  const recentAgentImg = $('recent-agent-img');
  const recentAgentName = $('recent-agent-name');

  const matchesBlock = $('matches-block');
  const matchesList = $('matches-list');
  const matchesCount = $('matches-count');

  const tbPin = $('tb-pin');
  const tbMin = $('tb-min');
  const tbClose = $('tb-close');
  const versionEl = $('version');
  const openWebBtn = $('open-web');

  const toastEl = $('toast');
  const toastTextEl = $('toast-text');

  // ---- Bridge --------------------------------------------------------
  const evz = window.evzero || {};

  if (evz.getVersion) evz.getVersion().then((v) => versionEl.textContent = `v${v}`);
  if (evz.windowGetPin) evz.windowGetPin().then((on) => tbPin.classList.toggle('active', !!on));

  tbPin.addEventListener('click', async () => {
    if (!evz.windowTogglePin) return;
    const pinned = await evz.windowTogglePin();
    tbPin.classList.toggle('active', !!pinned);
    toast(pinned ? 'Pinned on top' : 'Unpinned');
  });
  tbMin.addEventListener('click', () => evz.windowMinimize?.());
  tbClose.addEventListener('click', () => evz.windowClose?.());
  openWebBtn.addEventListener('click', () => {
    evz.openExternal?.('https://evzero.org/valorant/');
  });

  // ---- Toast helper ---------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms = 1600) {
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function timeAgo(isoOrMs) {
    const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
    if (!t || Number.isNaN(t)) return '—';
    const diff = (Date.now() - t) / 1000;
    if (diff < 60)       return `${Math.floor(diff)}s ago`;
    if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86_400)   return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604_800)  return `${Math.floor(diff / 86_400)}d ago`;
    return `${Math.floor(diff / 604_800)}w ago`;
  }

  // ---- Proxy helper ---------------------------------------------------
  async function proxy(path, params) {
    const qs = new URLSearchParams(params);
    let res;
    try {
      res = await fetch(`${SERVER}${path}?${qs}`);
    } catch (netErr) {
      const err = new Error('Cannot reach tracker backend');
      err.status = 0;
      throw err;
    }
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const msg = (body && (body.error || (body.errors && body.errors[0] && body.errors[0].message))) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---- Match helpers --------------------------------------------------
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

  // ---- Render ---------------------------------------------------------
  function renderProfile(account, mmr, matches) {
    const cardUuid = typeof account?.card === 'string' ? account.card : (account?.card?.id || '');
    const cardUrl = cardUuid ? CARD_CDN(cardUuid) : '';
    profileBg.style.backgroundImage = cardUrl ? `url("${cardUrl}")` : 'none';

    profileName.textContent = `${account?.name || '—'}${account?.tag ? `#${account.tag}` : ''}`;
    metaLevel.textContent = `Level ${account?.account_level ?? '—'}`;
    metaRegion.textContent = (account?.region || '—').toUpperCase();

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

    // Recent agent
    const recent = Array.isArray(matches)
      ? matches.map((m) => ({ m, self: findSelf(m, account?.puuid) })).find((x) => x.self)
      : null;
    if (recent && recent.self) {
      const rid = (recent.self.agent && recent.self.agent.id) || recent.self.character_id || '';
      const rname = (recent.self.agent && recent.self.agent.name) || recent.self.character || '—';
      if (rid) {
        recentAgentImg.src = AGENT_CDN(rid);
        recentAgentName.textContent = rname;
        recentAgent.hidden = false;
      } else {
        recentAgent.hidden = true;
      }
    } else {
      recentAgent.hidden = true;
    }

    profileEl.hidden = false;
  }

  function renderMatches(matches, puuid) {
    if (!matches.length) {
      matchesList.innerHTML = '<div class="match-empty">No recent matches.</div>';
      matchesCount.textContent = '0';
      matchesBlock.hidden = false;
      return;
    }
    matchesCount.textContent = String(matches.length);
    matchesList.innerHTML = matches.slice(0, 10).map((m) => {
      const self = findSelf(m, puuid);
      if (!self) return '';
      const s = self.stats || {};
      const r = matchResult(m, self);
      const mapName = (m.metadata && (m.metadata.map?.name || m.metadata.map)) || 'Unknown';
      const started = m.metadata && (m.metadata.started_at || m.metadata.game_start_patched || m.metadata.game_start);
      const aid = (self.agent && self.agent.id) || self.character_id || '';
      return `
        <div class="match" data-result="${r}">
          <div class="match-strip"></div>
          ${aid ? `<img class="match-agent" src="${esc(AGENT_CDN(aid))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<div class="match-agent"></div>'}
          <div class="match-meta">
            <div class="match-map">${esc(mapName)}</div>
            <div class="match-sub">${esc(timeAgo(started))}  ·  ${r}</div>
          </div>
          <div class="match-kda">${s.kills ?? 0}<span class="sep">/</span>${s.deaths ?? 0}<span class="sep">/</span>${s.assists ?? 0}</div>
        </div>
      `;
    }).join('');
    matchesBlock.hidden = false;
  }

  // ---- Search flow ----------------------------------------------------
  let inFlight = 0;

  async function runSearch(name, tag, region) {
    const token = ++inFlight;
    setStatus('loading', 'Fetching…');
    searchBtn.disabled = true;

    try {
      const accountRes = await proxy('/val/account', { name, tag });
      if (token !== inFlight) return;
      const account = accountRes?.data;
      if (!account || !account.puuid) throw new Error('Player not found');

      const resolvedRegion = (account.region || region).toLowerCase();

      const [mmrRes, matchesRes] = await Promise.all([
        proxy('/val/mmr', { region: resolvedRegion, platform: 'pc', name, tag }).catch((e) => ({ __err: e })),
        proxy('/val/matches', { region: resolvedRegion, platform: 'pc', name, tag, size: 10, mode: 'competitive' }).catch((e) => ({ __err: e })),
      ]);
      if (token !== inFlight) return;

      const mmr = mmrRes && !mmrRes.__err ? mmrRes.data : null;
      const matches = (matchesRes && !matchesRes.__err && Array.isArray(matchesRes.data)) ? matchesRes.data : [];

      renderProfile(account, mmr, matches);
      renderMatches(matches, account.puuid);

      setStatus('ok', `${account.name}#${account.tag}`);
      localStorage.setItem(STORAGE_LAST, `${account.name}#${account.tag}`);
      localStorage.setItem(STORAGE_REGION, resolvedRegion);
    } catch (err) {
      if (token !== inFlight) return;
      const msg = err.status === 0
        ? 'Backend unreachable'
        : err.status === 404
          ? 'Player not found'
          : err.status === 503
            ? 'Tracker offline'
            : err.status === 429
              ? 'Rate limited'
              : (err.message || 'Error');
      setStatus('error', msg);
      console.error('[evz]', err);
    } finally {
      if (token === inFlight) searchBtn.disabled = false;
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

  // ---- Bootstrap ------------------------------------------------------
  const lastRiot = localStorage.getItem(STORAGE_LAST);
  const lastRegion = localStorage.getItem(STORAGE_REGION) || 'ap';
  if ([...regionSelect.options].some((o) => o.value === lastRegion)) {
    regionSelect.value = lastRegion;
  }
  if (lastRiot && lastRiot.includes('#')) {
    const [n, t] = lastRiot.split('#').map((s) => s.trim());
    if (n && t) {
      nameInput.value = n;
      tagInput.value = t;
      // Auto-search the last-known player so opening the widget shows fresh stats.
      setTimeout(() => runSearch(n, t, regionSelect.value), 200);
    } else {
      setStatus('idle', 'Idle');
    }
  } else {
    setStatus('idle', 'Idle');
  }
})();
