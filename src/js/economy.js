// Economy: outpost/shipyard construction and credit income (GDD §6).
// May mutate state.credits and system structures. Never touches DOM/canvas.

import { OUTPOST_COST, OUTPOST_BASE_INCOME, MOON_YIELD_BONUS, TICK_MS, STRUCTURE_BUILD_MS } from './constants.js';
import {
  systemById,
  findPlanet,
  hasOutpost,
  isPlayerOwned,
  isStructureActive,
  pendingStructureOnBody,
} from './state.js';
import { shellCreditBonus } from './dyson.js';
import { getSystems } from './galaxy-scope.js';
import { flagshipInSystem } from './flagship-presence.js';
import { hasPendingJob, queueConstructionJob } from './drones.js';

let nextStructureId = 1;

export function resetStructureIds(state) {
  // Called after load so new ids never collide with saved ones.
  let max = 0;
  if (state.galaxies) {
    for (const gal of Object.values(state.galaxies)) {
      for (const system of Object.values(gal.systems ?? {})) {
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
  });
  return { ok: true };
}

// Credits per second from player-owned outposts only; yield scales with moon count.
export function incomePerSecond(state) {
  let total = 0;
  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    const creditMult = shellCreditBonus(system);
    for (const s of system.structures) {
      if (s.type !== 'outpost' || !isStructureActive(s)) continue;
      const planet = system.bodies.find((b) => b.id === s.bodyId);
      const moons = planet ? planet.moons.length : 0;
      total += OUTPOST_BASE_INCOME * (1 + MOON_YIELD_BONUS * moons) * creditMult;
    }
  }
  return total;
}

/** Credit income from outposts in one system (for UI / tests). */
export function incomePerSecondInSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || !isPlayerOwned(state, systemId)) return 0;
  const creditMult = shellCreditBonus(system);
  let total = 0;
  for (const s of system.structures) {
    if (s.type !== 'outpost' || !isStructureActive(s)) continue;
    const planet = system.bodies.find((b) => b.id === s.bodyId);
    const moons = planet ? planet.moons.length : 0;
    total += OUTPOST_BASE_INCOME * (1 + MOON_YIELD_BONUS * moons) * creditMult;
  }
  return total;
}

export function applyIncomeTick(state) {
  state.credits += incomePerSecond(state) * (TICK_MS / 1000);
}
