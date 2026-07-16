// Canvas 2D fallback for star and black-hole rendering when WebGL2 is unavailable.

import { CELESTIAL_VISUAL_SCALE } from './constants.js';
import { hashSeed } from './state.js';
import { getStarVisualProfile, stellarRenderParameters, starGpuUniforms } from './star-types.js';

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

function drawCinematicOptics(ctx, x, y, r, profile, time, compact = false) {
  const chromatic = Math.max(0.5, profile.chromaticStrength ?? 1);
  const rotation = (time * profile.rotationSpeed * 18) % (Math.PI * 2);
  drawLensSpikes(ctx, x, y, r, profile.coronaColor, compact ? 4 : 6, rotation);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const haloR = r * (compact ? 1.28 : 1.34);
  const haloAlpha = Math.min(0.24, 0.055 + chromatic * 0.05);
  ctx.lineWidth = Math.max(0.65, r * (compact ? 0.035 : 0.018));
  ctx.strokeStyle = `rgba(102, 202, 255, ${haloAlpha})`;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.018 * chromatic, y, haloR, haloR * 0.98, rotation * 0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 114, 74, ${haloAlpha * 0.72})`;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.018 * chromatic, y, haloR * 1.015, haloR, -rotation * 0.1, 0, Math.PI * 2);
  ctx.stroke();
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
  if (intel) drawCinematicOptics(ctx, x, y, r, profile, time, true);
  drawStarCore(ctx, x, y, r, profile, intel ? color : '#505868', intel);
  if (intel) drawCoronaArcs(ctx, x, y, r, profile.coronaColor, time, rng, 2, 5200);
}

function drawStarSystemFull(ctx, x, y, r, profile, color, time, intel, rng, seed) {
  drawStarBloom(ctx, x, y, r, profile, color, time, intel, false);
  if (intel) drawCinematicOptics(ctx, x, y, r, profile, time, false);
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

function drawBinaryFallback(ctx, x, y, r, profile, star, time, intel, compact) {
  const params = stellarRenderParameters(star, profile);
  const phase = time * 0.001 * params.orbitSpeed + params.orbitPhase;
  const sep = r * params.separation * (compact ? 0.74 : 1);
  const dx = Math.cos(phase) * sep;
  const dy = Math.sin(phase) * sep * params.axisCompression;
  const r1 = r * (compact ? 0.72 : 0.67);
  const r2 = r1 * params.companionScale;
  drawStarBloom(ctx, x - dx * 0.62, y - dy * 0.62, r2, profile, params.companionColor, time, intel, compact);
  drawStarCore(ctx, x - dx * 0.62, y - dy * 0.62, r2, profile, intel ? params.companionColor : '#505868', intel);
  drawStarBloom(ctx, x + dx * 0.48, y + dy * 0.48, r1, profile, star.color ?? profile.color, time, intel, compact);
  drawStarCore(ctx, x + dx * 0.48, y + dy * 0.48, r1, profile, intel ? (star.color ?? profile.color) : '#505868', intel);
  if (!intel) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hexToRgba(profile.coronaColor, 0.3);
  ctx.shadowColor = profile.coronaColor;
  ctx.shadowBlur = r * 0.35;
  ctx.lineWidth = Math.max(1, r * 0.055);
  ctx.beginPath();
  ctx.moveTo(x - dx * 0.4, y - dy * 0.4);
  ctx.lineTo(x + dx * 0.3, y + dy * 0.3);
  ctx.stroke();
  ctx.restore();
}

function drawSupergiantFallback(ctx, x, y, r, profile, star, time, intel, seed, compact) {
  const rng = seededRng(seed);
  const points = compact ? 28 : 54;
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 4.2);
  glow.addColorStop(0, hexToRgba(profile.coronaColor, intel ? 0.3 : 0.08));
  glow.addColorStop(1, hexToRgba(profile.coronaColor, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 4.2, 0, Math.PI * 2);
  ctx.fill();
  const surface = ctx.createRadialGradient(x - r * 0.25, y - r * 0.2, r * 0.08, x, y, r * 1.1);
  surface.addColorStop(0, intel ? '#fff2d6' : '#737987');
  surface.addColorStop(0.46, intel ? (star.color ?? profile.color) : '#505868');
  surface.addColorStop(1, intel ? profile.secondaryColor : '#303744');
  ctx.fillStyle = surface;
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 5 + time * 0.00008 + seed) * 0.035
      + Math.sin(a * 11 - time * 0.00005) * 0.018;
    const px = x + Math.cos(a) * r * wobble;
    const py = y + Math.sin(a) * r * wobble;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  if (intel && !compact) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2 + time * (0.00001 + rng() * 0.00002);
      const dist = r * (0.12 + rng() * 0.72);
      ctx.fillStyle = hexToRgba(i % 3 ? profile.coronaColor : '#fff6de', 0.08 + rng() * 0.16);
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * dist, y + Math.sin(a) * dist,
        r * (0.04 + rng() * 0.11), r * (0.025 + rng() * 0.07), a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPulsarFallback(ctx, x, y, r, profile, time, intel, compact) {
  const spin = time * 0.006;
  ctx.save();
  ctx.globalCompositeOperation = intel ? 'lighter' : 'source-over';
  if (intel) {
    const beamLen = r * (compact ? 3.2 : 6.8);
    const dx = Math.cos(spin) * beamLen;
    const dy = Math.sin(spin) * beamLen * 0.52;
    const grad = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
    grad.addColorStop(0, hexToRgba(profile.coronaColor, 0));
    grad.addColorStop(0.48, hexToRgba(profile.coronaColor, 0.62));
    grad.addColorStop(0.5, 'rgba(245,252,255,0.95)');
    grad.addColorStop(0.52, hexToRgba(profile.coronaColor, 0.62));
    grad.addColorStop(1, hexToRgba(profile.coronaColor, 0));
    ctx.strokeStyle = grad;
    ctx.shadowColor = profile.coronaColor;
    ctx.shadowBlur = r * 0.35;
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(profile.secondaryColor, 0.75);
    ctx.lineWidth = Math.max(1, r * 0.035);
    for (const scale of [0.78, 1.18]) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * scale, r * scale * 0.35, -spin * 0.16, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(86, 94, 116, 0.62)';
    ctx.lineWidth = Math.max(1, r * 0.045);
    for (const scale of [0.78, 1.18]) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * scale, r * scale * 0.35, -spin * 0.16, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  drawStarCore(ctx, x, y, r * 0.36, profile, intel ? profile.color : '#505868', intel);
  ctx.restore();
}

function drawQuasarFallback(ctx, x, y, r, profile, time, intel, compact) {
  ctx.save();
  ctx.globalCompositeOperation = intel ? 'lighter' : 'source-over';
  if (intel) {
    const jetLen = r * (compact ? 3.3 : 7.5);
    const jet = ctx.createLinearGradient(x, y - jetLen, x, y + jetLen);
    jet.addColorStop(0, hexToRgba(profile.coronaColor, 0));
    jet.addColorStop(0.46, hexToRgba(profile.coronaColor, 0.62));
    jet.addColorStop(0.5, 'rgba(255,255,245,0.9)');
    jet.addColorStop(0.54, hexToRgba(profile.coronaColor, 0.62));
    jet.addColorStop(1, hexToRgba(profile.coronaColor, 0));
    ctx.strokeStyle = jet;
    ctx.shadowColor = profile.coronaColor;
    ctx.shadowBlur = r * 0.4;
    ctx.lineWidth = Math.max(3, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(x, y - jetLen);
    ctx.lineTo(x, y + jetLen);
    ctx.stroke();
  }
  const disk = ctx.createRadialGradient(x - r, y, r * 0.1, x, y, r * 3.4);
  disk.addColorStop(0, 'rgba(255,250,224,0.95)');
  disk.addColorStop(0.35, hexToRgba(profile.secondaryColor, intel ? 0.85 : 0.2));
  disk.addColorStop(1, hexToRgba(profile.coronaColor, 0));
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.ellipse(x, y, r * (compact ? 2.1 : 3.5), r * (compact ? 0.55 : 0.78),
    Math.sin(time * 0.00015) * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#02030a';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = intel ? '#fff3d0' : '#59606e';
  ctx.lineWidth = Math.max(1.5, r * 0.055);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.67, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCompactRemnantFallback(ctx, x, y, r, profile, time, intel, compact, magnetar = false) {
  const spin = time * (magnetar ? 0.0042 : 0.0012);
  ctx.save();
  ctx.globalCompositeOperation = intel ? 'lighter' : 'source-over';
  ctx.strokeStyle = intel ? hexToRgba(profile.coronaColor, 0.72) : 'rgba(86,94,116,0.62)';
  ctx.shadowColor = profile.coronaColor;
  ctx.shadowBlur = r * 0.38;
  ctx.lineWidth = Math.max(1, r * 0.04);
  for (let i = 0; i < (magnetar ? 5 : 2); i++) {
    const scale = 0.78 + i * 0.24;
    ctx.beginPath();
    ctx.ellipse(x, y, r * scale, r * scale * (0.28 + i * 0.035), spin * (i % 2 ? -1 : 1) + i * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (magnetar && intel) {
    ctx.strokeStyle = 'rgba(255,238,255,0.82)';
    for (let i = 0; i < 4; i++) {
      const a = spin * 2.6 + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3);
      ctx.quadraticCurveTo(x + Math.cos(a + 0.8) * r * 1.6, y + Math.sin(a + 0.8) * r * 1.6,
        x + Math.cos(a + 1.4) * r * 2.5, y + Math.sin(a + 1.4) * r * 2.5);
      ctx.stroke();
    }
  }
  drawStarCore(ctx, x, y, r * 0.28, profile, intel ? profile.color : '#505868', intel);
  ctx.restore();
}

function drawBlackHoleBinaryFallback(ctx, x, y, r, profile, star, time, intel, compact) {
  drawQuasarFallback(ctx, x, y, r, profile, time, intel, compact);
  const params = stellarRenderParameters(star, profile);
  const phase = time * 0.001 * params.orbitSpeed + params.orbitPhase;
  const sep = r * (compact ? 1.05 : 1.35);
  const sx = x + Math.cos(phase) * sep;
  const sy = y + Math.sin(phase) * sep * 0.48;
  drawStarBloom(ctx, sx, sy, r * 0.46, profile, params.companionColor, time, intel, compact);
  drawStarCore(ctx, sx, sy, r * 0.46, profile, intel ? params.companionColor : '#505868', intel);
  if (intel) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexToRgba(profile.coronaColor, 0.62);
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + x) * 0.5, (sy + y) * 0.5 + r * 0.2, x, y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawModernStellarFallback(ctx, x, y, r, profile, star, time, intel, seed, compact) {
  const rng = seededRng(seed);
  const kind = profile.rendererKind;
  const coreScale = kind === 'compact' ? 0.58 : kind === 'brown_dwarf' ? 0.86 : kind === 'wolf_rayet' ? 0.68 : 1;
  drawStarBloom(ctx, x, y, r, profile, star.color ?? profile.color, time, intel, compact);
  if (intel) drawCinematicOptics(ctx, x, y, r, profile, time, compact);
  drawStarCore(ctx, x, y, r * coreScale, profile, intel ? (star.color ?? profile.color) : '#505868', intel);
  if (!intel) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = profile.coronaColor;
  ctx.shadowBlur = Math.max(3, r * 0.18);
  const rotation = time * (profile.rotationSpeed ?? 0.00002) * 35;

  if (kind === 'wolf_rayet') {
    drawLensSpikes(ctx, x, y, r, profile.coronaColor, compact ? 4 : 8, rotation);
    ctx.strokeStyle = hexToRgba(profile.coronaColor, 0.42);
    ctx.lineWidth = Math.max(1, r * 0.025);
    for (let i = 0; i < (compact ? 4 : 10); i++) {
      const a = rotation + i * 0.78;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.1 + i * 0.2), a, a + 1.2);
      ctx.stroke();
    }
  } else if (kind === 'brown_dwarf') {
    ctx.strokeStyle = hexToRgba(profile.coronaColor, 0.34);
    ctx.lineWidth = Math.max(1, r * 0.06);
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y + i * r * 0.14, r * Math.sqrt(Math.max(0.05, 1 - i * i * 0.022)), r * 0.08, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === 'compact') {
    drawLensSpikes(ctx, x, y, r, profile.coronaColor, compact ? 4 : 8, rotation);
    ctx.strokeStyle = hexToRgba(profile.coronaColor, 0.28);
    ctx.lineWidth = Math.max(0.75, r * 0.018);
    for (let i = 0; i < (compact ? 3 : 7); i++) {
      const a = rotation + i / 7 * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.15 + i * 0.16), a, a + 0.62);
      ctx.stroke();
    }
    ctx.strokeStyle = hexToRgba(profile.coronaColor, 0.68);
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.18, r * 0.46, rotation, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'flare') {
    drawFlareBurst(ctx, x, y, r, time, seed, profile.coronaColor);
    drawProminences(ctx, x, y, r, rng, time, profile.secondaryColor, profile.rotationSpeed * 65);
    drawLightning(ctx, x, y, r, time, seed, profile.coronaColor, profile.secondaryColor, 0.42);
  } else {
    drawGranulation(ctx, x, y, r, seed, time, star.color ?? profile.color, profile.rotationSpeed * 58);
    drawCoronaArcs(ctx, x, y, r, profile.coronaColor, time, rng, compact ? 2 : 5, 3600);
    if (!compact) drawProminences(ctx, x, y, r, rng, time, profile.secondaryColor, profile.rotationSpeed * 48);
  }
  ctx.restore();
}

function drawExoticFallback(ctx, opts, profile, seed) {
  const { star, x, y, time, intel, mode = 'system' } = opts;
  const r = opts.screenR * CELESTIAL_VISUAL_SCALE;
  const compact = mode === 'galaxy';
  if (profile.rendererKind === 'binary') drawBinaryFallback(ctx, x, y, r, profile, star, time, intel, compact);
  else if (profile.rendererKind === 'supergiant' || profile.rendererKind === 'giant' || profile.rendererKind === 'hypergiant') drawSupergiantFallback(ctx, x, y, r, profile, star, time, intel, seed, compact);
  else if (profile.rendererKind === 'pulsar') drawPulsarFallback(ctx, x, y, r, profile, time, intel, compact);
  else if (profile.rendererKind === 'neutron') drawCompactRemnantFallback(ctx, x, y, r, profile, time, intel, compact, false);
  else if (profile.rendererKind === 'magnetar') drawCompactRemnantFallback(ctx, x, y, r, profile, time, intel, compact, true);
  else if (profile.rendererKind === 'black_hole_binary') drawBlackHoleBinaryFallback(ctx, x, y, r, profile, star, time, intel, compact);
  else if (profile.rendererKind === 'quasar') drawQuasarFallback(ctx, x, y, r, profile, time, intel, compact);
  else drawModernStellarFallback(ctx, x, y, r, profile, star, time, intel, seed, compact);
}

export function drawStarCanvas2D(ctx, { star, x, y, screenR, time, intel, state, systemId, mode = 'system' }) {
  const r = screenR * CELESTIAL_VISUAL_SCALE;
  const seed = resolveVisualSeed(state, systemId, 'star', star.visualSeed);
  const rng = seededRng(seed);
  const profile = getStarVisualProfile(star);
  if (profile.rendererKind !== 'sphere') {
    drawExoticFallback(ctx, { star, x, y, screenR, time, intel, state, systemId, mode }, profile, seed);
    return;
  }
  const color = intel ? (star.color ?? profile.color) : '#505868';
  if (mode === 'galaxy') {
    drawStarGalaxyCompact(ctx, x, y, r, profile, color, time, intel, rng);
  } else {
    drawStarSystemFull(ctx, x, y, r, profile, color, time, intel, rng, seed);
  }
}

export function drawBlackHoleCanvas2D(ctx, x, y, r, time, large, visual = null) {
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

  const phase = visual?.phase ?? 'dormant';
  const progress = Math.max(0, Math.min(1, visual?.progress ?? 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const anchored = phase === 'anchored';
  const gateRotation = time * (anchored ? -0.00042 : 0.00016);
  ctx.shadowColor = anchored ? '#76ddff' : '#9f6cff';
  ctx.shadowBlur = r * 0.24;
  ctx.lineWidth = Math.max(1, r * 0.026);
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = anchored
      ? `rgba(110, 220, 255, ${0.26 + i * 0.055})`
      : `rgba(174, 104, 255, ${0.2 + i * 0.045})`;
    ctx.setLineDash([r * (0.16 + i * 0.02), r * (0.1 + i * 0.018)]);
    ctx.lineDashOffset = gateRotation * r * (i % 2 ? -1 : 1) * (2 + i);
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      r * (1.34 + i * 0.255),
      r * (1.24 + i * 0.235),
      gateRotation + i * 0.08,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const side of [-1, 1]) {
    const ex = x + side * r * 2.72;
    const echo = ctx.createRadialGradient(ex, y, 0, ex, y, r * 0.5);
    echo.addColorStop(0, anchored ? 'rgba(110,220,255,0.28)' : 'rgba(255,100,190,0.22)');
    echo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = echo;
    ctx.beginPath();
    ctx.arc(ex, y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (phase === 'anchored') {
    ctx.strokeStyle = 'rgba(110, 220, 255, 0.62)';
    ctx.shadowColor = '#76ddff';
    ctx.shadowBlur = r * 0.3;
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = Math.max(1, r * 0.028);
      ctx.setLineDash([r * 0.2, r * 0.12]);
      ctx.lineDashOffset = time * (i % 2 ? -0.0008 : 0.0008) * r;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.45 + i * 0.28), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (phase === 'charging' || phase === 'opening') {
    const energy = phase === 'opening' ? 1 : 0.25 + progress;
    ctx.strokeStyle = `rgba(145, 210, 255, ${0.3 + energy * 0.45})`;
    ctx.shadowColor = '#8fdcff';
    ctx.shadowBlur = r * 0.28;
    ctx.setLineDash([]);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6 + time * 0.0003 * energy;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 4.2, y + Math.sin(a) * r * 4.2);
      ctx.quadraticCurveTo(
        x + Math.cos(a + 0.35) * r * 2.2,
        y + Math.sin(a + 0.35) * r * 2.2,
        x + Math.cos(a + 0.7) * r * 1.08,
        y + Math.sin(a + 0.7) * r * 1.08,
      );
      ctx.stroke();
    }
  } else if (phase === 'collapse' || phase === 'arrival') {
    const shockProgress = phase === 'arrival' ? progress : Math.max(0, (progress - 0.8) / 0.2);
    ctx.strokeStyle = `rgba(210, 240, 255, ${0.85 * (1 - shockProgress)})`;
    ctx.shadowColor = '#8fdcff';
    ctx.shadowBlur = r * 0.5;
    ctx.lineWidth = Math.max(2, r * (0.08 + shockProgress * 0.08));
    ctx.beginPath();
    ctx.arc(x, y, r * (1 + shockProgress * 4.4), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
