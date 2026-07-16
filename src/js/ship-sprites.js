// Custom procedural ship models — Canvas 2D vector hulls.
// Every ship is drawn nose-facing +x at the origin; callers translate/rotate.
//
//   flagship  — Foundation x USS Enterprise x Star Destroyer hybrid
//   shuttle   — Foundation whisper ship with animated sweep wings
//   others    — distinct silhouettes per combat role

import { THEME, hexToRgba } from './theme.js';
import {
  flagshipDecorativeBatteries,
  flagshipHardpointAnchors,
  flagshipHullMorph,
} from './flagship-morph.js';

const HULL_RENDER = {
  scout: { scale: 0.75 },
  corvette: { scale: 0.85 },
  patrol_cutter: { scale: 0.8 },
  frigate: { scale: 1.0 },
  destroyer: { scale: 1.15 },
  cruiser: { scale: 1.35 },
  battleship: { scale: 1.5 },
  dreadnought: { scale: 1.65 },
  light_carrier: { scale: 1.25 },
  fleet_carrier: { scale: 1.45 },
  super_carrier: { scale: 1.6 },
  light_hauler: { scale: 1.05 },
  bulk_freighter: { scale: 1.2 },
  armored_convoy: { scale: 1.15 },
  fighter: { scale: 0.7 },
  interceptor: { scale: 0.65 },
  heavy_fighter: { scale: 0.78 },
  bomber: { scale: 0.82 },
  healer: { scale: 0.95 },
  sensor_ship: { scale: 0.9 },
  builder_ship: { scale: 1.05 },
  command_cruiser: { scale: 1.3 },
  miner: { scale: 0.95 },
  flagship: { scale: 1.5 },
  hero_flagship: { scale: 1.25 },
};

function hullColors(hull, side) {
  const enemy = side === 'enemy';
  const ai = side === 'ai';
  if (hull === 'healer') {
    return {
      deck: enemy ? '#6a3a3a' : ai ? '#5a3f70' : '#3a6a52',
      hull: enemy ? '#4a2828' : ai ? '#352348' : '#24443a',
      dark: enemy ? '#2a1616' : ai ? '#1c132c' : '#122420',
      stroke: enemy ? '#ff8888' : ai ? '#d194ff' : '#7affb8',
      glow: enemy ? '#ff5555' : ai ? THEME.accentViolet : '#7aff9e',
      engine: enemy ? '#ff7755' : ai ? '#c44dff' : '#7ad0ff',
    };
  }
  return {
    deck: enemy ? '#5c3434' : ai ? '#4d376b' : '#3c4c66',
    hull: enemy ? '#402424' : ai ? '#2f2347' : '#28344a',
    dark: enemy ? '#241212' : ai ? '#171125' : '#141c2e',
    stroke: enemy ? '#ff6666' : ai ? '#c889ff' : '#9fc7ff',
    glow: enemy ? '#ff4444' : ai ? THEME.accentViolet : THEME.accentCyan,
    engine: enemy ? '#ff6a3a' : ai ? '#c44dff' : '#7ad0ff',
  };
}

/** Sum facing shields (or flat shield) into { shield, maxShield }. */
export function unitShieldTotals(unitOrShields) {
  if (unitOrShields == null) return { shield: 0, maxShield: 0 };
  const facings = unitOrShields.shieldFacings ?? unitOrShields.shields
    ?? (typeof unitOrShields === 'object'
      && ('front' in unitOrShields || 'aft' in unitOrShields)
      ? unitOrShields
      : null);
  if (facings && typeof facings === 'object') {
    let shield = 0;
    let maxShield = 0;
    for (const facing of Object.values(facings)) {
      if (facing == null || typeof facing !== 'object') continue;
      shield += Math.max(0, facing.value ?? facing.current ?? 0);
      maxShield += Math.max(0, facing.max ?? facing.value ?? facing.current ?? 0);
    }
    return { shield, maxShield };
  }
  const shield = Math.max(0, unitOrShields.shield ?? 0);
  const maxShield = Math.max(0, unitOrShields.maxShield ?? shield);
  return { shield, maxShield };
}

/**
 * Hull (bottom) + optional shield (top) bars above a ship.
 * When alwaysShow is false, bars only appear if hull or shields are not full.
 */
function drawStatusBars(ctx, x, y, r, {
  hp = 1,
  maxHp = 1,
  shield = 0,
  maxShield = 0,
  alwaysShow = false,
} = {}) {
  if (maxHp <= 0) return;
  const showShield = maxShield > 0;
  const hpPct = Math.max(0, Math.min(1, hp / maxHp));
  const shieldPct = showShield ? Math.max(0, Math.min(1, shield / maxShield)) : 0;
  if (!alwaysShow && hpPct >= 1 && (!showShield || shieldPct >= 1)) return;

  const barW = Math.max(18, r * 3.2);
  const barH = 4;
  const gap = 2;
  const stackH = showShield ? barH * 2 + gap : barH;
  let barY = y - r - 8 - stackH;

  const drawTrack = (pct, fill) => {
    ctx.fillStyle = 'rgba(4, 8, 16, 0.82)';
    ctx.fillRect(x - barW / 2, barY, barW, barH);
    if (pct > 0) {
      ctx.fillStyle = fill;
      ctx.fillRect(x - barW / 2, barY, Math.max(1.5, barW * pct), barH);
    }
    ctx.strokeStyle = 'rgba(220, 235, 255, 0.32)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - barW / 2 + 0.5, barY + 0.5, barW - 1, barH - 1);
    barY += barH + gap;
  };

  if (showShield) {
    drawTrack(shieldPct, THEME.accentCyan);
  }
  drawTrack(hpPct, hpPct > 0.35 ? THEME.accentGreen : THEME.danger);
}

function drawHpBar(ctx, x, y, r, hp, maxHp) {
  drawStatusBars(ctx, x, y, r, { hp, maxHp, alwaysShow: false });
}

/** Lengthwise metallic gradient: dark tail, lit nose. */
function metalGradient(ctx, r, c) {
  const g = ctx.createLinearGradient(-r * 1.6, 0, r * 1.8, 0);
  g.addColorStop(0, c.dark);
  g.addColorStop(0.45, c.hull);
  g.addColorStop(1, c.deck);
  return g;
}

function engineFlame(ctx, x, y, len, width, color, flicker = 1) {
  const g = ctx.createLinearGradient(x, y, x - len * flicker, y);
  g.addColorStop(0, hexToRgba('#ffffff', 0.9));
  g.addColorStop(0.25, hexToRgba(color, 0.85));
  g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - width / 2);
  ctx.lineTo(x - len * flicker, y);
  ctx.lineTo(x, y + width / 2);
  ctx.closePath();
  ctx.fill();
}

function glowDot(ctx, x, y, r, color, alpha = 1) {
  const outer = r * 2.2;
  const g = ctx.createRadialGradient(x, y, 0, x, y, outer);
  g.addColorStop(0, hexToRgba(color, alpha));
  g.addColorStop(0.45, hexToRgba(color, alpha * 0.55));
  g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(color, Math.min(1, alpha + 0.15));
  ctx.beginPath();
  ctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
  ctx.fill();
}

const ANIMATED_HULLS = new Set([
  'light_carrier', 'fleet_carrier', 'super_carrier',
  'healer', 'sensor_ship', 'miner',
]);

const HULL_CACHE_MAX = 64;
/** @type {Map<string, { canvas: HTMLCanvasElement, half: number, r: number }>} */
const hullBitmapCache = new Map();

function cacheHullBitmap(hull, side, r, drawOpts = {}) {
  // Half-pixel buckets so small fighters can shrink/grow with zoom instead of
  // flooring to a fixed 4px screen size across most of the zoom range.
  const rKey = Math.max(1.5, Math.round(r * 2) / 2);
  const refitKey = drawOpts.refitId || 'stock';
  const stageKey = drawOpts.hullStage ? String(drawOpts.hullStage) : '0';
  const markKey = drawOpts.empireMark ? '1' : '0';
  const key = `${hull}:${side}:${rKey}:${refitKey}:${stageKey}:${markKey}`;
  const existing = hullBitmapCache.get(key);
  if (existing) {
    hullBitmapCache.delete(key);
    hullBitmapCache.set(key, existing);
    return existing;
  }

  const pad = rKey * 2.4;
  const size = Math.max(8, Math.ceil(rKey * 4 + pad * 2));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  c.translate(size / 2, size / 2);
  drawHullShape(c, hull, rKey, hullColors(hull, side), 0, drawOpts);

  const entry = { canvas, half: size / 2, r: rKey };
  if (hullBitmapCache.size >= HULL_CACHE_MAX) {
    const oldest = hullBitmapCache.keys().next().value;
    hullBitmapCache.delete(oldest);
  }
  hullBitmapCache.set(key, entry);
  return entry;
}

// ============================= FLAGSHIP =============================
// Hull Forge morphs the sovereign flagship from a compact armored cruiser into
// an Enterprise × Star Destroyer hybrid: longer detailed nose, aft command
// tower, and at most four nacelles (outers clamped to the inners). Footprint
// stays the same — morph via silhouette and detail, not draw-radius scale.

/** Kept for callers; Hull Forge morphs silhouette without changing draw radius. */
export function flagshipVisualScale(_hullStage = 0) {
  return 1;
}

export function drawFlagshipModel(ctx, r, opts = {}) {
  const {
    thrusting = false,
    time = performance.now(),
    side = 'player',
    hpFraction = 1,
    hardpointFireAt = null,
    hullStage = 0,
  } = opts;
  const stage = Math.max(0, Math.min(5, Math.round(Number(hullStage) || 0)));
  const c = hullColors('flagship', side);
  const flicker = 0.8 + 0.2 * Math.sin(time / 42);

  // Same overall footprint — morph via longer nose + denser detail, not scale.
  const { len, wid, noseLen, noseWid, tipX, aftX, beamY } = flagshipHullMorph(stage);
  const driveBoost = [1, 1.05, 1.2, 1.35, 1.5, 1.7][stage];
  const flameW = [0.17, 0.17, 0.18, 0.19, 0.2, 0.22][stage];
  const hybrid = stage >= 4; // Destroyer wedge + Enterprise nacelles/tower

  // --- AFT DRIVE GLOW (Star Destroyer rear bank — still four cores) ---
  const coreDrives = [-0.55, -0.2, 0.2, 0.55].map((y) => y * beamY);
  for (const y of coreDrives) {
    engineFlame(
      ctx,
      aftX * r + r * 0.06,
      r * y,
      r * (thrusting ? 1.7 : 0.48) * driveBoost,
      r * flameW,
      c.engine,
      flicker,
    );
  }

  // --- NACELLES: inner pair on hull pylons; outer pair strut off the inners ---
  const innerY = 1.42 * wid;
  const outerY = 1.88 * wid;
  const innerLen = stage >= 5 ? 1.28 : stage >= 2 ? 1.14 : 1;
  const innerThick = stage >= 5 ? 1.22 : stage >= 3 ? 1.12 : stage >= 2 ? 1.06 : 1;
  const outerLen = stage >= 5 ? 1.12 : stage >= 4 ? 1.02 : 0.92;
  const outerThick = stage >= 5 ? 1.08 : stage >= 4 ? 0.98 : 0.86;

  const drawNacelleBody = (nacelleY, nLen, nThick, capGlow) => {
    const nacFore = -r * 0.15;
    const nacAft = -r * 1.95 * nLen * len;

    engineFlame(
      ctx,
      nacAft - r * 0.05,
      nacelleY,
      r * (thrusting ? 2.05 : 0.55) * driveBoost * (0.9 + 0.1 * nLen),
      r * 0.2 * nThick * (flameW / 0.17),
      c.engine,
      flicker,
    );

    const nacGrad = ctx.createLinearGradient(nacAft, nacelleY, nacFore, nacelleY);
    nacGrad.addColorStop(0, '#050a12');
    nacGrad.addColorStop(0.4, '#162637');
    nacGrad.addColorStop(0.75, c.hull);
    nacGrad.addColorStop(1, '#2a3f52');
    ctx.fillStyle = nacGrad;
    const nt = r * 0.17 * nThick;
    ctx.beginPath();
    ctx.moveTo(nacAft, nacelleY - nt);
    ctx.lineTo(nacFore - r * 0.15, nacelleY - nt * 1.05);
    ctx.quadraticCurveTo(nacFore + r * 0.12, nacelleY - nt * 0.35, nacFore + r * 0.18, nacelleY);
    ctx.quadraticCurveTo(nacFore + r * 0.12, nacelleY + nt * 0.35, nacFore - r * 0.15, nacelleY + nt * 1.05);
    ctx.lineTo(nacAft, nacelleY + nt);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.glow, stage >= 2 ? 0.55 : 0.4);
    ctx.lineWidth = Math.max(0.75, r * 0.05 * nThick);
    ctx.stroke();

    const capR = r * 0.14 * nThick;
    const capX = nacFore + r * 0.05;
    const cap = ctx.createRadialGradient(capX, nacelleY, 0, capX, nacelleY, capR);
    cap.addColorStop(0, stage >= 2 ? '#ff9a4a' : hexToRgba(c.engine, 0.9));
    cap.addColorStop(0.55, stage >= 2 ? '#ff5a2a' : c.engine);
    cap.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(capX, nacelleY, capR, 0, Math.PI * 2);
    ctx.fill();
    if (capGlow) glowDot(ctx, capX, nacelleY, capR * 0.45, '#ffb070', 0.85);

    ctx.strokeStyle = hexToRgba(c.glow, 0.85);
    ctx.lineWidth = Math.max(0.8, r * 0.09 * nThick);
    ctx.beginPath();
    ctx.moveTo(nacAft + r * 0.25, nacelleY);
    ctx.lineTo(nacFore - r * 0.2, nacelleY);
    ctx.stroke();

    return { nacFore, nacAft, nt };
  };

  for (const sideSign of [-1, 1]) {
    const iY = sideSign * r * innerY;
    const iAft = -r * 1.95 * innerLen * len;
    const iFore = -r * 0.15;

    // Hull → inner nacelle pylon.
    const pylon = ctx.createLinearGradient(-r * 0.9 * len, iY * 0.35, iAft * 0.4, iY);
    pylon.addColorStop(0, c.dark);
    pylon.addColorStop(0.55, c.hull);
    pylon.addColorStop(1, '#0a121c');
    ctx.fillStyle = pylon;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35 * len, sideSign * r * 0.55 * beamY);
    ctx.lineTo(-r * 0.85 * len, sideSign * r * 0.7 * beamY);
    ctx.lineTo(iAft * 0.55, iY * 0.92);
    ctx.lineTo(iAft * 0.35, iY * 1.08);
    ctx.lineTo(-r * 0.55 * len, sideSign * r * 0.82 * beamY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 198, 220, 0.4)';
    ctx.lineWidth = Math.max(0.7, r * 0.05);
    ctx.stroke();

    drawNacelleBody(iY, innerLen, innerThick, stage >= 2);

    // Outer pods clamp onto the inner nacelles (no second hull pylon).
    if (stage >= 2) {
      const oY = sideSign * r * outerY;
      const oAft = -r * 1.95 * outerLen * len;
      const oFore = -r * 0.15;
      const midX = (iAft + iFore) * 0.5;
      const strut = ctx.createLinearGradient(midX, iY, midX, oY);
      strut.addColorStop(0, c.hull);
      strut.addColorStop(0.5, '#1a2a3a');
      strut.addColorStop(1, c.dark);
      ctx.fillStyle = strut;
      ctx.beginPath();
      // Twin clamps: fore + aft bands from inner body out to outer pod.
      ctx.moveTo(iFore - r * 0.05, iY + sideSign * r * 0.12 * innerThick);
      ctx.lineTo(oFore - r * 0.08, oY - sideSign * r * 0.08 * outerThick);
      ctx.lineTo(oFore + r * 0.12, oY - sideSign * r * 0.1 * outerThick);
      ctx.lineTo(iFore + r * 0.18, iY + sideSign * r * 0.14 * innerThick);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(iAft + r * 0.35, iY + sideSign * r * 0.12 * innerThick);
      ctx.lineTo(oAft + r * 0.4, oY - sideSign * r * 0.08 * outerThick);
      ctx.lineTo(oAft + r * 0.7, oY - sideSign * r * 0.1 * outerThick);
      ctx.lineTo(iAft + r * 0.65, iY + sideSign * r * 0.14 * innerThick);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexToRgba(c.glow, 0.35);
      ctx.lineWidth = Math.max(0.55, r * 0.035);
      ctx.beginPath();
      ctx.moveTo(midX, iY + sideSign * r * 0.1 * innerThick);
      ctx.lineTo(midX - r * 0.05, oY - sideSign * r * 0.06 * outerThick);
      ctx.stroke();

      drawNacelleBody(oY, outerLen, outerThick, true);
    }
  }

  // --- STAR DESTROYER WEDGE HULL ---
  const hullGrad = ctx.createLinearGradient(aftX * r, 0, tipX * r, 0);
  hullGrad.addColorStop(0, '#060b14');
  hullGrad.addColorStop(0.35, c.dark);
  hullGrad.addColorStop(0.7, c.hull);
  hullGrad.addColorStop(1, stage >= 5 ? '#3d5368' : '#27384a');
  ctx.fillStyle = hullGrad;
  ctx.beginPath();
  // Needle prow stretches forward; beam stays near Mk 0 so the ship reads longer, not larger.
  ctx.moveTo(r * tipX, 0);
  ctx.lineTo(r * (tipX - 0.55 * noseLen), r * 0.12 * noseWid);
  ctx.lineTo(r * 1.55 * noseLen, r * 0.28 * noseWid);
  ctx.lineTo(r * 0.55 * noseLen, r * 0.68 * noseWid);
  ctx.lineTo(-r * 0.35 * len, r * beamY);
  ctx.lineTo(r * aftX, r * beamY * 0.92);
  ctx.lineTo(r * aftX, -r * beamY * 0.92);
  ctx.lineTo(-r * 0.35 * len, -r * beamY);
  ctx.lineTo(r * 0.55 * noseLen, -r * 0.68 * noseWid);
  ctx.lineTo(r * 1.55 * noseLen, -r * 0.28 * noseWid);
  ctx.lineTo(r * (tipX - 0.55 * noseLen), -r * 0.12 * noseWid);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = stage >= 5 ? hexToRgba('#c8d8e8', 0.55) : 'rgba(178, 205, 224, 0.62)';
  ctx.lineWidth = Math.max(0.85, r * (stage >= 4 ? 0.09 : 0.065));
  ctx.stroke();

  // Cooler nose: armored ridge + vent notches along the needle.
  if (stage >= 1) {
    ctx.fillStyle = 'rgba(8, 14, 22, 0.75)';
    ctx.beginPath();
    ctx.moveTo(r * tipX * 0.98, 0);
    ctx.lineTo(r * 1.7 * noseLen, r * 0.07 * noseWid);
    ctx.lineTo(r * 0.85 * noseLen, r * 0.05 * noseWid);
    ctx.lineTo(r * 0.85 * noseLen, -r * 0.05 * noseWid);
    ctx.lineTo(r * 1.7 * noseLen, -r * 0.07 * noseWid);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.glow, stage >= 3 ? 0.55 : 0.3);
    ctx.lineWidth = Math.max(0.55, r * 0.035);
    ctx.stroke();
    for (let i = 0; i < 2 + stage; i++) {
      const nx = r * (tipX - 0.35 - i * 0.28 * noseLen);
      if (nx < r * 0.9 * noseLen) break;
      ctx.fillStyle = 'rgba(4, 8, 14, 0.85)';
      ctx.fillRect(nx - r * 0.06, -r * 0.04 * noseWid, r * 0.1, r * 0.08 * noseWid);
      if (stage >= 3) glowDot(ctx, nx, 0, r * 0.025, '#9ef0ff', 0.35 + 0.15 * (i % 2));
    }
  }

  // Enterprise saucer mass on the forward wedge — elongates with the nose, not the beam.
  if (stage >= 1) {
    const sx = r * (0.85 + 0.22 * (noseLen - 1)) * Math.min(noseLen, 1.85);
    const sy = 0;
    const srx = r * (0.55 + 0.28 * (noseLen - 1));
    const sry = r * (0.36 + 0.12 * (noseWid - 1)) * noseWid;
    const saucer = ctx.createRadialGradient(sx - srx * 0.15, sy, 0, sx, sy, srx);
    saucer.addColorStop(0, stage >= 5 ? '#4a6075' : '#354858');
    saucer.addColorStop(0.55, c.hull);
    saucer.addColorStop(1, 'rgba(10, 16, 24, 0)');
    ctx.fillStyle = saucer;
    ctx.beginPath();
    ctx.ellipse(sx, sy, srx, sry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.glow, stage >= 3 ? 0.45 : 0.28);
    ctx.lineWidth = Math.max(0.6, r * 0.04);
    ctx.beginPath();
    ctx.ellipse(sx, sy, srx * 0.92, sry * 0.88, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (stage >= 2) {
      ctx.fillStyle = '#101a28';
      ctx.beginPath();
      ctx.ellipse(sx - srx * 0.08, sy - sry * 0.15, srx * 0.2, sry * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      glowDot(ctx, sx - srx * 0.08, sy - sry * 0.15, r * 0.045, c.glow, 0.65);
    }
  }

  // Terraced Destroyer decks — denser toward the aft.
  const terraceCount = [0, 1, 2, 3, 4, 5][stage];
  for (let i = 0; i < terraceCount; i++) {
    const t = (i + 1) / (terraceCount + 1);
    const x0 = r * (tipX * (1 - t * 0.72) - 0.2 * len);
    const half = r * (0.18 * noseWid + t * beamY * 0.85);
    const h = r * (0.04 + 0.035 * i);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(8, 14, 22, 0.55)' : 'rgba(70, 90, 110, 0.28)';
    ctx.beginPath();
    ctx.moveTo(x0 + r * 0.35 * noseLen, -half);
    ctx.lineTo(x0 - r * 0.15 * len, -half - h);
    ctx.lineTo(x0 - r * 0.55 * len, -half * 0.7);
    ctx.lineTo(x0 - r * 0.55 * len, half * 0.7);
    ctx.lineTo(x0 - r * 0.15 * len, half + h);
    ctx.lineTo(x0 + r * 0.35 * noseLen, half);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 175, 198, 0.18)';
    ctx.lineWidth = Math.max(0.4, r * 0.025);
    ctx.stroke();
  }

  // Lateral weapon trenches (Destroyer side notches).
  if (stage >= 3) {
    for (const sideSign of [-1, 1]) {
      ctx.fillStyle = 'rgba(4, 8, 14, 0.88)';
      ctx.beginPath();
      ctx.moveTo(r * 1.4 * noseLen, sideSign * r * 0.38 * noseWid);
      ctx.lineTo(-r * 0.9 * len, sideSign * r * 0.78 * beamY);
      ctx.lineTo(-r * 0.9 * len, sideSign * r * 0.58 * beamY);
      ctx.lineTo(r * 1.4 * noseLen, sideSign * r * 0.22 * noseWid);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexToRgba(c.glow, 0.35);
      ctx.lineWidth = Math.max(0.5, r * 0.03);
      ctx.stroke();
    }
  }

  // Panel greeble seams for capital scale.
  if (stage >= 2) {
    ctx.strokeStyle = 'rgba(140, 165, 188, 0.22)';
    ctx.lineWidth = Math.max(0.4, r * 0.022);
    ctx.beginPath();
    for (let i = 0; i < 4 + stage; i++) {
      const t = (i + 1) / (5 + stage);
      const x = r * (tipX - (tipX - aftX) * t);
      const half = r * (0.12 * noseWid + t * beamY);
      ctx.moveTo(x, -half * 0.85);
      ctx.lineTo(x, half * 0.85);
    }
    ctx.moveTo(r * 1.8 * noseLen, 0);
    ctx.lineTo(r * aftX + r * 0.2, 0);
    ctx.stroke();
  }

  // Aft command tower (Destroyer bridge + Enterprise island) — detail, not bulk.
  const towerX = -r * (0.55 + 0.08 * (stage >= 5 ? 1 : 0)) * len;
  const towerW = r * ([0.55, 0.58, 0.62, 0.7, 0.82, 0.92][stage]) * wid;
  const towerH = r * ([0.28, 0.3, 0.34, 0.4, 0.5, 0.58][stage]) * wid;
  if (stage >= 1) {
    ctx.fillStyle = stage >= 4 ? '#0a1420' : '#111b28';
    ctx.beginPath();
    ctx.moveTo(towerX + towerW * 0.55, -towerH * 0.15);
    ctx.lineTo(towerX + towerW * 0.15, -towerH);
    ctx.lineTo(towerX - towerW * 0.55, -towerH * 0.85);
    ctx.lineTo(towerX - towerW * 0.35, -towerH * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stage >= 4 ? hexToRgba(c.glow, 0.75) : 'rgba(170, 198, 218, 0.45)';
    ctx.lineWidth = Math.max(0.7, r * 0.05);
    ctx.stroke();
  }
  if (hybrid) {
    // Wide Destroyer bridge shelf.
    ctx.fillStyle = '#152233';
    ctx.fillRect(towerX - towerW * 0.75, -towerH * 1.15, towerW * 1.5, towerH * 0.28);
    ctx.strokeStyle = hexToRgba('#9ef0ff', 0.5);
    ctx.strokeRect(towerX - towerW * 0.75, -towerH * 1.15, towerW * 1.5, towerH * 0.28);
    // Sensor bulbs on bridge corners.
    glowDot(ctx, towerX - towerW * 0.55, -towerH * 1.02, r * 0.06, c.glow, 0.7);
    glowDot(ctx, towerX + towerW * 0.55, -towerH * 1.02, r * 0.06, c.glow, 0.7);
  }

  // Rotating sensor arrays atop the tower.
  const mastY = -towerH * (stage >= 4 ? 1.35 : 1.05);
  const drawArray = (ox, oy, rx, ry, spin) => {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(time / 1800 + spin);
    ctx.strokeStyle = hexToRgba(c.glow, stage >= 4 ? 0.95 : 0.7);
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  drawArray(towerX, mastY, r * (stage >= 4 ? 0.38 : 0.26) * wid, r * 0.1, 0);
  if (stage >= 4) drawArray(towerX, mastY, r * 0.22 * wid, r * 0.055, Math.PI / 5);
  if (stage >= 5) {
    drawArray(towerX - r * 0.45 * len, mastY + r * 0.06, r * 0.24 * wid, r * 0.07, 1.1);
    glowDot(ctx, towerX, mastY, r * 0.07, '#9ef0ff', 0.75 + 0.2 * Math.sin(time / 180));
  }

  // --- WEAPONS anchored on the hull silhouette (suite mounts + late trench accents) ---
  const batterySlots = [
    ...flagshipHardpointAnchors(stage).map((a) => ({
      x: a.x,
      y: a.y,
      scale: a.scale,
      aim: a.aim ?? 0.55,
      ids: [a.id],
    })),
    ...flagshipDecorativeBatteries(stage),
  ];

  for (const bat of batterySlots) {
    let pulse = 0.35;
    if (hardpointFireAt) {
      for (const id of bat.ids) {
        const at = hardpointFireAt[id];
        if (at != null) pulse = Math.max(pulse, Math.max(0, 1 - (time - at) / 280));
      }
    }
    const br = r * 0.075 * bat.scale;
    const bx = bat.x * r;
    const by = bat.y * r;
    // Turret base plate seated on the hull.
    ctx.fillStyle = '#050910';
    ctx.beginPath();
    ctx.ellipse(bx, by, br * 1.15, br * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.hull, 0.85);
    ctx.lineWidth = Math.max(0.5, r * 0.025);
    ctx.stroke();
    glowDot(
      ctx,
      bx,
      by,
      r * 0.045 * bat.scale,
      pulse > 0.5 ? '#9ef0ff' : c.glow,
      0.35 + pulse * 0.65,
    );
    const aim = bat.aim ?? 0.55;
    ctx.strokeStyle = hexToRgba('#e9f5ff', 0.35 + pulse * 0.45);
    ctx.lineWidth = Math.max(0.55, r * 0.028);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + r * 0.18 * bat.scale * aim, by + Math.sign(by || 0) * r * 0.04 * (1 - aim));
    ctx.stroke();
  }

  // Spinal prow lance riding the elongated tip.
  if (stage >= 3) {
    const lanceTip = tipX + (stage >= 5 ? 0.28 : stage >= 4 ? 0.16 : 0.08);
    const lanceRoot = 1.7 * noseLen;
    const lanceThick = (stage >= 5 ? 0.26 : stage >= 4 ? 0.18 : 0.12) * noseWid;
    ctx.fillStyle = 'rgba(10, 18, 28, 0.95)';
    ctx.beginPath();
    ctx.moveTo(r * lanceTip, 0);
    ctx.lineTo(r * lanceRoot, r * lanceThick);
    ctx.lineTo(r * (lanceRoot - 0.25 * noseLen), 0);
    ctx.lineTo(r * lanceRoot, -r * lanceThick * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexToRgba('#9ef0ff', stage >= 5 ? 0.9 : 0.55);
    ctx.lineWidth = Math.max(0.9, r * (stage >= 5 ? 0.08 : 0.045));
    ctx.stroke();
    glowDot(ctx, r * (lanceTip - 0.08), 0, r * (stage >= 5 ? 0.1 : 0.06), '#9ef0ff', 0.92);
  }

  // Mk V sovereign markings + hangar trench.
  if (stage >= 5) {
    ctx.fillStyle = 'rgba(3, 7, 12, 0.92)';
    ctx.fillRect(-r * 0.75 * len, -r * 0.14 * wid, r * 1.35 * len, r * 0.28 * wid);
    ctx.strokeStyle = hexToRgba('#9ef0ff', 0.4);
    ctx.strokeRect(-r * 0.75 * len, -r * 0.14 * wid, r * 1.35 * len, r * 0.28 * wid);

    ctx.strokeStyle = hexToRgba('#ffe08a', 0.65);
    ctx.lineWidth = Math.max(1.1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(r * 1.7 * noseLen, -r * 0.08 * noseWid);
    ctx.lineTo(towerX + r * 0.2, -towerH * 0.4);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      glowDot(
        ctx,
        r * (1.7 * noseLen * (1 - t) + (towerX / r) * t),
        -r * (0.08 * noseWid + t * 0.25 * wid),
        r * 0.05,
        i % 2 ? '#ffe08a' : '#9ef0ff',
        0.55 + 0.35 * Math.sin(time / 150 + i),
      );
    }

    ctx.fillStyle = hexToRgba('#ffe08a', 0.72);
    ctx.beginPath();
    ctx.moveTo(r * tipX * 0.96, 0);
    ctx.lineTo(r * (tipX - 0.55), r * 0.16 * noseWid);
    ctx.lineTo(r * (tipX - 0.4), 0);
    ctx.lineTo(r * (tipX - 0.55), -r * 0.16 * noseWid);
    ctx.closePath();
    ctx.fill();
    glowDot(ctx, r * (tipX - 0.22), 0, r * 0.1 * noseWid, '#ffe08a', 0.88);
  } else if (stage >= 4) {
    ctx.strokeStyle = hexToRgba('#ffe08a', 0.32);
    ctx.lineWidth = Math.max(0.6, r * 0.04);
    ctx.beginPath();
    ctx.moveTo(r * 1.6 * noseLen, r * 0.12 * noseWid);
    ctx.lineTo(-r * 0.9 * len, r * 0.55 * beamY);
    ctx.stroke();
  }

  // Deck windows / nav lights.
  ctx.strokeStyle = hexToRgba(c.glow, stage >= 4 ? 0.48 : 0.35);
  ctx.lineWidth = Math.max(0.45, r * 0.028);
  ctx.beginPath();
  ctx.moveTo(r * 1.7 * noseLen, r * 0.08 * noseWid);
  ctx.lineTo(-r * 1.1 * len, r * 0.55 * beamY);
  ctx.moveTo(r * 1.5 * noseLen, -r * 0.1 * noseWid);
  ctx.lineTo(-r * 1.1 * len, -r * 0.5 * beamY);
  if (stage >= 3) {
    ctx.moveTo(r * 2.1 * noseLen, 0);
    ctx.lineTo(-r * 0.4 * len, r * 0.25 * wid);
  }
  ctx.stroke();
  const blink = (phase) => 0.22 + 0.78 * (Math.sin(time / 520 + phase) > 0.62 ? 1 : 0.08);
  glowDot(ctx, r * aftX * 0.85, r * beamY * 0.7, r * 0.045, '#ff6f6f', blink(0));
  glowDot(ctx, r * aftX * 0.85, -r * beamY * 0.7, r * 0.045, '#7dffa8', blink(2.1));
  glowDot(ctx, r * tipX * 0.88, 0, r * 0.045 * noseWid, '#e9f5ff', blink(4.2));
  if (stage >= 4) {
    glowDot(ctx, towerX, -towerH * 1.05, r * 0.05, '#9ef0ff', blink(1.2));
  }

  if (hpFraction < 0.72) {
    const severity = 1 - hpFraction;
    for (const [x, y, phase] of [[0.55, 0.25, 0], [-0.7, -0.35, 2.4], [1.4, -0.12, 4.7]]) {
      if (severity * 3 < phase / 2.5) continue;
      const px = x * r * (x > 0.8 ? noseLen : len);
      const py = y * r * (x > 0.8 ? noseWid : wid);
      const soot = ctx.createRadialGradient(px, py, 0, px, py, r * 0.34);
      soot.addColorStop(0, 'rgba(0,0,0,0.72)');
      soot.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = soot;
      ctx.beginPath();
      ctx.arc(px, py, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      if (hpFraction < 0.42) glowDot(ctx, px, py, r * 0.055, '#ff8b52', 0.45 + 0.3 * Math.sin(time / 95 + phase));
    }
  }
}

// ============================= WHISPER SHUTTLE =============================
// Foundation whisper ship: black organic dart with two great sweep wings
// that fold on landing and flutter in flight.

export function drawShuttleModel(ctx, r, opts = {}) {
  const {
    wingSpread = 1,
    thrusting = false,
    time = performance.now(),
    seed = 0,
  } = opts;

  // In-flight flutter — soft wing beat layered on the deploy amount.
  const flutter = wingSpread > 0.05
    ? 0.08 * Math.sin(time / 160 + seed) * wingSpread
    : 0;
  const spread = Math.max(0, Math.min(1.15, wingSpread + flutter));

  // Ion wake.
  if (thrusting) {
    const flicker = 0.75 + 0.25 * Math.sin(time / 38 + seed);
    engineFlame(ctx, -r * 1.15, 0, r * 2.1, r * 0.34, '#9a7aff', flicker);
    engineFlame(ctx, -r * 1.15, 0, r * 1.2, r * 0.2, '#d8ccff', flicker);
  }

  // --- Wings: root at mid-body, tip interpolates folded -> spread ---
  for (const s of [1, -1]) {
    const rootX = r * 0.32;
    const rootY = s * r * 0.14;
    // Folded: tucked along the tail. Spread: swept out and back like a manta.
    const tipX = -r * (1.35 - 0.5 * spread);
    const tipY = s * r * (0.28 + 1.5 * spread);
    const midX = rootX - r * 0.25 + r * 0.15 * spread;
    const midY = s * r * (0.2 + 0.9 * spread);

    const wg = ctx.createLinearGradient(rootX, rootY, tipX, tipY);
    wg.addColorStop(0, '#1a2338');
    wg.addColorStop(0.6, '#0e1424');
    wg.addColorStop(1, '#070b16');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.quadraticCurveTo(midX + r * 0.5, midY, tipX, tipY);
    ctx.quadraticCurveTo(tipX - r * 0.15, tipY - s * r * 0.35 * spread, -r * 1.05, s * r * 0.16);
    ctx.closePath();
    ctx.fill();
    // Luminous leading edge.
    ctx.strokeStyle = hexToRgba('#b8d8ff', 0.35 + 0.35 * spread);
    ctx.lineWidth = Math.max(0.5, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.quadraticCurveTo(midX + r * 0.5, midY, tipX, tipY);
    ctx.stroke();
    // Wingtip light.
    glowDot(ctx, tipX, tipY, r * 0.07, '#9ad0ff', 0.5 + 0.5 * spread);
  }

  // --- Central body: slender obsidian leaf ---
  const bg = ctx.createLinearGradient(-r * 1.3, 0, r * 1.7, 0);
  bg.addColorStop(0, '#0a0f1c');
  bg.addColorStop(0.55, '#161f34');
  bg.addColorStop(1, '#2a3652');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(r * 1.7, 0);
  ctx.quadraticCurveTo(r * 0.5, r * 0.42, -r * 0.8, r * 0.3);
  ctx.quadraticCurveTo(-r * 1.35, r * 0.12, -r * 1.35, 0);
  ctx.quadraticCurveTo(-r * 1.35, -r * 0.12, -r * 0.8, -r * 0.3);
  ctx.quadraticCurveTo(r * 0.5, -r * 0.42, r * 1.7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hexToRgba('#8fb8e8', 0.5);
  ctx.lineWidth = Math.max(0.5, r * 0.055);
  ctx.stroke();

  // Dorsal seam light.
  ctx.strokeStyle = hexToRgba('#c8e4ff', 0.55);
  ctx.lineWidth = Math.max(0.4, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(r * 1.45, 0);
  ctx.lineTo(-r * 1.1, 0);
  ctx.stroke();

  // Cockpit sliver near the nose.
  const pulse = 0.7 + 0.3 * Math.sin(time / 520 + seed);
  ctx.save();
  ctx.shadowColor = '#bfe0ff';
  ctx.shadowBlur = r * 0.8;
  ctx.fillStyle = hexToRgba('#dff0ff', 0.85 * pulse);
  ctx.beginPath();
  ctx.ellipse(r * 0.95, 0, r * 0.28, r * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============================= COMBAT HULLS =============================

function drawScoutModel(ctx, r, c) {
  // Recon dart: slim fuselage, forward canards, single big sensor eye.
  engineDotPair(ctx, r, c, [[-r * 1.05, 0]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.55, 0);
  ctx.lineTo(r * 0.2, r * 0.34);
  ctx.lineTo(-r * 0.65, r * 0.28);
  ctx.lineTo(-r * 1.05, r * 0.5);
  ctx.lineTo(-r * 0.85, 0);
  ctx.lineTo(-r * 1.05, -r * 0.5);
  ctx.lineTo(-r * 0.65, -r * 0.28);
  ctx.lineTo(r * 0.2, -r * 0.34);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  // Canards.
  ctx.strokeStyle = hexToRgba(c.stroke, 0.7);
  ctx.lineWidth = Math.max(0.6, r * 0.09);
  ctx.beginPath();
  ctx.moveTo(r * 0.75, r * 0.2);
  ctx.lineTo(r * 0.45, r * 0.62);
  ctx.moveTo(r * 0.75, -r * 0.2);
  ctx.lineTo(r * 0.45, -r * 0.62);
  ctx.stroke();
  glowDot(ctx, r * 0.85, 0, r * 0.16, c.glow, 0.9);
}

function drawCorvetteModel(ctx, r, c) {
  // Twin-prong interceptor.
  engineDotPair(ctx, r, c, [[-r * 0.95, r * 0.3], [-r * 0.95, -r * 0.3]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.5, r * 0.12);
  ctx.lineTo(r * 0.55, r * 0.5);
  ctx.lineTo(-r * 0.95, r * 0.62);
  ctx.lineTo(-r * 0.7, 0);
  ctx.lineTo(-r * 0.95, -r * 0.62);
  ctx.lineTo(r * 0.55, -r * 0.5);
  ctx.lineTo(r * 1.5, -r * 0.12);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  // Notched nose split (twin prongs).
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = Math.max(0.7, r * 0.1);
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(r * 0.4, 0);
  ctx.stroke();
  glowDot(ctx, r * 0.15, 0, r * 0.14, c.glow, 0.85);
}

function drawFrigateModel(ctx, r, c) {
  // Blade escort with angled stabilizers.
  engineDotPair(ctx, r, c, [[-r * 1.2, r * 0.2], [-r * 1.2, -r * 0.2]]);
  // Stabilizer fins.
  ctx.fillStyle = hexToRgba(c.hull, 0.9);
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(r * 0.1, s * r * 0.3);
    ctx.lineTo(-r * 0.9, s * r * 0.95);
    ctx.lineTo(-r * 1.1, s * r * 0.55);
    ctx.lineTo(-r * 0.7, s * r * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.stroke, 0.45);
    ctx.lineWidth = Math.max(0.5, r * 0.05);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(r * 1.7, 0);
  ctx.lineTo(r * 0.35, r * 0.36);
  ctx.lineTo(-r * 1.2, r * 0.42);
  ctx.lineTo(-r * 1.05, 0);
  ctx.lineTo(-r * 1.2, -r * 0.42);
  ctx.lineTo(r * 0.35, -r * 0.36);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  seamLine(ctx, r * 1.4, 0, -r * 0.9, 0, c);
  glowDot(ctx, r * 0.55, 0, r * 0.13, c.glow, 0.85);
}

function drawDestroyerModel(ctx, r, c) {
  // Heavy wedge with dorsal turret spine.
  engineDotPair(ctx, r, c, [[-r * 1.35, 0], [-r * 1.25, r * 0.45], [-r * 1.25, -r * 0.45]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.9, 0);
  ctx.lineTo(r * 0.5, r * 0.42);
  ctx.lineTo(-r * 0.5, r * 0.55);
  ctx.lineTo(-r * 1.3, r * 0.85);
  ctx.lineTo(-r * 1.35, r * 0.25);
  ctx.lineTo(-r * 1.35, -r * 0.25);
  ctx.lineTo(-r * 1.3, -r * 0.85);
  ctx.lineTo(-r * 0.5, -r * 0.55);
  ctx.lineTo(r * 0.5, -r * 0.42);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  // Armor plate overlay.
  ctx.fillStyle = hexToRgba(c.deck, 0.6);
  ctx.beginPath();
  ctx.moveTo(r * 1.1, 0);
  ctx.lineTo(-r * 0.2, r * 0.3);
  ctx.lineTo(-r * 1.1, r * 0.32);
  ctx.lineTo(-r * 1.1, -r * 0.32);
  ctx.lineTo(-r * 0.2, -r * 0.3);
  ctx.closePath();
  ctx.fill();
  // Turret spine.
  for (const tx of [r * 0.55, r * 0.05, -r * 0.45, -r * 0.9]) {
    glowDot(ctx, tx, 0, r * 0.09, c.stroke, 0.8);
  }
  seamLine(ctx, r * 0.6, r * 0.38, -r * 1.15, r * 0.55, c);
  seamLine(ctx, r * 0.6, -r * 0.38, -r * 1.15, -r * 0.55, c);
}

function drawCruiserModel(ctx, r, c) {
  // Line battleship: prow blade, long spine, side sponsons, heavy stern.
  engineDotPair(ctx, r, c, [[-r * 1.5, r * 0.28], [-r * 1.5, -r * 0.28], [-r * 1.55, 0]]);
  // Side sponsons.
  ctx.fillStyle = hexToRgba(c.hull, 0.95);
  for (const s of [1, -1]) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-r * 0.85, s * r * 0.5 - r * 0.14, r * 1.15, r * 0.32, r * 0.12);
    else ctx.rect(-r * 0.85, s * r * 0.5 - r * 0.14, r * 1.15, r * 0.32);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.stroke, 0.5);
    ctx.lineWidth = Math.max(0.5, r * 0.045);
    ctx.stroke();
  }
  // Main hull.
  ctx.beginPath();
  ctx.moveTo(r * 1.85, 0);
  ctx.lineTo(r * 1.1, r * 0.28);
  ctx.lineTo(r * 0.2, r * 0.44);
  ctx.lineTo(-r * 1.45, r * 0.4);
  ctx.lineTo(-r * 1.55, 0);
  ctx.lineTo(-r * 1.45, -r * 0.4);
  ctx.lineTo(r * 0.2, -r * 0.44);
  ctx.lineTo(r * 1.1, -r * 0.28);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  // Command tower.
  ctx.fillStyle = c.deck;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-r * 0.55, -r * 0.16, r * 0.75, r * 0.32, r * 0.1);
  else ctx.rect(-r * 0.55, -r * 0.16, r * 0.75, r * 0.32);
  ctx.fill();
  seamLine(ctx, r * 1.55, 0, r * 0.35, 0, c);
  glowDot(ctx, -r * 0.15, 0, r * 0.12, c.glow, 0.9);
  // Broadside battery lights.
  for (const s of [1, -1]) {
    for (const bx of [-r * 0.6, -r * 0.25, r * 0.1]) {
      glowDot(ctx, bx, s * r * 0.5, r * 0.05, c.stroke, 0.75);
    }
  }
}

function drawCarrierModel(ctx, r, c, time) {
  // Fleet carrier: slab hull with luminous flight deck + island.
  engineDotPair(ctx, r, c, [[-r * 1.4, r * 0.4], [-r * 1.4, 0], [-r * 1.4, -r * 0.4]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.45, -r * 0.55);
  ctx.lineTo(r * 1.6, 0);
  ctx.lineTo(r * 1.45, r * 0.55);
  ctx.lineTo(r * 1.0, r * 0.9);
  ctx.lineTo(-r * 1.35, r * 0.8);
  ctx.lineTo(-r * 1.45, 0);
  ctx.lineTo(-r * 1.35, -r * 0.8);
  ctx.lineTo(r * 1.0, -r * 0.9);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  // Flight deck — recessed strip with animated approach lights.
  ctx.fillStyle = hexToRgba(c.dark, 0.9);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-r * 1.15, -r * 0.2, r * 2.4, r * 0.4, r * 0.08);
  else ctx.rect(-r * 1.15, -r * 0.2, r * 2.4, r * 0.4);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(c.glow, 0.5);
  ctx.lineWidth = Math.max(0.5, r * 0.04);
  ctx.stroke();
  const scroll = (time / 250) % 1;
  for (let i = 0; i < 6; i++) {
    const t = (i / 6 + scroll) % 1;
    glowDot(ctx, -r * 1.05 + t * r * 2.2, 0, r * 0.05, c.glow, 0.4 + 0.6 * t);
  }
  // Island tower.
  ctx.fillStyle = c.deck;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r * 0.15, r * 0.32, r * 0.55, r * 0.34, r * 0.08);
  else ctx.rect(r * 0.15, r * 0.32, r * 0.55, r * 0.34);
  ctx.fill();
  glowDot(ctx, r * 0.42, r * 0.49, r * 0.07, c.glow, 0.85);
}

function drawFighterModel(ctx, r, c) {
  // Strike dart with swept wing blades.
  engineDotPair(ctx, r, c, [[-r * 0.75, 0]]);
  ctx.fillStyle = hexToRgba(c.hull, 0.95);
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(r * 0.35, s * r * 0.1);
    ctx.lineTo(-r * 0.65, s * r * 0.75);
    ctx.lineTo(-r * 0.55, s * r * 0.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(r * 1.35, 0);
  ctx.lineTo(r * 0.1, r * 0.26);
  ctx.lineTo(-r * 0.8, r * 0.2);
  ctx.lineTo(-r * 0.65, 0);
  ctx.lineTo(-r * 0.8, -r * 0.2);
  ctx.lineTo(r * 0.1, -r * 0.26);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c, 0.16);
  glowDot(ctx, r * 0.55, 0, r * 0.11, c.glow, 0.9);
}

function drawBomberModel(ctx, r, c) {
  // Thick delta with underslung ordnance pods.
  engineDotPair(ctx, r, c, [[-r * 0.85, r * 0.28], [-r * 0.85, -r * 0.28]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.2, 0);
  ctx.lineTo(-r * 0.35, r * 0.85);
  ctx.lineTo(-r * 0.95, r * 0.6);
  ctx.lineTo(-r * 0.7, 0);
  ctx.lineTo(-r * 0.95, -r * 0.6);
  ctx.lineTo(-r * 0.35, -r * 0.85);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c, 0.14);
  // Ordnance pods.
  ctx.fillStyle = c.dark;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, s * r * 0.45, r * 0.32, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    glowDot(ctx, r * 0.12, s * r * 0.45, r * 0.06, '#ffb46b', 0.85);
  }
  glowDot(ctx, r * 0.7, 0, r * 0.12, c.glow, 0.85);
}

function drawHealerModel(ctx, r, c, time) {
  // Mercy ship: rounded pod, pulsing cross, rotating stabilizer halo.
  const pulse = 0.65 + 0.35 * Math.sin(time / 420);
  engineDotPair(ctx, r, c, [[-r * 0.95, 0]]);
  // Rotating halo.
  ctx.save();
  ctx.rotate(time / 2400);
  ctx.strokeStyle = hexToRgba(c.glow, 0.3 + 0.25 * pulse);
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ctx.setLineDash([r * 0.55, r * 0.35]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // Rounded hull pod.
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r * 0.85);
  g.addColorStop(0, c.deck);
  g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.9, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(c.stroke, 0.7);
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.stroke();
  // Bow sensor.
  glowDot(ctx, r * 0.75, 0, r * 0.1, c.glow, 0.8);
  // Pulsing medical cross.
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = r * 0.6 * pulse;
  ctx.strokeStyle = hexToRgba(c.glow, 0.55 + 0.4 * pulse);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(-r * 0.38, 0);
  ctx.lineTo(r * 0.38, 0);
  ctx.moveTo(0, -r * 0.38);
  ctx.lineTo(0, r * 0.38);
  ctx.stroke();
  ctx.restore();
}

// --- shared hull helpers ---

function strokeHull(ctx, r, c, w = 0.07) {
  ctx.strokeStyle = hexToRgba(c.stroke, 0.8);
  ctx.lineWidth = Math.max(0.7, r * w);
  ctx.stroke();
}

function seamLine(ctx, x1, y1, x2, y2, c) {
  ctx.strokeStyle = hexToRgba(c.glow, 0.4);
  ctx.lineWidth = Math.max(0.4, Math.abs(x1 - x2) * 0.02);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function engineDotPair(ctx, r, c, points) {
  for (const [x, y] of points) {
    glowDot(ctx, x, y, r * 0.1, c.engine, 0.75);
  }
}

function drawPatrolCutterModel(ctx, r, c) {
  ctx.save();
  ctx.scale(0.88, 0.88);
  drawCorvetteModel(ctx, r, c);
  ctx.restore();
}

function drawBattleshipModel(ctx, r, c) {
  ctx.save();
  ctx.scale(1.08, 1.08);
  drawCruiserModel(ctx, r, c);
  ctx.restore();
  glowDot(ctx, r * 1.2, 0, r * 0.1, c.glow, 0.85);
}

function drawDreadnoughtModel(ctx, r, c) {
  ctx.save();
  ctx.scale(1.18, 1.18);
  drawDestroyerModel(ctx, r, c);
  ctx.restore();
  for (const bx of [-r * 0.5, 0, r * 0.5]) glowDot(ctx, bx, 0, r * 0.08, c.stroke, 0.8);
}

function drawFleetCarrierModel(ctx, r, c, time) {
  ctx.save();
  ctx.scale(1.08, 1.08);
  drawCarrierModel(ctx, r, c, time);
  ctx.restore();
}

function drawSuperCarrierModel(ctx, r, c, time) {
  ctx.save();
  ctx.scale(1.2, 1.2);
  drawCarrierModel(ctx, r, c, time);
  ctx.restore();
}

function drawTransportModel(ctx, r, c, wide = 1) {
  engineDotPair(ctx, r, c, [[-r * 1.1, 0]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.2, 0);
  ctx.lineTo(r * 0.4, r * 0.35 * wide);
  ctx.lineTo(-r * 1.0, r * 0.42 * wide);
  ctx.lineTo(-r * 1.15, 0);
  ctx.lineTo(-r * 1.0, -r * 0.42 * wide);
  ctx.lineTo(r * 0.4, -r * 0.35 * wide);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  ctx.fillStyle = hexToRgba(c.dark, 0.85);
  ctx.fillRect(-r * 0.55, -r * 0.18 * wide, r * 1.0, r * 0.36 * wide);
}

function drawLightHaulerModel(ctx, r, c) {
  drawTransportModel(ctx, r, c, 0.85);
}

function drawBulkFreighterModel(ctx, r, c) {
  drawTransportModel(ctx, r, c, 1.25);
  ctx.fillStyle = hexToRgba(c.deck, 0.7);
  ctx.fillRect(-r * 0.3, -r * 0.55, r * 0.5, r * 1.1);
}

function drawArmoredConvoyModel(ctx, r, c) {
  drawTransportModel(ctx, r, c, 1.0);
  ctx.strokeStyle = hexToRgba(c.stroke, 0.6);
  ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.strokeRect(-r * 0.7, -r * 0.35, r * 1.2, r * 0.7);
}

function drawInterceptorModel(ctx, r, c) {
  ctx.save();
  ctx.scale(0.92, 0.92);
  drawFighterModel(ctx, r, c);
  ctx.restore();
}

function drawHeavyFighterModel(ctx, r, c) {
  ctx.save();
  ctx.scale(1.12, 1.12);
  drawFighterModel(ctx, r, c);
  ctx.restore();
}

function drawSensorShipModel(ctx, r, c, time) {
  engineDotPair(ctx, r, c, [[-r * 0.85, 0]]);
  ctx.beginPath();
  ctx.moveTo(r * 1.1, 0);
  ctx.lineTo(-r * 0.5, r * 0.35);
  ctx.lineTo(-r * 0.95, 0);
  ctx.lineTo(-r * 0.5, -r * 0.35);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  const dish = 0.7 + 0.15 * Math.sin(time / 600);
  ctx.strokeStyle = hexToRgba(c.glow, 0.7);
  ctx.lineWidth = Math.max(0.6, r * 0.08);
  ctx.beginPath();
  ctx.arc(r * 0.15, 0, r * 0.35 * dish, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  glowDot(ctx, r * 0.15, 0, r * 0.08, c.glow, 0.9);
}

function drawBuilderShipModel(ctx, r, c) {
  engineDotPair(ctx, r, c, [[-r * 1.0, r * 0.25], [-r * 1.0, -r * 0.25]]);
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-r * 0.9, -r * 0.38, r * 1.7, r * 0.76, r * 0.12);
  else ctx.rect(-r * 0.9, -r * 0.38, r * 1.7, r * 0.76);
  ctx.fill();
  strokeHull(ctx, r, c);
  ctx.strokeStyle = c.glow;
  ctx.lineWidth = Math.max(0.7, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(r * 0.2, -r * 0.38);
  ctx.lineTo(r * 0.2, -r * 0.85);
  ctx.lineTo(r * 0.55, -r * 0.85);
  ctx.stroke();
  glowDot(ctx, r * 0.55, -r * 0.85, r * 0.07, c.glow, 0.85);
}

function drawCommandCruiserModel(ctx, r, c) {
  drawCruiserModel(ctx, r, c);
  ctx.fillStyle = c.deck;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-r * 0.1, -r * 0.55, r * 0.45, r * 0.35, r * 0.08);
  else ctx.rect(-r * 0.1, -r * 0.55, r * 0.45, r * 0.35);
  ctx.fill();
  glowDot(ctx, r * 0.1, -r * 0.38, r * 0.09, c.glow, 0.9);
}

function drawMinerModel(ctx, r, c, time) {
  engineDotPair(ctx, r, c, [[-r * 0.75, 0]]);
  ctx.beginPath();
  ctx.moveTo(r * 0.9, 0);
  ctx.lineTo(-r * 0.4, r * 0.42);
  ctx.lineTo(-r * 0.85, 0);
  ctx.lineTo(-r * 0.4, -r * 0.42);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  strokeHull(ctx, r, c);
  const spin = time / 800;
  ctx.save();
  ctx.translate(r * 0.35, 0);
  ctx.rotate(spin);
  ctx.strokeStyle = hexToRgba(c.glow, 0.75);
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.35, 0);
    ctx.stroke();
    ctx.rotate(Math.PI / 2);
  }
  ctx.restore();
}

function drawHeroFlagshipModel(ctx, r, colors, time = performance.now()) {
  const flicker = 0.85 + 0.15 * Math.sin(time / 55);
  ctx.fillStyle = colors.hull;
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.moveTo(r * 1.1, 0);
  ctx.lineTo(-r * 0.35, r * 0.55);
  ctx.lineTo(-r * 0.85, r * 0.35);
  ctx.lineTo(-r * 1.0, 0);
  ctx.lineTo(-r * 0.85, -r * 0.35);
  ctx.lineTo(-r * 0.35, -r * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hexToRgba(THEME.accentGold, 0.35 + 0.2 * flicker);
  ctx.beginPath();
  ctx.arc(r * 0.15, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  engineFlame(ctx, -r * 1.05, 0, r * 1.4, r * 0.28, colors.engine, flicker);
}

function drawHullRefitAccent(ctx, hull, r, c, refitId) {
  if (!refitId) return;
  ctx.save();
  if (hull === 'corvette' && refitId === 'hardening') {
    ctx.strokeStyle = hexToRgba(c.stroke, 0.75);
    ctx.lineWidth = Math.max(0.7, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(r * 0.9, r * 0.28);
    ctx.lineTo(-r * 0.55, r * 0.48);
    ctx.moveTo(r * 0.9, -r * 0.28);
    ctx.lineTo(-r * 0.55, -r * 0.48);
    ctx.stroke();
  } else if (hull === 'destroyer' && refitId === 'torpedo') {
    for (const y of [0.22, -0.22]) {
      ctx.fillStyle = '#050910';
      ctx.fillRect(-r * 0.15, r * (y - 0.06), r * 0.95, r * 0.12);
      glowDot(ctx, r * 0.75, r * y, r * 0.05, c.glow, 0.8);
    }
  } else if (hull === 'frigate' && refitId === 'alloy') {
    ctx.fillStyle = 'rgba(120, 150, 175, 0.4)';
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(r * 0.2, r * 0.22);
    ctx.lineTo(-r * 0.6, r * 0.18);
    ctx.lineTo(-r * 0.5, 0);
    ctx.lineTo(-r * 0.6, -r * 0.18);
    ctx.lineTo(r * 0.2, -r * 0.22);
    ctx.closePath();
    ctx.fill();
  } else if (hull === 'cruiser' && refitId === 'beam') {
    ctx.strokeStyle = hexToRgba(c.glow, 0.85);
    ctx.lineWidth = Math.max(0.8, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(r * 1.55, 0);
    ctx.lineTo(r * 0.35, 0);
    ctx.stroke();
    glowDot(ctx, r * 1.5, 0, r * 0.07, '#9ef0ff', 0.9);
  } else if (hull === 'battleship' && refitId === 'siege') {
    for (const y of [0.28, -0.28]) {
      ctx.fillStyle = '#0a1018';
      ctx.beginPath();
      ctx.moveTo(r * 0.9, r * y);
      ctx.lineTo(r * 0.2, r * (y + 0.1));
      ctx.lineTo(r * 0.2, r * (y - 0.1));
      ctx.closePath();
      ctx.fill();
      glowDot(ctx, r * 0.85, r * y, r * 0.05, c.glow, 0.75);
    }
  } else if (hull === 'dreadnought' && refitId === 'plate') {
    ctx.strokeStyle = hexToRgba(c.stroke, 0.65);
    ctx.lineWidth = Math.max(0.8, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(r * 1.2, r * 0.2);
    ctx.lineTo(-r * 0.9, r * 0.45);
    ctx.moveTo(r * 1.2, -r * 0.2);
    ctx.lineTo(-r * 0.9, -r * 0.45);
    ctx.stroke();
  } else if ((hull === 'light_carrier' && refitId === 'hangar')
    || (hull === 'fleet_carrier' && refitId === 'bombers')) {
    ctx.strokeStyle = hexToRgba(c.glow, 0.55);
    ctx.lineWidth = Math.max(0.6, r * 0.06);
    ctx.strokeRect(-r * 0.55, -r * 0.22, r * 1.1, r * 0.44);
  } else if (hull === 'healer' && refitId === 'hospital') {
    ctx.strokeStyle = hexToRgba('#7dffa8', 0.8);
    ctx.lineWidth = Math.max(0.7, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.28);
    ctx.lineTo(0, r * 0.28);
    ctx.moveTo(-r * 0.22, 0);
    ctx.lineTo(r * 0.22, 0);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEmpireHullMark(ctx, r, c) {
  ctx.save();
  ctx.strokeStyle = hexToRgba('#ffe08a', 0.45);
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(r * 0.85, r * 0.12);
  ctx.lineTo(-r * 0.5, r * 0.22);
  ctx.stroke();
  glowDot(ctx, r * 0.7, r * 0.1, r * 0.04, '#ffe08a', 0.55);
  ctx.restore();
}

function drawHullShape(ctx, hull, r, colors, time, drawOpts = {}) {
  const refitId = drawOpts.refitId || null;
  const hullStage = drawOpts.hullStage || 0;
  switch (hull) {
    case 'patrol_cutter': drawPatrolCutterModel(ctx, r, colors); break;
    case 'frigate': drawFrigateModel(ctx, r, colors); break;
    case 'destroyer': drawDestroyerModel(ctx, r, colors); break;
    case 'cruiser': drawCruiserModel(ctx, r, colors); break;
    case 'battleship': drawBattleshipModel(ctx, r, colors); break;
    case 'dreadnought': drawDreadnoughtModel(ctx, r, colors); break;
    case 'light_carrier': drawCarrierModel(ctx, r, colors, time); break;
    case 'fleet_carrier': drawFleetCarrierModel(ctx, r, colors, time); break;
    case 'super_carrier': drawSuperCarrierModel(ctx, r, colors, time); break;
    case 'light_hauler': drawLightHaulerModel(ctx, r, colors); break;
    case 'bulk_freighter': drawBulkFreighterModel(ctx, r, colors); break;
    case 'armored_convoy': drawArmoredConvoyModel(ctx, r, colors); break;
    case 'fighter': drawFighterModel(ctx, r, colors); break;
    case 'interceptor': drawInterceptorModel(ctx, r, colors); break;
    case 'heavy_fighter': drawHeavyFighterModel(ctx, r, colors); break;
    case 'bomber': drawBomberModel(ctx, r, colors); break;
    case 'healer': drawHealerModel(ctx, r, colors, time); break;
    case 'sensor_ship': drawSensorShipModel(ctx, r, colors, time); break;
    case 'builder_ship': drawBuilderShipModel(ctx, r, colors); break;
    case 'command_cruiser': drawCommandCruiserModel(ctx, r, colors); break;
    case 'miner': drawMinerModel(ctx, r, colors, time); break;
    case 'flagship':
      drawFlagshipModel(ctx, r * 0.85 * flagshipVisualScale(hullStage), {
        time,
        side: drawOpts.side || 'player',
        hullStage,
        hardpointFireAt: drawOpts.hardpointFireAt ?? null,
        hpFraction: drawOpts.hpFraction ?? 1,
      });
      break;
    case 'hero_flagship': drawHeroFlagshipModel(ctx, r, colors, time); break;
    case 'corvette': drawCorvetteModel(ctx, r, colors); break;
    case 'scout':
    default:
      drawScoutModel(ctx, r, colors);
      break;
  }
  drawHullRefitAccent(ctx, hull, r, colors, refitId);
  if (drawOpts.empireMark && hull !== 'flagship') drawEmpireHullMark(ctx, r, colors);
}

export function hullRenderScale(hull) {
  return HULL_RENDER[hull]?.scale ?? 1;
}

export function drawHullSprite(ctx, x, y, hull, baseR, opts = {}) {
  const {
    heading = 0,
    side = 'player',
    hp = 1,
    maxHp = 1,
    shield = 0,
    maxShield = 0,
    showHp = true,
    alwaysShowBars = false,
    refitId = null,
    hullStage = 0,
    empireMark = false,
    hardpointFireAt = null,
  } = opts;

  const scale = hullRenderScale(hull);
  const r = baseR * scale;
  const colors = hullColors(hull, side);
  const time = performance.now();
  const drawOpts = {
    refitId,
    hullStage,
    empireMark,
    side,
    hardpointFireAt,
    hpFraction: maxHp > 0 ? Math.max(0, hp / maxHp) : 1,
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  if (ANIMATED_HULLS.has(hull) || hull === 'flagship' || hardpointFireAt) {
    drawHullShape(ctx, hull, r, colors, time, drawOpts);
  } else {
    const cached = cacheHullBitmap(hull, side, r, drawOpts);
    // Scale bucket bitmap to the exact requested radius so zoom is continuous.
    const s = cached.r > 0 ? r / cached.r : 1;
    const half = cached.half * s;
    ctx.drawImage(cached.canvas, -half, -half, cached.canvas.width * s, cached.canvas.height * s);
  }
  ctx.restore();

  if (showHp) {
    drawStatusBars(ctx, x, y, r, {
      hp, maxHp, shield, maxShield, alwaysShow: alwaysShowBars,
    });
  }
}

/** Fast tactical marker for large battles. Avoids shadows, gradients, and cached bitmap lookups. */
export function drawHullSpriteLite(ctx, x, y, hull, baseR, opts = {}) {
  const {
    heading = 0,
    side = 'player',
    hp = 1,
    maxHp = 1,
    shield = 0,
    maxShield = 0,
    showHp = false,
    alwaysShowBars = false,
    alpha = 1,
  } = opts;
  const scale = hullRenderScale(hull);
  const r = Math.max(2.5, baseR * scale * 0.78);
  const colors = hullColors(hull, side);
  const accent = side === 'enemy'
    ? THEME.battle.enemy
    : side === 'ai'
      ? THEME.battle.ai
      : THEME.battle.player;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = colors.hull;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(0.75, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(r * 1.35, 0);
  ctx.lineTo(-r * 0.85, r * 0.62);
  ctx.lineTo(-r * 0.45, 0);
  ctx.lineTo(-r * 0.85, -r * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (hull === 'healer') {
    ctx.strokeStyle = THEME.accentGreen;
    ctx.lineWidth = Math.max(0.8, r * 0.13);
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.42);
    ctx.lineTo(-r * 0.1, r * 0.42);
    ctx.moveTo(-r * 0.52, 0);
    ctx.lineTo(r * 0.32, 0);
    ctx.stroke();
  } else if (hull.includes('carrier')) {
    ctx.strokeStyle = hexToRgba(accent, 0.55);
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.62);
    ctx.lineTo(-r * 0.15, r * 0.62);
    ctx.stroke();
  }

  ctx.restore();
  if (showHp) {
    drawStatusBars(ctx, x, y, r, {
      hp, maxHp, shield, maxShield, alwaysShow: alwaysShowBars,
    });
  }
}

/** Flagship sprite at a screen position/heading (system + galaxy views). */
export function drawFlagshipSprite(ctx, x, y, heading, r, thrusting, hp = 1, maxHp = 1, opts = {}) {
  const hullStage = opts.hullStage ?? 0;
  const drawR = r * flagshipVisualScale(hullStage);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  drawFlagshipModel(ctx, drawR, {
    thrusting,
    time: opts.time ?? performance.now(),
    hpFraction: maxHp > 0 ? Math.max(0, hp / maxHp) : 1,
    hardpointFireAt: opts.hardpointFireAt ?? null,
    hullStage,
    side: opts.side ?? 'player',
  });
  ctx.restore();
}

/** Hero flagship sprite (galaxy + system views). */
export function drawHeroFlagshipSprite(ctx, x, y, heading, r, hp = 1, maxHp = 1) {
  const colors = hullColors('hero_flagship', 'player');
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  drawHeroFlagshipModel(ctx, r, colors, performance.now());
  ctx.restore();
  drawStatusBars(ctx, x, y, r, { hp, maxHp, alwaysShow: false });
}

/** Whisper-ship shuttle sprite. */
export function drawShuttleSprite(ctx, x, y, heading, r, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  drawShuttleModel(ctx, r, opts);
  ctx.restore();
}

/** Scout sprite with selection highlight (galaxy roster). */
export function drawScoutSprite(ctx, x, y, angle, r, selected) {
  const colors = hullColors('scout', 'player');
  if (selected) {
    colors.stroke = THEME.accentGreen;
    colors.glow = THEME.accentGreen;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.shadowColor = hexToRgba(colors.glow, 0.4);
  ctx.shadowBlur = r * 0.4;
  drawScoutModel(ctx, r, colors);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawFleetFormationGlyph(ctx, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = hexToRgba(color, 0.45);
  ctx.lineWidth = 0.45;

  ctx.beginPath();
  ctx.moveTo(0, -5.5);
  ctx.lineTo(2.8, -1.2);
  ctx.lineTo(1.2, -0.4);
  ctx.lineTo(0, -2.2);
  ctx.lineTo(-1.2, -0.4);
  ctx.lineTo(-2.8, -1.2);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(-3.8, 2.8);
  ctx.lineTo(-2.4, 0.2);
  ctx.lineTo(-3.1, -0.2);
  ctx.lineTo(-4.4, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(3.8, 2.8);
  ctx.lineTo(2.4, 0.2);
  ctx.lineTo(3.1, -0.2);
  ctx.lineTo(4.4, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(0, 1.2);
  ctx.lineTo(0, 5.5);
  ctx.moveTo(-1.8, 4.6);
  ctx.lineTo(0, 3.6);
  ctx.lineTo(1.8, 4.6);
  ctx.stroke();
}

function drawPirateFleetGlyph(ctx, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = hexToRgba(color, 0.72);
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(4.8, 0);
  ctx.lineTo(-3.2, -4.2);
  ctx.lineTo(-1.2, 0);
  ctx.lineTo(-3.2, 4.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(4, 5, 12, 0.85)';
  ctx.beginPath();
  ctx.arc(0.8, -1.1, 0.75, 0, Math.PI * 2);
  ctx.arc(0.8, 1.1, 0.75, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-4.4, -4.8);
  ctx.lineTo(4.8, 4.8);
  ctx.moveTo(4.8, -4.8);
  ctx.lineTo(-4.4, 4.8);
  ctx.stroke();
}

/** Battle group marker for galaxy map — naval glyph + ship count badge. */
export function drawFleetMarker(ctx, x, y, scale, opts = {}) {
  const {
    shipCount = 0,
    power = 0,
    selected = false,
    side = 'player',
    intent = null,
  } = opts;
  const s = Math.max(0.55, Math.min(1.4, scale));
  const enemy = side === 'enemy';
  const accent = enemy ? THEME.dangerHot : (selected ? THEME.accentGreen : THEME.accentCyan);
  const badgeW = Math.max(enemy ? 36 : 32, (power >= 100 ? 45 : 38) * s);
  const badgeH = Math.max(14, 16 * s);
  const left = x - badgeW * 0.5;
  const top = y - badgeH * 0.5;

  ctx.save();
  ctx.fillStyle = enemy
    ? (intent === 'raid' || intent === 'interdict' ? 'rgba(255, 63, 95, 0.2)' : 'rgba(255, 99, 99, 0.13)')
    : (selected ? 'rgba(125, 255, 168, 0.18)' : 'rgba(111, 214, 255, 0.12)');
  ctx.strokeStyle = hexToRgba(accent, selected ? 0.95 : 0.75);
  ctx.lineWidth = Math.max(1, 1.1 * s);
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(left, top, badgeW, badgeH, Math.max(2, 3 * s));
  } else {
    ctx.rect(left, top, badgeW, badgeH);
  }
  ctx.fill();
  ctx.stroke();

  if (selected || intent === 'raid' || intent === 'interdict') {
    ctx.shadowColor = hexToRgba(enemy ? THEME.dangerHot : THEME.accentGreen, 0.55);
    ctx.shadowBlur = 8 * s;
    ctx.strokeStyle = hexToRgba(accent, 0.45);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.translate(left + badgeW * 0.22, y);
  ctx.scale(0.85 * s, 0.85 * s);
  if (enemy) drawPirateFleetGlyph(ctx, accent);
  else drawFleetFormationGlyph(ctx, accent);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const label = power > 0 ? `${shipCount}/${power}` : String(shipCount);
  ctx.font = `600 ${Math.max(7.5, 9 * s)}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = enemy ? '#ffe6e6' : (selected ? THEME.accentGreen : '#e8f4ff');
  ctx.fillText(label, left + badgeW * 0.42, y + 0.5 * s);

  ctx.restore();
}
