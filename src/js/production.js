// Shipyard production: empire queue + multi-slot builds (Phase 5).

import {
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  SCOUT_BUILD_MS,
  SHIPYARD_COMBAT_HULLS,
} from './constants.js';
import { hullStats, hullQueueCost, shipyardStructureCost } from './hull.js';
import { getSystems } from './galaxy-scope.js';
import {
  systemById,
  findPlanet,
  hasShipyard,
  findStructure,
  isPlayerOwned,
} from './state.js';
import { allocateStructureId } from './economy.js';
import { spawnScout } from './scout.js';
import { spawnPlayerShip } from './fleets.js';
import {
  normalizeShipyardBuilds,
  completeQueueItem,
  shipyardSlots,
} from './empire-queue.js';
import { isEmpireHullUnlocked } from './tech-web.js';

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

export function canBuildShipyard(state, systemId, planetId, opts = {}) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const planet = findPlanet(state, systemId, planetId);
  if (!planet) return { ok: false, reason: 'No such planet' };
  if (planet.type === 'gas') return { ok: false, reason: 'Gas giants have no surface — orbital structures only' };
  if (planet.type === 'barren') return { ok: false, reason: 'Barren world — cannot support a shipyard (v0)' };
  if (hasShipyard(state, systemId, planetId)) return { ok: false, reason: 'Shipyard already built' };
  if (!opts.remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (!opts.ignoreCredits && state.credits < SHIPYARD_COST) return { ok: false, reason: `Need ${SHIPYARD_COST} credits` };
  return { ok: true };
}

export function buildShipyard(state, systemId, planetId, opts = {}) {
  const check = canBuildShipyard(state, systemId, planetId, opts);
  if (!check.ok) return check;

  if (!opts.alreadyPaid) state.credits -= SHIPYARD_COST;
  systemById(state, systemId).structures.push({
    id: allocateStructureId(),
    type: 'shipyard',
    bodyId: planetId,
    builtAtTime: state.time,
    builds: [],
  });
  return { ok: true };
}

function canQueueHullType(state, shipyardId, systemId, hull) {
  const stats = hullStats(hull);
  if (!stats) return { ok: false, reason: 'Unknown hull type' };
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const shipyard = findStructure(state, systemId, shipyardId);
  if (!shipyard || shipyard.type !== 'shipyard') return { ok: false, reason: 'No such shipyard' };
  normalizeShipyardBuilds(shipyard);
  const slots = shipyardSlots(state);
  if (shipyard.builds.length >= slots) return { ok: false, reason: 'Shipyard slots full' };
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct production' };
  }
  const cost = hull === 'scout' ? SCOUT_HULL_COST : stats.cost;
  if (state.credits < cost) return { ok: false, reason: `Need ${cost} credits` };
  return { ok: true, cost, buildMs: hull === 'scout' ? SCOUT_BUILD_MS : stats.buildMs };
}

export function canQueueScout(state, shipyardId, systemId) {
  return canQueueHullType(state, shipyardId, systemId, 'scout');
}

export function canQueueHull(state, shipyardId, systemId, hull) {
  if (hull === 'scout') return canQueueScout(state, shipyardId, systemId);
  if (!SHIPYARD_COMBAT_HULLS.includes(hull)) return { ok: false, reason: 'Hull not available at shipyard' };
  if (!isEmpireHullUnlocked(state, hull)) return { ok: false, reason: 'Hull not unlocked' };
  return canQueueHullType(state, shipyardId, systemId, hull);
}

export function queueScout(state, shipyardId, systemId) {
  return queueHull(state, shipyardId, systemId, 'scout');
}

/** Local shipyard queue — test/regression hook only (Phase 5). */
export function queueHull(state, shipyardId, systemId, hull) {
  const check = canQueueHull(state, shipyardId, systemId, hull);
  if (!check.ok) return check;

  const shipyard = findStructure(state, systemId, shipyardId);
  normalizeShipyardBuilds(shipyard);
  state.credits -= check.cost;
  shipyard.builds.push({
    hull,
    startedAt: state.time,
    durationMs: check.buildMs,
    queueItemId: null,
  });
  return { ok: true, hull };
}

export function shipyardBuildProgress(structure, time, buildIndex = 0) {
  normalizeShipyardBuilds(structure);
  const build = structure.builds[buildIndex];
  if (!build) return 0;
  const elapsed = time - build.startedAt;
  return Math.min(1, Math.max(0, elapsed / build.durationMs));
}

export function tickProduction(state) {
  const completed = [];
  for (const system of Object.values(getSystems(state))) {
    for (const structure of system.structures) {
      if (structure.type !== 'shipyard') continue;
      normalizeShipyardBuilds(structure);
      const remaining = [];
      for (const build of structure.builds) {
        const end = build.startedAt + build.durationMs;
        if (state.time < end) {
          remaining.push(build);
          continue;
        }
        const hull = build.hull;
        if (build.queueItemId) completeQueueItem(state, build.queueItemId);
        if (hull === 'scout') {
          const scout = spawnScout(state, system.id);
          completed.push({ systemId: system.id, hull, scoutId: scout.id, shipId: null });
        } else {
          const ship = spawnPlayerShip(state, system.id, hull, structure.bodyId);
          completed.push({ systemId: system.id, hull, scoutId: null, shipId: ship.id });
        }
      }
      structure.builds = remaining;
    }
  }
  return completed;
}

export function shipyardCount(state) {
  let count = 0;
  for (const system of Object.values(getSystems(state))) {
    count += system.structures.filter((s) => s.type === 'shipyard').length;
  }
  return count;
}

export function buildingScoutCount(state) {
  let count = 0;
  for (const system of Object.values(getSystems(state))) {
    for (const s of system.structures) {
      if (s.type !== 'shipyard') continue;
      normalizeShipyardBuilds(s);
      count += s.builds.filter((b) => b.hull === 'scout').length;
    }
  }
  return count;
}

export function activeCombatQueues(state) {
  const queues = [];
  for (const system of Object.values(getSystems(state))) {
    for (const s of system.structures) {
      if (s.type !== 'shipyard') continue;
      normalizeShipyardBuilds(s);
      s.builds.forEach((build, idx) => {
        if (build.hull === 'scout') return;
        queues.push({
          shipyardId: s.id,
          systemId: system.id,
          hull: build.hull,
          progress: shipyardBuildProgress(s, state.time, idx),
          queueItemId: build.queueItemId,
        });
      });
    }
  }
  return queues;
}

export function productionSlotSummary(state) {
  return {
    shipyardSlots: shipyardSlots(state),
    activeBuilds: activeCombatQueues(state).length + buildingScoutCount(state),
  };
}
