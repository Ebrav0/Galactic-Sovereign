// Faction-scoped AI economy, research, construction, fleets, and expansion.

import {
  AI_STARTING_CREDITS,
  AI_STARTING_SYSTEMS,
  AI_TICK_INTERVAL_TICKS,
  AI_BUILD_OUTPOST_COST,
  AI_PERSONALITY_NAMES,
  AI_FACTION_COUNT,
  SHIPYARD_COST,
  TICK_MS,
  STRUCTURE_BUILD_MS,
  FOUNDRY_COST,
  LAUNCHER_COST,
  LAUNCHER_SAILS_PER_SECOND,
  SAIL_CREDIT_COST_MIN,
  SAIL_CREDIT_COST_MAX,
  SAIL_COST_LAUNCHER_REF,
  SHELL_SAILS_REQUIRED,
  SHELL_COUNT,
  SOLARII_BASE_RATE,
  SOLARII_SHELL_MULTIPLIERS,
  SHIPYARD_LEVEL_BUILD_TIME_MULTIPLIERS,
  STRUCTURE_UPGRADE_COST_MULTIPLIERS,
  OUTPOST_PASSIVE_INCOME,
  CAPTURE_HOLD_MS,
} from './constants.js';
import { neighborsOf, BLACK_HOLE_ID } from './galaxy.js';
import { getGraph, getSystems, persistentSystemRecords } from './galaxy-scope.js';
import {
  createRng,
  hashSeed,
  systemById,
  ensureDyson,
} from './state.js';
import { captureRequirement } from './capture.js';
import {
  spawnAiShip,
  aiShipsInSystem,
  aiCombatPresence,
  orderAiShipTravel,
  aiFleetPowerInSystem,
  assignAiShipFactionIds,
} from './ai-ships.js';
import { normalizeShipyardBuilds } from './empire-queue.js';
import {
  BODY_STRUCTURE_DEFS,
  bodyStructureUpgradeCost,
  buildBodyStructure,
  canBuildBodyStructure,
  canUpgradeBodyStructure,
  reconcileStructureTechnology,
  upgradeBodyStructure,
} from './body-structures.js';
import { hullQueueCost, hullStats } from './hull.js';
import { empireQueueHulls, techEffects } from './tech-web.js';
import {
  AI_PERSONALITY_PRIORITIES,
  aiDifficultyProfile,
  backfillAiResearch,
  ensureAiResearchState,
  factionHasTech,
  factionTechContext,
  fillAiResearchQueue,
  tickAiResearch,
} from './ai-tech.js';
import {
  canAttackFaction,
  getActiveWar,
  isAtWar,
  recordOccupation,
  recordWarEvent,
} from './diplomacy.js';

const PERSONALITIES = ['expansionist', 'economic', 'megastructure', 'wormhole'];
const OUTPOST_CREDITS_PER_SECOND = OUTPOST_PASSIVE_INCOME;
const DEFAULT_BODY_STRUCTURE_BUILD_MS = 24000;

const PERSONALITY_STRATEGIES = Object.freeze({
  expansionist: Object.freeze({
    researchClusters: ['military', 'economy', 'flagship'],
    buildingFocus: ['outpost', 'fleet_academy', 'missile_silo', 'orbital_defense', 'shipyard'],
    fleetFocus: ['dreadnought', 'battleship', 'cruiser', 'destroyer', 'corvette'],
  }),
  economic: Object.freeze({
    researchClusters: ['economy', 'trade', 'research'],
    buildingFocus: ['galactic_exchange', 'logistics_hub', 'power_grid', 'storage_depot', 'refinery'],
    fleetFocus: ['armored_convoy', 'bulk_freighter', 'light_hauler', 'patrol_cutter', 'corvette'],
  }),
  megastructure: Object.freeze({
    researchClusters: ['megastructure', 'research', 'economy'],
    buildingFocus: ['sail_foundry', 'dyson_launcher', 'solar_collector', 'nanoforge', 'quantum_archive'],
    fleetFocus: ['builder_ship', 'miner', 'command_cruiser', 'cruiser', 'corvette'],
  }),
  wormhole: Object.freeze({
    researchClusters: ['wormhole', 'research', 'military'],
    buildingFocus: ['wormhole_observatory', 'sensor_array', 'interdiction_array', 'logistics_hub'],
    fleetFocus: ['sensor_ship', 'scout', 'command_cruiser', 'patrol_cutter', 'corvette'],
  }),
});

const CORE_STRUCTURE_DEFS = Object.freeze({
  outpost: {
    label: 'Outpost', cost: AI_BUILD_OUTPOST_COST, placement: 'surface', cap: 1,
    bodyTypes: ['habitable', 'barren', 'gas'], buildMs: STRUCTURE_BUILD_MS.outpost, upgradeable: true,
  },
  shipyard: {
    label: 'Shipyard', cost: SHIPYARD_COST, placement: 'surface', cap: 1,
    bodyTypes: ['habitable', 'barren'], buildMs: STRUCTURE_BUILD_MS.shipyard, upgradeable: true,
  },
  sail_foundry: {
    label: 'Sail Foundry', cost: FOUNDRY_COST, placement: 'surface', cap: 1,
    bodyTypes: ['habitable', 'barren', 'gas'], buildMs: STRUCTURE_BUILD_MS.sail_foundry,
    tech: 'mega_foundry_unlock', upgradeable: true,
  },
  dyson_launcher: {
    label: 'Dyson Launcher', cost: LAUNCHER_COST, placement: 'orbital', cap: 3,
    bodyTypes: ['habitable', 'barren', 'gas'], buildMs: STRUCTURE_BUILD_MS.dyson_launcher,
    tech: 'mega_launcher_unlock', upgradeable: true,
  },
});

let aiStructureHooks = {};

/** Optional bridge for the structure subsystem. Unregistered/failed hooks fall back safely. */
export function registerAiStructureHooks(hooks = {}) {
  aiStructureHooks = { ...aiStructureHooks, ...hooks };
  return { ...aiStructureHooks };
}

export function resetAiStructureHooks() {
  aiStructureHooks = {};
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function operationalStructure(state, structure) {
  if (!structure || structure.destroyed || structure.hp === 0 || structure.construction) return false;
  if ((structure.disabledUntil ?? 0) > (state.time ?? 0)) return false;
  if (structure.disabled || structure.mothballed) return false;
  return true;
}

function structureDefinition(type) {
  return BODY_STRUCTURE_DEFS[type] ?? CORE_STRUCTURE_DEFS[type] ?? null;
}

function factionStrategy(personality) {
  return PERSONALITY_STRATEGIES[personality] ?? PERSONALITY_STRATEGIES.expansionist;
}

function defaultFaction(index = 0, personality = PERSONALITIES[index % PERSONALITIES.length]) {
  return {
    id: `ai-${index}`,
    name: AI_PERSONALITY_NAMES[personality] ?? `Faction ${index + 1}`,
    personality,
    homeSystemId: null,
    credits: AI_STARTING_CREDITS,
    solarii: 0,
    solariiUnlocked: false,
    lastActionTick: 0,
  };
}

function normalizeProductionState(faction) {
  if (!faction.production || typeof faction.production !== 'object') faction.production = {};
  const production = faction.production;
  production.queue = Array.isArray(production.queue) ? production.queue : [];
  production.construction = Array.isArray(production.construction) ? production.construction : [];
  production.nextId = Math.max(1, Math.floor(finite(production.nextId, 1)));
  production.lastDecisionTick = Math.max(0, Math.floor(finite(production.lastDecisionTick)));
  return production;
}

function normalizeLogisticsState(faction) {
  if (!faction.logistics || typeof faction.logistics !== 'object') faction.logistics = {};
  faction.logistics.inventory = faction.logistics.inventory && typeof faction.logistics.inventory === 'object'
    ? faction.logistics.inventory
    : {};
  faction.logistics.routes = Array.isArray(faction.logistics.routes) ? faction.logistics.routes : [];
  faction.logistics.activeConvoys = Array.isArray(faction.logistics.activeConvoys)
    ? faction.logistics.activeConvoys
    : [];
  faction.logistics.lastDispatchAt = Math.max(0, finite(faction.logistics.lastDispatchAt));
  return faction.logistics;
}

function normalizeFaction(state, faction, index) {
  faction.id = faction.id || `ai-${index}`;
  faction.personality = PERSONALITIES.includes(faction.personality)
    ? faction.personality
    : PERSONALITIES[index % PERSONALITIES.length];
  faction.name = faction.name || AI_PERSONALITY_NAMES[faction.personality] || `Faction ${index + 1}`;
  faction.credits = Math.max(0, finite(faction.credits, AI_STARTING_CREDITS));
  faction.solarii = Math.max(0, finite(faction.solarii));
  faction.solariiUnlocked = !!faction.solariiUnlocked;
  faction.lastActionTick = Math.max(0, Math.floor(finite(faction.lastActionTick)));
  faction.difficulty = aiDifficultyProfile(state, faction).id;
  faction.strategy = {
    researchClusters: [...factionStrategy(faction.personality).researchClusters],
    buildingFocus: [...factionStrategy(faction.personality).buildingFocus],
    fleetFocus: [...factionStrategy(faction.personality).fleetFocus],
  };
  if (!faction.milestones || typeof faction.milestones !== 'object') faction.milestones = {};
  faction.milestones.completedDysonSystems = Array.isArray(faction.milestones.completedDysonSystems)
    ? faction.milestones.completedDysonSystems
    : [];
  faction.milestones.diplomacyUnlocked = !!faction.milestones.diplomacyUnlocked;
  faction.milestones.superweaponUnlocked = !!faction.milestones.superweaponUnlocked;
  ensureAiResearchState(faction);
  normalizeProductionState(faction);
  normalizeLogisticsState(faction);
  return faction;
}

export function listAiFactions(state) {
  ensureFactions(state);
  return state.factions.list;
}

export function aiFactionById(state, factionId = null) {
  ensureFactions(state);
  if (!factionId) return state.factions.ai;
  return state.factions.list.find((faction) => faction.id === factionId) ?? null;
}

function nearestFactionAssignments(state, factions) {
  const graph = getGraph(state);
  const assignments = new Map();
  if (!graph) return assignments;
  const queue = [];
  for (const faction of [...factions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!faction.homeSystemId) continue;
    assignments.set(faction.homeSystemId, faction.id);
    queue.push(faction.homeSystemId);
  }
  while (queue.length) {
    const current = queue.shift();
    const factionId = assignments.get(current);
    for (const next of neighborsOf(graph, current)) {
      if (assignments.has(next)) continue;
      assignments.set(next, factionId);
      queue.push(next);
    }
  }
  return assignments;
}

function syncMothballState(faction, structure) {
  const def = structureDefinition(structure.type);
  if (!def?.tech) return;
  if (!factionHasTech(faction, def.tech)) {
    structure.mothballed = true;
    structure.mothballReason = 'technology';
  } else if (structure.mothballReason === 'technology' || structure.mothballedReason === 'missing_tech') {
    structure.mothballed = false;
    structure.mothballReason = null;
    structure.mothballedReason = null;
  }
}

export function assignAiFactionOwnership(state) {
  const factions = state.factions?.list ?? [];
  if (!factions.length) return;
  const ids = new Set(factions.map((faction) => faction.id));
  const nearest = nearestFactionAssignments(state, factions);
  for (const system of Object.values(getSystems(state))) {
    if (system.owner !== 'ai') {
      if (system.owner === 'player') delete system.factionId;
      continue;
    }
    if (!ids.has(system.factionId)) {
      system.factionId = nearest.get(system.id) ?? factions[0].id;
    }
    const faction = factions.find((candidate) => candidate.id === system.factionId) ?? factions[0];
    for (const structure of system.structures ?? []) {
      structure.factionId = structure.factionId && ids.has(structure.factionId)
        ? structure.factionId
        : faction.id;
      if (structure.level == null) structure.level = 1;
      syncMothballState(faction, structure);
      if (structure.type === 'shipyard') {
        normalizeShipyardBuilds(structure);
        for (const build of structure.builds) {
          if (build.ai || build.factionId) {
            build.ai = true;
            build.factionId = build.factionId ?? faction.id;
          }
        }
      }
    }
    reconcileStructureTechnology(state, system.id, { factionId: faction.id });
  }
  assignAiShipFactionIds(state, factions[0].id);
}

export function ensureFactions(state) {
  if (!state.factions || typeof state.factions !== 'object') state.factions = {};
  let list = Array.isArray(state.factions.list) ? state.factions.list.filter(Boolean) : [];
  if (!list.length && state.factions.ai) list = [state.factions.ai];
  if (!list.length) list = [defaultFaction(0)];

  const legacyResearchFlags = list.map((faction) => !faction.research);
  state.factions.list = list.map((faction, index) => normalizeFaction(state, faction, index));
  state.factions.ai = state.factions.list[0]; // legacy alias, never the shared wallet for all factions
  if (!Array.isArray(state.aiShips)) state.aiShips = [];
  assignAiFactionOwnership(state);

  const elapsed = state.meta?.playTimeMs ?? state.time ?? 0;
  for (let i = 0; i < state.factions.list.length; i++) {
    if (legacyResearchFlags[i] && elapsed > 0) {
      backfillAiResearch(state, state.factions.list[i], elapsed);
    }
  }
  return state.factions;
}

function aiShouldContestPlayerLocal(state, factionId = 'ai-0') {
  return isAtWar(state, factionId);
}

function isSuperweaponPanicLocal(state) {
  return state.time < (state.diplomacy?.panicUntil ?? 0);
}

function aiRng(state, factionId, tickIndex) {
  return createRng(hashSeed(state.meta.seed, `ai-tick:${factionId}:${tickIndex}`));
}

function rimStars(state) {
  const graph = getGraph(state);
  const maxDist = new Map();
  const start = state.stronghold;
  const queue = [start];
  maxDist.set(start, 0);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of neighborsOf(graph, cur)) {
      if (maxDist.has(next)) continue;
      maxDist.set(next, maxDist.get(cur) + 1);
      queue.push(next);
    }
  }
  let bestDist = 0;
  for (const distance of maxDist.values()) bestDist = Math.max(bestDist, distance);
  const threshold = Math.max(3, bestDist - 2);
  return graph.stars
    .filter((star) => (maxDist.get(star.id) ?? 0) >= threshold && star.id !== state.stronghold)
    .map((star) => star.id);
}

function addSeedStructure(state, system, faction, type, bodyId, extra = {}) {
  const def = structureDefinition(type);
  const structure = {
    id: extra.id ?? `ai-${type}-${system.id}-${faction.id}`,
    type,
    bodyId,
    placement: def?.placement,
    builtAtTime: 0,
    owner: 'ai',
    factionId: faction.id,
    level: 1,
    disabledUntil: 0,
    ...extra,
  };
  if (def?.hp) {
    structure.maxHp = def.hp;
    structure.hp = def.hp;
  }
  if (type === 'shipyard') structure.builds = [];
  system.structures.push(structure);
  return structure;
}

export function seedExtraAiFactions(state, galaxyId = state.homeGalaxyId) {
  ensureFactions(state);
  if (state.factions.list.length >= AI_FACTION_COUNT) {
    return { ok: true, count: state.factions.list.length };
  }
  const rng = createRng(hashSeed(state.meta.seed, 'ai-multi-seed'));
  const candidates = rimStars(state).filter((id) => {
    const system = systemById(state, id, galaxyId);
    return system && system.owner !== 'player' && system.owner !== 'ai'
      && (system.bodies?.length ?? 0) > 0
      && !state.factions.list.some((faction) => faction.homeSystemId === id);
  });

  while (state.factions.list.length < AI_FACTION_COUNT && candidates.length > 0) {
    const index = Math.floor(rng() * candidates.length);
    const homeSystemId = candidates.splice(index, 1)[0];
    const factionIndex = state.factions.list.length;
    const faction = normalizeFaction(
      state,
      { ...defaultFaction(factionIndex), homeSystemId },
      factionIndex,
    );
    const system = systemById(state, homeSystemId, galaxyId);
    if (system) {
      system.owner = 'ai';
      system.factionId = faction.id;
      const planet = system.bodies.find((body) => body.type === 'habitable') ?? system.bodies[0];
      if (planet && !system.structures.some((structure) => structure.type === 'outpost')) {
        addSeedStructure(state, system, faction, 'outpost', planet.id);
      }
    }
    state.factions.list.push(faction);
  }
  state.factions.ai = state.factions.list[0];
  assignAiFactionOwnership(state);
  return { ok: true, count: state.factions.list.length };
}

export function seedAiFaction(state, galaxyId = state.homeGalaxyId) {
  ensureFactions(state);
  if (state.activeGalaxyId !== galaxyId) {
    return { ok: false, reason: 'Home galaxy must be active to seed AI' };
  }
  const graph = getGraph(state);
  const rng = createRng(hashSeed(state.meta.seed, 'ai-seed'));
  const candidates = rimStars(state).filter((id) => (systemById(state, id, galaxyId)?.bodies?.length ?? 0) > 0);
  if (candidates.length === 0) return { ok: false, reason: 'No rim candidates' };

  const primary = state.factions.list[0];
  const homeSystemId = candidates[Math.floor(rng() * candidates.length)];
  const owned = new Set([homeSystemId]);
  const queue = [homeSystemId];
  while (owned.size < AI_STARTING_SYSTEMS && queue.length) {
    const current = queue.shift();
    for (const next of neighborsOf(graph, current)) {
      if (next === state.stronghold || next === BLACK_HOLE_ID || owned.has(next)) continue;
      const system = systemById(state, next, galaxyId);
      if (!system || system.owner === 'player') continue;
      owned.add(next);
      queue.push(next);
      if (owned.size >= AI_STARTING_SYSTEMS) break;
    }
  }

  for (const systemId of owned) {
    const system = systemById(state, systemId, galaxyId);
    if (!system) continue;
    system.owner = 'ai';
    system.factionId = primary.id;
  }
  primary.homeSystemId = homeSystemId;
  primary.credits = AI_STARTING_CREDITS;

  const home = systemById(state, homeSystemId, galaxyId);
  const planet = home?.bodies.find((body) => body.type === 'habitable') ?? home?.bodies[0];
  if (home && planet) {
    if (!home.structures.some((structure) => structure.type === 'outpost' && structure.bodyId === planet.id)) {
      addSeedStructure(state, home, primary, 'outpost', planet.id, { id: 'ai-st-outpost' });
    }
    if (!home.structures.some((structure) => structure.type === 'shipyard')) {
      addSeedStructure(state, home, primary, 'shipyard', planet.id, { id: 'ai-st-shipyard' });
    }
  }

  seedExtraAiFactions(state, galaxyId);
  assignAiFactionOwnership(state);
  return { ok: true, homeSystemId, owned: [...owned] };
}

function aiOwnedSystems(state, factionId = null) {
  return Object.values(getSystems(state))
    .filter((system) => system.owner === 'ai' && (!factionId || system.factionId === factionId));
}

function persistentAiOwnedSystems(state, factionId = null) {
  return persistentSystemRecords(state)
    .map((record) => record.system)
    .filter((system) => system.owner === 'ai' && (!factionId || system.factionId === factionId));
}

export function aiOwnedSystemIds(state, factionId = null) {
  ensureFactions(state);
  return aiOwnedSystems(state, factionId).map((system) => system.id);
}

export function aiOperationalOutpostCount(state, factionId) {
  return persistentAiOwnedSystems(state, factionId).reduce((count, system) => count + (
    system.structures ?? []
  ).filter((structure) => structure.type === 'outpost'
    && (!structure.factionId || structure.factionId === factionId)
    && operationalStructure(state, structure)).length, 0);
}

function completedDysonSystemsForFaction(state, factionId) {
  const completed = [];
  for (const { galaxyId, systemId, system } of persistentSystemRecords(state)) {
    if (system.owner !== 'ai' || system.factionId !== factionId) continue;
    if ((system.dyson?.completedShells ?? 0) >= SHELL_COUNT) completed.push(`${galaxyId}:${systemId}`);
  }
  return completed.sort();
}

export function refreshAiMilestones(state, faction) {
  const completed = completedDysonSystemsForFaction(state, faction.id);
  faction.milestones.completedDysonSystems = completed;
  faction.milestones.diplomacyUnlocked = completed.length >= 1;
  faction.milestones.superweaponUnlocked = completed.length >= 3;
  return faction.milestones;
}

function aiSolariiPerSecond(state, faction) {
  let total = 0;
  for (const system of persistentAiOwnedSystems(state, faction.id)) {
    const shells = system.dyson?.completedShells ?? 0;
    const collectors = (system.structures ?? []).filter((structure) =>
      structure.type === 'solar_collector' && operationalStructure(state, structure)).length;
    total += SOLARII_BASE_RATE * (SOLARII_SHELL_MULTIPLIERS[shells] ?? 0) * Math.pow(1.05, collectors);
  }
  return total * (techEffects(factionTechContext(faction)).solariiIncomeMult ?? 1);
}

export function applyAiFactionIncomeTick(state, faction, deltaMs = TICK_MS) {
  if (state.paused) return { credits: 0, solarii: 0 };
  const difficulty = aiDifficultyProfile(state, faction);
  const seconds = Math.max(0, deltaMs) / 1000;
  const credits = aiOperationalOutpostCount(state, faction.id)
    * OUTPOST_CREDITS_PER_SECOND * seconds * difficulty.incomeMult;
  const solarii = aiSolariiPerSecond(state, faction) * seconds * difficulty.incomeMult;
  faction.credits += credits;
  faction.solarii += solarii;
  if (solarii > 0) faction.solariiUnlocked = true;
  return { credits, solarii };
}

function structureLevelStrength(structure) {
  const level = Math.max(1, Math.min(3, structure?.level ?? 1));
  return level === 3 ? 2 : level === 2 ? 1.5 : 1;
}

function syncAiResearchInfrastructure(state, faction) {
  let bonus = 0;
  let hasArchive = false;
  for (const system of persistentAiOwnedSystems(state, faction.id)) {
    const structures = (system.structures ?? []).filter((structure) => operationalStructure(state, structure));
    const habitats = structures.filter((structure) => structure.type === 'orbital_habitat').length;
    const habitatMultiplier = Math.pow(1.1, habitats);
    const stationStrength = structures
      .filter((structure) => structure.type === 'research_station')
      .reduce((sum, structure) => sum + structureLevelStrength(structure), 0);
    const archiveStrength = structures
      .filter((structure) => structure.type === 'quantum_archive')
      .reduce((sum, structure) => sum + structureLevelStrength(structure), 0);
    bonus += stationStrength * 0.15 * habitatMultiplier;
    bonus += archiveStrength * 0.15;
    if (archiveStrength > 0) hasArchive = true;
  }
  faction.research.infrastructureSpeedMult = 1 + bonus;
  faction.research.queueSlotBonus = hasArchive ? 1 : 0;
}

function tickAiDyson(state, faction, deltaMs = TICK_MS) {
  const events = [];
  const seconds = Math.max(0, deltaMs) / 1000;
  if (seconds <= 0) return events;
  const effects = techEffects(factionTechContext(faction));
  for (const system of persistentAiOwnedSystems(state, faction.id)) {
    if (system.star?.kind === 'trade_nexus' || system.id === BLACK_HOLE_ID) continue;
    const foundries = (system.structures ?? []).filter((structure) =>
      structure.type === 'sail_foundry' && operationalStructure(state, structure));
    const launchers = (system.structures ?? []).filter((structure) =>
      structure.type === 'dyson_launcher' && operationalStructure(state, structure));
    if (!foundries.length || !launchers.length) continue;
    const dyson = ensureDyson(system);
    if (dyson.completedShells >= SHELL_COUNT) continue;
    const collectors = (system.structures ?? []).filter((structure) =>
      structure.type === 'solar_collector' && operationalStructure(state, structure)).length;
    const foundryRate = launchers.length * LAUNCHER_SAILS_PER_SECOND
      * (effects.foundryOutputMult ?? 1) * Math.pow(1.15, collectors);
    const launcherRate = launchers.length * LAUNCHER_SAILS_PER_SECOND
      * Math.max(1, effects.launcherRateMult ?? 1) * Math.pow(1.1, collectors);
    const wanted = Math.min(foundryRate, launcherRate) * seconds;
    const span = Math.max(1, SAIL_COST_LAUNCHER_REF - 1);
    const t = launchers.length <= 1 ? 0 : Math.min(1, (launchers.length - 1) / span);
    const baseCost = SAIL_CREDIT_COST_MIN + (SAIL_CREDIT_COST_MAX - SAIL_CREDIT_COST_MIN) * t;
    const sailCost = Math.max(0.01, baseCost * (effects.sailCostMult ?? 1));
    const produced = Math.min(wanted, faction.credits / sailCost);
    if (produced <= 0) continue;
    faction.credits -= produced * sailCost;
    dyson.shellSails = (dyson.shellSails ?? 0) + produced;
    while (dyson.shellSails >= SHELL_SAILS_REQUIRED && dyson.completedShells < SHELL_COUNT) {
      dyson.shellSails -= SHELL_SAILS_REQUIRED;
      dyson.completedShells++;
      dyson.lastShellCompletedAt = state.time;
      faction.solariiUnlocked = true;
      events.push({
        type: 'ai_dyson_shell_complete',
        factionId: faction.id,
        systemId: system.id,
        shellNumber: dyson.completedShells,
      });
    }
  }
  refreshAiMilestones(state, faction);
  return events;
}

function systemHasStructure(system, type) {
  return (system?.structures ?? []).some((structure) => structure.type === type && !structure.destroyed);
}

function bodyHasOutpost(system, bodyId) {
  return (system?.structures ?? []).some((structure) =>
    structure.type === 'outpost' && structure.bodyId === bodyId && !structure.destroyed);
}

function queuedConstructionCount(faction, systemId, type, bodyId = undefined) {
  return normalizeProductionState(faction).construction.filter((job) =>
    job.systemId === systemId
      && job.structureType === type
      && (bodyId === undefined || job.bodyId === bodyId)).length;
}

function factionStructureCount(state, factionId, type) {
  return aiOwnedSystems(state, factionId).reduce((count, system) => count
    + (system.structures ?? []).filter((structure) => structure.type === type && !structure.destroyed).length, 0);
}

function definitionCapReached(state, faction, system, bodyId, type, def) {
  const builtInSystem = (system.structures ?? []).filter((structure) =>
    structure.type === type && !structure.destroyed).length;
  const queuedInSystem = queuedConstructionCount(faction, system.id, type);
  if (Number.isFinite(def.systemCap) && builtInSystem + queuedInSystem >= def.systemCap) return true;
  if (def.capScope === 'system' && builtInSystem + queuedInSystem >= (def.cap ?? 1)) return true;
  if (Number.isFinite(def.empireCap)
    && factionStructureCount(state, faction.id, type) >= def.empireCap) return true;
  if (Number.isFinite(def.galaxyCap)
    && factionStructureCount(state, faction.id, type) >= def.galaxyCap) return true;
  if (def.starNode || def.placement === 'star-node') {
    return builtInSystem + queuedInSystem >= (def.cap ?? 1);
  }
  const builtOnBody = (system.structures ?? []).filter((structure) =>
    structure.type === type && structure.bodyId === bodyId && !structure.destroyed).length;
  return builtOnBody + queuedConstructionCount(faction, system.id, type, bodyId) >= (def.cap ?? 1);
}

function candidateBodyForDefinition(state, faction, system, type, def) {
  if (def.starNode || def.placement === 'star-node') {
    if (def.blackHoleOnly && system.id !== BLACK_HOLE_ID && system.star?.kind !== 'blackhole') {
      return undefined;
    }
    if (def.deadStarOnly && (system.bodies?.length ?? 0) > 0) return undefined;
    if (def.requiresDyson) {
      const hasProject = (system.dyson?.completedShells ?? 0) > 0
        || (system.dyson?.shellSails ?? 0) > 0
        || (system.structures ?? []).some((structure) =>
          ['sail_foundry', 'dyson_launcher', 'solar_collector'].includes(structure.type));
      if (!hasProject) return undefined;
    }
    return definitionCapReached(state, faction, system, null, type, def) ? undefined : null;
  }
  for (const body of system.bodies ?? []) {
    if (Array.isArray(def.bodyTypes) && !def.bodyTypes.includes(body.type ?? body.kind)) continue;
    if (def.requiresOutpost && !bodyHasOutpost(system, body.id)) continue;
    if (definitionCapReached(state, faction, system, body.id, type, def)) continue;
    return body.id;
  }
  return undefined;
}

function constructionDurationMs(state, faction, type, def) {
  const base = def.buildMs ?? def.buildDurationMs ?? STRUCTURE_BUILD_MS[type] ?? DEFAULT_BODY_STRUCTURE_BUILD_MS;
  return Math.max(1, Math.round(base * aiDifficultyProfile(state, faction).durationMult));
}

function nextProductionId(faction, prefix) {
  const production = normalizeProductionState(faction);
  return `${faction.id}-${prefix}-${production.nextId++}`;
}

export function queueAiConstruction(state, faction, spec) {
  const production = normalizeProductionState(faction);
  const def = spec.definition ?? structureDefinition(spec.structureType);
  if (!def) return { ok: false, reason: 'Unknown structure type' };
  if (def.tech && !factionHasTech(faction, def.tech)) return { ok: false, reason: 'Required tech not researched' };
  const cost = Math.max(0, finite(spec.cost, def.cost));
  if (faction.credits < cost) return { ok: false, reason: `Need ${cost} credits` };
  const durationMs = spec.durationMs ?? constructionDurationMs(state, faction, spec.structureType, def);
  const job = {
    id: nextProductionId(faction, spec.kind === 'upgrade' ? 'upgrade' : 'build'),
    kind: spec.kind ?? 'build',
    structureType: spec.structureType,
    systemId: spec.systemId,
    bodyId: spec.bodyId ?? null,
    structureId: spec.structureId ?? null,
    level: spec.level ?? 1,
    startedAt: state.time,
    durationMs,
    completesAt: state.time + durationMs,
    costPaid: cost,
    factionId: faction.id,
  };
  faction.credits -= cost;
  production.construction.push(job);
  return { ok: true, job };
}

function fallbackCompleteBuild(state, faction, job) {
  const system = systemById(state, job.systemId);
  const def = structureDefinition(job.structureType);
  if (!system || system.owner !== 'ai' || system.factionId !== faction.id || !def) return null;
  if (definitionCapReached(state, faction, system, job.bodyId, job.structureType, def)) return null;
  const structure = {
    id: `ai-${job.structureType}-${job.systemId}-${job.id}`,
    type: job.structureType,
    bodyId: (def.starNode || def.placement === 'star-node') ? null : job.bodyId,
    placement: def.placement,
    builtAtTime: state.time,
    owner: 'ai',
    factionId: faction.id,
    level: 1,
    disabledUntil: 0,
  };
  if (def.hp) {
    structure.maxHp = def.hp;
    structure.hp = def.hp;
  }
  if (structure.type === 'shipyard') structure.builds = [];
  system.structures.push(structure);
  return structure;
}

function fallbackCompleteUpgrade(state, faction, job) {
  const system = systemById(state, job.systemId);
  const structure = system?.structures?.find((candidate) => candidate.id === job.structureId);
  if (!structure || system.owner !== 'ai' || system.factionId !== faction.id) return null;
  structure.level = Math.max(structure.level ?? 1, Math.min(3, job.level ?? (structure.level ?? 1) + 1));
  return structure;
}

function completeAiConstructionJobs(state, faction) {
  const production = normalizeProductionState(faction);
  const remaining = [];
  const due = [];
  const events = [];
  for (const job of production.construction) {
    const targetActive = !!systemById(state, job.systemId);
    const targetPersistent = !targetActive && persistentSystemRecords(state).some(
      ({ systemId, system }) => systemId === job.systemId
        && system.owner === 'ai' && system.factionId === faction.id,
    );
    if (state.time < (job.completesAt ?? job.startedAt + job.durationMs) || targetPersistent) {
      remaining.push(job);
    } else {
      due.push(job);
    }
  }
  // Remove due work before placement validation so a job does not count itself
  // against a one-per-system/body cap.
  production.construction = remaining;
  for (const job of due) {
    let result = null;
    let authoritativeFailure = false;
    const hook = job.kind === 'upgrade' ? aiStructureHooks.upgrade : aiStructureHooks.build;
    if (typeof hook === 'function') {
      try {
        result = hook({ state, faction, job, alreadyPaid: true, remote: true });
      } catch {
        result = null;
      }
    } else if (BODY_STRUCTURE_DEFS[job.structureType]) {
      const nativeOpts = {
        factionId: faction.id,
        remote: true,
        ignoreCredits: true,
        alreadyPaid: true,
        unlockedTechs: faction.research.unlocked,
      };
      result = job.kind === 'upgrade'
        ? upgradeBodyStructure(state, job.systemId, job.structureId, {
          ...nativeOpts,
          maxLevel: job.level,
        })
        : buildBodyStructure(state, job.systemId, job.bodyId, job.structureType, nativeOpts);
      authoritativeFailure = !result?.ok;
    }
    let structure = null;
    if (result?.ok) {
      const structureId = result.structureId ?? job.structureId;
      structure = systemById(state, job.systemId)?.structures?.find((candidate) => candidate.id === structureId)
        ?? result.structure
        ?? true;
      if (structure !== true) {
        structure.owner = 'ai';
        structure.factionId = faction.id;
      }
    } else if (!authoritativeFailure) {
      structure = job.kind === 'upgrade'
        ? fallbackCompleteUpgrade(state, faction, job)
        : fallbackCompleteBuild(state, faction, job);
    }
    if (structure) {
      events.push({
        type: job.kind === 'upgrade' ? 'ai_structure_upgraded' : 'ai_structure_built',
        factionId: faction.id,
        systemId: job.systemId,
        structureType: job.structureType,
        structureId: structure === true ? job.structureId : structure.id,
        level: structure === true ? job.level : structure.level,
      });
    } else {
      // Placement changed before completion. Refund the exact paid cost.
      faction.credits += job.costPaid ?? 0;
      events.push({ type: 'ai_construction_cancelled', factionId: faction.id, jobId: job.id });
    }
  }
  return events;
}

function structurePriority(faction, type, def) {
  const strategy = factionStrategy(faction.personality);
  const focusIndex = strategy.buildingFocus.indexOf(type);
  let score = focusIndex >= 0 ? 320 - focusIndex * 20 : 100;
  const text = `${type} ${def.label ?? ''} ${def.effect ?? ''}`.toLowerCase();
  const techPriority = AI_PERSONALITY_PRIORITIES[faction.personality]
    ?? AI_PERSONALITY_PRIORITIES.expansionist;
  score += techPriority.keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 18 : 0), 0);
  if (Number.isFinite(def.aiPriority)) score += def.aiPriority;
  if (Number.isFinite(def.aiPriority?.[faction.personality])) score += def.aiPriority[faction.personality];
  return score;
}

function upgradeCostForDefinition(type, def, currentLevel) {
  if (typeof aiStructureHooks.upgradeCost === 'function') {
    const hooked = aiStructureHooks.upgradeCost(type, currentLevel);
    if (Number.isFinite(hooked)) return Math.max(0, hooked);
  }
  const nextLevel = Math.min(3, currentLevel + 1);
  const explicit = def.upgradeCosts?.[nextLevel]
    ?? def.levels?.[nextLevel]?.cost
    ?? def.levelCosts?.[nextLevel];
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  if (BODY_STRUCTURE_DEFS[type]) {
    const catalogCost = bodyStructureUpgradeCost(type, currentLevel);
    if (Number.isFinite(catalogCost)) return catalogCost;
  }
  const multiplier = STRUCTURE_UPGRADE_COST_MULTIPLIERS[nextLevel] ?? (nextLevel === 2 ? 0.75 : 1.25);
  return Math.ceil((def.cost ?? 0) * multiplier);
}

function constructionCandidates(state, faction, tickIndex) {
  const candidates = [];
  const systems = aiOwnedSystems(state, faction.id).sort((a, b) => a.id.localeCompare(b.id));
  const definitions = { ...BODY_STRUCTURE_DEFS, ...CORE_STRUCTURE_DEFS };
  const structureLevelCaps = techEffects(factionTechContext(faction)).structureLevelCaps ?? {};
  for (const system of systems) {
    for (const [type, def] of Object.entries(definitions)) {
      if (def.tech && !factionHasTech(faction, def.tech)) continue;
      if (type === 'outpost' && systemHasStructure(system, 'outpost')) continue;
      if (type === 'shipyard' && (!systemHasStructure(system, 'outpost') || systemHasStructure(system, 'shipyard'))) continue;
      if (type === 'sail_foundry' && systemHasStructure(system, 'sail_foundry')) continue;
      if (type === 'dyson_launcher' && !systemHasStructure(system, 'sail_foundry')) continue;
      const bodyId = candidateBodyForDefinition(state, faction, system, type, def);
      if (bodyId === undefined) continue;
      if (BODY_STRUCTURE_DEFS[type]) {
        const nativeCheck = canBuildBodyStructure(state, system.id, bodyId, type, {
          factionId: faction.id,
          remote: true,
          unlockedTechs: faction.research.unlocked,
        });
        if (!nativeCheck.ok) continue;
      }
      const cost = Math.max(0, finite(def.cost));
      if (faction.credits < cost) continue;
      let score = structurePriority(faction, type, def);
      if (type === 'outpost') score += faction.personality === 'expansionist' ? 260 : 150;
      if (type === 'shipyard') score += 120;
      if (['sail_foundry', 'dyson_launcher'].includes(type)) {
        score += faction.personality === 'megastructure' ? 280 : 70;
      }
      score += (hashSeed(state.meta.seed, `${faction.id}:${type}:${system.id}:${tickIndex}`) % 1000) / 1000;
      candidates.push({ kind: 'build', structureType: type, systemId: system.id, bodyId, definition: def, cost, score });
    }

    for (const structure of system.structures ?? []) {
      const def = definitions[structure.type];
      const currentLevel = Math.max(1, Math.min(3, structure.level ?? 1));
      const maxLevel = Math.max(1, Math.min(3, structureLevelCaps[structure.type] ?? 1));
      if (!def || def.upgradeable === false || currentLevel >= maxLevel || !operationalStructure(state, structure)) continue;
      if (def.tech && !factionHasTech(faction, def.tech)) continue;
      if (normalizeProductionState(faction).construction.some((job) => job.structureId === structure.id)) continue;
      const nativeCost = BODY_STRUCTURE_DEFS[structure.type]
        ? bodyStructureUpgradeCost(structure.type, currentLevel)
        : undefined;
      if (BODY_STRUCTURE_DEFS[structure.type] && !Number.isFinite(nativeCost)) continue;
      const cost = Number.isFinite(nativeCost)
        ? nativeCost
        : upgradeCostForDefinition(structure.type, def, currentLevel);
      if (faction.credits < cost) continue;
      if (BODY_STRUCTURE_DEFS[structure.type]) {
        const nativeCheck = canUpgradeBodyStructure(state, system.id, structure.id, {
          factionId: faction.id,
          remote: true,
          maxLevel: currentLevel + 1,
          unlockedTechs: faction.research.unlocked,
        });
        if (!nativeCheck.ok) continue;
      }
      const score = structurePriority(faction, structure.type, def) * 0.75 + currentLevel * 15;
      candidates.push({
        kind: 'upgrade', structureType: structure.type, structureId: structure.id,
        systemId: system.id, bodyId: structure.bodyId, definition: def,
        level: currentLevel + 1, cost, score,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score
    || a.systemId.localeCompare(b.systemId)
    || a.structureType.localeCompare(b.structureType));
}

export function queueAiStructureDecision(state, faction, tickIndex = 0) {
  const production = normalizeProductionState(faction);
  if (production.construction.length >= 1) return { ok: false, reason: 'Construction queue busy' };
  const candidate = constructionCandidates(state, faction, tickIndex)[0];
  if (!candidate) return { ok: false, reason: 'No legal affordable construction' };
  return queueAiConstruction(state, faction, candidate);
}

function shipyardSlotsForFaction(faction, shipyard) {
  const techSlots = techEffects(factionTechContext(faction)).shipyardSlots ?? 1;
  const extra = (shipyard.level ?? 1) >= 2 ? 1 : 0;
  return Math.max(1, techSlots + extra);
}

function aiIdleShipyard(state, faction) {
  const candidates = [];
  for (const system of aiOwnedSystems(state, faction.id)) {
    for (const shipyard of system.structures ?? []) {
      if (shipyard.type !== 'shipyard' || !operationalStructure(state, shipyard)) continue;
      normalizeShipyardBuilds(shipyard);
      if (shipyard.builds.length >= shipyardSlotsForFaction(faction, shipyard)) continue;
      candidates.push({ shipyard, systemId: system.id, bodyId: shipyard.bodyId });
    }
  }
  return candidates.sort((a, b) => a.shipyard.builds.length - b.shipyard.builds.length
    || a.systemId.localeCompare(b.systemId)
    || a.shipyard.id.localeCompare(b.shipyard.id))[0] ?? null;
}

function aiHullScore(faction, hull) {
  const stats = hullStats(hull);
  if (!stats || stats.cost <= 0) return -Infinity;
  const focus = factionStrategy(faction.personality).fleetFocus;
  const focusIndex = focus.indexOf(hull);
  let score = focusIndex >= 0 ? 500 - focusIndex * 35 : 100;
  if (faction.personality === 'expansionist') score += stats.captureForce * 30 + stats.dps * 2;
  if (faction.personality === 'economic' && ['light_hauler', 'bulk_freighter', 'armored_convoy'].includes(hull)) score += 220;
  if (faction.personality === 'megastructure' && ['builder_ship', 'miner'].includes(hull)) score += 220;
  if (faction.personality === 'wormhole') score += (stats.laneSpeed ?? 0) * 0.8;
  return score;
}

function selectAiHull(faction) {
  const context = factionTechContext(faction);
  return empireQueueHulls(context)
    .filter((hull) => hullStats(hull)?.cost > 0)
    .filter((hull) => hullQueueCost(context, hull) <= faction.credits)
    .sort((a, b) => aiHullScore(faction, b) - aiHullScore(faction, a) || a.localeCompare(b))[0] ?? null;
}

function aiShipBuildDuration(state, faction, system, shipyard, hull) {
  const base = hullStats(hull)?.buildMs;
  if (!base) return null;
  const levelMult = SHIPYARD_LEVEL_BUILD_TIME_MULTIPLIERS[shipyard.level ?? 1]
    ?? ((shipyard.level ?? 1) >= 3 ? 0.8 : (shipyard.level ?? 1) >= 2 ? 0.9 : 1);
  const nanoforges = (system.structures ?? []).filter((structure) =>
    structure.type === 'nanoforge' && operationalStructure(state, structure)).length;
  return Math.max(1, Math.round(base * aiDifficultyProfile(state, faction).durationMult
    * levelMult / Math.pow(1.15, nanoforges)));
}

export function queueAiShip(state, faction, requestedHull = null) {
  const yard = aiIdleShipyard(state, faction);
  if (!yard) return { ok: false, reason: 'No idle faction shipyard' };
  const hull = requestedHull ?? selectAiHull(faction);
  if (!hull || !empireQueueHulls(factionTechContext(faction)).includes(hull)) {
    return { ok: false, reason: 'Hull not unlocked' };
  }
  const cost = hullQueueCost(factionTechContext(faction), hull);
  if (!Number.isFinite(cost) || faction.credits < cost) return { ok: false, reason: `Need ${cost} credits` };
  const system = systemById(state, yard.systemId);
  const durationMs = aiShipBuildDuration(state, faction, system, yard.shipyard, hull);
  if (!durationMs) return { ok: false, reason: 'Unknown hull build duration' };
  const queueItemId = nextProductionId(faction, 'ship');
  const build = {
    hull,
    startedAt: state.time,
    durationMs,
    queueItemId,
    costPaid: cost,
    ai: true,
    factionId: faction.id,
  };
  faction.credits -= cost;
  yard.shipyard.builds.push(build);
  normalizeProductionState(faction).queue.push({
    id: queueItemId,
    hull,
    shipyardId: yard.shipyard.id,
    systemId: yard.systemId,
    startedAt: state.time,
    durationMs,
    costPaid: cost,
    status: 'building',
  });
  return { ok: true, build, queueItemId, systemId: yard.systemId };
}

function aiTickShipyardBuilds(state) {
  const spawned = [];
  for (const system of aiOwnedSystems(state)) {
    for (const shipyard of system.structures ?? []) {
      if (shipyard.type !== 'shipyard') continue;
      normalizeShipyardBuilds(shipyard);
      const remaining = [];
      for (const build of shipyard.builds) {
        if (state.time < build.startedAt + build.durationMs) {
          remaining.push(build);
          continue;
        }
        const factionId = build.factionId ?? shipyard.factionId ?? system.factionId ?? state.factions.ai.id;
        const faction = state.factions.list.find((candidate) => candidate.id === factionId) ?? state.factions.ai;
        const academy = (system.structures ?? []).some((structure) =>
          structure.type === 'fleet_academy' && operationalStructure(state, structure));
        const ship = spawnAiShip(state, system.id, build.hull, shipyard.bodyId, {
          factionId: faction.id,
          veterancy: academy ? 1 : 0,
        });
        if (ship) spawned.push(ship);
        faction.production.queue = faction.production.queue.filter((item) => item.id !== build.queueItemId);
      }
      shipyard.builds = remaining;
    }
  }
  return spawned;
}

function adjacentSystemsOwnedBy(state, systemId, owner) {
  const out = [];
  for (const next of neighborsOf(getGraph(state), systemId)) {
    const system = systemById(state, next);
    if (system?.owner === owner) out.push(next);
  }
  return out.sort();
}

export function aiCaptureSystem(state, systemId, factionId = null) {
  ensureFactions(state);
  const system = systemById(state, systemId);
  const clearProgress = () => {
    for (const key of Object.keys(state.aiCaptureProgress ?? {})) {
      if (key.endsWith(`:${state.activeGalaxyId}:${systemId}`)) delete state.aiCaptureProgress[key];
    }
  };
  if (!system || !['neutral', 'player', 'ai'].includes(system.owner) || systemId === BLACK_HOLE_ID) {
    clearProgress();
    return false;
  }
  if (state.systemBattles?.[systemId]?.active) {
    clearProgress();
    return false;
  }
  const playerDefenders = (state.playerShips ?? []).some((ship) => ship.galaxyId === state.activeGalaxyId
    && ship.systemId === systemId && !ship.transit && ship.hp > 0)
    || (state.flagship?.galaxyId === state.activeGalaxyId && state.flagship.systemId === systemId
      && !state.flagship.transit && (state.flagship.hp ?? 1) > 0)
    || (state.heroFlagships ?? []).some((hero) => hero.galaxyId === state.activeGalaxyId
      && hero.systemId === systemId && !hero.transit && hero.hp > 0);
  if (system.owner === 'player' && playerDefenders) {
    clearProgress();
    return false;
  }
  if (system.owner === 'ai' && system.factionId
    && aiCombatPresence(state, systemId, system.factionId) > 0) {
    clearProgress();
    return false;
  }
  const factions = factionId
    ? [aiFactionById(state, factionId)].filter(Boolean)
    : state.factions.list;
  const winner = factions
    .filter((faction) => {
      if (system.owner === 'neutral') return true;
      const controller = system.owner === 'player' ? 'player' : system.factionId;
      return controller !== faction.id && canAttackFaction(state, controller, faction.id).ok;
    })
    .map((faction) => ({ faction, force: aiCombatPresence(state, systemId, faction.id) }))
    .filter((entry) => entry.force >= captureRequirement(state, systemId))
    .sort((a, b) => b.force - a.force || a.faction.id.localeCompare(b.faction.id))[0];
  if (!winner) {
    clearProgress();
    return false;
  }
  state.aiCaptureProgress ??= {};
  const progressId = `${winner.faction.id}:${state.activeGalaxyId}:${systemId}`;
  state.aiCaptureProgress[progressId] = (state.aiCaptureProgress[progressId] ?? 0) + TICK_MS;
  if (state.aiCaptureProgress[progressId] < CAPTURE_HOLD_MS) return false;
  delete state.aiCaptureProgress[progressId];
  const previousOwner = system.owner;
  const previousActor = previousOwner === 'player' ? 'player' : system.factionId;
  if (previousOwner === 'player' || (previousOwner === 'ai' && previousActor !== winner.faction.id)) {
    const occupied = recordOccupation(state, {
      galaxyId: state.activeGalaxyId,
      systemId,
      occupier: winner.faction.id,
      previousActor,
      previousOwner,
      previousFactionId: previousOwner === 'ai' ? previousActor : null,
    });
    if (!occupied.ok) return false;
  } else {
    system.owner = 'ai';
    system.factionId = winner.faction.id;
  }
  for (const structure of system.structures ?? []) {
    structure.factionId = winner.faction.id;
    syncMothballState(winner.faction, structure);
  }
  reconcileStructureTechnology(state, system.id, { factionId: winner.faction.id });
  return true;
}

function aiCaptureCandidateSystemIds(state) {
  const ids = new Set();
  for (const ship of state.aiShips ?? []) {
    if (ship.galaxyId === state.activeGalaxyId && ship.systemId && !ship.transit && ship.hp > 0) ids.add(ship.systemId);
  }
  return ids;
}

export function forceAiCapture(state, systemId, factionId = null) {
  ensureFactions(state);
  const system = systemById(state, systemId);
  if (!system || systemId === BLACK_HOLE_ID) {
    return { ok: false, reason: 'Cannot force capture' };
  }
  const faction = aiFactionById(state, factionId) ?? state.factions.ai;
  if (system.owner === 'player' || (system.owner === 'ai' && system.factionId !== faction.id)) {
    const previousActor = system.owner === 'player' ? 'player' : system.factionId;
    const occupied = recordOccupation(state, {
      galaxyId: state.activeGalaxyId,
      systemId,
      occupier: faction.id,
      previousActor,
      previousOwner: system.owner,
      previousFactionId: system.owner === 'ai' ? system.factionId : null,
      force: true,
    });
    if (!occupied.ok) return occupied;
  } else {
    system.owner = 'ai';
    system.factionId = faction.id;
  }
  for (const structure of system.structures ?? []) {
    structure.factionId = faction.id;
    syncMothballState(faction, structure);
  }
  reconcileStructureTechnology(state, system.id, { factionId: faction.id });
  return { ok: true, systemId, factionId: faction.id };
}

function aiDispatchToNeutral(state, faction, rng) {
  const owned = aiOwnedSystems(state, faction.id);
  if (!owned.length) return false;
  const ordered = [...owned].sort((a, b) => a.id.localeCompare(b.id));
  const start = Math.floor(rng() * ordered.length);
  for (let offset = 0; offset < ordered.length; offset++) {
    const from = ordered[(start + offset) % ordered.length];
    const targets = adjacentSystemsOwnedBy(state, from.id, 'neutral');
    if (!targets.length) continue;
    const ships = aiShipsInSystem(state, from.id, faction.id);
    if (!ships.length) continue;
    const targetId = targets[Math.floor(rng() * targets.length)];
    if (aiFleetPowerInSystem(state, from.id, faction.id) < captureRequirement(state, targetId) * 10) continue;
    return orderAiShipTravel(state, ships[0], targetId).ok;
  }
  return false;
}

function aiDispatchToPlayerBorder(state, faction, rng) {
  if (!aiShouldContestPlayerLocal(state, faction.id)) return false;
  for (const from of aiOwnedSystems(state, faction.id).sort((a, b) => a.id.localeCompare(b.id))) {
    const borders = adjacentSystemsOwnedBy(state, from.id, 'player');
    if (!borders.length) continue;
    const ships = aiShipsInSystem(state, from.id, faction.id);
    if (!ships.length) continue;
    return orderAiShipTravel(state, ships[0], borders[Math.floor(rng() * borders.length)]).ok;
  }
  return false;
}

function applyAbstractFleetDamage(ships, damage) {
  let remaining = Math.max(0, damage);
  let destroyed = 0;
  for (const ship of [...ships].sort((a, b) => a.id.localeCompare(b.id))) {
    if (remaining <= 0) break;
    const applied = Math.min(ship.hp, remaining);
    ship.hp = Math.max(0, ship.hp - applied);
    remaining -= applied;
    if (ship.hp <= 0) destroyed++;
  }
  return destroyed;
}

// The tactical battle simulator is intentionally player-facing. Rival fleets
// therefore use a cheap deterministic attrition pass so AI wars still move
// ships, inflict real losses, and create occupiable fronts off screen.
function resolveAiRivalBattle(state, systemId) {
  const system = systemById(state, systemId);
  if (system?.owner !== 'ai' || !system.factionId) return null;
  const defenderId = system.factionId;
  const attackers = state.factions.list
    .filter((faction) => faction.id !== defenderId
      && canAttackFaction(state, defenderId, faction.id).ok
      && aiCombatPresence(state, systemId, faction.id) > 0)
    .map((faction) => ({
      faction,
      power: aiFleetPowerInSystem(state, systemId, faction.id),
    }))
    .sort((a, b) => b.power - a.power || a.faction.id.localeCompare(b.faction.id));
  const attacker = attackers[0];
  const defenderShips = aiShipsInSystem(state, systemId, defenderId);
  if (!attacker || !defenderShips.length) return null;

  state.aiFactionBattleTicks ??= {};
  const second = Math.floor(state.time / 1000);
  const battleKey = `${state.activeGalaxyId}:${systemId}:${attacker.faction.id}:${defenderId}`;
  if (state.aiFactionBattleTicks[battleKey] === second) return null;
  state.aiFactionBattleTicks[battleKey] = second;

  const attackerShips = aiShipsInSystem(state, systemId, attacker.faction.id);
  const defenderPower = aiFleetPowerInSystem(state, systemId, defenderId);
  const attackerLosses = applyAbstractFleetDamage(attackerShips, Math.max(1, defenderPower * 0.06));
  const defenderLosses = applyAbstractFleetDamage(defenderShips, Math.max(1, attacker.power * 0.06));
  const attackerSurvives = attackerShips.some((ship) => ship.hp > 0);
  const defenderSurvives = defenderShips.some((ship) => ship.hp > 0);
  const war = getActiveWar(state, [attacker.faction.id, defenderId]);
  if (war && attackerSurvives !== defenderSurvives) {
    const winner = attackerSurvives ? attacker.faction.id : defenderId;
    const loser = attackerSurvives ? defenderId : attacker.faction.id;
    recordWarEvent(state, war.id, {
      type: 'battle_victory', actor: winner, systemId,
      scoreDelta: 6, exhaustionDelta: 1,
      details: { abstract: true, opponent: loser },
    });
    recordWarEvent(state, war.id, {
      type: 'battle_defeat', actor: loser, systemId,
      scoreDelta: -6, exhaustionDelta: 3,
      details: { abstract: true, opponent: winner },
    });
  }
  return {
    type: 'ai_rival_battle', systemId,
    attacker: attacker.faction.id, defender: defenderId,
    attackerLosses, defenderLosses,
  };
}

function aiDispatchToRivalBorder(state, faction, rng) {
  for (const from of aiOwnedSystems(state, faction.id).sort((a, b) => a.id.localeCompare(b.id))) {
    const targets = neighborsOf(getGraph(state), from.id)
      .map((systemId) => systemById(state, systemId))
      .filter((system) => system?.owner === 'ai'
        && system.factionId !== faction.id
        && canAttackFaction(state, system.factionId, faction.id).ok)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!targets.length) continue;
    const ships = aiShipsInSystem(state, from.id, faction.id);
    if (!ships.length) continue;
    const target = targets[Math.floor(rng() * targets.length)];
    return orderAiShipTravel(state, ships[0], target.id).ok;
  }
  return false;
}

export function tickAiFaction(state) {
  if (state.paused) return [];
  ensureFactions(state);
  const events = [];
  for (const faction of state.factions.list) {
    const income = applyAiFactionIncomeTick(state, faction);
    if (income.credits || income.solarii) {
      faction.lastIncome = { at: state.time, ...income };
    }
    syncAiResearchInfrastructure(state, faction);
    events.push(...tickAiDyson(state, faction));
    events.push(...tickAiResearch(state, faction));
    events.push(...completeAiConstructionJobs(state, faction));
  }

  events.push(...aiTickShipyardBuilds(state).map((ship) => ({
    type: 'ai_ship_spawn', shipId: ship.id, factionId: ship.factionId,
  })));

  for (const systemId of aiCaptureCandidateSystemIds(state)) {
    const rivalBattle = resolveAiRivalBattle(state, systemId);
    if (rivalBattle) events.push(rivalBattle);
    if (['neutral', 'player', 'ai'].includes(systemById(state, systemId)?.owner) && aiCaptureSystem(state, systemId)) {
      events.push({ type: 'ai_capture', systemId, factionId: systemById(state, systemId).factionId });
    }
  }

  const tickIndex = Math.floor(state.time / TICK_MS);
  if (tickIndex % AI_TICK_INTERVAL_TICKS !== 0) return events;

  for (const faction of [...state.factions.list].sort((a, b) => a.id.localeCompare(b.id))) {
    const rng = aiRng(state, faction.id, tickIndex);
    faction.lastActionTick = tickIndex;
    faction.production.lastDecisionTick = tickIndex;

    for (const result of fillAiResearchQueue(state, faction, tickIndex)) {
      events.push({
        type: result.queued ? 'ai_research_queued' : 'ai_research_started',
        factionId: faction.id,
        nodeId: result.nodeId,
      });
    }
    const construction = queueAiStructureDecision(state, faction, tickIndex);
    if (construction.ok) {
      events.push({
        type: 'ai_construction_started', factionId: faction.id,
        jobId: construction.job.id, structureType: construction.job.structureType,
      });
    }
    const ship = queueAiShip(state, faction);
    if (ship.ok) {
      events.push({
        type: 'ai_ship_queued', factionId: faction.id,
        hull: ship.build.hull, queueItemId: ship.queueItemId,
      });
    }

    if (!aiDispatchToNeutral(state, faction, rng)
      && !aiDispatchToRivalBorder(state, faction, rng)) {
      aiDispatchToPlayerBorder(state, faction, rng);
    }
  }
  return events;
}

export function aiFactionSummary(state) {
  ensureFactions(state);
  const summaries = state.factions.list.map((faction) => {
    const owned = aiOwnedSystems(state, faction.id).map((system) => system.id);
    return {
      id: faction.id,
      name: faction.name,
      personality: faction.personality,
      difficulty: faction.difficulty,
      homeSystemId: faction.homeSystemId,
      credits: Math.round(faction.credits * 100) / 100,
      solarii: Math.round(faction.solarii * 1000) / 1000,
      ownedSystemCount: owned.length,
      ownedSystems: owned.slice(0, 12),
      fleetCount: (state.aiShips ?? []).filter((ship) =>
        ship.galaxyId === state.activeGalaxyId && ship.factionId === faction.id).length,
      research: {
        activeNodeId: faction.research.activeNodeId,
        progress: Math.round((faction.research.progress ?? 0) * 1000) / 1000,
        unlockedCount: faction.research.unlocked.length,
        queue: [...faction.research.queue],
      },
      production: {
        shipQueueCount: faction.production.queue.length,
        constructionQueueCount: faction.production.construction.length,
      },
      strategy: faction.strategy,
    };
  });
  const primary = summaries[0];
  return {
    ...primary,
    factionCount: summaries.length,
    all: summaries,
  };
}
