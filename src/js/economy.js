// Economy: outpost/shipyard construction and credit income (GDD §6).
// May mutate state.credits and system structures. Never touches DOM/canvas.

import {
  OUTPOST_COST,
  OUTPOST_BASE_INCOME,
  MOON_YIELD_BONUS,
  SHELL_BONUS_CREDIT_MULT,
  TICK_MS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import {
  systemById,
  findPlanet,
  hasOutpost,
  isPlayerOwned,
  isStructureActive,
  pendingStructureOnBody,
} from './state.js';
import { getSystems } from './galaxy-scope.js';
import { flagshipInSystem } from './flagship-presence.js';
import { hasPendingJob, queueConstructionJob } from './drones.js';
import { techEffects } from './tech-web.js';

let nextStructureId = 1;

export function resetStructureIds(state) {
  // Called after load so new ids never collide with saved ones.
  let max = 0;
  if (state.galaxies) {
    for (const gal of Object.values(state.galaxies)) {
      const systemRecords = [
        ...Object.values(gal.systems ?? {}),
        ...Object.values(gal.abstract?.systemOverlays ?? {}),
      ];
      for (const system of systemRecords) {
        for (const s of system.structures) {
          const n = parseInt(String(s.id).replace('st', ''), 10);
          if (Number.isFinite(n)) max = Math.max(max, n);
        }
      }
    }
  } else {
    for (const system of Object.values(state.systems ?? {})) {
      for (const s of system.structures) {
        const n = parseInt(String(s.id).replace('st', ''), 10);
        if (Number.isFinite(n)) max = Math.max(max, n);
      }
    }
  }
  nextStructureId = max + 1;
}

export function allocateStructureId() {
  return `st${nextStructureId++}`;
}

// Returns {ok} or {ok:false, reason} — UI displays the reason verbatim.
export function canBuildOutpost(state, systemId, planetId, opts = {}) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  const remote = !!opts.remote;
  if (!isPlayerOwned(state, systemId)) {
    if (!remote || system.owner !== 'neutral') return { ok: false, reason: 'System not under your control' };
  }
  const planet = findPlanet(state, systemId, planetId);
  if (!planet) return { ok: false, reason: 'No such planet' };
  if (planet.type === 'gas') return { ok: false, reason: 'Gas giants have no surface — orbital structures only' };
  if (planet.type === 'barren') return { ok: false, reason: 'Barren world — cannot support an outpost (v0)' };
  if (hasOutpost(state, systemId, planetId)) return { ok: false, reason: 'Outpost already built' };
  if (pendingStructureOnBody(state, systemId, planetId, 'outpost')) {
    return { ok: false, reason: 'Outpost construction already in progress' };
  }
  if (hasPendingJob(state, systemId, planetId, 'outpost')) {
    return { ok: false, reason: 'Outpost construction already in progress' };
  }
  if (!remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (!opts.ignoreCredits && state.credits < OUTPOST_COST) return { ok: false, reason: `Need ${OUTPOST_COST} credits` };
  return { ok: true };
}

export function buildOutpost(state, systemId, planetId, opts = {}) {
  const check = canBuildOutpost(state, systemId, planetId, opts);
  if (!check.ok) return check;

  if (!opts.remote) {
    return queueConstructionJob(state, {
      systemId,
      structureType: 'outpost',
      bodyId: planetId,
      creditCost: OUTPOST_COST,
      durationMs: STRUCTURE_BUILD_MS.outpost,
    });
  }

  if (!opts.alreadyPaid) state.credits -= OUTPOST_COST;
  const system = systemById(state, systemId);
  if (opts.remote && system.owner === 'neutral') system.owner = 'player';
  system.structures.push({
    id: allocateStructureId(),
    type: 'outpost',
    bodyId: planetId,
    builtAtTime: state.time,
    level: 1,
    hp: 240,
    maxHp: 240,
    operational: true,
  });
  // The flat passive stipend coexists with the physical cargo chain. The first
  // outpost in a normal system commissions one system-wide export depot.
  if (system.star?.kind !== 'trade_nexus'
      && !system.structures.some((structure) => structure.type === 'export_depot')) {
    system.structures.push({
      id: allocateStructureId(),
      type: 'export_depot',
      bodyId: null,
      builtAtTime: state.time,
      hp: 520,
      maxHp: 520,
      operational: true,
    });
  }
  return { ok: true };
}

export function isOperationalOutpost(state, structure) {
  return structure?.type === 'outpost'
    && isStructureActive(structure)
    && structure.operational !== false
    && (structure.hp ?? 1) > 0
    && (state.time ?? 0) >= (structure.disabledUntil ?? 0)
    && !structure.mothballed;
}

function persistentSystems(state) {
  if (!state.galaxies) return Object.values(getSystems(state));
  const systems = [];
  for (const galaxy of Object.values(state.galaxies)) {
    const hydrated = Object.values(galaxy.systems ?? {});
    if (hydrated.length > 0) {
      systems.push(...hydrated);
      continue;
    }
    for (const [systemId, overlay] of Object.entries(galaxy.abstract?.systemOverlays ?? {})) {
      systems.push({
        id: systemId,
        owner: overlay.owner,
        factionId: overlay.factionId ?? null,
        structures: overlay.structures ?? [],
        dyson: overlay.dyson ?? null,
        bodies: overlay.bodies ?? [],
      });
    }
  }
  return systems;
}

export function operationalOutpostCount(state) {
  let count = 0;
  for (const system of persistentSystems(state)) {
    if (system.owner !== 'player') continue;
    count += (system.structures ?? []).filter((structure) => isOperationalOutpost(state, structure)).length;
  }
  return count;
}

/**
 * Progressive credit income for one operational outpost:
 * base × (1 + moons × MOON_YIELD_BONUS × moonYieldMult) × shellCreditBonus.
 */
export function outpostIncomePerSecond(state, system, structure, effects = null) {
  if (!isOperationalOutpost(state, structure)) return 0;
  const fx = effects ?? techEffects(state);
  const planet = (system.bodies ?? []).find((body) => body.id === structure.bodyId)
    ?? findPlanet(state, system.id, structure.bodyId);
  const moons = planet?.moons?.length ?? 0;
  const moonMult = 1 + moons * MOON_YIELD_BONUS * (fx.moonYieldMult ?? 1);
  const shells = system.dyson?.completedShells ?? 0;
  let shellMult = SHELL_BONUS_CREDIT_MULT[shells] ?? 1;
  if (fx.dysonShellBonus) shellMult *= 1.05;
  return OUTPOST_BASE_INCOME * moonMult * shellMult;
}

// Progressive Credits: moons, income tech, and Dyson shell credit bonuses apply.
// Cargo → Trade Nexus remains a separate credit path in logistics.js.
export function incomePerSecond(state) {
  const effects = techEffects(state);
  let total = 0;
  for (const system of persistentSystems(state)) {
    if (system.owner !== 'player') continue;
    for (const structure of system.structures ?? []) {
      total += outpostIncomePerSecond(state, system, structure, effects);
    }
  }
  return total * effects.outpostIncomeMult * effects.creditIncomeMult;
}

/** Credit income from outposts in one system (for UI / tests). */
export function incomePerSecondInSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || !isPlayerOwned(state, systemId)) return 0;
  const effects = techEffects(state);
  let total = 0;
  for (const structure of system.structures ?? []) {
    total += outpostIncomePerSecond(state, system, structure, effects);
  }
  return total * effects.outpostIncomeMult * effects.creditIncomeMult;
}

export function applyIncomeTick(state) {
  if (state.paused) return 0;
  const awarded = incomePerSecond(state) * (TICK_MS / 1000);
  state.credits += awarded;
  return awarded;
}
