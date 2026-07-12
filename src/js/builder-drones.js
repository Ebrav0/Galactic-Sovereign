// Reusable flagship-launched builder drones for remote construction.

import {
  OUTPOST_COST,
  SHIPYARD_COST,
  FOUNDRY_COST,
  LAUNCHER_COST,
  TRADE_STATION_COST,
  RESEARCH_STATION_COST,
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
import { isPlayerOwned, systemById } from './state.js';
import { isTechUnlocked } from './tech-web.js';
import {
  buildFoundry,
  buildLauncher,
  canBuildFoundry,
  canBuildLauncher,
} from './dyson.js';
import { buildTradeStation, canBuildTradeStation } from './trade.js';
import { buildResearchStation, canBuildResearchStation } from './research.js';
import {
  STRUCTURE_DEFS,
  buildStrategicStructure,
  canBuildStrategicStructure,
} from './strategic-structures.js';
import {
  advanceTransit,
  transitEtaMs,
  transitStatus,
} from './transit.js';

let nextBuilderDroneId = 1;
let nextBuilderOrderId = 1;

function droneTechUnlocked(state) {
  return isTechUnlocked(state, 'eco_construction_drones');
}

function activeGalaxyDrones(state) {
  return (state.builderDrones ?? []).filter((d) => d.galaxyId === state.activeGalaxyId);
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
    originSystemId: state.flagship?.systemId ?? state.stronghold,
    returnTransit: null,
    costPaid: 0,
    lastError: null,
    awaitingOrders: false,
  };
}

export function resetBuilderDroneIds(state) {
  let max = 0;
  for (const drone of state.builderDrones ?? []) {
    const n = parseInt(String(drone.id).replace('bd-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextBuilderDroneId = max + 1;
  let maxOrder = 0;
  for (const order of state.builderConstructionOrders ?? []) {
    const n = parseInt(String(order.id).replace('bco-', ''), 10);
    if (Number.isFinite(n)) maxOrder = Math.max(maxOrder, n);
  }
  nextBuilderOrderId = maxOrder + 1;
}

export function initBuilderDrones(state) {
  if (!state.builderDrones) state.builderDrones = [];
  if (!state.builderConstructionOrders) state.builderConstructionOrders = [];
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
    drone.originSystemId = drone.originSystemId ?? drone.systemId ?? state.stronghold;
    drone.returnTransit = drone.returnTransit ?? null;
    drone.costPaid = drone.costPaid ?? 0;
    drone.lastError = drone.lastError ?? null;
    drone.awaitingOrders = drone.awaitingOrders ?? false;
  }

  if (!droneTechUnlocked(state)) return state.builderDrones;
  const current = activeGalaxyDrones(state).length;
  for (let i = current; i < BUILDER_DRONE_CAPACITY; i++) {
    state.builderDrones.push(makeIdleDrone(state));
  }
  return state.builderDrones;
}

function idleDroneAt(state, systemId) {
  return activeGalaxyDrones(state).find((d) => d.status === 'idle' && d.systemId === systemId) ?? null;
}

function deployableDrone(state, targetSystemId, droneId = null) {
  return activeGalaxyDrones(state).find(
    (drone) => drone.status === 'idle'
      && drone.systemId
      && drone.systemId !== targetSystemId
      && (!droneId || drone.id === droneId),
  ) ?? null;
}

function buildCost(type) {
  if (type === 'outpost') return OUTPOST_COST;
  if (type === 'shipyard') return SHIPYARD_COST;
  if (type === 'sail_foundry') return FOUNDRY_COST;
  if (type === 'dyson_launcher') return LAUNCHER_COST;
  if (type === 'export_depot') return TRADE_STATION_COST;
  if (type === 'research_station') return RESEARCH_STATION_COST;
  if (STRUCTURE_DEFS[type]) return STRUCTURE_DEFS[type].cost;
  return bodyStructureDef(type)?.cost ?? null;
}

function buildDuration(type) {
  if (type === 'outpost') return Math.round(BUILDER_DRONE_OUTPOST_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  if (type === 'shipyard') return Math.round(BUILDER_DRONE_SHIPYARD_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  if (type === 'sail_foundry' || type === 'dyson_launcher') {
    return Math.round(BUILDER_DRONE_BODY_STRUCTURE_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  }
  if (type === 'export_depot' || type === 'research_station' || STRUCTURE_DEFS[type]) {
    return Math.round(BUILDER_DRONE_BODY_STRUCTURE_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  }
  if (BODY_STRUCTURE_DEFS[type]) return Math.round(BUILDER_DRONE_BODY_STRUCTURE_BUILD_MS * BUILDER_DRONE_BUILD_TIME_MULT);
  return null;
}

function canBuildTarget(state, systemId, bodyId, type) {
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'Builder drones can only construct in claimed systems' };
  if (type === 'outpost') return canBuildOutpost(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (type === 'shipyard') return canBuildShipyard(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (type === 'sail_foundry') return canBuildFoundry(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (type === 'dyson_launcher') return canBuildLauncher(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (type === 'export_depot') return canBuildTradeStation(state, systemId, bodyId, { remote: true, ignoreCredits: true });
  if (type === 'research_station') return canBuildResearchStation(state, systemId, { remote: true, ignoreCredits: true });
  if (STRUCTURE_DEFS[type]) {
    return canBuildStrategicStructure(state, systemId, type, bodyId, { remote: true, ignoreCredits: true });
  }
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
  if (buildType === 'sail_foundry') {
    return buildFoundry(state, targetSystemId, targetBodyId, { remote: true, alreadyPaid: true, ignoreCredits: true });
  }
  if (buildType === 'dyson_launcher') {
    return buildLauncher(state, targetSystemId, targetBodyId, { remote: true, alreadyPaid: true, ignoreCredits: true });
  }
  if (buildType === 'export_depot') {
    return buildTradeStation(state, targetSystemId, targetBodyId, { remote: true, alreadyPaid: true, ignoreCredits: true });
  }
  if (buildType === 'research_station') {
    return buildResearchStation(state, targetSystemId, { remote: true, alreadyPaid: true, ignoreCredits: true });
  }
  if (STRUCTURE_DEFS[buildType]) {
    return buildStrategicStructure(state, targetSystemId, buildType, targetBodyId, {
      remote: true, alreadyPaid: true, ignoreCredits: true,
    });
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

export function canDeployBuilderDrone(state, systemId, droneId = null) {
  initBuilderDrones(state);
  if (!droneTechUnlocked(state)) return { ok: false, reason: 'Research Construction Drones first' };
  const target = systemById(state, systemId);
  if (!target) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'Builder drones can only deploy to claimed systems' };
  const drone = deployableDrone(state, systemId, droneId);
  if (!drone) return { ok: false, reason: 'No idle builder drone available' };
  if (!drone.systemId) return { ok: false, reason: 'Builder drone is not stationed at a system' };
  const transit = makeTransit(state, drone.systemId, systemId);
  if (!transit) return { ok: false, reason: 'No lane route to target system' };
  if (state.credits < BUILDER_DRONE_DEPLOY_COST) return { ok: false, reason: `Need ${BUILDER_DRONE_DEPLOY_COST} credits` };
  return { ok: true, droneId: drone.id, originSystemId: drone.systemId, totalCost: BUILDER_DRONE_DEPLOY_COST, etaMs: builderDroneEtaMs(state, { ...drone, transit }) };
}

export function deployBuilderDrone(state, systemId, droneId = null) {
  const check = canDeployBuilderDrone(state, systemId, droneId);
  if (!check.ok) return check;
  const drone = state.builderDrones.find((entry) => entry.id === check.droneId);
  state.credits -= check.totalCost;
  drone.status = 'outbound';
  drone.originSystemId = drone.systemId;
  drone.systemId = null;
  drone.targetSystemId = systemId;
  drone.targetBodyId = null;
  drone.buildType = null;
  drone.transit = makeTransit(state, check.originSystemId, systemId);
  drone.buildStartedAt = null;
  drone.buildDurationMs = null;
  drone.returnTransit = null;
  drone.costPaid = check.totalCost;
  drone.lastError = null;
  drone.awaitingOrders = false;
  return { ok: true, droneId: drone.id, systemId, etaMs: builderDroneEtaMs(state, drone) };
}

function buildUnlocked(state, type) {
  if (type === 'outpost' || type === 'shipyard') return true;
  if (type === 'sail_foundry') return isTechUnlocked(state, 'mega_foundry_unlock');
  if (type === 'dyson_launcher') return isTechUnlocked(state, 'mega_launcher_unlock');
  if (type === 'export_depot') return isTechUnlocked(state, 'eco_trade_hub');
  if (type === 'research_station') return isTechUnlocked(state, 'res_station_protocol');
  const body = BODY_STRUCTURE_DEFS[type];
  if (body) return !body.tech || isTechUnlocked(state, body.tech);
  const strategic = STRUCTURE_DEFS[type];
  return !!strategic && (!strategic.tech || isTechUnlocked(state, strategic.tech));
}

function buildLabel(type) {
  const labels = {
    outpost: 'Outpost', shipyard: 'Shipyard', sail_foundry: 'Sail Foundry',
    dyson_launcher: 'Dyson Launcher', export_depot: 'Export Depot',
    research_station: 'Research Station',
  };
  return labels[type] ?? bodyStructureDef(type)?.label ?? STRUCTURE_DEFS[type]?.label
    ?? type.replaceAll('_', ' ');
}

function targetList(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return [];
  const targets = [{ id: null, kind: 'system', label: `${system.name} Star Node` }];
  for (const planet of system.bodies ?? []) {
    targets.push({ id: planet.id, kind: 'planet', label: planet.name, bodyType: planet.type });
    for (const moon of planet.moons ?? []) {
      targets.push({ id: moon.id, kind: 'moon', label: moon.name, bodyType: moon.type ?? 'moon', planetId: planet.id });
    }
  }
  return targets;
}

function candidateTypes(target) {
  if (target.kind === 'system') {
    return [
      'research_station',
      ...Object.entries(BODY_STRUCTURE_DEFS).filter(([, def]) => def.starNode).map(([type]) => type),
      ...Object.entries(STRUCTURE_DEFS).filter(([, def]) => !def.perBody).map(([type]) => type),
    ];
  }
  const base = target.kind === 'planet'
    ? ['outpost', 'shipyard', 'export_depot', 'sail_foundry', 'dyson_launcher']
    : ['dyson_launcher'];
  return [
    ...base,
    ...Object.entries(BODY_STRUCTURE_DEFS).filter(([, def]) => !def.starNode).map(([type]) => type),
    ...(target.kind === 'planet'
      ? Object.entries(STRUCTURE_DEFS).filter(([, def]) => def.perBody).map(([type]) => type)
      : []),
  ];
}

function projectStructure(state, systemId, bodyId, type) {
  const system = systemById(state, systemId);
  const def = bodyStructureDef(type);
  const strategic = STRUCTURE_DEFS[type];
  let projectedBodyId = bodyId;
  if (type === 'export_depot') projectedBodyId = null;
  if (type === 'research_station') {
    projectedBodyId = system.bodies.find((body) => body.type === 'habitable')?.id ?? system.bodies[0]?.id ?? null;
  }
  if (def?.starNode || (strategic && !strategic.perBody)) projectedBodyId = null;
  system.structures.push({
    id: `draft-${type}-${system.structures.length}`,
    type,
    bodyId: projectedBodyId,
    builtAtTime: state.time,
    level: 1,
    hp: 100,
    maxHp: 100,
    operational: true,
  });
}

function validateDraft(state, systemId, draftOrders = []) {
  const projected = structuredClone(state);
  const results = [];
  const validDrafts = [];
  const dependencyKey = (bodyId) => {
    if (bodyId == null) return 'system';
    const system = systemById(projected, systemId);
    for (const planet of system?.bodies ?? []) {
      if (planet.id === bodyId) return planet.id;
      if ((planet.moons ?? []).some((moon) => moon.id === bodyId)) return planet.id;
    }
    return bodyId;
  };
  for (let index = 0; index < draftOrders.length; index++) {
    const draft = draftOrders[index];
    const clientId = draft.clientId ?? `draft-${index + 1}`;
    const check = buildUnlocked(projected, draft.structureType)
      ? canBuildTarget(projected, systemId, draft.bodyId ?? null, draft.structureType)
      : { ok: false, reason: 'Technology not researched' };
    const cost = buildCost(draft.structureType);
    const durationMs = buildDuration(draft.structureType);
    const result = {
      clientId,
      bodyId: draft.bodyId ?? null,
      structureType: draft.structureType,
      ok: !!check.ok,
      reason: check.reason ?? null,
      cost,
      durationMs,
      dependsOnClientIds: validDrafts
        .filter((prior) => dependencyKey(prior.bodyId) === dependencyKey(draft.bodyId ?? null)
          || (draft.structureType === 'dyson_launcher' && prior.structureType === 'sail_foundry'))
        .map((prior) => prior.clientId),
    };
    results.push(result);
    if (!check.ok || cost == null || durationMs == null) continue;
    projectStructure(projected, systemId, draft.bodyId ?? null, draft.structureType);
    validDrafts.push({ clientId, bodyId: draft.bodyId ?? null, structureType: draft.structureType });
  }
  return { projected, results };
}

export function getDroneConstructionCatalog(state, systemId, draftOrders = []) {
  initBuilderDrones(state);
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system', targets: [] };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control', targets: [] };
  const { projected, results } = validateDraft(state, systemId, draftOrders);
  const targets = targetList(projected, systemId).map((target) => ({
    ...target,
    buildings: [...new Set(candidateTypes(target))]
      .filter((type) => buildUnlocked(projected, type))
      .map((type) => {
        const check = canBuildTarget(projected, systemId, target.id, type);
        return {
          type,
          label: buildLabel(type),
          cost: buildCost(type),
          durationMs: buildDuration(type),
          ok: !!check.ok,
          reason: check.reason ?? null,
        };
      }),
  }));
  return { ok: true, systemId, targets, draftResults: results };
}

export function confirmBuilderConstructionPlan(state, systemId, draftOrders = []) {
  initBuilderDrones(state);
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  if (!idleDroneAt(state, systemId)) return { ok: false, reason: 'No idle builder drone stationed in this system' };
  const { results } = validateDraft(state, systemId, draftOrders);
  if (results.length === 0) return { ok: false, reason: 'Add at least one construction job' };
  const invalid = results.find((result) => !result.ok);
  if (invalid) return { ok: false, reason: `${buildLabel(invalid.structureType)}: ${invalid.reason}` };
  const totalCost = results.reduce((sum, result) => sum + result.cost, 0);
  if (state.credits < totalCost) return { ok: false, reason: `Need ${totalCost} credits` };
  state.credits -= totalCost;
  const idMap = new Map();
  const orders = results.map((result) => {
    const id = `bco-${nextBuilderOrderId++}`;
    idMap.set(result.clientId, id);
    return {
      id,
      galaxyId: state.activeGalaxyId,
      systemId,
      bodyId: result.bodyId,
      structureType: result.structureType,
      dependsOnOrderIds: result.dependsOnClientIds.map((clientId) => idMap.get(clientId)).filter(Boolean),
      assignedDroneId: null,
      status: 'queued',
      costPaid: result.cost,
      workRequiredMs: result.durationMs,
      workDoneMs: 0,
      orderedAt: state.time,
      startedAt: null,
      completedAt: null,
      lastError: null,
    };
  });
  state.builderConstructionOrders.push(...orders);
  for (const drone of activeGalaxyDrones(state)) {
    if (drone.systemId === systemId) drone.awaitingOrders = false;
  }
  assignBuilderConstructionOrders(state, systemId);
  return { ok: true, orders, totalCost };
}

export function cancelBuilderConstructionOrder(state, orderId) {
  initBuilderDrones(state);
  const order = state.builderConstructionOrders.find((entry) => entry.id === orderId);
  if (!order) return { ok: false, reason: 'No such construction order' };
  if (order.status !== 'queued') return { ok: false, reason: 'Only pending orders can be canceled' };
  const cancelIds = new Set([orderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of state.builderConstructionOrders) {
      if (candidate.status !== 'queued' || cancelIds.has(candidate.id)) continue;
      if ((candidate.dependsOnOrderIds ?? []).some((id) => cancelIds.has(id))) {
        cancelIds.add(candidate.id);
        changed = true;
      }
    }
  }
  let refunded = 0;
  for (const candidate of state.builderConstructionOrders) {
    if (!cancelIds.has(candidate.id) || candidate.status !== 'queued') continue;
    candidate.status = 'cancelled';
    refunded += candidate.costPaid ?? 0;
  }
  state.credits += refunded;
  return { ok: true, refunded, cancelledOrderIds: [...cancelIds] };
}

function orderDependenciesComplete(state, order) {
  return (order.dependsOnOrderIds ?? []).every((id) => (
    state.builderConstructionOrders.find((entry) => entry.id === id)?.status === 'complete'
  ));
}

function assignBuilderConstructionOrders(state, systemId) {
  const idle = activeGalaxyDrones(state).filter(
    (drone) => drone.status === 'idle' && drone.systemId === systemId,
  );
  const ready = state.builderConstructionOrders.filter(
    (order) => order.galaxyId === state.activeGalaxyId
      && order.systemId === systemId
      && order.status === 'queued'
      && orderDependenciesComplete(state, order),
  );
  while (idle.length && ready.length) {
    const drone = idle.shift();
    const order = ready.shift();
    order.status = 'active';
    order.assignedDroneId = drone.id;
    order.startedAt = state.time;
    drone.status = 'building';
    drone.targetSystemId = systemId;
    drone.targetBodyId = order.bodyId;
    drone.buildType = order.structureType;
    drone.buildStartedAt = state.time;
    drone.buildDurationMs = order.workRequiredMs;
    drone.awaitingOrders = false;
  }
}

export function cancelBuilderDrone(state, droneId) {
  initBuilderDrones(state);
  const drone = state.builderDrones.find((d) => d.id === droneId);
  if (!drone) return { ok: false, reason: 'No such builder drone' };
  if (drone.status === 'building') return { ok: false, reason: 'Drone is already building' };
  if (drone.status === 'idle') return { ok: true };
  drone.status = 'idle';
  drone.systemId = drone.originSystemId ?? state.flagship?.systemId ?? drone.systemId;
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

function returnDroneToOrigin(state, drone, fromSystemId = drone.systemId ?? drone.targetSystemId) {
  const originId = drone.originSystemId ?? state.stronghold;
  if (fromSystemId && originId && fromSystemId !== originId) {
    const transit = makeTransit(state, fromSystemId, originId);
    if (transit) {
      drone.status = 'returning';
      drone.systemId = null;
      drone.targetSystemId = null;
      drone.targetBodyId = null;
      drone.buildType = null;
      drone.transit = null;
      drone.returnTransit = transit;
      drone.awaitingOrders = false;
      return;
    }
  }
  drone.status = 'idle';
  drone.systemId = originId;
  drone.targetSystemId = null;
  drone.returnTransit = null;
  drone.awaitingOrders = false;
}

export function tickBuilderDrones(state) {
  if (state.paused) return [];
  initBuilderDrones(state);
  const events = [];
  const galaxy = getGraph(state);

  for (const order of state.builderConstructionOrders) {
    if (!['queued', 'active'].includes(order.status) || isPlayerOwned(state, order.systemId)) continue;
    if (order.status === 'queued') {
      order.status = 'cancelled';
      state.credits += order.costPaid ?? 0;
      events.push({ type: 'builder_drone_order_refunded', orderId: order.id, refunded: order.costPaid ?? 0 });
      continue;
    }
    order.status = 'failed';
    order.lastError = 'System ownership lost';
    const drone = state.builderDrones.find((entry) => entry.id === order.assignedDroneId);
    if (drone) returnDroneToOrigin(state, drone, order.systemId);
    events.push({ type: 'builder_drone_build_failed', droneId: drone?.id ?? null, reason: order.lastError });
  }

  for (const systemId of new Set(state.builderConstructionOrders
    .filter((order) => order.status === 'queued')
    .map((order) => order.systemId))) {
    assignBuilderConstructionOrders(state, systemId);
  }

  for (const drone of activeGalaxyDrones(state)) {
    if (drone.status === 'outbound' && drone.transit) {
      advanceTransit(
        drone.transit,
        galaxy,
        state.time,
        BUILDER_DRONE_LANE_SPEED,
        BUILDER_DRONE_LANE_MIN_LEG_MS,
        (destId) => {
          if (!isPlayerOwned(state, destId)) {
            drone.lastError = 'Target system is no longer under your control';
            returnDroneToOrigin(state, drone, destId);
            events.push({ type: 'builder_drone_deploy_failed', droneId: drone.id, systemId: destId, reason: drone.lastError });
            return;
          }
          drone.status = 'idle';
          drone.systemId = destId;
          drone.transit = null;
          drone.targetSystemId = null;
          drone.targetBodyId = null;
          drone.buildType = null;
          drone.buildStartedAt = null;
          drone.buildDurationMs = null;
          drone.awaitingOrders = true;
          events.push({ type: 'builder_drone_deployed', droneId: drone.id, systemId: destId });
        },
      );
    }

    if (drone.status === 'building') {
      const order = state.builderConstructionOrders.find(
        (entry) => entry.assignedDroneId === drone.id && entry.status === 'active',
      );
      const doneAt = (drone.buildStartedAt ?? state.time) + (drone.buildDurationMs ?? 0);
      if (order) order.workDoneMs = Math.min(order.workRequiredMs, Math.max(0, state.time - order.startedAt));
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
          if (order) {
            order.status = 'complete';
            order.workDoneMs = order.workRequiredMs;
            order.completedAt = state.time;
          }
          const completedSystemId = drone.targetSystemId;
          drone.status = 'idle';
          drone.systemId = drone.targetSystemId;
          drone.targetSystemId = null;
          drone.targetBodyId = null;
          drone.buildType = null;
          drone.buildStartedAt = null;
          drone.buildDurationMs = null;
          drone.transit = null;
          drone.returnTransit = null;
          assignBuilderConstructionOrders(state, completedSystemId);
        } else {
          drone.status = 'idle';
          drone.systemId = drone.targetSystemId;
          drone.lastError = res.reason;
          if (order) {
            order.status = 'failed';
            order.lastError = res.reason;
          }
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
      awaitingOrders: !!drone.awaitingOrders,
    })),
    orders: (state.builderConstructionOrders ?? []).map((order) => ({ ...order })),
  };
}
