// Canvas draw helpers for Dyson supply ties and hybrid sail dot / ring rendering.

import {
  SHELL_COUNT,
  SAIL_DOT_SIZE,
} from './constants.js';
import { THEME, hexToRgba } from './theme.js';
import { shellOrbitRadius, sailDotDrawStride } from './dyson-visuals.js';

export function drawFoundrySupplyTie(ctx, line, zoom, time = 0) {
  const from = { x: line.fromX, y: line.fromY };
  const to = { x: line.toX, y: line.toY };
  const dash = Math.max(4, 6 * zoom);
  const gap = Math.max(3, 5 * zoom);
  const offset = (time / 120) % (dash + gap);

  ctx.save();
  ctx.strokeStyle = hexToRgba(THEME.accentGold, 0.42);
  ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
  ctx.setLineDash([dash, gap]);
  ctx.lineDashOffset = -offset;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawCompletedShellRings(
  ctx,
  starX,
  starY,
  zoom,
  completedShells,
  starRadius,
  time = 0,
  lastShellCompletedAt = null,
) {
  if (completedShells <= 0) return;

  const pulse = lastShellCompletedAt != null && time - lastShellCompletedAt < 1000
    ? 1 + 0.15 * (1 - (time - lastShellCompletedAt) / 1000)
    : 1;

  ctx.save();
  ctx.translate(starX, starY);

  for (let tier = 1; tier <= Math.min(SHELL_COUNT, completedShells); tier++) {
    const tierR = shellOrbitRadius(starRadius, tier) * zoom * pulse;
    const alpha = 0.12 + tier * 0.04;
    ctx.strokeStyle = `rgba(255, 210, 120, ${Math.min(0.85, alpha)})`;
    ctx.lineWidth = Math.max(1, (1 + tier * 0.15) * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, tierR, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (completedShells >= SHELL_COUNT) {
    const r = shellOrbitRadius(starRadius, SHELL_COUNT) * zoom * pulse;
    ctx.strokeStyle = 'rgba(255, 230, 160, 0.75)';
    ctx.lineWidth = Math.max(2, 2.5 * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawInProgressSailDots(ctx, starX, starY, zoom, settled, inFlight, time = 0) {
  const stride = sailDotDrawStride(settled.length, zoom);
  const dotR = Math.max(0.6, SAIL_DOT_SIZE * zoom);

  ctx.save();
  ctx.translate(starX, starY);

  for (let i = 0; i < settled.length; i += stride) {
    const d = settled[i];
    const sx = d.x * zoom;
    const sy = d.y * zoom;
    ctx.fillStyle = hexToRgba(THEME.accentGold, 0.55 + 0.25 * Math.sin(time / 500 + i * 0.02));
    ctx.fillRect(sx - dotR * 0.5, sy - dotR * 0.5, dotR, dotR);
  }

  for (const d of inFlight) {
    const sx = d.x * zoom;
    const sy = d.y * zoom;
    const trailR = dotR * 1.35;
    ctx.fillStyle = hexToRgba('#fff4c8', 0.85);
    ctx.beginPath();
    ctx.arc(sx, sy, trailR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawDysonStarGlow(ctx, starX, starY, zoom, completedShells, starRadius) {
  if (completedShells < 4) return;

  const r = starRadius * zoom;
  ctx.save();
  ctx.translate(starX, starY);
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.6);
  glow.addColorStop(0, `rgba(255, 200, 100, ${0.05 + completedShells * 0.015})`);
  glow.addColorStop(1, 'rgba(255, 160, 60, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
