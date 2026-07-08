// Dyson megastructure visuals — supply ties, sail dot slots, in-flight particles (never serialized).

import {
  SHELL_SAILS_REQUIRED,
  SHELL_COUNT,
  LAUNCHER_BATCH_SIZE,
  LAUNCHER_BURST_MS,
  SAIL_LAUNCH_FLIGHT_MS,
  SAIL_LAUNCH_STAGGER_MS,
  SAIL_DOT_LOD_ZOOM,
  SAIL_DOT_DRAW_MAX,
  SAIL_DOT_LOD_STRIDE_TARGET,
  CELESTIAL_VISUAL_SCALE,
  DYSON_LATTICE_BLEND_PROGRESS,
  DYSON_CONSTRUCTION_LATTICE_SLOTS,
  DYSON_MAX_MESH_EDGES,
} from './constants.js';
import {
  systemById,
  hasFoundry,
  dysonLaunchers,
  ensureDyson,
  hashSeed,
} from './state.js';
import { foundryAnchor } from './sail-shuttles.js';
import { launcherSiteById } from './structure-sites.js';

/** Closest point on foundry equatorial ring toward a target. */
export function foundryRingClosestPoint(planetX, planetY, ringR, targetX, targetY) {
  const angle = Math.atan2(targetY - planetY, targetX - planetX);
  return {
    x: planetX + Math.cos(angle) * ringR,
    y: planetY + Math.sin(angle) * ringR,
    angle,
  };
}

/** 1-based completed shell tier → world orbit radius around star at origin. */
export function shellOrbitRadius(starRadius, shellTier) {
  const visualR = starRadius * CELESTIAL_VISUAL_SCALE;
  return visualR * (1.08 + shellTier * 0.06);
}

/** Geodesic harvest cage radius (outermost completed shell). */
export function envelopeRadius(starRadius) {
  return shellOrbitRadius(starRadius, SHELL_COUNT);
}

/** GDD visual phase 0–8 (matches completedShells). */
export function shellVisualTier(completedShells) {
  return Math.max(0, Math.min(SHELL_COUNT, completedShells | 0));
}

/** Icosahedron subdivision frequency for geodesic mesh (0 = no mesh). */
export function geodesicFrequency(completedShells) {
  if (completedShells >= 7) return 2;
  if (completedShells >= 5) return 1;
  return 0;
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function midpoint3(a, b) {
  return normalize3([(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]);
}

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

/** Build a pole-view geodesic mesh around the star (deterministic from seed). */
export function buildGeodesicMesh(starRadius, completedShells, systemSeed = 0) {
  const tier = shellVisualTier(completedShells);
  const freq = geodesicFrequency(completedShells);
  const radius = envelopeRadius(starRadius);
  if (freq <= 0 || tier <= 0) {
    return { nodes: [], edges: [], frequency: 0, envelopeR: radius, tier };
  }

  const phi = (1 + Math.sqrt(5)) * 0.5;
  let vertices = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(normalize3);

  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let f = 0; f < freq; f++) {
    const nextVerts = [...vertices];
    const midCache = new Map();
    const nextFaces = [];

    function getMid(a, b) {
      const key = edgeKey(a, b);
      if (midCache.has(key)) return midCache.get(key);
      const mid = midpoint3(vertices[a], vertices[b]);
      const idx = nextVerts.length;
      nextVerts.push(mid);
      midCache.set(key, idx);
      return idx;
    }

    for (const [a, b, c] of faces) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    vertices = nextVerts;
    faces = nextFaces;
  }

  const spin = ((hashSeed(0xd501, String(systemSeed)) % 628) / 100) * 0.1;
  const cosS = Math.cos(spin);
  const sinS = Math.sin(spin);

  const nodes = vertices.map((v, id) => {
    const x = v[0] * cosS - v[1] * sinS;
    const y = v[0] * sinS + v[1] * cosS;
    return { id, x: x * radius, y: y * radius, z: v[2] };
  });

  const edgeSet = new Set();
  const edges = [];
  for (const [a, b, c] of faces) {
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(i, j);
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      const n1 = nodes[i];
      const n2 = nodes[j];
      edges.push({
        id: edges.length,
        x1: n1.x,
        y1: n1.y,
        x2: n2.x,
        y2: n2.y,
        z1: n1.z,
        z2: n2.z,
      });
    }
  }

  // Shell tier gates visible edge fraction (construction / escalation).
  const edgeFraction = tier >= 8 ? 1
    : tier >= 7 ? 0.92
      : tier >= 6 ? 0.78
        : tier >= 5 ? 0.6
          : 0.4;
  let visibleEdges = edges.slice(0, Math.max(1, Math.floor(edges.length * edgeFraction)));
  if (visibleEdges.length > DYSON_MAX_MESH_EDGES) {
    const stride = Math.ceil(visibleEdges.length / DYSON_MAX_MESH_EDGES);
    visibleEdges = visibleEdges.filter((_, i) => i % stride === 0);
  }

  return {
    nodes,
    edges: visibleEdges,
    frequency: freq,
    envelopeR: radius,
    tier,
  };
}

/** Edge midpoints for construction weave (high shell progress). */
export function latticeConstructionSlots(starRadius, completedShells, systemSeed = 0) {
  const mesh = buildGeodesicMesh(starRadius, Math.max(completedShells + 1, 5), systemSeed);
  const slots = [];
  const cap = DYSON_CONSTRUCTION_LATTICE_SLOTS;
  for (let i = 0; i < mesh.edges.length && slots.length < cap; i++) {
    const e = mesh.edges[i];
    slots.push({
      x: (e.x1 + e.x2) * 0.5,
      y: (e.y1 + e.y2) * 0.5,
      edgeId: e.id,
    });
  }
  while (slots.length < cap) {
    const orbitR = shellOrbitRadius(starRadius, completedShells + 1);
    const angle = (slots.length / cap) * Math.PI * 2;
    slots.push({ x: Math.cos(angle) * orbitR, y: Math.sin(angle) * orbitR, edgeId: -1 });
  }
  return slots;
}

/** Construction dot position — ring early, lattice weave late. */
export function constructionDotPosition(slot, completedShells, starRadius, shellSails, systemSeed = 0) {
  const ring = inProgressSailDotPosition(slot, completedShells, starRadius);
  const progress = shellSails / SHELL_SAILS_REQUIRED;
  if (progress < DYSON_LATTICE_BLEND_PROGRESS) return ring;

  const lattice = latticeConstructionSlots(starRadius, completedShells, systemSeed);
  const target = lattice[slot % lattice.length];
  const blend = Math.min(1, (progress - DYSON_LATTICE_BLEND_PROGRESS) / (1 - DYSON_LATTICE_BLEND_PROGRESS));
  const eased = blend * blend * (3 - 2 * blend);
  return {
    ...ring,
    x: ring.x + (target.x - ring.x) * eased,
    y: ring.y + (target.y - ring.y) * eased,
  };
}

/** Slot on the in-progress shell ring (slot 0 .. SHELL_SAILS_REQUIRED-1). */
export function inProgressSailDotPosition(slot, completedShells, starRadius) {
  const shellTier = completedShells + 1;
  const orbitR = shellOrbitRadius(starRadius, shellTier);
  const jitter = ((hashSeed(0xca01 + completedShells, String(slot)) % 1000) / 1000) * 0.00002;
  const angle = (slot / SHELL_SAILS_REQUIRED) * Math.PI * 2 + jitter;
  return {
    x: Math.cos(angle) * orbitR,
    y: Math.sin(angle) * orbitR,
    slot,
    shellTier,
    orbitR,
    angle,
  };
}

export function sailDotDrawStride(settledCount, zoom) {
  if (settledCount <= 0) return 1;
  if (zoom >= SAIL_DOT_LOD_ZOOM && settledCount <= SAIL_DOT_DRAW_MAX) return 1;
  if (zoom < SAIL_DOT_LOD_ZOOM) {
    return Math.max(1, Math.ceil(settledCount / SAIL_DOT_LOD_STRIDE_TARGET));
  }
  return Math.max(1, Math.ceil(settledCount / SAIL_DOT_DRAW_MAX));
}

export function foundryLauncherSupplyLines(state, systemId, time = state.time) {
  const fa = foundryAnchor(state, systemId, time);
  if (!fa.foundryId || !fa.planetId) return [];

  const launchers = dysonLaunchers(state, systemId);
  return launchers.map((launcher) => {
    const site = launcherSiteById(state, systemId, launcher.id, time);
    if (!site) return null;
    const from = foundryRingClosestPoint(fa.planetX, fa.planetY, fa.ringR, site.dockX, site.dockY);
    return {
      launcherId: launcher.id,
      fromX: from.x,
      fromY: from.y,
      toX: site.dockX,
      toY: site.dockY,
      fromAngle: from.angle,
    };
  }).filter(Boolean);
}

export function settledInProgressDots(state, systemId, starRadius) {
  const system = systemById(state, systemId);
  if (!system) return [];
  const dyson = ensureDyson(system);
  if (dyson.completedShells >= SHELL_COUNT) return [];

  const count = Math.floor(dyson.shellSails);
  const systemSeed = state.seed ?? 0;
  const dots = [];
  for (let slot = 0; slot < count; slot++) {
    const pos = constructionDotPosition(
      slot,
      dyson.completedShells,
      starRadius,
      dyson.shellSails,
      systemSeed,
    );
    dots.push({ ...pos, settled: true, progress: 1 });
  }
  return dots;
}

export function inFlightSailDots(state, systemId, starRadius, time = state.time) {
  const system = systemById(state, systemId);
  if (!system || !hasFoundry(state, systemId)) return [];

  const dyson = ensureDyson(system);
  if (dyson.completedShells >= SHELL_COUNT) return [];

  const launchers = dysonLaunchers(state, systemId);
  const dots = [];
  const sailsNow = Math.floor(dyson.shellSails);

  for (const launcher of launchers) {
    const site = launcherSiteById(state, systemId, launcher.id, time);
    if (!site) continue;

    const age = time - (dyson.launcherLastFireAt?.[launcher.id] ?? -1e9);
    if (age < 0 || age >= SAIL_LAUNCH_FLIGHT_MS + LAUNCHER_BATCH_SIZE * SAIL_LAUNCH_STAGGER_MS) {
      continue;
    }

    for (let k = 0; k < LAUNCHER_BATCH_SIZE; k++) {
      const stagger = k * SAIL_LAUNCH_STAGGER_MS;
      const localAge = age - stagger;
      if (localAge < 0 || localAge >= SAIL_LAUNCH_FLIGHT_MS) continue;

      const slot = sailsNow - LAUNCHER_BATCH_SIZE + k;
      if (slot < 0 || slot >= SHELL_SAILS_REQUIRED) continue;

      const progress = Math.min(1, Math.max(0, localAge / SAIL_LAUNCH_FLIGHT_MS));
      const target = inProgressSailDotPosition(slot, dyson.completedShells, starRadius);
      const eased = progress * progress * (3 - 2 * progress);
      dots.push({
        x: site.muzzleX + (target.x - site.muzzleX) * eased,
        y: site.muzzleY + (target.y - site.muzzleY) * eased,
        slot,
        progress: eased,
        settled: false,
        launcherId: launcher.id,
        distToStar: Math.hypot(
          site.muzzleX + (target.x - site.muzzleX) * eased,
          site.muzzleY + (target.y - site.muzzleY) * eased,
        ),
      });
    }
  }

  return dots;
}

/** Completed shell tier radii for tests (1-based tiers). */
export function completedShellRingRadii(starRadius, completedShells) {
  const radii = [];
  for (let tier = 1; tier <= completedShells; tier++) {
    radii.push(Math.round(shellOrbitRadius(starRadius, tier) * 10) / 10);
  }
  return radii;
}

export function dysonVisualSummary(state, systemId, starRadius, zoom) {
  const system = systemById(state, systemId);
  const dyson = system ? ensureDyson(system) : null;
  const tier = dyson ? shellVisualTier(dyson.completedShells) : 0;
  const mesh = dyson ? buildGeodesicMesh(starRadius, dyson.completedShells, state.seed ?? 0) : null;
  const settled = dyson ? settledInProgressDots(state, systemId, starRadius) : [];
  const inFlight = dyson ? inFlightSailDots(state, systemId, starRadius) : [];
  const supplyLines = hasFoundry(state, systemId)
    ? foundryLauncherSupplyLines(state, systemId)
    : [];
  const inProgressSettledDots = settled.length;
  const dotStride = sailDotDrawStride(inProgressSettledDots, zoom ?? 1);

  const firstLine = supplyLines[0] ?? null;
  const firstLauncher = firstLine
    ? launcherSiteById(state, systemId, firstLine.launcherId)
    : null;

  return {
    supplyLineCount: supplyLines.length,
    completedRingCount: dyson?.completedShells ?? 0,
    inProgressSettledDots,
    inFlightDots: inFlight.length,
    totalDotEquivalent: inProgressSettledDots,
    dotStride,
    currentShellProgress: dyson
      ? Math.round((Math.floor(dyson.shellSails) / SHELL_SAILS_REQUIRED) * 1000) / 1000
      : 0,
    completedRingRadii: dyson ? completedShellRingRadii(starRadius, dyson.completedShells) : [],
    supplyLines: supplyLines.map((l) => ({
      launcherId: l.launcherId,
      fromX: Math.round(l.fromX * 10) / 10,
      fromY: Math.round(l.fromY * 10) / 10,
      toX: Math.round(l.toX * 10) / 10,
      toY: Math.round(l.toY * 10) / 10,
    })),
    closestRingPoint: firstLine
      ? { x: Math.round(firstLine.fromX * 10) / 10, y: Math.round(firstLine.fromY * 10) / 10 }
      : null,
    firstLauncherDock: firstLauncher
      ? { x: Math.round(firstLauncher.dockX * 10) / 10, y: Math.round(firstLauncher.dockY * 10) / 10 }
      : null,
    inFlightSample: inFlight.slice(0, 3).map((d) => ({
      progress: Math.round(d.progress * 1000) / 1000,
      distToStar: Math.round(d.distToStar * 10) / 10,
    })),
    inFlightProgress: inFlight.map((d) => Math.round(d.progress * 1000) / 1000),
    inFlightDistToStar: inFlight.map((d) => Math.round(d.distToStar * 10) / 10),
    shellSails: dyson ? Math.floor(dyson.shellSails) : 0,
    visualTier: tier,
    meshEdgeCount: mesh?.edges?.length ?? 0,
    nodeCount: mesh?.nodes?.length ?? 0,
    isNovaculaComplete: tier >= SHELL_COUNT,
  };
}

/** Whether a world point lies near the segment from ring point to launcher dock. */
export function pointNearSupplySegment(px, py, fromX, fromY, toX, toY, tolerance = 8) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - fromX) * dx + (py - fromY) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = fromX + t * dx;
  const ny = fromY + t * dy;
  return Math.hypot(px - nx, py - ny) <= tolerance;
}
