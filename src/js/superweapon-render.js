// Novacula-style Superweapon cradle — Canvas 2D gimbal megastructure.

import { SUPERWEAPON_CRADLE_ORBIT_PAD } from './constants.js';
import { hexToRgba } from './theme.js';

/**
 * World-space cradle pose at the Stronghold star.
 */
export function cradleWorldPose(system, time = 0) {
  const starR = system?.star?.radius ?? 200;
  const orbitR = starR + SUPERWEAPON_CRADLE_ORBIT_PAD;
  const angle = -Math.PI * 0.35 + time * 0.00002;
  return {
    x: Math.cos(angle) * orbitR,
    y: Math.sin(angle) * orbitR,
    orbitR,
    angle,
    starR,
  };
}

function drawGreebledRing(ctx, radius, thickness, segments, time, spin, color) {
  ctx.save();
  ctx.rotate(spin);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / segments * 0.72;
    const jagged = 1 + ((i % 3) - 1) * 0.018;
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness * (0.7 + (i % 4) * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, radius * jagged, a0, a1);
    ctx.stroke();

    // Panel break / strut nub.
    if (i % 2 === 0) {
      const mx = Math.cos(a0) * radius;
      const my = Math.sin(a0) * radius;
      ctx.fillStyle = 'rgba(18, 22, 30, 0.95)';
      ctx.fillRect(mx - thickness * 0.8, my - thickness * 0.45, thickness * 1.6, thickness * 0.9);
      ctx.fillStyle = hexToRgba('#6a7488', 0.55);
      ctx.fillRect(mx - thickness * 0.35, my - thickness * 0.2, thickness * 0.7, thickness * 0.4);
    }
  }
  ctx.restore();
}

function drawContainmentCore(ctx, scale, time, charge = 0) {
  const pulse = 0.55 + 0.45 * Math.sin(time / 180);
  const coreR = scale * (0.55 + charge * 0.35);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 2.4);
  g.addColorStop(0, `rgba(255, 255, 255, ${0.85 + charge * 0.15})`);
  g.addColorStop(0.25, `rgba(120, 230, 255, ${0.55 + charge * 0.3})`);
  g.addColorStop(0.55, `rgba(40, 90, 140, ${0.25 + charge * 0.2})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, coreR * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Amber pinprick containment lattice.
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + time / 2400;
    const rr = coreR * (0.55 + (i % 5) * 0.08);
    const alpha = 0.35 + 0.45 * ((Math.sin(time / 90 + i) + 1) * 0.5) * pulse;
    ctx.fillStyle = `rgba(255, ${90 + (i % 3) * 40}, 40, ${alpha})`;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, Math.max(0.8, scale * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = `rgba(255,255,255,${0.7 + charge * 0.3})`;
  ctx.beginPath();
  ctx.arc(0, 0, coreR * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw the Novacula gimbal cradle in system view (screen space).
 * @param {object} opts
 * @param {'idle'|'charge'|'aim'|'fire'|'impact'|'aftermath'} [opts.phase]
 * @param {number} [opts.aimAngle] world/screen aim radians
 * @param {number} [opts.charge] 0..1
 */
export function drawSuperweaponCradle(ctx, x, y, scale, time = 0, opts = {}) {
  const phase = opts.phase ?? 'idle';
  const charge = opts.charge ?? (phase === 'idle' ? 0.08 : phase === 'charge' ? 0.45 : phase === 'aim' ? 0.7 : 1);
  const aimAngle = opts.aimAngle ?? 0;
  const firing = phase === 'fire' || phase === 'impact';

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(aimAngle * 0.15);

  const base = Math.max(18, 48 * scale);
  // Soft occlusion disc.
  const shade = ctx.createRadialGradient(0, 0, base * 0.2, 0, 0, base * 3.2);
  shade.addColorStop(0, 'rgba(4, 8, 14, 0.35)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, base * 3.2, 0, Math.PI * 2);
  ctx.fill();

  const spinA = time / 4200 + (firing ? time / 600 : 0);
  const spinB = -time / 3100 - (charge * 0.4);
  const spinC = time / 5200;

  drawGreebledRing(ctx, base * 2.35, Math.max(1.2, 2.2 * scale), 18, time, spinA, 'rgba(55, 62, 74, 0.95)');
  drawGreebledRing(ctx, base * 1.72, Math.max(1.1, 2.0 * scale), 14, time, spinB, 'rgba(38, 44, 56, 0.98)');
  drawGreebledRing(ctx, base * 1.12, Math.max(1.0, 1.8 * scale), 12, time, spinC, 'rgba(28, 32, 42, 0.98)');

  // Cross-axis gimbal rails.
  ctx.strokeStyle = 'rgba(90, 100, 118, 0.75)';
  ctx.lineWidth = Math.max(1.2, 1.8 * scale);
  ctx.beginPath();
  ctx.moveTo(-base * 2.5, 0);
  ctx.lineTo(base * 2.5, 0);
  ctx.moveTo(0, -base * 2.5);
  ctx.lineTo(0, base * 2.5);
  ctx.stroke();

  drawContainmentCore(ctx, base * 0.9, time, charge);

  if (firing || phase === 'aim') {
    // Anamorphic horizontal flare through the core.
    const flare = ctx.createLinearGradient(-base * 6, 0, base * 6, 0);
    flare.addColorStop(0, 'rgba(120, 230, 255, 0)');
    flare.addColorStop(0.45, `rgba(200, 250, 255, ${0.35 + charge * 0.4})`);
    flare.addColorStop(0.5, `rgba(255, 255, 255, ${0.7 + charge * 0.3})`);
    flare.addColorStop(0.55, `rgba(200, 250, 255, ${0.35 + charge * 0.4})`);
    flare.addColorStop(1, 'rgba(120, 230, 255, 0)');
    ctx.fillStyle = flare;
    ctx.fillRect(-base * 6, -Math.max(1, scale * 1.2), base * 12, Math.max(2, scale * 2.4));
  }

  ctx.restore();
}

/**
 * System-view Novacula beam leaving the cradle (screen space).
 */
export function drawNovaculaBeam(ctx, fromX, fromY, toX, toY, scale, time, intensity = 1) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Soft cyan sheath.
  const sheath = ctx.createLinearGradient(fromX, fromY, toX, toY);
  sheath.addColorStop(0, `rgba(80, 220, 255, ${0.75 * intensity})`);
  sheath.addColorStop(0.5, `rgba(140, 235, 255, ${0.55 * intensity})`);
  sheath.addColorStop(1, `rgba(255, 255, 255, ${0.25 * intensity})`);
  ctx.strokeStyle = sheath;
  ctx.lineWidth = Math.max(10, 22 * scale) * intensity;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Mid cyan layer.
  ctx.strokeStyle = `rgba(160, 240, 255, ${0.65 * intensity})`;
  ctx.lineWidth = Math.max(5, 10 * scale) * intensity;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // White-hot core.
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * intensity})`;
  ctx.lineWidth = Math.max(2.5, 5.5 * scale) * intensity;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Origin flare sphere.
  const flareR = Math.max(16, 42 * scale) * (0.7 + 0.3 * Math.sin(time / 40));
  const g = ctx.createRadialGradient(fromX, fromY, 0, fromX, fromY, flareR * 2);
  g.addColorStop(0, `rgba(255,255,255,${0.95 * intensity})`);
  g.addColorStop(0.3, `rgba(120,230,255,${0.55 * intensity})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(fromX, fromY, flareR * 2, 0, Math.PI * 2);
  ctx.fill();

  // Anamorphic streak across origin.
  const streak = ctx.createLinearGradient(fromX - flareR * 4, fromY, fromX + flareR * 4, fromY);
  streak.addColorStop(0, 'rgba(120,230,255,0)');
  streak.addColorStop(0.5, `rgba(255,255,255,${0.75 * intensity})`);
  streak.addColorStop(1, 'rgba(120,230,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(fromX - flareR * 4, fromY - Math.max(1, scale), flareR * 8, Math.max(2, scale * 2));

  // Secondary tip glow.
  const tipG = ctx.createRadialGradient(toX, toY, 0, toX, toY, flareR);
  tipG.addColorStop(0, `rgba(255,255,255,${0.7 * intensity})`);
  tipG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tipG;
  ctx.beginPath();
  ctx.arc(toX + ux * 4, toY + uy * 4, flareR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawGalaxyNovaculaBeam(ctx, from, to, zoom, time, opts = {}) {
  const type = opts.type ?? 'destroy';
  const intensity = opts.intensity ?? 1;
  const blocked = !!opts.blocked;
  const colors = type === 'create'
    ? { sheath: '80,255,170', core: '220,255,240' }
    : type === 'jump'
      ? { sheath: '170,130,255', core: '230,210,255' }
      : { sheath: '80,220,255', core: '255,255,255' };

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const mid = blocked
    ? { x: from.x + dx * 0.62, y: from.y + dy * 0.62 }
    : to;

  ctx.strokeStyle = `rgba(${colors.sheath}, ${0.45 * intensity})`;
  ctx.lineWidth = Math.max(3, 8 * zoom) * intensity;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.stroke();

  ctx.strokeStyle = `rgba(${colors.core}, ${0.85 * intensity})`;
  ctx.lineWidth = Math.max(1.2, 2.8 * zoom) * intensity;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.stroke();

  if (blocked) {
    ctx.strokeStyle = `rgba(100, 220, 255, ${0.7 * intensity})`;
    ctx.lineWidth = Math.max(2, 3 * zoom);
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, Math.max(12, 28 * zoom), 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + time / 200;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(mid.x + Math.cos(a) * 22 * zoom, mid.y + Math.sin(a) * 22 * zoom);
      ctx.stroke();
    }
  }

  ctx.restore();
}
