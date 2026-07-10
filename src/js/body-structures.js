// Unified catalog and runtime helpers for tech-gated body and star-node buildings.

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
  OUTPOST_COST,
  SHIPYARD_COST,
  RESEARCH_STATION_COST,
  FOUNDRY_COST,
  LAUNCHER_COST,
  LOGISTICS_OUTPOST_STOCK_CAPACITY,
  V13_BUILDING_COSTS,
  V13_BUILDING_HP,
  V13_BUILDING_EFFECTS,
  STRUCTURE_LEVEL_EFFECT_MULTIPLIERS,
  STRUCTURE_LEVEL_HP_MULTIPLIERS,
  STRUCTURE_UPGRADE_COST_MULTIPLIERS,
  OUTPOST_LEVEL_CARGO_MULTIPLIERS,
  OUTPOST_LEVEL_STOCK_CAPACITY,
  SHIPYARD_LEVEL_BUILD_TIME_MULTIPLIERS,
  SHIPYARD_LEVEL_EXTRA_SLOTS,
  TICK_MS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import { allocateStructureId } from './economy.js';
import { getSystems, persistentSystemRecords } from './galaxy-scope.js';
import {
  findBody,
  hasOutpost,
  isPlayerOwned,
  structuresOn,
  systemById,
} from './state.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
import { maxCarrierWingCount, normalizeCarrierWingState } from './hull.js';
import { queueConstructionJob, queueStructureUpgradeJob } from './drones.js';

const ALL_BODY_TYPES = Object.freeze(['habitable', 'barren', 'gas', 'moon']);
const SURFACE_BODY_TYPES = Object.freeze(['habitable', 'barren']);
const DEFENSE_LEVEL_TYPES = new Set([
  'orbital_defense', 'planetary_shield', 'ion_battery', 'missile_silo', 'interdiction_array',
]);

function effect(key, op, value, label, options = {}) {
  return Object.freeze({ key, op, value, label, ...options });
}

function visual(shape, color, marker) {
  return Object.freeze({ shape, color, marker });
}

function combat(role, options = {}) {
  return Object.freeze({ role, autoResolvePower: 0, ...options });
}

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return !!f && f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

export const NEW_BODY_STRUCTURE_TYPES = Object.freeze([
  'power_grid',
  'orbital_habitat',
  'nanoforge',
  'fleet_academy',
  'missile_silo',
  'interdiction_array',
  'carrier_command',
  'sensor_array',
  'solar_collector',
  'logistics_hub',
  'galactic_exchange',
  'salvage_yard',
  'wormhole_observatory',
  'quantum_archive',
  'embassy_complex',
]);

export const STRUCTURE_ICON_GLYPHS = Object.freeze({
  outpost: '⌂', shipyard: '⬡', research_station: '◫', sail_foundry: '◉', dyson_launcher: '↗',
  mining_complex: '⛏', refinery: '♨', storage_depot: '▣', fighter_factory: '✦',
  planetary_shield: '◯', ion_battery: 'ϟ', drydock: '⊏', orbital_defense: '✥',
  asteroid_harvester: '◆', power_grid: '⌁', orbital_habitat: '◎', nanoforge: '◇',
  fleet_academy: '★', missile_silo: '▲', interdiction_array: '⊗', carrier_command: '✧',
  sensor_array: '◌', solar_collector: '☀', logistics_hub: '⇄', galactic_exchange: '◈',
  salvage_yard: '⚙', wormhole_observatory: '◍', quantum_archive: '▤', embassy_complex: '⚑',
});

export function structureIconGlyph(type) {
  return STRUCTURE_ICON_GLYPHS[type] ?? '⬢';
}

/**
 * Canonical metadata for body/star buildings. Existing `effect` strings remain
 * for older consumers; new systems should consume normalized `effects`.
 */
export const BODY_STRUCTURE_DEFS = Object.freeze({
  mining_complex: {
    label: 'Mining Complex',
    description: 'Processes local deposits into physical cargo for the logistics network.',
    placement: 'surface', cost: MINING_COMPLEX_COST, tech: 'eco_mining_complex', cap: 1,
    capScope: 'body', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: 220,
    effect: 'credit_income',
    effects: [effect('cargoProductionMult', 'mult', 1 + MINING_COMPLEX_INCOME_BONUS, 'Local cargo output')],
    upgradeable: true, aiPriority: 'economy', visual: visual('extractor', '#8bd3ff', 'mine'),
    combat: combat('industry'),
  },
  refinery: {
    label: 'Refinery',
    description: 'Refines local cargo and improves the value of connected trade.',
    placement: 'surface', cost: REFINERY_COST, tech: 'eco_refinery', cap: 1,
    capScope: 'body', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: 260,
    effect: 'trade_income',
    effects: [effect('tradeIncomeMult', 'mult', 1 + REFINERY_TRADE_BONUS, 'Trade income')],
    upgradeable: true, aiPriority: 'economy', visual: visual('stacks', '#ffb25f', 'refinery'),
    combat: combat('industry'),
  },
  storage_depot: {
    label: 'Storage Depot',
    description: 'Adds resilient cargo storage and reduces blockade losses.',
    placement: 'surface', cost: STORAGE_DEPOT_COST, tech: 'eco_storage_depot', cap: 2,
    capScope: 'body', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: 240,
    effect: 'blockade_buffer',
    effects: [
      effect('depotCapacityBonus', 'add', 100, 'Depot capacity'),
      effect('blockadeReduction', 'add', STORAGE_BLOCKADE_REDUCTION, 'Blockade protection'),
    ],
    upgradeable: true, aiPriority: 'logistics', visual: visual('tanks', '#8ea0b8', 'storage'),
    combat: combat('logistics'),
  },
  fighter_factory: {
    label: 'Fighter Factory',
    description: 'Replaces lost carrier craft while friendly carriers remain in-system.',
    placement: 'surface', cost: FIGHTER_FACTORY_COST, tech: 'mil_fighter_factory', cap: 1,
    capScope: 'body', requiresOutpost: true, bodyTypes: ['habitable'], hp: 320,
    effect: 'wing_replenish',
    effects: [effect('fighterReplenishCapacity', 'add', 1, 'Fighter replenishment')],
    upgradeable: true, aiPriority: 'military', visual: visual('hangar', '#6fd6ff', 'fighters'),
    combat: combat('production'),
  },
  planetary_shield: {
    label: 'Shield Generator',
    description: 'Projects a defensive field over every friendly structure in the system.',
    placement: 'surface', cost: PLANETARY_SHIELD_COST, tech: 'mil_shield_generator', cap: 1,
    capScope: 'body', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: 360,
    effect: 'structure_hp', effects: [effect('structureHpMult', 'mult', SHIELD_STRUCTURE_HP_MULT, 'Structure HP')],
    upgradeable: true, aiPriority: 'military', visual: visual('shield', '#75f2b0', 'shield'),
    combat: combat('shield'),
  },
  ion_battery: {
    label: 'Ion Battery',
    description: 'Disrupts hostile formations and adds ion power to system defense.',
    placement: 'surface', cost: ION_BATTERY_COST, tech: 'mil_ion_battery', cap: 2,
    capScope: 'body', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: 300,
    effect: 'ion_defense', effects: [effect('ionDefensePower', 'add', ION_BATTERY_POWER, 'Ion defense')],
    upgradeable: true, aiPriority: 'military', visual: visual('battery', '#b07cff', 'ion'),
    combat: combat('ion-defense', { weapon: 'ion', autoResolvePower: ION_BATTERY_POWER }),
  },
  drydock: {
    label: 'Drydock',
    description: 'Repairs friendly hulls in orbit around its host body.',
    placement: 'orbital', cost: DRYDOCK_COST, tech: 'mil_drydock', cap: 1,
    capScope: 'body', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: 340,
    effect: 'ship_repair', effects: [effect('shipRepairMult', 'mult', 1.2, 'Ship repair')],
    upgradeable: true, aiPriority: 'military', visual: visual('dock', '#7ddfff', 'repair'),
    combat: combat('repair'),
  },
  orbital_defense: {
    label: 'Defense Platform',
    description: 'A hardened orbital weapons platform for tactical and auto-resolved combat.',
    placement: 'orbital', cost: ORBITAL_DEFENSE_COST, tech: 'mil_orbital_defense', cap: 2,
    capScope: 'body', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: 380,
    effect: 'orbital_defense', effects: [effect('autoResolveDefensePower', 'add', ORBITAL_DEFENSE_POWER, 'Defense power')],
    upgradeable: true, aiPriority: 'military', visual: visual('weapon-ring', '#ff6f7d', 'defense'),
    combat: combat('weapons', { weapon: 'kinetic', autoResolvePower: ORBITAL_DEFENSE_POWER }),
  },
  asteroid_harvester: {
    label: 'Asteroid Harvester',
    description: 'Extracts resources from otherwise empty dead-star systems.',
    placement: 'star-node', cost: ASTEROID_HARVESTER_COST, tech: 'eco_asteroid_harvester', cap: 1,
    capScope: 'system', requiresOutpost: false, starNode: true, deadStarOnly: true, hp: 260,
    effect: 'dead_star_income', effects: [effect('flatCreditIncomePerSec', 'add', 2, 'Credit income')],
    aiPriority: 'economy', visual: visual('harvester', '#d4b16b', 'harvester'),
    combat: combat('industry'),
  },

  power_grid: {
    label: 'Power Grid',
    description: 'Routes high-density power to local cargo industry and shield generators.',
    placement: 'surface', cost: V13_BUILDING_COSTS.power_grid, tech: 'eco_power_grid', cap: 1,
    capScope: 'system', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: V13_BUILDING_HP.power_grid,
    effect: 'cargo_output', effects: [
      effect('cargoProductionMult', 'mult', V13_BUILDING_EFFECTS.powerGridCargo, 'Local cargo output'),
      effect('industrialOutputMult', 'mult', V13_BUILDING_EFFECTS.powerGridIndustry, 'Industrial output'),
      effect('shieldGeneratorHpMult', 'mult', V13_BUILDING_EFFECTS.powerGridShieldHp, 'Shield-generator HP'),
    ],
    aiPriority: 'economy', visual: visual('grid', '#ffd55f', 'power'), combat: combat('power'),
  },
  orbital_habitat: {
    label: 'Orbital Habitat',
    description: 'A permanent orbital population center that supports cargo and research crews.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.orbital_habitat, tech: 'eco_orbital_habitats', cap: 2,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.orbital_habitat,
    effect: 'habitat_output', effects: [
      effect('cargoProductionMult', 'mult', V13_BUILDING_EFFECTS.habitatCargo, 'Local cargo output'),
      effect('researchStationOutputMult', 'mult', V13_BUILDING_EFFECTS.habitatResearch, 'Research-station output'),
    ],
    aiPriority: 'economy', visual: visual('habitat-ring', '#7ee7c8', 'habitat'), combat: combat('habitat'),
  },
  nanoforge: {
    label: 'Nanoforge',
    description: 'Accelerates shipbuilding, fighter replacement, repair, and sail production.',
    placement: 'surface', cost: V13_BUILDING_COSTS.nanoforge, tech: 'eco_nanoforges', cap: 1,
    capScope: 'system', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: V13_BUILDING_HP.nanoforge,
    effect: 'industrial_throughput', effects: [
      effect('shipBuildSpeedMult', 'mult', V13_BUILDING_EFFECTS.nanoforgeThroughput, 'Ship throughput'),
      effect('fighterReplenishMult', 'mult', V13_BUILDING_EFFECTS.nanoforgeThroughput, 'Fighter throughput'),
      effect('repairThroughputMult', 'mult', V13_BUILDING_EFFECTS.nanoforgeThroughput, 'Repair throughput'),
      effect('foundryOutputMult', 'mult', V13_BUILDING_EFFECTS.nanoforgeThroughput, 'Sail-foundry output'),
    ],
    aiPriority: 'economy', visual: visual('forge', '#ff8f66', 'nanoforge'), combat: combat('industry'),
  },
  fleet_academy: {
    label: 'Fleet Academy',
    description: 'Trains new crews at veterancy I and supports progression through veterancy III.',
    placement: 'surface', cost: V13_BUILDING_COSTS.fleet_academy, tech: 'mil_fleet_academy', cap: 1,
    capScope: 'system', requiresOutpost: true, bodyTypes: ['habitable'], hp: V13_BUILDING_HP.fleet_academy,
    effect: 'ship_veterancy', effects: [
      effect('startingVeterancy', 'max', V13_BUILDING_EFFECTS.academyStartingVeterancy, 'Starting veterancy', { levelScaled: false }),
      effect('maxVeterancy', 'max', V13_BUILDING_EFFECTS.academyMaxVeterancy, 'Maximum veterancy', { levelScaled: false }),
      effect('veterancyStatBonusPerLevel', 'max', V13_BUILDING_EFFECTS.veterancyBonusPerLevel, 'Damage and HP per level', { levelScaled: false }),
    ],
    aiPriority: 'military', visual: visual('academy', '#f4e29a', 'academy'), combat: combat('training'),
  },
  missile_silo: {
    label: 'Missile Silo',
    description: 'Launches defensive torpedoes and adds twelve base auto-resolve defense power.',
    placement: 'surface', cost: V13_BUILDING_COSTS.missile_silo, tech: 'mil_missile_silo_network', cap: 2,
    capScope: 'body', requiresOutpost: true, bodyTypes: [...SURFACE_BODY_TYPES, 'moon'], hp: V13_BUILDING_HP.missile_silo,
    effect: 'torpedo_defense', effects: [
      effect('autoResolveDefensePower', 'add', V13_BUILDING_EFFECTS.missileAutoResolvePower, 'Defense power'),
      effect('torpedoDefensePower', 'add', V13_BUILDING_EFFECTS.missileAutoResolvePower, 'Torpedo defense'),
    ],
    upgradeable: true, aiPriority: 'military', visual: visual('silo', '#ff776f', 'missile'),
    combat: combat('torpedo-defense', { weapon: 'torpedo', autoResolvePower: V13_BUILDING_EFFECTS.missileAutoResolvePower }),
  },
  interdiction_array: {
    label: 'Interdiction Array',
    description: 'Slows enemy retreat charging and blocks hostile departures while actively firing.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.interdiction_array, tech: 'mil_gravitic_interdiction', cap: 1,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.interdiction_array,
    effect: 'interdiction', effects: [
      effect('enemyRetreatChargeMult', 'mult', V13_BUILDING_EFFECTS.interdictionRetreatCharge, 'Enemy retreat charge'),
      effect('blocksHostileDeparture', 'boolean', true, 'Blocks hostile departures', { levelScaled: false }),
    ],
    upgradeable: true, aiPriority: 'military', visual: visual('gravity-ring', '#cf87ff', 'interdict'),
    combat: combat('control', { weapon: 'ion' }),
  },
  carrier_command: {
    label: 'Carrier Command',
    description: 'Coordinates larger carrier wings and accelerates fighter replacement.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.carrier_command, tech: 'mil_carrier_command', cap: 1,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.carrier_command,
    effect: 'carrier_command', effects: [
      effect('carrierWingCapacityMult', 'mult', V13_BUILDING_EFFECTS.carrierWingCapacity, 'Carrier wing capacity'),
      effect('fighterReplenishMult', 'mult', V13_BUILDING_EFFECTS.carrierReplenishment, 'Fighter replenishment'),
    ],
    aiPriority: 'military', visual: visual('command-ring', '#63d7ff', 'carrier'), combat: combat('command'),
  },
  sensor_array: {
    label: 'Sensor Array',
    description: 'Extends intelligence coverage and local friendly weapon range.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.sensor_array, tech: 'mil_orbital_sensor_arrays', cap: 1,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.sensor_array,
    effect: 'sensor_array', effects: [
      effect('intelHopBonus', 'add', V13_BUILDING_EFFECTS.sensorIntelHops, 'Intel hops'),
      effect('weaponRangeMult', 'mult', V13_BUILDING_EFFECTS.sensorWeaponRange, 'Friendly weapon range'),
    ],
    aiPriority: 'wormhole', visual: visual('dish-array', '#7fc8ff', 'sensor'), combat: combat('sensor'),
  },
  solar_collector: {
    label: 'Solar Collector',
    description: 'Feeds a Dyson industry with additional foundry, launcher, and Solarii throughput.',
    placement: 'star-node', cost: V13_BUILDING_COSTS.solar_collector, tech: 'mega_solar_collectors', cap: 1,
    capScope: 'system', requiresOutpost: false, starNode: true, requiresDyson: true, hp: V13_BUILDING_HP.solar_collector,
    effect: 'dyson_throughput', effects: [
      effect('foundryOutputMult', 'mult', V13_BUILDING_EFFECTS.collectorFoundry, 'Foundry output'),
      effect('launcherRateMult', 'mult', V13_BUILDING_EFFECTS.collectorLauncher, 'Launcher cadence'),
      effect('solariiIncomeMult', 'mult', V13_BUILDING_EFFECTS.collectorSolarii, 'Solarii output'),
    ],
    upgradeable: true, aiPriority: 'megastructure', visual: visual('collector-petals', '#ffd45a', 'collector'),
    combat: combat('megastructure'),
  },
  logistics_hub: {
    label: 'Logistics Hub',
    description: 'Expands storage, accelerates dispatch, and supports an additional convoy route.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.logistics_hub, tech: 'trade_logistics_hubs', cap: 1,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.logistics_hub,
    effect: 'logistics_hub', effects: [
      effect('depotCapacityBonus', 'add', V13_BUILDING_EFFECTS.logisticsDepotCapacity, 'Depot capacity'),
      effect('localDispatchIntervalMult', 'mult', V13_BUILDING_EFFECTS.logisticsDispatchInterval, 'Local dispatch interval'),
      effect('convoyDispatchIntervalMult', 'mult', V13_BUILDING_EFFECTS.logisticsDispatchInterval, 'Convoy dispatch interval'),
      effect('activeConvoyRouteBonus', 'add', V13_BUILDING_EFFECTS.logisticsConvoyRoutes, 'Active convoy routes'),
    ],
    aiPriority: 'logistics', visual: visual('cargo-ring', '#66e6b5', 'logistics'), combat: combat('logistics'),
  },
  galactic_exchange: {
    label: 'Galactic Exchange',
    description: 'Raises Trade Nexus delivery value and expands the empire route portfolio.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.galactic_exchange, tech: 'trade_galactic_exchange', cap: 1,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.galactic_exchange,
    effect: 'galactic_exchange', effects: [
      effect('nexusDeliveryValueMult', 'mult', V13_BUILDING_EFFECTS.exchangeNexusValue, 'Nexus delivery value'),
      effect('manualTradeRouteBonus', 'add', V13_BUILDING_EFFECTS.exchangeManualRoutes, 'Manual trade routes'),
    ],
    aiPriority: 'trade', visual: visual('exchange-ring', '#ffc96b', 'exchange'), combat: combat('commerce'),
  },
  salvage_yard: {
    label: 'Salvage Yard',
    description: 'Recovers a share of friendly hull costs and lost carrier craft after local victories.',
    placement: 'orbital', cost: V13_BUILDING_COSTS.salvage_yard, tech: 'trade_salvage_doctrine', cap: 1,
    capScope: 'system', requiresOutpost: false, bodyTypes: ALL_BODY_TYPES, hp: V13_BUILDING_HP.salvage_yard,
    effect: 'salvage', effects: [
      effect('friendlyHullSalvageRate', 'max', V13_BUILDING_EFFECTS.salvageHullRate, 'Hull-cost recovery', { levelScaled: false }),
      effect('carrierCraftRecoveryRate', 'max', V13_BUILDING_EFFECTS.salvageCarrierRate, 'Carrier-craft recovery', { levelScaled: false }),
    ],
    aiPriority: 'trade', visual: visual('salvage-arms', '#d29a73', 'salvage'), combat: combat('salvage'),
  },
  wormhole_observatory: {
    label: 'Wormhole Observatory',
    description: 'Surveys unanchored destinations and accelerates anchor and fleet-jump charging.',
    placement: 'star-node', cost: V13_BUILDING_COSTS.wormhole_observatory, tech: 'wh_observatory', cap: 1,
    capScope: 'galaxy', requiresOutpost: false, starNode: true, blackHoleOnly: true, hp: V13_BUILDING_HP.wormhole_observatory,
    effect: 'wormhole_observatory', effects: [
      effect('showUnanchoredDestinationPool', 'boolean', true, 'Destination survey', { levelScaled: false }),
      effect('wormholeChargeRateMult', 'mult', V13_BUILDING_EFFECTS.observatoryChargeRate, 'Wormhole charge rate'),
    ],
    aiPriority: 'wormhole', visual: visual('observatory-ring', '#b99cff', 'observatory'), combat: combat('sensor'),
  },
  quantum_archive: {
    label: 'Quantum Archive',
    description: 'Raises local research output; the first active archive adds one empire queue slot.',
    placement: 'surface', cost: V13_BUILDING_COSTS.quantum_archive, tech: 'res_quantum_archives', cap: 1,
    capScope: 'system', requiresOutpost: true, bodyTypes: SURFACE_BODY_TYPES, hp: V13_BUILDING_HP.quantum_archive,
    effect: 'quantum_archive', effects: [
      effect('researchOutputMult', 'mult', V13_BUILDING_EFFECTS.archiveResearch, 'Research output'),
      effect('researchQueueSlotBonus', 'add', V13_BUILDING_EFFECTS.archiveQueueSlots, 'Research queue slots', { empireUnique: true, levelScaled: false }),
    ],
    upgradeable: true, aiPriority: 'research', visual: visual('archive', '#82a8ff', 'archive'), combat: combat('research'),
  },
  embassy_complex: {
    label: 'Embassy Complex',
    description: 'Reduces treaty costs and strengthens trade and alliance treaty effects.',
    placement: 'surface', cost: V13_BUILDING_COSTS.embassy_complex, tech: 'dip_embassy_complex', cap: 1,
    capScope: 'system', empireCap: 3, requiresOutpost: true, bodyTypes: ['habitable'], hp: V13_BUILDING_HP.embassy_complex,
    effect: 'embassy_complex', effects: [
      effect('treatyCostMult', 'mult', V13_BUILDING_EFFECTS.embassyTreatyCost, 'Treaty costs'),
      effect('treatyEffectMult', 'mult', V13_BUILDING_EFFECTS.embassyTreatyEffect, 'Treaty effects'),
    ],
    aiPriority: 'diplomacy', visual: visual('embassy', '#f1d3ff', 'embassy'), combat: combat('diplomacy'),
  },
});

export const STRUCTURE_CATALOG = BODY_STRUCTURE_DEFS;
export const V13_BUILDING_DEFS = Object.freeze(Object.fromEntries(
  NEW_BODY_STRUCTURE_TYPES.map((type) => [type, BODY_STRUCTURE_DEFS[type]]),
));

export const STRUCTURE_UPGRADE_DEFS = Object.freeze({
  outpost: {
    baseCost: OUTPOST_COST, maxLevel: 3,
    cargoMultipliers: OUTPOST_LEVEL_CARGO_MULTIPLIERS,
    stockCapacity: OUTPOST_LEVEL_STOCK_CAPACITY,
  },
  mining_complex: { baseCost: MINING_COMPLEX_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  refinery: { baseCost: REFINERY_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  storage_depot: { baseCost: STORAGE_DEPOT_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  shipyard: {
    baseCost: SHIPYARD_COST, maxLevel: 3,
    buildTimeMultipliers: SHIPYARD_LEVEL_BUILD_TIME_MULTIPLIERS,
    extraSlots: SHIPYARD_LEVEL_EXTRA_SLOTS,
  },
  research_station: { baseCost: RESEARCH_STATION_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  quantum_archive: { baseCost: V13_BUILDING_COSTS.quantum_archive, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  fighter_factory: { baseCost: FIGHTER_FACTORY_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  drydock: { baseCost: DRYDOCK_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  orbital_defense: {
    baseCost: ORBITAL_DEFENSE_COST, maxLevel: 3,
    effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS, hpMultipliers: STRUCTURE_LEVEL_HP_MULTIPLIERS,
  },
  planetary_shield: {
    baseCost: PLANETARY_SHIELD_COST, maxLevel: 3,
    effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS, hpMultipliers: STRUCTURE_LEVEL_HP_MULTIPLIERS,
  },
  ion_battery: {
    baseCost: ION_BATTERY_COST, maxLevel: 3,
    effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS, hpMultipliers: STRUCTURE_LEVEL_HP_MULTIPLIERS,
  },
  missile_silo: {
    baseCost: V13_BUILDING_COSTS.missile_silo, maxLevel: 3,
    effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS, hpMultipliers: STRUCTURE_LEVEL_HP_MULTIPLIERS,
  },
  interdiction_array: {
    baseCost: V13_BUILDING_COSTS.interdiction_array, maxLevel: 3,
    effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS, hpMultipliers: STRUCTURE_LEVEL_HP_MULTIPLIERS,
  },
  sail_foundry: { baseCost: FOUNDRY_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  dyson_launcher: { baseCost: LAUNCHER_COST, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
  solar_collector: { baseCost: V13_BUILDING_COSTS.solar_collector, maxLevel: 3, effectMultipliers: STRUCTURE_LEVEL_EFFECT_MULTIPLIERS },
});

export function bodyStructureDef(type) {
  return BODY_STRUCTURE_DEFS[type] ?? null;
}

export function structureUpgradeDef(type) {
  return STRUCTURE_UPGRADE_DEFS[type] ?? null;
}

export function structureLevel(structure) {
  const raw = Number(structure?.level ?? 1);
  return Math.max(1, Math.min(3, Number.isFinite(raw) ? Math.floor(raw) : 1));
}

export function structureLevelMultiplier(structureOrLevel, type = null) {
  const level = typeof structureOrLevel === 'number'
    ? Math.max(1, Math.min(3, Math.floor(structureOrLevel)))
    : structureLevel(structureOrLevel);
  const structureType = type ?? (typeof structureOrLevel === 'object' ? structureOrLevel?.type : null);
  const values = structureUpgradeDef(structureType)?.effectMultipliers ?? STRUCTURE_LEVEL_EFFECT_MULTIPLIERS;
  return values[level] ?? 1;
}

export function structureLevelHpMultiplier(structureOrLevel, type = null) {
  const level = typeof structureOrLevel === 'number'
    ? Math.max(1, Math.min(3, Math.floor(structureOrLevel)))
    : structureLevel(structureOrLevel);
  const structureType = type ?? (typeof structureOrLevel === 'object' ? structureOrLevel?.type : null);
  return structureUpgradeDef(structureType)?.hpMultipliers?.[level] ?? 1;
}

export function outpostCargoProductionMultiplier(structure) {
  return OUTPOST_LEVEL_CARGO_MULTIPLIERS[structureLevel(structure)] ?? 1;
}

export function outpostStockCapacity(structure) {
  return OUTPOST_LEVEL_STOCK_CAPACITY[structureLevel(structure)] ?? LOGISTICS_OUTPOST_STOCK_CAPACITY;
}

export function shipyardBuildTimeMultiplier(structure) {
  return SHIPYARD_LEVEL_BUILD_TIME_MULTIPLIERS[structureLevel(structure)] ?? 1;
}

export function shipyardExtraSlots(structure) {
  return SHIPYARD_LEVEL_EXTRA_SLOTS[structureLevel(structure)] ?? 0;
}

function factionRecord(state, factionId) {
  if (!factionId) return null;
  const list = state.factions?.list ?? state.ai?.factions ?? [];
  return list.find((faction) => faction.id === factionId || faction.factionId === factionId) ?? null;
}

function actorForSystem(state, system, opts = {}) {
  const factionId = opts.factionId ?? (system?.owner === 'ai' ? system?.factionId : null);
  const faction = factionRecord(state, factionId);
  const owner = opts.owner ?? (factionId ? 'ai' : 'player');
  return { owner, factionId, faction };
}

function actorHasTech(state, techId, actor, opts = {}) {
  if (!techId || opts.ignoreTech) return true;
  const supplied = opts.unlockedTechs;
  if (supplied) return supplied instanceof Set ? supplied.has(techId) : supplied.includes?.(techId);
  if (actor.owner === 'player') return isTechUnlocked(state, techId);
  const unlocked = actor.faction?.research?.unlocked ?? actor.faction?.unlockedTechs;
  return Array.isArray(unlocked) ? unlocked.includes(techId) : false;
}

function actorCredits(state, actor) {
  if (actor.owner === 'player') return state.credits ?? 0;
  return actor.faction?.credits ?? actor.faction?.resources?.credits ?? 0;
}

function deductActorCredits(state, actor, amount) {
  if (actor.owner === 'player') {
    state.credits -= amount;
    return;
  }
  if (actor.faction?.resources && actor.faction.credits == null) actor.faction.resources.credits -= amount;
  else if (actor.faction) actor.faction.credits = (actor.faction.credits ?? 0) - amount;
}

function actorOwnsSystem(system, actor, allowNeutralStarNode = false) {
  if (allowNeutralStarNode && system?.star?.kind === 'blackhole') return true;
  if (actor.owner === 'player') return system?.owner === 'player';
  return system?.owner === 'ai' && (!actor.factionId || system.factionId === actor.factionId);
}

function systemHasDysonProject(system) {
  return (system?.dyson?.completedShells ?? 0) > 0
    || (system?.structures ?? []).some((s) => ['sail_foundry', 'dyson_launcher'].includes(s.type));
}

function actorSystemCount(state, type, actor, { galaxyOnly = false } = {}) {
  let count = 0;
  const systems = galaxyOnly
    ? Object.values(getSystems(state))
    : persistentSystemRecords(state).map((record) => record.system);
  for (const system of systems) {
    if (!actorOwnsSystem(system, actor, type === 'wormhole_observatory')) continue;
    count += (system.structures ?? []).filter((s) => s.type === type).length;
  }
  return count;
}

export function isOperationalStructure(state, structure, opts = {}) {
  if (!structure || structure.construction) return false;
  const now = opts.time ?? state?.time ?? 0;
  if ((structure.hp ?? 1) <= 0 || now < (structure.disabledUntil ?? 0)) return false;
  if (structure.mothballed || structure.operational === false) return false;
  const systemId = opts.systemId ?? structure.systemId;
  if (!systemId) return true;
  const system = systemById(state, systemId, opts.galaxyId ?? state.activeGalaxyId);
  if (!system) return false;
  const actor = actorForSystem(state, system, opts);
  if (opts.owner && !actorOwnsSystem(system, actor, BODY_STRUCTURE_DEFS[structure.type]?.blackHoleOnly)) return false;
  const def = BODY_STRUCTURE_DEFS[structure.type];
  return !def?.tech || actorHasTech(state, def.tech, actor, opts);
}

export const isBodyStructureOperational = isOperationalStructure;

/**
 * Re-evaluate captured structures against the current system owner's research.
 * Only the operational flag changes: identity, level, HP, and damage are kept.
 */
export function reconcileStructureTechnology(state, systemId, techContext = {}) {
  const system = systemById(state, systemId, techContext.galaxyId ?? state.activeGalaxyId);
  if (!system) return { ok: false, reason: 'No such system', mothballed: [], reactivated: [] };
  const actor = actorForSystem(state, system, techContext);
  const mothballed = [];
  const reactivated = [];
  for (const structure of system.structures ?? []) {
    const def = BODY_STRUCTURE_DEFS[structure.type];
    if (!def?.tech) continue;
    const hasTech = actorHasTech(state, def.tech, actor, techContext);
    if (!hasTech) {
      if (!structure.mothballed) mothballed.push(structure.id);
      structure.mothballed = true;
      structure.mothballReason = 'technology';
    } else if (structure.mothballed && (!structure.mothballReason || structure.mothballReason === 'technology')) {
      structure.mothballed = false;
      delete structure.mothballReason;
      reactivated.push(structure.id);
    }
  }
  return { ok: true, systemId, mothballed, reactivated };
}

export function operationalBodyStructures(state, systemId, type = null, opts = {}) {
  const system = systemById(state, systemId, opts.galaxyId ?? state.activeGalaxyId);
  if (!system) return [];
  return (system.structures ?? []).filter((structure) => (
    BODY_STRUCTURE_DEFS[structure.type]
    && (!type || structure.type === type)
    && isOperationalStructure(state, structure, { ...opts, systemId })
  ));
}

function levelScaledValue(descriptor, structure) {
  const strength = descriptor.levelScaled === false ? 1 : structureLevelMultiplier(structure);
  if (descriptor.op === 'mult') return 1 + (descriptor.value - 1) * strength;
  if (descriptor.op === 'add' || descriptor.op === 'max') return descriptor.value * strength;
  return descriptor.value;
}

function combineEffect(current, descriptor, value) {
  if (descriptor.op === 'mult') return current * value;
  if (descriptor.op === 'add') return current + value;
  if (descriptor.op === 'max') return Math.max(current, value);
  if (descriptor.op === 'boolean') return current || !!value;
  return current;
}

function effectDefault(op) {
  if (op === 'mult') return 1;
  if (op === 'boolean') return false;
  return 0;
}

function effectFromStructures(structures, effectKey, opts = {}) {
  const entries = [];
  for (const structure of structures) {
    const def = BODY_STRUCTURE_DEFS[structure.type];
    for (const descriptor of def?.effects ?? []) {
      if (descriptor.key === effectKey) entries.push({ descriptor, structure });
    }
  }
  const op = opts.op ?? entries[0]?.descriptor.op ?? 'add';
  let value = opts.base ?? effectDefault(op);
  let usedEmpireUnique = false;
  for (const entry of entries) {
    if (entry.descriptor.empireUnique && usedEmpireUnique) continue;
    value = combineEffect(value, entry.descriptor, levelScaledValue(entry.descriptor, entry.structure));
    if (entry.descriptor.empireUnique) usedEmpireUnique = true;
  }
  return value;
}

export function structureEffectValueFromList(state, structures, effectKey, opts = {}) {
  const operational = (structures ?? []).filter((structure) => (
    BODY_STRUCTURE_DEFS[structure.type] && isOperationalStructure(state, structure, opts)
  ));
  return effectFromStructures(operational, effectKey, opts);
}

export function structureEffectValue(state, systemId, effectKey, opts = {}) {
  return effectFromStructures(operationalBodyStructures(state, systemId, null, opts), effectKey, opts);
}

export function structureEffectMultiplier(state, systemId, effectKey, opts = {}) {
  return structureEffectValue(state, systemId, effectKey, { ...opts, base: opts.base ?? 1, op: 'mult' });
}

export function empireStructureEffectValue(state, effectKey, opts = {}) {
  const structures = [];
  const actorOpts = { ...opts, owner: opts.owner ?? (opts.factionId ? 'ai' : 'player') };
  for (const { system } of persistentSystemRecords(state)) {
    const actor = actorForSystem(state, system, actorOpts);
    if (!actorOwnsSystem(system, actor, effectKey === 'showUnanchoredDestinationPool')) continue;
    structures.push(...(system.structures ?? []).filter((structure) => (
      BODY_STRUCTURE_DEFS[structure.type] && isOperationalStructure(state, structure, actorOpts)
    )));
  }
  return effectFromStructures(structures, effectKey, opts);
}

export const structureCargoProductionMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'cargoProductionMult', opts)
);
export const structureIndustrialOutputMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'industrialOutputMult', opts)
);
export const structureDepotCapacityBonus = (state, systemId, opts = {}) => (
  structureEffectValue(state, systemId, 'depotCapacityBonus', { ...opts, base: 0, op: 'add' })
);
export function structureDispatchIntervalMultiplier(state, systemId, kind = 'convoy', opts = {}) {
  const key = kind === 'local' ? 'localDispatchIntervalMult' : 'convoyDispatchIntervalMult';
  return structureEffectMultiplier(state, systemId, key, opts);
}
export const structureActiveConvoyRouteBonus = (state, systemId, opts = {}) => (
  structureEffectValue(state, systemId, 'activeConvoyRouteBonus', { ...opts, base: 0, op: 'add' })
);
export const structureNexusDeliveryMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'nexusDeliveryValueMult', opts)
);
export function structureManualTradeRouteBonus(state, systemId = null, opts = {}) {
  if (systemId) return structureEffectValue(state, systemId, 'manualTradeRouteBonus', { ...opts, base: 0, op: 'add' });
  return empireStructureEffectValue(state, 'manualTradeRouteBonus', { ...opts, base: 0, op: 'add' });
}
export const structureResearchOutputMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'researchOutputMult', opts)
    * structureEffectMultiplier(state, systemId, 'researchStationOutputMult', opts)
);
export function structureResearchQueueSlotBonus(state, systemId = null, opts = {}) {
  const query = { ...opts, base: 0, op: 'add' };
  return systemId
    ? structureEffectValue(state, systemId, 'researchQueueSlotBonus', query)
    : empireStructureEffectValue(state, 'researchQueueSlotBonus', query);
}
export const structureFoundryOutputMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'foundryOutputMult', opts)
    * structureEffectMultiplier(state, systemId, 'industrialOutputMult', opts)
);
export const structureLauncherRateMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'launcherRateMult', opts)
    * structureEffectMultiplier(state, systemId, 'industrialOutputMult', opts)
);
export const structureSolariiIncomeMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'solariiIncomeMult', opts)
);
export const structureTreatyCostMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'treatyCostMult', opts)
);
export const structureTreatyEffectMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'treatyEffectMult', opts)
);
export const structureWeaponRangeMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'weaponRangeMult', opts)
);
export const structureIntelHopBonus = (state, systemId, opts = {}) => (
  structureEffectValue(state, systemId, 'intelHopBonus', { ...opts, base: 0, op: 'add' })
);
export const structureHullSalvageRate = (state, systemId, opts = {}) => (
  structureEffectValue(state, systemId, 'friendlyHullSalvageRate', { ...opts, base: 0, op: 'max' })
);
export const structureCarrierRecoveryRate = (state, systemId, opts = {}) => (
  structureEffectValue(state, systemId, 'carrierCraftRecoveryRate', { ...opts, base: 0, op: 'max' })
);
export function structureShipBuildTimeMultiplier(state, systemId, opts = {}) {
  const speed = structureEffectMultiplier(state, systemId, 'shipBuildSpeedMult', opts)
    * structureIndustrialOutputMultiplier(state, systemId, opts);
  return speed > 0 ? 1 / speed : 1;
}
export const structureCarrierWingCapacityMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'carrierWingCapacityMult', opts)
);
export const structureEnemyRetreatChargeMultiplier = (state, systemId, opts = {}) => (
  structureEffectMultiplier(state, systemId, 'enemyRetreatChargeMult', opts)
);
export const structureBlocksHostileDeparture = (state, systemId, opts = {}) => (
  structureEffectValue(state, systemId, 'blocksHostileDeparture', { ...opts, base: false, op: 'boolean' })
);

export function structureMaxHp(state, systemId, typeOrStructure, level = 1) {
  const structure = typeof typeOrStructure === 'object' ? typeOrStructure : { type: typeOrStructure, level };
  const def = bodyStructureDef(structure.type);
  if (!def) return null;
  let multiplier = structureLevelHpMultiplier(structure);
  if (structure.type !== 'planetary_shield') {
    const shields = operationalBodyStructures(state, systemId, 'planetary_shield');
    if (shields.length > 0) {
      const strength = Math.max(...shields.map((shield) => structureLevelMultiplier(shield)));
      multiplier *= 1 + (SHIELD_STRUCTURE_HP_MULT - 1) * strength;
    }
  } else {
    multiplier *= structureEffectMultiplier(state, systemId, 'shieldGeneratorHpMult');
  }
  return Math.round(def.hp * multiplier);
}

export function ensureStructureCombatFields(state, systemId, structure) {
  structure.level = structureLevel(structure);
  structure.disabledUntil = structure.disabledUntil ?? 0;
  structure.mothballed = structure.mothballed ?? false;
  const maxHp = structureMaxHp(state, systemId, structure);
  if (!maxHp) return structure;
  const oldMax = structure.maxHp ?? maxHp;
  const ratio = oldMax > 0 ? Math.max(0, Math.min(1, (structure.hp ?? oldMax) / oldMax)) : 1;
  structure.maxHp = maxHp;
  structure.hp = Math.round(maxHp * ratio);
  return structure;
}

export function refreshSystemStructureCombatFields(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return [];
  for (const structure of system.structures ?? []) {
    if (BODY_STRUCTURE_DEFS[structure.type]) ensureStructureCombatFields(state, systemId, structure);
  }
  return system.structures;
}

export function bodyStructureCount(state, systemId, type = null) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  return (system.structures ?? []).filter((s) => BODY_STRUCTURE_DEFS[s.type] && (!type || s.type === type)).length;
}

export function bodyStructureCountOn(state, systemId, bodyId, type) {
  return structuresOn(state, systemId, bodyId).filter((s) => s.type === type).length;
}

function maxAvailableStructureLevel(state, type, actor, opts = {}) {
  const max = structureUpgradeDef(type)?.maxLevel ?? 1;
  if (opts.ignoreTechCap) return Math.min(max, opts.maxLevel ?? max);
  let available = opts.maxLevel;
  if (available == null && actor.owner === 'player') {
    available = techEffects(state).structureLevelCaps?.[type];
  } else if (available == null) {
    available = actor.faction?.structureLevelCaps?.[type]
      ?? actor.faction?.research?.structureLevelCaps?.[type];
  }
  return Math.max(1, Math.min(max, available ?? max));
}

export function bodyStructureUpgradeCost(type, currentLevel = 1) {
  const def = structureUpgradeDef(type);
  const level = Math.max(1, Math.min(3, Math.floor(Number(currentLevel) || 1)));
  const nextLevel = level + 1;
  if (!def || nextLevel > def.maxLevel) return null;
  const raw = def.baseCost * (STRUCTURE_UPGRADE_COST_MULTIPLIERS[nextLevel] ?? 1);
  return Math.max(25, Math.round(raw / 25) * 25);
}

export function canBuildBodyStructure(state, systemId, bodyId, type, opts = {}) {
  const def = bodyStructureDef(type);
  if (!def) return { ok: false, reason: 'Unknown building type' };
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  const actor = actorForSystem(state, system, opts);
  if (actor.owner === 'ai' && !actor.faction) return { ok: false, reason: 'No such faction' };
  if (!actorHasTech(state, def.tech, actor, opts)) return { ok: false, reason: `Research ${def.label} first` };
  if (!actorOwnsSystem(system, actor, def.blackHoleOnly)) return { ok: false, reason: 'System not under your control' };
  if (!opts.remote && actor.owner === 'player' && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (!opts.ignoreCredits && actorCredits(state, actor) < def.cost) return { ok: false, reason: `Need ${def.cost} credits` };

  if (def.empireCap && actorSystemCount(state, type, actor) >= def.empireCap) {
    return { ok: false, reason: `Empire cap reached (${def.empireCap})` };
  }
  if (def.capScope === 'galaxy' && actorSystemCount(state, type, actor, { galaxyOnly: true }) >= def.cap) {
    return { ok: false, reason: 'Galaxy cap reached' };
  }
  if (def.capScope === 'system' && (system.structures ?? []).filter((s) => s.type === type).length >= def.cap) {
    return { ok: false, reason: 'System cap reached' };
  }

  if (def.starNode) {
    if (def.blackHoleOnly && system.star?.kind !== 'blackhole') {
      return { ok: false, reason: 'Wormhole observatories require the galaxy black hole' };
    }
    if (def.deadStarOnly && (system.bodies ?? []).length > 0) {
      return { ok: false, reason: 'Asteroid harvesters are for dead-star systems' };
    }
    if (def.requiresDyson && !systemHasDysonProject(system)) {
      return { ok: false, reason: 'An active Dyson project is required' };
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
  if (def.capScope === 'body' && bodyStructureCountOn(state, systemId, body.id, type) >= def.cap) {
    return { ok: false, reason: 'Cap reached on this body' };
  }
  return { ok: true };
}

export function buildBodyStructure(state, systemId, bodyId, type, opts = {}) {
  const check = canBuildBodyStructure(state, systemId, bodyId, type, opts);
  if (!check.ok) return check;
  const def = bodyStructureDef(type);
  const system = systemById(state, systemId);
  const actor = actorForSystem(state, system, opts);
  if (actor.owner === 'player' && !opts.remote && !opts.immediate) {
    const queued = queueConstructionJob(state, {
      systemId,
      structureType: type,
      bodyId: def.starNode ? null : bodyId,
      creditCost: def.cost,
      durationMs: STRUCTURE_BUILD_MS[type] ?? 24000,
      extraStructureFields: {
        placement: def.placement,
        level: 1,
        disabledUntil: 0,
        mothballed: false,
        operational: true,
      },
    });
    if (!queued.ok) return queued;
    const pending = (system.structures ?? []).find((entry) => entry.id === queued.structureId);
    if (pending) {
      pending.maxHp = structureMaxHp(state, systemId, pending) ?? def.hp;
      pending.hp = pending.maxHp;
    }
    return {
      ...queued,
      queued: true,
      type,
      systemId,
      bodyId: def.starNode ? null : bodyId,
      level: 1,
    };
  }
  const structure = {
    id: allocateStructureId(),
    type,
    bodyId: def.starNode ? null : bodyId,
    placement: def.placement,
    level: 1,
    builtAtTime: state.time,
    disabledUntil: 0,
    mothballed: false,
  };
  if (actor.factionId) structure.factionId = actor.factionId;
  structure.maxHp = structureMaxHp(state, systemId, structure) ?? def.hp;
  structure.hp = structure.maxHp;
  if (!opts.alreadyPaid) deductActorCredits(state, actor, def.cost);
  if (!system.structures) system.structures = [];
  system.structures.push(structure);
  refreshSystemStructureCombatFields(state, systemId);
  return { ok: true, type, structureId: structure.id, systemId, bodyId: structure.bodyId, level: 1 };
}

export function canUpgradeBodyStructure(state, systemId, structureId, opts = {}) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  const structure = (system.structures ?? []).find((entry) => entry.id === structureId);
  if (!structure) return { ok: false, reason: 'No such structure' };
  const upgrade = structureUpgradeDef(structure.type);
  if (!upgrade) return { ok: false, reason: 'Structure cannot be upgraded' };
  const actor = actorForSystem(state, system, opts);
  if (actor.owner === 'ai' && !actor.faction) return { ok: false, reason: 'No such faction' };
  if (!actorOwnsSystem(system, actor, structure.type === 'wormhole_observatory')) {
    return { ok: false, reason: 'System not under your control' };
  }
  if (!opts.remote && actor.owner === 'player' && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct upgrades' };
  }
  const def = bodyStructureDef(structure.type);
  if (def?.tech && !actorHasTech(state, def.tech, actor, opts)) {
    return { ok: false, reason: `Research ${def.label} first` };
  }
  if (!isOperationalStructure(state, structure, { ...opts, systemId })) {
    return { ok: false, reason: 'Structure is destroyed, disabled, or mothballed' };
  }
  const level = structureLevel(structure);
  const maxLevel = maxAvailableStructureLevel(state, structure.type, actor, opts);
  if (level >= maxLevel) return { ok: false, reason: `Maximum available level (${maxLevel})` };
  const cost = bodyStructureUpgradeCost(structure.type, level);
  if (cost == null) return { ok: false, reason: 'Maximum level reached' };
  if (!opts.ignoreCredits && actorCredits(state, actor) < cost) return { ok: false, reason: `Need ${cost} credits` };
  return { ok: true, structure, cost, currentLevel: level, nextLevel: level + 1, maxLevel };
}

export function upgradeBodyStructure(state, systemId, structureId, opts = {}) {
  const check = canUpgradeBodyStructure(state, systemId, structureId, opts);
  if (!check.ok) return check;
  const system = systemById(state, systemId);
  const actor = actorForSystem(state, system, opts);
  const { structure } = check;
  const oldMax = structure.maxHp ?? structureMaxHp(state, systemId, structure) ?? 1;
  const hpRatio = Math.max(0, Math.min(1, (structure.hp ?? oldMax) / oldMax));
  if (actor.owner === 'player' && !opts.remote && !opts.immediate) {
    const targetMaxHp = structureMaxHp(
      state,
      systemId,
      { ...structure, level: check.nextLevel },
    ) ?? oldMax;
    const queued = queueStructureUpgradeJob(state, {
      systemId,
      structureId,
      creditCost: check.cost,
      durationMs: 18000 + check.nextLevel * 6000,
      targetLevel: check.nextLevel,
      targetMaxHp,
      hpRatio,
    });
    return queued.ok
      ? { ...queued, queued: true, type: structure.type, level: check.nextLevel, cost: check.cost }
      : queued;
  }
  if (!opts.alreadyPaid) deductActorCredits(state, actor, check.cost);
  structure.level = check.nextLevel;
  const nextMax = structureMaxHp(state, systemId, structure) ?? oldMax;
  structure.maxHp = nextMax;
  structure.hp = Math.round(nextMax * hpRatio);
  refreshSystemStructureCombatFields(state, systemId);
  return {
    ok: true,
    structureId: structure.id,
    type: structure.type,
    level: structure.level,
    cost: check.cost,
    maxHp: structure.maxHp,
  };
}

export function systemBodyStructureCounts(state, systemId) {
  const out = {};
  for (const type of Object.keys(BODY_STRUCTURE_DEFS)) out[type] = 0;
  const system = systemById(state, systemId);
  if (!system) return out;
  for (const s of system.structures ?? []) if (out[s.type] !== undefined) out[s.type]++;
  return out;
}

export function bodyStructureSummaryRows(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return [];
  return (system.structures ?? [])
    .filter((structure) => BODY_STRUCTURE_DEFS[structure.type])
    .map((structure) => {
      const def = BODY_STRUCTURE_DEFS[structure.type];
      return {
        id: structure.id,
        type: structure.type,
        label: def.label,
        placement: def.placement,
        bodyId: structure.bodyId ?? null,
        level: structureLevel(structure),
        upgradeCost: bodyStructureUpgradeCost(structure.type, structureLevel(structure)),
        hp: structure.hp ?? null,
        maxHp: structure.maxHp ?? structureMaxHp(state, systemId, structure),
        operational: isOperationalStructure(state, structure, { systemId }),
        mothballed: !!structure.mothballed,
        effects: (def.effects ?? []).map((entry) => entry.label),
      };
    });
}

export function bodyStructuresSummary(state, systemId) {
  const counts = systemBodyStructureCounts(state, systemId);
  const byPlacement = { surface: 0, orbital: 0, 'star-node': 0 };
  for (const [type, count] of Object.entries(counts)) byPlacement[BODY_STRUCTURE_DEFS[type].placement] += count;
  return {
    counts,
    byPlacement,
    rows: bodyStructureSummaryRows(state, systemId),
    incomeMult: Math.round(bodyStructureIncomeMultiplier(state, systemId) * 100) / 100,
    cargoMult: Math.round(structureCargoProductionMultiplier(state, systemId) * 100) / 100,
    tradeMult: Math.round(bodyStructureTradeMultiplier(state, systemId) * 100) / 100,
    researchMult: Math.round(structureResearchOutputMultiplier(state, systemId) * 100) / 100,
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

function operationalLevelStrength(state, systemId, type) {
  return operationalBodyStructures(state, systemId, type)
    .reduce((sum, structure) => sum + structureLevelMultiplier(structure), 0);
}

export function bodyStructureIncomeMultiplier(state, systemId) {
  return 1 + operationalLevelStrength(state, systemId, 'mining_complex') * MINING_COMPLEX_INCOME_BONUS;
}

export function bodyStructureFlatIncome(state, systemId) {
  return structureEffectValue(state, systemId, 'flatCreditIncomePerSec', { base: 0, op: 'add' });
}

export function bodyStructureTradeMultiplier(state, systemId) {
  return structureEffectMultiplier(state, systemId, 'tradeIncomeMult');
}

export function bodyStructureBlockadeMultiplier(state, systemId, currentMultiplier) {
  const reduction = structureEffectValue(state, systemId, 'blockadeReduction', { base: 0, op: 'add' });
  if (reduction <= 0 || currentMultiplier >= 1) return currentMultiplier;
  return Math.min(1, currentMultiplier + reduction);
}

export function bodyStructureDefensePower(state, systemId) {
  return structureEffectValue(state, systemId, 'autoResolveDefensePower', { base: 0, op: 'add' });
}

export function bodyStructureIonPower(state, systemId) {
  return structureEffectValue(state, systemId, 'ionDefensePower', { base: 0, op: 'add' });
}

export function bodyStructureRepairMultiplier(state, systemId) {
  return structureEffectMultiplier(state, systemId, 'shipRepairMult');
}

function replenishCarrierWing(ship, amount, state, systemId) {
  const localCapacity = structureCarrierWingCapacityMultiplier(state, systemId);
  const max = maxCarrierWingCount(ship, state, localCapacity);
  if (!max) return 0;
  const wing = normalizeCarrierWingState(ship, state, localCapacity);
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
    refreshStructureAurasIfNeeded(state, system.id);
    const drydockStrength = operationalLevelStrength(state, system.id, 'drydock');
    const factoryStrength = operationalLevelStrength(state, system.id, 'fighter_factory');
    const harvesterIncome = bodyStructureFlatIncome(state, system.id);

    // Mining complexes now modify physical cargo; only the legacy dead-star
    // harvester remains a separate non-outpost credit source.
    if (harvesterIncome > 0) state.credits += harvesterIncome * dt;

    if (drydockStrength > 0) {
      const repair = DRYDOCK_REPAIR_PER_SEC * drydockStrength
        * structureEffectMultiplier(state, system.id, 'repairThroughputMult') * dt;
      for (const ship of state.playerShips ?? []) {
        if (ship.systemId !== system.id || ship.transit || ship.hp <= 0 || ship.hp >= ship.maxHp) continue;
        ship.hp = Math.min(ship.maxHp, ship.hp + repair);
      }
    }

    if (factoryStrength > 0) {
      const replenish = FIGHTER_FACTORY_REPLENISH_PER_SEC * factoryStrength
        * structureEffectMultiplier(state, system.id, 'fighterReplenishMult')
        * techEffects(state).fighterReplenishmentMult * dt;
      for (const ship of state.playerShips ?? []) {
        if (ship.systemId !== system.id || ship.transit || ship.hp <= 0) continue;
        if (replenishCarrierWing(ship, replenish, state, system.id) > 0) {
          events.push({ type: 'carrier_wing_replenish', systemId: system.id, shipId: ship.id });
        }
      }
    }
  }
  return events;
}

const structureAuraSignatures = new WeakMap();

function refreshStructureAurasIfNeeded(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return;
  let cache = structureAuraSignatures.get(state);
  if (!cache) {
    cache = new Map();
    structureAuraSignatures.set(state, cache);
  }
  const signature = (system.structures ?? [])
    .filter((structure) => BODY_STRUCTURE_DEFS[structure.type])
    .map((structure) => [
      structure.id, structure.type, structure.level ?? 1, (structure.hp ?? 1) > 0,
      (structure.disabledUntil ?? 0) > state.time, !!structure.construction,
      !!structure.mothballed, structure.operational !== false,
    ].join(':'))
    .join('|');
  if (cache.get(systemId) === signature) return;
  cache.set(systemId, signature);
  refreshSystemStructureCombatFields(state, systemId);
}

function buildRow(state, systemId, bodyId, type) {
  const def = BODY_STRUCTURE_DEFS[type];
  return {
    type,
    label: def.label,
    description: def.description,
    placement: def.placement,
    cost: def.cost,
    cap: def.cap,
    capScope: def.capScope,
    empireCap: def.empireCap ?? null,
    maxLevel: structureUpgradeDef(type)?.maxLevel ?? 1,
    effects: (def.effects ?? []).map((entry) => entry.label),
    check: canBuildBodyStructure(state, systemId, bodyId, type),
  };
}

export function bodyStructureBuildRows(state, systemId, bodyId) {
  return Object.keys(BODY_STRUCTURE_DEFS)
    .filter((type) => !BODY_STRUCTURE_DEFS[type].starNode)
    .map((type) => buildRow(state, systemId, bodyId, type));
}

export function starNodeStructureBuildRows(state, systemId) {
  return Object.keys(BODY_STRUCTURE_DEFS)
    .filter((type) => BODY_STRUCTURE_DEFS[type].starNode)
    .map((type) => buildRow(state, systemId, null, type));
}

// Kept as a named list for save migration, validation, and external AI catalogs.
export const UPGRADEABLE_STRUCTURE_TYPES = Object.freeze(Object.keys(STRUCTURE_UPGRADE_DEFS));
export const DEFENSIVE_UPGRADE_STRUCTURE_TYPES = Object.freeze([...DEFENSE_LEVEL_TYPES]);
