// Construction drone sprites (Phase 6).

import { DRONE_SIZE } from './constants.js';
import { THEME, hexToRgba } from './theme.js';

const droneSpriteCache = new Map();

function paintDroneChassis(ctx, r, scale, working, moving) {
  const bodyColor = working ? THEME.accentGold : THEME.accentCyan;
  ctx.fillStyle = 'rgba(13, 20, 31, 0.96)';
  ctx.strokeStyle = hexToRgba(bodyColor, working ? 0.95 : 0.78);
  ctx.lineWidth = Math.max(0.55, scale * 0.72);

  // Armored hex chassis.
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

  // Side booms and compact collector/tool panels.
  ctx.strokeStyle = hexToRgba(THEME.textSecondary, 0.72);
  ctx.lineWidth = Math.max(0.45, scale * 0.55);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, sign * r * 0.55);
    ctx.lineTo(-r * 0.2, sign * r * 1.35);
    ctx.stroke();
    ctx.fillStyle = hexToRgba(bodyColor, working ? 0.42 : 0.28);
    ctx.strokeStyle = hexToRgba(bodyColor, 0.68);
    ctx.fillRect(-r * 0.72, sign * r * 1.12 - r * 0.2, r * 1.05, r * 0.4);
    ctx.strokeRect(-r * 0.72, sign * r * 1.12 - r * 0.2, r * 1.05, r * 0.4);
  }

  // Reactor eye and forward sensor mast.
  ctx.fillStyle = hexToRgba(bodyColor, 0.88);
  ctx.beginPath();
  ctx.arc(r * 0.08, 0, Math.max(0.65, r * 0.27), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(THEME.textPrimary, 0.58);
  ctx.beginPath();
  ctx.moveTo(r * 0.45, -r * 0.45);
  ctx.lineTo(r * 0.95, -r * 0.82);
  ctx.stroke();
  ctx.fillStyle = hexToRgba(THEME.accentCyan, 0.8);
  ctx.beginPath();
  ctx.arc(r * 1.02, -r * 0.87, Math.max(0.45, r * 0.12), 0, Math.PI * 2);
  ctx.fill();

  // Articulated fabrication arms extend toward the work target.
  if (working) {
    ctx.strokeStyle = hexToRgba(THEME.accentGold, 0.9);
    ctx.lineWidth = Math.max(0.65, scale * 0.85);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.35, sign * r * 0.42);
      ctx.lineTo(r * 1.05, sign * r * 0.72);
      ctx.lineTo(r * 1.55, sign * r * 0.32);
      ctx.stroke();
    }
  }

  // Twin rear maneuvering thrusters.
  const thrustAlpha = moving ? 0.92 : 0.34;
  ctx.fillStyle = hexToRgba(THEME.accentCyan, thrustAlpha);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, sign * r * 0.34);
    ctx.lineTo(-r * 1.35, sign * r * 0.52);
    ctx.lineTo(-r * 1.2, sign * r * 0.12);
    ctx.closePath();
    ctx.fill();
  }
}

function createSpriteCanvas(size) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(size, size);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function cachedDroneSprite(scale, working, phase) {
  const scaleBucket = Math.max(0.25, Math.round(scale * 8) / 8);
  const moving = phase === 'outbound' || phase === 'returning' || phase === 'launching';
  const key = `${scaleBucket}:${working ? 1 : 0}:${moving ? 1 : 0}`;
  const cached = droneSpriteCache.get(key);
  if (cached) return cached;

  const r = DRONE_SIZE * scaleBucket;
  const size = Math.max(12, Math.ceil(r * 4.6 + 6));
  const canvas = createSpriteCanvas(size);
  const spriteCtx = canvas.getContext('2d');
  spriteCtx.translate(size / 2, size / 2);
  paintDroneChassis(spriteCtx, r, scaleBucket, working, moving);
  const sprite = { canvas, size, r, scale: scaleBucket };
  droneSpriteCache.set(key, sprite);
  return sprite;
}

export function drawConstructionDrone(ctx, x, y, heading, scale, opts = {}) {
  const { phase = 'idle', working = false, time = 0, seed = 0 } = opts;
  const pulse = 0.65 + 0.35 * Math.sin(time / 420 + seed);
  const sprite = cachedDroneSprite(scale, working, phase);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.drawImage(sprite.canvas, -sprite.size / 2, -sprite.size / 2);

  // Keep only the cheap animated reactor pulse live; chassis paths are cached.
  const bodyColor = working ? THEME.accentGold : THEME.accentCyan;
  ctx.fillStyle = hexToRgba(bodyColor, 0.18 + pulse * 0.34);
  ctx.beginPath();
  ctx.arc(sprite.r * 0.08, 0, Math.max(0.55, sprite.r * 0.19), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (working) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = hexToRgba(THEME.accentGold, 0.25 + 0.2 * pulse);
    for (let i = 0; i < 2; i++) {
      const a = time / 300 + i * 2.1 + seed;
      const sparkR = sprite.r * (1.4 + 0.2 * Math.sin(a));
      ctx.beginPath();
      ctx.arc(Math.cos(a) * sparkR, Math.sin(a) * sparkR, Math.max(1, sprite.scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function drawDroneWorkBeam(ctx, x, y, targetX, targetY, scale, time = 0, seed = 0) {
  const pulse = 0.55 + 0.45 * Math.sin(time / 110 + seed * 1.7);
  ctx.save();
  ctx.strokeStyle = hexToRgba(THEME.accentGold, 0.28 + pulse * 0.42);
  ctx.lineWidth = Math.max(0.55, scale * 0.72);
  ctx.setLineDash([Math.max(1.5, 2.5 * scale), Math.max(1, 1.8 * scale)]);
  ctx.lineDashOffset = -(time / 85 + seed * 3);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(targetX, targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = hexToRgba('#fff0a8', 0.42 + pulse * 0.48);
  ctx.beginPath();
  ctx.arc(targetX, targetY, Math.max(0.8, scale * 1.25), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function assemblyColor(type) {
  if (type === 'research_station') return '#b88cff';
  if (type === 'sail_foundry' || type === 'dyson_launcher') return THEME.accentGold;
  if (type === 'outpost') return THEME.accentGreen;
  return THEME.accentCyan;
}

function segmentAlpha(progress, index, count) {
  const local = progress * count - index;
  return Math.max(0, Math.min(1, local));
}

/** Type-specific partial assembly shown while construction drones are working. */
export function drawConstructionAssembly(ctx, x, y, scale, opts = {}) {
  const { type = 'structure', progress = 0, time = 0, seed = 0 } = opts;
  const p = Math.max(0.02, Math.min(1, progress));
  const color = assemblyColor(type);
  const r = Math.max(7, 14 * scale);
  const pulse = 0.55 + 0.45 * Math.sin(time / 260 + seed);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(seed * 0.17);

  // Persistent scaffold outline makes the final silhouette readable early.
  ctx.strokeStyle = hexToRgba(color, 0.18 + pulse * 0.1);
  ctx.lineWidth = Math.max(0.55, scale * 0.7);
  ctx.setLineDash([Math.max(2, 3 * scale), Math.max(2, 4 * scale)]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (type === 'sail_foundry') {
    const rings = [0.48, 0.72, 1];
    rings.forEach((flatten, index) => {
      const alpha = segmentAlpha(p, index, rings.length);
      if (alpha <= 0) return;
      ctx.strokeStyle = hexToRgba(color, 0.32 + alpha * 0.58);
      ctx.lineWidth = Math.max(0.7, scale * (0.8 + alpha * 0.65));
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r * flatten, index * 0.72, 0, Math.PI * 2 * alpha);
      ctx.stroke();
    });
  } else if (type === 'dyson_launcher') {
    const pieces = 7;
    ctx.rotate(-0.35);
    for (let i = 0; i < pieces; i++) {
      const alpha = segmentAlpha(p, i, pieces);
      if (alpha <= 0) continue;
      const px = -r * 1.15 + i * (r * 2.3 / pieces);
      ctx.fillStyle = hexToRgba(color, 0.28 + alpha * 0.62);
      ctx.fillRect(px, -r * 0.16, r * 0.28 * alpha, r * 0.32);
      if (i % 2 === 0) ctx.fillRect(px + r * 0.05, -r * 0.46, r * 0.12, r * 0.92);
    }
  } else if (type === 'research_station') {
    ctx.strokeStyle = hexToRgba(color, 0.4 + p * 0.5);
    ctx.lineWidth = Math.max(0.7, scale);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2 * Math.min(1, p * 2));
    ctx.stroke();
    if (p > 0.35) {
      const dishP = Math.min(1, (p - 0.35) / 0.65);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * dishP, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r, 0, r * 0.45, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();
    }
  } else {
    const arms = type === 'shipyard' ? 8 : (type === 'outpost' ? 6 : 5);
    ctx.fillStyle = hexToRgba(color, 0.24 + p * 0.5);
    ctx.strokeStyle = hexToRgba(color, 0.38 + p * 0.52);
    ctx.lineWidth = Math.max(0.65, scale * 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < arms; i++) {
      const alpha = segmentAlpha(p, i, arms);
      if (alpha <= 0) continue;
      const angle = i / arms * Math.PI * 2;
      const length = r * (0.48 + 0.72 * alpha);
      ctx.strokeStyle = hexToRgba(color, 0.28 + alpha * 0.62);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * r * 0.3, Math.sin(angle) * r * 0.3);
      ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
      ctx.stroke();
      ctx.fillStyle = hexToRgba(color, 0.18 + alpha * 0.5);
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * length, Math.sin(angle) * length, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A few deterministic weld flashes, bounded per site for stable render cost.
  ctx.fillStyle = hexToRgba('#fff0a8', 0.25 + pulse * 0.6);
  for (let i = 0; i < 3; i++) {
    const a = time / 340 + seed + i * 2.094;
    const d = r * (0.55 + 0.5 * p);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.75, scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawDroneTrail(ctx, x, y, heading, scale, phase) {
  if (phase !== 'outbound' && phase !== 'returning' && phase !== 'launching') return;
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
