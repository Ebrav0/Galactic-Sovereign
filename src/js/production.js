// Shipyard production: local 1-slot queue, scout hulls only (Phase 1.5b).

import {
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  SCOUT_BUILD_MS,
} from './constants.js';
import {
  systemById,
  findPlanet,
  hasShipyard,
  findStructure,
  isPlayerOwned,
} from './state.js';
import { allocateStructureId } from './economy.js';
import { spawnScout } from './scout.js';

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

export function canQueueScout(state, shipyardId, systemId) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const shipyard = findStructure(state, systemId, shipyardId);
  if (!shipyard || shipyard.type !== 'shipyard') return { ok: false, reason: 'No such shipyard' };
  if (shipyard.build) return { ok: false, reason: 'Shipyard is already building' };
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct production' };
  }
  if (state.credits < SCOUT_HULL_COST) return { ok: false, reason: `Need ${SCOUT_HULL_COST} credits` };
  return { ok: true };
}

export function queueScout(state, shipyardId, systemId) {
  const check = canQueueScout(state, shipyardId, systemId);
  if (!check.ok) return check;

  const shipyard = findStructure(state, systemId, shipyardId);
  state.credits -= SCOUT_HULL_COST;
  shipyard.build = {
    hull: 'scout',
    startedAt: state.time,
    durationMs: SCOUT_BUILD_MS,
  };
  return { ok: true };
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
      structure.build = null;
      const scout = spawnScout(state, system.id);
      completed.push({ systemId: system.id, scoutId: scout.id });
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
