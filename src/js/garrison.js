// Neutral garrison seeding + defender counts (GDD §9, Phase 2).

import {
  GARRISON_BASE,
  GARRISON_PER_PLANET,
  GARRISON_PER_STRUCTURE,
  GARRISON_MAX_UNITS,
} from './constants.js';
import { createRng } from './state.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { hullStats } from './hulls.js';

const GARRISON_HULLS = ['corvette', 'frigate', 'destroyer'];

function garrisonStrength(system) {
  let strength = GARRISON_BASE;
  strength += system.bodies.length * GARRISON_PER_PLANET;
  strength += system.structures.length * GARRISON_PER_STRUCTURE;
  return Math.min(GARRISON_MAX_UNITS, Math.ceil(strength));
}

function pickGarrisonComposition(rng, strength) {
  const entries = [];
  let remaining = strength;
  while (remaining > 0) {
    const hull = GARRISON_HULLS[Math.floor(rng() * GARRISON_HULLS.length)];
    const count = Math.min(remaining, 1 + Math.floor(rng() * 2));
    const existing = entries.find((e) => e.hull === hull);
    if (existing) existing.count += count;
    else entries.push({ hull, count });
    remaining -= count;
  }
  return entries;
}

export function seedGarrisonForSystem(rng, system, { isHome }) {
  if (isHome || system.id === BLACK_HOLE_ID) return [];
  const strength = garrisonStrength(system);
  if (strength <= 0) return [];
  return pickGarrisonComposition(rng, strength);
}

export function seedGarrisonsForGalaxy(state) {
  const seed = state.meta.seed;
  state.garrisons = state.garrisons ?? {};
  for (let i = 0; i < state.galaxy.stars.length; i++) {
    const star = state.galaxy.stars[i];
    if (star.id === state.stronghold) {
      delete state.garrisons[star.id];
      continue;
    }
    const sysRng = createRng((seed + (i + 1) * 0x9e3779b9 + 0x676172) >>> 0);
    const system = state.systems[star.id];
    if (system.owner === 'player') {
      delete state.garrisons[star.id];
      continue;
    }
    state.garrisons[star.id] = seedGarrisonForSystem(sysRng, system, { isHome: false });
  }
}

export function getGarrison(state, systemId) {
  return state.garrisons?.[systemId] ?? [];
}

export function garrisonUnitCount(state, systemId) {
  return getGarrison(state, systemId).reduce((n, e) => n + e.count, 0);
}

export function garrisonCaptureWeight(state, systemId) {
  return getGarrison(state, systemId).reduce((n, e) => {
    const force = hullStats(e.hull)?.captureForce ?? 1;
    return n + e.count * force * 0.5;
  }, 0);
}

export function garrisonSummary(state, systemId) {
  const g = getGarrison(state, systemId);
  return {
    unitCount: g.reduce((n, e) => n + e.count, 0),
    composition: g.map((e) => ({ hull: e.hull, count: e.count })),
  };
}

export function applyGarrisonCasualties(state, systemId, casualtiesByHull) {
  const g = getGarrison(state, systemId);
  if (!g.length) return;
  for (const [hull, lost] of Object.entries(casualtiesByHull)) {
    let remaining = lost;
    for (const entry of g) {
      if (entry.hull !== hull || remaining <= 0) continue;
      const take = Math.min(entry.count, remaining);
      entry.count -= take;
      remaining -= take;
    }
  }
  state.garrisons[systemId] = g.filter((e) => e.count > 0);
  if (state.garrisons[systemId].length === 0) delete state.garrisons[systemId];
}

export function expandGarrisonToUnits(garrison, entryVector, startId = 1) {
  const units = [];
  let idx = startId;
  const baseAngle = Math.atan2(entryVector.y, entryVector.x);
  for (const entry of garrison) {
    for (let i = 0; i < entry.count; i++) {
      const stats = hullStats(entry.hull);
      const spread = (i - entry.count / 2) * 0.15;
      const angle = baseAngle + spread;
      const dist = 320 + (idx % 5) * 18;
      units.push({
        id: `gu${idx++}`,
        side: 'enemy',
        refId: `garrison:${entry.hull}:${i}`,
        hull: entry.hull,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        hp: stats.hp,
        maxHp: stats.hp,
        targetId: null,
      });
    }
  }
  return units;
}

export function garrisonHasCombatPresence(state, systemId) {
  return garrisonUnitCount(state, systemId) > 0;
}
