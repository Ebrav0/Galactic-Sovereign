// Sail Foundry megastructure — three solid orbital rings around the host planet.

import { THEME, hexToRgba } from './theme.js';
import { foundryRingMotion } from './sail-shuttles.js';

const RING_LAYOUT = [
  { flatten: 0.32, rotation: Math.PI / 3, order: 0, spinIndex: 0 },
  { flatten: 0.32, rotation: (Math.PI * 2) / 3, order: 1, spinIndex: 1 },
  { flatten: 1, rotation: 0, order: 2, spinIndex: 2 },
];

function drawTiltedFoundryRing(ctx, rx, ry, bodyW, glowW, time, pulsePhase) {
  const pulse = 0.82 + 0.18 * Math.sin(time / 820 + pulsePhase);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(12, 16, 28, 0.95)';
  ctx.lineWidth = bodyW * 1.35;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(34, 42, 62, 0.92)';
  ctx.lineWidth = bodyW;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(52, 62, 88, 0.55)';
  ctx.lineWidth = Math.max(1, bodyW * 0.22);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.94, ry * 0.94, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = '#ff8c2a';
  ctx.shadowBlur = Math.max(4, rx * 0.07);

  const glowLines = [
    { scale: 1.04, alpha: 0.42, width: glowW * 1.15 },
    { scale: 1.0, alpha: 0.72 * pulse, width: glowW },
    { scale: 0.96, alpha: 0.5 * pulse, width: glowW * 0.85 },
  ];

  for (const line of glowLines) {
    ctx.strokeStyle = `rgba(255, ${Math.floor(148 + 40 * pulse)}, ${Math.floor(52 + 20 * pulse)}, ${line.alpha})`;
    ctx.lineWidth = line.width;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * line.scale, ry * line.scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = `rgba(255, 228, 160, ${0.28 * pulse})`;
  ctx.lineWidth = Math.max(0.8, glowW * 0.55);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.98, ry * 0.98, 0, -Math.PI * 0.2, Math.PI * 0.45);
  ctx.stroke();
}

/**
 * Draw the Sail Foundry as three thick, intersecting orbital rings (animated cage).
 */
export function drawSailFoundryRingStation(ctx, cx, cy, ringR, zoom, time = 0, foundryId = 'foundry') {
  const r = ringR;
  const bodyW = Math.max(2.4, r * 0.052);
  const glowW = Math.max(1, r * 0.012);
  const { cageSpin, ringOffsets } = foundryRingMotion(foundryId, time);
  const sorted = [...RING_LAYOUT].sort((a, b) => a.flatten - b.flatten);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cageSpin);

  for (let i = 0; i < sorted.length; i++) {
    const ring = sorted[i];
    ctx.save();
    ctx.rotate(ring.rotation + ringOffsets[ring.spinIndex]);
    const rx = r;
    const ry = r * ring.flatten;
    drawTiltedFoundryRing(ctx, rx, ry, bodyW, glowW, time, ring.order * 1.7);
    ctx.restore();
  }

  ctx.restore();
}

/** Label anchor — tracks the rotating dock point on the equatorial ring. */
export function sailFoundryLabelAnchor(cx, cy, ringR, dockAngle) {
  const lx = cx + Math.cos(dockAngle) * ringR;
  const ly = cy + Math.sin(dockAngle) * ringR;
  return {
    x: lx,
    y: ly,
    labelX: lx,
    labelY: ly - Math.max(12, ringR * 0.14),
    color: THEME.accentGold,
  };
}

export function drawSailFoundryLabel(ctx, anchor, zoom) {
  const size = Math.max(9, 10 * zoom);
  ctx.save();
  ctx.font = `${size}px ${THEME.fontUi}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(5, 7, 15, 0.8)';
  ctx.fillText('Sail Foundry', anchor.labelX + 1, anchor.labelY + 1);
  ctx.fillStyle = hexToRgba(anchor.color, 0.95);
  ctx.fillText('Sail Foundry', anchor.labelX, anchor.labelY);
  ctx.restore();
}
