// Shipyard production: empire queue + multi-slot builds (Phase 5).

import {
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  SCOUT_BUILD_MS,
  SHIPYARD_COMBAT_HULLS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import { applyVeterancy, hullStats, hullQueueCost, shipyardStructureCost } from './hull.js';
import { getSystems } from './galaxy-scope.js';
import {
  systemById,
  findPlanet,
  hasShipyard,
  findStructure,
  isPlayerOwned,
  pendingStructureOnBody,
} from './state.js';
import { allocateStructureId } from './economy.js';
import { spawnScout } from './scout.js';
import { spawnPlayerShip } from './fleets.js';
import {
  normalizeShipyardBuilds,
  completeQueueItem,
  shipyardSlots,
} from './empire-queue.js';
import { flagshipInSystem } from './flagship-presence.js';
import { hasPendingJob, queueConstructionJob } from './drones.js';
import { isEmpireHullUnlocked, techEffects } from './tech-web.js';
import {
  isOperationalStructure,
  shipyardBuildTimeMultiplier,
  shipyardExtraSlots,
  structureEffectValue,
  structureShipBuildTimeMultiplier,
} from './body-structures.js';
import { recordBulkShipCompletion } from './bulk-production.js';
import { spawnBuilderDrone } from './builder-drones.js';
import {
  PRODUCTION_KIND_BUILDER_DRONE,
  normalizeProductionProduct,
} from './production-products.js';
import { requireTutorialAccess, tutorialDurationMs } from './tutorial-access.js';

export function canBuildShipyard(state, systemId, planetId, opts = {}) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const planet = findPlanet(state, systemId, planetId);
  if (!planet) return { ok: false, reason: 'No such planet' };
  if (planet.type === 'gas') return { ok: false, reason: 'Gas giants have no surface — orbital structures only' };
  if (planet.type === 'barren') return { ok: false, reason: 'Barren world — cannot support a shipyard (v0)' };
  if (hasShipyard(state, systemId, planetId)) return { ok: false, reason: 'Shipyard already built' };
  if (pendingStructureOnBody(state, systemId, planetId, 'shipyard')) {
    return { ok: false, reason: 'Shipyard construction already in progress' };
  }
  if (hasPendingJob(state, systemId, planetId, 'shipyard')) {
    return { ok: false, reason: 'Shipyard construction already in progress' };
  }
  if (!opts.remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  const cost = shipyardStructureCost(state);
  if (!opts.ignoreCredits && state.credits < cost) return { ok: false, reason: `Need ${cost} credits` };
  return { ok: true, cost };
}

export function buildShipyard(state, systemId, planetId, opts = {}) {
  const tutorial = requireTutorialAccess(state, 'shipyard', { bypass: opts.tutorialBypass });
  if (!tutorial.ok) return tutorial;
  const check = canBuildShipyard(state, systemId, planetId, opts);
  if (!check.ok) return check;

  if (!opts.remote) {
    return queueConstructionJob(state, {
      systemId,
      structureType: 'shipyard',
      bodyId: planetId,
      creditCost: check.cost,
      durationMs: STRUCTURE_BUILD_MS.shipyard,
      extraStructureFields: { builds: [] },
    });
  }

  if (!opts.alreadyPaid) state.credits -= check.cost;
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
  if (!shipyard || shipyard.type !== 'shipyard' || !isOperationalStructure(state, shipyard, {
    systemId,
    owner: 'player',
  })) {
    return { ok: false, reason: 'No operational shipyard in this system' };
  }
  normalizeShipyardBuilds(shipyard);
  const slots = shipyardSlots(state) + shipyardExtraSlots(shipyard);
  if (shipyard.builds.length >= slots) return { ok: false, reason: 'Shipyard slots full' };
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct production' };
  }
  const cost = hull === 'scout' ? SCOUT_HULL_COST : stats.cost;
  if (state.credits < cost) return { ok: false, reason: `Need ${cost} credits` };
  const baseBuildMs = hull === 'scout' ? SCOUT_BUILD_MS : stats.buildMs;
  const buildMs = tutorialDurationMs(state, Math.max(1, Math.round(
    baseBuildMs
      * shipyardBuildTimeMultiplier(shipyard)
      * structureShipBuildTimeMultiplier(state, systemId)
      / Math.max(0.1, techEffects(state).shipBuildSpeedMult),
  )), 'production');
  return { ok: true, cost, buildMs };
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
  const tutorial = requireTutorialAccess(state, hull === 'scout' ? 'scout_queue' : 'combat_ship_queue');
  if (!tutorial.ok) return tutorial;
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
      if (structure.type !== 'shipyard' || !isOperationalStructure(state, structure, {
        systemId: system.id,
        owner: 'player',
      })) continue;
      normalizeShipyardBuilds(structure);
      const remaining = [];
      for (const build of structure.builds) {
        const end = build.startedAt + build.durationMs;
        if (state.time < end) {
          remaining.push(build);
          continue;
        }
        const product = normalizeProductionProduct(build);
        const hull = product.hull;
        const queueItem = build.queueItemId
          ? completeQueueItem(state, build.queueItemId)
          : null;
        if (product.kind === PRODUCTION_KIND_BUILDER_DRONE) {
          const spawned = spawnBuilderDrone(state, system.id, {
            homeSystemId: system.id,
            strategicCampaignId: queueItem?.linkedCampaignId ?? null,
          });
          const completion = {
            systemId: system.id,
            kind: product.kind,
            productId: product.productId,
            hull: null,
            droneId: spawned.ok ? spawned.drone.id : null,
            shipId: null,
            scoutId: null,
            queueItemId: queueItem?.id ?? build.queueItemId ?? null,
            queueItem,
          };
          if (queueItem?.bulkOrderId) recordBulkShipCompletion(state, completion, null, spawned.drone ?? null);
          completed.push(completion);
        } else if (hull === 'scout') {
          const scout = spawnScout(state, system.id);
          const completion = {
            systemId: system.id,
            hull,
            scoutId: scout.id,
            shipId: null,
            queueItemId: queueItem?.id ?? build.queueItemId ?? null,
            queueItem,
          };
          if (queueItem?.bulkOrderId) recordBulkShipCompletion(state, completion);
          completed.push(completion);
        } else {
          const ship = spawnPlayerShip(state, system.id, hull, structure.bodyId);
          const startingVeterancy = structureEffectValue(
            state,
            system.id,
            'startingVeterancy',
            { base: 0, op: 'max' },
          );
          if (startingVeterancy > 0) applyVeterancy(ship, startingVeterancy);
          const completion = {
            systemId: system.id,
            hull,
            scoutId: null,
            shipId: ship.id,
            queueItemId: queueItem?.id ?? build.queueItemId ?? null,
            queueItem,
          };
          if (queueItem?.bulkOrderId) recordBulkShipCompletion(state, completion, ship);
          completed.push(completion);
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
    count += system.structures.filter((s) => s.type === 'shipyard' && isOperationalStructure(state, s, {
      systemId: system.id,
      owner: 'player',
    })).length;
  }
  return count;
}

export function buildingScoutCount(state) {
  let count = 0;
  for (const system of Object.values(getSystems(state))) {
    for (const s of system.structures) {
      if (s.type !== 'shipyard' || !isOperationalStructure(state, s, {
        systemId: system.id,
        owner: 'player',
      })) continue;
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
      if (s.type !== 'shipyard' || !isOperationalStructure(state, s, {
        systemId: system.id,
        owner: 'player',
      })) continue;
      normalizeShipyardBuilds(s);
      s.builds.forEach((build, idx) => {
        const product = normalizeProductionProduct(build);
        if (product.hull === 'scout' || product.kind === PRODUCTION_KIND_BUILDER_DRONE) return;
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
  const yards = listPlayerShipyardSlotCounts(state);
  return {
    shipyardSlots: shipyardSlots(state),
    totalShipyardSlots: yards.reduce((total, yard) => total + yard.slots, 0),
    activeBuilds: activeCombatQueues(state).length + buildingScoutCount(state),
  };
}

function listPlayerShipyardSlotCounts(state) {
  const rows = [];
  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    for (const structure of system.structures ?? []) {
      if (structure.type !== 'shipyard' || !isOperationalStructure(state, structure, {
        systemId: system.id,
        owner: 'player',
      })) continue;
      rows.push({
        id: structure.id,
        slots: shipyardSlots(state) + shipyardExtraSlots(structure),
      });
    }
  }
  return rows;
}
