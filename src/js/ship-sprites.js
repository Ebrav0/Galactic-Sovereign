// Custom procedural ship models — Canvas 2D vector hulls.
// Every ship is drawn nose-facing +x at the origin; callers translate/rotate.
//
//   flagship  — Foundation x USS Enterprise x Star Destroyer hybrid
//   shuttle   — Foundation whisper ship with animated sweep wings
//   others    — distinct silhouettes per combat role

import { THEME, hexToRgba } from './theme.js';

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
  fighter: { scale: 0.55 },
  interceptor: { scale: 0.5 },
  heavy_fighter: { scale: 0.62 },
  bomber: { scale: 0.65 },
  healer: { scale: 0.95 },
  sensor_ship: { scale: 0.9 },
  builder_ship: { scale: 1.05 },
  command_cruiser: { scale: 1.3 },
  miner: { scale: 0.95 },
  flagship: { scale: 1.5 },
};

function hullColors(hull, side) {
  const enemy = side === 'enemy';
  if (hull === 'healer') {
    return {
      deck: enemy ? '#6a3a3a' : '#3a6a52',
      hull: enemy ? '#4a2828' : '#24443a',
      dark: enemy ? '#2a1616' : '#122420',
      stroke: enemy ? '#ff8888' : '#7affb8',
      glow: enemy ? '#ff5555' : '#7aff9e',
      engine: enemy ? '#ff7755' : '#7ad0ff',
    };
  }
  return {
    deck: enemy ? '#5c3434' : '#3c4c66',
    hull: enemy ? '#402424' : '#28344a',
    dark: enemy ? '#241212' : '#141c2e',
    stroke: enemy ? '#ff6666' : '#9fc7ff',
    glow: enemy ? '#ff4444' : THEME.accentCyan,
    engine: enemy ? '#ff6a3a' : '#7ad0ff',
  };
}

function drawHpBar(ctx, x, y, r, hp, maxHp) {
  if (maxHp <= 0 || hp >= maxHp) return;
  const barW = r * 2.8;
  const pct = hp / maxHp;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - barW / 2, y - r - 10, barW, 4);
  ctx.fillStyle = pct > 0.35 ? THEME.accentGreen : THEME.danger;
  ctx.fillRect(x - barW / 2, y - r - 10, barW * pct, 4);
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
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 3;
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============================= FLAGSHIP =============================
// Star Destroyer dagger hull + Enterprise saucer & nacelles + Foundation
// minimalist dark plating with luminous seams.

export function drawFlagshipModel(ctx, r, opts = {}) {
  const {
    thrusting = false,
    time = performance.now(),
    side = 'player',
  } = opts;
  const c = hullColors('flagship', side);
  const flicker = 0.8 + 0.2 * Math.sin(time / 42);

  // --- Engine flames (drawn first, behind hull) ---
  if (thrusting) {
    engineFlame(ctx, -r * 1.62, 0, r * 2.6, r * 0.5, c.engine, flicker);
    engineFlame(ctx, -r * 1.52, r * 0.5, r * 1.7, r * 0.32, c.engine, flicker * 0.9);
    engineFlame(ctx, -r * 1.52, -r * 0.5, r * 1.7, r * 0.32, c.engine, flicker * 1.05);
  }
  // Nacelle exhaust — always lit, brighter under thrust.
  const nacGlow = thrusting ? 0.85 : 0.4;
  engineFlame(ctx, -r * 2.05, r * 1.02, r * (thrusting ? 1.5 : 0.7), r * 0.22, c.engine, flicker * nacGlow + 0.2);
  engineFlame(ctx, -r * 2.05, -r * 1.02, r * (thrusting ? 1.5 : 0.7), r * 0.22, c.engine, flicker * nacGlow + 0.2);

  // --- Nacelle pylons ---
  ctx.strokeStyle = c.hull;
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, r * 0.5);
  ctx.lineTo(-r * 1.15, r * 0.98);
  ctx.moveTo(-r * 0.7, -r * 0.5);
  ctx.lineTo(-r * 1.15, -r * 0.98);
  ctx.stroke();

  // --- Twin nacelles (Enterprise) ---
  for (const s of [1, -1]) {
    const ny = s * r * 1.02;
    const g = ctx.createLinearGradient(-r * 2.05, ny, -r * 0.55, ny);
    g.addColorStop(0, c.dark);
    g.addColorStop(1, c.hull);
    ctx.fillStyle = g;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-r * 2.05, ny - r * 0.15, r * 1.5, r * 0.3, r * 0.15);
    else ctx.rect(-r * 2.05, ny - r * 0.15, r * 1.5, r * 0.3);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c.stroke, 0.5);
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.stroke();
    // Bussard collector — warm glow at nacelle nose.
    glowDot(ctx, -r * 0.62, ny, r * 0.13, '#ffb46b', 0.9);
    // Luminous field strip along the nacelle.
    ctx.strokeStyle = hexToRgba(c.glow, 0.55 + 0.2 * Math.sin(time / 300 + s));
    ctx.lineWidth = Math.max(0.6, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 1.9, ny);
    ctx.lineTo(-r * 0.75, ny);
    ctx.stroke();
  }

  // --- Main dagger hull (Star Destroyer wedge) ---
  ctx.beginPath();
  ctx.moveTo(r * 2.3, 0);
  ctx.lineTo(r * 0.1, r * 0.62);
  ctx.lineTo(-r * 1.55, r * 0.78);
  ctx.lineTo(-r * 1.7, r * 0.3);
  ctx.lineTo(-r * 1.7, -r * 0.3);
  ctx.lineTo(-r * 1.55, -r * 0.78);
  ctx.lineTo(r * 0.1, -r * 0.62);
  ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, r, c);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(c.stroke, 0.8);
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.stroke();

  // --- Raised superstructure wedge ---
  ctx.beginPath();
  ctx.moveTo(r * 1.35, 0);
  ctx.lineTo(-r * 0.2, r * 0.38);
  ctx.lineTo(-r * 1.35, r * 0.44);
  ctx.lineTo(-r * 1.35, -r * 0.44);
  ctx.lineTo(-r * 0.2, -r * 0.38);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(c.deck, 0.85);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(c.stroke, 0.35);
  ctx.lineWidth = Math.max(0.5, r * 0.04);
  ctx.stroke();

  // --- Luminous hull seams (Foundation) ---
  ctx.strokeStyle = hexToRgba(c.glow, 0.5);
  ctx.lineWidth = Math.max(0.5, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(r * 2.1, 0);
  ctx.lineTo(r * 1.05, 0);
  ctx.moveTo(r * 0.4, r * 0.44);
  ctx.lineTo(-r * 1.45, r * 0.6);
  ctx.moveTo(r * 0.4, -r * 0.44);
  ctx.lineTo(-r * 1.45, -r * 0.6);
  ctx.stroke();

  // --- Saucer section (Enterprise command disc) ---
  const sx = r * 0.95;
  const saucerR = r * 0.58;
  const sg = ctx.createRadialGradient(sx - saucerR * 0.3, -saucerR * 0.3, saucerR * 0.15, sx, 0, saucerR);
  sg.addColorStop(0, c.deck);
  sg.addColorStop(0.75, c.hull);
  sg.addColorStop(1, c.dark);
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sx, 0, saucerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(c.stroke, 0.75);
  ctx.lineWidth = Math.max(0.7, r * 0.055);
  ctx.stroke();
  // Concentric deck ring + glowing rim arc.
  ctx.strokeStyle = hexToRgba(c.stroke, 0.3);
  ctx.lineWidth = Math.max(0.5, r * 0.035);
  ctx.beginPath();
  ctx.arc(sx, 0, saucerR * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(c.glow, 0.7);
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.beginPath();
  ctx.arc(sx, 0, saucerR * 0.82, -0.9, 0.9);
  ctx.stroke();
  // Bridge dome.
  glowDot(ctx, sx + saucerR * 0.25, 0, r * 0.14, c.glow, 0.95);

  // --- Running lights (blinking) ---
  const blink = (phase) => 0.25 + 0.75 * (Math.sin(time / 480 + phase) > 0.55 ? 1 : 0.12);
  glowDot(ctx, -r * 1.5, r * 0.68, r * 0.055, '#ff7a7a', blink(0));
  glowDot(ctx, -r * 1.5, -r * 0.68, r * 0.055, '#7aff9e', blink(2.2));
  glowDot(ctx, r * 1.9, 0, r * 0.05, '#ffffff', blink(4.1));
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

function drawHullShape(ctx, hull, r, colors, time) {
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
    case 'flagship': drawFlagshipModel(ctx, r * 0.85, { time, side: 'player' }); break;
    case 'corvette': drawCorvetteModel(ctx, r, colors); break;
    case 'scout':
    default:
      drawScoutModel(ctx, r, colors);
      break;
  }
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
    showHp = true,
  } = opts;

  const scale = hullRenderScale(hull);
  const r = baseR * scale;
  const colors = hullColors(hull, side);
  const time = performance.now();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.shadowColor = hexToRgba(colors.glow, 0.35);
  ctx.shadowBlur = r * 0.3;
  drawHullShape(ctx, hull, r, colors, time);
  ctx.shadowBlur = 0;
  ctx.restore();

  if (showHp) drawHpBar(ctx, x, y, r, hp, maxHp);
}

/** Flagship sprite at a screen position/heading (system + galaxy views). */
export function drawFlagshipSprite(ctx, x, y, heading, r, thrusting) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  drawFlagshipModel(ctx, r, { thrusting, time: performance.now() });
  ctx.restore();
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
