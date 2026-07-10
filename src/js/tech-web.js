// Tech web logic — effects, unlocks, validation, and queries (GDD §10).

import {
  TECH_NODES,
  V13_TECH_COST_CURVE,
  V13_TECH_NODE_IDS,
  v13TechCostsForTier,
} from './tech-nodes.js';
import { refreshMilestones } from './milestones.js';

export {
  TECH_NODES,
  V13_TECH_COST_CURVE,
  V13_TECH_NODE_IDS,
  v13TechCostsForTier,
};

const TECH_CLUSTERS = Object.freeze([
  'economy',
  'military',
  'megastructure',
  'trade',
  'wormhole',
  'research',
  'diplomacy',
  'flagship',
  'superweapon',
]);

export const STRUCTURE_UNLOCK_EFFECT_FIELDS = Object.freeze({
  power_grid: 'unlockPowerGrid',
  orbital_habitat: 'unlockOrbitalHabitat',
  nanoforge: 'unlockNanoforge',
  fleet_academy: 'unlockFleetAcademy',
  missile_silo: 'unlockMissileSilo',
  interdiction_array: 'unlockInterdictionArray',
  carrier_command: 'unlockCarrierCommand',
  sensor_array: 'unlockSensorArray',
  solar_collector: 'unlockSolarCollector',
  logistics_hub: 'unlockLogisticsHub',
  galactic_exchange: 'unlockGalacticExchange',
  salvage_yard: 'unlockSalvageYard',
  wormhole_observatory: 'unlockWormholeObservatory',
  quantum_archive: 'unlockQuantumArchive',
  embassy_complex: 'unlockEmbassyComplex',
});

export const UPGRADABLE_STRUCTURE_TYPES = Object.freeze([
  'outpost',
  'mining_complex',
  'refinery',
  'storage_depot',
  'shipyard',
  'research_station',
  'quantum_archive',
  'fighter_factory',
  'drydock',
  'orbital_defense',
  'planetary_shield',
  'ion_battery',
  'missile_silo',
  'interdiction_array',
  'sail_foundry',
  'dyson_launcher',
  'solar_collector',
]);

export function techNode(nodeId) {
  return TECH_NODES[nodeId] ?? null;
}

export function nodeEffectDescriptors(nodeOrId) {
  const node = typeof nodeOrId === 'string' ? techNode(nodeOrId) : nodeOrId;
  if (!node) return [];
  if (Array.isArray(node.effects)) return node.effects;
  return node.effect ? [{ type: 'legacy', id: node.effect }] : [];
}

function createDefaultTechEffects() {
  const structureUnlocks = Object.fromEntries(
    Object.keys(STRUCTURE_UNLOCK_EFFECT_FIELDS).map((type) => [type, false]),
  );
  const structureLevelCaps = Object.fromEntries(
    UPGRADABLE_STRUCTURE_TYPES.map((type) => [type, 1]),
  );

  return {
    shipyardSlots: 1,
    unlockTradeStation: false,
    unlockDestroyerQueue: false,
    unlockFrigateQueue: false,
    unlockPatrolCutter: false,
    unlockCruiserQueue: false,
    unlockBattleshipQueue: false,
    unlockDreadnoughtQueue: false,
    unlockLightCarrierQueue: false,
    unlockFleetCarrierQueue: false,
    unlockSuperCarrierQueue: false,
    unlockSensorShip: false,
    unlockConstructionDrones: false,
    unlockBuilderShip: false,
    unlockCommandCruiser: false,
    unlockHeroFlagship: false,
    unlockMinerHull: false,
    unlockMiningComplex: false,
    unlockRefinery: false,
    unlockStorageDepot: false,
    unlockAsteroidHarvester: false,
    unlockFighterFactory: false,
    unlockDrydock: false,
    unlockOrbitalDefense: false,
    unlockPlanetaryShield: false,
    unlockIonBattery: false,
    unlockLightHauler: false,
    unlockBulkFreighter: false,
    unlockArmoredConvoy: false,
    unlockFoundry: false,
    unlockLauncher: false,
    unlockResearchStation: false,
    unlockPowerGrid: false,
    unlockOrbitalHabitat: false,
    unlockNanoforge: false,
    unlockFleetAcademy: false,
    unlockMissileSilo: false,
    unlockInterdictionArray: false,
    unlockCarrierCommand: false,
    unlockSensorArray: false,
    unlockSolarCollector: false,
    unlockLogisticsHub: false,
    unlockGalacticExchange: false,
    unlockSalvageYard: false,
    unlockWormholeObservatory: false,
    unlockQuantumArchive: false,
    unlockEmbassyComplex: false,
    structureUnlocks,
    structureModifiers: {},
    structureLevelCaps,
    dysonShellSync: false,
    dysonShellBonus: false,
    dysonShield: false,
    tradeHubTier2: false,
    galacticCouncil: false,
    flagshipMobileShipyard: false,
    sovereignCore: false,
    cradlePowerCore: false,
    precisionTargeting: false,
    genesisMatrix: false,
    gateArray: false,
    sovereignProtocol: false,
    outpostIncomeMult: 1,
    creditIncomeMult: 1,
    tradeIncomeMult: 1,
    researchSpeedMult: 1,
    researchQueueDepth: 1,
    foundryOutputMult: 1,
    launcherRateMult: 1,
    solariiIncomeMult: 1,
    corvetteHpMult: 1,
    frigateHpMult: 1,
    destroyerDpsMult: 1,
    battleshipDpsMult: 1,
    carrierDpsMult: 1,
    carrierWings: false,
    carrierWingCapacityMult: 1,
    pointDefenseMult: 1,
    kineticDamageMult: 1,
    bomberDamageMult: 1,
    beamDamageMult: 1,
    ionDamageMult: 1,
    healerRepairMult: 1,
    scoutCostMult: 1,
    shipyardCostMult: 1,
    sailCostMult: 1,
    moonYieldMult: 1,
    captureForceBonus: 0,
    tradeNeutralBridge: false,
    anchorCostMult: 1,
    intelHopBonus: 0,
    wormholeTransitMult: 1,
    habitatOutputMult: 1,
    orbitalHabitatCapBonus: 0,
    industrialOutputMult: 1,
    cargoProductionMult: 1,
    outpostCargoOutputMult: 1,
    outpostStockCapacityBonus: 0,
    veterancyExperienceMult: 1,
    defensePowerMult: 1,
    shipBuildSpeedMult: 1,
    fighterReplenishmentMult: 1,
    weaponRangeMult: 1,
    fleetDamageMult: 1,
    solarCollectorOutputMult: 1,
    dysonOutputMult: 1,
    logisticsDispatchIntervalMult: 1,
    convoyRouteBonus: 0,
    manualTradeRouteBonus: 0,
    nexusDeliveryValueMult: 1,
    cargoLossMult: 1,
    wormholeChargeRateMult: 1,
    anchorNetworkCapacityBonus: 0,
    interdictionStrengthMult: 1,
    quantumCorridorCapacityBonus: 0,
    quantumArchiveOutputMult: 1,
    treatyCostMult: 1,
    treatyEffectMult: 1,
    alliedDefenseMult: 1,
    flagshipCommandMult: 1,
    flagshipBuildSpeedMult: 1,
    flagshipJumpChargeMult: 1,
    flagshipDiplomacyMult: 1,
    superweaponPowerMult: 1,
    superweaponPrecisionMult: 1,
    genesisEfficiencyMult: 1,
    gateChargeMult: 1,
  };
}

function applyLegacyEffect(effects, effect) {
  switch (effect) {
    case 'seed': break;
    case 'outpost_income_10': effects.outpostIncomeMult *= 1.1; break;
    case 'outpost_income_15': effects.outpostIncomeMult *= 1.15; break;
    case 'moon_yield_10': effects.moonYieldMult *= 1.1; break;
    case 'credit_income_5': effects.creditIncomeMult *= 1.05; break;
    case 'credit_income_10': effects.creditIncomeMult *= 1.1; break;
    case 'credit_income_15': effects.creditIncomeMult *= 1.15; break;
    case 'credit_income_20': effects.creditIncomeMult *= 1.2; break;
    case 'unlock_trade_station': effects.unlockTradeStation = true; break;
    case 'trade_hub_2': effects.tradeHubTier2 = true; break;
    case 'trade_income_10': effects.tradeIncomeMult *= 1.1; break;
    case 'trade_income_20': effects.tradeIncomeMult *= 1.2; break;
    case 'trade_income_25': effects.tradeIncomeMult *= 1.25; break;
    case 'trade_income_30': effects.tradeIncomeMult *= 1.3; break;
    case 'trade_neutral_bridge': effects.tradeNeutralBridge = true; break;
    case 'shipyard_slots_2': effects.shipyardSlots = Math.max(effects.shipyardSlots, 2); break;
    case 'shipyard_slots_3': effects.shipyardSlots = Math.max(effects.shipyardSlots, 3); break;
    case 'shipyard_cost_10': effects.shipyardCostMult *= 0.9; break;
    case 'scout_cost_15': effects.scoutCostMult *= 0.85; break;
    case 'unlock_destroyer_queue': effects.unlockDestroyerQueue = true; break;
    case 'unlock_frigate_queue': effects.unlockFrigateQueue = true; break;
    case 'unlock_patrol_cutter': effects.unlockPatrolCutter = true; break;
    case 'unlock_cruiser_queue': effects.unlockCruiserQueue = true; break;
    case 'unlock_battleship_queue': effects.unlockBattleshipQueue = true; break;
    case 'unlock_dreadnought_queue': effects.unlockDreadnoughtQueue = true; break;
    case 'unlock_light_carrier_queue': effects.unlockLightCarrierQueue = true; break;
    case 'unlock_fleet_carrier_queue': effects.unlockFleetCarrierQueue = true; break;
    case 'unlock_super_carrier_queue': effects.unlockSuperCarrierQueue = true; break;
    case 'unlock_sensor_ship': effects.unlockSensorShip = true; break;
    case 'unlock_construction_drones': effects.unlockConstructionDrones = true; break;
    case 'unlock_builder_ship': effects.unlockBuilderShip = true; break;
    case 'unlock_command_cruiser': effects.unlockCommandCruiser = true; break;
    case 'unlock_hero_flagship': effects.unlockHeroFlagship = true; break;
    case 'unlock_miner_hull': effects.unlockMinerHull = true; break;
    case 'unlock_mining_complex': effects.unlockMiningComplex = true; break;
    case 'unlock_refinery': effects.unlockRefinery = true; break;
    case 'unlock_storage_depot': effects.unlockStorageDepot = true; break;
    case 'unlock_asteroid_harvester': effects.unlockAsteroidHarvester = true; break;
    case 'unlock_fighter_factory': effects.unlockFighterFactory = true; break;
    case 'unlock_drydock': effects.unlockDrydock = true; break;
    case 'unlock_orbital_defense': effects.unlockOrbitalDefense = true; break;
    case 'unlock_planetary_shield': effects.unlockPlanetaryShield = true; break;
    case 'unlock_ion_battery': effects.unlockIonBattery = true; break;
    case 'unlock_light_hauler': effects.unlockLightHauler = true; break;
    case 'unlock_bulk_freighter': effects.unlockBulkFreighter = true; break;
    case 'unlock_armored_convoy': effects.unlockArmoredConvoy = true; break;
    case 'unlock_foundry': effects.unlockFoundry = true; break;
    case 'unlock_launcher': effects.unlockLauncher = true; break;
    case 'unlock_research_station': effects.unlockResearchStation = true; break;
    case 'sail_cost_10': effects.sailCostMult *= 0.9; break;
    case 'foundry_output_10': effects.foundryOutputMult *= 1.1; break;
    case 'foundry_output_15': effects.foundryOutputMult *= 1.15; break;
    case 'foundry_output_20': effects.foundryOutputMult *= 1.2; break;
    case 'launcher_rate_10': effects.launcherRateMult *= 1.1; break;
    case 'launcher_rate_15': effects.launcherRateMult *= 1.15; break;
    case 'launcher_rate_20': effects.launcherRateMult *= 1.2; break;
    case 'dyson_shell_sync': effects.dysonShellSync = true; break;
    case 'dyson_shell_bonus': effects.dysonShellBonus = true; break;
    case 'dyson_shield': effects.dysonShield = true; break;
    case 'solarii_income_10': effects.solariiIncomeMult *= 1.1; break;
    case 'solarii_income_15': effects.solariiIncomeMult *= 1.15; break;
    case 'solarii_income_20': effects.solariiIncomeMult *= 1.2; break;
    case 'corvette_hp_15': effects.corvetteHpMult *= 1.15; break;
    case 'frigate_hp_10': effects.frigateHpMult *= 1.1; break;
    case 'destroyer_dps_10': effects.destroyerDpsMult *= 1.1; break;
    case 'battleship_dps_10': effects.battleshipDpsMult *= 1.1; break;
    case 'carrier_dps_10': effects.carrierDpsMult *= 1.1; break;
    case 'carrier_wings': effects.carrierWings = true; break;
    case 'point_defense_20': effects.pointDefenseMult *= 1.2; break;
    case 'kinetic_damage_10': effects.kineticDamageMult *= 1.1; break;
    case 'bomber_damage_20':
      effects.bomberDamageMult *= 1.2;
      effects.carrierWingCapacityMult *= 1.1;
      break;
    case 'beam_damage_15': effects.beamDamageMult *= 1.15; break;
    case 'ion_damage_15': effects.ionDamageMult *= 1.15; break;
    case 'healer_repair_10': effects.healerRepairMult *= 1.1; break;
    case 'healer_repair_15': effects.healerRepairMult *= 1.15; break;
    case 'capture_force_1': effects.captureForceBonus += 1; break;
    case 'intel_hop_1': effects.intelHopBonus += 1; break;
    case 'intel_hop_2': effects.intelHopBonus += 2; break;
    case 'intel_hop_3': effects.intelHopBonus += 3; break;
    case 'anchor_cost_15': effects.anchorCostMult *= 0.85; break;
    case 'anchor_cost_25': effects.anchorCostMult *= 0.75; break;
    case 'wormhole_transit_10': effects.wormholeTransitMult *= 1.1; break;
    case 'research_speed_5': effects.researchSpeedMult *= 1.05; break;
    case 'research_speed_10': effects.researchSpeedMult *= 1.1; break;
    case 'research_speed_15': effects.researchSpeedMult *= 1.15; break;
    case 'research_speed_20': effects.researchSpeedMult *= 1.2; break;
    case 'research_queue_2': effects.researchQueueDepth = Math.max(effects.researchQueueDepth, 2); break;
    case 'research_queue_3': effects.researchQueueDepth = Math.max(effects.researchQueueDepth, 3); break;
    case 'hero_rally_bonus': effects.captureForceBonus += 1; break;
    case 'unlock_superweapon_cradle':
    case 'superweapon_create':
    case 'superweapon_destroy':
    case 'superweapon_jump':
    case 'unlock_diplomacy':
    case 'diplomacy_trade':
    case 'diplomacy_alliance':
    case 'diplomacy_trade_bonus':
    case 'hero_combat_bonus':
      break;
    default:
      return false;
  }
  return true;
}

function applyEffectDescriptor(effects, descriptor) {
  switch (descriptor.type) {
    case 'legacy':
      applyLegacyEffect(effects, descriptor.id);
      break;
    case 'unlock-structure': {
      const field = STRUCTURE_UNLOCK_EFFECT_FIELDS[descriptor.structure];
      effects[field] = true;
      effects.structureUnlocks[descriptor.structure] = true;
      effects.structureModifiers[descriptor.structure] = {
        ...(effects.structureModifiers[descriptor.structure] ?? {}),
        ...(descriptor.modifiers ?? {}),
      };
      break;
    }
    case 'multiply':
      effects[descriptor.target] *= descriptor.value;
      break;
    case 'add':
      effects[descriptor.target] += descriptor.value;
      break;
    case 'max':
      effects[descriptor.target] = Math.max(effects[descriptor.target], descriptor.value);
      break;
    case 'set':
      effects[descriptor.target] = descriptor.value;
      break;
    case 'structure-level-cap':
      for (const structure of descriptor.structures) {
        effects.structureLevelCaps[structure] = Math.max(
          effects.structureLevelCaps[structure] ?? 1,
          descriptor.level,
        );
      }
      break;
    default:
      break;
  }
}

function descriptorShapeError(descriptor, defaults) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return 'descriptor must be an object';
  }
  if (typeof descriptor.type !== 'string') return 'descriptor.type must be a string';

  switch (descriptor.type) {
    case 'legacy':
      if (typeof descriptor.id !== 'string' || !applyLegacyEffect(createDefaultTechEffects(), descriptor.id)) {
        return `unhandled legacy effect ${String(descriptor.id)}`;
      }
      return null;
    case 'unlock-structure': {
      if (!Object.hasOwn(STRUCTURE_UNLOCK_EFFECT_FIELDS, descriptor.structure)) {
        return `unknown structure unlock ${String(descriptor.structure)}`;
      }
      if (descriptor.modifiers != null
        && (!descriptor.modifiers || typeof descriptor.modifiers !== 'object' || Array.isArray(descriptor.modifiers))) {
        return 'unlock-structure modifiers must be an object';
      }
      for (const [key, value] of Object.entries(descriptor.modifiers ?? {})) {
        if (!key || !['number', 'boolean', 'string'].includes(typeof value)
          || (typeof value === 'number' && !Number.isFinite(value))) {
          return `invalid structure modifier ${key}`;
        }
      }
      return null;
    }
    case 'multiply':
    case 'add':
    case 'max':
      if (typeof descriptor.target !== 'string'
        || typeof defaults[descriptor.target] !== 'number') {
        return `unknown numeric effect target ${String(descriptor.target)}`;
      }
      if (!Number.isFinite(descriptor.value)) return `${descriptor.type} value must be finite`;
      return null;
    case 'set':
      if (typeof descriptor.target !== 'string' || !Object.hasOwn(defaults, descriptor.target)) {
        return `unknown set effect target ${String(descriptor.target)}`;
      }
      if (typeof descriptor.value !== typeof defaults[descriptor.target]) {
        return `set effect type mismatch for ${descriptor.target}`;
      }
      return null;
    case 'structure-level-cap':
      if (!Array.isArray(descriptor.structures) || descriptor.structures.length === 0) {
        return 'structure-level-cap requires structures';
      }
      if (!descriptor.structures.every((type) => UPGRADABLE_STRUCTURE_TYPES.includes(type))) {
        return 'structure-level-cap contains an unknown structure';
      }
      if (!Number.isInteger(descriptor.level) || descriptor.level < 1 || descriptor.level > 3) {
        return 'structure-level-cap level must be 1, 2, or 3';
      }
      return null;
    default:
      return `unhandled descriptor type ${descriptor.type}`;
  }
}

export function validateTechGraph(graph = TECH_NODES) {
  const errors = [];
  const entries = Object.entries(graph ?? {});
  const ids = new Set(entries.map(([id]) => id));
  const defaults = createDefaultTechEffects();

  for (const [key, node] of entries) {
    if (!node || typeof node !== 'object') {
      errors.push(`Node ${key} must be an object`);
      continue;
    }
    if (node.id !== key) errors.push(`Node key ${key} does not match id ${String(node.id)}`);
    if (!TECH_CLUSTERS.includes(node.cluster)) errors.push(`Node ${key} has unknown cluster ${String(node.cluster)}`);
    if (typeof node.name !== 'string' || !node.name.trim()) errors.push(`Node ${key} is missing a name`);
    if (!Array.isArray(node.prereqs)) {
      errors.push(`Node ${key} prereqs must be an array`);
    } else {
      if (new Set(node.prereqs).size !== node.prereqs.length) errors.push(`Node ${key} has duplicate prerequisites`);
      for (const prereq of node.prereqs) {
        if (!ids.has(prereq)) errors.push(`Node ${key} has missing prerequisite ${prereq}`);
        if (prereq === key) errors.push(`Node ${key} cannot require itself`);
      }
    }
    if (!Number.isFinite(node.creditCost) || node.creditCost < 0) errors.push(`Node ${key} has invalid credit cost`);
    if (!Number.isFinite(node.solariiCost) || node.solariiCost < 0) errors.push(`Node ${key} has invalid Solarii cost`);
    if (!Number.isFinite(node.researchMs) || node.researchMs < 0) errors.push(`Node ${key} has invalid research duration`);
    if (typeof node.description !== 'string' || !node.description.trim()) errors.push(`Node ${key} is missing a description`);
    if (!Array.isArray(node.tags) || !node.tags.length || !node.tags.every((tag) => typeof tag === 'string')) {
      errors.push(`Node ${key} tags must be a non-empty string array`);
    }
    if (!Array.isArray(node.unlocks) || !node.unlocks.length || !node.unlocks.every((item) => typeof item === 'string')) {
      errors.push(`Node ${key} unlocks must be a non-empty string array`);
    }
    const descriptors = nodeEffectDescriptors(node);
    if (!descriptors.length) errors.push(`Node ${key} has no effect descriptors`);
    descriptors.forEach((descriptor, index) => {
      const error = descriptorShapeError(descriptor, defaults);
      if (error) errors.push(`Node ${key} effect[${index}]: ${error}`);
    });
    if (!Array.isArray(node.milestones)
      || !node.milestones.every((milestone) => ['diplomacy', 'superweapon'].includes(milestone))) {
      errors.push(`Node ${key} has invalid milestone requirements`);
    }
  }

  const visitState = new Map();
  const stack = [];
  const tiers = new Map();
  function visit(id) {
    if (visitState.get(id) === 2) return tiers.get(id) ?? 0;
    if (visitState.get(id) === 1) {
      const start = stack.indexOf(id);
      errors.push(`Technology cycle detected: ${[...stack.slice(start), id].join(' -> ')}`);
      return 0;
    }
    const node = graph[id];
    if (!node || !Array.isArray(node.prereqs)) return 0;
    visitState.set(id, 1);
    stack.push(id);
    const prereqTiers = node.prereqs
      .filter((prereq) => ids.has(prereq))
      .map((prereq) => visit(prereq));
    const tier = prereqTiers.length ? 1 + Math.max(...prereqTiers) : 1;
    stack.pop();
    visitState.set(id, 2);
    tiers.set(id, tier);
    return tier;
  }
  for (const [id] of entries) visit(id);

  const dependents = new Map(entries.map(([id]) => [id, []]));
  for (const [id, node] of entries) {
    for (const prereq of Array.isArray(node?.prereqs) ? node.prereqs : []) {
      if (dependents.has(prereq)) dependents.get(prereq).push(id);
    }
  }
  const roots = entries
    .filter(([, node]) => Array.isArray(node?.prereqs) && node.prereqs.length === 0)
    .map(([id]) => id);
  const reachable = new Set(roots);
  const frontier = [...roots];
  while (frontier.length) {
    const id = frontier.shift();
    for (const dependent of dependents.get(id) ?? []) {
      if (reachable.has(dependent)) continue;
      reachable.add(dependent);
      frontier.push(dependent);
    }
  }
  for (const [id] of entries) {
    if (!reachable.has(id)) errors.push(`Node ${id} is unreachable from a technology root`);
  }

  const clusterCounts = Object.fromEntries(TECH_CLUSTERS.map((cluster) => [cluster, 0]));
  for (const [, node] of entries) {
    if (Object.hasOwn(clusterCounts, node?.cluster)) clusterCounts[node.cluster] += 1;
  }
  for (const [cluster, count] of Object.entries(clusterCounts)) {
    if (count === 0) errors.push(`Technology cluster ${cluster} has no nodes`);
  }

  return {
    ok: errors.length === 0,
    errors,
    nodeCount: entries.length,
    clusterCounts,
    roots,
    maxTier: tiers.size ? Math.max(...tiers.values()) : 0,
    tiers: Object.fromEntries(tiers),
  };
}

export const TECH_GRAPH_VALIDATION = validateTechGraph();
if (!TECH_GRAPH_VALIDATION.ok) {
  throw new Error(`Invalid technology graph:\n${TECH_GRAPH_VALIDATION.errors.join('\n')}`);
}

const derivedTierCache = new Map(Object.entries(TECH_GRAPH_VALIDATION.tiers));

export function derivedTier(nodeId) {
  return derivedTierCache.get(nodeId) ?? 0;
}

const techCache = new WeakMap();

function cacheForState(state) {
  if (!state || typeof state !== 'object') return null;
  let cache = techCache.get(state);
  if (!cache) {
    cache = {};
    techCache.set(state, cache);
  }
  return cache;
}

function unlockedIds(state) {
  if (Array.isArray(state?.research?.unlocked)) return state.research.unlocked;
  if (Array.isArray(state?.unlockedTech)) return state.unlockedTech;
  if (Array.isArray(state?.unlocked)) return state.unlocked;
  return [];
}

function unlockedSet(state) {
  const unlocked = unlockedIds(state);
  const signature = unlocked.join('\u0000');
  const cache = cacheForState(state);
  if (!cache) return new Set(unlocked);
  if (cache.unlockedSetSignature !== signature) {
    cache.unlockedSetSignature = signature;
    cache.unlockedSet = new Set(unlocked);
  }
  return cache.unlockedSet;
}

export function techMilestoneMet(state, node, opts = {}) {
  if (!node) return true;
  if (!opts.skipRefresh && state?.galaxies) refreshMilestones(state);
  const milestones = Array.isArray(node.milestones)
    ? node.milestones
    : [
      ...(node.requiresDiplomacy ? ['diplomacy'] : []),
      ...(node.requiresSuperweapon ? ['superweapon'] : []),
    ];
  if (milestones.includes('diplomacy') && !state?.milestones?.diplomacyUnlocked) return false;
  if (milestones.includes('superweapon') && !state?.milestones?.superweaponUnlocked) return false;
  return true;
}

export function techPrereqsMet(state, nodeId, opts = {}) {
  const node = techNode(nodeId);
  if (!node) return false;
  if (!techMilestoneMet(state, node, opts)) return false;
  const unlocked = unlockedSet(state);
  return node.prereqs.every((prereq) => unlocked.has(prereq));
}

export function techCost(nodeId) {
  const node = techNode(nodeId);
  if (!node) return { credits: 0, solarii: 0 };
  return { credits: node.creditCost, solarii: node.solariiCost };
}

export function isTechUnlocked(state, nodeId) {
  return unlockedSet(state).has(nodeId);
}

export function techEffects(state) {
  const unlocked = unlockedIds(state);
  const signature = unlocked.join('\u0000');
  const cache = cacheForState(state);
  if (cache?.effectsSignature === signature && cache.effects) return cache.effects;

  const effects = createDefaultTechEffects();
  for (const id of unlocked) {
    const node = techNode(id);
    if (!node) continue;
    for (const descriptor of nodeEffectDescriptors(node)) applyEffectDescriptor(effects, descriptor);
  }

  if (cache) {
    cache.effectsSignature = signature;
    cache.effects = effects;
  }
  return effects;
}

export function shipyardSlots(state) {
  return techEffects(state).shipyardSlots;
}

export function empireQueueHulls(state) {
  const effects = techEffects(state);
  const hulls = ['scout', 'corvette', 'healer'];
  if (effects.unlockDestroyerQueue) hulls.push('destroyer');
  if (effects.unlockPatrolCutter) hulls.push('patrol_cutter');
  if (effects.unlockFrigateQueue) hulls.push('frigate');
  if (effects.unlockCruiserQueue) hulls.push('cruiser');
  if (effects.unlockBattleshipQueue) hulls.push('battleship');
  if (effects.unlockDreadnoughtQueue) hulls.push('dreadnought');
  if (effects.unlockLightCarrierQueue) hulls.push('light_carrier');
  if (effects.unlockFleetCarrierQueue) hulls.push('fleet_carrier');
  if (effects.unlockSuperCarrierQueue) hulls.push('super_carrier');
  if (effects.unlockLightHauler) hulls.push('light_hauler');
  if (effects.unlockBulkFreighter) hulls.push('bulk_freighter');
  if (effects.unlockArmoredConvoy) hulls.push('armored_convoy');
  if (effects.unlockSensorShip) hulls.push('sensor_ship');
  if (effects.unlockBuilderShip) hulls.push('builder_ship');
  if (effects.unlockCommandCruiser) hulls.push('command_cruiser');
  if (effects.unlockMinerHull) hulls.push('miner');
  return hulls;
}

export function isEmpireHullUnlocked(state, hull) {
  return empireQueueHulls(state).includes(hull);
}

export function applyTechEffect(state, nodeId) {
  const cache = cacheForState(state);
  if (cache) {
    delete cache.effectsSignature;
    delete cache.effects;
  }
  return { ok: true, nodeId };
}

export function allTechNodes() {
  return Object.values(TECH_NODES);
}

export function techNodeCount() {
  return Object.keys(TECH_NODES).length;
}
