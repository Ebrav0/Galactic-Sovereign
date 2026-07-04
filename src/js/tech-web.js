// Tech web logic — effects, unlocks, and queries (GDD §10).

import { TECH_NODES } from './tech-nodes.js';

export { TECH_NODES };

export function techNode(nodeId) {
  return TECH_NODES[nodeId] ?? null;
}

export function techPrereqsMet(state, nodeId) {
  const node = techNode(nodeId);
  if (!node) return false;
  const unlocked = state.research?.unlocked ?? [];
  return node.prereqs.every((p) => unlocked.includes(p));
}

export function techCost(nodeId) {
  const node = techNode(nodeId);
  if (!node) return { credits: 0, solarii: 0 };
  return { credits: node.creditCost, solarii: node.solariiCost };
}

export function derivedTier(nodeId) {
  const node = techNode(nodeId);
  if (!node) return 0;
  if (node.prereqs.length === 0) return 1;
  return 1 + Math.max(...node.prereqs.map((p) => derivedTier(p)));
}

export function isTechUnlocked(state, nodeId) {
  return (state.research?.unlocked ?? []).includes(nodeId);
}

export function techEffects(state) {
  const unlocked = state.research?.unlocked ?? [];
  const effects = {
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
    unlockBuilderShip: false,
    unlockCommandCruiser: false,
    unlockMinerHull: false,
    unlockLightHauler: false,
    unlockBulkFreighter: false,
    unlockArmoredConvoy: false,
    unlockFoundry: false,
    unlockLauncher: false,
    unlockResearchStation: false,
    dysonShellSync: false,
    dysonShellBonus: false,
    dysonShield: false,
    tradeHubTier2: false,
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
  };

  for (const id of unlocked) {
    const node = techNode(id);
    if (!node) continue;
    switch (node.effect) {
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
      case 'unlock_builder_ship': effects.unlockBuilderShip = true; break;
      case 'unlock_command_cruiser': effects.unlockCommandCruiser = true; break;
      case 'unlock_miner_hull': effects.unlockMinerHull = true; break;
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
      default: break;
    }
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

export function applyTechEffect(state, nodeId) {
  return { ok: true, nodeId };
}

export function allTechNodes() {
  return Object.values(TECH_NODES);
}

export function techNodeCount() {
  return Object.keys(TECH_NODES).length;
}
