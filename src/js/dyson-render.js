// Canvas draw helpers for Dyson supply ties and hybrid sail dot / ring rendering.

import {
  SAIL_DOT_SIZE,
} from './constants.js';
import { THEME, hexToRgba } from './theme.js';
import { sailDotDrawStride } from './dyson-visuals.js';
import { drawDysonMegastructure } from './dyson-megastructure-render.js';

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
  systemSeed = 0,
) {
  drawDysonMegastructure(
    ctx,
    starX,
    starY,
    zoom,
    completedShells,
    starRadius,
    time,
    lastShellCompletedAt,
    systemSeed,
  );
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
