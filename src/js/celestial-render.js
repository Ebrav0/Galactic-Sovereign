// Procedural Canvas 2D renderers for system-view celestial bodies.
// Pure drawing — no state mutation. API is stable for future Pixi swap.

import { CELESTIAL_VISUAL_SCALE } from './constants.js';
import { hashSeed } from './state.js';
import { getStarVisualProfile } from './star-types.js';

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shiftHex(hex, amount) {
  const clamp = (n) => Math.max(0, Math.min(255, n));
  const r = clamp(parseInt(hex.slice(1, 3), 16) + amount);
  const g = clamp(parseInt(hex.slice(3, 5), 16) + amount);
  const b = clamp(parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

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

export function resolveVisualSeed(state, systemId, entityId, stored) {
  if (stored != null) return stored >>> 0;
  return hashSeed(state.meta.seed, `${systemId}:${entityId}`);
}


function hasFeature(profile, feature) {
  return profile?.features?.includes(feature) ?? false;
}

function pulseAlpha(time, speed, base, amplitude) {
  return base + amplitude * (0.5 + 0.5 * Math.sin(time * speed));
}

function drawGodRays(ctx, x, y, r, color, count, rot, alpha, lengthScale = 2.8) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, y);
  ctx.rotate(rot);
  for (let i = 0; i < count; i++) {
    ctx.rotate((Math.PI * 2) / count);
    const ray = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * lengthScale);
    ray.addColorStop(0, hexToRgba(color, alpha));
    ray.addColorStop(0.45, hexToRgba(color, alpha * 0.35));
    ray.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * lengthScale, -0.12, 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawChromosphere(ctx, x, y, r, innerColor, outerColor, alpha) {
  const ring = ctx.createRadialGradient(x, y, r * 0.82, x, y, r * 1.18);
  ring.addColorStop(0, hexToRgba(innerColor, 0));
  ring.addColorStop(0.55, hexToRgba(outerColor, alpha));
  ring.addColorStop(1, hexToRgba(outerColor, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.18, 0, Math.PI * 2);
  ctx.arc(x, y, r * 0.82, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();
}

function drawCompactGranulation(ctx, x, y, r, seed, time, color, rotSpeed, count = 10) {
  const rng = seededRng(seed ^ 0x4d2a1f9c);
  const drift = (time * rotSpeed) % (Math.PI * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.95, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < count; i++) {
    const angle = drift + rng() * Math.PI * 2;
    const dist = r * (0.1 + rng() * 0.65);
    const gr = r * (0.04 + rng() * 0.07);
    ctx.fillStyle = hexToRgba(shiftHex(color, rng() > 0.5 ? 30 : -20), 0.18 + rng() * 0.15);
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, gr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLensSpikes(ctx, x, y, r, color, count, rot, scale = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const angle = rot + (i * Math.PI * 2) / count;
    const len = r * (2.2 + (i % 2) * 0.6) * scale;
    const gx = ctx.createLinearGradient(
      x, y,
      x + Math.cos(angle) * len,
      y + Math.sin(angle) * len,
    );
    gx.addColorStop(0, hexToRgba(color, 0.55));
    gx.addColorStop(0.35, hexToRgba(color, 0.18));
    gx.addColorStop(1, hexToRgba(color, 0));
    ctx.strokeStyle = gx;
    ctx.lineWidth = Math.max(0.5, r * 0.04);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGranulation(ctx, x, y, r, seed, time, color, rotSpeed) {
  const rng = seededRng(seed ^ 0x9a7b3c1d);
  const count = 24 + Math.floor(rng() * 18);
  const drift = (time * rotSpeed) % (Math.PI * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < count; i++) {
    const angle = drift + rng() * Math.PI * 2;
    const dist = r * (0.08 + rng() * 0.72);
    const gx = x + Math.cos(angle) * dist;
    const gy = y + Math.sin(angle) * dist;
    const gr = r * (0.025 + rng() * 0.045);
    ctx.fillStyle = hexToRgba(shiftHex(color, rng() > 0.5 ? 25 : -15), 0.12 + rng() * 0.12);
    ctx.beginPath();
    ctx.ellipse(gx, gy, gr, gr * (0.6 + rng() * 0.5), angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSunspots(ctx, x, y, r, rng, time, rotSpeed, countScale) {
  const spotCount = Math.max(1, Math.floor((3 + rng() * 3) * countScale));
  const rot = (time * rotSpeed) % (Math.PI * 2);
  for (let i = 0; i < spotCount; i++) {
    const angle = rot + rng() * Math.PI * 2;
    const dist = r * (0.15 + rng() * 0.55);
    const sx = x + Math.cos(angle) * dist;
    const sy = y + Math.sin(angle) * dist;
    const spotR = r * (0.06 + rng() * 0.1);
    ctx.fillStyle = `rgba(20, 15, 10, ${0.25 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, spotR, spotR * (0.6 + rng() * 0.4), angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProminences(ctx, x, y, r, rng, time, color, rotSpeed) {
  const count = 2 + Math.floor(rng() * 3);
  const base = (time * rotSpeed * 0.6) % (Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const startAngle = base + rng() * Math.PI * 2;
    const loopR = r * (1.05 + rng() * 0.15);
    const cpAngle = startAngle + 0.4 + rng() * 0.5;
    const cpR = r * (1.35 + rng() * 0.35);
    const endAngle = startAngle + 0.6 + rng() * 0.8;
    const sx = x + Math.cos(startAngle) * loopR;
    const sy = y + Math.sin(startAngle) * loopR;
    const cpx = x + Math.cos(cpAngle) * cpR;
    const cpy = y + Math.sin(cpAngle) * cpR;
    const ex = x + Math.cos(endAngle) * loopR;
    const ey = y + Math.sin(endAngle) * loopR;
    ctx.strokeStyle = hexToRgba(shiftHex(color, 20), 0.35 + rng() * 0.2);
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cpx, cpy, ex, ey);
    ctx.stroke();
  }
}

function drawCoronaArcs(ctx, x, y, r, color, time, rng, count, speed) {
  const base = (time / speed) * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const start = base + i * 1.4 + rng() * 0.5;
    ctx.strokeStyle = hexToRgba(shiftHex(color, 30), 0.35 + i * 0.08);
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.arc(x, y, r * (1.15 + i * 0.12), start, start + Math.PI * (0.5 + rng() * 0.35));
    ctx.stroke();
  }
}

function drawFlareBurst(ctx, x, y, r, time, seed, color) {
  const phase = ((time * 0.0012 + seed * 0.00001) % 1);
  if (phase > 0.12) return;
  const intensity = 1 - phase / 0.12;
  const flare = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 2.5);
  flare.addColorStop(0, hexToRgba('#ffffff', 0.7 * intensity));
  flare.addColorStop(0.2, hexToRgba(color, 0.45 * intensity));
  flare.addColorStop(1, hexToRgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = flare;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Future Dyson shell ring overlays attach here. */
export function drawStarOverlays(_ctx, _opts) {
  // no-op — megastructure visuals in a later phase
}

export function drawBlackHole(ctx, x, y, r, time, large) {
  const diskScale = large ? 2.6 : 1.9;

  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * (diskScale + 1.6));
  glow.addColorStop(0, 'rgba(150, 90, 255, 0.30)');
  glow.addColorStop(0.6, 'rgba(90, 60, 200, 0.12)');
  glow.addColorStop(1, 'rgba(90, 60, 200, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * (diskScale + 1.6), 0, Math.PI * 2);
  ctx.fill();

  const shimmerPhase = (time / 3200) * Math.PI * 2;
  const disk = ctx.createRadialGradient(x, y, r * 1.02, x, y, r * diskScale);
  disk.addColorStop(0, `rgba(255, 170, 90, ${0.72 + 0.08 * Math.sin(shimmerPhase)})`);
  disk.addColorStop(0.35, `rgba(255, 120, 150, ${0.32 + 0.06 * Math.sin(shimmerPhase + 1.2)})`);
  disk.addColorStop(1, 'rgba(150, 90, 255, 0)');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(x, y, r * diskScale, 0, Math.PI * 2);
  ctx.arc(x, y, r, 0, Math.PI * 2, true);
  ctx.fill();

  const base = (time / 5000) * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const start = base * (1 + i * 0.35) + (i * Math.PI * 2) / 3;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(180, 130, 255, 0.55)' : 'rgba(122, 208, 255, 0.45)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r * (1.25 + i * 0.28), start, start + Math.PI * 0.9);
    ctx.stroke();
  }

  const baseReverse = -(time / 6800) * Math.PI * 2;
  for (let i = 0; i < 2; i++) {
    const start = baseReverse + i * 2.1;
    ctx.strokeStyle = 'rgba(200, 160, 255, 0.35)';
    ctx.lineWidth = Math.max(0.5, r * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, r * (1.55 + i * 0.22), start, start + Math.PI * 0.65);
    ctx.stroke();
  }

  ctx.fillStyle = '#02030a';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 130, 255, 0.6)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.stroke();
}

function drawStarBloom(ctx, x, y, r, profile, color, time, intel, compact) {
  if (!intel) return;

  const glowScale = profile.glowScale * (compact ? 1.35 : 1);
  const pulse = pulseAlpha(time, profile.pulseSpeed, 0.5, hasFeature(profile, 'diffuseHalo') ? 0.28 : 0.16);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (compact) {
    const nebula = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * (glowScale + 1.2));
    nebula.addColorStop(0, hexToRgba(profile.secondaryColor, 0.08 * pulse));
    nebula.addColorStop(0.35, hexToRgba(profile.coronaColor, 0.14 * pulse));
    nebula.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = nebula;
    ctx.beginPath();
    ctx.arc(x, y, r * (glowScale + 1.2), 0, Math.PI * 2);
    ctx.fill();
  }

  const outerAlpha = hasFeature(profile, 'diffuseHalo') ? 0.32 * pulse : 0.22 * pulse;
  const outerGlow = ctx.createRadialGradient(x, y, r * 0.08, x, y, r * glowScale);
  outerGlow.addColorStop(0, hexToRgba('#ffffff', compact ? 0.35 : 0.25));
  outerGlow.addColorStop(0.18, hexToRgba(profile.coronaColor, outerAlpha + 0.3));
  outerGlow.addColorStop(0.5, hexToRgba(profile.secondaryColor, outerAlpha));
  outerGlow.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = outerGlow;
  if (compact) {
    ctx.shadowColor = profile.coronaColor;
    ctx.shadowBlur = r * 1.4;
  }
  ctx.beginPath();
  ctx.arc(x, y, r * glowScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const midGlow = ctx.createRadialGradient(x, y, r * 0.15, x, y, r * (compact ? 1.55 : 1.85));
  midGlow.addColorStop(0, hexToRgba('#ffffff', compact ? 0.45 : 0.35));
  midGlow.addColorStop(0.35, hexToRgba(shiftHex(color, 50), compact ? 0.5 : 0.55));
  midGlow.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = midGlow;
  ctx.beginPath();
  ctx.arc(x, y, r * (compact ? 1.55 : 1.85), 0, Math.PI * 2);
  ctx.fill();

  if (!compact && hasFeature(profile, 'diffuseHalo')) {
    const wide = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * (glowScale + 1.1));
    wide.addColorStop(0, hexToRgba(profile.secondaryColor, 0.12 * pulse));
    wide.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = wide;
    ctx.beginPath();
    ctx.arc(x, y, r * (glowScale + 1.1), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawStarCore(ctx, x, y, r, profile, color, intel) {
  const coreAlpha = intel ? (hasFeature(profile, 'compactCore') ? 0.98 : 0.92) : 0.45;
  const highlight = hasFeature(profile, 'compactCore') ? 90 : 70;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const hot = ctx.createRadialGradient(x - r * 0.2, y - r * 0.22, 0, x, y, r * 0.55);
  hot.addColorStop(0, hexToRgba('#ffffff', intel ? 0.95 : 0.4));
  hot.addColorStop(0.35, hexToRgba(shiftHex(color, highlight), coreAlpha));
  hot.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = hot;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  const core = ctx.createRadialGradient(x - r * 0.28, y - r * 0.3, r * 0.02, x, y, r);
  core.addColorStop(0, hexToRgba('#ffffff', intel ? 0.85 : 0.35));
  core.addColorStop(0.25, hexToRgba(shiftHex(color, highlight), coreAlpha));
  core.addColorStop(0.65, hexToRgba(color, coreAlpha * 0.95));
  core.addColorStop(1, hexToRgba(shiftHex(color, -50), intel ? 0.8 : 0.35));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawStarGalaxyCompact(ctx, x, y, r, profile, color, time, intel, rng, seed) {
  drawStarBloom(ctx, x, y, r, profile, color, time, intel, true);

  if (intel) {
    const rot = (time * profile.rotationSpeed * 55) % (Math.PI * 2);
    drawGodRays(ctx, x, y, r, profile.coronaColor, 6, rot, 0.12, 3.2);

    if (hasFeature(profile, 'lensSpikes')) {
      drawLensSpikes(ctx, x, y, r, profile.coronaColor, 6, rot * 0.7, 0.55);
    }

    drawChromosphere(ctx, x, y, r, color, profile.secondaryColor, 0.35);

    if (hasFeature(profile, 'granulation') || profile.id === 'yellow_dwarf' || profile.id === 'orange_dwarf') {
      drawCompactGranulation(ctx, x, y, r, seed, time, color, profile.rotationSpeed * 40, 12);
    }

    if (hasFeature(profile, 'sunspots')) {
      drawSunspots(ctx, x, y, r, rng, time, profile.rotationSpeed * 60, 0.7);
    }

    if (hasFeature(profile, 'flareBursts')) {
      drawFlareBurst(ctx, x, y, r, time, seed, color);
    }
  }

  drawStarCore(ctx, x, y, r, profile, intel ? color : '#505868', intel);
}

function drawStarSystemFull(ctx, x, y, r, profile, color, time, intel, rng, seed) {
  drawStarBloom(ctx, x, y, r, profile, color, time, intel, false);

  if (intel) {
    const rot = (time * profile.rotationSpeed * 40) % (Math.PI * 2);
    drawGodRays(ctx, x, y, r, profile.coronaColor, 8, rot, 0.08, 3.6);

    if (hasFeature(profile, 'lensSpikes')) {
      drawLensSpikes(ctx, x, y, r, profile.coronaColor, 8, rot);
    }

    drawChromosphere(ctx, x, y, r, color, profile.secondaryColor, 0.28);
  }

  if (intel && hasFeature(profile, 'granulation')) {
    drawGranulation(ctx, x, y, r, seed, time, color, profile.rotationSpeed * 50);
  }

  drawStarCore(ctx, x, y, r, profile, intel ? color : '#505868', intel);

  if (intel) {
    const spotScale = hasFeature(profile, 'compactCore') ? 0.5 : 1;
    if (hasFeature(profile, 'sunspots')) {
      drawSunspots(ctx, x, y, r, rng, time, profile.rotationSpeed * 60, spotScale);
    }

    drawCoronaArcs(ctx, x, y, r, profile.coronaColor, time, rng, 3, 4200);

    if (hasFeature(profile, 'prominences')) {
      drawProminences(ctx, x, y, r, rng, time, profile.secondaryColor, profile.rotationSpeed * 45);
    }

    if (hasFeature(profile, 'flareBursts')) {
      drawFlareBurst(ctx, x, y, r, time, seed, color);
    }
  }

  drawStarOverlays(ctx, { x, y, r, profile, time, intel });
}

export function drawStar(ctx, { star, x, y, screenR, time, intel, state, systemId, mode = 'system' }) {
  if (star.kind === 'blackhole') {
    drawBlackHole(ctx, x, y, screenR, time, mode === 'system');
    return;
  }

  const seed = resolveVisualSeed(state, systemId, 'star', star.visualSeed);
  const rng = seededRng(seed);
  const profile = getStarVisualProfile(star);
  const color = intel ? (star.color ?? profile.color) : '#505868';
  const r = mode === 'galaxy'
    ? screenR * 0.82
    : screenR * CELESTIAL_VISUAL_SCALE;

  if (mode === 'galaxy') {
    drawStarGalaxyCompact(ctx, x, y, r, profile, color, time, intel, rng, seed);
  } else {
    drawStarSystemFull(ctx, x, y, r, profile, color, time, intel, rng, seed);
  }
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

function drawMoonShadow(ctx, x, y, r, lightAngle, planetX, planetY, planetR) {
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

  drawMoonShadow(ctx, x, y, r, lightAngle, planetX, planetY, planetScreenR);
  drawTerminator(ctx, x, y, r, lightAngle);
}
