// Novacula-inspired Dyson megastructure — tiered Canvas 2D rendering.

import {
  SHELL_COUNT,
  DYSON_MESH_LOD_ZOOM,
  DYSON_CAGE_ROTATION_SPEED,
} from './constants.js';
import { THEME, hexToRgba } from './theme.js';
import {
  shellOrbitRadius,
  shellVisualTier,
  buildGeodesicMesh,
  envelopeRadius,
} from './dyson-visuals.js';

function drawReflectiveShellRings(ctx, starRadius, zoom, completedShells, time, pulse) {
  for (let tier = 1; tier <= Math.min(SHELL_COUNT, completedShells); tier++) {
    const tierR = shellOrbitRadius(starRadius, tier) * zoom * pulse;
    const alpha = 0.1 + tier * 0.035;
    ctx.strokeStyle = `rgba(255, 210, 120, ${Math.min(0.72, alpha)})`;
    ctx.lineWidth = Math.max(0.6, (0.8 + tier * 0.08) * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, tierR, 0, Math.PI * 2);
    ctx.stroke();

    const specAngle = time / 2400 + tier * 0.4;
    ctx.strokeStyle = `rgba(255, 245, 210, ${0.35 + 0.15 * Math.sin(time / 900 + tier)})`;
    ctx.lineWidth = Math.max(1.2, 1.8 * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, tierR, specAngle, specAngle + 0.35);
    ctx.stroke();
  }
}

function drawSparseLatticeStruts(ctx, starRadius, zoom, tier, time) {
  const innerR = shellOrbitRadius(starRadius, 1) * zoom;
  const count = tier >= 2 ? 8 : 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + time * 0.00008;
    const midR = innerR * (0.55 + (i % 3) * 0.12);
    ctx.strokeStyle = 'rgba(22, 28, 42, 0.88)';
    ctx.lineWidth = Math.max(1, 1.4 * zoom);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * innerR * 0.35, Math.sin(a) * innerR * 0.35);
    ctx.quadraticCurveTo(
      Math.cos(a + 0.25) * midR,
      Math.sin(a + 0.25) * midR,
      Math.cos(a + 0.5) * innerR * 0.92,
      Math.sin(a + 0.5) * innerR * 0.92,
    );
    ctx.stroke();

    if (tier >= 2) {
      const nx = Math.cos(a + 0.5) * innerR * 0.92;
      const ny = Math.sin(a + 0.5) * innerR * 0.92;
      const pulse = 0.65 + 0.35 * Math.sin(time / 700 + i);
      ctx.fillStyle = `rgba(255, 110, 40, ${0.55 * pulse})`;
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(1.5, 2.2 * zoom), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPartialBandArcs(ctx, starRadius, zoom, tier, time) {
  const midTier = Math.min(tier, 3);
  const bandR = shellOrbitRadius(starRadius, midTier) * zoom;
  const segments = tier >= 3 ? 3 : 2;
  for (let i = 0; i < segments; i++) {
    const start = (i / segments) * Math.PI * 2 + time * 0.00005;
    ctx.strokeStyle = 'rgba(255, 190, 90, 0.42)';
    ctx.lineWidth = Math.max(1.5, 2.2 * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, bandR, start, start + (Math.PI * 2) / segments * 0.55);
    ctx.stroke();
  }
}

function drawGeodesicCage(ctx, mesh, zoom, tier, time, lodSimple) {
  if (!mesh.edges.length) return;

  const spin = tier >= 5 ? time * DYSON_CAGE_ROTATION_SPEED : 0;
  ctx.save();
  ctx.rotate(spin);

  const interference = tier >= 6;
  for (const edge of mesh.edges) {
    const wave = interference
      ? 0.65 + 0.35 * Math.sin(time / 420 + edge.id * 0.7)
      : 1;
    ctx.strokeStyle = `rgba(18, 22, 35, ${0.55 + (tier / SHELL_COUNT) * 0.35})`;
    ctx.lineWidth = Math.max(0.8, (1 + tier * 0.08) * zoom);
    ctx.beginPath();
    ctx.moveTo(edge.x1 * zoom, edge.y1 * zoom);
    ctx.lineTo(edge.x2 * zoom, edge.y2 * zoom);
    ctx.stroke();

    if (interference && !lodSimple) {
      ctx.strokeStyle = `rgba(255, 140, 60, ${0.12 * wave})`;
      ctx.lineWidth = Math.max(0.5, 0.7 * zoom);
      ctx.setLineDash([3 * zoom, 5 * zoom]);
      ctx.lineDashOffset = -time / 80 + edge.id;
      ctx.beginPath();
      ctx.moveTo(edge.x1 * zoom, edge.y1 * zoom);
      ctx.lineTo(edge.x2 * zoom, edge.y2 * zoom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const nodeStride = lodSimple ? Math.ceil(mesh.nodes.length / 12) : 1;
  for (let i = 0; i < mesh.nodes.length; i += nodeStride) {
    const n = mesh.nodes[i];
    const nx = n.x * zoom;
    const ny = n.y * zoom;
    const pulse = 0.55 + 0.45 * Math.sin(time / 620 + i * 0.4);

    ctx.fillStyle = 'rgba(10, 12, 20, 0.92)';
    ctx.beginPath();
    ctx.arc(nx, ny, Math.max(1.8, 2.6 * zoom), 0, Math.PI * 2);
    ctx.fill();

    if (tier >= 5) {
      ctx.save();
      ctx.shadowColor = '#ff6a2a';
      ctx.shadowBlur = Math.max(3, 5 * zoom);
      ctx.fillStyle = `rgba(255, ${Math.floor(90 + 50 * pulse)}, 40, ${0.45 + 0.4 * pulse})`;
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(1.2, 1.8 * zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawOuterIndustrialArcs(ctx, starRadius, zoom, time) {
  const envR = envelopeRadius(starRadius) * zoom;
  const arcs = [
    { start: -0.4, span: 1.1, rx: 1.08, ry: 0.22, rot: 0.15 },
    { start: 2.0, span: 0.95, rx: 1.12, ry: 0.18, rot: -0.2 },
    { start: 3.8, span: 1.05, rx: 1.06, ry: 0.25, rot: 0.35 },
    { start: 5.2, span: 0.85, rx: 1.1, ry: 0.2, rot: -0.1 },
  ];

  for (const arc of arcs) {
    ctx.save();
    ctx.rotate(arc.rot + time * 0.00004);
    const rx = envR * arc.rx;
    const ry = envR * arc.ry;
    const bodyW = Math.max(2.5, envR * 0.028);

    ctx.strokeStyle = 'rgba(12, 16, 28, 0.95)';
    ctx.lineWidth = bodyW * 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, arc.start, arc.start + arc.span);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 130, 50, 0.35)';
    ctx.lineWidth = Math.max(1, bodyW * 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.98, ry * 0.98, 0, arc.start + 0.05, arc.start + arc.span - 0.05);
    ctx.stroke();

    for (let rib = 0; rib < 5; rib++) {
      const t = arc.start + (rib / 4) * arc.span;
      ctx.strokeStyle = 'rgba(40, 48, 68, 0.7)';
      ctx.lineWidth = Math.max(0.6, bodyW * 0.18);
      ctx.beginPath();
      ctx.moveTo(Math.cos(t) * rx * 0.92, Math.sin(t) * ry * 0.92);
      ctx.lineTo(Math.cos(t) * rx * 1.04, Math.sin(t) * ry * 1.04);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawCoreAccretionRing(ctx, starRadius, zoom, time) {
  const r = starRadius * zoom * 0.35;
  const pulse = 0.7 + 0.3 * Math.sin(time / 500);
  ctx.strokeStyle = `rgba(255, 230, 180, ${0.55 * pulse})`;
  ctx.lineWidth = Math.max(1.2, 1.8 * zoom);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.15, r * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 180, 80, ${0.35 * pulse})`;
  ctx.lineWidth = Math.max(0.8, 1.1 * zoom);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92, r * 0.32, 0, Math.PI * 0.1, Math.PI * 1.05);
  ctx.stroke();
}

/** Megastructure body — draw before star glow overlay. */
export function drawDysonMegastructure(
  ctx,
  starX,
  starY,
  zoom,
  completedShells,
  starRadius,
  time = 0,
  lastShellCompletedAt = null,
  systemSeed = 0,
) {
  if (completedShells <= 0) return;

  const tier = shellVisualTier(completedShells);
  const pulse = lastShellCompletedAt != null && time - lastShellCompletedAt < 1000
    ? 1 + 0.15 * (1 - (time - lastShellCompletedAt) / 1000)
    : 1;
  const lodSimple = zoom < DYSON_MESH_LOD_ZOOM;
  const mesh = buildGeodesicMesh(starRadius, completedShells, systemSeed);

  ctx.save();
  ctx.translate(starX, starY);

  drawReflectiveShellRings(ctx, starRadius, zoom, completedShells, time, pulse);

  if (tier >= 1 && tier <= 2) {
    drawSparseLatticeStruts(ctx, starRadius, zoom, tier, time);
  }
  if (tier >= 3 && tier <= 4) {
    drawSparseLatticeStruts(ctx, starRadius, zoom, 2, time);
    drawPartialBandArcs(ctx, starRadius, zoom, tier, time);
  }
  if (tier >= 5) {
    if (lodSimple) {
      drawPartialBandArcs(ctx, starRadius, zoom, tier, time);
      const envR = envelopeRadius(starRadius) * zoom * pulse;
      ctx.strokeStyle = 'rgba(255, 200, 110, 0.45)';
      ctx.lineWidth = Math.max(1.5, 2 * zoom);
      ctx.beginPath();
      ctx.arc(0, 0, envR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      drawGeodesicCage(ctx, mesh, zoom, tier, time, lodSimple);
    }
  }
  if (tier >= 7 && !lodSimple) {
    drawOuterIndustrialArcs(ctx, starRadius, zoom, time);
  }
  if (tier >= 8) {
    drawCoreAccretionRing(ctx, starRadius, zoom, time);
  }

  ctx.restore();
}

/** Horizontal lens flare — draw after star glow overlay (shell 8). */
export function drawDysonLensFlare(ctx, starX, starY, zoom, completedShells, starRadius, time = 0) {
  if (completedShells < SHELL_COUNT) return;

  const pulse = 0.65 + 0.35 * Math.sin(time / 480);
  const len = starRadius * zoom * 2.8;
  const thick = Math.max(2, starRadius * zoom * 0.08);

  ctx.save();
  ctx.translate(starX, starY);

  const grad = ctx.createLinearGradient(-len, 0, len, 0);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.42, `rgba(255, 240, 200, ${0.08 * pulse})`);
  grad.addColorStop(0.5, `rgba(255, 255, 255, ${0.55 * pulse})`);
  grad.addColorStop(0.58, `rgba(255, 220, 140, ${0.12 * pulse})`);
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(-len, -thick * 0.5, len * 2, thick);

  ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, starRadius * zoom * 0.12), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
