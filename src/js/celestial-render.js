// Procedural renderers for celestial bodies.
// Stars/black holes: WebGL2 with Canvas 2D fallback. Planets/moons: Canvas 2D.

import { CELESTIAL_VISUAL_SCALE } from './constants.js';
import { hashSeed } from './state.js';
import {
  drawStarCanvas2D,
  drawBlackHoleCanvas2D,
  resolveVisualSeed,
} from './celestial-render-canvas2d.js';
import {
  isStarRendererEnabled,
  queueStar,
  queueBlackHole,
} from './gl/star-renderer.js';
import { drawTradeNexus } from './trade-nexus-render.js';

export { resolveVisualSeed };

function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function transientNoise(seed, index, tick) {
  const value = Math.sin(seed * 12.9898 + index * 78.233 + tick * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function buildDischargePoints(sx, sy, ex, ey, amplitude, seed, time, count = 12, bow = 0) {
  const dx = ex - sx;
  const dy = ey - sy;
  const length = Math.hypot(dx, dy) || 1;
  const tx = dx / length;
  const ty = dy / length;
  const nx = -ty;
  const ny = tx;
  const tick = Math.floor(time / 46);
  const points = [];

  for (let i = 0; i <= count; i++) {
    const t = i / count;
    if (i === 0) {
      points.push({ x: sx, y: sy });
      continue;
    }
    if (i === count) {
      points.push({ x: ex, y: ey });
      continue;
    }
    const envelope = Math.sin(t * Math.PI);
    const lateral = ((transientNoise(seed, i, tick) - 0.5) * 2 * amplitude + bow) * envelope;
    const along = (transientNoise(seed + 19, i, tick) - 0.5) * amplitude * 0.24 * envelope;
    points.push({
      x: sx + dx * t + nx * lateral + tx * along,
      y: sy + dy * t + ny * lateral + ty * along,
    });
  }
  return points;
}

function strokeDischarge(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawDysonStarFury(ctx, r, completedShells, time) {
  const fury = clamp01((completedShells - 0.25) / 7.75);
  const heartbeat = 0.68
    + 0.2 * Math.sin(time / 245)
    + 0.12 * Math.sin(time / 83 + 1.3);
  const surge = clamp01(heartbeat);

  // The harvested photosphere bruises toward red at its edge while its core
  // pulses hotter, making the star feel compressed rather than simply dimmed.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const pressure = ctx.createRadialGradient(0, 0, r * 0.08, 0, 0, r * 1.18);
  pressure.addColorStop(0, `rgba(255, 252, 224, ${(0.025 + fury * 0.1) * surge})`);
  pressure.addColorStop(0.54, `rgba(255, 172, 52, ${0.025 + fury * 0.065})`);
  pressure.addColorStop(0.82, `rgba(255, 72, 22, ${(0.08 + fury * 0.2) * surge})`);
  pressure.addColorStop(1, 'rgba(116, 8, 4, 0)');
  ctx.fillStyle = pressure;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.18, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Fast, broken magnetic storm fronts move across the visible surface.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.98, 0, TAU);
  ctx.clip();

  ctx.globalCompositeOperation = 'multiply';
  const bruisedLimb = ctx.createRadialGradient(0, 0, r * 0.38, 0, 0, r);
  bruisedLimb.addColorStop(0, 'rgba(255, 228, 170, 0)');
  bruisedLimb.addColorStop(0.62, `rgba(205, 54, 16, ${0.035 + fury * 0.075})`);
  bruisedLimb.addColorStop(0.84, `rgba(119, 12, 5, ${0.1 + fury * 0.16})`);
  bruisedLimb.addColorStop(1, `rgba(45, 2, 2, ${0.15 + fury * 0.2})`);
  ctx.fillStyle = bruisedLimb;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  const stormCount = completedShells >= 7 ? 9 : completedShells >= 4 ? 7 : 4;
  for (let i = 0; i < stormCount; i++) {
    const phase = time * (0.00018 + i * 0.000011) + i * 2.07;
    const bandR = r * (0.28 + (i % 4) * 0.17);
    const span = 0.5 + 0.28 * Math.sin(time / 390 + i * 1.8);
    const localPulse = 0.48 + 0.52 * Math.sin(time / 170 + i * 1.37) ** 2;
    ctx.strokeStyle = i % 3 === 0
      ? `rgba(255, 246, 204, ${(0.11 + fury * 0.24) * localPulse})`
      : `rgba(255, ${60 + i * 9}, 10, ${(0.14 + fury * 0.3) * localPulse})`;
    ctx.lineWidth = Math.max(0.9, r * (0.009 + fury * 0.009));
    ctx.setLineDash([r * (0.045 + (i % 2) * 0.02), r * 0.026]);
    ctx.lineDashOffset = -time * (0.012 + i * 0.0015);
    ctx.beginPath();
    ctx.arc(0, 0, bandR, phase, phase + span);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // A few large, slow convection scars add scale beneath the fast storms.
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 4; i++) {
    const angle = time * 0.00004 + i * 1.71;
    const dist = r * (0.25 + (i % 2) * 0.28);
    const cx = Math.cos(angle) * dist;
    const cy = Math.sin(angle) * dist;
    const scarR = r * (0.11 + i * 0.015);
    const scar = ctx.createRadialGradient(cx, cy, 0, cx, cy, scarR);
    scar.addColorStop(0, `rgba(56, 2, 2, ${0.22 + fury * 0.28})`);
    scar.addColorStop(0.48, `rgba(146, 14, 5, ${0.12 + fury * 0.2})`);
    scar.addColorStop(1, 'rgba(255, 82, 18, 0)');
    ctx.fillStyle = scar;
    ctx.beginPath();
    ctx.ellipse(cx, cy, scarR * 1.55, scarR * 0.68, angle + 0.4, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(255, 102, 26, ${0.12 + fury * 0.2})`;
    ctx.lineWidth = Math.max(0.7, r * 0.007);
    ctx.beginPath();
    ctx.ellipse(cx, cy, scarR * 1.42, scarR * 0.58, angle + 0.4, -0.35, Math.PI * 0.82);
    ctx.stroke();
    ctx.globalCompositeOperation = 'multiply';
  }
  ctx.restore();

  // Radial pressure spikes push against the inner shell.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  const spikeCount = completedShells >= 6 ? 14 : 8;
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * TAU + time * 0.000027;
    const flicker = 0.35 + 0.65 * Math.sin(time / 135 + i * 2.23) ** 2;
    const startR = r * 0.88;
    const endR = r * (1.08 + fury * 0.16 + flicker * 0.08);
    const ray = ctx.createLinearGradient(
      Math.cos(angle) * startR,
      Math.sin(angle) * startR,
      Math.cos(angle) * endR,
      Math.sin(angle) * endR,
    );
    ray.addColorStop(0, `rgba(255, 245, 210, ${(0.16 + fury * 0.2) * flicker})`);
    ray.addColorStop(0.45, `rgba(255, 74, 20, ${(0.12 + fury * 0.22) * flicker})`);
    ray.addColorStop(1, 'rgba(255, 34, 8, 0)');
    ctx.strokeStyle = ray;
    ctx.lineWidth = Math.max(0.7, r * 0.007);
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * startR, Math.sin(angle) * startR);
    ctx.lineTo(Math.cos(angle) * endR, Math.sin(angle) * endR);
    ctx.stroke();
  }
  ctx.restore();

  // Small corona discharges snap rapidly around the limb. Their geometry is
  // quantized in short ticks so the silhouette crackles instead of drifting.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.shadowBlur = 0;
  const coronaTick = Math.floor(time / 42);
  const coronaCount = completedShells >= 6 ? 14 : 9;
  for (let i = 0; i < coronaCount; i++) {
    const energy = transientNoise(71 + completedShells, i, coronaTick);
    if (energy < 0.38) continue;
    const angle = (i / coronaCount) * TAU + time * 0.00008
      + (transientNoise(9, i, coronaTick) - 0.5) * 0.15;
    const innerR = r * (0.91 + transientNoise(17, i, coronaTick) * 0.045);
    const outerR = r * (1.02 + fury * 0.13 + energy * 0.08);
    const points = buildDischargePoints(
      Math.cos(angle) * innerR,
      Math.sin(angle) * innerR,
      Math.cos(angle + (energy - 0.5) * 0.08) * outerR,
      Math.sin(angle + (energy - 0.5) * 0.08) * outerR,
      r * 0.018,
      i * 31 + 5,
      time,
      4,
    );
    ctx.strokeStyle = `rgba(255, 61, 15, ${(0.1 + fury * 0.2) * energy})`;
    ctx.lineWidth = Math.max(1.2, r * 0.012);
    strokeDischarge(ctx, points);
    ctx.strokeStyle = `rgba(255, 244, 207, ${(0.22 + fury * 0.4) * energy})`;
    ctx.lineWidth = Math.max(0.45, r * 0.0035);
    strokeDischarge(ctx, points);
  }
  ctx.restore();

  // Magnetic cage discharges replace the old smooth tendrils. Each bolt snaps
  // to a new jagged path every few frames, forks unpredictably, and crawls its
  // contact point along the shell instead of ending in a decorative loop.
  const lashCount = completedShells >= 7 ? 4 : completedShells >= 4 ? 3 : 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.shadowBlur = 0;
  for (let i = 0; i < lashCount; i++) {
    const tick = Math.floor(time / (52 + i * 3));
    const pulse = Math.sin(time / (118 + i * 17) + i * 2.5);
    const cycle = clamp01((pulse + 0.58) / 1.22) ** 2;
    if (cycle < 0.025) continue;
    const angle = i * (TAU / lashCount) + time * (i % 2 ? -0.00006 : 0.000067) + 0.36;
    const reach = r * (1.15 + fury * 0.32 + i * 0.02);
    const sx = Math.cos(angle) * r * 0.91;
    const sy = Math.sin(angle) * r * 0.91;
    const contactJitter = (transientNoise(113, i, tick) - 0.5) * 0.22;
    const contactAngle = angle + 0.1 * Math.sin(time / 410 + i) + contactJitter;
    const ex = Math.cos(contactAngle) * reach;
    const ey = Math.sin(contactAngle) * reach;
    const points = buildDischargePoints(
      sx,
      sy,
      ex,
      ey,
      r * (0.055 + fury * 0.035),
      211 + i * 47,
      time,
      12,
      r * 0.035 * (i % 2 ? -1 : 1),
    );

    ctx.strokeStyle = `rgba(255, 32, 9, ${(0.09 + fury * 0.2) * cycle})`;
    ctx.lineWidth = Math.max(1.8, r * (0.017 + fury * 0.008));
    strokeDischarge(ctx, points);

    ctx.strokeStyle = `rgba(255, 116, 31, ${(0.2 + fury * 0.38) * cycle})`;
    ctx.lineWidth = Math.max(0.9, r * 0.0075);
    strokeDischarge(ctx, points);

    ctx.strokeStyle = `rgba(255, 247, 220, ${(0.35 + fury * 0.5) * cycle})`;
    ctx.lineWidth = Math.max(0.5, r * 0.0032);
    strokeDischarge(ctx, points);

    // Two short forks peel off the main channel at different depths.
    for (let branch = 0; branch < 2; branch++) {
      const sourceIndex = branch === 0 ? 4 : 8;
      const source = points[sourceIndex];
      const next = points[sourceIndex + 1];
      const dx = next.x - source.x;
      const dy = next.y - source.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      const nx = -ty;
      const ny = tx;
      const forkSide = transientNoise(307 + i, branch, tick) > 0.5 ? 1 : -1;
      const forkLength = r * (0.1 + transientNoise(401 + i, branch, tick) * 0.11);
      const forkEndX = source.x + tx * forkLength * 0.55 + nx * forkLength * forkSide;
      const forkEndY = source.y + ty * forkLength * 0.55 + ny * forkLength * forkSide;
      const fork = buildDischargePoints(
        source.x,
        source.y,
        forkEndX,
        forkEndY,
        r * 0.025,
        509 + i * 13 + branch,
        time,
        5,
      );
      const forkEnergy = 0.42 + transientNoise(601 + i, branch, tick) * 0.58;
      ctx.strokeStyle = `rgba(255, 76, 18, ${(0.16 + fury * 0.28) * cycle * forkEnergy})`;
      ctx.lineWidth = Math.max(0.65, r * 0.005);
      strokeDischarge(ctx, fork);
      ctx.strokeStyle = `rgba(255, 241, 206, ${(0.2 + fury * 0.34) * cycle * forkEnergy})`;
      ctx.lineWidth = Math.max(0.35, r * 0.0022);
      strokeDischarge(ctx, fork);
    }

    // Contact is a sharp multi-ray flash, not a circular ornament.
    for (let ray = 0; ray < 5; ray++) {
      const rayAngle = contactAngle + (ray / 5) * TAU
        + transientNoise(701 + i, ray, tick) * 0.35;
      const rayLength = r * (0.018 + transientNoise(809 + i, ray, tick) * 0.045) * cycle;
      ctx.strokeStyle = `rgba(255, 235, 188, ${(0.25 + fury * 0.45) * cycle})`;
      ctx.lineWidth = Math.max(0.4, r * 0.0025);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(rayAngle) * rayLength, ey + Math.sin(rayAngle) * rayLength);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Concentric compression waves make the whole stellar body throb against
  // the machine without hiding the collectors in a broad bloom.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 3; i++) {
    const wave = (time * 0.00018 + i / 3) % 1;
    ctx.strokeStyle = `rgba(255, ${58 + i * 24}, 16, ${(0.08 + fury * 0.13) * (1 - wave)})`;
    ctx.lineWidth = Math.max(0.55, r * 0.006 * (1 - wave));
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.01 + wave * (0.18 + fury * 0.08)), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dyson shell glow on star (tier rings + dots moved to dyson-render.js). */
export function drawStarOverlays(ctx, opts) {
  const { completedShells = 0, starRadius = 40, x = 0, y = 0, zoom = 1, time = 0 } = opts;
  if (completedShells < 1) return;

  const r = starRadius * zoom * CELESTIAL_VISUAL_SCALE;
  ctx.save();
  ctx.translate(x, y);

  if (completedShells >= 7) {
    const dim = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.85);
    dim.addColorStop(0, 'rgba(8, 10, 18, 0.28)');
    dim.addColorStop(0.45, 'rgba(8, 10, 18, 0.12)');
    dim.addColorStop(1, 'rgba(8, 10, 18, 0)');
    ctx.fillStyle = dim;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.6);
  glow.addColorStop(0, `rgba(255, 200, 100, ${0.05 + completedShells * 0.015})`);
  glow.addColorStop(1, 'rgba(255, 160, 60, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
  ctx.fill();

  drawDysonStarFury(ctx, r, completedShells, time);

  if (completedShells >= 8) {
    const pulse = 0.65 + 0.35 * Math.sin(time / 620);
    const accR = r * 0.38;
    ctx.strokeStyle = `rgba(255, 210, 140, ${0.4 * pulse})`;
    ctx.lineWidth = Math.max(1, 1.4 * zoom);
    ctx.beginPath();
    ctx.ellipse(0, 0, accR * 1.2, accR * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawBlackHole(ctx, x, y, r, time, large, warp = 0, visual = null) {
  if (isStarRendererEnabled()) {
    queueBlackHole({ x, y, screenR: r, time, large, warp, visual });
    return;
  }
  drawBlackHoleCanvas2D(ctx, x, y, r, time, large, visual);
}

export function drawStar(ctx, opts) {
  const { star } = opts;
  if (star.kind === 'blackhole') {
    const transit = opts.state?.flagship?.wormholeTransit;
    const progress = transit
      ? Math.max(0, Math.min(1, (opts.state.time - transit.startTime) / Math.max(1, transit.durationMs)))
      : 0;
    const visual = opts.wormholeVisual;
    const warp = visual?.phase === 'transit' ? 1
      : visual?.phase === 'opening' ? 0.35 + visual.progress
        : visual?.phase === 'charging' ? visual.progress * 0.35
          : visual?.phase === 'collapse' || visual?.phase === 'arrival'
            ? Math.max(0, 1 - visual.progress) : (transit ? Math.sin(progress * Math.PI) : 0);
    drawBlackHole(ctx, opts.x, opts.y, opts.screenR, opts.time, opts.mode === 'system', warp, visual);
    return;
  }
  if (star.kind === 'trade_nexus') {
    drawTradeNexus(ctx, opts.x, opts.y, opts.screenR, opts.time, {
      intel: opts.intel,
      compact: opts.mode === 'galaxy',
    });
    return;
  }
  if (isStarRendererEnabled()) {
    queueStar(opts);
    return;
  }
  drawStarCanvas2D(ctx, opts);
}

function drawSilhouette(ctx, x, y, r, outlineAlpha = 0.35) {
  const grad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
  grad.addColorStop(0, 'rgba(70, 78, 95, 0.65)');
  grad.addColorStop(1, 'rgba(35, 42, 58, 0.85)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(120, 140, 180, ${outlineAlpha})`;
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.06, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHabitablePlanet(ctx, x, y, r, seed, time, lightAngle) {
  const rng = seededRng(seed);
  const ocean = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  ocean.addColorStop(0, '#5eb8d4');
  ocean.addColorStop(0.55, '#2a7a9a');
  ocean.addColorStop(1, '#1a4a62');
  ctx.fillStyle = ocean;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  const continentCount = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < continentCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * (0.1 + rng() * 0.55);
    const cx = x + Math.cos(angle) * dist;
    const cy = y + Math.sin(angle) * dist;
    const cr = r * (0.12 + rng() * 0.22);
    ctx.fillStyle = `rgba(${Math.floor(60 + rng() * 50)}, ${Math.floor(110 + rng() * 40)}, ${Math.floor(50 + rng() * 30)}, 0.9)`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr, cr * (0.5 + rng() * 0.5), angle + rng(), 0, Math.PI * 2);
    ctx.fill();
  }

  const cloudPhase = (time / 90000) * Math.PI * 2;
  for (let i = 0; i < 4; i++) {
    const ca = cloudPhase + i * 1.2 + rng();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + rng() * 0.1})`;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, r * (0.75 + i * 0.05), ca, ca + Math.PI * 0.35);
    ctx.stroke();
  }

  drawTerminator(ctx, x, y, r, lightAngle);
  drawAtmosphere(ctx, x, y, r, '#6ec4e8');
}

function drawBarrenPlanet(ctx, x, y, r, seed, lightAngle) {
  const rng = seededRng(seed);
  const rock = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.05, x, y, r);
  rock.addColorStop(0, '#b8a690');
  rock.addColorStop(0.5, '#8a7560');
  rock.addColorStop(1, '#5a4a3a');
  ctx.fillStyle = rock;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  const craterCount = 6 + Math.floor(rng() * 7);
  for (let i = 0; i < craterCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * (0.05 + rng() * 0.7);
    const cx = x + Math.cos(angle) * dist;
    const cy = y + Math.sin(angle) * dist;
    const cr = r * (0.05 + rng() * 0.12);
    ctx.strokeStyle = `rgba(40, 30, 25, ${0.35 + rng() * 0.25})`;
    ctx.lineWidth = Math.max(0.5, r * 0.04);
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(50, 40, 35, ${0.2 + rng() * 0.15})`;
    ctx.beginPath();
    ctx.arc(cx + cr * 0.15, cy + cr * 0.1, cr * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTerminator(ctx, x, y, r, lightAngle);
}

function drawGasPlanet(ctx, x, y, r, seed, time) {
  const rng = seededRng(seed);
  const bandCount = 8 + Math.floor(rng() * 7);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  for (let i = 0; i < bandCount; i++) {
    const t = i / bandCount;
    const bandY = y - r + t * r * 2;
    const bandH = (r * 2) / bandCount * (0.8 + rng() * 0.4);
    const hue = rng();
    const color = hue < 0.33
      ? `rgba(${180 + rng() * 40}, ${120 + rng() * 50}, ${200 + rng() * 30}, 0.85)`
      : hue < 0.66
        ? `rgba(${140 + rng() * 60}, ${90 + rng() * 40}, ${180 + rng() * 40}, 0.8)`
        : `rgba(${200 + rng() * 30}, ${150 + rng() * 50}, ${100 + rng() * 40}, 0.75)`;
    ctx.fillStyle = color;
    ctx.fillRect(x - r, bandY, r * 2, bandH);
  }

  const stormAngle = (time / 60000) * Math.PI * 2 + rng() * 6;
  const sx = x + Math.cos(stormAngle) * r * 0.35;
  const sy = y + Math.sin(stormAngle) * r * 0.2;
  ctx.fillStyle = 'rgba(255, 200, 120, 0.55)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.28, r * 0.18, stormAngle * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (rng() < 0.3) {
    ctx.strokeStyle = 'rgba(200, 180, 160, 0.35)';
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.55, r * 0.35, rng() * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }

  const limb = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.2, x, y, r);
  limb.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  limb.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawTerminator(ctx, x, y, r, lightAngle) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const shade = ctx.createLinearGradient(
    x + Math.cos(lightAngle) * r,
    y + Math.sin(lightAngle) * r,
    x - Math.cos(lightAngle) * r,
    y - Math.sin(lightAngle) * r,
  );
  shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(0.45, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function drawAtmosphere(ctx, x, y, r, tint) {
  ctx.strokeStyle = hexToRgba(tint, 0.35);
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.08, 0, Math.PI * 2);
  ctx.stroke();
  const haze = ctx.createRadialGradient(x, y, r * 0.92, x, y, r * 1.12);
  haze.addColorStop(0, hexToRgba(tint, 0));
  haze.addColorStop(1, hexToRgba(tint, 0.15));
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.12, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPlanet(ctx, { planet, x, y, screenR, time, intel, lightAngle, state, systemId }) {
  const r = screenR * CELESTIAL_VISUAL_SCALE;
  if (!intel) {
    drawSilhouette(ctx, x, y, r);
    return;
  }

  const seed = resolveVisualSeed(state, systemId, planet.id, planet.visualSeed);
  if (planet.type === 'habitable') drawHabitablePlanet(ctx, x, y, r, seed, time, lightAngle);
  else if (planet.type === 'gas') drawGasPlanet(ctx, x, y, r, seed, time);
  else drawBarrenPlanet(ctx, x, y, r, seed, lightAngle);
}

function drawRockyMoon(ctx, x, y, r, seed) {
  const rng = seededRng(seed);
  const base = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.05, x, y, r);
  base.addColorStop(0, '#c8d0dc');
  base.addColorStop(0.6, '#98a4b8');
  base.addColorStop(1, '#6a7488');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  const craters = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < craters; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * rng() * 0.65;
    ctx.fillStyle = `rgba(50, 55, 70, ${0.25 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r * (0.08 + rng() * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawIceMoon(ctx, x, y, r, seed) {
  const rng = seededRng(seed);
  const ice = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.05, x, y, r);
  ice.addColorStop(0, '#eef6ff');
  ice.addColorStop(0.5, '#b8cce8');
  ice.addColorStop(1, '#7a94b8');
  ctx.fillStyle = ice;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + rng() * 0.15})`;
  ctx.lineWidth = Math.max(0.5, r * 0.08);
  for (let i = 0; i < 3; i++) {
    const angle = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.5 + rng() * 0.4), angle, angle + Math.PI * 0.4);
    ctx.stroke();
  }
}

function drawMoonShadow(ctx, x, y, r, lightAngle, planetX, planetY) {
  const toStar = lightAngle + Math.PI;
  const mx = x - planetX;
  const my = y - planetY;
  const moonAngle = Math.atan2(my, mx);
  let diff = moonAngle - toStar;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > Math.PI * 0.55) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.arc(x - Math.cos(lightAngle) * r, y - Math.sin(lightAngle) * r, r * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMoon(ctx, {
  moon, x, y, screenR, intel, lightAngle, planetX, planetY, planetScreenR, state, systemId,
}) {
  const r = screenR * CELESTIAL_VISUAL_SCALE;
  if (!intel) {
    drawSilhouette(ctx, x, y, r, 0.25);
    return;
  }

  const seed = resolveVisualSeed(state, systemId, moon.id, moon.visualSeed);
  const surface = moon.surface ?? (seed % 2 === 0 ? 'rocky' : 'ice');
  if (surface === 'ice') drawIceMoon(ctx, x, y, r, seed);
  else drawRockyMoon(ctx, x, y, r, seed);

  drawMoonShadow(ctx, x, y, r, lightAngle, planetX, planetY);
  drawTerminator(ctx, x, y, r, lightAngle);
}
