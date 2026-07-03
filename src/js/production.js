// Shipyard production: scout + combat hull queues (Phase 1.5b + 2.2).

import {
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  SCOUT_BUILD_MS,
  SHIPYARD_COMBAT_HULLS,
} from './constants.js';
import { hullStats } from './hull.js';
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

function flagshipInSystem(state, systemId) {
  return state.flagship.systemId === systemId && !state.flagship.transit;
}

export function canBuildShipyard(state, systemId, planetId) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const planet = findPlanet(state, systemId, planetId);
  if (!planet) return { ok: false, reason: 'No such planet' };
  if (planet.type === 'gas') return { ok: false, reason: 'Gas giants have no surface — orbital structures only' };
  if (planet.type === 'barren') return { ok: false, reason: 'Barren world — cannot support a shipyard (v0)' };
  if (hasShipyard(state, systemId, planetId)) return { ok: false, reason: 'Shipyard already built' };
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < SHIPYARD_COST) return { ok: false, reason: `Need ${SHIPYARD_COST} credits` };
  return { ok: true };
}

export function buildShipyard(state, systemId, planetId) {
  const check = canBuildShipyard(state, systemId, planetId);
  if (!check.ok) return check;

  state.credits -= SHIPYARD_COST;
  systemById(state, systemId).structures.push({
    id: allocateStructureId(),
    type: 'shipyard',
    bodyId: planetId,
    builtAtTime: state.time,
    build: null,
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
  if (shipyard.build) return { ok: false, reason: 'Shipyard is already building' };
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
  return canQueueHullType(state, shipyardId, systemId, hull);
}

export function queueScout(state, shipyardId, systemId) {
  return queueHull(state, shipyardId, systemId, 'scout');
}

export function queueHull(state, shipyardId, systemId, hull) {
  const check = canQueueHull(state, shipyardId, systemId, hull);
  if (!check.ok) return check;

  const shipyard = findStructure(state, systemId, shipyardId);
  state.credits -= check.cost;
  shipyard.build = {
    hull,
    startedAt: state.time,
    durationMs: check.buildMs,
  };
  return { ok: true, hull };
}

export function shipyardBuildProgress(structure, time) {
  if (!structure?.build) return 0;
  const elapsed = time - structure.build.startedAt;
  return Math.min(1, Math.max(0, elapsed / structure.build.durationMs));
}

export function tickProduction(state) {
  const completed = [];
  for (const system of Object.values(state.systems)) {
    for (const structure of system.structures) {
      if (structure.type !== 'shipyard' || !structure.build) continue;
      const end = structure.build.startedAt + structure.build.durationMs;
      if (state.time < end) continue;
      const hull = structure.build.hull;
      structure.build = null;
      if (hull === 'scout') {
        const scout = spawnScout(state, system.id);
        completed.push({ systemId: system.id, hull, scoutId: scout.id, shipId: null });
      } else {
        const ship = spawnPlayerShip(state, system.id, hull, structure.bodyId);
        completed.push({ systemId: system.id, hull, scoutId: null, shipId: ship.id });
      }
    }
  }
  return completed;
}

export function shipyardCount(state) {
  let count = 0;
  for (const system of Object.values(state.systems)) {
    count += system.structures.filter((s) => s.type === 'shipyard').length;
  }
  return count;
}

export function buildingScoutCount(state) {
  let count = 0;
  for (const system of Object.values(state.systems)) {
    for (const s of system.structures) {
      if (s.type === 'shipyard' && s.build) count += 1;
    }
  }
  return count;
}

export function activeCombatQueues(state) {
  const queues = [];
  for (const system of Object.values(state.systems)) {
    for (const s of system.structures) {
      if (s.type === 'shipyard' && s.build && s.build.hull !== 'scout') {
        queues.push({
          shipyardId: s.id,
          systemId: system.id,
          hull: s.build.hull,
          progress: shipyardBuildProgress(s, state.time),
        });
      }
    }
  }
  return queues;
}
