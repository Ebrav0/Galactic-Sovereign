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
  BLACK_HOLE_MIN_LANES,
} from './constants.js';

export const BLACK_HOLE_ID = 'core';

const STAR_NAMES = [
  'Aldrin', 'Beryl', 'Cassia', 'Dorado', 'Eventide', 'Farholm',
  'Gilead', 'Halcyon', 'Iskra', 'Jorvik', 'Kestrel', 'Lumen',
  'Meridian', 'Nadir', 'Ophira', 'Praxis', 'Quorra', 'Rythar',
  'Sable', 'Talos', 'Umbriel', 'Vesper', 'Wren', 'Ythaca',
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// --- Generation ---

// Returns { stars: [{id, name, x, y}], blackHole: {id, name, x, y}, lanes: [[idA, idB]] }.
// Everything derives from the passed rng; iteration order is fixed, so the same
// seed always yields the same graph (GDD §15 determinism requirement).
export function generateGalaxy(rng) {
  const stars = [];
  for (let i = 0; i < GALAXY_STAR_COUNT; i++) {
    let x = 0;
    let y = 0;
    // Rejection-sample positions; relax spacing if a pocket gets crowded.
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
      name: STAR_NAMES[i % STAR_NAMES.length],
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  const blackHole = { id: BLACK_HOLE_ID, name: 'Galactic Core', x: 0, y: 0 };
  const nodes = [...stars, blackHole];

  // Minimum spanning tree (Prim) guarantees a connected lane graph.
  const lanes = [];
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  const inTree = new Set([nodes[0].id]);
  while (inTree.size < nodes.length) {
    let best = null;
    for (const from of nodes) {
      if (!inTree.has(from.id)) continue;
      for (const to of nodes) {
        if (inTree.has(to.id)) continue;
        const d = dist(from, to);
        if (!best || d < best.d) best = { from, to, d };
      }
    }
    lanes.push([best.from.id, best.to.id]);
    degree.set(best.from.id, degree.get(best.from.id) + 1);
    degree.set(best.to.id, degree.get(best.to.id) + 1);
    inTree.add(best.to.id);
  }

  const laneSet = new Set(lanes.map(([a, b]) => laneKey(a, b)));
  const addLane = (a, b) => {
    lanes.push([a.id, b.id]);
    laneSet.add(laneKey(a.id, b.id));
    degree.set(a.id, degree.get(a.id) + 1);
    degree.set(b.id, degree.get(b.id) + 1);
  };

  // Extra short lanes until the average degree approaches the target,
  // producing loops and chokepoints instead of a pure tree.
  const candidates = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = dist(nodes[i], nodes[j]);
      if (d <= GALAXY_EXTRA_LANE_MAX_DIST) candidates.push({ a: nodes[i], b: nodes[j], d });
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

  // The black hole must be a real waypoint: connect its nearest stars until
  // it has at least BLACK_HOLE_MIN_LANES.
  const nearest = [...stars].sort((p, q) => dist(p, blackHole) - dist(q, blackHole));
  for (const star of nearest) {
    if (degree.get(BLACK_HOLE_ID) >= BLACK_HOLE_MIN_LANES) break;
    if (laneSet.has(laneKey(star.id, BLACK_HOLE_ID))) continue;
    addLane(star, blackHole);
  }

  return { stars, blackHole, lanes };
}

function laneKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// --- Graph helpers ---

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

// --- Lane curve geometry (world space, shared by transit + render) ---

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

// BFS shortest hop path, inclusive of both endpoints. Returns null if unreachable.
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
