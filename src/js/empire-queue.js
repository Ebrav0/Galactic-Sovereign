// Empire-wide build queue + shipyard dispatcher (Phase 5, GDD §6).

import {
  EMPIRE_QUEUE_MAX,
  SHIPYARD_COMBAT_HULLS,
} from './constants.js';
import { hullStats, hullQueueCost } from './hull.js';
import { findPath, neighborsOf } from './galaxy.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import {
  findStructure,
  isPlayerOwned,
  systemById,
} from './state.js';
import { shipyardSlots as techShipyardSlots, empireQueueHulls, techEffects } from './tech-web.js';
import {
  isOperationalStructure,
  shipyardBuildTimeMultiplier,
  shipyardExtraSlots,
  structureShipBuildTimeMultiplier,
} from './body-structures.js';

export function shipyardSlots(state) {
  return techShipyardSlots(state);
}

let nextQueueId = 1;

export function resetQueueIds(state) {
  let max = 0;
  for (const item of state.empireQueue ?? []) {
    const n = parseInt(String(item.id).replace('eq-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextQueueId = max + 1;
}

function hullCost(state, hull) {
  return hullQueueCost(state, hull);
}

function hullBuildMs(hull) {
  const stats = hullStats(hull);
  if (!stats) return null;
  return stats.buildMs;
}

export function normalizeShipyardBuilds(structure) {
  if (!structure || structure.type !== 'shipyard') return;
  if (structure.build && !structure.builds) {
    structure.builds = [structure.build];
    delete structure.build;
  }
  if (!structure.builds) structure.builds = [];
}

export function migrateShipyardBuilds(state) {
  for (const system of Object.values(getSystems(state))) {
    for (const s of system.structures) {
      normalizeShipyardBuilds(s);
    }
  }
}

export function listPlayerShipyards(state) {
  const yards = [];
  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    for (const s of system.structures) {
      if (s.type !== 'shipyard' || !isOperationalStructure(state, s, {
        systemId: system.id,
        owner: 'player',
      })) continue;
      normalizeShipyardBuilds(s);
      yards.push({
        shipyardId: s.id,
        systemId: system.id,
        activeBuilds: s.builds.length,
        slots: shipyardSlots(state) + shipyardExtraSlots(s),
      });
    }
  }
  return yards;
}

export function ownedSubgraph(state) {
  const graph = getGraph(state);
  const owned = new Set();
  for (const system of Object.values(getSystems(state))) {
    if (system.owner === 'player') owned.add(system.id);
  }
  return { graph, owned };
}

export function hopCountFromStronghold(state, targetSystemId) {
  const { graph, owned } = ownedSubgraph(state);
  const fromId = state.stronghold;
  if (!owned.has(fromId) || !owned.has(targetSystemId)) return Infinity;
  if (fromId === targetSystemId) return 0;

  const cameFrom = new Map([[fromId, null]]);
  const dist = new Map([[fromId, 0]]);
  const queue = [fromId];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of neighborsOf(graph, current)) {
      if (!owned.has(next)) continue;
      if (dist.has(next)) continue;
      dist.set(next, dist.get(current) + 1);
      cameFrom.set(next, current);
      if (next === targetSystemId) return dist.get(next);
      queue.push(next);
    }
  }
  return Infinity;
}

function canBuildHullAtShipyard(state, hull, shipyardId, systemId) {
  if (!empireQueueHulls(state).includes(hull)) {
    return { ok: false, reason: 'Hull not unlocked in empire queue' };
  }
  if (hull !== 'scout' && !SHIPYARD_COMBAT_HULLS.includes(hull)) {
    return { ok: false, reason: 'Hull not available at shipyard' };
  }
  const shipyard = findStructure(state, systemId, shipyardId);
  if (!shipyard || shipyard.type !== 'shipyard' || !isOperationalStructure(state, shipyard, {
    systemId,
    owner: 'player',
  })) {
    return { ok: false, reason: 'No operational shipyard at that system' };
  }
  normalizeShipyardBuilds(shipyard);
  const slots = shipyardSlots(state) + shipyardExtraSlots(shipyard);
  if (shipyard.builds.length >= slots) {
    return { ok: false, reason: 'Shipyard slots full' };
  }
  return { ok: true };
}

export function enqueueHull(state, hull) {
  if (listPlayerShipyards(state).length === 0) {
    return { ok: false, reason: 'No shipyard built yet' };
  }
  if (!empireQueueHulls(state).includes(hull)) {
    return { ok: false, reason: 'Hull not unlocked in empire queue' };
  }
  const cost = hullCost(state, hull);
  const buildMs = hullBuildMs(hull);
  if (cost == null || buildMs == null) return { ok: false, reason: 'Unknown hull type' };

  if (!state.empireQueue) state.empireQueue = [];
  const pending = state.empireQueue.filter((q) => q.status === 'pending' || q.status === 'building');
  if (pending.length >= EMPIRE_QUEUE_MAX) {
    return { ok: false, reason: `Empire queue full (max ${EMPIRE_QUEUE_MAX})` };
  }
  if (state.credits < cost) return { ok: false, reason: `Need ${cost} credits` };

  state.credits -= cost;
  const item = {
    id: `eq-${nextQueueId++}`,
    hull,
    pinnedShipyardId: null,
    assignedShipyardId: null,
    assignedSystemId: null,
    enqueuedAt: state.time,
    status: 'pending',
    costPaid: cost,
  };
  state.empireQueue.push(item);
  return { ok: true, item };
}

export function cancelQueueItem(state, queueId) {
  const item = state.empireQueue?.find((q) => q.id === queueId);
  if (!item) return { ok: false, reason: 'No such queue item' };
  if (item.status === 'building') {
    return { ok: false, reason: 'Cannot cancel — build already started' };
  }
  if (item.status !== 'pending') return { ok: false, reason: 'Item not cancellable' };

  state.credits += item.costPaid ?? 0;
  state.empireQueue = state.empireQueue.filter((q) => q.id !== queueId);
  return { ok: true, refunded: item.costPaid ?? 0 };
}

export function pinQueueItem(state, queueId, shipyardId) {
  const item = state.empireQueue?.find((q) => q.id === queueId);
  if (!item) return { ok: false, reason: 'No such queue item' };
  if (item.status !== 'pending') return { ok: false, reason: 'Can only pin pending items' };

  if (shipyardId) {
    let found = false;
    for (const yard of listPlayerShipyards(state)) {
      if (yard.shipyardId === shipyardId) { found = true; break; }
    }
    if (!found) return { ok: false, reason: 'Shipyard not found in owned systems' };
  }

  item.pinnedShipyardId = shipyardId;
  return { ok: true };
}

export function reorderQueueItem(state, queueId, newIndex) {
  const pending = state.empireQueue.filter((q) => q.status === 'pending');
  const idx = pending.findIndex((q) => q.id === queueId);
  if (idx < 0) return { ok: false, reason: 'Pending item not found' };
  const clamped = Math.max(0, Math.min(newIndex, pending.length - 1));
  const [item] = pending.splice(idx, 1);
  pending.splice(clamped, 0, item);
  const others = state.empireQueue.filter((q) => q.status !== 'pending');
  state.empireQueue = [...pending, ...others.filter((q) => q.status === 'building')];
  return { ok: true };
}

function candidateShipyards(state, item) {
  const yards = listPlayerShipyards(state).filter((y) => y.activeBuilds < y.slots);
  if (item.pinnedShipyardId) {
    return yards.filter((y) => y.shipyardId === item.pinnedShipyardId);
  }
  return yards.sort((a, b) => {
    const hopA = hopCountFromStronghold(state, a.systemId);
    const hopB = hopCountFromStronghold(state, b.systemId);
    if (hopA !== hopB) return hopA - hopB;
    const queueA = a.activeBuilds;
    const queueB = b.activeBuilds;
    if (queueA !== queueB) return queueA - queueB;
    return a.shipyardId.localeCompare(b.shipyardId);
  });
}

export function dispatchEmpireQueue(state) {
  if (state.paused) return [];
  const assigned = [];
  migrateShipyardBuilds(state);

  const pending = state.empireQueue.filter((q) => q.status === 'pending');
  for (const item of pending) {
    const candidates = candidateShipyards(state, item);
    for (const yard of candidates) {
      const check = canBuildHullAtShipyard(state, item.hull, yard.shipyardId, yard.systemId);
      if (!check.ok) continue;

      const shipyard = findStructure(state, yard.systemId, yard.shipyardId);
      normalizeShipyardBuilds(shipyard);
      const buildMs = Math.max(1, Math.round(
        hullBuildMs(item.hull)
          * shipyardBuildTimeMultiplier(shipyard)
          * structureShipBuildTimeMultiplier(state, yard.systemId)
          / Math.max(0.1, techEffects(state).shipBuildSpeedMult),
      ));
      shipyard.builds.push({
        hull: item.hull,
        startedAt: state.time,
        durationMs: buildMs,
        queueItemId: item.id,
      });
      item.status = 'building';
      item.assignedShipyardId = yard.shipyardId;
      item.assignedSystemId = yard.systemId;
      assigned.push({ queueId: item.id, shipyardId: yard.shipyardId, systemId: yard.systemId });
      break;
    }
  }
  return assigned;
}

export function completeQueueItem(state, queueItemId) {
  const item = state.empireQueue?.find((q) => q.id === queueItemId);
  if (!item) return null;
  item.status = 'complete';
  state.empireQueue = state.empireQueue.filter((q) => q.status !== 'complete');
  return item;
}

export function empireQueueSummary(state) {
  return (state.empireQueue ?? []).map((q) => ({
    id: q.id,
    hull: q.hull,
    status: q.status,
    pinnedShipyardId: q.pinnedShipyardId,
    assignedShipyardId: q.assignedShipyardId,
    assignedSystemId: q.assignedSystemId,
    enqueuedAt: q.enqueuedAt,
  }));
}

export function findQueueItemForBuild(structure, buildJob) {
  return buildJob?.queueItemId ?? null;
}
