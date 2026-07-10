// Grounded artificial-commerce visuals for Trade Nexus systems and export depots.
// Rendering only: callers provide world/screen positions and authoritative state.

import { hexToRgba } from './theme.js';

/** Stable world-space depot orbit used by rendering and convoy jump staging. */
export function exportDepotWorldPose(system, time = 0) {
  const key = String(system?.id ?? 'depot');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const baseAngle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const radius = Math.max(430, (system?.star?.radius ?? 180) + 285);
  const angle = baseAngle + time / 90000;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    heading: angle + Math.PI / 2,
    orbitRadius: radius,
  };
}

export function drawTradeNexus(ctx, x, y, r, time, { intel = true, compact = false } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (!intel) {
    ctx.fillStyle = 'rgba(70, 82, 104, 0.78)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const pulse = 0.72 + 0.28 * Math.sin(time / 520);
  const spin = time / 9000;
  const outer = r * (compact ? 0.88 : 1.12);
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, outer * 2.4);
  halo.addColorStop(0, `rgba(118, 221, 255, ${0.2 + pulse * 0.12})`);
  halo.addColorStop(0.42, 'rgba(158, 140, 255, 0.11)');
  halo.addColorStop(1, 'rgba(40, 65, 105, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, outer * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Counter-rotating drydock rings; their slight ellipticity reads as massive,
  // industrial hardware rather than a fantasy emblem.
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(spin * (i % 2 ? -0.72 : 1) + i * Math.PI / 3);
    ctx.strokeStyle = i === 1
      ? hexToRgba('#ffce7a', 0.54)
      : hexToRgba('#76ddff', 0.42);
    ctx.lineWidth = Math.max(1, r * (compact ? 0.045 : 0.07));
    ctx.beginPath();
    ctx.ellipse(0, 0, outer * (0.72 + i * 0.18), outer * (0.3 + i * 0.07), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Armored central spindle and four docking spars.
  const core = ctx.createLinearGradient(-r, -r, r, r);
  core.addColorStop(0, '#52647a');
  core.addColorStop(0.45, '#182232');
  core.addColorStop(1, '#080d17');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(r * 0.62, 0);
  ctx.lineTo(r * 0.18, r * 0.34);
  ctx.lineTo(-r * 0.52, r * 0.2);
  ctx.lineTo(-r * 0.66, 0);
  ctx.lineTo(-r * 0.52, -r * 0.2);
  ctx.lineTo(r * 0.18, -r * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(186, 216, 240, 0.55)';
  ctx.lineWidth = Math.max(0.8, r * 0.04);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(112, 194, 226, 0.5)';
  ctx.lineWidth = Math.max(1, r * 0.075);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + spin * 0.12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
    ctx.lineTo(Math.cos(a) * outer * 0.95, Math.sin(a) * outer * 0.95);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(255, 206, 122, ${0.65 + pulse * 0.25})`;
  ctx.shadowColor = '#ffce7a';
  ctx.shadowBlur = r * 0.35;
  ctx.beginPath();
  ctx.arc(r * 0.38, 0, Math.max(1.5, r * 0.07), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawExportDepot(ctx, x, y, r, time, { active = true } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time / 14000);
  ctx.fillStyle = '#172335';
  ctx.strokeStyle = active ? 'rgba(118, 221, 255, 0.72)' : 'rgba(126, 145, 186, 0.4)';
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const rr = i % 2 ? r * 0.72 : r;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.rotate(-time / 9000);
  ctx.strokeStyle = 'rgba(255, 206, 122, 0.58)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawSpaceCompressionJump(ctx, x, y, heading, size, progress, color = '#76ddff') {
  const p = Math.max(0, Math.min(1, progress));
  const squeeze = 1 - Math.sin(p * Math.PI) * 0.82;
  const flash = Math.sin(Math.min(1, p * 1.25) * Math.PI);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hexToRgba(color, 0.22 + flash * 0.62);
  ctx.shadowColor = color;
  ctx.shadowBlur = size * (1 + flash * 2.8);
  for (let i = 0; i < 5; i++) {
    const lane = (i - 2) * size * 0.24;
    ctx.beginPath();
    ctx.moveTo(-size * (2.2 + flash), lane * squeeze);
    ctx.lineTo(size * (1.4 + flash * 0.5), lane * squeeze);
    ctx.stroke();
  }
  ctx.fillStyle = hexToRgba('#ffffff', flash * 0.7);
  ctx.beginPath();
  ctx.ellipse(0, 0, size * (0.2 + flash * 1.6), size * 0.12 * squeeze, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
