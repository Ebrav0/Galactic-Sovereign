// Cinematic warp intro — radial star tunnel, black hole peak, drop into system view.

import { beginStarPass, queueBlackHole, flushStars } from './gl/star-renderer.js';
import { drawWarpStarfield } from './render.js';
import { THEME } from './theme.js';

const TOTAL_MS = 6500;
const SKIP_MIN_MS = 2000;
const DROP_START_MS = 5000;
const GAME_FADE_START_MS = 5200;

/** @type {boolean} */
let active = false;
/** @type {number} */
let startTime = 0;
/** @type {(() => void) | null} */
let onComplete = null;
/** @type {((ctx: CanvasRenderingContext2D, fade: number, elapsed: number) => void) | null} */
let drawGameFrame = null;
let skipRequested = false;
let listenersBound = false;

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function warpIntensity(elapsed) {
  if (skipRequested && elapsed >= SKIP_MIN_MS) {
    const dropElapsed = elapsed - SKIP_MIN_MS;
    return Math.max(0, 1 - smoothstep(dropElapsed / 900));
  }
  if (elapsed < 800) return smoothstep(elapsed / 800) * 0.15;
  if (elapsed < 3500) return 0.15 + smoothstep((elapsed - 800) / 2700) * 0.85;
  if (elapsed < 5000) return 1;
  return 1 - smoothstep((elapsed - 5000) / 1500);
}

/** Animated wormhole position, scale, and shader time for hyperspace exit. */
function wormholeMotion(elapsed, intensity, w, h) {
  const rush = smoothstep(800, 3800, elapsed);
  const wobbleX = Math.sin(elapsed * 0.0042) * 14 * intensity + Math.sin(elapsed * 0.009) * 6 * rush;
  const wobbleY = Math.cos(elapsed * 0.0036) * 11 * intensity + Math.cos(elapsed * 0.0075) * 5 * rush;
  const cx = w * 0.5 + wobbleX;
  const cy = h * 0.5 + wobbleY;
  const breathe = 1 + 0.06 * Math.sin(elapsed * 0.011) + rush * 0.18 * Math.sin(elapsed * 0.019);
  const surge = 1 + rush * 0.12 * Math.max(0, Math.sin(elapsed * 0.006 - 1.2));
  const bhR = (24 + intensity * 168) * breathe * surge;
  const warpTime = elapsed * (0.001 + intensity * 0.028 + rush * 0.012);
  return { cx, cy, bhR, warpTime, rush };
}

function resetStrokeState(ctx) {
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = 1;
}

function drawVignette(ctx, canvas, strength) {
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const r = Math.max(canvas.width, canvas.height) * 0.65;
  const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, `rgba(0,0,0,${0.25 * strength})`);
  g.addColorStop(1, `rgba(0,0,0,${0.55 + 0.4 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawChromaticOverlay(ctx, canvas, strength) {
  if (strength <= 0) return;
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const r = Math.max(canvas.width, canvas.height) * 0.55;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(111, 214, 255, ${0.22 * strength})`);
  g.addColorStop(0.45, `rgba(176, 122, 219, ${0.12 * strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawCenterFlash(ctx, canvas, strength) {
  if (strength <= 0) return;
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const r = Math.max(canvas.width, canvas.height) * 0.18 * strength;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(220, 240, 255, ${0.55 * strength})`);
  g.addColorStop(0.4, `rgba(111, 214, 255, ${0.2 * strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawSpinningRing(ctx, cx, cy, r, rotation, alpha, color, dash = []) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 + alpha * 2;
  ctx.setLineDash(dash);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 + alpha * 18;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  resetStrokeState(ctx);
}

/** Expanding shockwave ellipses — exit energy ripples. */
function drawExitShockwaves(ctx, cx, cy, elapsed, intensity, bhR) {
  const timeSec = elapsed * 0.001;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 6; i++) {
    const phase = (timeSec * (0.55 + i * 0.08) + i * 0.37) % 1;
    const r = bhR * (0.9 + phase * 2.8);
    const alpha = (1 - phase) * (0.08 + intensity * 0.2);
    const tilt = 0.18 + i * 0.07 + Math.sin(timeSec + i) * 0.05;
    ctx.strokeStyle = i % 2 === 0
      ? `rgba(111, 214, 255, ${alpha})`
      : `rgba(255, 150, 110, ${alpha * 0.85})`;
    ctx.lineWidth = 1 + (1 - phase) * 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.82 + tilt * 0.15), timeSec * (0.4 + i * 0.11), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 3D helix tendrils wrapping the portal mouth. */
function drawHelixTendrils(ctx, cx, cy, elapsed, intensity, bhR) {
  const timeSec = elapsed * 0.001;
  const strands = 4;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let s = 0; s < strands; s++) {
    const phase = (s / strands) * Math.PI * 2;
    ctx.strokeStyle = s % 2 === 0
      ? `rgba(176, 122, 219, ${0.1 + intensity * 0.28})`
      : `rgba(111, 214, 255, ${0.08 + intensity * 0.24})`;
    ctx.lineWidth = 1.2 + intensity * 1.8;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const helixAngle = phase + timeSec * (2.2 + s * 0.4) + t * Math.PI * 5.5;
      const tubeR = bhR * (0.45 + t * 1.35);
      const wobble = Math.sin(t * 14 + timeSec * 6 + s) * bhR * 0.06 * intensity;
      const px = cx + Math.cos(helixAngle) * (tubeR + wobble);
      const py = cy + Math.sin(helixAngle) * (tubeR + wobble) * (0.88 + 0.12 * Math.sin(helixAngle * 2));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Faint echo portals — depth copies offset in spiral. */
function drawPortalEchoes(ctx, cx, cy, elapsed, intensity, bhR) {
  const timeSec = elapsed * 0.001;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let e = 0; e < 3; e++) {
    const orbit = timeSec * (0.9 + e * 0.35) + e * 2.1;
    const dist = bhR * (0.08 + e * 0.06) * intensity;
    const ex = cx + Math.cos(orbit) * dist;
    const ey = cy + Math.sin(orbit) * dist;
    const er = bhR * (0.35 - e * 0.08);
    const alpha = (0.06 + intensity * 0.12) * (1 - e * 0.25);
    const g = ctx.createRadialGradient(ex, ey, er * 0.1, ex, ey, er);
    g.addColorStop(0, `rgba(150, 220, 255, ${alpha})`);
    g.addColorStop(0.5, `rgba(120, 80, 200, ${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Counter-rotating spiral tunnel and arc segments — hyperspace vortex. */
function drawHyperspaceVortex(ctx, cx, cy, elapsed, intensity, bhR) {
  if (intensity < 0.08) return;
  const timeSec = elapsed * 0.001;
  const arms = 9;
  const innerR = bhR * 0.42;
  const maxArmLen = bhR * (2.4 + intensity * 2.2);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let a = 0; a < arms; a++) {
    const armBase = (a / arms) * Math.PI * 2 + 0.17;
    const spin = timeSec * (3.2 + intensity * 5.0) * (a % 2 === 0 ? 1 : -1);
    const hueShift = a % 3;
    ctx.strokeStyle = hueShift === 0
      ? `rgba(111, 214, 255, ${0.07 + intensity * 0.2})`
      : hueShift === 1
        ? `rgba(176, 122, 219, ${0.06 + intensity * 0.18})`
        : `rgba(255, 170, 120, ${0.05 + intensity * 0.16})`;
    ctx.lineWidth = 0.8 + intensity * 2.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 56; i++) {
      const t = i / 56;
      const spiralAngle = armBase + spin + t * (5.0 + intensity * 3.5);
      const dist = innerR + t * maxArmLen * (0.88 + 0.12 * Math.sin(timeSec * 4 + a * 0.7));
      const px = cx + Math.cos(spiralAngle) * dist;
      const py = cy + Math.sin(spiralAngle) * dist;
      if (i === 0) { ctx.moveTo(px, py); started = true; }
      else if (started) ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  const ringCount = 7;
  for (let ring = 0; ring < ringCount; ring++) {
    const ringT = ring / ringCount;
    const r = bhR * (0.6 + ringT * 1.75) + Math.sin(timeSec * 3 + ring * 1.7) * (6 + intensity * 10);
    const rot = timeSec * (1.5 + ring * 0.55) * (ring % 2 === 0 ? 1 : -1) + ring * 0.9;
    const arcSpan = Math.PI * (0.22 + ringT * 0.38);
    const segments = 4 + ring;
    for (let seg = 0; seg < segments; seg++) {
      const segAngle = rot + (seg / segments) * Math.PI * 2 + 0.31;
      ctx.strokeStyle = ring % 2 === 0
        ? `rgba(176, 122, 219, ${0.1 + intensity * 0.32})`
        : `rgba(111, 214, 255, ${0.08 + intensity * 0.28})`;
      ctx.lineWidth = 0.8 + intensity * (1.6 - ringT * 0.4);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 6 + intensity * 12;
      ctx.beginPath();
      ctx.arc(cx, cy, r, segAngle, segAngle + arcSpan);
      ctx.stroke();
    }
  }

  drawSpinningRing(
    ctx, cx, cy, bhR * 1.28,
    timeSec * (2.4 + intensity * 3.2),
    0.12 + intensity * 0.4,
    `rgba(255, 180, 120, ${0.3 + intensity * 0.48})`,
    [5, 9 + intensity * 7],
  );
  drawSpinningRing(
    ctx, cx, cy, bhR * 1.52,
    -timeSec * (1.8 + intensity * 2.6) + 0.7,
    0.08 + intensity * 0.32,
    `rgba(111, 214, 255, ${0.25 + intensity * 0.42})`,
    [12, 7],
  );
  drawSpinningRing(
    ctx, cx, cy, bhR * 1.72,
    timeSec * (1.1 + intensity * 1.8) + 1.4,
    0.06 + intensity * 0.22,
    `rgba(200, 130, 255, ${0.2 + intensity * 0.35})`,
    [3, 14],
  );

  ctx.restore();
  resetStrokeState(ctx);
}

/** Segmented rim shards — no full semicircle pairs that read as axis lines. */
function drawWormholeRim(ctx, cx, cy, bhR, elapsed, intensity) {
  const timeSec = elapsed * 0.001;
  const shardCount = 16;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < shardCount; i++) {
    const base = (i / shardCount) * Math.PI * 2;
    const rot = base + timeSec * (1.6 + (i % 5) * 0.35) * (i % 2 === 0 ? 1 : -1);
    const r = bhR * (1.04 + (i % 4) * 0.04) + Math.sin(timeSec * (3.5 + i * 0.2) + i) * 3 * intensity;
    const span = Math.PI * (0.12 + (i % 3) * 0.06);
    const alpha = (0.15 + intensity * 0.45) * (0.65 + 0.35 * Math.sin(timeSec * 4 + i));
    ctx.strokeStyle = i % 3 === 0
      ? `rgba(255, 140, 90, ${alpha})`
      : i % 3 === 1
        ? `rgba(150, 100, 255, ${alpha})`
        : `rgba(100, 210, 255, ${alpha * 0.9})`;
    ctx.lineWidth = 1.5 + intensity * 1.8;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 10 + intensity * 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, rot, rot + span);
    ctx.stroke();
  }
  ctx.restore();
  resetStrokeState(ctx);
}

function drawGlowRing(ctx, x, y, r, alpha) {
  ctx.save();
  ctx.shadowColor = THEME.accentCyan;
  ctx.shadowBlur = r * 0.5;
  ctx.strokeStyle = `rgba(111, 214, 255, ${alpha})`;
  ctx.lineWidth = 2 + alpha * 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  resetStrokeState(ctx);
}

function drawLetterbox(ctx, canvas, barH) {
  if (barH <= 0) return;
  ctx.fillStyle = 'rgba(3, 5, 12, 0.95)';
  ctx.fillRect(0, 0, canvas.width, barH);
  ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
}

function bindSkipListeners() {
  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      skipWarpIntro();
    }
  });
  document.getElementById('game-canvas')?.addEventListener('click', () => {
    if (active) skipWarpIntro();
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx2d
 * @param {HTMLCanvasElement} canvas
 * @param {{ onComplete?: () => void, drawGameFrame?: (ctx: CanvasRenderingContext2D, fade: number, elapsed: number) => void }} opts
 */
export function startWarpIntro(ctx2d, canvas, opts = {}) {
  active = true;
  startTime = performance.now();
  skipRequested = false;
  onComplete = opts.onComplete ?? null;
  drawGameFrame = opts.drawGameFrame ?? null;
  bindSkipListeners();
}

export function isWarpIntroActive() {
  return active;
}

export function skipWarpIntro() {
  if (!active) return;
  const elapsed = performance.now() - startTime;
  if (elapsed < SKIP_MIN_MS) return;
  skipRequested = true;
}

function finishIntro() {
  active = false;
  onComplete?.();
  onComplete = null;
  drawGameFrame = null;
}

function drawWarpLayers(ctx2d, canvas, elapsed, intensity, cx, cy, bhR, warpTime, fadeOverlay = 0) {
  const mask = { cx, cy, r: bhR * 1.05 };
  const timeSec = elapsed * 0.001;
  const layerAlpha = 1 - fadeOverlay;

  drawWarpStarfield(ctx2d, canvas, timeSec, intensity * layerAlpha, mask);

  if (intensity > 0.05) {
    drawExitShockwaves(ctx2d, cx, cy, elapsed, intensity * layerAlpha, bhR);
    drawPortalEchoes(ctx2d, cx, cy, elapsed, intensity * layerAlpha, bhR);
  }

  if (intensity > 0.06) {
    drawHyperspaceVortex(ctx2d, cx, cy, elapsed, intensity * layerAlpha, bhR);
    drawHelixTendrils(ctx2d, cx, cy, elapsed, intensity * layerAlpha, bhR);
  }

  if (intensity > 0.12) {
    beginStarPass('system');
    queueBlackHole({
      x: cx,
      y: cy,
      screenR: bhR,
      time: warpTime,
      large: true,
      warp: Math.min(1, intensity * 1.15),
    });
    flushStars(ctx2d, 'core');
    flushStars(ctx2d, 'bloom');
    drawWormholeRim(ctx2d, cx, cy, bhR, elapsed, intensity * layerAlpha);
    drawGlowRing(ctx2d, cx, cy, bhR * (1.1 + 0.07 * Math.sin(elapsed * 0.014)), 0.18 + intensity * 0.62);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx2d
 * @param {HTMLCanvasElement} canvas
 * @param {number} now
 */
export function drawWarpIntro(ctx2d, canvas, now) {
  if (!active) return;

  const elapsed = now - startTime;
  const effectiveEnd = skipRequested ? SKIP_MIN_MS + 900 : TOTAL_MS;
  if (elapsed >= effectiveEnd) {
    finishIntro();
    return;
  }

  const intensity = warpIntensity(elapsed);
  const w = canvas.width;
  const h = canvas.height;
  const { cx, cy, bhR, warpTime } = wormholeMotion(elapsed, intensity, w, h);

  if (elapsed >= GAME_FADE_START_MS && drawGameFrame) {
    const fade = smoothstep((elapsed - GAME_FADE_START_MS) / (effectiveEnd - GAME_FADE_START_MS));
    drawGameFrame(ctx2d, fade, elapsed);
  } else {
    ctx2d.fillStyle = THEME.bgDeep;
    ctx2d.fillRect(0, 0, w, h);
  }

  drawWarpLayers(ctx2d, canvas, elapsed, intensity, cx, cy, bhR, warpTime);

  drawVignette(ctx2d, canvas, 0.35 + intensity * 0.65);
  drawChromaticOverlay(ctx2d, canvas, Math.max(0, intensity - 0.12));

  if (elapsed >= DROP_START_MS) {
    const dropT = smoothstep((elapsed - DROP_START_MS) / (effectiveEnd - DROP_START_MS));
    drawCenterFlash(ctx2d, canvas, (1 - dropT) * 0.85);
    const barH = (1 - dropT) * h * 0.12;
    drawLetterbox(ctx2d, canvas, barH);
  }

  if (elapsed >= GAME_FADE_START_MS && drawGameFrame) {
    const fade = smoothstep((elapsed - GAME_FADE_START_MS) / (effectiveEnd - GAME_FADE_START_MS));
    ctx2d.save();
    ctx2d.globalAlpha = 1 - fade;
    ctx2d.fillStyle = THEME.bgDeep;
    ctx2d.fillRect(0, 0, w, h);
    drawWarpLayers(ctx2d, canvas, elapsed, intensity, cx, cy, bhR, warpTime, fade);
    drawVignette(ctx2d, canvas, (0.35 + intensity * 0.65) * (1 - fade));
    ctx2d.restore();
  }

  resetStrokeState(ctx2d);
}
