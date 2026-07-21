// New-campaign cinematic — flagship awakening, hyperspace breach, and home-system reveal.

import { beginStarPass, queueBlackHole, flushStars } from './gl/star-renderer.js';
import { drawWarpStarfield } from './render.js';
import { THEME } from './theme.js';

const TOTAL_MS = 14000;
const REDUCED_TOTAL_MS = 3200;
const SKIP_MIN_MS = 1700;
const DROP_START_MS = 6500;
const GAME_FADE_START_MS = 7000;
const GAME_FADE_END_MS = 8500;
const PORTAL_FADE_END_MS = 9000;
const REVEAL_FADE_OUT_START_MS = 13200;
const SKIP_FADE_MS = 850;

const PHASES = Object.freeze([
  { id: 'awakening', label: 'SOVEREIGN CORE AWAKENING', start: 0, end: 1500 },
  { id: 'ignition', label: 'FLAGSHIP DRIVE IGNITION', start: 1500, end: 3000 },
  { id: 'breach', label: 'HYPERSPACE BREACH', start: 3000, end: 5600 },
  { id: 'translation', label: 'INTERSTELLAR TRANSLATION', start: 5600, end: 7000 },
  { id: 'arrival', label: 'STRONGHOLD ACQUISITION', start: 7000, end: TOTAL_MS },
]);

/** @type {boolean} */
let active = false;
/** @type {number} */
let startTime = 0;
/** @type {(() => void) | null} */
let onComplete = null;
/** @type {((ctx: CanvasRenderingContext2D, fade: number, elapsed: number) => void) | null} */
let drawGameFrame = null;
let skipRequested = false;
let skipRequestedAt = 0;
let listenersBound = false;
let reducedMotion = false;
let debugElapsed = null;
let campaignContext = {
  mode: 'CAMPAIGN',
  objective: 'SOVEREIGN ASCENDANCY',
  difficulty: 'NORMAL',
  systemName: 'STRONGHOLD',
};

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function between(value, start, end) {
  if (end <= start) return value >= end ? 1 : 0;
  return smoothstep((value - start) / (end - start));
}

function pulse(value, fadeInStart, peakStart, peakEnd, fadeOutEnd) {
  return between(value, fadeInStart, peakStart) * (1 - between(value, peakEnd, fadeOutEnd));
}

function introElapsed(now = performance.now()) {
  return debugElapsed ?? Math.max(0, now - startTime);
}

function phaseForElapsed(elapsed) {
  return PHASES.find((phase) => elapsed >= phase.start && elapsed < phase.end) ?? PHASES.at(-1);
}

function warpIntensity(elapsed, skipProgress = 0) {
  let base;
  if (elapsed < 1200) base = smoothstep(elapsed / 1200) * 0.1;
  else if (elapsed < 3400) base = 0.1 + smoothstep((elapsed - 1200) / 2200) * 0.9;
  else if (elapsed < DROP_START_MS) base = 1;
  else base = 1 - smoothstep((elapsed - DROP_START_MS) / (PORTAL_FADE_END_MS - DROP_START_MS));
  return base * (1 - skipProgress);
}

/** Animated wormhole position, scale, and shader time for hyperspace exit. */
function wormholeMotion(elapsed, intensity, w, h) {
  const rush = between(elapsed, 1800, 4300);
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

function drawAnamorphicFlare(ctx, x, y, radius, alpha) {
  if (alpha <= 0) return;
  const long = radius * 5.5;
  const beam = ctx.createLinearGradient(x - long, y, x + long, y);
  beam.addColorStop(0, 'rgba(70, 150, 255, 0)');
  beam.addColorStop(0.42, `rgba(90, 190, 255, ${alpha * 0.16})`);
  beam.addColorStop(0.5, `rgba(230, 250, 255, ${alpha})`);
  beam.addColorStop(0.58, `rgba(180, 110, 255, ${alpha * 0.16})`);
  beam.addColorStop(1, 'rgba(130, 90, 255, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = beam;
  ctx.fillRect(x - long, y - Math.max(1, radius * 0.025), long * 2, Math.max(2, radius * 0.05));
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, `rgba(245, 252, 255, ${alpha})`);
  glow.addColorStop(0.14, `rgba(110, 215, 255, ${alpha * 0.55})`);
  glow.addColorStop(0.55, `rgba(130, 90, 255, ${alpha * 0.12})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnginePlume(ctx, x, y, length, width, intensity, phase) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const plume = ctx.createLinearGradient(x - length, y, x, y);
  plume.addColorStop(0, 'rgba(80, 120, 255, 0)');
  plume.addColorStop(0.45, `rgba(105, 120, 255, ${intensity * 0.2})`);
  plume.addColorStop(0.8, `rgba(80, 220, 255, ${intensity * 0.62})`);
  plume.addColorStop(1, `rgba(245, 255, 255, ${intensity})`);
  const flutter = 0.86 + Math.sin(phase) * 0.1 + Math.sin(phase * 2.7) * 0.04;
  ctx.fillStyle = plume;
  ctx.beginPath();
  ctx.moveTo(x, y - width * 0.5);
  ctx.lineTo(x - length * flutter, y);
  ctx.lineTo(x, y + width * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Hero flagship silhouette used only for the campaign-opening flyby. */
function drawFlagshipIgnition(ctx, canvas, elapsed) {
  const appear = between(elapsed, 450, 1200);
  const vanish = 1 - between(elapsed, 3850, 4700);
  const alpha = appear * vanish;
  if (alpha <= 0) return;

  const breach = between(elapsed, 2500, 4550);
  const ignition = between(elapsed, 1150, 2250);
  const w = canvas.width;
  const h = canvas.height;
  const x = w * (0.24 + breach * 0.255);
  const y = h * (0.61 - breach * 0.105) + Math.sin(elapsed * 0.003) * h * 0.006;
  const baseScale = Math.min(w, h) * 0.082;
  const scale = baseScale * (1 - breach * 0.64);
  const rotation = -0.13 - breach * 0.05;
  const thrust = (0.25 + ignition * 0.75) * alpha;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;

  drawEnginePlume(ctx, -scale * 1.22, -scale * 0.28, scale * (1.7 + ignition), scale * 0.18, thrust, elapsed * 0.022);
  drawEnginePlume(ctx, -scale * 1.34, 0, scale * (2.1 + ignition * 1.25), scale * 0.24, thrust, elapsed * 0.019 + 1.3);
  drawEnginePlume(ctx, -scale * 1.22, scale * 0.28, scale * (1.7 + ignition), scale * 0.18, thrust, elapsed * 0.024 + 2.1);

  ctx.shadowColor = 'rgba(90, 210, 255, 0.75)';
  ctx.shadowBlur = scale * (0.1 + ignition * 0.16);
  const hull = ctx.createLinearGradient(-scale * 1.3, -scale * 0.5, scale * 1.55, scale * 0.5);
  hull.addColorStop(0, 'rgba(13, 21, 42, 0.98)');
  hull.addColorStop(0.48, 'rgba(38, 54, 86, 0.98)');
  hull.addColorStop(0.75, 'rgba(18, 28, 56, 0.98)');
  hull.addColorStop(1, 'rgba(5, 12, 28, 0.98)');
  ctx.fillStyle = hull;
  ctx.strokeStyle = `rgba(125, 218, 255, ${0.28 + ignition * 0.5})`;
  ctx.lineWidth = Math.max(1.4, scale * 0.018);
  ctx.beginPath();
  ctx.moveTo(scale * 1.58, 0);
  ctx.lineTo(scale * 0.65, -scale * 0.23);
  ctx.lineTo(scale * 0.05, -scale * 0.48);
  ctx.lineTo(-scale * 0.48, -scale * 0.36);
  ctx.lineTo(-scale * 1.25, -scale * 0.5);
  ctx.lineTo(-scale * 0.94, -scale * 0.12);
  ctx.lineTo(-scale * 1.35, 0);
  ctx.lineTo(-scale * 0.94, scale * 0.12);
  ctx.lineTo(-scale * 1.25, scale * 0.5);
  ctx.lineTo(-scale * 0.48, scale * 0.36);
  ctx.lineTo(scale * 0.05, scale * 0.48);
  ctx.lineTo(scale * 0.65, scale * 0.23);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = scale * 0.08;
  ctx.strokeStyle = `rgba(247, 190, 104, ${0.18 + ignition * 0.58})`;
  ctx.lineWidth = Math.max(1, scale * 0.012);
  ctx.beginPath();
  ctx.moveTo(-scale * 0.66, -scale * 0.1);
  ctx.lineTo(scale * 0.65, -scale * 0.055);
  ctx.lineTo(scale * 1.15, 0);
  ctx.lineTo(scale * 0.65, scale * 0.055);
  ctx.lineTo(-scale * 0.66, scale * 0.1);
  ctx.stroke();

  ctx.fillStyle = `rgba(145, 229, 255, ${0.35 + ignition * 0.65})`;
  for (const [px, py, pr] of [[0.34, -0.18, 0.035], [0.34, 0.18, 0.035], [-0.34, 0, 0.045]]) {
    ctx.beginPath();
    ctx.arc(scale * px, scale * py, scale * pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (ignition > 0.05) {
    drawAnamorphicFlare(ctx, x - Math.cos(rotation) * scale * 1.25, y - Math.sin(rotation) * scale * 1.25, scale * 0.5, ignition * alpha * 0.55);
  }
}

function drawEscortFlight(ctx, canvas, elapsed) {
  const alpha = pulse(elapsed, 1450, 2100, 3900, 4700);
  if (alpha <= 0) return;
  const breach = between(elapsed, 2500, 4550);
  const w = canvas.width;
  const h = canvas.height;
  const leaderX = w * (0.24 + breach * 0.255);
  const leaderY = h * (0.61 - breach * 0.105);
  const spread = Math.min(w, h) * (0.08 - breach * 0.045);
  const size = Math.max(3, Math.min(w, h) * 0.008 * (1 - breach * 0.55));
  const escorts = [[-1.15, -0.8], [-0.8, 0.95], [-1.9, -0.2], [-1.65, 1.25]];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < escorts.length; i++) {
    const [ox, oy] = escorts[i];
    const flutter = Math.sin(elapsed * 0.006 + i * 2.3) * spread * 0.09;
    const x = leaderX + ox * spread;
    const y = leaderY + oy * spread + flutter;
    ctx.strokeStyle = `rgba(100, 215, 255, ${alpha * (0.42 + i * 0.08)})`;
    ctx.lineWidth = Math.max(1, size * 0.18);
    ctx.beginPath();
    ctx.moveTo(x + size * 1.4, y);
    ctx.lineTo(x - size, y - size * 0.52);
    ctx.lineTo(x - size * 0.45, y);
    ctx.lineTo(x - size, y + size * 0.52);
    ctx.closePath();
    ctx.stroke();
    drawEnginePlume(ctx, x - size, y, size * (5 + breach * 8), size * 0.35, alpha * 0.65, elapsed * 0.02 + i);
  }
  ctx.restore();
}

function drawPerspectiveGrid(ctx, canvas, elapsed) {
  const alpha = pulse(elapsed, 0, 500, 2300, 3300) * 0.2;
  if (alpha <= 0) return;
  const w = canvas.width;
  const h = canvas.height;
  const horizon = h * 0.54;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = `rgba(80, 180, 255, ${alpha})`;
  ctx.lineWidth = 1;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5, horizon);
    ctx.lineTo(w * 0.5 + i * w * 0.11, h);
    ctx.stroke();
  }
  const scroll = (elapsed * 0.00028) % 1;
  for (let i = 0; i < 12; i++) {
    const t = ((i / 12 + scroll) % 1) ** 2.2;
    const y = horizon + t * (h - horizon);
    ctx.globalAlpha = alpha * (0.25 + t * 0.75);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrackingText(ctx, text, centerX, y, spacing, style) {
  ctx.save();
  Object.assign(ctx, style);
  const chars = [...text];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, chars.length - 1) * spacing;
  let x = centerX - total * 0.5;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + spacing;
  }
  ctx.restore();
}

function drawCampaignReveal(ctx, canvas, elapsed, reveal) {
  const alpha = reveal * (1 - between(elapsed, REVEAL_FADE_OUT_START_MS, TOTAL_MS));
  if (alpha <= 0) return;
  const w = canvas.width;
  const h = canvas.height;
  const scale = Math.max(0.75, Math.min(w / 1920, h / 1080));
  const titleY = h * 0.38;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(80, 205, 255, 0.8)';
  ctx.shadowBlur = 24 * scale;
  drawTrackingText(ctx, 'A NEW REIGN BEGINS', w * 0.5, titleY, 7 * scale, {
    font: `600 ${Math.round(20 * scale)}px Inter, system-ui, sans-serif`,
    fillStyle: 'rgba(210, 239, 255, 0.95)',
  });
  ctx.shadowBlur = 38 * scale;
  drawTrackingText(ctx, campaignContext.systemName, w * 0.5, titleY + 72 * scale, 3.5 * scale, {
    font: `700 ${Math.round(48 * scale)}px Inter, system-ui, sans-serif`,
    fillStyle: 'rgba(247, 250, 255, 0.98)',
  });
  ctx.shadowBlur = 0;
  const ruleW = Math.min(w * 0.34, 470 * scale) * reveal;
  const ruleY = titleY + 93 * scale;
  const rule = ctx.createLinearGradient(w * 0.5 - ruleW, ruleY, w * 0.5 + ruleW, ruleY);
  rule.addColorStop(0, 'rgba(90, 210, 255, 0)');
  rule.addColorStop(0.5, 'rgba(240, 194, 105, 0.88)');
  rule.addColorStop(1, 'rgba(90, 210, 255, 0)');
  ctx.fillStyle = rule;
  ctx.fillRect(w * 0.5 - ruleW, ruleY, ruleW * 2, Math.max(1, 1.5 * scale));
  drawTrackingText(ctx, `${campaignContext.mode}  //  ${campaignContext.objective}`, w * 0.5, titleY + 124 * scale, 2.4 * scale, {
    font: `500 ${Math.round(12 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`,
    fillStyle: 'rgba(146, 181, 211, 0.9)',
  });
  ctx.restore();
}

function drawCinematicHud(ctx, canvas, elapsed, phase, reveal) {
  const w = canvas.width;
  const h = canvas.height;
  const scale = Math.max(0.7, Math.min(w / 1920, h / 1080));
  const margin = 48 * scale;
  const hudAlpha = (1 - reveal * 0.9) * between(elapsed, 180, 700);
  if (hudAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = hudAlpha;
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(11 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = 'rgba(111, 214, 255, 0.95)';
    ctx.fillText(`GS // ${phase.label}`, margin, margin + 8 * scale);
    ctx.font = `500 ${Math.round(9 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = 'rgba(130, 154, 190, 0.82)';
    ctx.fillText(`DRIVE  ${Math.round(warpIntensity(elapsed) * 100).toString().padStart(3, '0')}%`, margin, margin + 30 * scale);
    ctx.fillText(`VECTOR ${phase.id === 'arrival' ? 'LOCKED' : 'CALCULATING'}`, margin, margin + 47 * scale);

    ctx.textAlign = 'right';
    ctx.fillText(`${campaignContext.difficulty} RIVAL`, w - margin, margin + 8 * scale);
    ctx.fillText(campaignContext.mode, w - margin, margin + 25 * scale);

    const trackW = Math.min(w * 0.38, 560 * scale);
    const progress = Math.max(0, Math.min(1, elapsed / TOTAL_MS));
    const trackX = w * 0.5 - trackW * 0.5;
    const trackY = h - margin * 0.82;
    ctx.fillStyle = 'rgba(80, 105, 145, 0.26)';
    ctx.fillRect(trackX, trackY, trackW, Math.max(1, 2 * scale));
    const progressGradient = ctx.createLinearGradient(trackX, trackY, trackX + trackW, trackY);
    progressGradient.addColorStop(0, 'rgba(95, 175, 255, 0.7)');
    progressGradient.addColorStop(0.72, 'rgba(130, 225, 255, 0.95)');
    progressGradient.addColorStop(1, 'rgba(247, 190, 104, 1)');
    ctx.fillStyle = progressGradient;
    ctx.fillRect(trackX, trackY, trackW * progress, Math.max(1.5, 2.5 * scale));
    ctx.restore();
  }

  if (elapsed >= SKIP_MIN_MS && !skipRequested && reveal < 0.65) {
    const hintAlpha = 0.35 + Math.sin(elapsed * 0.004) * 0.12;
    ctx.save();
    ctx.globalAlpha = hintAlpha;
    ctx.textAlign = 'right';
    ctx.font = `500 ${Math.round(9 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = 'rgba(180, 202, 228, 0.9)';
    ctx.fillText('CLICK / SPACE TO SKIP', w - margin, h - margin * 0.72);
    ctx.restore();
  }
}

function drawFilmTexture(ctx, canvas, elapsed, strength) {
  if (strength <= 0) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.globalAlpha = strength * 0.11;
  ctx.fillStyle = 'rgba(160, 210, 255, 0.28)';
  const offset = Math.floor(elapsed * 0.08) % 8;
  for (let y = offset; y < h; y += 8) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = strength * 0.08;
  for (let i = 0; i < 72; i++) {
    const seed = (i * 92821 + Math.floor(elapsed / 40) * 68917) >>> 0;
    const x = (seed % 1009) / 1009 * w;
    const y = ((seed * 37) % 1013) / 1013 * h;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.restore();
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
 * @param {{
 *   onComplete?: () => void,
 *   drawGameFrame?: (ctx: CanvasRenderingContext2D, fade: number, elapsed: number) => void,
 *   campaign?: { mode?: string, objective?: string, difficulty?: string, systemName?: string }
 * }} opts
 */
export function startWarpIntro(ctx2d, canvas, opts = {}) {
  active = true;
  startTime = performance.now();
  skipRequested = false;
  skipRequestedAt = 0;
  debugElapsed = null;
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const campaign = opts.campaign ?? {};
  campaignContext = {
    mode: String(campaign.mode ?? 'CAMPAIGN').replaceAll('_', ' ').toUpperCase(),
    objective: String(campaign.objective ?? 'SOVEREIGN ASCENDANCY').replaceAll('_', ' ').toUpperCase(),
    difficulty: String(campaign.difficulty ?? 'NORMAL').replaceAll('_', ' ').toUpperCase(),
    systemName: String(campaign.systemName ?? 'STRONGHOLD').toUpperCase(),
  };
  onComplete = opts.onComplete ?? null;
  drawGameFrame = opts.drawGameFrame ?? null;
  bindSkipListeners();
}

export function isWarpIntroActive() {
  return active;
}

export function skipWarpIntro() {
  if (!active) return false;
  const elapsed = introElapsed();
  const minimum = reducedMotion ? 550 : SKIP_MIN_MS;
  if (elapsed < minimum) return false;
  skipRequested = true;
  skipRequestedAt = elapsed;
  return true;
}

/** Deterministic introspection for browser verification and accessible UI mirrors. */
export function warpIntroState(now = performance.now()) {
  if (!active && debugElapsed == null) {
    return {
      active: false,
      elapsedMs: 0,
      progress: 0,
      phase: null,
      phaseLabel: null,
      skipReady: false,
      skipRequested: false,
      reducedMotion,
      campaign: { ...campaignContext },
    };
  }
  const rawElapsed = introElapsed(now);
  const elapsed = reducedMotion ? rawElapsed * (TOTAL_MS / REDUCED_TOTAL_MS) : rawElapsed;
  const phase = phaseForElapsed(elapsed);
  return {
    active,
    elapsedMs: Math.round(elapsed),
    progress: Math.max(0, Math.min(1, elapsed / TOTAL_MS)),
    phase: phase.id,
    phaseLabel: phase.label,
    skipReady: rawElapsed >= (reducedMotion ? 550 : SKIP_MIN_MS),
    skipRequested,
    reducedMotion,
    campaign: { ...campaignContext },
  };
}

/** Test hook: jump to a cinematic timestamp without advancing campaign simulation. */
export function setWarpIntroElapsedForTest(ms) {
  if (!active) return warpIntroState();
  debugElapsed = Math.max(0, Number(ms) || 0);
  return warpIntroState();
}

function finishIntro() {
  active = false;
  onComplete?.();
  onComplete = null;
  drawGameFrame = null;
  debugElapsed = null;
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

  const rawElapsed = introElapsed(now);
  const normalEnd = reducedMotion ? REDUCED_TOTAL_MS : TOTAL_MS;
  const effectiveEnd = skipRequested ? skipRequestedAt + SKIP_FADE_MS : normalEnd;
  if (rawElapsed >= effectiveEnd) {
    finishIntro();
    return;
  }

  const elapsed = reducedMotion ? rawElapsed * (TOTAL_MS / REDUCED_TOTAL_MS) : rawElapsed;
  const skipProgress = skipRequested
    ? smoothstep((rawElapsed - skipRequestedAt) / SKIP_FADE_MS)
    : 0;
  const reveal = skipRequested
    ? skipProgress
    : between(elapsed, GAME_FADE_START_MS, GAME_FADE_END_MS);
  const intensity = warpIntensity(elapsed, skipProgress);
  const w = canvas.width;
  const h = canvas.height;
  const motion = wormholeMotion(elapsed, intensity, w, h);
  const phase = phaseForElapsed(elapsed);

  ctx2d.save();
  ctx2d.globalAlpha = 1;
  ctx2d.globalCompositeOperation = 'source-over';
  ctx2d.fillStyle = THEME.bgDeep;
  ctx2d.fillRect(0, 0, w, h);
  if (reveal > 0 && drawGameFrame) drawGameFrame(ctx2d, reveal, elapsed);
  ctx2d.restore();

  const breachImpact = pulse(elapsed, 2700, 3050, 3150, 3650);
  const exitImpact = pulse(elapsed, 6200, 6500, 6650, 7250);
  const shake = reducedMotion ? 0 : breachImpact * 7 + exitImpact * 13;
  const shakeX = Math.sin(elapsed * 0.093) * shake;
  const shakeY = Math.cos(elapsed * 0.077) * shake * 0.58;

  ctx2d.save();
  ctx2d.translate(shakeX, shakeY);
  drawPerspectiveGrid(ctx2d, canvas, elapsed);
  drawWarpLayers(
    ctx2d,
    canvas,
    elapsed,
    reducedMotion ? intensity * 0.72 : intensity,
    motion.cx,
    motion.cy,
    motion.bhR,
    motion.warpTime,
    reveal * 0.82,
  );
  if (!reducedMotion) {
    drawEscortFlight(ctx2d, canvas, elapsed);
    drawFlagshipIgnition(ctx2d, canvas, elapsed);
  }
  ctx2d.restore();

  const ignitionFlare = pulse(elapsed, 1150, 1650, 1950, 2450);
  const breachFlare = pulse(elapsed, 2800, 3100, 3200, 3750);
  const exitFlare = pulse(elapsed, 6200, 6500, 6650, 7350);
  drawAnamorphicFlare(ctx2d, motion.cx, motion.cy, motion.bhR * 1.55, breachFlare * 0.75 + exitFlare);
  drawCenterFlash(ctx2d, canvas, Math.min(1, ignitionFlare * 0.16 + breachFlare * 0.34 + exitFlare * 0.92));

  drawVignette(ctx2d, canvas, Math.max(0.12, (0.38 + intensity * 0.62) * (1 - reveal * 0.7)));
  drawChromaticOverlay(ctx2d, canvas, Math.max(0, intensity - 0.12) * (1 - reveal));
  drawCampaignReveal(ctx2d, canvas, elapsed, reveal);
  drawCinematicHud(ctx2d, canvas, elapsed, phase, reveal);
  drawFilmTexture(ctx2d, canvas, elapsed, reducedMotion ? 0.15 : 0.65 * (1 - reveal * 0.6));
  drawLetterbox(ctx2d, canvas, h * 0.085 * (1 - reveal));

  resetStrokeState(ctx2d);
}
