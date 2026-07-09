// Construction drone sprites (Phase 6).

import { DRONE_SIZE } from './constants.js';
import { THEME, hexToRgba } from './theme.js';

export function drawConstructionDrone(ctx, x, y, heading, scale, opts = {}) {
  const r = DRONE_SIZE * scale;
  const { phase = 'idle', working = false, time = 0, seed = 0 } = opts;
  const pulse = 0.65 + 0.35 * Math.sin(time / 420 + seed);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  const bodyColor = working ? THEME.accentGold : THEME.accentCyan;
  ctx.fillStyle = hexToRgba(bodyColor, working ? 0.95 : 0.82);
  ctx.strokeStyle = hexToRgba(THEME.textPrimary, 0.55);
  ctx.lineWidth = Math.max(0.6, scale);

  // Hex body
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tool arms when working
  if (working || phase === 'working') {
    ctx.strokeStyle = hexToRgba(THEME.accentGold, 0.7 + 0.3 * pulse);
    ctx.lineWidth = Math.max(0.8, 1.2 * scale);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sign * r * 0.4, 0);
      ctx.lineTo(sign * r * 1.35, sign * r * 0.35);
      ctx.stroke();
    }
  }

  // Forward thrust nub
  ctx.fillStyle = hexToRgba(THEME.accentCyan, phase === 'outbound' || phase === 'returning' ? 0.9 : 0.35);
  ctx.beginPath();
  ctx.moveTo(r * 1.1, 0);
  ctx.lineTo(r * 0.5, r * 0.35);
  ctx.lineTo(r * 0.5, -r * 0.35);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  if (working) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = hexToRgba(THEME.accentGold, 0.25 + 0.2 * pulse);
    for (let i = 0; i < 3; i++) {
      const a = time / 300 + i * 2.1 + seed;
      const sparkR = r * (1.4 + 0.2 * Math.sin(a));
      ctx.beginPath();
      ctx.arc(Math.cos(a) * sparkR, Math.sin(a) * sparkR, Math.max(1, scale * 1.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function drawDroneTrail(ctx, x, y, heading, scale, phase) {
  if (phase !== 'outbound' && phase !== 'returning') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading + Math.PI);
  const len = 8 * scale;
  const grad = ctx.createLinearGradient(0, 0, -len, 0);
  grad.addColorStop(0, hexToRgba(THEME.accentCyan, 0.45));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-len, 0);
  ctx.stroke();
  ctx.restore();
}
