// Helioclast siege capital — reference wedge (Canvas 2D).
// Zoom contract: screen size = HELIOCLAST_RADIUS * cameraZoom (no min-pixel floor).

import { HELIOCLAST_RADIUS, SUPERWEAPON_CRADLE_ORBIT_PAD } from './constants.js';
import { hexToRgba } from './theme.js';

/**
 * World-space berth pose at the Stronghold star (pre-mobile construction).
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

/** Local nose offset of the circular aperture (in `base` units). */
export const HELIOCLAST_APERTURE_LOCAL_X = 1.55;

/**
 * Drydock berth wrapped around the Helioclast — follows ship pose/heading while assembling.
 * When `working`, gantries and weld sparks actively build on the hull.
 */
export function drawHelioclastShipyard(ctx, x, y, scale, opts = {}) {
  const prog = opts.buildProgress ?? 1;
  const working = !!opts.working || !!opts.building;
  const workProg = opts.workProgress ?? (opts.building ? prog : 0);
  const heading = opts.heading ?? 0;
  const alpha = opts.parked
    ? 0.28
    : (opts.building ? 0.22 + 0.78 * prog : working ? 0.85 : 0.7);
  const r = HELIOCLAST_RADIUS * 2.55 * Math.max(0.001, scale);
  const time = opts.time ?? 0;
  const pulse = 0.55 + 0.45 * Math.sin(time / 520);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.globalAlpha = alpha;

  // Outer berth ring (elongated with hull)
  ctx.strokeStyle = hexToRgba('#6ec8ff', working ? 0.45 + 0.3 * pulse : 0.3 + 0.2 * pulse);
  ctx.lineWidth = Math.max(0.5, 1.5 * scale);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.35, r * 1.05, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Parallel drydock rails along hull length
  for (const side of [-1, 1]) {
    ctx.strokeStyle = hexToRgba('#9aa7bc', working ? 0.7 : 0.5);
    ctx.lineWidth = Math.max(0.6, 1.7 * scale);
    ctx.beginPath();
    ctx.moveTo(-r * 1.45, side * r * 0.58);
    ctx.lineTo(r * 1.55, side * r * 0.58);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba('#6ec8ff', 0.28);
    ctx.lineWidth = Math.max(0.4, scale);
    for (let i = 0; i < 9; i++) {
      const t = -1.3 + i * 0.35;
      ctx.beginPath();
      ctx.moveTo(t * r, side * r * 0.45);
      ctx.lineTo(t * r, side * r * 0.72);
      ctx.stroke();
    }
  }

  // Scaffold gantries that reach onto the hull
  ctx.strokeStyle = hexToRgba('#c9d4e6', working ? 0.65 : 0.4);
  ctx.lineWidth = Math.max(0.5, 1.2 * scale);
  ctx.beginPath();
  ctx.moveTo(-r * 1.0, -r * 1.05);
  ctx.lineTo(-r * 1.0, r * 1.05);
  ctx.moveTo(r * 0.35, -r * 0.95);
  ctx.lineTo(r * 0.35, r * 0.95);
  ctx.stroke();

  // Articulated build arms clamping the hull while working
  if (working) {
    const armReach = 0.35 + 0.55 * Math.min(1, workProg || pulse);
    for (const side of [-1, 1]) {
      const tipX = (-0.2 + armReach * 0.9) * r;
      const tipY = side * r * (0.15 + 0.2 * Math.sin(time / 280 + side));
      ctx.strokeStyle = hexToRgba('#f0c060', 0.75 + 0.2 * pulse);
      ctx.lineWidth = Math.max(0.7, 1.6 * scale);
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, side * r * 0.9);
      ctx.lineTo(-r * 0.2, side * r * 0.55);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // Weld tip
      ctx.fillStyle = hexToRgba('#ffe8a0', 0.7 + 0.3 * pulse);
      ctx.beginPath();
      ctx.arc(tipX, tipY, Math.max(1.2, 2.4 * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // Sparks along the hull
    for (let i = 0; i < 10; i++) {
      const sx = (-1.1 + ((time / 90 + i * 0.37) % 2.4)) * r * 0.85;
      const sy = ((i % 2) * 2 - 1) * r * (0.2 + 0.15 * Math.sin(time / 100 + i));
      ctx.fillStyle = hexToRgba(i % 3 === 0 ? '#ffffff' : '#f0c060', 0.55 + 0.4 * Math.sin(time / 60 + i));
      ctx.fillRect(sx, sy, Math.max(0.8, 1.6 * scale), Math.max(0.8, 1.6 * scale));
    }

    // Work beams from gantries to hull
    ctx.strokeStyle = hexToRgba('#6ec8ff', 0.35 + 0.25 * pulse);
    ctx.lineWidth = Math.max(0.5, scale);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.35, side * r * 0.95);
      ctx.lineTo(r * 0.1, side * r * 0.25);
      ctx.stroke();
    }
  }

  if (opts.building) {
    ctx.setLineDash([4 * scale, 4 * scale]);
    ctx.strokeStyle = hexToRgba('#6ec8ff', 0.55 + 0.35 * pulse);
    ctx.lineWidth = Math.max(0.7, 1.5 * scale);
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.4 + 0.6 * prog), -Math.PI * 0.2, Math.PI * 1.4 * prog);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Mini construction drones orbiting the berth while working
  if (working && !opts.parked) {
    for (let i = 0; i < 3; i++) {
      const a = time / 700 + i * (Math.PI * 2 / 3);
      const dx = Math.cos(a) * r * 1.25;
      const dy = Math.sin(a) * r * 0.85;
      ctx.fillStyle = hexToRgba('#f0c060', 0.85);
      ctx.beginPath();
      ctx.arc(dx, dy, Math.max(1.5, 2.8 * scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexToRgba('#f0c060', 0.4);
      ctx.lineWidth = Math.max(0.4, scale * 0.8);
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx * 0.35, dy * 0.35);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draw the Helioclast wedge siege ship in system view (screen space).
 * Stages 1–6 gate silhouette layers to match construction progress.
 * @param {object} opts
 * @param {number} [opts.stage] 0–6
 * @param {number} [opts.partialAlpha] 0–1 alpha for the next incomplete layer
 * @param {number} [opts.heading] radians (nose direction)
 */
export function drawHelioclastShip(ctx, x, y, scale, time = 0, opts = {}) {
  const stage = Math.max(0, Math.min(6, Math.floor(opts.stage ?? 6)));
  const partial = Math.max(0, Math.min(1, opts.partialAlpha ?? 0));
  if (stage <= 0 && partial <= 0) return;

  const phase = opts.phase ?? 'idle';
  const charge = opts.charge ?? (phase === 'idle' ? 0.08 : phase === 'charge' ? 0.45 : phase === 'aim' ? 0.7 : 1);
  const aimAngle = opts.aimAngle ?? opts.heading ?? 0;
  const firing = phase === 'fire' || phase === 'impact';
  // No min-pixel floor — scales cleanly with camera zoom.
  const base = HELIOCLAST_RADIUS * Math.max(0.001, scale);
  const lod = scale >= 0.35;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(aimAngle);

  const shade = ctx.createRadialGradient(0, 0, base * 0.2, 0, 0, base * 3.2);
  shade.addColorStop(0, 'rgba(4, 8, 14, 0.35)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, base * 3.2, 0, Math.PI * 2);
  ctx.fill();

  const drawLayer = (minStage, fn) => {
    if (stage >= minStage) {
      fn(1);
    } else if (stage === minStage - 1 && partial > 0) {
      ctx.save();
      ctx.globalAlpha = 0.15 + 0.85 * partial;
      fn(partial);
      ctx.restore();
    }
  };

  // Stage 1 — lower flat triangular keel / hull plate
  drawLayer(1, () => drawHullPlate(ctx, base, lod));

  // Stage 2 — aft drive mass + plating (+ engine plumes)
  drawLayer(2, () => drawAftDriveBlock(ctx, base, time, charge, lod, {
    mobile: !!opts.mobile,
    plumeStrength: opts.plumeStrength ?? (opts.mobile ? 0.8 : stage >= 2 ? 0.4 : 0),
  }));

  // Stage 3 — central spine + aperture tunnel shell
  drawLayer(3, () => drawSpinalTrack(ctx, base, time, charge, firing, lod));

  // Stage 4 — aft T-wings
  drawLayer(4, () => drawAftWings(ctx, base, lod));

  // Stage 5 — command tower + twin domes + side trenches detail
  drawLayer(5, () => drawCommandTower(ctx, base, time, lod));

  // Stage 6 — lit aperture core + full greebles
  drawLayer(6, () => drawFocalAperture(ctx, base, time, charge, firing, phase, lod));

  if (stage < 6) drawScaffoldHints(ctx, base, stage, time, partial);

  ctx.restore();
}

/** @deprecated alias for callers */
export function drawSuperweaponCradle(ctx, x, y, scale, time = 0, opts = {}) {
  return drawHelioclastShip(ctx, x, y, scale, time, opts);
}

function drawHullPlate(ctx, base, lod) {
  // Wide flat triangle with blunt bow (not a sharp tip).
  const nose = base * HELIOCLAST_APERTURE_LOCAL_X;
  const aft = -base * 1.85;
  const halfW = base * 1.35;

  ctx.fillStyle = '#3a4454';
  ctx.strokeStyle = '#8b97a8';
  ctx.lineWidth = Math.max(0.4, base * 0.04);
  ctx.beginPath();
  ctx.moveTo(nose, -base * 0.22);
  ctx.lineTo(nose, base * 0.22);
  ctx.lineTo(base * 0.35, halfW);
  ctx.lineTo(aft, halfW * 0.92);
  ctx.lineTo(aft, -halfW * 0.92);
  ctx.lineTo(base * 0.35, -halfW);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Side trenches
  for (const side of [-1, 1]) {
    ctx.strokeStyle = 'rgba(12, 16, 24, 0.85)';
    ctx.lineWidth = Math.max(0.5, base * 0.07);
    ctx.beginPath();
    ctx.moveTo(base * 0.2, side * halfW * 0.72);
    ctx.lineTo(aft + base * 0.15, side * halfW * 0.78);
    ctx.stroke();
    if (lod) {
      ctx.strokeStyle = 'rgba(160, 175, 195, 0.35)';
      ctx.lineWidth = Math.max(0.3, base * 0.02);
      for (let i = 0; i < 8; i++) {
        const t = 0.15 - i * 0.22;
        ctx.beginPath();
        ctx.moveTo(base * t, side * halfW * 0.55);
        ctx.lineTo(base * t - base * 0.08, side * halfW * 0.88);
        ctx.stroke();
      }
    }
  }
}

function drawAftDriveBlock(ctx, base, time, charge, lod, opts = {}) {
  const aft = -base * 1.85;
  ctx.fillStyle = '#2a3342';
  ctx.fillRect(aft - base * 0.15, -base * 0.55, base * 0.55, base * 1.1);
  ctx.strokeStyle = '#7a8799';
  ctx.lineWidth = Math.max(0.4, base * 0.03);
  ctx.strokeRect(aft - base * 0.15, -base * 0.55, base * 0.55, base * 1.1);

  // Engine glow banks
  const glow = 0.35 + 0.45 * charge + 0.15 * Math.sin(time / 400);
  for (let i = 0; i < 5; i++) {
    const y = -base * 0.4 + i * base * 0.2;
    ctx.fillStyle = hexToRgba('#6ec8ff', glow * 0.55);
    ctx.beginPath();
    ctx.ellipse(aft - base * 0.18, y, base * 0.08, base * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (lod) {
    ctx.fillStyle = 'rgba(110, 200, 255, 0.12)';
    ctx.fillRect(aft - base * 0.55, -base * 0.5, base * 0.35, base);
  }

  // Engine plumes (aft exhaust)
  const plumeStrength = opts.plumeStrength ?? (opts.mobile ? 0.75 : 0.35);
  if (plumeStrength > 0.05) {
    drawEnginePlumes(ctx, base, time, plumeStrength);
  }
}

function drawEnginePlumes(ctx, base, time, strength = 0.7) {
  const aft = -base * 1.95;
  const flicker = 0.75 + 0.25 * Math.sin(time / 55);
  const len = base * (0.55 + 0.75 * strength) * flicker;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const y = -base * 0.38 + i * base * 0.19;
    const wobble = Math.sin(time / 70 + i * 1.3) * base * 0.04;
    const grad = ctx.createLinearGradient(aft, y, aft - len, y + wobble);
    grad.addColorStop(0, hexToRgba('#e8fbff', 0.85 * strength));
    grad.addColorStop(0.35, hexToRgba('#6ec8ff', 0.55 * strength));
    grad.addColorStop(0.7, hexToRgba('#3a8fff', 0.22 * strength));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(aft, y - base * 0.05);
    ctx.lineTo(aft - len * 0.35, y - base * 0.09 + wobble * 0.5);
    ctx.lineTo(aft - len, y + wobble);
    ctx.lineTo(aft - len * 0.35, y + base * 0.09 + wobble * 0.5);
    ctx.lineTo(aft, y + base * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  // Hot core streaks
  ctx.strokeStyle = hexToRgba('#ffffff', 0.45 * strength * flicker);
  ctx.lineWidth = Math.max(0.5, base * 0.025);
  for (let i = 0; i < 3; i++) {
    const y = -base * 0.22 + i * base * 0.22;
    ctx.beginPath();
    ctx.moveTo(aft, y);
    ctx.lineTo(aft - len * 0.55, y + Math.sin(time / 80 + i) * base * 0.03);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpinalTrack(ctx, base, time, charge, firing, lod) {
  const nose = base * HELIOCLAST_APERTURE_LOCAL_X;
  const aft = -base * 1.4;

  // Raised spine
  ctx.fillStyle = '#4a5566';
  ctx.fillRect(aft, -base * 0.16, nose - aft, base * 0.32);
  ctx.strokeStyle = '#a8b4c4';
  ctx.lineWidth = Math.max(0.4, base * 0.025);
  ctx.strokeRect(aft, -base * 0.16, nose - aft, base * 0.32);

  if (lod) {
    ctx.strokeStyle = 'rgba(30, 40, 55, 0.7)';
    ctx.lineWidth = Math.max(0.3, base * 0.02);
    for (let i = 0; i < 10; i++) {
      const x = aft + (nose - aft) * (i / 10);
      ctx.beginPath();
      ctx.moveTo(x, -base * 0.14);
      ctx.lineTo(x, base * 0.14);
      ctx.stroke();
    }
    // Cylindrical conduits
    ctx.fillStyle = '#5a6575';
    for (const y of [-base * 0.22, base * 0.22]) {
      ctx.fillRect(aft + base * 0.2, y - base * 0.05, nose - aft - base * 0.5, base * 0.1);
    }
  }

  // Deep circular muzzle shell (dark tunnel)
  const ax = nose - base * 0.05;
  ctx.fillStyle = '#121820';
  ctx.beginPath();
  ctx.arc(ax, 0, base * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9aabbc';
  ctx.lineWidth = Math.max(0.5, base * 0.045);
  ctx.beginPath();
  ctx.arc(ax, 0, base * 0.38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20, 28, 38, 0.9)';
  ctx.lineWidth = Math.max(0.4, base * 0.03);
  ctx.beginPath();
  ctx.arc(ax, 0, base * 0.26, 0, Math.PI * 2);
  ctx.stroke();

  if (firing || charge > 0.3) {
    const g = ctx.createRadialGradient(ax, 0, 0, ax, 0, base * 0.24);
    g.addColorStop(0, hexToRgba('#b8f0ff', 0.55 * charge));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ax, 0, base * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAftWings(ctx, base, lod) {
  const rootX = -base * 0.35;
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#343e4e';
    ctx.strokeStyle = '#8a96a6';
    ctx.lineWidth = Math.max(0.4, base * 0.03);
    ctx.beginPath();
    ctx.moveTo(rootX, side * base * 0.2);
    ctx.lineTo(-base * 1.55, side * base * 1.55);
    ctx.lineTo(-base * 1.85, side * base * 1.35);
    ctx.lineTo(-base * 1.2, side * base * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (lod) {
      ctx.strokeStyle = 'rgba(15, 20, 28, 0.6)';
      ctx.beginPath();
      ctx.moveTo(rootX - base * 0.2, side * base * 0.45);
      ctx.lineTo(-base * 1.5, side * base * 1.25);
      ctx.stroke();
    }
  }
}

function drawCommandTower(ctx, base, time, lod) {
  const tx = -base * 1.05;
  const tw = base * 0.55;
  const th = base * 0.42;
  ctx.fillStyle = '#4e5a6c';
  ctx.fillRect(tx - tw * 0.5, -th, tw, th * 1.35);
  ctx.strokeStyle = '#b0bcc8';
  ctx.lineWidth = Math.max(0.4, base * 0.03);
  ctx.strokeRect(tx - tw * 0.5, -th, tw, th * 1.35);

  // Panoramic viewport
  ctx.fillStyle = hexToRgba('#6ec8ff', 0.45 + 0.2 * Math.sin(time / 500));
  ctx.fillRect(tx - tw * 0.35, -th * 0.55, tw * 0.7, th * 0.22);

  // Twin sensor domes
  for (const side of [-1, 1]) {
    const dx = tx + side * tw * 0.55;
    const dy = -th * 0.15;
    ctx.fillStyle = '#6a7585';
    ctx.beginPath();
    ctx.arc(dx, dy, base * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c5d0dc';
    ctx.lineWidth = Math.max(0.3, base * 0.025);
    ctx.stroke();
    ctx.fillStyle = hexToRgba('#a8d8ff', 0.35);
    ctx.beginPath();
    ctx.arc(dx - base * 0.03, dy - base * 0.03, base * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  if (lod) {
    // Extra trench greebles near tower
    ctx.strokeStyle = 'rgba(20, 26, 34, 0.75)';
    ctx.lineWidth = Math.max(0.3, base * 0.02);
    for (let i = 0; i < 6; i++) {
      const y = -base * 0.9 + i * base * 0.3;
      ctx.beginPath();
      ctx.moveTo(-base * 0.5, y);
      ctx.lineTo(base * 0.1, y * 0.85);
      ctx.stroke();
    }
  }
}

function drawFocalAperture(ctx, base, time, charge, firing, phase, lod) {
  const ax = base * HELIOCLAST_APERTURE_LOCAL_X - base * 0.05;
  const pulse = firing ? 1 : (0.4 + 0.6 * charge);
  const core = ctx.createRadialGradient(ax, 0, 0, ax, 0, base * 0.22);
  core.addColorStop(0, hexToRgba('#e8fbff', 0.85 * pulse));
  core.addColorStop(0.45, hexToRgba('#6ec8ff', 0.55 * pulse));
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(ax, 0, base * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hexToRgba('#d0f4ff', 0.7 * pulse);
  ctx.lineWidth = Math.max(0.5, base * 0.04);
  ctx.beginPath();
  ctx.arc(ax, 0, base * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  if (lod) {
    // Tiny dorsal turrets
    ctx.fillStyle = '#5a6574';
    for (let i = 0; i < 4; i++) {
      const x = -base * 0.8 + i * base * 0.45;
      ctx.fillRect(x, -base * 0.55, base * 0.08, base * 0.1);
    }
  }

  if (phase === 'aim' || firing) {
    ctx.strokeStyle = hexToRgba('#ffffff', 0.25 + 0.35 * pulse);
    ctx.lineWidth = Math.max(0.4, base * 0.02);
    ctx.beginPath();
    ctx.moveTo(ax + base * 0.2, 0);
    ctx.lineTo(ax + base * 1.2, 0);
    ctx.stroke();
  }
}

function drawScaffoldHints(ctx, base, stage, time, partial) {
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = hexToRgba('#6ec8ff', 0.25 + 0.2 * Math.sin(time / 350) + 0.2 * partial);
  ctx.lineWidth = Math.max(0.4, base * 0.02);
  const r = base * (1.1 + stage * 0.12);
  ctx.beginPath();
  ctx.rect(-r * 1.2, -r * 0.9, r * 2.6, r * 1.8);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Beam origin in world space from ship pose (aperture center).
 */
export function helioclastApertureWorld(shipX, shipY, heading) {
  const localX = HELIOCLAST_RADIUS * HELIOCLAST_APERTURE_LOCAL_X;
  return {
    x: shipX + Math.cos(heading) * localX,
    y: shipY + Math.sin(heading) * localX,
  };
}

/** Palette helper for fire types. */
function swPalette(type) {
  if (type === 'create') {
    return {
      primary: '#66ffaa', secondary: '#a8ffd4', hot: '#ffffff',
      rgb: { a: '80,255,170', b: '180,255,220', c: '255,255,255' },
    };
  }
  if (type === 'jump') {
    return {
      primary: '#aa88ff', secondary: '#d4c0ff', hot: '#ffffff',
      rgb: { a: '170,130,255', b: '220,200,255', c: '255,255,255' },
    };
  }
  // destroy default
  return {
    primary: '#ff4466', secondary: '#ff99aa', hot: '#ffffff',
    rgb: { a: '255,70,100', b: '255,160,180', c: '255,255,255' },
  };
}

/** Full-frame cinema chrome: vignette, letterbox glow, mode caption. */
export function drawHelioclastCinemaOverlay(ctx, canvas, time, opts = {}) {
  const type = opts.type ?? 'destroy';
  const phase = opts.phase ?? 'charge';
  const progress = opts.progress ?? 0;
  const total = opts.totalProgress ?? progress;
  const pal = swPalette(type);
  const w = canvas.width;
  const h = canvas.height;
  const letter = Math.max(22, h * 0.07);

  ctx.save();
  // Soft vignette
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.15, w * 0.5, h * 0.5, h * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, `rgba(0,0,0,${0.35 + 0.25 * total})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // Letterbox with colored inner edge
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, w, letter);
  ctx.fillRect(0, h - letter, w, letter);
  ctx.strokeStyle = hexToRgba(pal.primary, 0.35 + 0.4 * progress);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, letter);
  ctx.lineTo(w, letter);
  ctx.moveTo(0, h - letter);
  ctx.lineTo(w, h - letter);
  ctx.stroke();

  // Phase caption
  const labels = {
    charge: 'CHARGING',
    aim: 'LOCK',
    fire: 'FIRING',
    impact: 'IMPACT',
    aftermath: 'AFTERMATH',
  };
  const typeLabel = type === 'create' ? 'GENESIS' : type === 'jump' ? 'GATE JUMP' : 'ANNIHILATION';
  ctx.fillStyle = hexToRgba(pal.secondary, 0.9);
  ctx.font = `600 ${Math.max(11, letter * 0.32)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`HELIOCLAST · ${typeLabel}`, 18, letter * 0.55);
  ctx.textAlign = 'right';
  ctx.fillText(labels[phase] ?? phase.toUpperCase(), w - 18, letter * 0.55);

  // Progress bar in bottom letterbox
  const barW = w * 0.35;
  const barX = (w - barW) * 0.5;
  const barY = h - letter * 0.55;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(barX, barY, barW, 3);
  ctx.fillStyle = hexToRgba(pal.primary, 0.85);
  ctx.fillRect(barX, barY, barW * Math.min(1, total), 3);

  // Scanline shimmer during fire
  if (phase === 'fire' || phase === 'impact') {
    ctx.globalAlpha = 0.06 + 0.04 * Math.sin(time / 40);
    for (let y = letter; y < h - letter; y += 4) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, y, w, 1);
    }
  }
  ctx.restore();
}

/** Charge bloom / power surge around aperture (screen space). */
export function drawHelioclastChargeAura(ctx, x, y, scale, time, progress = 0, type = 'destroy') {
  const pal = swPalette(type);
  const r = Math.max(28, 64 * scale) * (0.45 + 0.9 * progress);
  const pulse = 0.55 + 0.45 * Math.sin(time / 70);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Outer bloom
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
  g.addColorStop(0, hexToRgba(pal.hot, 0.7 * progress * pulse));
  g.addColorStop(0.25, hexToRgba(pal.primary, 0.55 * progress));
  g.addColorStop(0.6, hexToRgba(pal.secondary, 0.2 * progress));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
  ctx.fill();

  // Expanding shock rings
  for (let i = 0; i < 3; i++) {
    const ring = r * (0.55 + ((progress + i * 0.22 + (time / 900) % 1) % 1) * 1.4);
    ctx.strokeStyle = hexToRgba(pal.secondary, 0.45 * (1 - (ring / (r * 2))) * progress);
    ctx.lineWidth = Math.max(1, 2.2 * scale);
    ctx.beginPath();
    ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Orbiting energy motes
  for (let i = 0; i < 14; i++) {
    const a = time / 280 + i * (Math.PI * 2 / 14);
    const orbit = r * (0.7 + 0.35 * Math.sin(time / 200 + i));
    const mx = x + Math.cos(a) * orbit;
    const my = y + Math.sin(a) * orbit * 0.72;
    ctx.fillStyle = hexToRgba(i % 2 ? pal.hot : pal.primary, 0.55 + 0.4 * progress);
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(1.2, 2.8 * scale * (0.6 + 0.4 * progress)), 0, Math.PI * 2);
    ctx.fill();
  }

  // Spiral arcs into aperture
  ctx.strokeStyle = hexToRgba(pal.primary, 0.35 + 0.4 * progress);
  ctx.lineWidth = Math.max(0.8, 1.8 * scale);
  for (let s = 0; s < 3; s++) {
    ctx.beginPath();
    for (let t = 0; t < 28; t++) {
      const u = t / 27;
      const ang = time / 400 + s * 2.1 + u * Math.PI * 2.4;
      const rad = r * (1.35 - u * 1.1);
      const px = x + Math.cos(ang) * rad;
      const py = y + Math.sin(ang) * rad * 0.7;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Aim lock reticle along fire bearing. */
export function drawHelioclastAimLock(ctx, fromX, fromY, angle, scale, progress = 1, type = 'destroy', time = 0) {
  const pal = swPalette(type);
  const len = Math.max(220, 520 * scale);
  const tipX = fromX + Math.cos(angle) * len;
  const tipY = fromY + Math.sin(angle) * len;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Ghost corridor
  ctx.strokeStyle = hexToRgba(pal.primary, 0.2 + 0.25 * progress);
  ctx.lineWidth = Math.max(8, 18 * scale);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Dashed lock line
  ctx.globalAlpha = 0.45 + 0.5 * progress;
  ctx.strokeStyle = hexToRgba(pal.secondary, 0.95);
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.setLineDash([8 * scale, 10 * scale]);
  ctx.lineDashOffset = -(time / 30);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Range ticks
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    const px = fromX + (tipX - fromX) * t;
    const py = fromY + (tipY - fromY) * t;
    const tick = Math.max(4, 10 * scale) * (0.6 + 0.4 * progress);
    ctx.strokeStyle = hexToRgba(pal.hot, 0.35 + 0.4 * progress);
    ctx.beginPath();
    ctx.moveTo(px + nx * tick, py + ny * tick);
    ctx.lineTo(px - nx * tick, py - ny * tick);
    ctx.stroke();
  }

  // Diamond reticle at tip
  const r = Math.max(12, 26 * scale) * (0.55 + 0.45 * progress);
  const pulse = 0.85 + 0.15 * Math.sin(progress * Math.PI * 4 + time / 80);
  ctx.strokeStyle = hexToRgba(pal.primary, 0.9 * pulse);
  ctx.lineWidth = Math.max(1.2, 2.4 * scale);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY - r);
  ctx.lineTo(tipX + r, tipY);
  ctx.lineTo(tipX, tipY + r);
  ctx.lineTo(tipX - r, tipY);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tipX, tipY, r * 0.35, 0, Math.PI * 2);
  ctx.stroke();

  // Corner brackets
  const b = r * 1.6;
  ctx.strokeStyle = hexToRgba(pal.secondary, 0.7);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = tipX + sx * b;
    const cy = tipY + sy * b;
    ctx.beginPath();
    ctx.moveTo(cx, cy - sy * b * 0.35);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - sx * b * 0.35, cy);
    ctx.stroke();
  }
  ctx.restore();
}

/** Impact aftermath by fire type (screen space). */
export function drawHelioclastImpactFx(ctx, x, y, scale, time, progress, type = 'destroy') {
  const pal = swPalette(type);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (type === 'create') {
    const r = Math.max(30, 90 * scale) * (0.35 + progress);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    g.addColorStop(0, hexToRgba(pal.hot, 0.95));
    g.addColorStop(0.2, hexToRgba(pal.primary, 0.7));
    g.addColorStop(0.55, hexToRgba(pal.secondary, 0.35));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const rr = r * (0.5 + i * 0.35 + progress * 0.4);
      ctx.strokeStyle = hexToRgba(pal.secondary, 0.7 - i * 0.12);
      ctx.lineWidth = Math.max(1.2, (3.5 - i * 0.5) * scale);
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Accretion sparks
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + time / 250;
      const rad = r * (0.4 + 0.9 * progress) * (0.7 + 0.3 * Math.sin(time / 80 + i));
      ctx.fillStyle = hexToRgba(pal.hot, 0.7);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, Math.max(1, 2.2 * scale), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'jump') {
    const open = 0.15 + 0.85 * Math.min(1, progress * 1.3);
    const r = Math.max(22, 68 * scale) * open;
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = hexToRgba(i % 2 ? pal.hot : pal.primary, 0.75 - i * 0.1);
      ctx.lineWidth = Math.max(1.5, (4 - i * 0.5) * scale);
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1.2 + i * 0.12), r * (0.45 + i * 0.05), time / 350 + i * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + time / 140;
      ctx.strokeStyle = hexToRgba(pal.secondary, 0.5);
      ctx.lineWidth = Math.max(0.8, 1.5 * scale);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.1);
      ctx.lineTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 0.65);
      ctx.stroke();
    }
  } else {
    // Destroy collapse
    const r = Math.max(26, 80 * scale) * (1.15 - progress * 0.5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    g.addColorStop(0, hexToRgba(pal.hot, 0.95));
    g.addColorStop(0.2, hexToRgba(pal.primary, 0.7));
    g.addColorStop(0.55, hexToRgba('#ff2200', 0.3));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(pal.secondary, 0.8);
    ctx.lineWidth = Math.max(1.2, 2.5 * scale);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + time / 280;
      const len = r * (0.5 + 1.2 * progress) * (0.7 + 0.3 * ((i * 17) % 5) / 5);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
      // Debris flecks
      ctx.fillStyle = hexToRgba(pal.hot, 0.65);
      ctx.fillRect(
        x + Math.cos(a) * len * 0.85,
        y + Math.sin(a) * len * 0.85,
        Math.max(1, 2 * scale),
        Math.max(1, 2 * scale),
      );
    }
    // Crush rings
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = hexToRgba(pal.primary, 0.55 - i * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, r * (0.4 + i * 0.25) * (1.1 - progress * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Jump gate iris at origin or destination. */
export function drawHelioclastJumpIris(ctx, x, y, scale, time, progress, arriving = false) {
  const pal = swPalette('jump');
  const open = arriving ? progress : Math.min(1, progress * 1.25);
  const r = Math.max(20, 56 * scale) * (arriving ? (0.25 + 0.85 * open) : (1.2 - open * 0.65));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Rotating segmented rings
  for (let ring = 0; ring < 4; ring++) {
    const rr = r * (0.55 + ring * 0.22);
    const segs = 8 + ring * 2;
    const rot = time / (220 - ring * 30) * (ring % 2 ? -1 : 1);
    ctx.strokeStyle = hexToRgba(ring % 2 ? pal.hot : pal.primary, 0.55 + 0.3 * open);
    ctx.lineWidth = Math.max(1.2, (3.2 - ring * 0.4) * scale);
    for (let s = 0; s < segs; s++) {
      const a0 = rot + (s / segs) * Math.PI * 2;
      const a1 = a0 + Math.PI * 2 / segs * 0.55;
      ctx.beginPath();
      ctx.ellipse(x, y, rr * 1.35, rr * 0.7, Math.PI / 5, a0, a1);
      ctx.stroke();
    }
  }

  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.2);
  g.addColorStop(0, hexToRgba(pal.hot, arriving ? 0.7 * open : 0.5 * (1 - open * 0.4)));
  g.addColorStop(0.45, hexToRgba(pal.primary, 0.4));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Warp streaks
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + time / 160;
    ctx.strokeStyle = hexToRgba(pal.secondary, 0.45);
    ctx.lineWidth = Math.max(0.7, 1.4 * scale);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.08);
    ctx.lineTo(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * System-view Novacula beam leaving the cradle (screen space).
 */
export function drawNovaculaBeam(ctx, fromX, fromY, toX, toY, scale, time, intensity = 1, opts = {}) {
  const type = opts.type ?? 'destroy';
  const pal = swPalette(type);
  const { a, b, c } = pal.rgb;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Wide soft corona
  ctx.strokeStyle = `rgba(${a}, ${0.22 * intensity})`;
  ctx.lineWidth = Math.max(22, 48 * scale) * intensity;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  const sheath = ctx.createLinearGradient(fromX, fromY, toX, toY);
  sheath.addColorStop(0, `rgba(${a}, ${0.9 * intensity})`);
  sheath.addColorStop(0.45, `rgba(${b}, ${0.65 * intensity})`);
  sheath.addColorStop(1, `rgba(${c}, ${0.3 * intensity})`);
  ctx.strokeStyle = sheath;
  ctx.lineWidth = Math.max(14, 32 * scale) * intensity;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.strokeStyle = `rgba(${b}, ${0.75 * intensity})`;
  ctx.lineWidth = Math.max(7, 14 * scale) * intensity;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Helical ribbon overlays
  ctx.lineWidth = Math.max(1.5, 3 * scale) * intensity;
  for (let h = 0; h < 2; h++) {
    ctx.strokeStyle = `rgba(${c}, ${0.45 * intensity})`;
    ctx.beginPath();
    const steps = 36;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = fromX + dx * t;
      const py = fromY + dy * t;
      const wave = Math.sin(t * Math.PI * 6 + time / 50 + h * Math.PI) * Math.max(4, 12 * scale) * intensity;
      const qx = px + nx * wave;
      const qy = py + ny * wave;
      if (i === 0) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
    }
    ctx.stroke();
  }

  const flicker = 0.8 + 0.2 * Math.sin(time / 28);
  ctx.strokeStyle = `rgba(255,255,255,${0.7 * intensity * flicker})`;
  ctx.lineWidth = Math.max(2, 4.5 * scale) * intensity;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Particles racing along beam
  for (let i = 0; i < 16; i++) {
    const t = ((time / 180 + i * 0.07) % 1);
    const px = fromX + dx * t;
    const py = fromY + dy * t;
    const wob = Math.sin(time / 60 + i) * Math.max(2, 6 * scale);
    ctx.fillStyle = `rgba(${c}, ${0.55 * intensity})`;
    ctx.beginPath();
    ctx.arc(px + nx * wob, py + ny * wob, Math.max(1.2, 2.6 * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  const flareR = Math.max(20, 52 * scale) * (0.75 + 0.35 * Math.sin(time / 35));
  const g = ctx.createRadialGradient(fromX, fromY, 0, fromX, fromY, flareR * 2.4);
  g.addColorStop(0, `rgba(255,255,255,${0.98 * intensity})`);
  g.addColorStop(0.25, `rgba(${a},${0.65 * intensity})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(fromX, fromY, flareR * 2.4, 0, Math.PI * 2);
  ctx.fill();

  const tipG = ctx.createRadialGradient(toX, toY, 0, toX, toY, flareR * 1.4);
  tipG.addColorStop(0, `rgba(255,255,255,${0.85 * intensity})`);
  tipG.addColorStop(0.4, `rgba(${a},${0.45 * intensity})`);
  tipG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tipG;
  ctx.beginPath();
  ctx.arc(toX + ux * 6, toY + uy * 6, flareR * 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawGalaxyNovaculaBeam(ctx, from, to, zoom, time, opts = {}) {
  const type = opts.type ?? 'destroy';
  const intensity = opts.intensity ?? 1;
  const blocked = !!opts.blocked;
  const pal = swPalette(type);
  const { a, b, c } = pal.rgb;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const mid = blocked
    ? { x: from.x + dx * 0.62, y: from.y + dy * 0.62 }
    : to;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  // Soft corridor bloom
  ctx.strokeStyle = `rgba(${a}, ${0.2 * intensity})`;
  ctx.lineWidth = Math.max(10, 22 * zoom) * intensity;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.stroke();

  ctx.strokeStyle = `rgba(${a}, ${0.55 * intensity})`;
  ctx.lineWidth = Math.max(5, 12 * zoom) * intensity;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.stroke();

  ctx.strokeStyle = `rgba(${c}, ${0.95 * intensity})`;
  ctx.lineWidth = Math.max(1.6, 3.5 * zoom) * intensity;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.stroke();

  // Traveling sparks
  for (let i = 0; i < 10; i++) {
    const t = ((time / 220 + i * 0.1) % 1);
    const px = from.x + (mid.x - from.x) * t;
    const py = from.y + (mid.y - from.y) * t;
    const wob = Math.sin(time / 70 + i) * Math.max(2, 5 * zoom);
    ctx.fillStyle = `rgba(${b}, ${0.7 * intensity})`;
    ctx.beginPath();
    ctx.arc(px + nx * wob, py + ny * wob, Math.max(1.5, 3 * zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  // Endpoint coronas
  for (const p of [from, mid]) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(14, 32 * zoom));
    g.addColorStop(0, `rgba(255,255,255,${0.7 * intensity})`);
    g.addColorStop(0.4, `rgba(${a},${0.4 * intensity})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(14, 32 * zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  if (blocked) {
    ctx.strokeStyle = `rgba(100, 220, 255, ${0.85 * intensity})`;
    ctx.lineWidth = Math.max(2.5, 4 * zoom);
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, Math.max(16, 34 * zoom), 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + time / 180;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(mid.x + Math.cos(ang) * 28 * zoom, mid.y + Math.sin(ang) * 28 * zoom);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Galaxy-map charge / aftermath rings with motes. */
export function drawGalaxyHelioclastPulse(ctx, x, y, zoom, time, progress, type = 'destroy') {
  const pal = swPalette(type);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = Math.max(16, 36 * zoom) * (0.6 + progress);
  for (let i = 0; i < 3; i++) {
    const rr = r * (1 + i * 0.45 + ((time / 600 + i * 0.2) % 1) * 0.3);
    ctx.strokeStyle = hexToRgba(pal.primary, 0.55 - i * 0.12);
    ctx.lineWidth = Math.max(1.5, 3 * zoom);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = time / 300 + i * (Math.PI * 2 / 8);
    ctx.fillStyle = hexToRgba(pal.secondary, 0.7);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1, Math.max(1.5, 2.8 * zoom), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
