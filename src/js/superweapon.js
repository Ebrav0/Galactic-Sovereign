// Superweapon cradle + deferred Novacula fire sequence (GDD §11).

import {
  SUPERWEAPON_CRADLE_COST,
  SUPERWEAPON_CRADLE_SOLARII,
  SUPERWEAPON_CREATE_SOLARII,
  SUPERWEAPON_DESTROY_SOLARII,
  SUPERWEAPON_JUMP_SOLARII,
  SUPERWEAPON_COOLDOWN_MS,
  SUPERWEAPON_JUMP_COOLDOWN_MS,
  SUPERWEAPON_PHASE_MS,
  SUPERWEAPON_JUMP_PHASE_MS,
  SHELL_COUNT,
  DYSON_SHIELD_COOLDOWN_MS,
} from './constants.js';
import { BLACK_HOLE_ID, neighborsOf, nodeById } from './galaxy.js';
import { getGraph, getSystems, getActiveGalaxy } from './galaxy-scope.js';
import { allocateStructureId } from './economy.js';
import {
  createRng,
  hashSeed,
  generateSystem,
  isPlayerOwned,
  systemById,
  ensureDyson,
} from './state.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
import { refreshMilestones } from './milestones.js';
import { orderTravel } from './flagship.js';
import { orderBattleGroupTravel, battleGroupsForGalaxy } from './battle-groups.js';
import { triggerSuperweaponPanic } from './diplomacy.js';

let nextCreatedStarIndex = 0;

const PHASE_ORDER = ['charge', 'aim', 'fire', 'impact', 'aftermath'];

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
      fireSequence: null,
    };
  }
  if (!state.superweapon.shieldCooldowns) state.superweapon.shieldCooldowns = {};
  if (state.superweapon.fireSequence === undefined) state.superweapon.fireSequence = null;
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
  const fx = techEffects(state);
  const precision = fx.superweaponPrecisionMult ?? 1;
  const neighbors = neighborsOf(graph, systemId);
  // Higher precision prefers nearer completed partners first (already adjacency-limited).
  const ranked = [...neighbors].sort((a, b) => String(a).localeCompare(String(b)));
  if (precision > 1.1) ranked.reverse();
  for (const neighbor of ranked) {
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

function phaseTimeline(type, state) {
  const fx = techEffects(state);
  const base = type === 'jump' ? SUPERWEAPON_JUMP_PHASE_MS : SUPERWEAPON_PHASE_MS;
  const power = fx.superweaponPowerMult ?? 1;
  const genesis = type === 'create' ? (fx.genesisEfficiencyMult ?? 1) : 1;
  const gate = type === 'jump' ? (fx.gateChargeMult ?? 1) : 1;
  const sovereign = fx.sovereignProtocol ? 1.1 : 1;
  const speed = Math.max(1, power * genesis * gate * sovereign);
  const scaled = {};
  let total = 0;
  for (const phase of PHASE_ORDER) {
    const ms = Math.max(120, Math.round((base[phase] ?? 400) / speed));
    scaled[phase] = ms;
    total += ms;
  }
  return { phases: scaled, totalMs: total };
}

function solariiCostFor(type, state) {
  const fx = techEffects(state);
  const power = fx.superweaponPowerMult ?? 1;
  const genesis = fx.genesisEfficiencyMult ?? 1;
  const sovereign = fx.sovereignProtocol ? 0.9 : 1;
  let base = SUPERWEAPON_CREATE_SOLARII;
  if (type === 'destroy') base = SUPERWEAPON_DESTROY_SOLARII;
  if (type === 'jump') base = SUPERWEAPON_JUMP_SOLARII;
  const discount = type === 'create' ? genesis : power;
  return Math.max(1, Math.ceil(base * sovereign / Math.max(1, discount)));
}

function cooldownMsFor(type, state) {
  const fx = techEffects(state);
  if (type === 'jump') {
    return Math.round(SUPERWEAPON_JUMP_COOLDOWN_MS / Math.max(1, fx.gateChargeMult ?? 1));
  }
  return Math.round(SUPERWEAPON_COOLDOWN_MS / Math.max(1, fx.superweaponPowerMult ?? 1));
}

function sequencePhaseAt(seq, now) {
  if (!seq) return null;
  let t = now - seq.startedAt;
  for (const phase of PHASE_ORDER) {
    const dur = seq.phaseMs?.[phase] ?? 400;
    if (t < dur) {
      return {
        phase,
        elapsedInPhase: t,
        phaseDuration: dur,
        progress: Math.min(1, t / Math.max(1, dur)),
        totalProgress: Math.min(1, (now - seq.startedAt) / Math.max(1, seq.totalMs)),
      };
    }
    t -= dur;
  }
  return {
    phase: 'aftermath',
    elapsedInPhase: 0,
    phaseDuration: 1,
    progress: 1,
    totalProgress: 1,
  };
}

export function fireSequenceStatus(state) {
  ensureSuperweapon(state);
  const seq = state.superweapon.fireSequence;
  if (!seq) return null;
  const info = sequencePhaseAt(seq, state.time);
  return { ...seq, ...info };
}

function canStartAction(state, type, targetSystemId) {
  ensureSuperweapon(state);
  if (!state.superweapon.online) return { ok: false, reason: 'Superweapon not online' };
  if (state.superweapon.fireSequence) return { ok: false, reason: 'Superweapon already firing' };

  if (type === 'create') {
    if (!isTechUnlocked(state, 'sw_create_star')) return { ok: false, reason: 'Research Stellar Genesis first' };
    if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
    if (!nodeById(getGraph(state), targetSystemId)) return { ok: false, reason: 'Invalid anchor system' };
  } else if (type === 'destroy') {
    if (!isTechUnlocked(state, 'sw_destroy_star')) return { ok: false, reason: 'Research Stellar Annihilation first' };
    if (targetSystemId === state.stronghold || targetSystemId === BLACK_HOLE_ID) {
      return { ok: false, reason: 'Cannot destroy the Stronghold or galactic core' };
    }
    if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
    if (!getSystems(state)[targetSystemId]) return { ok: false, reason: 'No such system' };
  } else if (type === 'jump') {
    if (!isTechUnlocked(state, 'sw_jump_gate')) return { ok: false, reason: 'Research Superweapon Jump first' };
    if (onCooldown(state, 'jumpCooldownUntil')) return { ok: false, reason: 'Jump on cooldown' };
    if (!nodeById(getGraph(state), targetSystemId)) return { ok: false, reason: 'Invalid target star' };
  } else {
    return { ok: false, reason: 'Unknown action' };
  }

  const cost = solariiCostFor(type, state);
  if ((state.solarii ?? 0) < cost) return { ok: false, reason: `Need ${cost} Solarii` };
  return { ok: true, cost };
}

function startFireSequence(state, type, targetSystemId) {
  const check = canStartAction(state, type, targetSystemId);
  if (!check.ok) return check;

  const timeline = phaseTimeline(type, state);
  state.solarii -= check.cost;
  const resolveAt = state.time + timeline.phases.charge + timeline.phases.aim + timeline.phases.fire;
  state.superweapon.fireSequence = {
    type,
    fromSystemId: state.superweapon.cradleSystemId ?? state.stronghold,
    targetSystemId,
    startedAt: state.time,
    resolveAt,
    totalMs: timeline.totalMs,
    phaseMs: timeline.phases,
    beamSeed: hashSeed(state.meta.seed, `sw-beam:${state.time}:${type}`),
    costPaid: check.cost,
    resolved: false,
    blocked: false,
    partnerSystemId: null,
    resultSystemId: null,
  };
  return { ok: true, pending: true, fireSequence: state.superweapon.fireSequence };
}

export function requestSuperweaponCreate(state, anchorSystemId) {
  return startFireSequence(state, 'create', anchorSystemId);
}

export function requestSuperweaponDestroy(state, targetSystemId) {
  return startFireSequence(state, 'destroy', targetSystemId);
}

export function requestSuperweaponJump(state, targetSystemId) {
  return startFireSequence(state, 'jump', targetSystemId);
}

function commitCreate(state, anchorSystemId) {
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
  sysRng();
  gal.systems[newId].owner = 'player';
  gal.systems[newId].createdBySuperweapon = true;

  state.superweapon.createCount = (state.superweapon.createCount ?? 0) + 1;
  return { ok: true, systemId: newId, starCount: graph.stars.length };
}

function commitDestroy(state, targetSystemId) {
  const gal = getActiveGalaxy(state);
  const graph = getGraph(state);
  if (!gal.systems[targetSystemId]) return { ok: false, reason: 'No such system' };

  purgeSystemEntities(state, targetSystemId);
  delete gal.systems[targetSystemId];
  graph.stars = graph.stars.filter((s) => s.id !== targetSystemId);
  graph.lanes = graph.lanes.filter(([a, b]) => a !== targetSystemId && b !== targetSystemId);
  triggerSuperweaponPanic(state);
  return { ok: true, systemId: targetSystemId, starCount: graph.stars.length };
}

function commitJump(state, targetSystemId) {
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

function resolveFireSequence(state, seq) {
  if (seq.resolved) return;
  seq.resolved = true;

  if (seq.type === 'destroy') {
    const shield = tryBlockDestroyWithShield(state, seq.targetSystemId);
    if (shield.blocked) {
      seq.blocked = true;
      seq.partnerSystemId = shield.partnerSystemId;
      state.solarii = (state.solarii ?? 0) + Math.floor((seq.costPaid ?? 0) * 0.5);
      state.superweapon.lastAction = {
        type: 'destroy',
        targetSystemId: seq.targetSystemId,
        at: state.time,
        blocked: true,
        partnerSystemId: shield.partnerSystemId,
      };
      state.superweapon.cooldownUntil = state.time + Math.round(cooldownMsFor('destroy', state) * 0.5);
      return;
    }
    const result = commitDestroy(state, seq.targetSystemId);
    state.superweapon.cooldownUntil = state.time + cooldownMsFor('destroy', state);
    state.superweapon.lastAction = {
      type: 'destroy',
      targetSystemId: seq.targetSystemId,
      at: state.time,
      blocked: false,
    };
    seq.resultSystemId = result.systemId;
    return;
  }

  if (seq.type === 'create') {
    const result = commitCreate(state, seq.targetSystemId);
    state.superweapon.cooldownUntil = state.time + cooldownMsFor('create', state);
    state.superweapon.lastAction = {
      type: 'create',
      targetSystemId: result.systemId,
      at: state.time,
      anchorSystemId: seq.targetSystemId,
    };
    seq.resultSystemId = result.systemId;
    return;
  }

  if (seq.type === 'jump') {
    commitJump(state, seq.targetSystemId);
    state.superweapon.jumpCooldownUntil = state.time + cooldownMsFor('jump', state);
    state.superweapon.lastAction = {
      type: 'jump',
      targetSystemId: seq.targetSystemId,
      at: state.time,
    };
  }
}

export function tickSuperweapon(state) {
  ensureSuperweapon(state);
  const seq = state.superweapon.fireSequence;
  if (!seq) return [];

  const info = sequencePhaseAt(seq, state.time);
  seq.phase = info.phase;

  if (!seq.resolved && state.time >= seq.resolveAt) {
    resolveFireSequence(state, seq);
  }

  if (state.time >= seq.startedAt + seq.totalMs) {
    state.superweapon.fireSequence = null;
  }
  return [];
}

/** Instant path for headless tests — skips cinema, still applies costs/cooldowns. */
export function superweaponCreate(state, anchorSystemId, { immediate = false } = {}) {
  if (!immediate) return requestSuperweaponCreate(state, anchorSystemId);
  const check = canStartAction(state, 'create', anchorSystemId);
  if (!check.ok) return check;
  state.solarii -= check.cost;
  const result = commitCreate(state, anchorSystemId);
  if (!result.ok) {
    state.solarii += check.cost;
    return result;
  }
  state.superweapon.cooldownUntil = state.time + cooldownMsFor('create', state);
  state.superweapon.lastAction = { type: 'create', targetSystemId: result.systemId, at: state.time };
  return result;
}

export function superweaponDestroy(state, targetSystemId, { immediate = false } = {}) {
  if (!immediate) return requestSuperweaponDestroy(state, targetSystemId);
  const check = canStartAction(state, 'destroy', targetSystemId);
  if (!check.ok) return check;
  const shield = tryBlockDestroyWithShield(state, targetSystemId);
  if (shield.blocked) return { ok: false, ...shield };
  state.solarii -= check.cost;
  const result = commitDestroy(state, targetSystemId);
  state.superweapon.cooldownUntil = state.time + cooldownMsFor('destroy', state);
  state.superweapon.lastAction = { type: 'destroy', targetSystemId, at: state.time };
  return result;
}

export function superweaponJump(state, targetSystemId, { immediate = false } = {}) {
  if (!immediate) return requestSuperweaponJump(state, targetSystemId);
  const check = canStartAction(state, 'jump', targetSystemId);
  if (!check.ok) return check;
  state.solarii -= check.cost;
  const result = commitJump(state, targetSystemId);
  state.superweapon.jumpCooldownUntil = state.time + cooldownMsFor('jump', state);
  state.superweapon.lastAction = { type: 'jump', targetSystemId, at: state.time };
  return result;
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

export function superweaponSummary(state) {
  ensureSuperweapon(state);
  const seq = fireSequenceStatus(state);
  const fx = techEffects(state);
  return {
    online: !!state.superweapon.online,
    cradleSystemId: state.superweapon.cradleSystemId,
    cooldownMs: Math.max(0, (state.superweapon.cooldownUntil ?? 0) - state.time),
    jumpCooldownMs: Math.max(0, (state.superweapon.jumpCooldownUntil ?? 0) - state.time),
    lastAction: state.superweapon.lastAction,
    createCount: state.superweapon.createCount ?? 0,
    panicUntil: state.superweapon.panicUntil ?? 0,
    fireSequence: seq,
    sovereignProtocol: !!fx.sovereignProtocol,
    costs: {
      create: solariiCostFor('create', state),
      destroy: solariiCostFor('destroy', state),
      jump: solariiCostFor('jump', state),
    },
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
