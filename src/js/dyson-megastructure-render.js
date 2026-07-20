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

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function seededUnit(seed, index) {
  const value = Math.sin((Number(seed) * 0.000017 + index * 91.713) * 43758.5453);
  return value - Math.floor(value);
}

function drawEnergyHalo(ctx, envR, tier, time) {
  const strength = clamp01((tier - 1) / 7);
  const pulse = 0.82 + 0.18 * Math.sin(time / 760);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const halo = ctx.createRadialGradient(0, 0, envR * 0.62, 0, 0, envR * 1.48);
  halo.addColorStop(0, 'rgba(255, 214, 126, 0)');
  halo.addColorStop(0.48, `rgba(255, 174, 68, ${0.025 + strength * 0.035})`);
  halo.addColorStop(0.7, `rgba(255, 119, 36, ${(0.06 + strength * 0.08) * pulse})`);
  halo.addColorStop(1, 'rgba(255, 74, 18, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, envR * 1.48, 0, TAU);
  ctx.fill();

  const arcCount = tier >= 6 ? 5 : tier >= 3 ? 3 : 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < arcCount; i++) {
    const phase = time * (0.000035 + i * 0.000006) + i * 1.91;
    const radius = envR * (1.05 + i * 0.052);
    const span = 0.28 + 0.13 * Math.sin(time / 1100 + i * 2.3);
    ctx.strokeStyle = `rgba(255, ${174 + i * 9}, ${76 + i * 17}, ${0.1 + strength * 0.11})`;
    ctx.lineWidth = Math.max(0.7, envR * 0.006);
    ctx.beginPath();
    ctx.arc(0, 0, radius, phase, phase + span);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOrbitalCollectorPlane(ctx, envR, tier, time, index, lodSimple) {
  const planeDefs = [
    { rx: 1.01, ry: 0.38, rotation: -0.54, drift: 0.000022 },
    { rx: 1.08, ry: 0.27, rotation: 0.62, drift: -0.000017 },
    { rx: 1.14, ry: 0.2, rotation: 1.28, drift: 0.000013 },
  ];
  const def = planeDefs[index];
  if (!def) return;

  const rotation = def.rotation + time * def.drift;
  const rx = envR * def.rx;
  const ry = envR * def.ry;
  const activeFraction = clamp01((tier - index * 1.5) / 6.5);
  const segmentCount = lodSimple ? 8 : 18;
  const segmentSpan = TAU / segmentCount;

  ctx.save();
  ctx.rotate(rotation);

  // A recessed structural track gives every collector bank a common silhouette.
  ctx.strokeStyle = `rgba(7, 10, 18, ${0.48 + activeFraction * 0.35})`;
  ctx.lineWidth = Math.max(1.2, envR * 0.018);
  ctx.setLineDash([envR * 0.12, envR * 0.045]);
  ctx.lineDashOffset = time * (index % 2 ? 0.004 : -0.004);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  const panels = [];
  for (let i = 0; i < segmentCount; i++) {
    if ((i + index * 2) / segmentCount > activeFraction + 0.08) continue;
    const angle = i * segmentSpan + time * def.drift * 7 + index * 0.41;
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry;
    const tangent = Math.atan2(Math.cos(angle) * ry, -Math.sin(angle) * rx);
    const front = Math.sin(angle) > 0;
    const panelW = envR * (lodSimple ? 0.09 : 0.072);
    const panelH = Math.max(1.4, envR * 0.026);
    panels.push({ x, y, tangent, front, panelW, panelH });
  }

  // Collector banks share two depth styles, so draw their polygons and cell
  // dividers in batches instead of saving/restoring and stroking every panel.
  for (const front of [false, true]) {
    const shimmer = 0.72 + 0.28 * Math.sin(time / 430 + index * 1.7 + (front ? 0.8 : 0));
    ctx.fillStyle = front
      ? `rgba(13, 18, 30, ${0.92 * activeFraction})`
      : `rgba(7, 10, 18, ${0.62 * activeFraction})`;
    ctx.strokeStyle = front
      ? `rgba(255, 178, 72, ${(0.28 + shimmer * 0.22) * activeFraction})`
      : `rgba(128, 88, 52, ${0.18 * activeFraction})`;
    ctx.lineWidth = Math.max(0.55, envR * 0.004);
    ctx.beginPath();
    for (const panel of panels) {
      if (panel.front !== front) continue;
      const ux = Math.cos(panel.tangent);
      const uy = Math.sin(panel.tangent);
      const vx = -uy;
      const vy = ux;
      const hw = panel.panelW * 0.5;
      const hh = panel.panelH * 0.5;
      ctx.moveTo(panel.x - ux * hw - vx * hh, panel.y - uy * hw - vy * hh);
      ctx.lineTo(panel.x + ux * hw - vx * hh, panel.y + uy * hw - vy * hh);
      ctx.lineTo(panel.x + ux * hw + vx * hh, panel.y + uy * hw + vy * hh);
      ctx.lineTo(panel.x - ux * hw + vx * hh, panel.y - uy * hw + vy * hh);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  if (!lodSimple && tier >= 4) {
    const shimmer = 0.72 + 0.28 * Math.sin(time / 430 + index * 1.7);
    ctx.strokeStyle = `rgba(255, 218, 142, ${0.16 + shimmer * 0.12})`;
    ctx.lineWidth = Math.max(0.35, envR * 0.0018);
    ctx.beginPath();
    for (const panel of panels) {
      if (!panel.front) continue;
      const ux = Math.cos(panel.tangent);
      const uy = Math.sin(panel.tangent);
      const vx = -uy;
      const vy = ux;
      for (let cell = 1; cell < 3; cell++) {
        const offset = -panel.panelW * 0.5 + (panel.panelW * cell) / 3;
        const cx = panel.x + ux * offset;
        const cy = panel.y + uy * offset;
        ctx.moveTo(cx - vx * panel.panelH * 0.34, cy - vy * panel.panelH * 0.34);
        ctx.lineTo(cx + vx * panel.panelH * 0.34, cy + vy * panel.panelH * 0.34);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawCollectorSwarm(ctx, envR, tier, time, systemSeed, lodSimple) {
  if (tier < 2) return;
  const count = lodSimple ? 12 : 24 + tier * 3;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const frontPass of [false, true]) {
    const flicker = 0.68 + 0.32 * Math.sin(time / 260 + (frontPass ? 0.7 : 2.1));
    ctx.fillStyle = frontPass
      ? `rgba(255, 226, 154, ${0.34 + flicker * 0.5})`
      : `rgba(255, 128, 48, ${0.12 + flicker * 0.2})`;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const orbit = i % 3;
      const phase = seededUnit(systemSeed, i) * TAU
        + time * (0.000045 + orbit * 0.000014) * (i % 2 ? -1 : 1);
      const front = Math.sin(phase) > 0;
      if (front !== frontPass) continue;
      const rx = envR * (0.78 + orbit * 0.12 + seededUnit(systemSeed, i + 80) * 0.08);
      const ry = rx * (0.24 + orbit * 0.09);
      const rotation = -0.78 + orbit * 0.71;
      const ex = Math.cos(phase) * rx;
      const ey = Math.sin(phase) * ry;
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      const x = ex * cosR - ey * sinR;
      const y = ex * sinR + ey * cosR;
      const size = Math.max(0.7, envR * (front ? 0.009 : 0.006));
      const heading = phase + rotation;
      const ux = Math.cos(heading);
      const uy = Math.sin(heading);
      const vx = -uy;
      const vy = ux;
      const hw = size * 1.6;
      const hh = size * 0.42;
      ctx.moveTo(x - ux * hw - vx * hh, y - uy * hw - vy * hh);
      ctx.lineTo(x + ux * hw - vx * hh, y + uy * hw - vy * hh);
      ctx.lineTo(x + ux * hw + vx * hh, y + uy * hw + vy * hh);
      ctx.lineTo(x - ux * hw + vx * hh, y - uy * hw + vy * hh);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

function drawStructuralSpines(ctx, envR, tier, time, lodSimple) {
  if (tier < 3) return;
  const count = tier >= 7 ? 8 : tier >= 5 ? 6 : 4;
  const hubR = Math.max(2.3, envR * 0.032);
  const rotation = -0.18 + time * 0.000012;

  ctx.save();
  ctx.rotate(rotation);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU;
    const inner = envR * (0.69 + (i % 2) * 0.04);
    const outer = envR * (0.97 + (i % 3) * 0.025);
    const ix = Math.cos(angle) * inner;
    const iy = Math.sin(angle) * inner;
    const ox = Math.cos(angle) * outer;
    const oy = Math.sin(angle) * outer;
    const pulse = 0.62 + 0.38 * Math.sin(time / 480 + i * 1.8);

    ctx.strokeStyle = 'rgba(5, 8, 15, 0.94)';
    ctx.lineWidth = Math.max(2.2, envR * 0.021);
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(ox, oy);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 137, 48, ${0.2 + pulse * 0.22})`;
    ctx.lineWidth = Math.max(0.65, envR * 0.0045);
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(ox, oy);
    ctx.stroke();

    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(7, 11, 20, 0.98)';
    ctx.strokeStyle = `rgba(255, 182, 80, ${0.4 + pulse * 0.32})`;
    ctx.lineWidth = Math.max(0.7, envR * 0.004);
    ctx.beginPath();
    const sides = lodSimple ? 4 : 6;
    for (let side = 0; side < sides; side++) {
      const a = (side / sides) * TAU;
      const px = Math.cos(a) * hubR * 1.35;
      const py = Math.sin(a) * hubR;
      if (side === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 231, 174, ${0.42 + pulse * 0.45})`;
    ctx.beginPath();
    ctx.arc(0, 0, hubR * 0.28, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawReflectiveShellRings(ctx, starRadius, zoom, completedShells, time, pulse) {
  for (let tier = 1; tier <= Math.min(SHELL_COUNT, completedShells); tier++) {
    const tierR = shellOrbitRadius(starRadius, tier) * zoom * pulse;
    const alpha = 0.09 + tier * 0.032;
    ctx.strokeStyle = `rgba(4, 7, 13, ${Math.min(0.94, 0.64 + tier * 0.035)})`;
    ctx.lineWidth = Math.max(1.3, (2.1 + tier * 0.12) * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, tierR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 166, 62, ${Math.min(0.52, alpha)})`;
    ctx.lineWidth = Math.max(0.55, (0.72 + tier * 0.06) * zoom);
    ctx.setLineDash([Math.max(2, tierR * 0.085), Math.max(2, tierR * 0.033)]);
    ctx.lineDashOffset = (tier % 2 ? 1 : -1) * time * 0.007;
    ctx.beginPath();
    ctx.arc(0, 0, tierR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const specAngle = time / 2400 + tier * 0.4;
    ctx.strokeStyle = `rgba(255, 248, 218, ${0.32 + 0.16 * Math.sin(time / 900 + tier)})`;
    ctx.lineWidth = Math.max(1, 1.55 * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, tierR, specAngle, specAngle + 0.28 + tier * 0.015);
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

  const spin = tier >= 5 ? time * 0.001 * DYSON_CAGE_ROTATION_SPEED : 0;
  ctx.save();
  ctx.rotate(spin);

  const interference = tier >= 6;
  const edgeBins = [[], [], []];
  const pulseEdges = [];
  for (const edge of mesh.edges) {
    const depth = clamp01(((edge.z1 + edge.z2) * 0.25) + 0.5);
    const bin = Math.min(2, Math.floor(depth * 3));
    edgeBins[bin].push(edge);
    if (interference && !lodSimple && edge.id % 13 === 0) pulseEdges.push(edge);
  }

  // Batch hundreds of struts into three depth passes. The previous renderer
  // issued one stroke per edge (and another per energy conduit), which made a
  // completed sphere disproportionately expensive without improving its read.
  for (let bin = 0; bin < edgeBins.length; bin++) {
    const depth = (bin + 0.5) / edgeBins.length;
    ctx.strokeStyle = `rgba(${8 + Math.floor(depth * 12)}, ${12 + Math.floor(depth * 15)}, ${23 + Math.floor(depth * 18)}, ${0.48 + depth * 0.44})`;
    ctx.lineWidth = Math.max(0.75, (0.9 + tier * 0.08 + depth * 0.5) * zoom);
    ctx.beginPath();
    for (const edge of edgeBins[bin]) {
      ctx.moveTo(edge.x1 * zoom, edge.y1 * zoom);
      ctx.lineTo(edge.x2 * zoom, edge.y2 * zoom);
    }
    ctx.stroke();
  }

  if (interference && !lodSimple) {
    for (let bin = 0; bin < edgeBins.length; bin++) {
      const depth = (bin + 0.5) / edgeBins.length;
      const wave = 0.72 + 0.28 * Math.sin(time / 420 + bin * 1.7);
      ctx.strokeStyle = `rgba(255, ${128 + Math.floor(depth * 72)}, ${48 + Math.floor(depth * 60)}, ${(0.08 + depth * 0.15) * wave})`;
      ctx.lineWidth = Math.max(0.45, (0.62 + depth * 0.28) * zoom);
      ctx.setLineDash([3 * zoom, 5 * zoom]);
      ctx.lineDashOffset = -time / 80 + bin * 2.4;
      ctx.beginPath();
      for (const edge of edgeBins[bin]) {
        ctx.moveTo(edge.x1 * zoom, edge.y1 * zoom);
        ctx.lineTo(edge.x2 * zoom, edge.y2 * zoom);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#ffb45e';
    ctx.shadowBlur = Math.max(2, 4 * zoom);
    ctx.fillStyle = 'rgba(255, 237, 190, 0.72)';
    ctx.beginPath();
    for (const edge of pulseEdges) {
      const travel = (time * 0.00022 + edge.id * 0.173) % 1;
      const px = (edge.x1 + (edge.x2 - edge.x1) * travel) * zoom;
      const py = (edge.y1 + (edge.y2 - edge.y1) * travel) * zoom;
      ctx.moveTo(px + Math.max(0.65, 1.05 * zoom), py);
      ctx.arc(px, py, Math.max(0.65, 1.05 * zoom), 0, TAU);
    }
    ctx.fill();
    ctx.restore();
  }

  const nodeStride = lodSimple ? Math.ceil(mesh.nodes.length / 12) : 1;
  for (let bin = 0; bin < 3; bin++) {
    const depth = (bin + 0.5) / 3;
    ctx.fillStyle = `rgba(6, 9, 17, ${0.72 + depth * 0.25})`;
    ctx.beginPath();
    for (let i = 0; i < mesh.nodes.length; i += nodeStride) {
      const n = mesh.nodes[i];
      const nodeBin = Math.min(2, Math.floor(clamp01(n.z * 0.5 + 0.5) * 3));
      if (nodeBin !== bin) continue;
      const nx = n.x * zoom;
      const ny = n.y * zoom;
      const nodeR = Math.max(1.55, (2.1 + depth * 0.9) * zoom);
      ctx.moveTo(nx + nodeR, ny);
      ctx.arc(nx, ny, nodeR, 0, TAU);
    }
    ctx.fill();

    if (tier >= 5) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = '#ff6a2a';
      ctx.shadowBlur = Math.max(3, 5 * zoom);
      const pulse = 0.68 + 0.32 * Math.sin(time / 620 + bin * 1.4);
      ctx.fillStyle = `rgba(255, ${Math.floor(104 + 66 * pulse)}, ${40 + Math.floor(depth * 38)}, ${(0.28 + 0.48 * pulse) * (0.58 + depth * 0.42)})`;
      ctx.beginPath();
      for (let i = 0; i < mesh.nodes.length; i += nodeStride) {
        const n = mesh.nodes[i];
        const nodeBin = Math.min(2, Math.floor(clamp01(n.z * 0.5 + 0.5) * 3));
        if (nodeBin !== bin) continue;
        const nx = n.x * zoom;
        const ny = n.y * zoom;
        const nodeR = Math.max(1, (1.35 + depth * 0.7) * zoom);
        ctx.moveTo(nx + nodeR, ny);
        ctx.arc(nx, ny, nodeR, 0, TAU);
      }
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
  ctx.save();
  ctx.rotate(-0.13 + time * 0.000018);
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowColor = '#ffc26e';
  ctx.shadowBlur = Math.max(4, r * 0.35);
  ctx.strokeStyle = `rgba(255, 240, 204, ${0.62 * pulse})`;
  ctx.lineWidth = Math.max(1.2, 2.1 * zoom);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.22, r * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowBlur = Math.max(2, r * 0.18);
  ctx.strokeStyle = `rgba(255, 157, 54, ${0.45 * pulse})`;
  ctx.lineWidth = Math.max(0.8, 1.1 * zoom);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.96, r * 0.27, 0, Math.PI * 0.08, Math.PI * 1.12);
  ctx.stroke();
  ctx.restore();
}

function drawCompletionResonance(ctx, envR, time, lastShellCompletedAt) {
  if (lastShellCompletedAt == null) return;
  const age = time - lastShellCompletedAt;
  if (age < 0 || age > 2600) return;

  const progress = clamp01(age / 2600);
  const flash = Math.sin(Math.min(1, progress * 3.2) * Math.PI) * (1 - progress);
  const ringR = envR * (0.78 + progress * 1.22);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255, 238, 196, ${0.58 * (1 - progress)})`;
  ctx.lineWidth = Math.max(1, envR * 0.018 * (1 - progress));
  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 137, 44, ${0.28 * (1 - progress)})`;
  ctx.lineWidth = Math.max(0.7, envR * 0.008);
  ctx.beginPath();
  ctx.arc(0, 0, ringR * 1.08, 0, TAU);
  ctx.stroke();

  if (flash > 0.01) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * TAU + 0.12;
      ctx.strokeStyle = `rgba(255, 207, 128, ${0.16 * flash})`;
      ctx.lineWidth = Math.max(0.55, envR * 0.004);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * envR * 0.55, Math.sin(angle) * envR * 0.55);
      ctx.lineTo(Math.cos(angle) * envR * (1.1 + flash * 0.48), Math.sin(angle) * envR * (1.1 + flash * 0.48));
      ctx.stroke();
    }
  }
  ctx.restore();
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

  const envR = envelopeRadius(starRadius) * zoom * pulse;
  drawEnergyHalo(ctx, envR, tier, time);
  drawCollectorSwarm(ctx, envR, tier, time, systemSeed, lodSimple);

  const planeCount = tier >= 7 ? 3 : tier >= 4 ? 2 : tier >= 2 ? 1 : 0;
  for (let plane = 0; plane < planeCount; plane++) {
    drawOrbitalCollectorPlane(ctx, envR, tier, time, plane, lodSimple);
  }

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
      ctx.strokeStyle = 'rgba(255, 200, 110, 0.45)';
      ctx.lineWidth = Math.max(1.5, 2 * zoom);
      ctx.beginPath();
      ctx.arc(0, 0, envR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      drawGeodesicCage(ctx, mesh, zoom, tier, time, lodSimple);
    }
  }
  drawStructuralSpines(ctx, envR, tier, time, lodSimple);
  if (tier >= 7 && !lodSimple) {
    drawOuterIndustrialArcs(ctx, starRadius, zoom, time);
  }
  if (tier >= 8) {
    drawCoreAccretionRing(ctx, starRadius, zoom, time);
  }
  drawCompletionResonance(ctx, envR, time, lastShellCompletedAt);

  ctx.restore();
}

/** Horizontal lens flare — draw after star glow overlay (shell 8). */
export function drawDysonLensFlare(ctx, starX, starY, zoom, completedShells, starRadius, time = 0) {
  if (completedShells < SHELL_COUNT) return;

  const pulse = 0.74 + 0.26 * Math.sin(time / 520);
  const len = starRadius * zoom * 4.6;
  const thick = Math.max(1.6, starRadius * zoom * 0.065);
  const coreR = Math.max(2, starRadius * zoom * 0.105);

  ctx.save();
  ctx.translate(starX, starY);
  ctx.globalCompositeOperation = 'screen';

  const grad = ctx.createLinearGradient(-len, 0, len, 0);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.34, `rgba(255, 159, 66, ${0.035 * pulse})`);
  grad.addColorStop(0.46, `rgba(255, 231, 184, ${0.16 * pulse})`);
  grad.addColorStop(0.5, `rgba(255, 255, 248, ${0.78 * pulse})`);
  grad.addColorStop(0.54, `rgba(255, 222, 158, ${0.18 * pulse})`);
  grad.addColorStop(0.67, `rgba(255, 121, 42, ${0.045 * pulse})`);
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(-len, -thick * 0.5, len * 2, thick);

  const fine = ctx.createLinearGradient(-len * 1.2, 0, len * 1.2, 0);
  fine.addColorStop(0, 'rgba(255, 192, 116, 0)');
  fine.addColorStop(0.47, `rgba(255, 225, 180, ${0.08 * pulse})`);
  fine.addColorStop(0.5, `rgba(255, 255, 255, ${0.62 * pulse})`);
  fine.addColorStop(0.53, `rgba(255, 196, 111, ${0.09 * pulse})`);
  fine.addColorStop(1, 'rgba(255, 142, 58, 0)');
  ctx.fillStyle = fine;
  ctx.fillRect(-len * 1.2, -Math.max(0.45, thick * 0.09), len * 2.4, Math.max(0.9, thick * 0.18));

  const verticalLen = starRadius * zoom * 1.7;
  const vertical = ctx.createLinearGradient(0, -verticalLen, 0, verticalLen);
  vertical.addColorStop(0, 'rgba(255, 180, 80, 0)');
  vertical.addColorStop(0.5, `rgba(255, 246, 220, ${0.24 * pulse})`);
  vertical.addColorStop(1, 'rgba(255, 180, 80, 0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(-Math.max(0.5, thick * 0.12), -verticalLen, Math.max(1, thick * 0.24), verticalLen * 2);

  ctx.shadowColor = '#ffd79a';
  ctx.shadowBlur = Math.max(5, coreR * 3.5);
  ctx.fillStyle = `rgba(255, 255, 247, ${0.82 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  const ghosts = [
    { x: -0.54, r: 0.065, color: '255, 126, 52', alpha: 0.1 },
    { x: 0.42, r: 0.035, color: '112, 196, 255', alpha: 0.12 },
    { x: 0.71, r: 0.09, color: '255, 182, 86', alpha: 0.07 },
  ];
  for (const ghost of ghosts) {
    const gx = len * ghost.x;
    const gr = len * ghost.r;
    const ghostGrad = ctx.createRadialGradient(gx, 0, 0, gx, 0, gr);
    ghostGrad.addColorStop(0, `rgba(${ghost.color}, ${ghost.alpha * pulse})`);
    ghostGrad.addColorStop(0.72, `rgba(${ghost.color}, ${ghost.alpha * 0.25 * pulse})`);
    ghostGrad.addColorStop(1, `rgba(${ghost.color}, 0)`);
    ctx.fillStyle = ghostGrad;
    ctx.beginPath();
    ctx.arc(gx, 0, gr, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}
