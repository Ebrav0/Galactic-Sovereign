// Helioclast cradle + deferred fire sequence (GDD §11).

import {
  HELIOCLAST_SHIPYARD_COST,
  HELIOCLAST_SHIPYARD_SOLARII,
  SUPERWEAPON_CREATE_SOLARII,
  SUPERWEAPON_DESTROY_SOLARII,
  SUPERWEAPON_JUMP_SOLARII,
  SUPERWEAPON_COOLDOWN_MS,
  SUPERWEAPON_JUMP_COOLDOWN_MS,
  SUPERWEAPON_PHASE_MS,
  SUPERWEAPON_JUMP_PHASE_MS,
  SHELL_COUNT,
  DYSON_SHIELD_COOLDOWN_MS,
  HELIOCLAST_HP,
  HELIOCLAST_LANE_SPEED,
  HELIOCLAST_SYSTEM_SPEED,
  HELIOCLAST_FOLLOW_OFFSET,
  HELIOCLAST_PART_BUILD_MS,
  HELIOCLAST_ID,
  SHIP_LANE_MIN_LEG_MS,
  STRUCTURE_BUILD_MS,
  TICK_MS,
} from './constants.js';
import { BLACK_HOLE_ID, neighborsOf, nodeById, findPath } from './galaxy.js';
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
import {
  canAttackSystem,
  canRouteThroughSystem,
  escalateHelioclastCrisis,
  recordSystemDestroyed,
} from './diplomacy.js';
import { assignGalaxyStellarCatalog } from './star-types.js';
import { applyGraphCatalogIdentity } from './catalog-names.js';
import { effectiveLegDurationMs } from './strategic-structures.js';
import {
  transitEtaMs,
  advanceTransit,
} from './transit.js';
import { queueConstructionJob, hasPendingJob } from './drones.js';
import { cradleWorldPose } from './superweapon-render.js';
import { advanceMissionObjective } from './missions.js';

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
      resolveNotify: null,
      installedParts: {},
      liveFireComplete: false,
      ship: null,
      buildJob: null,
    };
  }
  if (!state.superweapon.shieldCooldowns) state.superweapon.shieldCooldowns = {};
  if (state.superweapon.fireSequence === undefined) state.superweapon.fireSequence = null;
  if (state.superweapon.resolveNotify === undefined) state.superweapon.resolveNotify = null;
  if (!state.superweapon.installedParts || typeof state.superweapon.installedParts !== 'object') {
    state.superweapon.installedParts = {};
  }
  if (state.superweapon.liveFireComplete == null) state.superweapon.liveFireComplete = false;
  if (state.superweapon.buildJob === undefined) state.superweapon.buildJob = null;
  ensureHelioclastShip(state);
}

function defaultHelioclastShip(state) {
  const cradleId = state.superweapon?.cradleSystemId ?? state.stronghold;
  return {
    id: HELIOCLAST_ID,
    hull: 'helioclast',
    galaxyId: state.activeGalaxyId,
    systemId: cradleId,
    x: 220,
    y: -40,
    vx: 0,
    vy: 0,
    heading: 0,
    hp: HELIOCLAST_HP,
    maxHp: HELIOCLAST_HP,
    transit: null,
    fleetMode: 'flagship',
    battleGroupId: null,
  };
}

export function ensureHelioclastShip(state) {
  if (!state.superweapon) return null;
  if (!state.superweapon.ship || typeof state.superweapon.ship !== 'object') {
    state.superweapon.ship = defaultHelioclastShip(state);
  }
  const ship = state.superweapon.ship;
  ship.id = HELIOCLAST_ID;
  ship.hull = 'helioclast';
  ship.maxHp = HELIOCLAST_HP;
  if (!Number.isFinite(ship.hp)) ship.hp = HELIOCLAST_HP;
  if (ship.fleetMode !== 'group') ship.fleetMode = 'flagship';
  if (ship.fleetMode === 'flagship') ship.battleGroupId = null;
  return ship;
}

export function getHelioclastShip(state) {
  ensureSuperweapon(state);
  return state.superweapon.ship;
}

/**
 * Visual / mobility build stage 0–6.
 * 0 = yard only / empty berth; 1 frame; 2 power; 3 focus; 4 containment; 5 gate + live-fire/online; 6 mobile.
 * Mode skeletons (create/destroy/jump) are strategy parts and do not advance this stage.
 */
export function helioclastBuildStage(state) {
  ensureSuperweapon(state);
  if (!hasHelioclastShipyard(state, state.superweapon.cradleSystemId ?? state.stronghold)
      && !state.superweapon.cradleSystemId) {
    return 0;
  }
  const parts = state.superweapon.installedParts ?? {};
  if (!parts.frame) return 0;
  if (!parts.power) return 1;
  if (!parts.focus) return 2;
  if (!parts.containment) return 3;
  if (!parts.gate_cap) return 4;
  const fx = techEffects(state);
  const onlineTech = !!(fx.novaculaOnline || fx.helioclastOnline || fx.sovereignProtocol);
  if (state.superweapon.liveFireComplete && onlineTech) return 6;
  return 5;
}

/** Construction hull finished (Gate Capacitor installed) — live-fire / Online remain. */
export function helioclastConstructionComplete(state) {
  ensureSuperweapon(state);
  const parts = state.superweapon.installedParts ?? {};
  return !!(parts.frame && parts.power && parts.focus && parts.containment && parts.gate_cap);
}

/** Discrete stage + in-progress part fraction for berth draw. */
export function helioclastBuildProgress(state) {
  ensureSuperweapon(state);
  const stage = helioclastBuildStage(state);
  const job = state.superweapon.buildJob;
  if (!job) {
    return { stage, nextStage: null, jobProgress: 0, partId: null, remainingMs: 0 };
  }
  const duration = Math.max(1, job.durationMs ?? 1);
  const elapsed = Math.max(0, (state.time ?? 0) - (job.startedAt ?? 0));
  const jobProgress = Math.min(1, elapsed / duration);
  return {
    stage,
    nextStage: stage + 1,
    jobProgress,
    partId: job.partId,
    remainingMs: Math.max(0, duration - elapsed),
  };
}

export function isHelioclastMobile(state) {
  return helioclastBuildStage(state) >= 6 && (getHelioclastShip(state)?.hp ?? 0) > 0;
}

export function helioclastFiringSystemId(state) {
  ensureSuperweapon(state);
  const ship = getHelioclastShip(state);
  if (isHelioclastMobile(state) && ship?.systemId && !ship.transit) return ship.systemId;
  return state.superweapon.cradleSystemId ?? state.stronghold;
}

export function markLiveFireComplete(state) {
  ensureSuperweapon(state);
  const check = canMarkLiveFire(state);
  if (!check.ok) return check;
  state.superweapon.liveFireComplete = true;
  return { ok: true, liveFireComplete: true, buildStage: helioclastBuildStage(state) };
}

export function canMarkLiveFire(state) {
  ensureSuperweapon(state);
  if (state.superweapon.liveFireComplete) {
    return { ok: false, reason: 'Live-fire already complete' };
  }
  if (!helioclastConstructionComplete(state)) {
    return { ok: false, reason: 'Finish Gate Capacitor assembly first' };
  }
  const fx = techEffects(state);
  if (!fx.liveFireProtocol && !isTechUnlocked(state, 'sw_live_fire')) {
    return { ok: false, reason: 'Research Live-Fire Protocol first' };
  }
  return { ok: true };
}

/** Part ids that can be researched then installed on the cradle skeleton. */
export const SUPERWEAPON_PART_IDS = Object.freeze([
  'frame', 'power', 'focus', 'containment', 'gate_cap',
  'create', 'destroy', 'jump', 'sovereign_relay',
]);

const PART_LABELS = Object.freeze({
  frame: 'Cradle Frame',
  power: 'Power Core',
  focus: 'Focus Array',
  create: 'Genesis Skeleton',
  destroy: 'Annihilation Skeleton',
  jump: 'Jump Skeleton',
  containment: 'Containment Lattice',
  gate_cap: 'Gate Capacitor',
  sovereign_relay: 'Sovereign Relay',
});

const PART_INSTALL_COST = Object.freeze({
  frame: { credits: 0, solarii: 0 },
  power: { credits: 1200, solarii: 4 },
  focus: { credits: 1400, solarii: 5 },
  create: { credits: 1600, solarii: 6 },
  destroy: { credits: 1800, solarii: 7 },
  jump: { credits: 1500, solarii: 5 },
  containment: { credits: 1700, solarii: 6 },
  gate_cap: { credits: 1600, solarii: 5 },
  sovereign_relay: { credits: 1800, solarii: 6 },
});

export function hasSuperweaponPart(state, partId) {
  ensureSuperweapon(state);
  return !!state.superweapon.installedParts?.[partId];
}

export function refreshSuperweaponOnline(state) {
  ensureSuperweapon(state);
  const fx = techEffects(state);
  const parts = state.superweapon.installedParts;
  const hasYard = !!state.superweapon.cradleSystemId
    || hasHelioclastShipyard(state, state.stronghold);
  if (!hasYard) {
    state.superweapon.online = false;
    return state.superweapon.online;
  }
  // Power + focus installed → charge-capable; Helioclast research = full online.
  const charged = !!(parts.power && parts.focus);
  state.superweapon.online = charged && (!!fx.novaculaOnline || !!fx.helioclastOnline || !!fx.sovereignProtocol
    || !!(parts.create && parts.destroy && parts.jump));
  // Allow mode fire once that mode part is installed even before full Helioclast,
  // as long as power+focus are present (partial online for modes).
  if (charged && (parts.create || parts.destroy || parts.jump)) {
    state.superweapon.online = true;
  }
  return state.superweapon.online;
}

export function canInstallSuperweaponPart(state, partId) {
  ensureSuperweapon(state);
  if (!SUPERWEAPON_PART_IDS.includes(partId)) {
    return { ok: false, reason: 'Unknown berth part' };
  }
  if (!state.superweapon.cradleSystemId && !hasHelioclastShipyard(state, state.stronghold)) {
    return { ok: false, reason: 'Build the Helioclast shipyard first' };
  }
  if (findHelioclastShipyard(state)?.builtAtTime == null) {
    return { ok: false, reason: 'Helioclast shipyard is still under construction' };
  }
  if (state.superweapon.buildJob) {
    return { ok: false, reason: `Assembling ${PART_LABELS[state.superweapon.buildJob.partId] ?? 'part'}…` };
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
    return { ok: false, reason: 'Assemble keel frame first' };
  }
  if (partId === 'focus' && !hasSuperweaponPart(state, 'power')) {
    return { ok: false, reason: 'Assemble power core first' };
  }
  if (['create', 'destroy', 'jump'].includes(partId) && !hasSuperweaponPart(state, 'focus')) {
    return { ok: false, reason: 'Assemble focus array first' };
  }
  if (partId === 'destroy' && !hasSuperweaponPart(state, 'create')) {
    return { ok: false, reason: 'Assemble genesis skeleton first' };
  }
  if (partId === 'jump' && !hasSuperweaponPart(state, 'destroy')) {
    return { ok: false, reason: 'Assemble annihilation skeleton first' };
  }
  if (partId === 'containment' && !hasSuperweaponPart(state, 'focus')) {
    return { ok: false, reason: 'Assemble focus array first' };
  }
  if (partId === 'gate_cap' && !hasSuperweaponPart(state, 'containment')) {
    return { ok: false, reason: 'Assemble containment lattice first' };
  }
  if (partId === 'sovereign_relay' && !hasSuperweaponPart(state, 'jump')) {
    return { ok: false, reason: 'Assemble jump skeleton first' };
  }
  const cost = PART_INSTALL_COST[partId] ?? { credits: 0, solarii: 0 };
  if (state.credits < cost.credits) return { ok: false, reason: `Need ${cost.credits} credits` };
  if ((state.solarii ?? 0) < cost.solarii) return { ok: false, reason: `Need ${cost.solarii} Solarii` };
  return { ok: true, cost };
}

/** Start a timed berth assembly job (part is not installed until the timer completes). */
export function installSuperweaponPart(state, partId, { instant = false } = {}) {
  const check = canInstallSuperweaponPart(state, partId);
  if (!check.ok) return check;
  state.credits -= check.cost.credits;
  state.solarii = (state.solarii ?? 0) - check.cost.solarii;
  ensureSuperweapon(state);
  if (instant) {
    state.superweapon.installedParts[partId] = {
      installedAt: state.time,
      label: PART_LABELS[partId] ?? partId,
    };
    state.superweapon.buildJob = null;
    refreshSuperweaponOnline(state);
    return { ok: true, partId, online: state.superweapon.online, instant: true };
  }
  const durationMs = HELIOCLAST_PART_BUILD_MS[partId] ?? 18000;
  state.superweapon.buildJob = {
    partId,
    startedAt: state.time,
    durationMs,
  };
  return { ok: true, partId, buildJob: { ...state.superweapon.buildJob } };
}

export function completeHelioclastBuildJob(state) {
  ensureSuperweapon(state);
  const job = state.superweapon.buildJob;
  if (!job?.partId) return { ok: false, reason: 'No berth job' };
  state.superweapon.installedParts[job.partId] = {
    installedAt: state.time,
    label: PART_LABELS[job.partId] ?? job.partId,
  };
  const partId = job.partId;
  state.superweapon.buildJob = null;
  refreshSuperweaponOnline(state);
  return { ok: true, partId, online: state.superweapon.online };
}

function tickHelioclastBuild(state) {
  const job = state.superweapon?.buildJob;
  if (!job) return null;
  if ((state.time ?? 0) - (job.startedAt ?? 0) < (job.durationMs ?? 0)) return null;
  return completeHelioclastBuildJob(state);
}

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

function isHelioclastYardType(type) {
  return type === 'helioclast_shipyard' || type === 'superweapon_cradle';
}

export function findHelioclastShipyard(state, systemId = state.superweapon?.cradleSystemId ?? state.stronghold) {
  const system = systemById(state, systemId);
  return (system?.structures ?? []).find((s) => isHelioclastYardType(s.type)) ?? null;
}

/** True if a Helioclast yard exists (complete or still under construction). */
export function hasHelioclastShipyard(state, systemId) {
  return !!findHelioclastShipyard(state, systemId);
}

/** @deprecated alias — cradle renamed to Helioclast shipyard */
export function hasSuperweaponCradle(state, systemId) {
  return hasHelioclastShipyard(state, systemId);
}

export function canBuildHelioclastShipyard(state, systemId = state.stronghold) {
  refreshMilestones(state);
  if (!state.milestones?.superweaponUnlocked) {
    return { ok: false, reason: 'Requires 3 completed Dyson spheres' };
  }
  if (!isTechUnlocked(state, 'sw_cradle_unlock')) {
    return { ok: false, reason: 'Research Cradle Frame first' };
  }
  if (systemId !== state.stronghold) {
    return { ok: false, reason: 'Helioclast shipyard must be built at your Stronghold' };
  }
  if (!isPlayerOwned(state, systemId)) {
    return { ok: false, reason: 'Stronghold must be under your control' };
  }
  if (hasHelioclastShipyard(state, systemId) || hasPendingJob(state, systemId, null, 'helioclast_shipyard')) {
    return { ok: false, reason: 'Helioclast shipyard already exists' };
  }
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in the Stronghold' };
  }
  if (state.credits < HELIOCLAST_SHIPYARD_COST) {
    return { ok: false, reason: `Need ${HELIOCLAST_SHIPYARD_COST} credits` };
  }
  if ((state.solarii ?? 0) < HELIOCLAST_SHIPYARD_SOLARII) {
    return { ok: false, reason: `Need ${HELIOCLAST_SHIPYARD_SOLARII} Solarii` };
  }
  return { ok: true };
}

/** @deprecated */
export function canBuildSuperweaponCradle(state, systemId) {
  return canBuildHelioclastShipyard(state, systemId);
}

/** Activate berth state after the drone yard job completes (or Dev force). */
export function activateHelioclastShipyard(state, systemId = state.stronghold) {
  ensureSuperweapon(state);
  state.superweapon.cradleSystemId = systemId;
  state.superweapon.online = false;
  const ship = ensureHelioclastShip(state);
  const system = systemById(state, systemId);
  const pose = cradleWorldPose(system, state.time ?? 0);
  ship.galaxyId = state.activeGalaxyId;
  ship.systemId = systemId;
  ship.x = pose.x;
  ship.y = pose.y;
  ship.heading = pose.angle + Math.PI / 2;
  ship.transit = null;
  ship.hp = HELIOCLAST_HP;
  ship.maxHp = HELIOCLAST_HP;
  refreshSuperweaponOnline(state);
  return { ok: true, systemId };
}

export function buildHelioclastShipyard(state, systemId = state.stronghold, opts = {}) {
  const tutorial = requireTutorialAccess(state, 'superweapon', { bypass: opts.tutorialBypass });
  if (!tutorial.ok) return tutorial;
  const check = canBuildHelioclastShipyard(state, systemId);
  if (!check.ok) return check;

  // Solarii deducted here; credits via queueConstructionJob.
  state.solarii = (state.solarii ?? 0) - HELIOCLAST_SHIPYARD_SOLARII;

  if (opts.instant) {
    state.credits -= HELIOCLAST_SHIPYARD_COST;
    const system = systemById(state, systemId);
    system.structures.push({
      id: allocateStructureId(),
      type: 'helioclast_shipyard',
      bodyId: null,
      builtAtTime: state.time,
    });
    return activateHelioclastShipyard(state, systemId);
  }

  return queueConstructionJob(state, {
    systemId,
    structureType: 'helioclast_shipyard',
    bodyId: null,
    creditCost: HELIOCLAST_SHIPYARD_COST,
    durationMs: STRUCTURE_BUILD_MS.helioclast_shipyard,
  });
}

/** @deprecated alias */
export function buildSuperweaponCradle(state, systemId = state.stronghold, opts = {}) {
  return buildHelioclastShipyard(state, systemId, opts);
}

/** Sync cradleSystemId when a yard job finishes (called from tick). */
export function syncHelioclastShipyardActivation(state) {
  ensureSuperweapon(state);
  if (state.superweapon.cradleSystemId) return null;
  for (const system of Object.values(getSystems(state))) {
    const yard = (system.structures ?? []).find(
      (s) => isHelioclastYardType(s.type) && s.builtAtTime != null && !s.construction,
    );
    if (yard) {
      activateHelioclastShipyard(state, system.id);
      return { systemId: system.id, structureId: yard.id };
    }
  }
  return null;
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
    return { ok: false, reason: 'Install power core and focus array on the berth first' };
  }
  if (state.superweapon.fireSequence) return { ok: false, reason: 'Superweapon already firing' };

  if (type === 'create') {
    if (!isTechUnlocked(state, 'sw_create_star')) return { ok: false, reason: 'Research Genesis Skeleton first' };
    if (!hasSuperweaponPart(state, 'create')) {
      return { ok: false, reason: 'Assemble Genesis Skeleton on the berth' };
    }
    if (onCooldown(state)) return { ok: false, reason: 'Superweapon on cooldown' };
    if (!nodeById(getGraph(state), targetSystemId)) return { ok: false, reason: 'Invalid anchor system' };
    const fromId = helioclastFiringSystemId(state);
    const graph = getGraph(state);
    if (targetSystemId !== fromId && !neighborsOf(graph, fromId).includes(targetSystemId)) {
      return {
        ok: false,
        reason: 'Create anchor must be the firing system or a lane-adjacent star',
      };
    }
  } else if (type === 'destroy') {
    if (!isTechUnlocked(state, 'sw_destroy_star')) return { ok: false, reason: 'Research Annihilation Skeleton first' };
    if (!hasSuperweaponPart(state, 'destroy')) {
      return { ok: false, reason: 'Assemble Annihilation Skeleton on the berth' };
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
      return { ok: false, reason: 'Assemble Jump Skeleton on the berth' };
    }
    if (!isHelioclastMobile(state)) {
      return { ok: false, reason: 'Helioclast must complete live-fire and go mobile before Jump' };
    }
    if (onCooldown(state, 'jumpCooldownUntil')) return { ok: false, reason: 'Jump on cooldown' };
    if (!nodeById(getGraph(state), targetSystemId)) return { ok: false, reason: 'Invalid target star' };
    const ship = getHelioclastShip(state);
    if (ship?.systemId === targetSystemId && !ship?.transit) {
      return { ok: false, reason: 'Helioclast is already at that star' };
    }
    if (ship?.systemId && state.systemBattles?.[ship.systemId]?.active) {
      return { ok: false, reason: 'Cannot jump while the Helioclast is in combat' };
    }
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

/** Public readiness check for UI (costs, parts, adjacency, cooldowns). */
export function canSuperweaponAction(state, type, targetSystemId) {
  return canStartAction(state, type, targetSystemId);
}

function startFireSequence(state, type, targetSystemId) {
  const check = canStartAction(state, type, targetSystemId);
  if (!check.ok) return check;

  const timeline = phaseTimeline(type, state);
  const targetNode = nodeById(getGraph(state), targetSystemId);
  const targetSystem = systemById(state, targetSystemId);
  state.solarii -= check.cost;
  const resolveAt = state.time + timeline.phases.charge + timeline.phases.aim + timeline.phases.fire;
  state.superweapon.fireSequence = {
    type,
    fromSystemId: helioclastFiringSystemId(state),
    targetSystemId,
    targetPosition: targetNode ? { x: targetNode.x, y: targetNode.y } : null,
    targetName: targetSystem?.name ?? targetSystemId,
    targetOwner: targetSystem?.owner ?? null,
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
  escalateHelioclastCrisis(state, { actor: 'player', systemId: newId, destructive: false });
  return { ok: true, systemId: newId, starCount: graph.stars.length };
}

function commitDestroy(state, targetSystemId) {
  const gal = getActiveGalaxy(state);
  const graph = getGraph(state);
  if (!gal.systems[targetSystemId]) return { ok: false, reason: 'No such system' };
  const targetSystem = gal.systems[targetSystemId];
  const targetActor = targetSystem.owner === 'player' ? 'player' : targetSystem.factionId ?? targetSystem.owner;
  const inhabited = (targetSystem.bodies ?? []).some((body) => body.type === 'habitable');
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
  escalateHelioclastCrisis(state, {
    actor: 'player', target: targetActor, systemId: targetSystemId, destructive: true,
    foreignOrInhabited: targetActor !== 'player' || inhabited,
  });
  return { ok: true, systemId: targetSystemId, starCount: graph.stars.length };
}

function commitJump(state, targetSystemId) {
  // Cinematic Jump teleports the siege ship — lane travel stays on orderHelioclastTravel.
  const ship = ensureHelioclastShip(state);
  if (!isHelioclastMobile(state)) {
    return { ok: false, reason: 'Helioclast is not yet mobile' };
  }
  if (!ship || ship.hp <= 0) return { ok: false, reason: 'Helioclast is not available' };
  if (ship.systemId && state.systemBattles?.[ship.systemId]?.active) {
    return { ok: false, reason: 'Cannot jump while the Helioclast is in combat' };
  }
  const system = systemById(state, targetSystemId);
  if (!system) return { ok: false, reason: 'No such system' };

  const pose = cradleWorldPose(system, state.time ?? 0);
  ship.transit = null;
  ship.galaxyId = state.activeGalaxyId;
  ship.systemId = targetSystemId;
  ship.x = pose.x;
  ship.y = pose.y;
  ship.vx = 0;
  ship.vy = 0;
  ship.heading = Math.atan2(-(pose.y ?? 0), -(pose.x ?? 1));
  const f = state.flagship;
  if (f && f.systemId === targetSystemId && !f.transit && Number.isFinite(f.heading)) {
    ship.heading = f.heading;
  }
  return { ok: true, targetSystemId, teleported: true };
}

function pushResolveNotify(state, payload) {
  state.superweapon.resolveNotify = {
    ...payload,
    at: state.time,
  };
}

function noteDestroyProgress(state) {
  if (!state.campaign) return;
  state.campaign.missionProgress = state.campaign.missionProgress ?? {};
  state.campaign.missionProgress.destroyCount =
    (state.campaign.missionProgress.destroyCount ?? 0) + 1;
}

function noteLiveFireIfEligible(state, type) {
  if (type !== 'create' && type !== 'destroy') return;
  if (!helioclastConstructionComplete(state)) return;
  const fx = techEffects(state);
  if (!fx.liveFireProtocol && !isTechUnlocked(state, 'sw_live_fire')) return;
  state.superweapon.liveFireComplete = true;
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
      pushResolveNotify(state, {
        type: 'destroy', ok: false, blocked: true, reason: authorization.reason,
        targetSystemId: seq.targetSystemId,
      });
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
      pushResolveNotify(state, {
        type: 'destroy',
        ok: false,
        blocked: true,
        reason: 'Dyson shield blocked destruction',
        targetSystemId: seq.targetSystemId,
        partnerSystemId: shield.partnerSystemId,
      });
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
      pushResolveNotify(state, {
        type: 'destroy', ok: false, blocked: true, reason: result.reason,
        targetSystemId: seq.targetSystemId,
      });
      return;
    }
    state.superweapon.cooldownUntil = state.time + cooldownMsFor('destroy', state);
    state.superweapon.lastAction = {
      type: 'destroy',
      targetSystemId: seq.targetSystemId,
      targetPosition: seq.targetPosition,
      at: state.time,
      blocked: false,
    };
    seq.resultSystemId = result.systemId;
    noteLiveFireIfEligible(state, 'destroy');
    noteDestroyProgress(state);
    pushResolveNotify(state, {
      type: 'destroy', ok: true, targetSystemId: seq.targetSystemId,
    });
    return;
  }

  if (seq.type === 'create') {
    const result = commitCreate(state, seq.targetSystemId);
    if (!result.ok) {
      seq.blocked = true;
      seq.failureReason = result.reason;
      state.solarii = (state.solarii ?? 0) + (seq.costPaid ?? 0);
      pushResolveNotify(state, {
        type: 'create', ok: false, reason: result.reason, targetSystemId: seq.targetSystemId,
      });
      return;
    }
    state.superweapon.cooldownUntil = state.time + cooldownMsFor('create', state);
    state.superweapon.lastAction = {
      type: 'create',
      targetSystemId: result.systemId,
      at: state.time,
      anchorSystemId: seq.targetSystemId,
    };
    seq.resultSystemId = result.systemId;
    noteLiveFireIfEligible(state, 'create');
    advanceMissionObjective(state, 'superweapon_sculpt', 'create_star');
    pushResolveNotify(state, {
      type: 'create', ok: true, targetSystemId: result.systemId, anchorSystemId: seq.targetSystemId,
    });
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
      pushResolveNotify(state, {
        type: 'jump', ok: false, blocked: true, reason: result.reason,
        targetSystemId: seq.targetSystemId,
      });
      return;
    }
    state.superweapon.jumpCooldownUntil = state.time + cooldownMsFor('jump', state);
    state.superweapon.lastAction = {
      type: 'jump',
      targetSystemId: seq.targetSystemId,
      fromSystemId: seq.fromSystemId,
      at: state.time,
    };
    pushResolveNotify(state, {
      type: 'jump', ok: true, targetSystemId: seq.targetSystemId, teleported: true,
    });
  }
}

export function orderHelioclastTravel(state, targetId, { allowImmobileJump = false } = {}) {
  ensureSuperweapon(state);
  const ship = ensureHelioclastShip(state);
  if (!allowImmobileJump && !isHelioclastMobile(state)) {
    return { ok: false, reason: 'Helioclast must complete live-fire calibration and come online before leaving berth' };
  }
  if (!ship || ship.hp <= 0) return { ok: false, reason: 'Helioclast is not available' };
  if (ship.transit) return { ok: false, reason: 'Helioclast is already in transit' };
  if (ship.galaxyId !== state.activeGalaxyId) return { ok: false, reason: 'Helioclast not in active galaxy' };
  if (!ship.systemId) return { ok: false, reason: 'Helioclast has no location' };
  if (state.systemBattles?.[ship.systemId]?.active) {
    return { ok: false, reason: 'Helioclast is engaged in combat' };
  }
  if (targetId === ship.systemId) return { ok: false, reason: 'Helioclast is already at that star' };

  const galaxy = getGraph(state);
  const path = findPath(galaxy, ship.systemId, targetId, {
    canEnter: (systemId) => canRouteThroughSystem(
      state,
      systemId,
      'player',
      { galaxyId: state.activeGalaxyId, allowHostile: true },
    ).ok,
  });
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  const speed = HELIOCLAST_LANE_SPEED;
  const durFn = (a, b) => effectiveLegDurationMs(state, galaxy, a, b, speed, SHIP_LANE_MIN_LEG_MS);
  ship.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: durFn(path[0], path[1]),
  };
  ship.systemId = null;
  return {
    ok: true,
    path,
    etaMs: transitEtaMs(ship.transit, galaxy, state.time, speed, SHIP_LANE_MIN_LEG_MS),
  };
}

export function setHelioclastFleetMode(state, mode, battleGroupId = null) {
  ensureSuperweapon(state);
  const ship = ensureHelioclastShip(state);
  if (!isHelioclastMobile(state)) {
    return { ok: false, reason: 'Helioclast is not yet mobile' };
  }
  const groups = state.battleGroups ?? [];
  if (mode === 'flagship') {
    for (const group of groups) {
      group.shipIds = (group.shipIds ?? []).filter((id) => id !== HELIOCLAST_ID);
    }
    ship.fleetMode = 'flagship';
    ship.battleGroupId = null;
    return { ok: true, fleetMode: 'flagship' };
  }
  if (mode === 'group') {
    const group = groups.find((g) => g.id === battleGroupId) ?? null;
    if (!group) return { ok: false, reason: 'No such fleet' };
    for (const g of groups) {
      g.shipIds = (g.shipIds ?? []).filter((id) => id !== HELIOCLAST_ID);
    }
    if (!(group.shipIds ?? []).includes(HELIOCLAST_ID)) {
      group.shipIds = [...(group.shipIds ?? []), HELIOCLAST_ID];
    }
    ship.fleetMode = 'group';
    ship.battleGroupId = group.id;
    return { ok: true, fleetMode: 'group', battleGroupId: group.id };
  }
  return { ok: false, reason: 'Unknown fleet mode' };
}

export function tickHelioclastShip(state) {
  ensureSuperweapon(state);
  const ship = ensureHelioclastShip(state);

  // Docked at berth until mobile.
  if (!isHelioclastMobile(state)) {
    const berthId = state.superweapon.cradleSystemId;
    if (berthId && !ship.transit) {
      const system = systemById(state, berthId);
      if (system) {
        const pose = cradleWorldPose(system, state.time ?? 0);
        ship.galaxyId = state.activeGalaxyId;
        ship.systemId = berthId;
        ship.x = pose.x;
        ship.y = pose.y;
        ship.heading = pose.angle + Math.PI / 2;
      }
    }
    return [];
  }

  if (!ship?.transit) {
    if (ship.fleetMode === 'flagship') {
      const f = state.flagship;
      if (
        f
        && !f.transit
        && !f.wormholeTransit
        && f.galaxyId === state.activeGalaxyId
        && f.systemId
        && ship.galaxyId === f.galaxyId
        && ship.systemId
        && ship.systemId !== f.systemId
      ) {
        orderHelioclastTravel(state, f.systemId);
      } else if (f && ship.systemId === f.systemId && !ship.transit) {
        // Slow in-system chase toward aft-starboard escort slot.
        const heading = Number.isFinite(f.heading) ? f.heading : 0;
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const ox = HELIOCLAST_FOLLOW_OFFSET.x;
        const oy = HELIOCLAST_FOLLOW_OFFSET.y;
        const tx = (f.x ?? 0) + ox * cos - oy * sin;
        const ty = (f.y ?? 0) + ox * sin + oy * cos;
        const dx = tx - (ship.x ?? 0);
        const dy = ty - (ship.y ?? 0);
        const dist = Math.hypot(dx, dy);
        const dt = TICK_MS / 1000;
        const step = HELIOCLAST_SYSTEM_SPEED * dt;
        if (dist > 12) {
          const ux = dx / dist;
          const uy = dy / dist;
          const move = Math.min(step, dist);
          ship.x = (ship.x ?? 0) + ux * move;
          ship.y = (ship.y ?? 0) + uy * move;
          ship.heading = Math.atan2(uy, ux);
        } else {
          ship.x = tx;
          ship.y = ty;
          ship.heading = heading;
        }
      }
    }
    return [];
  }

  const galaxy = getGraph(state);
  const arrivals = [];
  const speed = HELIOCLAST_LANE_SPEED;
  const durFn = (a, b) => effectiveLegDurationMs(state, galaxy, a, b, speed, SHIP_LANE_MIN_LEG_MS);
  advanceTransit(
    ship.transit,
    galaxy,
    state.time,
    speed,
    SHIP_LANE_MIN_LEG_MS,
    (destId) => {
      ship.transit = null;
      ship.systemId = destId;
      arrivals.push({ shipId: HELIOCLAST_ID, systemId: destId });
    },
    durFn,
  );
  return arrivals;
}

export function tickSuperweapon(state) {
  ensureSuperweapon(state);
  syncHelioclastShipyardActivation(state);
  tickHelioclastBuild(state);
  tickHelioclastShip(state);
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
  noteLiveFireIfEligible(state, 'create');
  advanceMissionObjective(state, 'superweapon_sculpt', 'create_star');
  pushResolveNotify(state, {
    type: 'create', ok: true, targetSystemId: result.systemId, immediate: true,
  });
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
  noteLiveFireIfEligible(state, 'destroy');
  noteDestroyProgress(state);
  pushResolveNotify(state, {
    type: 'destroy', ok: true, targetSystemId, immediate: true,
  });
  return result;
}

export function superweaponJump(state, targetSystemId, { immediate = false, tutorialBypass = false } = {}) {
  const tutorial = requireTutorialAccess(state, 'superweapon', { bypass: tutorialBypass });
  if (!tutorial.ok) return tutorial;
  if (!immediate) return requestSuperweaponJump(state, targetSystemId);
  const check = canStartAction(state, 'jump', targetSystemId);
  if (!check.ok) return check;
  state.solarii -= check.cost;
  const fromSystemId = helioclastFiringSystemId(state);
  const result = commitJump(state, targetSystemId);
  if (!result.ok) {
    state.solarii += check.cost;
    return result;
  }
  state.superweapon.jumpCooldownUntil = state.time + cooldownMsFor('jump', state);
  state.superweapon.lastAction = {
    type: 'jump',
    targetSystemId,
    fromSystemId,
    at: state.time,
  };
  pushResolveNotify(state, {
    type: 'jump', ok: true, targetSystemId, teleported: true, immediate: true,
  });
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
    novaculaOnline: !!fx.novaculaOnline || !!fx.helioclastOnline || !!fx.sovereignProtocol,
    liveFireComplete: !!state.superweapon.liveFireComplete,
    buildStage: helioclastBuildStage(state),
    buildProgress: helioclastBuildProgress(state),
    buildJob: state.superweapon.buildJob ? { ...state.superweapon.buildJob } : null,
    mobile: isHelioclastMobile(state),
    ship: state.superweapon.ship ? { ...state.superweapon.ship } : null,
    installedParts: { ...parts },
    partStatus: SUPERWEAPON_PART_IDS.map((id) => ({
      id,
      label: PART_LABELS[id],
      installed: !!parts[id],
      blueprint: id === 'frame' || !!blueprints[id],
      canInstall: canInstallSuperweaponPart(state, id).ok,
      assembling: state.superweapon.buildJob?.partId === id,
    })),
    costs: {
      create: solariiCostFor('create', state),
      destroy: solariiCostFor('destroy', state),
      jump: solariiCostFor('jump', state),
    },
  };
}

/** Consume one-shot resolve toast payload (UI). */
export function takeSuperweaponResolveNotify(state) {
  ensureSuperweapon(state);
  const note = state.superweapon.resolveNotify;
  state.superweapon.resolveNotify = null;
  return note;
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
