/* ============================================
   evzero/valorant — scoreboard overlay renderer
   ============================================
   Standalone window. Receives a serialised match payload from the main
   renderer (via the main process) and renders it as a compact scoreboard.
   No fetching here — all data comes from the editor side via IPC.
   ============================================ */

(function () {
  'use strict';

  const evz = window.evzero || {};
  const meta = document.getElementById('meta');
  const metaMap = document.getElementById('meta-map');
  const metaMode = document.getElementById('meta-mode');
  const metaResult = document.getElementById('meta-result');
  const board = document.getElementById('scoreboard');
  const closeBtn = document.getElementById('close');

  const AGENT_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  closeBtn.addEventListener('click', () => evz.scoreboardOverlayHide?.());

  function render(payload) {
    if (!payload || !payload.teams || !payload.teams.length) {
      meta.hidden = true;
      board.innerHTML = '<div class="empty">No match data — search a player in the tracker first.</div>';
      return;
    }

    meta.hidden = false;
    metaMap.textContent = payload.map || 'Unknown';
    metaMode.textContent = payload.mode || '';
    if (payload.selfResult === 'win') {
      metaResult.textContent = 'WIN'; metaResult.className = 'meta-result win';
    } else if (payload.selfResult === 'loss') {
      metaResult.textContent = 'LOSS'; metaResult.className = 'meta-result loss';
    } else {
      metaResult.textContent = '—'; metaResult.className = 'meta-result';
    }

    const html = payload.teams.map((t) => {
      const winCls = t.won === true ? 'win' : t.won === false ? 'loss' : '';
      const rowsHtml = (t.rows || []).map((r) => {
        const nameHtml = r.name
          ? esc(r.name) + (r.tag ? ` <span class="anon">#${esc(r.tag)}</span>` : '')
          : `<span class="anon">${esc(r.fallback || 'Player')}</span>`;
        return `<div class="row ${r.self ? 'self' : ''}">
          ${r.agentId ? `<img src="${esc(AGENT_CDN(r.agentId))}" alt="" loading="lazy"/>` : '<div></div>'}
          <div class="row-name">${nameHtml}</div>
          <div class="row-acs">${r.acs ?? '—'}</div>
          <div class="row-kda">${r.k}/${r.d}/${r.a}</div>
        </div>`;
      }).join('');
      return `<div class="team">
        <div class="team-head">
          <span class="team-name ${winCls}">${esc(t.label || 'Team')}</span>
          <span class="team-score">${t.score ?? ''}</span>
        </div>
        ${rowsHtml}
      </div>`;
    }).join('');
    board.innerHTML = html;
  }

  // Initial state — render whatever the editor saved last so re-opening
  // shows the most recent match without waiting for an IPC push.
  try {
    const stored = JSON.parse(localStorage.getItem('evz-overlay-scoreboard') || 'null');
    if (stored) render(stored);
  } catch { /* ignore */ }

  if (evz.onScoreboardConfig) evz.onScoreboardConfig(render);
})();
