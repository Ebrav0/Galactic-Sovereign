// Galaxy layer: seeded star layout, lane graph, and routing (GDD §4–5).
// Pure generation and graph helpers — no DOM/canvas, no live-state mutation.

import {
  GALAXY_STAR_COUNT,
  GALAXY_RADIUS,
  GALAXY_INNER_RADIUS,
  GALAXY_MIN_STAR_SPACING,
  GALAXY_EXTRA_LANE_MAX_DIST,
  GALAXY_TARGET_AVG_DEGREE,
  GALAXY_MAX_DEGREE,
  GALAXY_BACKBONE_SPOKE_COUNT,
  GALAXY_SMALL_WORLD_LANES,
  BLACK_HOLE_MIN_LANES,
} from './constants.js';

export const BLACK_HOLE_ID = 'core';

const STAR_NAMES = [
  'Aldrin', 'Beryl', 'Cassia', 'Dorado', 'Eventide', 'Farholm',
  'Gilead', 'Halcyon', 'Iskra', 'Jorvik', 'Kestrel', 'Lumen',
  'Meridian', 'Nadir', 'Ophira', 'Praxis', 'Quorra', 'Rythar',
  'Sable', 'Talos', 'Umbriel', 'Vesper', 'Wren', 'Ythaca',
];

let starCountOverride = null;

export function getGalaxyStarCount() {
  return starCountOverride ?? GALAXY_STAR_COUNT;
}

export function setGalaxyStarCountForTests(n) {
  starCountOverride = n;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function proceduralStarName(rng, index) {
  const base = STAR_NAMES[index % STAR_NAMES.length];
  const suffix = Math.floor(index / STAR_NAMES.length);
  return suffix === 0 ? base : `${base} ${suffix + 1}`;
}

// Returns { stars: [{id, name, x, y}], blackHole: {id, name, x, y}, lanes: [[idA, idB]] }.
export function generateGalaxy(rng) {
  const starCount = getGalaxyStarCount();
  const stars = [];
  for (let i = 0; i < starCount; i++) {
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 80; attempt++) {
      const r = GALAXY_INNER_RADIUS + Math.sqrt(rng()) * (GALAXY_RADIUS - GALAXY_INNER_RADIUS);
      const a = rng() * Math.PI * 2;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
      const spacing = GALAXY_MIN_STAR_SPACING * (attempt < 60 ? 1 : 0.7);
      if (stars.every((s) => Math.hypot(s.x - x, s.y - y) >= spacing)) break;
    }
    stars.push({
      id: `sys-${i}`,
      name: proceduralStarName(rng, i),
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  const blackHole = { id: BLACK_HOLE_ID, name: 'Galactic Core', x: 0, y: 0 };
  const nodes = [...stars, blackHole];

  const lanes = [];
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  const laneSet = new Set();
  const addLane = (a, b) => {
    lanes.push([a.id, b.id]);
    laneSet.add(laneKey(a.id, b.id));
    degree.set(a.id, degree.get(a.id) + 1);
    degree.set(b.id, degree.get(b.id) + 1);
  };

  const inTree = new Set([blackHole.id]);
  const bfsQueue = [blackHole];
  while (inTree.size < nodes.length) {
    const current = bfsQueue.shift();
    const candidates = nodes
      .filter((n) => !inTree.has(n.id))
      .map((n) => ({ node: n, d: dist(current, n) }))
      .sort((p, q) => p.d - q.d);
    if (candidates.length === 0) break;
    const nearest = candidates[0].node;
    addLane(current, nearest);
    inTree.add(nearest.id);
    bfsQueue.push(nearest);
  }

  const candidates = [];
  const cellSize = GALAXY_EXTRA_LANE_MAX_DIST;
  const grid = new Map();
  for (const node of nodes) {
    const cx = Math.floor(node.x / cellSize);
    const cy = Math.floor(node.y / cellSize);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const cx = Math.floor(a.x / cellSize);
    const cy = Math.floor(a.y / cellSize);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(`${gx},${gy}`);
        if (!bucket) continue;
        for (const b of bucket) {
          if (b.id <= a.id) continue;
          const d = dist(a, b);
          if (d <= GALAXY_EXTRA_LANE_MAX_DIST) candidates.push({ a, b, d });
        }
      }
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  for (const { a, b } of candidates) {
    const avgDegree = (lanes.length * 2) / nodes.length;
    if (avgDegree >= GALAXY_TARGET_AVG_DEGREE) break;
    if (laneSet.has(laneKey(a.id, b.id))) continue;
    if (degree.get(a.id) >= GALAXY_MAX_DEGREE || degree.get(b.id) >= GALAXY_MAX_DEGREE) continue;
    addLane(a, b);
  }

  const nearest = [...stars].sort((p, q) => dist(p, blackHole) - dist(q, blackHole));
  for (const star of nearest) {
    if (degree.get(BLACK_HOLE_ID) >= BLACK_HOLE_MIN_LANES) break;
    if (laneSet.has(laneKey(star.id, BLACK_HOLE_ID))) continue;
    addLane(star, blackHole);
  }

  addBackboneLanes(stars, degree, laneSet, addLane);
  addHubSpokeLanes(stars, blackHole, degree, laneSet, addLane);
  addSmallWorldLanes(stars, rng, degree, laneSet, addLane);

  return { stars, blackHole, lanes };
}

function laneKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function addBackboneLanes(stars, degree, laneSet, addLane) {
  const sorted = [...stars].sort((p, q) => Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
  const step = Math.max(1, Math.floor(sorted.length / GALAXY_BACKBONE_SPOKE_COUNT));
  const spokes = [];
  for (let i = 0; i < sorted.length && spokes.length < GALAXY_BACKBONE_SPOKE_COUNT; i += step) {
    spokes.push(sorted[i]);
  }
  for (let i = 0; i < spokes.length; i++) {
    const a = spokes[i];
    const b = spokes[(i + 1) % spokes.length];
    if (degree.get(a.id) >= GALAXY_MAX_DEGREE || degree.get(b.id) >= GALAXY_MAX_DEGREE) continue;
    if (laneSet.has(laneKey(a.id, b.id))) continue;
    if (dist(a, b) > GALAXY_EXTRA_LANE_MAX_DIST * 2.5) continue;
    addLane(a, b);
  }
}

function addHubSpokeLanes(stars, blackHole, degree, laneSet, addLane) {
  const hubs = [...stars]
    .sort((p, q) => dist(p, blackHole) - dist(q, blackHole))
    .slice(0, BLACK_HOLE_MIN_LANES);
  for (let i = 0; i < hubs.length; i++) {
    const a = hubs[i];
    const b = hubs[(i + 1) % hubs.length];
    if (degree.get(a.id) >= GALAXY_MAX_DEGREE || degree.get(b.id) >= GALAXY_MAX_DEGREE) continue;
    if (laneSet.has(laneKey(a.id, b.id))) continue;
    addLane(a, b);
  }
  for (const star of stars) {
    if (hubs.some((h) => h.id === star.id)) continue;
    let best = null;
    let bestD = Infinity;
    for (const hub of hubs) {
      const d = dist(star, hub);
      if (d < bestD) {
        bestD = d;
        best = hub;
      }
    }
    if (!best) continue;
    if (degree.get(star.id) >= GALAXY_MAX_DEGREE || degree.get(best.id) >= GALAXY_MAX_DEGREE) continue;
    if (laneSet.has(laneKey(star.id, best.id))) continue;
    if (bestD > GALAXY_EXTRA_LANE_MAX_DIST * 1.5) continue;
    addLane(star, best);
  }
}

function addSmallWorldLanes(stars, rng, degree, laneSet, addLane) {
  let added = 0;
  for (let tries = 0; tries < 800 && added < GALAXY_SMALL_WORLD_LANES; tries++) {
    const a = stars[Math.floor(rng() * stars.length)];
    const b = stars[Math.floor(rng() * stars.length)];
    if (a.id === b.id) continue;
    if (degree.get(a.id) >= GALAXY_MAX_DEGREE || degree.get(b.id) >= GALAXY_MAX_DEGREE) continue;
    if (laneSet.has(laneKey(a.id, b.id))) continue;
    if (dist(a, b) > GALAXY_EXTRA_LANE_MAX_DIST * 2.2) continue;
    addLane(a, b);
    added++;
  }
}

export function galaxyNodes(galaxy) {
  return [...galaxy.stars, galaxy.blackHole];
}

export function nodeById(galaxy, id) {
  if (id === galaxy.blackHole.id) return galaxy.blackHole;
  return galaxy.stars.find((s) => s.id === id) ?? null;
}

export function neighborsOf(galaxy, id) {
  const out = [];
  for (const [a, b] of galaxy.lanes) {
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out;
}

export function laneLength(galaxy, idA, idB) {
  return dist(nodeById(galaxy, idA), nodeById(galaxy, idB));
}

export function laneIndex(galaxy, idA, idB) {
  const key = laneKey(idA, idB);
  return galaxy.lanes.findIndex(([a, b]) => laneKey(a, b) === key);
}

export function laneBulge(galaxy, idA, idB) {
  const i = laneIndex(galaxy, idA, idB);
  return i >= 0 ? 0.08 + (i % 3) * 0.03 : 0.08;
}

export function laneControlPoint(from, to, bulge) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: mx - (dy / len) * len * bulge,
    y: my + (dx / len) * len * bulge,
  };
}

export function laneBezierPoint(from, ctrl, to, t) {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
  };
}

export function laneBezierAngle(from, ctrl, to, t) {
  const dx = 2 * (1 - t) * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x);
  const dy = 2 * (1 - t) * (ctrl.y - from.y) + 2 * t * (to.y - ctrl.y);
  return Math.atan2(dy, dx);
}

export function findPath(galaxy, fromId, toId) {
  if (fromId === toId) return [fromId];
  const cameFrom = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of neighborsOf(galaxy, current)) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      if (next === toId) {
        const path = [toId];
        let node = current;
        while (node !== null) {
          path.push(node);
          node = cameFrom.get(node);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

export function graphDiameter(galaxy) {
  const ids = galaxyNodes(galaxy).map((n) => n.id);
  let maxDist = 0;
  for (const start of ids) {
    const distMap = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of neighborsOf(galaxy, cur)) {
        if (distMap.has(next)) continue;
        distMap.set(next, distMap.get(cur) + 1);
        queue.push(next);
      }
    }
    for (const d of distMap.values()) maxDist = Math.max(maxDist, d);
  }
  return maxDist;
}

export function graphStats(galaxy) {
  const nodeCount = galaxyNodes(galaxy).length;
  const avgDegree = (galaxy.lanes.length * 2) / nodeCount;
  let bhDegree = 0;
  for (const [a, b] of galaxy.lanes) {
    if (a === galaxy.blackHole.id || b === galaxy.blackHole.id) bhDegree++;
  }
  return {
    starCount: galaxy.stars.length,
    laneCount: galaxy.lanes.length,
    avgDegree,
    blackHoleDegree: bhDegree,
    diameter: graphDiameter(galaxy),
  };
}

export function galaxyGraphFingerprint(galaxy) {
  const stars = galaxy.stars.map((s) => `${s.id}:${s.x},${s.y}`).sort().join(';');
  const lanes = galaxy.lanes.map(([a, b]) => laneKey(a, b)).sort().join(';');
  let h = 2166136261;
  const str = `${stars}|${lanes}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
