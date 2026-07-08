// Tech-gated body and star-node buildings for the post-Phase-6 building pass.

import {
  MINING_COMPLEX_COST,
  REFINERY_COST,
  STORAGE_DEPOT_COST,
  FIGHTER_FACTORY_COST,
  PLANETARY_SHIELD_COST,
  ION_BATTERY_COST,
  DRYDOCK_COST,
  ORBITAL_DEFENSE_COST,
  ASTEROID_HARVESTER_COST,
  MINING_COMPLEX_INCOME_BONUS,
  REFINERY_TRADE_BONUS,
  STORAGE_BLOCKADE_REDUCTION,
  FIGHTER_FACTORY_REPLENISH_PER_SEC,
  DRYDOCK_REPAIR_PER_SEC,
  ORBITAL_DEFENSE_POWER,
  SHIELD_STRUCTURE_HP_MULT,
  ION_BATTERY_POWER,
  TICK_MS,
} from './constants.js';
import { allocateStructureId } from './economy.js';
import { getSystems } from './galaxy-scope.js';
import {
  findBody,
  findPlanet,
  hasOutpost,
  isPlayerOwned,
  structuresOn,
  systemById,
} from './state.js';
import { isTechUnlocked } from './tech-web.js';
import { maxCarrierWingCount, normalizeCarrierWingState } from './hull.js';

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

export const BODY_STRUCTURE_DEFS = {
  mining_complex: {
    label: 'Mining Complex',
    placement: 'surface',
    cost: MINING_COMPLEX_COST,
    tech: 'eco_mining_complex',
    cap: 1,
    requiresOutpost: true,
    bodyTypes: ['habitable', 'barren'],
    hp: 220,
    effect: 'credit_income',
  },
  refinery: {
    label: 'Refinery',
    placement: 'surface',
    cost: REFINERY_COST,
    tech: 'eco_refinery',
    cap: 1,
    requiresOutpost: true,
    bodyTypes: ['habitable', 'barren'],
    hp: 260,
    effect: 'trade_income',
  },
  storage_depot: {
    label: 'Storage Depot',
    placement: 'surface',
    cost: STORAGE_DEPOT_COST,
    tech: 'eco_storage_depot',
    cap: 2,
    requiresOutpost: true,
    bodyTypes: ['habitable', 'barren'],
    hp: 240,
    effect: 'blockade_buffer',
  },
  fighter_factory: {
    label: 'Fighter Factory',
    placement: 'surface',
    cost: FIGHTER_FACTORY_COST,
    tech: 'mil_fighter_factory',
    cap: 1,
    requiresOutpost: true,
    bodyTypes: ['habitable'],
    hp: 320,
    effect: 'wing_replenish',
  },
  planetary_shield: {
    label: 'Shield Generator',
    placement: 'surface',
    cost: PLANETARY_SHIELD_COST,
    tech: 'mil_shield_generator',
    cap: 1,
    requiresOutpost: true,
    bodyTypes: ['habitable', 'barren'],
    hp: 360,
    effect: 'structure_hp',
  },
  ion_battery: {
    label: 'Ion Battery',
    placement: 'surface',
    cost: ION_BATTERY_COST,
    tech: 'mil_ion_battery',
    cap: 2,
    requiresOutpost: true,
    bodyTypes: ['habitable', 'barren'],
    hp: 300,
    effect: 'ion_defense',
  },
  drydock: {
    label: 'Drydock',
    placement: 'orbital',
    cost: DRYDOCK_COST,
    tech: 'mil_drydock',
    cap: 1,
    requiresOutpost: false,
    bodyTypes: ['habitable', 'barren', 'gas'],
    hp: 340,
    effect: 'ship_repair',
  },
  orbital_defense: {
    label: 'Defense Platform',
    placement: 'orbital',
    cost: ORBITAL_DEFENSE_COST,
    tech: 'mil_orbital_defense',
    cap: 2,
    requiresOutpost: false,
    bodyTypes: ['habitable', 'barren', 'gas'],
    hp: 380,
    effect: 'orbital_defense',
  },
  asteroid_harvester: {
    label: 'Asteroid Harvester',
    placement: 'star-node',
    cost: ASTEROID_HARVESTER_COST,
    tech: 'eco_asteroid_harvester',
    cap: 1,
    requiresOutpost: false,
    starNode: true,
    hp: 260,
    effect: 'dead_star_income',
  },
};

export function bodyStructureDef(type) {
  return BODY_STRUCTURE_DEFS[type] ?? null;
}

export function structureMaxHp(state, systemId, type) {
  const def = bodyStructureDef(type);
  if (!def) return null;
  const shielded = type !== 'planetary_shield' && bodyStructureCount(state, systemId, 'planetary_shield') > 0;
  return Math.round(def.hp * (shielded ? SHIELD_STRUCTURE_HP_MULT : 1));
}

export function ensureStructureCombatFields(state, systemId, structure) {
  const maxHp = structureMaxHp(state, systemId, structure.type);
  if (!maxHp) return structure;
  structure.maxHp = structure.maxHp ?? maxHp;
  structure.hp = structure.hp ?? structure.maxHp;
  structure.disabledUntil = structure.disabledUntil ?? 0;
  return structure;
}

export function bodyStructureCount(state, systemId, type = null) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  return system.structures.filter((s) => BODY_STRUCTURE_DEFS[s.type] && (!type || s.type === type)).length;
}

export function bodyStructureCountOn(state, systemId, bodyId, type) {
  return structuresOn(state, systemId, bodyId).filter((s) => s.type === type).length;
}

export function canBuildBodyStructure(state, systemId, bodyId, type, opts = {}) {
  const def = bodyStructureDef(type);
  if (!def) return { ok: false, reason: 'Unknown building type' };
  if (!isTechUnlocked(state, def.tech)) return { ok: false, reason: `Research ${def.label} first` };
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  if (!opts.remote && !flagshipInSystem(state, systemId)) return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  if (!opts.ignoreCredits && state.credits < def.cost) return { ok: false, reason: `Need ${def.cost} credits` };

  if (def.starNode) {
    if (system.structures.filter((s) => s.type === type).length >= def.cap) {
      return { ok: false, reason: 'System cap reached' };
    }
    if (type === 'asteroid_harvester' && system.bodies.length > 0) {
      return { ok: false, reason: 'Asteroid harvesters are for dead-star systems' };
    }
    return { ok: true };
  }

  const found = findBody(state, systemId, bodyId);
  if (!found) return { ok: false, reason: 'Select a body' };
  const body = found.body;
  const planetId = found.planet?.id ?? body.id;
  if (!def.bodyTypes.includes(body.type ?? 'moon')) {
    return { ok: false, reason: 'Building cannot be placed on this body' };
  }
  if (def.requiresOutpost && !hasOutpost(state, systemId, planetId)) {
    return { ok: false, reason: 'Outpost required' };
  }
  if (bodyStructureCountOn(state, systemId, body.id, type) >= def.cap) {
    return { ok: false, reason: 'Cap reached on this body' };
  }
  return { ok: true };
}

export function buildBodyStructure(state, systemId, bodyId, type, opts = {}) {
  const check = canBuildBodyStructure(state, systemId, bodyId, type, opts);
  if (!check.ok) return check;
  const def = bodyStructureDef(type);
  const structure = {
    id: allocateStructureId(),
    type,
    bodyId: def.starNode ? null : bodyId,
    placement: def.placement,
    builtAtTime: state.time,
    disabledUntil: 0,
  };
  const maxHp = structureMaxHp(state, systemId, type) ?? def.hp;
  structure.maxHp = maxHp;
  structure.hp = maxHp;
  if (!opts.alreadyPaid) state.credits -= def.cost;
  systemById(state, systemId).structures.push(structure);
  return { ok: true, type, systemId, bodyId: structure.bodyId };
}

export function systemBodyStructureCounts(state, systemId) {
  const out = {};
  for (const type of Object.keys(BODY_STRUCTURE_DEFS)) out[type] = 0;
  const system = systemById(state, systemId);
  if (!system) return out;
  for (const s of system.structures) if (out[s.type] !== undefined) out[s.type]++;
  return out;
}

export function bodyStructuresSummary(state, systemId) {
  const counts = systemBodyStructureCounts(state, systemId);
  const byPlacement = { surface: 0, orbital: 0, 'star-node': 0 };
  for (const [type, count] of Object.entries(counts)) {
    byPlacement[BODY_STRUCTURE_DEFS[type].placement] += count;
  }
  return {
    counts,
    byPlacement,
    incomeMult: Math.round(bodyStructureIncomeMultiplier(state, systemId) * 100) / 100,
    tradeMult: Math.round(bodyStructureTradeMultiplier(state, systemId) * 100) / 100,
    defensePower: bodyStructureDefensePower(state, systemId),
    ionPower: bodyStructureIonPower(state, systemId),
  };
}

export function allBodyStructuresSummary(state) {
  const counts = {};
  for (const type of Object.keys(BODY_STRUCTURE_DEFS)) counts[type] = 0;
  for (const system of Object.values(getSystems(state))) {
    for (const s of system.structures ?? []) if (counts[s.type] !== undefined) counts[s.type]++;
  }
  return counts;
}

export function bodyStructureIncomeMultiplier(state, systemId) {
  const mining = bodyStructureCount(state, systemId, 'mining_complex');
  return 1 + mining * MINING_COMPLEX_INCOME_BONUS;
}

export function bodyStructureFlatIncome(state, systemId) {
  return bodyStructureCount(state, systemId, 'asteroid_harvester') * 2;
}

export function bodyStructureTradeMultiplier(state, systemId) {
  const refineries = bodyStructureCount(state, systemId, 'refinery');
  return 1 + refineries * REFINERY_TRADE_BONUS;
}

export function bodyStructureBlockadeMultiplier(state, systemId, currentMultiplier) {
  const depots = bodyStructureCount(state, systemId, 'storage_depot');
  if (depots <= 0 || currentMultiplier >= 1) return currentMultiplier;
  return Math.min(1, currentMultiplier + depots * STORAGE_BLOCKADE_REDUCTION);
}

export function bodyStructureDefensePower(state, systemId) {
  return bodyStructureCount(state, systemId, 'orbital_defense') * ORBITAL_DEFENSE_POWER;
}

export function bodyStructureIonPower(state, systemId) {
  return bodyStructureCount(state, systemId, 'ion_battery') * ION_BATTERY_POWER;
}

export function bodyStructureRepairMultiplier(state, systemId) {
  return bodyStructureCount(state, systemId, 'drydock') > 0 ? 1.2 : 1;
}

function replenishCarrierWing(ship, amount) {
  const max = maxCarrierWingCount(ship);
  if (!max) return 0;
  const wing = normalizeCarrierWingState(ship);
  const missing = max - wing.ready;
  if (missing <= 0) return 0;
  const delta = Math.min(missing, amount);
  wing.ready += delta;
  wing.lost = Math.max(0, wing.lost - delta);
  return delta;
}

export function tickBodyStructureEffects(state) {
  if (state.paused) return [];
  const events = [];
  const dt = TICK_MS / 1000;
  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    const drydocks = bodyStructureCount(state, system.id, 'drydock');
    const factories = bodyStructureCount(state, system.id, 'fighter_factory');
    const mining = bodyStructureCount(state, system.id, 'mining_complex');
    const harvesters = bodyStructureCount(state, system.id, 'asteroid_harvester');

    if (mining > 0 || harvesters > 0) {
      state.credits += (mining * 0.75 + harvesters * 2) * dt;
    }

    if (drydocks > 0) {
      const repair = DRYDOCK_REPAIR_PER_SEC * drydocks * dt;
      for (const ship of state.playerShips ?? []) {
        if (ship.systemId !== system.id || ship.transit || ship.hp <= 0 || ship.hp >= ship.maxHp) continue;
        ship.hp = Math.min(ship.maxHp, ship.hp + repair);
      }
    }

    if (factories > 0) {
      const replenish = FIGHTER_FACTORY_REPLENISH_PER_SEC * factories * dt;
      for (const ship of state.playerShips ?? []) {
        if (ship.systemId !== system.id || ship.transit || ship.hp <= 0) continue;
        if (replenishCarrierWing(ship, replenish) > 0) {
          events.push({ type: 'carrier_wing_replenish', systemId: system.id, shipId: ship.id });
        }
      }
    }
  }
  return events;
}

export function bodyStructureBuildRows(state, systemId, bodyId) {
  return Object.entries(BODY_STRUCTURE_DEFS)
    .filter(([, def]) => !def.starNode)
    .map(([type, def]) => ({
      type,
      label: def.label,
      placement: def.placement,
      cost: def.cost,
      check: canBuildBodyStructure(state, systemId, bodyId, type),
    }));
}
