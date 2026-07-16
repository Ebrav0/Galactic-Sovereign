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
import { requireTutorialAccess } from './tutorial-access.js';
import { orderTravel } from './flagship.js';
import {
  canAttackSystem,
  canRouteThroughSystem,
  recordSystemDestroyed,
  triggerSuperweaponPanic,
} from './diplomacy.js';
import { orderBattleGroupTravel, battleGroupsForGalaxy } from './battle-groups.js';
import { assignGalaxyStellarCatalog } from './star-types.js';
import { applyGraphCatalogIdentity } from './catalog-names.js';

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
      installedParts: {},
    };
  }
  if (!state.superweapon.shieldCooldowns) state.superweapon.shieldCooldowns = {};
  if (state.superweapon.fireSequence === undefined) state.superweapon.fireSequence = null;
  if (!state.superweapon.installedParts || typeof state.superweapon.installedParts !== 'object') {
    state.superweapon.installedParts = {};
  }
}

/** Part ids that can be researched then installed on the cradle skeleton. */
export const SUPERWEAPON_PART_IDS = Object.freeze([
  'frame', 'power', 'focus', 'create', 'destroy', 'jump',
]);

const PART_LABELS = Object.freeze({
  frame: 'Cradle Frame',
  power: 'Power Core',
  focus: 'Focus Array',
  create: 'Genesis Skeleton',
  destroy: 'Annihilation Skeleton',
  jump: 'Jump Skeleton',
});

const PART_INSTALL_COST = Object.freeze({
  frame: { credits: 0, solarii: 0 },
  power: { credits: 1200, solarii: 4 },
  focus: { credits: 1400, solarii: 5 },
  create: { credits: 1600, solarii: 6 },
  destroy: { credits: 1800, solarii: 7 },
  jump: { credits: 1500, solarii: 5 },
});

export function hasSuperweaponPart(state, partId) {
  ensureSuperweapon(state);
  return !!state.superweapon.installedParts?.[partId];
}

export function refreshSuperweaponOnline(state) {
  ensureSuperweapon(state);
  const fx = techEffects(state);
  const parts = state.superweapon.installedParts;
  const hasCradle = !!state.superweapon.cradleSystemId
    || Object.values(getSystems(state)).some((system) =>
      (system.structures ?? []).some((s) => s.type === 'superweapon_cradle'));
  if (!hasCradle) {
    state.superweapon.online = false;
    return state.superweapon.online;
  }
  // Power + focus installed → charge-capable; Novacula research = full online.
  const charged = !!(parts.power && parts.focus);
  state.superweapon.online = charged && (!!fx.novaculaOnline || !!fx.sovereignProtocol
    || !!(parts.create && parts.destroy && parts.jump));
  // Allow mode fire once that mode part is installed even before full Novacula,
  // as long as power+focus are present (partial online for modes).
  if (charged && (parts.create || parts.destroy || parts.jump)) {
    state.superweapon.online = true;
  }
  return state.superweapon.online;
}

export function canInstallSuperweaponPart(state, partId) {
  ensureSuperweapon(state);
  if (!SUPERWEAPON_PART_IDS.includes(partId)) {
    return { ok: false, reason: 'Unknown cradle part' };
  }
  if (!state.superweapon.cradleSystemId && !hasSuperweaponCradle(state, state.stronghold)) {
    return { ok: false, reason: 'Build the cradle frame first' };
  }
  const fx = techEffects(state);
  if (!fx.swPartBlueprints?.[partId] && partId !== 'frame') {
    return { ok: false, reason: `Research ${PART_LABELS[partId] ?? partId} first` };
  }
  if (partId === 'frame' && !isTechUnlocked(state, 'sw_cradle_unlock')) {
    return { ok: false, reason: 'Research Cradle Frame first' };
  }
  if (hasSuperweaponPart(state, partId)) {
    return { ok: false, reason: `${PART_LABELS[partId] ?? partId} already installed` };
  }
  if (partId === 'power' && !hasSuperweaponPart(state, 'frame')) {
    return { ok: false, reason: 'Install cradle frame first' };
  }
  if (partId === 'focus' && !hasSuperweaponPart(state, 'power')) {
    return { ok: false, reason: 'Install power core first' };
  }
  if (['create', 'destroy', 'jump'].includes(partId) && !hasSuperweaponPart(state, 'focus')) {
    return { ok: false, reason: 'Install focus array first' };
  }
  const cost = PART_INSTALL_COST[partId] ?? { credits: 0, solarii: 0 };
  if (state.credits < cost.credits) return { ok: false, reason: `Need ${cost.credits} credits` };
  if ((state.solarii ?? 0) < cost.solarii) return { ok: false, reason: `Need ${cost.solarii} Solarii` };
  return { ok: true, cost };
}

export function installSuperweaponPart(state, partId) {
  const check = canInstallSuperweaponPart(state, partId);
  if (!check.ok) return check;
  state.credits -= check.cost.credits;
  state.solarii = (state.solarii ?? 0) - check.cost.solarii;
  ensureSuperweapon(state);
  state.superweapon.installedParts[partId] = {
    installedAt: state.time,
    label: PART_LABELS[partId] ?? partId,
  };
  refreshSuperweaponOnline(state);
  return { ok: true, partId, online: state.superweapon.online };
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
    return { ok: false, reason: 'Research Cradle Frame first' };
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

export function buildSuperweaponCradle(state, systemId = state.stronghold, opts = {}) {
  const tutorial = requireTutorialAccess(state, 'superweapon', { bypass: opts.tutorialBypass });
  if (!tutorial.ok) return tutorial;
  const check = canBuildSuperweaponCradle(state, systemId);
  if (!check.ok) return check;

  state.credits -= SUPERWEAPON_CRADLE_COST;
  state.solarii -= SUPERWEAPON_CRADLE_SOLARII;
  ensureSuperweapon(state);
  state.superweapon.cradleSystemId = systemId;
  state.superweapon.online = false;
  state.superweapon.installedParts.frame = {
    installedAt: state.time,
    label: PART_LABELS.frame,
  };

  const system = systemById(state, systemId);
  system.structures.push({
    id: allocateStructureId(),
    type: 'superweapon_cradle',
    bodyId: null,
    builtAtTime: state.time,
  });
  refreshSuperweaponOnline(state);
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
  refreshSuperweaponOnline(state);
  if (!state.superweapon.online) {
    return { ok: false, reason: 'Install power core and focus array on the cradle first' };
  }
  if (state.superweapon.fireSequence) return { ok: false, reason: 'Superweapon already firing' };

  if (type === 'create') {
    if (!isTechUnlocked(state, 'sw_create_star')) return { ok: false, reason: 'Research Genesis Skeleton first' };
    if (!hasSuperweaponPart(state, 'create')) {
      return { ok: false, reason: 'Install Genesis Skeleton on the cradle' };
    }
    if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
    if (!nodeById(getGraph(state), targetSystemId)) return { ok: false, reason: 'Invalid anchor system' };
  } else if (type === 'destroy') {
    if (!isTechUnlocked(state, 'sw_destroy_star')) return { ok: false, reason: 'Research Annihilation Skeleton first' };
    if (!hasSuperweaponPart(state, 'destroy')) {
      return { ok: false, reason: 'Install Annihilation Skeleton on the cradle' };
    }
    if (targetSystemId === state.stronghold || targetSystemId === BLACK_HOLE_ID) {
      return { ok: false, reason: 'Cannot destroy the Stronghold or galactic core' };
    }
    if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
    if (!getSystems(state)[targetSystemId]) return { ok: false, reason: 'No such system' };
    const attack = canAttackSystem(state, targetSystemId, 'player', { galaxyId: state.activeGalaxyId });
    if (!attack.ok) return attack;
  } else if (type === 'jump') {
    if (!isTechUnlocked(state, 'sw_jump_gate')) return { ok: false, reason: 'Research Jump Skeleton first' };
    if (!hasSuperweaponPart(state, 'jump')) {
      return { ok: false, reason: 'Install Jump Skeleton on the cradle' };
    }
    if (onCooldown(state, 'jumpCooldownUntil')) return { ok: false, reason: 'Jump on cooldown' };
    if (!nodeById(getGraph(state), targetSystemId)) return { ok: false, reason: 'Invalid target star' };
    const transit = canRouteThroughSystem(state, targetSystemId, 'player', {
      galaxyId: state.activeGalaxyId,
      allowHostile: true,
    });
    if (!transit.ok) return transit;
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
  const galaxySeed = hashSeed(state.meta.seed, `galaxy:${state.activeGalaxyId}`);
  assignGalaxyStellarCatalog(graph, gal.strongholdStarId, galaxySeed, { preserveExisting: true });
  applyGraphCatalogIdentity(graph, state.activeGalaxyId);

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
  const attack = canAttackSystem(state, targetSystemId, 'player', { galaxyId: state.activeGalaxyId });
  if (!attack.ok) return attack;

  recordSystemDestroyed(state, {
    galaxyId: state.activeGalaxyId,
    systemId: targetSystemId,
    actor: 'player',
  });
  purgeSystemEntities(state, targetSystemId, state.activeGalaxyId);
  delete gal.systems[targetSystemId];
  graph.stars = graph.stars.filter((s) => s.id !== targetSystemId);
  graph.lanes = graph.lanes.filter(([a, b]) => a !== targetSystemId && b !== targetSystemId);
  triggerSuperweaponPanic(state);
  return { ok: true, systemId: targetSystemId, starCount: graph.stars.length };
}

function commitJump(state, targetSystemId) {
  const travel = orderTravel(state, targetSystemId);
  if (!travel.ok) return travel;
  for (const group of battleGroupsForGalaxy(state)) {
    if (group.shipIds.length > 0) {
      orderBattleGroupTravel(state, group.id, targetSystemId);
    }
  }
  return { ok: true, targetSystemId, travel };
}

function resolveFireSequence(state, seq) {
  if (seq.resolved) return;
  seq.resolved = true;

  if (seq.type === 'destroy') {
    const authorization = canAttackSystem(state, seq.targetSystemId, 'player', {
      galaxyId: state.activeGalaxyId,
    });
    if (!authorization.ok) {
      seq.blocked = true;
      seq.failureReason = authorization.reason;
      state.solarii = (state.solarii ?? 0) + (seq.costPaid ?? 0);
      state.superweapon.lastAction = {
        type: 'destroy', targetSystemId: seq.targetSystemId, at: state.time,
        blocked: true, reason: authorization.reason,
      };
      return;
    }
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
    if (!result.ok) {
      seq.blocked = true;
      seq.failureReason = result.reason;
      state.solarii = (state.solarii ?? 0) + (seq.costPaid ?? 0);
      state.superweapon.lastAction = {
        type: 'destroy', targetSystemId: seq.targetSystemId, at: state.time,
        blocked: true, reason: result.reason,
      };
      return;
    }
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
    const result = commitJump(state, seq.targetSystemId);
    if (!result.ok) {
      seq.blocked = true;
      seq.failureReason = result.reason;
      state.solarii = (state.solarii ?? 0) + (seq.costPaid ?? 0);
      state.superweapon.lastAction = {
        type: 'jump', targetSystemId: seq.targetSystemId, at: state.time,
        blocked: true, reason: result.reason,
      };
      return;
    }
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
export function superweaponCreate(state, anchorSystemId, { immediate = false, tutorialBypass = false } = {}) {
  const tutorial = requireTutorialAccess(state, 'superweapon', { bypass: tutorialBypass });
  if (!tutorial.ok) return tutorial;
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

export function superweaponDestroy(state, targetSystemId, { immediate = false, tutorialBypass = false } = {}) {
  const tutorial = requireTutorialAccess(state, 'superweapon', { bypass: tutorialBypass });
  if (!tutorial.ok) return tutorial;
  if (!immediate) return requestSuperweaponDestroy(state, targetSystemId);
  const check = canStartAction(state, 'destroy', targetSystemId);
  if (!check.ok) return check;
  const shield = tryBlockDestroyWithShield(state, targetSystemId);
  if (shield.blocked) return { ok: false, ...shield };
  state.solarii -= check.cost;
  const result = commitDestroy(state, targetSystemId);
  if (!result.ok) {
    state.solarii += check.cost;
    state.superweapon.lastAction = {
      type: 'destroy', targetSystemId, at: state.time, blocked: true, reason: result.reason,
    };
    return result;
  }
  state.superweapon.cooldownUntil = state.time + cooldownMsFor('destroy', state);
  state.superweapon.lastAction = { type: 'destroy', targetSystemId, at: state.time };
  return result;
}

export function superweaponJump(state, targetSystemId, { immediate = false, tutorialBypass = false } = {}) {
  const tutorial = requireTutorialAccess(state, 'superweapon', { bypass: tutorialBypass });
  if (!tutorial.ok) return tutorial;
  if (!immediate) return requestSuperweaponJump(state, targetSystemId);
  const check = canStartAction(state, 'jump', targetSystemId);
  if (!check.ok) return check;
  state.solarii -= check.cost;
  const result = commitJump(state, targetSystemId);
  if (!result.ok) {
    state.solarii += check.cost;
    return result;
  }
  state.superweapon.jumpCooldownUntil = state.time + cooldownMsFor('jump', state);
  state.superweapon.lastAction = { type: 'jump', targetSystemId, at: state.time };
  return result;
}

function purgeSystemEntities(state, systemId, galaxyId = state.activeGalaxyId) {
  const sameGalaxy = (entity) => (entity?.galaxyId ?? state.activeGalaxyId) === galaxyId;
  const referencesSystem = (entity) => entity?.systemId === systemId
    || entity?.targetSystemId === systemId
    || entity?.rallyStarId === systemId
    || entity?.transit?.path?.includes?.(systemId)
    || entity?.returnTransit?.path?.includes?.(systemId)
    ? sameGalaxy(entity)
    : false;
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
      if (sameGalaxy(depot) && (depot.systemId === systemId || depot.nexusSystemId === systemId)) {
        removedDepotIds.add(depotId);
        delete logistics.depots[depotId];
      }
    }
    logistics.routes = (logistics.routes ?? []).filter((route) => (
      !removedDepotIds.has(route.depotId)
      && (!sameGalaxy(route) || (
        route.fromSystemId !== systemId
        && route.toSystemId !== systemId
        && route.nexusSystemId !== systemId
        && !route.path?.includes?.(systemId)
      ))
    ));
    const removedConvoys = (logistics.convoys ?? []).filter((convoy) => (
      sameGalaxy(convoy) && (
        removedDepotIds.has(convoy.depotId)
        || convoy.fromSystemId === systemId
        || convoy.toSystemId === systemId
        || convoy.nexusSystemId === systemId
        || convoy.path?.includes?.(systemId)
      )
    ));
    logistics.convoys = (logistics.convoys ?? []).filter((convoy) => !removedConvoys.includes(convoy));
    logistics.stats ??= {};
    logistics.stats.convoysLost = (logistics.stats.convoysLost ?? 0) + removedConvoys.length;
    logistics.localTransports = (logistics.localTransports ?? []).filter((transport) => (
      !sameGalaxy(transport) || (transport.systemId !== systemId && !removedDepotIds.has(transport.depotId))
    ));
    for (const key of Object.keys(logistics.outpostStock ?? {})) {
      const stock = logistics.outpostStock[key];
      if ((stock?.galaxyId ?? state.activeGalaxyId) === galaxyId
        && (stock?.systemId === systemId || key.includes(`:${systemId}:`))) delete logistics.outpostStock[key];
    }
    logistics.blockades.systems = (logistics.blockades?.systems ?? [])
      .filter((key) => !(key.startsWith(`${galaxyId}:`) && key.endsWith(`:${systemId}`)));
    logistics.blockades.lanes = (logistics.blockades?.lanes ?? [])
      .filter((key) => !(key.startsWith(`${galaxyId}:`)
        && key.split(':').at(-1)?.split('|').includes(systemId)));
  }

  const galaxy = getActiveGalaxy(state);
  if (galaxy?.intel) delete galaxy.intel[systemId];
  if (galaxy?.capture) delete galaxy.capture[systemId];
  for (const faction of state.factions?.list ?? []) {
    if (faction.homeSystemId !== systemId || (faction.homeGalaxyId ?? galaxyId) !== galaxyId) continue;
    faction.homeSystemId = Object.values(getSystems(state))
      .find((system) => system.id !== systemId && system.owner === 'ai' && system.factionId === faction.id)?.id
      ?? null;
  }
  delete state.systemBattles?.[systemId];
}

export function superweaponSummary(state) {
  ensureSuperweapon(state);
  refreshSuperweaponOnline(state);
  const seq = fireSequenceStatus(state);
  const fx = techEffects(state);
  const parts = state.superweapon.installedParts ?? {};
  const blueprints = fx.swPartBlueprints ?? {};
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
    novaculaOnline: !!fx.novaculaOnline || !!fx.sovereignProtocol,
    installedParts: { ...parts },
    partStatus: SUPERWEAPON_PART_IDS.map((id) => ({
      id,
      label: PART_LABELS[id],
      installed: !!parts[id],
      blueprint: id === 'frame' || !!blueprints[id],
      canInstall: canInstallSuperweaponPart(state, id).ok,
    })),
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
