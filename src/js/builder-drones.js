// Reusable flagship-launched builder drones for remote construction.

import {
  OUTPOST_COST,
  SHIPYARD_COST,
  BUILDER_DRONE_CAPACITY,
  BUILDER_DRONE_DEPLOY_COST,
  BUILDER_DRONE_LANE_SPEED,
  BUILDER_DRONE_LANE_MIN_LEG_MS,
  BUILDER_DRONE_BUILD_TIME_MULT,
  BUILDER_DRONE_OUTPOST_BUILD_MS,
  BUILDER_DRONE_SHIPYARD_BUILD_MS,
  BUILDER_DRONE_BODY_STRUCTURE_BUILD_MS,
  TICK_MS,
} from './constants.js';
import { buildOutpost, canBuildOutpost } from './economy.js';
import { buildShipyard, canBuildShipyard } from './production.js';
import {
  BODY_STRUCTURE_DEFS,
  bodyStructureDef,
  buildBodyStructure,
  canBuildBodyStructure,
} from './body-structures.js';
import { findPath } from './galaxy.js';
import { getGraph } from './galaxy-scope.js';
import { systemById } from './state.js';
import { techEffects } from './tech-web.js';
import {
  advanceTransit,
  transitEtaMs,
  transitStatus,
} from './transit.js';

let nextBuilderDroneId = 1;

function droneTechUnlocked(state) {
  return !!techEffects(state).unlockBuilderShip;
}

function activeGalaxyDrones(state) {
  return (state.builderDrones ?? []).filter((d) => d.galaxyId === state.activeGalaxyId);
}

function flagshipCanLaunch(state) {
  const f = state.flagship;
  if (!f || f.galaxyId !== state.activeGalaxyId) return false;
  if (!f.systemId || f.transit || f.wormholeTransit) return false;
  if (f.hp != null && f.hp <= 0) return false;
  return true;
}

function makeIdleDrone(state) {
  return {
    id: `bd-${nextBuilderDroneId++}`,
    galaxyId: state.activeGalaxyId,
    status: 'idle',
    systemId: state.flagship?.systemId ?? state.stronghold,
    targetSystemId: null,
    targetBodyId: null,
    buildType: null,
    transit: null,
    buildStartedAt: null,
    buildDurationMs: null,
    returnTransit: null,
    costPaid: 0,
    lastError: null,
  };
}

export function resetBuilderDroneIds(state) {
  let max = 0;
  for (const drone of state.builderDrones ?? []) {
    const n = parseInt(String(drone.id).replace('bd-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextBuilderDroneId = max + 1;
}

export function initBuilderDrones(state) {
  if (!state.builderDrones) state.builderDrones = [];
  for (const drone of state.builderDrones) {
    drone.status = drone.status ?? 'idle';
    drone.galaxyId = drone.galaxyId ?? state.activeGalaxyId ?? 'gal-0';
    drone.systemId = drone.systemId ?? null;
    drone.targetSystemId = drone.targetSystemId ?? null;
    drone.targetBodyId = drone.targetBodyId ?? null;
    drone.buildType = drone.buildType ?? null;
    drone.transit = drone.transit ?? null;
    drone.buildStartedAt = drone.buildStartedAt ?? null;
    drone.buildDurationMs = drone.buildDurationMs ?? null;
    drone.returnTransit = drone.returnTransit ?? null;
    drone.costPaid = drone.costPaid ?? 0;
    drone.lastError = drone.lastError ?? null;
  }

  if (!droneTechUnlocked(state) || !flagshipCanLaunch(state)) return state.builderDrones;
  const current = activeGalaxyDrones(state).length;
  for (let i = current; i < BUILDER_DRONE_CAPACITY; i++) {
    state.builderDrones.push(makeIdleDrone(state));
  }
  return state.builderDrones;
}

function idleDrone(state) {
  return activeGalaxyDrones(state).find((d) => d.status === 'idle') ?? null;
}

function buildCost(type) {
  if (type === 'outpost') return OUTPOST_COST;
  if (type === 'shipyard') return SHIPYARD_COST;
  return bodyStructureDef(type)?.cost ?? null;
}

function buildDuration(type) {
  if (type === 'outpost') return Math.round(BUILDER_DRONE_OUTPOST_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  if (type === 'shipyard') return Math.round(BUILDER_DRONE_SHIPYARD_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  if (BODY_STRUCTURE_DEFS[type]) return Math.round(BUILDER_DRONE_BODY_STRUCTURE_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  return null;
}

function canBuildTarget(state, systemId, bodyId, type) {
  if (type === 'outpost') return canBuildOutpost(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (type === 'shipyard') return canBuildShipyard(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (BODY_STRUCTURE_DEFS[type]) {
    return canBuildBodyStructure(state, systemId, bodyId, type, { remote: true, ignoreCredits: true });
  }
  return { ok: false, reason: 'Unknown drone build type' };
}

function completeBuildTarget(state, drone) {
  const { targetSystemId, targetBodyId, buildType } = drone;
  if (buildType === 'outpost') {
    return buildOutpost(state, targetSystemId, targetBodyId, { remote: true, alreadyPaid: true, ignoreCredits: true });
  }
  if (buildType === 'shipyard') {
    return buildShipyard(state, targetSystemId, targetBodyId, { remote: true, alreadyPaid: true, ignoreCredits: true });
  }
  return buildBodyStructure(
    state,
    targetSystemId,
    targetBodyId,
    buildType,
    { remote: true, alreadyPaid: true, ignoreCredits: true },
  );
}

function makeTransit(state, fromId, targetId) {
  const galaxy = getGraph(state);
  const path = findPath(galaxy, fromId, targetId);
  if (!path || path.length < 2) return null;
  const durationMs = (a, b) =>
    Math.max(BUILDER_DRONE_LANE_MIN_LEG_MS, Math.round((Math.hypot(
      (nodePos(galaxy, a)?.x ?? 0) - (nodePos(galaxy, b)?.x ?? 0),
      (nodePos(galaxy, a)?.y ?? 0) - (nodePos(galaxy, b)?.y ?? 0),
    ) / BUILDER_DRONE_LANE_SPEED) * 1000));
  return {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: durationMs(path[0], path[1]),
  };
}

function nodePos(galaxy, id) {
  if (id === galaxy.blackHole.id) return galaxy.blackHole;
  return galaxy.stars.find((s) => s.id === id);
}

export function builderDroneEtaMs(state, drone) {
  const transit = drone.status === 'returning' ? drone.returnTransit : drone.transit;
  return transitEtaMs(
    transit,
    getGraph(state),
    state.time,
    BUILDER_DRONE_LANE_SPEED,
    BUILDER_DRONE_LANE_MIN_LEG_MS,
  );
}

export function canSendBuilderDrone(state, systemId, bodyId, buildType) {
  initBuilderDrones(state);
  if (!droneTechUnlocked(state)) return { ok: false, reason: 'Research Builder Drones first' };
  if (!flagshipCanLaunch(state)) return { ok: false, reason: 'Flagship must be idle in this galaxy to launch drones' };
  const targetSystem = systemById(state, systemId);
  if (!targetSystem) return { ok: false, reason: 'No such system' };
  const drone = idleDrone(state);
  if (!drone) return { ok: false, reason: 'No idle builder drone available' };
  const targetCheck = canBuildTarget(state, systemId, bodyId, buildType);
  if (!targetCheck.ok) return targetCheck;
  const cost = buildCost(buildType);
  const durationMs = buildDuration(buildType);
  if (cost == null || durationMs == null) return { ok: false, reason: 'Unknown drone build type' };
  const totalCost = cost + BUILDER_DRONE_DEPLOY_COST;
  if (state.credits < totalCost) return { ok: false, reason: `Need ${totalCost} credits` };
  if (state.flagship.systemId !== systemId && !makeTransit(state, state.flagship.systemId, systemId)) {
    return { ok: false, reason: 'No lane route to target system' };
  }
  return { ok: true, droneId: drone.id, cost, fee: BUILDER_DRONE_DEPLOY_COST, totalCost, durationMs };
}

export function sendBuilderDrone(state, systemId, bodyId, buildType) {
  const check = canSendBuilderDrone(state, systemId, bodyId, buildType);
  if (!check.ok) return check;
  const drone = idleDrone(state);
  const fromId = state.flagship.systemId;
  state.credits -= check.totalCost;
  drone.status = fromId === systemId ? 'building' : 'outbound';
  drone.systemId = fromId === systemId ? systemId : null;
  drone.targetSystemId = systemId;
  drone.targetBodyId = bodyId;
  drone.buildType = buildType;
  drone.transit = fromId === systemId ? null : makeTransit(state, fromId, systemId);
  drone.buildStartedAt = fromId === systemId ? state.time : null;
  drone.buildDurationMs = check.durationMs;
  drone.returnTransit = null;
  drone.costPaid = check.totalCost;
  drone.lastError = null;
  return { ok: true, droneId: drone.id, systemId, bodyId, buildType, etaMs: builderDroneEtaMs(state, drone) };
}

export function cancelBuilderDrone(state, droneId) {
  initBuilderDrones(state);
  const drone = state.builderDrones.find((d) => d.id === droneId);
  if (!drone) return { ok: false, reason: 'No such builder drone' };
  if (drone.status === 'building') return { ok: false, reason: 'Drone is already building' };
  if (drone.status === 'idle') return { ok: true };
  drone.status = 'idle';
  drone.systemId = state.flagship?.systemId ?? drone.systemId;
  drone.targetSystemId = null;
  drone.targetBodyId = null;
  drone.buildType = null;
  drone.transit = null;
  drone.buildStartedAt = null;
  drone.buildDurationMs = null;
  drone.returnTransit = null;
  drone.lastError = 'cancelled';
  return { ok: true };
}

function beginReturn(state, drone) {
  const targetId = drone.targetSystemId;
  const flagshipSystem = state.flagship?.systemId;
  drone.targetSystemId = null;
  drone.targetBodyId = null;
  drone.buildType = null;
  drone.transit = null;
  drone.buildStartedAt = null;
  drone.buildDurationMs = null;
  if (flagshipSystem && targetId && flagshipSystem !== targetId) {
    const ret = makeTransit(state, targetId, flagshipSystem);
    if (ret) {
      drone.status = 'returning';
      drone.systemId = null;
      drone.returnTransit = ret;
      return;
    }
  }
  drone.status = 'idle';
  drone.systemId = targetId ?? flagshipSystem ?? null;
  drone.returnTransit = null;
}

export function tickBuilderDrones(state) {
  if (state.paused) return [];
  initBuilderDrones(state);
  const events = [];
  const galaxy = getGraph(state);

  for (const drone of activeGalaxyDrones(state)) {
    if (drone.status === 'outbound' && drone.transit) {
      advanceTransit(
        drone.transit,
        galaxy,
        state.time,
        BUILDER_DRONE_LANE_SPEED,
        BUILDER_DRONE_LANE_MIN_LEG_MS,
        (destId) => {
          drone.status = 'building';
          drone.systemId = destId;
          drone.transit = null;
          drone.buildStartedAt = state.time;
          events.push({ type: 'builder_drone_arrived', droneId: drone.id, systemId: destId });
        },
      );
    }

    if (drone.status === 'building') {
      const doneAt = (drone.buildStartedAt ?? state.time) + (drone.buildDurationMs ?? 0);
      if (state.time >= doneAt) {
        const res = completeBuildTarget(state, drone);
        if (res.ok) {
          events.push({
            type: 'builder_drone_build_complete',
            droneId: drone.id,
            systemId: drone.targetSystemId,
            bodyId: drone.targetBodyId,
            buildType: drone.buildType,
          });
          beginReturn(state, drone);
        } else {
          drone.status = 'idle';
          drone.systemId = drone.targetSystemId;
          drone.lastError = res.reason;
          events.push({ type: 'builder_drone_build_failed', droneId: drone.id, reason: res.reason });
        }
      }
    }

    if (drone.status === 'returning' && drone.returnTransit) {
      advanceTransit(
        drone.returnTransit,
        galaxy,
        state.time,
        BUILDER_DRONE_LANE_SPEED,
        BUILDER_DRONE_LANE_MIN_LEG_MS,
        (destId) => {
          drone.status = 'idle';
          drone.systemId = destId;
          drone.returnTransit = null;
          events.push({ type: 'builder_drone_returned', droneId: drone.id, systemId: destId });
        },
      );
    }
  }
  return events;
}

export function builderDroneTransitPositions(state) {
  const out = [];
  const galaxy = getGraph(state);
  for (const drone of activeGalaxyDrones(state)) {
    const transit = drone.status === 'returning' ? drone.returnTransit : drone.transit;
    if (!transit) continue;
    const status = transitStatus(
      transit,
      galaxy,
      state.time,
      BUILDER_DRONE_LANE_SPEED,
      BUILDER_DRONE_LANE_MIN_LEG_MS,
    );
    if (status) out.push({ drone, ...status });
  }
  return out;
}

export function builderDroneSummary(state) {
  initBuilderDrones(state);
  return {
    unlocked: droneTechUnlocked(state),
    capacity: droneTechUnlocked(state) ? BUILDER_DRONE_CAPACITY : 0,
    idle: activeGalaxyDrones(state).filter((d) => d.status === 'idle').length,
    active: activeGalaxyDrones(state).filter((d) => d.status !== 'idle').length,
    drones: activeGalaxyDrones(state).map((drone) => ({
      id: drone.id,
      status: drone.status,
      systemId: drone.systemId,
      targetSystemId: drone.targetSystemId,
      targetBodyId: drone.targetBodyId,
      buildType: drone.buildType,
      etaMs: drone.status === 'outbound' || drone.status === 'returning' ? builderDroneEtaMs(state, drone) : null,
      buildProgress: drone.status === 'building'
        ? Math.min(1, Math.max(0, (state.time - (drone.buildStartedAt ?? state.time)) / Math.max(TICK_MS, drone.buildDurationMs ?? TICK_MS)))
        : null,
      lastError: drone.lastError ?? null,
    })),
  };
}
