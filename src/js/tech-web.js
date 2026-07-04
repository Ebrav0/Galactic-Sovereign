// Static tech web definition (Phase 5, GDD §10).

export const TECH_NODES = {
  eco_baseline: {
    id: 'eco_baseline',
    cluster: 'economy',
    name: 'Baseline Economics',
    prereqs: [],
    creditCost: 0,
    solariiCost: 0,
    researchMs: 0,
    effect: 'seed',
  },
  eco_outpost_2: {
    id: 'eco_outpost_2',
    cluster: 'economy',
    name: 'Outpost Efficiency I',
    prereqs: ['eco_baseline'],
    creditCost: 400,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'outpost_income_10',
  },
  eco_trade_hub: {
    id: 'eco_trade_hub',
    cluster: 'economy',
    name: 'Trade Hub Protocol',
    prereqs: ['eco_outpost_2'],
    creditCost: 600,
    solariiCost: 0,
    researchMs: 54000,
    effect: 'unlock_trade_station',
  },
  eco_credits_surge: {
    id: 'eco_credits_surge',
    cluster: 'economy',
    name: 'Credit Surge',
    prereqs: ['eco_trade_hub'],
    creditCost: 900,
    solariiCost: 2,
    researchMs: 67500,
    effect: 'credit_income_15',
  },
  mil_corvette_2: {
    id: 'mil_corvette_2',
    cluster: 'military',
    name: 'Corvette Hardening',
    prereqs: ['eco_baseline'],
    creditCost: 350,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'corvette_hp_15',
  },
  mil_parallel_dock: {
    id: 'mil_parallel_dock',
    cluster: 'military',
    name: 'Parallel Docking',
    prereqs: ['mil_corvette_2'],
    creditCost: 800,
    solariiCost: 0,
    researchMs: 56250,
    effect: 'shipyard_slots_2',
  },
  mil_frigate_unlock: {
    id: 'mil_frigate_unlock',
    cluster: 'military',
    name: 'Frigate Blueprints',
    prereqs: ['mil_parallel_dock'],
    creditCost: 1200,
    solariiCost: 1,
    researchMs: 67500,
    effect: 'unlock_frigate_queue',
  },
  mil_healer_tech: {
    id: 'mil_healer_tech',
    cluster: 'military',
    name: 'Field Medics',
    prereqs: ['mil_corvette_2'],
    creditCost: 500,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'healer_repair_10',
  },
  mil_patrol_cutter: {
    id: 'mil_patrol_cutter',
    cluster: 'military',
    name: 'Patrol Cutters',
    prereqs: ['mil_corvette_2'],
    creditCost: 400,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'unlock_patrol_cutter',
  },
  mil_cruiser_unlock: {
    id: 'mil_cruiser_unlock',
    cluster: 'military',
    name: 'Cruiser Blueprints',
    prereqs: ['mil_frigate_unlock'],
    creditCost: 1500,
    solariiCost: 2,
    researchMs: 78750,
    effect: 'unlock_cruiser_queue',
  },
  mil_battleship_unlock: {
    id: 'mil_battleship_unlock',
    cluster: 'military',
    name: 'Battleship Hulls',
    prereqs: ['mil_cruiser_unlock'],
    creditCost: 2000,
    solariiCost: 3,
    researchMs: 90000,
    effect: 'unlock_battleship_queue',
  },
  mil_dreadnought_unlock: {
    id: 'mil_dreadnought_unlock',
    cluster: 'military',
    name: 'Dreadnought Class',
    prereqs: ['mil_battleship_unlock'],
    creditCost: 2800,
    solariiCost: 5,
    researchMs: 112500,
    effect: 'unlock_dreadnought_queue',
  },
  mil_light_carrier: {
    id: 'mil_light_carrier',
    cluster: 'military',
    name: 'Light Carrier',
    prereqs: ['mil_parallel_dock'],
    creditCost: 1400,
    solariiCost: 2,
    researchMs: 78750,
    effect: 'unlock_light_carrier_queue',
  },
  mil_fleet_carrier: {
    id: 'mil_fleet_carrier',
    cluster: 'military',
    name: 'Fleet Carrier',
    prereqs: ['mil_light_carrier'],
    creditCost: 2200,
    solariiCost: 3,
    researchMs: 90000,
    effect: 'unlock_fleet_carrier_queue',
  },
  mil_super_carrier: {
    id: 'mil_super_carrier',
    cluster: 'military',
    name: 'Super Carrier',
    prereqs: ['mil_fleet_carrier'],
    creditCost: 3200,
    solariiCost: 5,
    researchMs: 112500,
    effect: 'unlock_super_carrier_queue',
  },
  mil_sensor_ship: {
    id: 'mil_sensor_ship',
    cluster: 'military',
    name: 'Sensor Arrays',
    prereqs: ['mil_healer_tech'],
    creditCost: 600,
    solariiCost: 1,
    researchMs: 56250,
    effect: 'unlock_sensor_ship',
  },
  mil_builder_ship: {
    id: 'mil_builder_ship',
    cluster: 'military',
    name: 'Builder Drones',
    prereqs: ['mil_sensor_ship'],
    creditCost: 900,
    solariiCost: 1,
    researchMs: 67500,
    effect: 'unlock_builder_ship',
  },
  mil_command_cruiser: {
    id: 'mil_command_cruiser',
    cluster: 'military',
    name: 'Command Cruiser',
    prereqs: ['mil_cruiser_unlock'],
    creditCost: 1800,
    solariiCost: 3,
    researchMs: 90000,
    effect: 'unlock_command_cruiser',
  },
  eco_miner_hull: {
    id: 'eco_miner_hull',
    cluster: 'economy',
    name: 'Orbital Miners',
    prereqs: ['eco_outpost_2'],
    creditCost: 450,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'unlock_miner_hull',
  },
  mega_foundry_2: {
    id: 'mega_foundry_2',
    cluster: 'megastructure',
    name: 'Foundry Output I',
    prereqs: ['eco_baseline'],
    creditCost: 700,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'foundry_output_10',
  },
  mega_launcher_rate: {
    id: 'mega_launcher_rate',
    cluster: 'megastructure',
    name: 'Launcher Cadence',
    prereqs: ['mega_foundry_2'],
    creditCost: 900,
    solariiCost: 1,
    researchMs: 56250,
    effect: 'launcher_rate_10',
  },
  mega_solarii_boost: {
    id: 'mega_solarii_boost',
    cluster: 'megastructure',
    name: 'Solarii Amplifier',
    prereqs: ['mega_launcher_rate'],
    creditCost: 0,
    solariiCost: 5,
    researchMs: 90000,
    effect: 'solarii_income_10',
  },
  trade_route_opt: {
    id: 'trade_route_opt',
    cluster: 'trade',
    name: 'Route Optimization',
    prereqs: ['eco_trade_hub'],
    creditCost: 500,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'trade_income_20',
  },
  trade_lane_secured: {
    id: 'trade_lane_secured',
    cluster: 'trade',
    name: 'Secured Lanes',
    prereqs: ['trade_route_opt'],
    creditCost: 800,
    solariiCost: 1,
    researchMs: 67500,
    effect: 'trade_neutral_bridge',
  },
  trade_light_hauler: {
    id: 'trade_light_hauler',
    cluster: 'trade',
    name: 'Light Haulers',
    prereqs: ['trade_route_opt'],
    creditCost: 400,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'unlock_light_hauler',
  },
  trade_bulk_freighter: {
    id: 'trade_bulk_freighter',
    cluster: 'trade',
    name: 'Bulk Freighters',
    prereqs: ['trade_light_hauler'],
    creditCost: 700,
    solariiCost: 1,
    researchMs: 56250,
    effect: 'unlock_bulk_freighter',
  },
  trade_armored_convoy: {
    id: 'trade_armored_convoy',
    cluster: 'trade',
    name: 'Armored Convoys',
    prereqs: ['trade_bulk_freighter'],
    creditCost: 1100,
    solariiCost: 2,
    researchMs: 67500,
    effect: 'unlock_armored_convoy',
  },
  wh_scout_range: {
    id: 'wh_scout_range',
    cluster: 'wormhole',
    name: 'Extended Sensors',
    prereqs: ['eco_baseline'],
    creditCost: 600,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'intel_hop_1',
  },
  wh_anchor_discount: {
    id: 'wh_anchor_discount',
    cluster: 'wormhole',
    name: 'Anchor Engineering',
    prereqs: ['wh_scout_range'],
    creditCost: 1000,
    solariiCost: 2,
    researchMs: 67500,
    effect: 'anchor_cost_15',
  },
  res_lab_1: {
    id: 'res_lab_1',
    cluster: 'research',
    name: 'Lab Protocols I',
    prereqs: ['eco_baseline'],
    creditCost: 300,
    solariiCost: 0,
    researchMs: 45000,
    effect: 'research_speed_5',
  },
  res_lab_2: {
    id: 'res_lab_2',
    cluster: 'research',
    name: 'Lab Protocols II',
    prereqs: ['res_lab_1'],
    creditCost: 600,
    solariiCost: 1,
    researchMs: 56250,
    effect: 'research_speed_10',
  },
  res_dual_core: {
    id: 'res_dual_core',
    cluster: 'research',
    name: 'Dual Research Core',
    prereqs: ['res_lab_2', 'mega_solarii_boost'],
    creditCost: 1200,
    solariiCost: 4,
    researchMs: 112500,
    effect: 'research_queue_2',
  },
};

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
    outpostIncomeMult: 1,
    creditIncomeMult: 1,
    tradeIncomeMult: 1,
    researchSpeedMult: 1,
    researchQueueDepth: 1,
    foundryOutputMult: 1,
    launcherRateMult: 1,
    solariiIncomeMult: 1,
    corvetteHpMult: 1,
    healerRepairMult: 1,
    tradeNeutralBridge: false,
    anchorCostMult: 1,
    intelHopBonus: 0,
  };

  for (const id of unlocked) {
    const node = techNode(id);
    if (!node) continue;
    switch (node.effect) {
      case 'outpost_income_10': effects.outpostIncomeMult = 1.1; break;
      case 'unlock_trade_station': effects.unlockTradeStation = true; break;
      case 'credit_income_15': effects.creditIncomeMult = 1.15; break;
      case 'shipyard_slots_2': effects.shipyardSlots = 2; break;
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
      case 'corvette_hp_15': effects.corvetteHpMult = 1.15; break;
      case 'healer_repair_10': effects.healerRepairMult = 1.1; break;
      case 'foundry_output_10': effects.foundryOutputMult = 1.1; break;
      case 'launcher_rate_10': effects.launcherRateMult = 1.1; break;
      case 'solarii_income_10': effects.solariiIncomeMult = 1.1; break;
      case 'trade_income_20': effects.tradeIncomeMult = 1.2; break;
      case 'trade_neutral_bridge': effects.tradeNeutralBridge = true; break;
      case 'intel_hop_1': effects.intelHopBonus = 1; break;
      case 'anchor_cost_15': effects.anchorCostMult = 0.85; break;
      case 'research_speed_5': effects.researchSpeedMult *= 1.05; break;
      case 'research_speed_10': effects.researchSpeedMult *= 1.1; break;
      case 'research_queue_2': effects.researchQueueDepth = 2; break;
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
  const hulls = ['scout', 'corvette', 'destroyer', 'healer'];
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
  // Effects are derived from unlocked list; nothing extra to mutate.
  return { ok: true, nodeId };
}

export function allTechNodes() {
  return Object.values(TECH_NODES);
}
