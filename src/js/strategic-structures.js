// Strategic late-game structures (Phase 6, GDD §17).

import {
  LISTENING_POST_COST,
  LANE_RELAY_COST,
  BLOCKADE_FORT_COST,
  FORWARD_BASE_COST,
  SUPPLY_CACHE_COST,
  COMMAND_POST_COST,
  LANE_RELAY_SPEED_BONUS,
  BLOCKADE_TRADE_PENALTY,
  FORWARD_BASE_CAPTURE_BONUS,
  COMMAND_POST_CAPTURE_REDUCTION,
  SUPPLY_CACHE_REPAIR_BONUS,
} from './constants.js';
import { allocateStructureId } from './economy.js';
import { laneLength } from './galaxy.js';
import {
  findPlanet,
  hasOutpost,
  isPlayerOwned,
  structuresOn,
  systemById,
} from './state.js';
import { isTechUnlocked } from './tech-web.js';
import { invalidateIntelCache } from './intel.js';

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

export const STRUCTURE_DEFS = {
  listening_post: {
    cost: LISTENING_POST_COST,
    tech: 'wh_scout_range',
    perBody: true,
    cap: 1,
    requiresOutpost: true,
  },
  lane_relay: {
    cost: LANE_RELAY_COST,
    tech: 'wh_nav_beacon',
    perBody: true,
    cap: 1,
    requiresOutpost: true,
  },
  blockade_fort: {
    cost: BLOCKADE_FORT_COST,
    tech: 'mil_patrol_cutter',
    perBody: true,
    cap: 2,
    requiresOutpost: true,
  },
  forward_base: {
    cost: FORWARD_BASE_COST,
    tech: 'mil_command_cruiser',
    perBody: true,
    cap: 1,
    requiresOutpost: true,
  },
  supply_cache: {
    cost: SUPPLY_CACHE_COST,
    tech: 'mil_field_hospital',
    perBody: true,
    cap: 2,
    requiresOutpost: false,
  },
  command_post: {
    cost: COMMAND_POST_COST,
    tech: 'mil_war_doctrine',
    perBody: false,
    cap: 1,
    requiresOutpost: false,
  },
};

export function canBuildStrategicStructure(state, systemId, type, planetId = null, opts = {}) {
  const def = STRUCTURE_DEFS[type];
  if (!def) return { ok: false, reason: 'Unknown structure type' };
  if (!isTechUnlocked(state, def.tech)) {
    return { ok: false, reason: 'Required tech not researched' };
  }
  const system = systemById(state, systemId);
  if (!system || !isPlayerOwned(state, systemId)) {
    return { ok: false, reason: 'System not under your control' };
  }
  if (!opts.remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system' };
  }
  if (!opts.ignoreCredits && state.credits < def.cost) {
    return { ok: false, reason: `Need ${def.cost} credits` };
  }

  if (def.perBody) {
    // Dead-star frontier campaigns have no physical body to host an outpost.
    // Their template-defined fallback commissions one system-node Forward Base
    // instead, while retaining the normal one-per-system cap and tech gate.
    if (!planetId && type === 'forward_base' && opts.remote && (system.bodies?.length ?? 0) === 0) {
      const existing = system.structures.filter((s) => s.type === type).length;
      if (existing >= def.cap) return { ok: false, reason: 'System cap reached' };
      return { ok: true, systemNodeFallback: true };
    }
    if (!planetId) return { ok: false, reason: 'Select a planet' };
    const planet = findPlanet(state, systemId, planetId);
    if (!planet) return { ok: false, reason: 'No such planet' };
    if (def.requiresOutpost && !hasOutpost(state, systemId, planetId)) {
      return { ok: false, reason: 'Outpost required' };
    }
    const existing = structuresOn(state, systemId, planetId).filter((s) => s.type === type).length;
    if (existing >= def.cap) return { ok: false, reason: 'Cap reached on this body' };
  } else {
    const existing = system.structures.filter((s) => s.type === type).length;
    if (existing >= def.cap) return { ok: false, reason: 'System cap reached' };
  }
  return { ok: true };
}

export function buildStrategicStructure(state, systemId, type, planetId = null, opts = {}) {
  const check = canBuildStrategicStructure(state, systemId, type, planetId, opts);
  if (!check.ok) return check;
  const def = STRUCTURE_DEFS[type];
  if (!opts.alreadyPaid) state.credits -= def.cost;
  systemById(state, systemId).structures.push({
    id: allocateStructureId(),
    type,
    bodyId: def.perBody ? planetId : null,
    builtAtTime: state.time,
  });
  if (type === 'listening_post') invalidateIntelCache(state);
  return { ok: true, type, systemId };
}

export function listeningPostCount(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.filter((s) => s.type === 'listening_post').length ?? 0;
}

export function laneRelayCount(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.filter((s) => s.type === 'lane_relay').length ?? 0;
}

export function blockadeFortCount(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.filter((s) => s.type === 'blockade_fort').length ?? 0;
}

export function forwardBaseCount(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.filter((s) => s.type === 'forward_base').length ?? 0;
}

export function commandPostCount(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.filter((s) => s.type === 'command_post').length ?? 0;
}

export function strategicStructuresSummary(state) {
  const counts = {};
  for (const type of Object.keys(STRUCTURE_DEFS)) counts[type] = 0;
  for (const system of Object.values(state.galaxies?.[state.activeGalaxyId]?.systems ?? {})) {
    for (const s of system.structures ?? []) {
      if (counts[s.type] !== undefined) counts[s.type]++;
    }
  }
  return counts;
}

export function supplyCacheCount(state, systemId, bodyId = null) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  return system.structures.filter(
    (s) => s.type === 'supply_cache' && (bodyId == null || s.bodyId === bodyId),
  ).length;
}

/** Lane relay reduces transit time on legs touching a relay system. */
export function laneRelayModifier(state, idA, idB) {
  let mod = 1;
  for (const sid of [idA, idB]) {
    if (laneRelayCount(state, sid) > 0 && isPlayerOwned(state, sid)) {
      mod -= LANE_RELAY_SPEED_BONUS;
    }
  }
  return Math.max(0.55, mod);
}

export function effectiveLegDurationMs(state, galaxy, idA, idB, speed, minLegMs) {
  const base = Math.max(minLegMs, Math.round((laneLength(galaxy, idA, idB) / speed) * 1000));
  return Math.max(minLegMs, Math.round(base * laneRelayModifier(state, idA, idB)));
}

/** Blockade forts on either endpoint reduce trade throughput on that lane. */
export function blockadeTradeMultiplier(state, idA, idB) {
  let mult = 1;
  for (const sid of [idA, idB]) {
    if (blockadeFortCount(state, sid) > 0) mult *= (1 - BLOCKADE_TRADE_PENALTY);
  }
  return mult;
}

export function forwardBaseCaptureBonus(state, systemId) {
  return forwardBaseCount(state, systemId) * FORWARD_BASE_CAPTURE_BONUS;
}

export function commandPostCaptureReduction(state, systemId) {
  return commandPostCount(state, systemId) * COMMAND_POST_CAPTURE_REDUCTION;
}

export function supplyCacheRepairMultiplier(state, systemId) {
  const system = systemById(state, systemId);
  const caches = system?.structures?.filter((s) => s.type === 'supply_cache').length ?? 0;
  return caches > 0 ? SUPPLY_CACHE_REPAIR_BONUS : 1;
}
