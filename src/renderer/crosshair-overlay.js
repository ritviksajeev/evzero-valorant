/* ============================================
   evzero/valorant — crosshair overlay renderer
   ============================================
   Runs in the separate transparent click-through window. Listens for config
   pushes from the main process and re-renders the SVG. Identical drawing
   logic to the in-app preview so what you see in the editor matches what
   appears on screen.
   ============================================ */

(function () {
  'use strict';

  const evz = window.evzero || {};
  const svg = document.getElementById('xh');

  function render(xh) {
    if (!xh) { svg.innerHTML = ''; return; }
    const out = [];
    const c = xh.color || '#FFFFFF';
    const ot = xh.outlineThick || 0;
    const op = xh.outlineOp || 0;
    const drawLine = (x1, y1, x2, y2, thickness, opacity) => {
      if (xh.outline && ot > 0) {
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${thickness + ot * 2}" stroke-opacity="${op}" stroke-linecap="square"/>`);
      }
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${thickness}" stroke-opacity="${opacity}" stroke-linecap="square"/>`);
    };
    if (xh.innerShow) {
      const t = xh.innerThick, len = xh.innerLen, off = xh.innerOff, o = xh.innerOp;
      drawLine(-(off + len), 0, -off, 0, t, o);
      drawLine(off, 0, off + len, 0, t, o);
      drawLine(0, -(off + len), 0, -off, t, o);
      drawLine(0, off, 0, off + len, t, o);
    }
    if (xh.outerShow) {
      const t = xh.outerThick, len = xh.outerLen, off = xh.outerOff, o = xh.outerOp;
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

  // Initial state: try to read whatever the editor last saved so the overlay
  // matches even on first show before the main process pushes a config.
  try {
    const stored = JSON.parse(localStorage.getItem('evz-overlay-xh') || 'null');
    if (stored) render(stored);
  } catch { /* ignore */ }

  if (evz.onCrosshairConfig) evz.onCrosshairConfig(render);
})();
