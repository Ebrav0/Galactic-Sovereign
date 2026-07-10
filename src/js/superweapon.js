// Superweapon cradle + graph sculpting (Phase 6, GDD §11).

import {
  SUPERWEAPON_CRADLE_COST,
  SUPERWEAPON_CRADLE_SOLARII,
  SUPERWEAPON_CREATE_SOLARII,
  SUPERWEAPON_DESTROY_SOLARII,
  SUPERWEAPON_JUMP_SOLARII,
  SUPERWEAPON_COOLDOWN_MS,
  SUPERWEAPON_JUMP_COOLDOWN_MS,
  SHELL_COUNT,
  DYSON_SHIELD_COOLDOWN_MS,
} from './constants.js';
import { BLACK_HOLE_ID, neighborsOf, nodeById } from './galaxy.js';
import { getGraph, getSystems, getActiveGalaxy } from './galaxy-scope.js';
import {
  allocateStructureId,
} from './economy.js';
import {
  createRng,
  hashSeed,
  generateSystem,
  isPlayerOwned,
  systemById,
  ensureDyson,
} from './state.js';
import { isTechUnlocked } from './tech-web.js';
import { refreshMilestones } from './milestones.js';
import { orderTravel } from './flagship.js';
import { orderBattleGroupTravel, battleGroupsForGalaxy } from './battle-groups.js';
import { triggerSuperweaponPanic } from './diplomacy.js';

let nextCreatedStarIndex = 0;

export function resetSuperweaponIds(state) {
  let max = 0;
  const graph = getGraph(state);
  for (const star of graph.stars) {
    const m = /^sys-created-(\d+)$/.exec(star.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  nextCreatedStarIndex = max + 1;
}

export function ensureSuperweapon(state) {
  if (!state.superweapon) {
    state.superweapon = {
      cradleSystemId: null,
      online: false,
      cooldownUntil: 0,
      jumpCooldownUntil: 0,
      lastAction: null,
      shieldCooldowns: {},
      createCount: 0,
    };
  }
  if (!state.superweapon.shieldCooldowns) state.superweapon.shieldCooldowns = {};
}

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

export function hasSuperweaponCradle(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.some((s) => s.type === 'superweapon_cradle') ?? false;
}

export function canBuildSuperweaponCradle(state, systemId) {
  refreshMilestones(state);
  if (!state.milestones?.superweaponUnlocked) {
    return { ok: false, reason: 'Requires 3 completed Dyson spheres' };
  }
  if (!isTechUnlocked(state, 'sw_cradle_unlock')) {
    return { ok: false, reason: 'Research Superweapon Cradle first' };
  }
  if (systemId !== state.stronghold) {
    return { ok: false, reason: 'Superweapon cradle must be built at your Stronghold' };
  }
  if (!isPlayerOwned(state, systemId)) {
    return { ok: false, reason: 'Stronghold must be under your control' };
  }
  if (hasSuperweaponCradle(state, systemId)) {
    return { ok: false, reason: 'Superweapon cradle already exists' };
  }
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in the Stronghold' };
  }
  if (state.credits < SUPERWEAPON_CRADLE_COST) {
    return { ok: false, reason: `Need ${SUPERWEAPON_CRADLE_COST} credits` };
  }
  if ((state.solarii ?? 0) < SUPERWEAPON_CRADLE_SOLARII) {
    return { ok: false, reason: `Need ${SUPERWEAPON_CRADLE_SOLARII} Solarii` };
  }
  return { ok: true };
}

export function buildSuperweaponCradle(state, systemId = state.stronghold) {
  const check = canBuildSuperweaponCradle(state, systemId);
  if (!check.ok) return check;

  state.credits -= SUPERWEAPON_CRADLE_COST;
  state.solarii -= SUPERWEAPON_CRADLE_SOLARII;
  ensureSuperweapon(state);
  state.superweapon.cradleSystemId = systemId;
  state.superweapon.online = true;

  const system = systemById(state, systemId);
  system.structures.push({
    id: allocateStructureId(),
    type: 'superweapon_cradle',
    bodyId: null,
    builtAtTime: state.time,
  });
  return { ok: true, systemId };
}

function onCooldown(state, field = 'cooldownUntil') {
  return state.time < (state.superweapon?.[field] ?? 0);
}

export function completedDysonAt(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return (system?.dyson?.completedShells ?? 0) >= SHELL_COUNT;
}

export function findAdjacentCompletedDyson(state, systemId) {
  const graph = getGraph(state);
  for (const neighbor of neighborsOf(graph, systemId)) {
    if (neighbor === BLACK_HOLE_ID) continue;
    if (completedDysonAt(state, neighbor) && !isShieldOnCooldown(state, neighbor)) {
      return neighbor;
    }
  }
  return null;
}

function isShieldOnCooldown(state, systemId) {
  return state.time < (state.superweapon?.shieldCooldowns?.[systemId] ?? 0);
}

export function tryBlockDestroyWithShield(state, targetSystemId) {
  if (!completedDysonAt(state, targetSystemId)) return { blocked: false };
  const partner = findAdjacentCompletedDyson(state, targetSystemId);
  if (!partner) return { blocked: false };
  ensureSuperweapon(state);
  const until = state.time + DYSON_SHIELD_COOLDOWN_MS;
  state.superweapon.shieldCooldowns[targetSystemId] = until;
  state.superweapon.shieldCooldowns[partner] = until;
  return { blocked: true, reason: 'Dyson shield blocked destruction', partnerSystemId: partner };
}

export function superweaponCreate(state, anchorSystemId) {
  ensureSuperweapon(state);
  if (!state.superweapon.online) return { ok: false, reason: 'Superweapon not online' };
  if (!isTechUnlocked(state, 'sw_create_star')) {
    return { ok: false, reason: 'Research Stellar Genesis first' };
  }
  if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
  if ((state.solarii ?? 0) < SUPERWEAPON_CREATE_SOLARII) {
    return { ok: false, reason: `Need ${SUPERWEAPON_CREATE_SOLARII} Solarii` };
  }

  const gal = getActiveGalaxy(state);
  const graph = getGraph(state);
  const anchor = nodeById(graph, anchorSystemId);
  if (!anchor) return { ok: false, reason: 'Invalid anchor system' };

  const rng = createRng(hashSeed(state.meta.seed, `sw-create:${state.superweapon.createCount}`));
  const angle = rng() * Math.PI * 2;
  const dist = 180 + rng() * 120;
  const newId = `sys-created-${nextCreatedStarIndex++}`;
  const newStar = {
    id: newId,
    name: `Sculpted ${nextCreatedStarIndex}`,
    x: Math.round(anchor.x + Math.cos(angle) * dist),
    y: Math.round(anchor.y + Math.sin(angle) * dist),
  };

  graph.stars.push(newStar);
  graph.lanes.push([anchorSystemId, newId]);

  const sysRng = createRng(hashSeed(state.meta.seed, `sw-sys:${newId}`));
  gal.systems[newId] = generateSystem(sysRng, newStar, {
    isHome: false,
    gameSeed: state.meta.seed,
    galaxyId: state.activeGalaxyId,
  });
  sysRng(); // consume
  gal.systems[newId].owner = 'player';
  gal.systems[newId].createdBySuperweapon = true;

  state.solarii -= SUPERWEAPON_CREATE_SOLARII;
  state.superweapon.cooldownUntil = state.time + SUPERWEAPON_COOLDOWN_MS;
  state.superweapon.createCount = (state.superweapon.createCount ?? 0) + 1;
  state.superweapon.lastAction = { type: 'create', targetSystemId: newId, at: state.time };

  return { ok: true, systemId: newId, starCount: graph.stars.length };
}

export function superweaponDestroy(state, targetSystemId) {
  ensureSuperweapon(state);
  if (!state.superweapon.online) return { ok: false, reason: 'Superweapon not online' };
  if (!isTechUnlocked(state, 'sw_destroy_star')) {
    return { ok: false, reason: 'Research Stellar Annihilation first' };
  }
  if (targetSystemId === state.stronghold || targetSystemId === BLACK_HOLE_ID) {
    return { ok: false, reason: 'Cannot destroy the Stronghold or galactic core' };
  }
  if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
  if ((state.solarii ?? 0) < SUPERWEAPON_DESTROY_SOLARII) {
    return { ok: false, reason: `Need ${SUPERWEAPON_DESTROY_SOLARII} Solarii` };
  }

  const shield = tryBlockDestroyWithShield(state, targetSystemId);
  if (shield.blocked) return { ok: false, ...shield };

  const gal = getActiveGalaxy(state);
  const graph = getGraph(state);
  if (!gal.systems[targetSystemId]) return { ok: false, reason: 'No such system' };

  purgeSystemEntities(state, targetSystemId);
  delete gal.systems[targetSystemId];
  graph.stars = graph.stars.filter((s) => s.id !== targetSystemId);
  graph.lanes = graph.lanes.filter(([a, b]) => a !== targetSystemId && b !== targetSystemId);

  state.solarii -= SUPERWEAPON_DESTROY_SOLARII;
  state.superweapon.cooldownUntil = state.time + SUPERWEAPON_COOLDOWN_MS;
  state.superweapon.lastAction = { type: 'destroy', targetSystemId, at: state.time };
  triggerSuperweaponPanic(state);

  return { ok: true, systemId: targetSystemId, starCount: graph.stars.length };
}

function purgeSystemEntities(state, systemId) {
  const referencesSystem = (entity) => entity?.systemId === systemId
    || entity?.targetSystemId === systemId
    || entity?.rallyStarId === systemId
    || entity?.transit?.path?.includes?.(systemId)
    || entity?.returnTransit?.path?.includes?.(systemId);
  state.playerShips = (state.playerShips ?? []).filter((entity) => !referencesSystem(entity));
  state.aiShips = (state.aiShips ?? []).filter((entity) => !referencesSystem(entity));
  state.scouts = (state.scouts ?? []).filter((entity) => !referencesSystem(entity));
  if (referencesSystem(state.flagship)) {
    state.flagship.systemId = state.stronghold;
    state.flagship.transit = null;
    state.flagship.wormholeTransit = null;
    state.flagship.x = 0;
    state.flagship.y = -200;
    state.flagship.vx = 0;
    state.flagship.vy = 0;
  }
  for (const group of state.battleGroups ?? []) {
    group.shipIds = group.shipIds.filter((id) => {
      const ship = state.playerShips.find((s) => s.id === id);
      return ship && ship.systemId !== systemId;
    });
  }
  state.heroFlagships = (state.heroFlagships ?? []).filter((entity) => !referencesSystem(entity));
  state.pirates.fleets = (state.pirates?.fleets ?? []).filter((entity) => !referencesSystem(entity));
  for (const drone of state.builderDrones ?? []) {
    if (!referencesSystem(drone)) continue;
    drone.status = 'idle';
    drone.systemId = state.flagship.systemId ?? state.stronghold;
    drone.targetSystemId = null;
    drone.targetBodyId = null;
    drone.buildType = null;
    drone.transit = null;
    drone.returnTransit = null;
    drone.buildStartedAt = null;
    drone.buildDurationMs = null;
    drone.lastError = 'target system destroyed';
  }

  const logistics = state.logistics;
  if (logistics) {
    const removedDepotIds = new Set();
    for (const [depotId, depot] of Object.entries(logistics.depots ?? {})) {
      if (depot.systemId === systemId || depot.nexusSystemId === systemId) {
        removedDepotIds.add(depotId);
        delete logistics.depots[depotId];
      }
    }
    logistics.routes = (logistics.routes ?? []).filter((route) => (
      !removedDepotIds.has(route.depotId)
      && route.fromSystemId !== systemId
      && route.toSystemId !== systemId
      && route.nexusSystemId !== systemId
      && !route.path?.includes?.(systemId)
    ));
    const removedConvoys = (logistics.convoys ?? []).filter((convoy) => (
      removedDepotIds.has(convoy.depotId)
      || convoy.fromSystemId === systemId
      || convoy.toSystemId === systemId
      || convoy.nexusSystemId === systemId
      || convoy.path?.includes?.(systemId)
    ));
    logistics.convoys = (logistics.convoys ?? []).filter((convoy) => !removedConvoys.includes(convoy));
    logistics.stats ??= {};
    logistics.stats.convoysLost = (logistics.stats.convoysLost ?? 0) + removedConvoys.length;
    logistics.localTransports = (logistics.localTransports ?? []).filter((transport) => (
      transport.systemId !== systemId && !removedDepotIds.has(transport.depotId)
    ));
    for (const key of Object.keys(logistics.outpostStock ?? {})) {
      const stock = logistics.outpostStock[key];
      if (stock?.systemId === systemId || key.includes(`:${systemId}:`)) delete logistics.outpostStock[key];
    }
    logistics.blockades.systems = (logistics.blockades?.systems ?? [])
      .filter((key) => !key.endsWith(`:${systemId}`));
    logistics.blockades.lanes = (logistics.blockades?.lanes ?? [])
      .filter((key) => !key.split(':').at(-1)?.split('|').includes(systemId));
  }

  state.manualTradeRoutes = (state.manualTradeRoutes ?? []).filter((route) => (
    route.fromSystemId !== systemId && route.toSystemId !== systemId
  ));
  const galaxy = getActiveGalaxy(state);
  if (galaxy?.intel) delete galaxy.intel[systemId];
  if (galaxy?.capture) delete galaxy.capture[systemId];
  for (const faction of state.factions?.list ?? []) {
    if (faction.homeSystemId !== systemId) continue;
    faction.homeSystemId = Object.values(getSystems(state))
      .find((system) => system.id !== systemId && system.owner === 'ai' && system.factionId === faction.id)?.id
      ?? null;
  }
  delete state.systemBattles?.[systemId];
}

export function superweaponJump(state, targetSystemId) {
  ensureSuperweapon(state);
  if (!state.superweapon.online) return { ok: false, reason: 'Superweapon not online' };
  if (!isTechUnlocked(state, 'sw_jump_gate')) {
    return { ok: false, reason: 'Research Superweapon Jump first' };
  }
  if (onCooldown(state, 'jumpCooldownUntil')) {
    return { ok: false, reason: 'Jump on cooldown' };
  }
  if ((state.solarii ?? 0) < SUPERWEAPON_JUMP_SOLARII) {
    return { ok: false, reason: `Need ${SUPERWEAPON_JUMP_SOLARII} Solarii` };
  }
  const graph = getGraph(state);
  if (!nodeById(graph, targetSystemId)) {
    return { ok: false, reason: 'Invalid target star' };
  }

  state.solarii -= SUPERWEAPON_JUMP_SOLARII;
  state.superweapon.jumpCooldownUntil = state.time + SUPERWEAPON_JUMP_COOLDOWN_MS;
  state.superweapon.lastAction = { type: 'jump', targetSystemId, at: state.time };

  const travel = orderTravel(state, targetSystemId);
  if (!travel.ok) {
    state.flagship.systemId = targetSystemId;
    state.flagship.transit = null;
    state.flagship.wormholeTransit = null;
    state.flagship.x = 0;
    state.flagship.y = -200;
  }

  for (const group of battleGroupsForGalaxy(state)) {
    if (group.shipIds.length > 0) {
      orderBattleGroupTravel(state, group.id, targetSystemId);
    }
  }

  return { ok: true, targetSystemId, travel: travel.ok ? travel : { ok: true, instant: true } };
}

export function tickSuperweapon(state) {
  ensureSuperweapon(state);
  return [];
}

export function superweaponSummary(state) {
  ensureSuperweapon(state);
  return {
    online: !!state.superweapon.online,
    cradleSystemId: state.superweapon.cradleSystemId,
    cooldownMs: Math.max(0, (state.superweapon.cooldownUntil ?? 0) - state.time),
    jumpCooldownMs: Math.max(0, (state.superweapon.jumpCooldownUntil ?? 0) - state.time),
    lastAction: state.superweapon.lastAction,
    createCount: state.superweapon.createCount ?? 0,
    panicUntil: state.superweapon.panicUntil ?? 0,
  };
}

export function completeDysonShellForTest(state, systemId, shellNum = SHELL_COUNT) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  const dyson = ensureDyson(system);
  dyson.completedShells = Math.min(SHELL_COUNT, shellNum);
  if (dyson.completedShells >= 1) state.solariiUnlocked = true;
  const events = refreshMilestones(state);
  return { ok: true, shellNum: dyson.completedShells, events };
}
