// Canvas 2D fallback for star and black-hole rendering when WebGL2 is unavailable.

import { CELESTIAL_VISUAL_SCALE } from './constants.js';
import { hashSeed } from './state.js';
import { getStarVisualProfile, starGpuUniforms } from './star-types.js';

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

function drawLensSpikes(ctx, x, y, r, color, count, rot) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const angle = rot + (i * Math.PI * 2) / count;
    const len = r * (2.2 + (i % 2) * 0.6);
    const gx = ctx.createLinearGradient(x, y, x + Math.cos(angle) * len, y + Math.sin(angle) * len);
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
  const count = 52 + Math.floor(rng() * 30);
  const drift = (time * rotSpeed) % (Math.PI * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < count; i++) {
    const angle = drift + rng() * Math.PI * 2;
    const dist = r * (0.08 + rng() * 0.72);
    const cellR = r * (0.025 + rng() * 0.035);
    ctx.fillStyle = hexToRgba(shiftHex(color, rng() > 0.5 ? 38 : -8), 0.08 + rng() * 0.16);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, cellR * 1.35, cellR, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 24; i++) {
    const angle = drift * 0.7 + rng() * Math.PI * 2;
    const dist = r * (0.12 + rng() * 0.68);
    ctx.strokeStyle = `rgba(75, 35, 18, ${0.05 + rng() * 0.08})`;
    ctx.lineWidth = Math.max(0.5, r * (0.006 + rng() * 0.006));
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r * (0.05 + rng() * 0.1), angle, angle + Math.PI * (0.45 + rng() * 0.4));
    ctx.stroke();
  }
  ctx.restore();
}

function drawSunspots(ctx, x, y, r, rng, time, rotSpeed, countScale) {
  const spotCount = Math.max(1, Math.floor((3 + rng() * 3) * countScale));
  const rot = (time * rotSpeed) % (Math.PI * 2);
  for (let i = 0; i < spotCount; i++) {
    const angle = rot + rng() * Math.PI * 2;
    const dist = r * (0.15 + rng() * 0.55);
    const spotR = r * (0.06 + rng() * 0.1);
    ctx.fillStyle = `rgba(20, 15, 10, ${0.25 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, spotR, spotR * 0.7, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProminences(ctx, x, y, r, rng, time, color, rotSpeed) {
  const count = 2 + Math.floor(rng() * 3);
  const base = (time * rotSpeed * 0.6) % (Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const startAngle = base + rng() * Math.PI * 2;
    const loopR = r * (1.05 + rng() * 0.15);
    ctx.strokeStyle = hexToRgba(shiftHex(color, 20), 0.35 + rng() * 0.2);
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(startAngle) * loopR, y + Math.sin(startAngle) * loopR);
    ctx.quadraticCurveTo(
      x + Math.cos(startAngle + 0.6) * r * 1.5,
      y + Math.sin(startAngle + 0.6) * r * 1.5,
      x + Math.cos(startAngle + 1.2) * loopR,
      y + Math.sin(startAngle + 1.2) * loopR,
    );
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

function siteHash(seed, i) {
  const x = Math.sin((seed * 0.000013 + i * 127.1) * 43758.5453);
  return x - Math.floor(x);
}

function drawLightning(ctx, x, y, r, time, seed, coronaColor, secondaryColor, temperature) {
  const t = time * 0.0018;
  const tint = temperature > 0.7
    ? hexToRgba('#d8e8ff', 1)
    : hexToRgba(coronaColor, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < 5; i++) {
    const angle = siteHash(seed, i) * Math.PI * 2;
    const reach = r * (0.2 + siteHash(seed, i + 5) * 0.45);
    const active = Math.sin(t * (1.6 + siteHash(seed, i + 7)) + siteHash(seed, i) * 6) > -0.2;
    if (!active) continue;

    const bx = x + Math.cos(angle) * r * 0.99;
    const by = y + Math.sin(angle) * r * 0.99;
    const steps = 12;
    const pts = [[bx, by]];

    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      const jag = (Math.sin(frac * 20 - t * 1.4 + i * 3.1) * 0.6
        + Math.sin(frac * 38 + t * 2 + i) * 0.4) * r * 0.07;
      pts.push([
        bx + Math.cos(angle) * reach * frac + Math.cos(angle + Math.PI / 2) * jag,
        by + Math.sin(angle) * reach * frac + Math.sin(angle + Math.PI / 2) * jag,
      ]);
    }

    ctx.strokeStyle = hexToRgba('#ffffff', 0.85);
    ctx.lineWidth = Math.max(1.5, r * 0.025);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = tint;
    ctx.shadowBlur = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
    ctx.stroke();

    ctx.strokeStyle = hexToRgba(coronaColor, 0.45);
    ctx.lineWidth = Math.max(3, r * 0.06);
    ctx.shadowBlur = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlareBurst(ctx, x, y, r, time, seed, color) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < 4; i++) {
    const phase = ((time * (0.00016 + siteHash(seed, i + 32) * 0.00014) + siteHash(seed, i + 12)) % 1);
    const strike = phase < 0.38
      ? Math.sin((phase / 0.38) * Math.PI)
      : Math.max(0, 1 - (phase - 0.38) / 0.44) * 0.24;
    const simmer = 0.08 + 0.06 * Math.sin(time * 0.001 + i * 2.3);
    const intensity = Math.max(strike, simmer);
    if (intensity <= 0.04) continue;

    const angle = siteHash(seed, i + 100) * Math.PI * 2 + time * 0.00003;
    const reach = r * (0.7 + siteHash(seed, i + 120) * 0.7);
    const sx = x + Math.cos(angle) * r * 0.92;
    const sy = y + Math.sin(angle) * r * 0.92;
    const ex = x + Math.cos(angle) * (r + reach);
    const ey = y + Math.sin(angle) * (r + reach);
    const bend = (siteHash(seed, i + 140) - 0.5) * r * 0.55;
    const cx = x + Math.cos(angle) * (r + reach * 0.42) + Math.cos(angle + Math.PI / 2) * bend;
    const cy = y + Math.sin(angle) * (r + reach * 0.42) + Math.sin(angle + Math.PI / 2) * bend;

    ctx.shadowColor = color;
    ctx.shadowBlur = r * 0.18;
    ctx.strokeStyle = hexToRgba(color, 0.28 * intensity);
    ctx.lineWidth = Math.max(3, r * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();

    ctx.shadowBlur = r * 0.08;
    ctx.strokeStyle = `rgba(255, 248, 220, ${0.7 * intensity})`;
    ctx.lineWidth = Math.max(1, r * 0.026);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }

  ctx.restore();
}

function drawStarBloom(ctx, x, y, r, profile, color, time, intel, compact) {
  if (!intel) return;
  const glowScale = profile.glowScale * (compact ? 0.85 : 1);
  const pulse = pulseAlpha(time, profile.pulseSpeed, 0.5, hasFeature(profile, 'diffuseHalo') ? 0.2 : 0.1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const outerGlow = ctx.createRadialGradient(x, y, r * 0.15, x, y, r * glowScale);
  outerGlow.addColorStop(0, hexToRgba(profile.coronaColor, 0.25 + 0.15 * pulse));
  outerGlow.addColorStop(0.45, hexToRgba(profile.secondaryColor, 0.15 * pulse));
  outerGlow.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = outerGlow;
  ctx.beginPath();
  ctx.arc(x, y, r * glowScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStarCore(ctx, x, y, r, profile, color, intel) {
  const coreAlpha = intel ? (hasFeature(profile, 'compactCore') ? 0.98 : 0.88) : 0.45;
  const core = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.05, x, y, r);
  core.addColorStop(0, hexToRgba(shiftHex(color, 60), coreAlpha));
  core.addColorStop(0.55, hexToRgba(color, coreAlpha));
  core.addColorStop(1, hexToRgba(shiftHex(color, -40), intel ? 0.75 : 0.35));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawStarGalaxyCompact(ctx, x, y, r, profile, color, time, intel, rng) {
  drawStarBloom(ctx, x, y, r, profile, color, time, intel, true);
  drawStarCore(ctx, x, y, r, profile, intel ? color : '#505868', intel);
  if (intel) drawCoronaArcs(ctx, x, y, r, profile.coronaColor, time, rng, 2, 5200);
}

function drawStarSystemFull(ctx, x, y, r, profile, color, time, intel, rng, seed) {
  drawStarBloom(ctx, x, y, r, profile, color, time, intel, false);
  if (intel && hasFeature(profile, 'lensSpikes')) {
    drawLensSpikes(ctx, x, y, r, profile.coronaColor, 8, (time * profile.rotationSpeed * 40) % (Math.PI * 2));
  }
  drawStarCore(ctx, x, y, r, profile, intel ? color : '#505868', intel);
  if (intel && hasFeature(profile, 'granulation')) {
    drawGranulation(ctx, x, y, r, seed, time, color, profile.rotationSpeed * 50);
  }
  if (intel) {
    if (hasFeature(profile, 'sunspots')) {
      drawSunspots(ctx, x, y, r, rng, time, profile.rotationSpeed * 60, hasFeature(profile, 'compactCore') ? 0.5 : 1);
    }
    drawCoronaArcs(ctx, x, y, r, profile.coronaColor, time, rng, 3, 4200);
    if (hasFeature(profile, 'prominences')) {
      drawProminences(ctx, x, y, r, rng, time, profile.secondaryColor, profile.rotationSpeed * 45);
    }
    if (hasFeature(profile, 'flareBursts')) {
      drawFlareBurst(ctx, x, y, r, time, seed, profile.coronaColor);
    }
    if (hasFeature(profile, 'lightning')) {
      const gpu = starGpuUniforms(profile);
      drawLightning(ctx, x, y, r, time, seed, profile.coronaColor, profile.secondaryColor, gpu.temperature);
    }
  }
}

export function drawStarCanvas2D(ctx, { star, x, y, screenR, time, intel, state, systemId, mode = 'system' }) {
  const r = screenR * CELESTIAL_VISUAL_SCALE;
  const seed = resolveVisualSeed(state, systemId, 'star', star.visualSeed);
  const rng = seededRng(seed);
  const profile = getStarVisualProfile(star);
  const color = intel ? (star.color ?? profile.color) : '#505868';
  if (mode === 'galaxy') {
    drawStarGalaxyCompact(ctx, x, y, r, profile, color, time, intel, rng);
  } else {
    drawStarSystemFull(ctx, x, y, r, profile, color, time, intel, rng, seed);
  }
}

export function drawBlackHoleCanvas2D(ctx, x, y, r, time, large) {
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

  ctx.fillStyle = '#02030a';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 130, 255, 0.6)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.stroke();
}
