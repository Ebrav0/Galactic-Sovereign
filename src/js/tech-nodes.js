// Technology tree node definitions — large interconnected web (GDD §10).

export const V13_TECH_COST_CURVE = Object.freeze({
  baseCredits: 300,
  creditGrowthPerTier: 1.25,
  creditRounding: 50,
  firstSolariiTier: 6,
  researchBaseMs: 36000,
  researchPerTierMs: 6000,
  researchCapMs: 150000,
});

export function v13TechCostsForTier(tier) {
  const safeTier = Math.max(1, Math.floor(Number(tier) || 1));
  const rawCredits = V13_TECH_COST_CURVE.baseCredits
    * (V13_TECH_COST_CURVE.creditGrowthPerTier ** (safeTier - 1));
  const credits = Math.round(rawCredits / V13_TECH_COST_CURVE.creditRounding)
    * V13_TECH_COST_CURVE.creditRounding;
  const solarii = safeTier < V13_TECH_COST_CURVE.firstSolariiTier
    ? 0
    : Math.ceil((safeTier - 5) / 2);
  const researchMs = Math.min(
    V13_TECH_COST_CURVE.researchCapMs,
    V13_TECH_COST_CURVE.researchBaseMs
      + (safeTier - 1) * V13_TECH_COST_CURVE.researchPerTierMs,
  );
  return { credits, solarii, researchMs };
}

const unlockStructure = (structure, modifiers = {}) => ({
  type: 'unlock-structure',
  structure,
  modifiers,
});
const multiply = (target, value) => ({ type: 'multiply', target, value });
const add = (target, value) => ({ type: 'add', target, value });
const max = (target, value) => ({ type: 'max', target, value });
const set = (target, value = true) => ({ type: 'set', target, value });
const levelCap = (structures, level) => ({ type: 'structure-level-cap', structures, level });

function v13Node({
  id,
  cluster,
  name,
  prereqs,
  effect,
  description,
  tags,
  unlocks,
  effects,
  ...milestoneFields
}) {
  return {
    id,
    cluster,
    name,
    prereqs,
    creditCost: 0,
    solariiCost: 0,
    researchMs: 0,
    effect,
    description,
    tags,
    unlocks,
    effects,
    introducedIn: 13,
    ...milestoneFields,
  };
}

export const TECH_NODES = {
  // ─── Economy ───
  eco_baseline: {
    id: 'eco_baseline', cluster: 'economy', name: 'Baseline Economics',
    prereqs: [], creditCost: 0, solariiCost: 0, researchMs: 0, effect: 'seed',
  },
  eco_surveyor: {
    id: 'eco_surveyor', cluster: 'economy', name: 'Surveyor Drones',
    prereqs: ['eco_baseline'], creditCost: 250, solariiCost: 0, researchMs: 36000, effect: 'credit_income_5',
  },
  eco_outpost_2: {
    id: 'eco_outpost_2', cluster: 'economy', name: 'Outpost Efficiency I',
    prereqs: ['eco_surveyor'], creditCost: 400, solariiCost: 0, researchMs: 45000, effect: 'outpost_income_10',
  },
  eco_outpost_3: {
    id: 'eco_outpost_3', cluster: 'economy', name: 'Outpost Efficiency II',
    prereqs: ['eco_outpost_2', 'res_lab_1'], creditCost: 650, solariiCost: 0, researchMs: 54000, effect: 'outpost_income_15',
  },
  eco_miner_hull: {
    id: 'eco_miner_hull', cluster: 'economy', name: 'Orbital Miners',
    prereqs: ['eco_outpost_2'], creditCost: 450, solariiCost: 0, researchMs: 45000, effect: 'unlock_miner_hull',
  },
  eco_moon_rights: {
    id: 'eco_moon_rights', cluster: 'economy', name: 'Lunar Claim Charters',
    prereqs: ['eco_outpost_2', 'eco_miner_hull'], creditCost: 550, solariiCost: 0, researchMs: 50000, effect: 'moon_yield_10',
  },
  eco_mining_complex: {
    id: 'eco_mining_complex', cluster: 'economy', name: 'Mining Complexes',
    prereqs: ['eco_miner_hull'], creditCost: 520, solariiCost: 0, researchMs: 50000, effect: 'unlock_mining_complex',
  },
  eco_refinery: {
    id: 'eco_refinery', cluster: 'economy', name: 'Refinery Chains',
    prereqs: ['eco_mining_complex', 'trade_tariff_law'], creditCost: 720, solariiCost: 0, researchMs: 56000, effect: 'unlock_refinery',
  },
  eco_storage_depot: {
    id: 'eco_storage_depot', cluster: 'economy', name: 'Storage Depots',
    prereqs: ['eco_refinery'], creditCost: 760, solariiCost: 1, researchMs: 62000, effect: 'unlock_storage_depot',
  },
  eco_asteroid_harvester: {
    id: 'eco_asteroid_harvester', cluster: 'economy', name: 'Asteroid Harvesters',
    prereqs: ['eco_mining_complex', 'wh_scout_range'], creditCost: 680, solariiCost: 1, researchMs: 62000, effect: 'unlock_asteroid_harvester',
  },
  eco_trade_hub: {
    id: 'eco_trade_hub', cluster: 'economy', name: 'Trade Hub Protocol',
    prereqs: ['eco_outpost_2', 'trade_tariff_law'], creditCost: 600, solariiCost: 0, researchMs: 54000, effect: 'unlock_trade_station',
  },
  eco_shipyard_bureau: {
    id: 'eco_shipyard_bureau', cluster: 'economy', name: 'Shipyard Bureau',
    prereqs: ['eco_outpost_2', 'mil_corvette_2'], creditCost: 500, solariiCost: 0, researchMs: 48000, effect: 'shipyard_cost_10',
  },
  eco_industrial_chain: {
    id: 'eco_industrial_chain', cluster: 'economy', name: 'Industrial Chain',
    prereqs: ['mega_foundry_2', 'eco_outpost_3'], creditCost: 800, solariiCost: 1, researchMs: 60000, effect: 'credit_income_10',
  },
  eco_credits_surge: {
    id: 'eco_credits_surge', cluster: 'economy', name: 'Credit Surge',
    prereqs: ['eco_trade_hub', 'mega_foundry_2'], creditCost: 900, solariiCost: 2, researchMs: 67500, effect: 'credit_income_15',
  },
  eco_finance_hub: {
    id: 'eco_finance_hub', cluster: 'economy', name: 'Galactic Finance',
    prereqs: ['eco_credits_surge', 'trade_galactic_net'], creditCost: 1200, solariiCost: 3, researchMs: 78750, effect: 'credit_income_20',
  },
  eco_solarii_treaty: {
    id: 'eco_solarii_treaty', cluster: 'economy', name: 'Solarii Treaty',
    prereqs: ['mega_solarii_boost', 'eco_finance_hub'], creditCost: 0, solariiCost: 6, researchMs: 90000, effect: 'solarii_income_15',
  },

  // ─── Military ───
  mil_corvette_2: {
    id: 'mil_corvette_2', cluster: 'military', name: 'Corvette Hardening',
    prereqs: ['eco_baseline', 'res_lab_1'], creditCost: 350, solariiCost: 0, researchMs: 45000, effect: 'corvette_hp_15',
  },
  mil_scout_mast: {
    id: 'mil_scout_mast', cluster: 'military', name: 'Scout Mast Arrays',
    prereqs: ['eco_surveyor', 'wh_scout_range'], creditCost: 320, solariiCost: 0, researchMs: 42000, effect: 'scout_cost_15',
  },
  mil_patrol_cutter: {
    id: 'mil_patrol_cutter', cluster: 'military', name: 'Patrol Cutters',
    prereqs: ['mil_corvette_2'], creditCost: 400, solariiCost: 0, researchMs: 45000, effect: 'unlock_patrol_cutter',
  },
  mil_healer_tech: {
    id: 'mil_healer_tech', cluster: 'military', name: 'Field Medics',
    prereqs: ['mil_corvette_2'], creditCost: 500, solariiCost: 0, researchMs: 45000, effect: 'healer_repair_10',
  },
  mil_field_hospital: {
    id: 'mil_field_hospital', cluster: 'military', name: 'Fleet Hospitals',
    prereqs: ['mil_healer_tech', 'res_station_protocol'], creditCost: 700, solariiCost: 1, researchMs: 56250, effect: 'healer_repair_15',
  },
  mil_parallel_dock: {
    id: 'mil_parallel_dock', cluster: 'military', name: 'Parallel Docking',
    prereqs: ['mil_corvette_2', 'eco_shipyard_bureau'], creditCost: 800, solariiCost: 0, researchMs: 56250, effect: 'shipyard_slots_2',
  },
  mil_destroyer_unlock: {
    id: 'mil_destroyer_unlock', cluster: 'military', name: 'Destroyer Blueprints',
    prereqs: ['mil_parallel_dock'], creditCost: 950, solariiCost: 0, researchMs: 60000, effect: 'unlock_destroyer_queue',
  },
  mil_frigate_unlock: {
    id: 'mil_frigate_unlock', cluster: 'military', name: 'Frigate Blueprints',
    prereqs: ['mil_parallel_dock', 'mil_destroyer_unlock'], creditCost: 1200, solariiCost: 1, researchMs: 67500, effect: 'unlock_frigate_queue',
  },
  mil_armor_alloy: {
    id: 'mil_armor_alloy', cluster: 'military', name: 'Armor Alloys',
    prereqs: ['mil_frigate_unlock', 'mega_sail_weave'], creditCost: 1100, solariiCost: 1, researchMs: 65000, effect: 'frigate_hp_10',
  },
  mil_torpedo_bays: {
    id: 'mil_torpedo_bays', cluster: 'military', name: 'Torpedo Bays',
    prereqs: ['mil_destroyer_unlock'], creditCost: 1000, solariiCost: 1, researchMs: 62000, effect: 'destroyer_dps_10',
  },
  mil_point_defense: {
    id: 'mil_point_defense', cluster: 'military', name: 'Point Defense Grid',
    prereqs: ['mil_patrol_cutter'], creditCost: 850, solariiCost: 1, researchMs: 60000, effect: 'point_defense_20',
  },
  mil_kinetic_batteries: {
    id: 'mil_kinetic_batteries', cluster: 'military', name: 'Kinetic Batteries',
    prereqs: ['mil_frigate_unlock'], creditCost: 900, solariiCost: 1, researchMs: 62000, effect: 'kinetic_damage_10',
  },
  mil_light_carrier: {
    id: 'mil_light_carrier', cluster: 'military', name: 'Light Carrier',
    prereqs: ['mil_parallel_dock', 'mil_frigate_unlock'], creditCost: 1400, solariiCost: 2, researchMs: 78750, effect: 'unlock_light_carrier_queue',
  },
  mil_hangar_deck: {
    id: 'mil_hangar_deck', cluster: 'military', name: 'Hangar Decks',
    prereqs: ['mil_light_carrier'], creditCost: 1600, solariiCost: 2, researchMs: 80000, effect: 'carrier_dps_10',
  },
  mil_carrier_launch_doctrine: {
    id: 'mil_carrier_launch_doctrine', cluster: 'military', name: 'Carrier Launch Doctrine',
    prereqs: ['mil_light_carrier'], creditCost: 1500, solariiCost: 2, researchMs: 78000, effect: 'carrier_wings',
  },
  mil_interceptor_screens: {
    id: 'mil_interceptor_screens', cluster: 'military', name: 'Interceptor Screens',
    prereqs: ['mil_carrier_launch_doctrine', 'mil_hangar_deck'], creditCost: 1700, solariiCost: 2, researchMs: 82000, effect: 'point_defense_20',
  },
  mil_bomber_bays: {
    id: 'mil_bomber_bays', cluster: 'military', name: 'Bomber Bays',
    prereqs: ['mil_carrier_launch_doctrine', 'mil_torpedo_bays'], creditCost: 1900, solariiCost: 3, researchMs: 90000, effect: 'bomber_damage_20',
  },
  mil_cruiser_unlock: {
    id: 'mil_cruiser_unlock', cluster: 'military', name: 'Cruiser Blueprints',
    prereqs: ['mil_frigate_unlock', 'mil_armor_alloy'], creditCost: 1500, solariiCost: 2, researchMs: 78750, effect: 'unlock_cruiser_queue',
  },
  mil_beam_lances: {
    id: 'mil_beam_lances', cluster: 'military', name: 'Beam Lances',
    prereqs: ['mil_cruiser_unlock', 'mega_shell_precision'], creditCost: 1800, solariiCost: 3, researchMs: 92000, effect: 'beam_damage_15',
  },
  mil_battleship_unlock: {
    id: 'mil_battleship_unlock', cluster: 'military', name: 'Battleship Hulls',
    prereqs: ['mil_cruiser_unlock', 'mil_torpedo_bays'], creditCost: 2000, solariiCost: 3, researchMs: 90000, effect: 'unlock_battleship_queue',
  },
  mil_ion_disruptors: {
    id: 'mil_ion_disruptors', cluster: 'military', name: 'Ion Disruptors',
    prereqs: ['mil_beam_lances', 'mega_orbital_shield'], creditCost: 2100, solariiCost: 4, researchMs: 100000, effect: 'ion_damage_15',
  },
  mil_siege_platform: {
    id: 'mil_siege_platform', cluster: 'military', name: 'Siege Platforms',
    prereqs: ['mil_battleship_unlock'], creditCost: 2400, solariiCost: 4, researchMs: 95000, effect: 'battleship_dps_10',
  },
  mil_dreadnought_unlock: {
    id: 'mil_dreadnought_unlock', cluster: 'military', name: 'Dreadnought Class',
    prereqs: ['mil_battleship_unlock', 'mil_siege_platform'], creditCost: 2800, solariiCost: 5, researchMs: 112500, effect: 'unlock_dreadnought_queue',
  },
  mil_fleet_carrier: {
    id: 'mil_fleet_carrier', cluster: 'military', name: 'Fleet Carrier',
    prereqs: ['mil_light_carrier', 'mil_hangar_deck'], creditCost: 2200, solariiCost: 3, researchMs: 90000, effect: 'unlock_fleet_carrier_queue',
  },
  mil_super_carrier: {
    id: 'mil_super_carrier', cluster: 'military', name: 'Super Carrier',
    prereqs: ['mil_fleet_carrier', 'mega_dual_launcher'], creditCost: 3200, solariiCost: 5, researchMs: 112500, effect: 'unlock_super_carrier_queue',
  },
  mil_sensor_ship: {
    id: 'mil_sensor_ship', cluster: 'military', name: 'Sensor Arrays',
    prereqs: ['mil_healer_tech', 'wh_probe_swarm'], creditCost: 600, solariiCost: 1, researchMs: 56250, effect: 'unlock_sensor_ship',
  },
  mil_builder_ship: {
    id: 'mil_builder_ship', cluster: 'military', name: 'Builder Drones',
    prereqs: ['mil_sensor_ship', 'mega_auto_sail'], creditCost: 900, solariiCost: 1, researchMs: 67500, effect: 'unlock_builder_ship',
  },
  mil_command_cruiser: {
    id: 'mil_command_cruiser', cluster: 'military', name: 'Command Cruiser',
    prereqs: ['mil_cruiser_unlock', 'res_lab_2'], creditCost: 1800, solariiCost: 3, researchMs: 90000, effect: 'unlock_command_cruiser',
  },
  mil_war_doctrine: {
    id: 'mil_war_doctrine', cluster: 'military', name: 'War Doctrine',
    prereqs: ['mil_command_cruiser', 'mil_dreadnought_unlock'], creditCost: 3500, solariiCost: 6, researchMs: 120000, effect: 'capture_force_1',
  },
  mil_tri_dock: {
    id: 'mil_tri_dock', cluster: 'military', name: 'Tri-Stream Docking',
    prereqs: ['mil_parallel_dock', 'mega_foundry_3'], creditCost: 2000, solariiCost: 3, researchMs: 90000, effect: 'shipyard_slots_3',
  },
  mil_fighter_factory: {
    id: 'mil_fighter_factory', cluster: 'military', name: 'Fighter Factories',
    prereqs: ['mil_carrier_launch_doctrine', 'eco_industrial_chain'], creditCost: 1500, solariiCost: 2, researchMs: 85000, effect: 'unlock_fighter_factory',
  },
  mil_drydock: {
    id: 'mil_drydock', cluster: 'military', name: 'Orbital Drydocks',
    prereqs: ['mil_field_hospital', 'mil_parallel_dock'], creditCost: 1200, solariiCost: 2, researchMs: 78000, effect: 'unlock_drydock',
  },
  mil_orbital_defense: {
    id: 'mil_orbital_defense', cluster: 'military', name: 'Orbital Defense Platforms',
    prereqs: ['mil_point_defense', 'mil_drydock'], creditCost: 1500, solariiCost: 3, researchMs: 90000, effect: 'unlock_orbital_defense',
  },
  mil_shield_generator: {
    id: 'mil_shield_generator', cluster: 'military', name: 'Planetary Shield Generators',
    prereqs: ['mil_orbital_defense', 'mega_orbital_shield'], creditCost: 1900, solariiCost: 4, researchMs: 105000, effect: 'unlock_planetary_shield',
  },
  mil_ion_battery: {
    id: 'mil_ion_battery', cluster: 'military', name: 'Ion Batteries',
    prereqs: ['mil_ion_disruptors', 'mil_shield_generator'], creditCost: 2200, solariiCost: 5, researchMs: 112500, effect: 'unlock_ion_battery',
  },

  // ─── Megastructure / Dyson ───
  mega_foundry_unlock: {
    id: 'mega_foundry_unlock', cluster: 'megastructure', name: 'Sail Foundry',
    prereqs: ['eco_outpost_2', 'res_lab_1'], creditCost: 500, solariiCost: 0, researchMs: 45000, effect: 'unlock_foundry',
  },
  mega_sail_weave: {
    id: 'mega_sail_weave', cluster: 'megastructure', name: 'Sail Weaving',
    prereqs: ['mega_foundry_unlock'], creditCost: 600, solariiCost: 0, researchMs: 48000, effect: 'sail_cost_10',
  },
  mega_foundry_2: {
    id: 'mega_foundry_2', cluster: 'megastructure', name: 'Foundry Output I',
    prereqs: ['mega_foundry_unlock', 'mega_sail_weave'], creditCost: 700, solariiCost: 0, researchMs: 45000, effect: 'foundry_output_10',
  },
  mega_foundry_3: {
    id: 'mega_foundry_3', cluster: 'megastructure', name: 'Foundry Output II',
    prereqs: ['mega_foundry_2', 'res_station_protocol'], creditCost: 950, solariiCost: 1, researchMs: 60000, effect: 'foundry_output_15',
  },
  mega_auto_sail: {
    id: 'mega_auto_sail', cluster: 'megastructure', name: 'Automated Sail Lines',
    prereqs: ['mega_foundry_3', 'trade_market_2'], creditCost: 1100, solariiCost: 1, researchMs: 65000, effect: 'foundry_output_20',
  },
  mega_launcher_unlock: {
    id: 'mega_launcher_unlock', cluster: 'megastructure', name: 'Dyson Launcher',
    prereqs: ['mega_foundry_2'], creditCost: 800, solariiCost: 0, researchMs: 54000, effect: 'unlock_launcher',
  },
  mega_launcher_rate: {
    id: 'mega_launcher_rate', cluster: 'megastructure', name: 'Launcher Cadence',
    prereqs: ['mega_launcher_unlock'], creditCost: 900, solariiCost: 1, researchMs: 56250, effect: 'launcher_rate_10',
  },
  mega_dual_launcher: {
    id: 'mega_dual_launcher', cluster: 'megastructure', name: 'Dual Launch Rails',
    prereqs: ['mega_launcher_rate', 'trade_lane_secured'], creditCost: 1300, solariiCost: 2, researchMs: 72000, effect: 'launcher_rate_15',
  },
  mega_shell_precision: {
    id: 'mega_shell_precision', cluster: 'megastructure', name: 'Shell Alignment',
    prereqs: ['mega_launcher_rate'], creditCost: 1100, solariiCost: 2, researchMs: 67500, effect: 'dyson_shell_sync',
  },
  mega_shell_matrix: {
    id: 'mega_shell_matrix', cluster: 'megastructure', name: 'Shell Matrix',
    prereqs: ['mega_shell_precision', 'res_lab_2'], creditCost: 1500, solariiCost: 3, researchMs: 80000, effect: 'dyson_shell_bonus',
  },
  mega_solarii_boost: {
    id: 'mega_solarii_boost', cluster: 'megastructure', name: 'Solarii Amplifier',
    prereqs: ['mega_shell_matrix'], creditCost: 0, solariiCost: 5, researchMs: 90000, effect: 'solarii_income_10',
  },
  mega_shell_harmonic: {
    id: 'mega_shell_harmonic', cluster: 'megastructure', name: 'Harmonic Shells',
    prereqs: ['mega_shell_matrix', 'res_lab_3'], creditCost: 1800, solariiCost: 4, researchMs: 95000, effect: 'solarii_income_15',
  },
  mega_orbital_shield: {
    id: 'mega_orbital_shield', cluster: 'megastructure', name: 'Orbital Dyson Shield',
    prereqs: ['mega_shell_precision', 'mil_armor_alloy'], creditCost: 2000, solariiCost: 4, researchMs: 100000, effect: 'dyson_shield',
  },
  mega_solar_tap: {
    id: 'mega_solar_tap', cluster: 'megastructure', name: 'Solar Tap',
    prereqs: ['mega_solarii_boost', 'eco_finance_hub'], creditCost: 0, solariiCost: 7, researchMs: 105000, effect: 'solarii_income_20',
  },
  mega_dyson_overdrive: {
    id: 'mega_dyson_overdrive', cluster: 'megastructure', name: 'Dyson Overdrive',
    prereqs: ['mega_solar_tap', 'res_dual_core'], creditCost: 2500, solariiCost: 8, researchMs: 135000, effect: 'launcher_rate_20',
  },

  // ─── Trade ───
  trade_tariff_law: {
    id: 'trade_tariff_law', cluster: 'trade', name: 'Tariff Law',
    prereqs: ['eco_surveyor'], creditCost: 350, solariiCost: 0, researchMs: 40000, effect: 'trade_income_10',
  },
  trade_route_opt: {
    id: 'trade_route_opt', cluster: 'trade', name: 'Route Optimization',
    prereqs: ['eco_trade_hub'], creditCost: 500, solariiCost: 0, researchMs: 45000, effect: 'trade_income_20',
  },
  trade_market_2: {
    id: 'trade_market_2', cluster: 'trade', name: 'Deep Space Markets',
    prereqs: ['trade_route_opt'], creditCost: 650, solariiCost: 0, researchMs: 52000, effect: 'trade_income_25',
  },
  trade_light_hauler: {
    id: 'trade_light_hauler', cluster: 'trade', name: 'Light Haulers',
    prereqs: ['trade_route_opt'], creditCost: 400, solariiCost: 0, researchMs: 45000, effect: 'unlock_light_hauler',
  },
  trade_bulk_freighter: {
    id: 'trade_bulk_freighter', cluster: 'trade', name: 'Bulk Freighters',
    prereqs: ['trade_light_hauler', 'trade_market_2'], creditCost: 700, solariiCost: 1, researchMs: 56250, effect: 'unlock_bulk_freighter',
  },
  trade_lane_secured: {
    id: 'trade_lane_secured', cluster: 'trade', name: 'Secured Lanes',
    prereqs: ['trade_route_opt', 'mil_patrol_cutter'], creditCost: 800, solariiCost: 1, researchMs: 67500, effect: 'trade_neutral_bridge',
  },
  trade_armored_convoy: {
    id: 'trade_armored_convoy', cluster: 'trade', name: 'Armored Convoys',
    prereqs: ['trade_bulk_freighter', 'mil_torpedo_bays'], creditCost: 1100, solariiCost: 2, researchMs: 67500, effect: 'unlock_armored_convoy',
  },
  trade_convoy_guard: {
    id: 'trade_convoy_guard', cluster: 'trade', name: 'Convoy Guard Protocol',
    prereqs: ['trade_armored_convoy', 'mil_field_hospital'], creditCost: 1400, solariiCost: 2, researchMs: 75000, effect: 'trade_income_30',
  },
  trade_galactic_net: {
    id: 'trade_galactic_net', cluster: 'trade', name: 'Galactic Trade Net',
    prereqs: ['trade_lane_secured', 'trade_market_2'], creditCost: 1600, solariiCost: 3, researchMs: 85000, effect: 'trade_hub_2',
  },
  trade_black_market: {
    id: 'trade_black_market', cluster: 'trade', name: 'Shadow Lanes',
    prereqs: ['wh_probe_swarm', 'trade_light_hauler'], creditCost: 900, solariiCost: 1, researchMs: 62000, effect: 'credit_income_10',
  },

  // ─── Wormhole ───
  wh_scout_range: {
    id: 'wh_scout_range', cluster: 'wormhole', name: 'Extended Sensors',
    prereqs: ['eco_baseline'], creditCost: 600, solariiCost: 0, researchMs: 45000, effect: 'intel_hop_1',
  },
  wh_probe_swarm: {
    id: 'wh_probe_swarm', cluster: 'wormhole', name: 'Probe Swarms',
    prereqs: ['wh_scout_range', 'mil_scout_mast'], creditCost: 750, solariiCost: 0, researchMs: 52000, effect: 'intel_hop_2',
  },
  wh_nav_beacon: {
    id: 'wh_nav_beacon', cluster: 'wormhole', name: 'Nav Beacons',
    prereqs: ['wh_probe_swarm', 'res_lab_1'], creditCost: 850, solariiCost: 1, researchMs: 58000, effect: 'intel_hop_1',
  },
  wh_anchor_discount: {
    id: 'wh_anchor_discount', cluster: 'wormhole', name: 'Anchor Engineering',
    prereqs: ['wh_scout_range'], creditCost: 1000, solariiCost: 2, researchMs: 67500, effect: 'anchor_cost_15',
  },
  wh_stable_gate: {
    id: 'wh_stable_gate', cluster: 'wormhole', name: 'Stable Gate Theory',
    prereqs: ['wh_anchor_discount', 'res_lab_2'], creditCost: 1400, solariiCost: 3, researchMs: 80000, effect: 'anchor_cost_25',
  },
  wh_fleet_jump: {
    id: 'wh_fleet_jump', cluster: 'wormhole', name: 'Fleet Jump Doctrine',
    prereqs: ['wh_stable_gate', 'mil_frigate_unlock'], creditCost: 1700, solariiCost: 3, researchMs: 85000, effect: 'wormhole_transit_10',
  },
  wh_core_mapping: {
    id: 'wh_core_mapping', cluster: 'wormhole', name: 'Core Mapping',
    prereqs: ['wh_probe_swarm', 'mega_shell_matrix'], creditCost: 1500, solariiCost: 3, researchMs: 82000, effect: 'intel_hop_2',
  },
  wh_empire_relay: {
    id: 'wh_empire_relay', cluster: 'wormhole', name: 'Empire Relay Network',
    prereqs: ['wh_fleet_jump', 'res_dual_core'], creditCost: 2200, solariiCost: 5, researchMs: 110000, effect: 'intel_hop_3',
  },

  // ─── Research ───
  res_lab_1: {
    id: 'res_lab_1', cluster: 'research', name: 'Lab Protocols I',
    prereqs: ['eco_baseline'], creditCost: 300, solariiCost: 0, researchMs: 45000, effect: 'research_speed_5',
  },
  res_station_protocol: {
    id: 'res_station_protocol', cluster: 'research', name: 'Research Station',
    prereqs: ['res_lab_1'], creditCost: 400, solariiCost: 0, researchMs: 45000, effect: 'unlock_research_station',
  },
  res_lab_2: {
    id: 'res_lab_2', cluster: 'research', name: 'Lab Protocols II',
    prereqs: ['res_station_protocol'], creditCost: 600, solariiCost: 1, researchMs: 56250, effect: 'research_speed_10',
  },
  res_station_2: {
    id: 'res_station_2', cluster: 'research', name: 'Advanced Research Hub',
    prereqs: ['res_lab_2', 'mega_foundry_3'], creditCost: 900, solariiCost: 2, researchMs: 65000, effect: 'research_speed_5',
  },
  res_lab_3: {
    id: 'res_lab_3', cluster: 'research', name: 'Lab Protocols III',
    prereqs: ['res_lab_2', 'trade_market_2'], creditCost: 1000, solariiCost: 2, researchMs: 72000, effect: 'research_speed_15',
  },
  res_archivist: {
    id: 'res_archivist', cluster: 'research', name: 'Archivist Core',
    prereqs: ['res_lab_2', 'wh_nav_beacon'], creditCost: 1100, solariiCost: 2, researchMs: 75000, effect: 'research_speed_10',
  },
  res_dual_core: {
    id: 'res_dual_core', cluster: 'research', name: 'Dual Research Core',
    prereqs: ['res_lab_2', 'mega_solarii_boost'], creditCost: 1200, solariiCost: 4, researchMs: 112500, effect: 'research_queue_2',
  },
  res_queue_3: {
    id: 'res_queue_3', cluster: 'research', name: 'Tri-Core Queue',
    prereqs: ['res_dual_core', 'res_lab_3'], creditCost: 1800, solariiCost: 5, researchMs: 120000, effect: 'research_queue_3',
  },
  res_ai_core: {
    id: 'res_ai_core', cluster: 'research', name: 'AI Research Core',
    prereqs: ['res_lab_3', 'wh_empire_relay'], creditCost: 2500, solariiCost: 6, researchMs: 135000, effect: 'research_speed_20',
  },

  // ─── Diplomacy (Phase 6) ───
  dip_truce_protocol: {
    id: 'dip_truce_protocol', cluster: 'diplomacy', name: 'Truce Protocol',
    prereqs: ['mega_shell_matrix'], creditCost: 800, solariiCost: 2, researchMs: 72000, effect: 'unlock_diplomacy',
    requiresDiplomacy: true,
  },
  dip_trade_charter: {
    id: 'dip_trade_charter', cluster: 'diplomacy', name: 'Trade Charter',
    prereqs: ['dip_truce_protocol', 'trade_galactic_net'], creditCost: 1000, solariiCost: 2, researchMs: 80000, effect: 'diplomacy_trade',
    requiresDiplomacy: true,
  },
  dip_alliance_pact: {
    id: 'dip_alliance_pact', cluster: 'diplomacy', name: 'Alliance Pact',
    prereqs: ['dip_trade_charter', 'mil_war_doctrine'], creditCost: 1500, solariiCost: 4, researchMs: 90000, effect: 'diplomacy_alliance',
    requiresDiplomacy: true,
  },
  dip_embassy_network: {
    id: 'dip_embassy_network', cluster: 'diplomacy', name: 'Embassy Network',
    prereqs: ['dip_trade_charter'], creditCost: 1200, solariiCost: 3, researchMs: 85000, effect: 'diplomacy_trade_bonus',
    requiresDiplomacy: true,
  },

  // ─── Superweapon (Phase 6) ───
  sw_cradle_unlock: {
    id: 'sw_cradle_unlock', cluster: 'superweapon', name: 'Superweapon Cradle',
    prereqs: ['mega_dyson_overdrive', 'dip_truce_protocol'], creditCost: 3000, solariiCost: 8, researchMs: 120000, effect: 'unlock_superweapon_cradle',
    requiresSuperweapon: true,
  },
  sw_create_star: {
    id: 'sw_create_star', cluster: 'superweapon', name: 'Stellar Genesis',
    prereqs: ['sw_cradle_unlock'], creditCost: 0, solariiCost: 10, researchMs: 100000, effect: 'superweapon_create',
    requiresSuperweapon: true,
  },
  sw_destroy_star: {
    id: 'sw_destroy_star', cluster: 'superweapon', name: 'Stellar Annihilation',
    prereqs: ['sw_cradle_unlock', 'sw_create_star'], creditCost: 0, solariiCost: 12, researchMs: 110000, effect: 'superweapon_destroy',
    requiresSuperweapon: true,
  },
  sw_jump_gate: {
    id: 'sw_jump_gate', cluster: 'superweapon', name: 'Superweapon Jump',
    prereqs: ['sw_cradle_unlock', 'wh_fleet_jump'], creditCost: 2000, solariiCost: 8, researchMs: 95000, effect: 'superweapon_jump',
    requiresSuperweapon: true,
  },

  // ─── Hero / Flagship (Phase 6) ───
  hero_hull_unlock: {
    id: 'hero_hull_unlock', cluster: 'flagship', name: 'Hero Flagship Protocol',
    prereqs: ['sw_cradle_unlock', 'mil_command_cruiser'], creditCost: 2500, solariiCost: 5, researchMs: 90000, effect: 'unlock_hero_flagship',
    requiresSuperweapon: true,
  },
  hero_rally_doctrine: {
    id: 'hero_rally_doctrine', cluster: 'flagship', name: 'Rally Doctrine',
    prereqs: ['hero_hull_unlock'], creditCost: 1800, solariiCost: 4, researchMs: 80000, effect: 'hero_rally_bonus',
    requiresSuperweapon: true,
  },
  hero_command_aura: {
    id: 'hero_command_aura', cluster: 'flagship', name: 'Command Aura',
    prereqs: ['hero_hull_unlock', 'mil_war_doctrine'], creditCost: 2200, solariiCost: 5, researchMs: 85000, effect: 'hero_combat_bonus',
    requiresSuperweapon: true,
  },

  // ─── v13 Economy expansion ───
  eco_power_grid: v13Node({
    id: 'eco_power_grid', cluster: 'economy', name: 'Power Grid',
    prereqs: ['eco_storage_depot'], effect: 'unlock_power_grid',
    description: 'Standardizes planetary energy distribution for high-output civilian and industrial structures.',
    tags: ['economy', 'building', 'industry', 'cargo'],
    unlocks: ['Power Grid building'],
    effects: [unlockStructure('power_grid', {
      cargoOutputMult: 1.15,
      industrialOutputMult: 1.15,
      shieldGeneratorHpMult: 1.2,
    })],
  }),
  eco_orbital_habitats: v13Node({
    id: 'eco_orbital_habitats', cluster: 'economy', name: 'Orbital Habitats',
    prereqs: ['eco_power_grid', 'wh_nav_beacon'], effect: 'unlock_orbital_habitat',
    description: 'Creates permanent orbital population centers around developed worlds.',
    tags: ['economy', 'building', 'habitat', 'cargo', 'research'],
    unlocks: ['Orbital Habitat building'],
    effects: [unlockStructure('orbital_habitat', {
      cargoOutputMult: 1.1,
      researchStationOutputMult: 1.1,
      capPerSystem: 2,
    })],
  }),
  eco_habitat_network: v13Node({
    id: 'eco_habitat_network', cluster: 'economy', name: 'Habitat Network',
    prereqs: ['eco_orbital_habitats', 'trade_galactic_net'], effect: 'habitat_output_15',
    description: 'Links orbital habitats into an empire-wide labor, research, and cargo network.',
    tags: ['economy', 'habitat', 'network', 'cargo'],
    unlocks: ['Improved habitat output', 'One additional habitat slot per system'],
    effects: [multiply('habitatOutputMult', 1.15), add('orbitalHabitatCapBonus', 1)],
  }),
  eco_nanoforges: v13Node({
    id: 'eco_nanoforges', cluster: 'economy', name: 'Nanoforges',
    prereqs: ['eco_industrial_chain', 'res_lab_2'], effect: 'unlock_nanoforge',
    description: 'Deploys programmable fabrication swarms throughout strategic production centers.',
    tags: ['economy', 'building', 'industry', 'throughput'],
    unlocks: ['Nanoforge building'],
    effects: [unlockStructure('nanoforge', {
      shipThroughputMult: 1.15,
      fighterThroughputMult: 1.15,
      repairThroughputMult: 1.15,
      sailFoundryThroughputMult: 1.15,
    })],
  }),
  eco_industrial_automation: v13Node({
    id: 'eco_industrial_automation', cluster: 'economy', name: 'Industrial Automation',
    prereqs: ['eco_nanoforges', 'mega_auto_sail'], effect: 'industrial_output_15',
    description: 'Coordinates automated extractors, refineries, depots, and shipyards as one production fabric.',
    tags: ['economy', 'industry', 'automation', 'upgrade'],
    unlocks: ['Industrial structures level II'],
    effects: [
      multiply('industrialOutputMult', 1.15),
      levelCap(['mining_complex', 'refinery', 'storage_depot', 'shipyard'], 2),
    ],
  }),
  eco_zero_waste_industry: v13Node({
    id: 'eco_zero_waste_industry', cluster: 'economy', name: 'Zero-Waste Industry',
    prereqs: ['eco_industrial_automation', 'mega_dyson_overdrive'], effect: 'industrial_output_20',
    description: 'Closes every material loop to turn industrial byproducts back into usable cargo.',
    tags: ['economy', 'industry', 'cargo', 'upgrade'],
    unlocks: ['Extraction, refinery, and storage structures level III'],
    effects: [
      multiply('cargoProductionMult', 1.2),
      levelCap(['mining_complex', 'refinery', 'storage_depot'], 3),
    ],
  }),
  eco_outpost_administration: v13Node({
    id: 'eco_outpost_administration', cluster: 'economy', name: 'Outpost Administration',
    prereqs: ['eco_outpost_3'], effect: 'outpost_level_2',
    description: 'Professionalizes frontier governance and expands outpost cargo operations.',
    tags: ['economy', 'outpost', 'cargo', 'upgrade'],
    unlocks: ['Outposts level II'],
    effects: [levelCap(['outpost'], 2), multiply('outpostCargoOutputMult', 1.1)],
  }),
  eco_sector_capitals: v13Node({
    id: 'eco_sector_capitals', cluster: 'economy', name: 'Sector Capitals',
    prereqs: ['eco_outpost_administration', 'eco_finance_hub', 'mil_command_cruiser'], effect: 'outpost_level_3',
    description: 'Elevates mature outposts into regional command and distribution capitals.',
    tags: ['economy', 'outpost', 'administration', 'upgrade'],
    unlocks: ['Outposts level III'],
    effects: [levelCap(['outpost'], 3), multiply('outpostCargoOutputMult', 1.15)],
  }),
  eco_imperial_provisioning: v13Node({
    id: 'eco_imperial_provisioning', cluster: 'economy', name: 'Imperial Provisioning',
    prereqs: ['eco_sector_capitals', 'dip_embassy_network'], effect: 'outpost_stock_50',
    description: 'Maintains deep strategic reserves without altering the fixed passive outpost credit stipend.',
    tags: ['economy', 'outpost', 'cargo', 'capacity'],
    unlocks: ['Expanded outpost cargo reserves'],
    effects: [add('outpostStockCapacityBonus', 50), multiply('cargoProductionMult', 1.1)],
  }),

  // ─── v13 Military expansion ───
  mil_fleet_academy: v13Node({
    id: 'mil_fleet_academy', cluster: 'military', name: 'Fleet Academy',
    prereqs: ['mil_field_hospital', 'res_lab_2'], effect: 'unlock_fleet_academy',
    description: 'Establishes formal officer training and a persistent fleet veterancy program.',
    tags: ['military', 'building', 'veterancy', 'fleet'],
    unlocks: ['Fleet Academy building'],
    effects: [unlockStructure('fleet_academy', {
      startingVeterancy: 1,
      maxVeterancy: 3,
      damagePerLevel: 0.05,
      hpPerLevel: 0.05,
    })],
  }),
  mil_veteran_corps: v13Node({
    id: 'mil_veteran_corps', cluster: 'military', name: 'Veteran Corps',
    prereqs: ['mil_fleet_academy', 'mil_command_cruiser'], effect: 'veterancy_gain_25',
    description: 'Retains combat-tested crews and spreads their doctrine across fleet support facilities.',
    tags: ['military', 'veterancy', 'fighter', 'repair', 'upgrade'],
    unlocks: ['Fighter factories and drydocks level II', 'Faster veterancy gain'],
    effects: [
      multiply('veterancyExperienceMult', 1.25),
      levelCap(['fighter_factory', 'drydock'], 2),
    ],
  }),
  mil_missile_silo_network: v13Node({
    id: 'mil_missile_silo_network', cluster: 'military', name: 'Missile Silo Network',
    prereqs: ['mil_torpedo_bays'], effect: 'unlock_missile_silo',
    description: 'Disperses hardened torpedo batteries across vulnerable planetary surfaces.',
    tags: ['military', 'building', 'defense', 'torpedo'],
    unlocks: ['Missile Silo building'],
    effects: [unlockStructure('missile_silo', {
      autoResolveDefenseBonus: 12,
      capPerBody: 2,
    })],
  }),
  mil_fortress_worlds: v13Node({
    id: 'mil_fortress_worlds', cluster: 'military', name: 'Fortress Worlds',
    prereqs: ['mil_missile_silo_network', 'mil_shield_generator'], effect: 'defense_level_2',
    description: 'Integrates shields, batteries, silos, and orbital platforms into layered planetary fortresses.',
    tags: ['military', 'defense', 'planetary', 'upgrade'],
    unlocks: ['Defensive structures level II'],
    effects: [
      multiply('defensePowerMult', 1.15),
      levelCap(['orbital_defense', 'planetary_shield', 'ion_battery', 'missile_silo', 'interdiction_array'], 2),
    ],
  }),
  mil_total_war_infrastructure: v13Node({
    id: 'mil_total_war_infrastructure', cluster: 'military', name: 'Total-War Infrastructure',
    prereqs: ['mil_fortress_worlds', 'mil_war_doctrine', 'mil_super_carrier'], effect: 'military_level_3',
    description: 'Mobilizes every major production and defense network for sustained interstellar war.',
    tags: ['military', 'defense', 'production', 'upgrade'],
    unlocks: ['Military support and defensive structures level III'],
    effects: [
      multiply('shipBuildSpeedMult', 1.15),
      levelCap([
        'fighter_factory', 'drydock', 'orbital_defense', 'planetary_shield',
        'ion_battery', 'missile_silo', 'interdiction_array',
      ], 3),
    ],
  }),
  mil_gravitic_interdiction: v13Node({
    id: 'mil_gravitic_interdiction', cluster: 'military', name: 'Gravitic Interdiction',
    prereqs: ['mil_ion_disruptors', 'wh_stable_gate'], effect: 'unlock_interdiction_array',
    description: 'Weaponizes controlled gravity gradients to trap hostile fleets inside contested systems.',
    tags: ['military', 'building', 'wormhole', 'interdiction'],
    unlocks: ['Interdiction Array building'],
    effects: [unlockStructure('interdiction_array', {
      retreatChargeTimeMult: 1.5,
      blocksHostileDepartureWhileActive: true,
    })],
  }),
  mil_carrier_command: v13Node({
    id: 'mil_carrier_command', cluster: 'military', name: 'Carrier Command',
    prereqs: ['mil_carrier_launch_doctrine'], effect: 'unlock_carrier_command',
    description: 'Creates dedicated orbital command centers for carrier wings and replenishment crews.',
    tags: ['military', 'building', 'carrier', 'fighter'],
    unlocks: ['Carrier Command building'],
    effects: [unlockStructure('carrier_command', {
      carrierWingCapacityMult: 1.25,
      fighterReplenishmentMult: 1.25,
    })],
  }),
  mil_squadron_coordination: v13Node({
    id: 'mil_squadron_coordination', cluster: 'military', name: 'Squadron Coordination',
    prereqs: ['mil_carrier_command'], effect: 'carrier_coordination_10',
    description: 'Synchronizes carrier squadrons into shared strike, escort, and replacement rotations.',
    tags: ['military', 'carrier', 'fighter', 'coordination'],
    unlocks: ['Improved carrier capacity and fighter replenishment'],
    effects: [multiply('carrierWingCapacityMult', 1.1), multiply('fighterReplenishmentMult', 1.15)],
  }),
  mil_orbital_sensor_arrays: v13Node({
    id: 'mil_orbital_sensor_arrays', cluster: 'military', name: 'Orbital Sensor Arrays',
    prereqs: ['mil_sensor_ship'], effect: 'unlock_sensor_array',
    description: 'Deploys long-baseline orbital sensors for regional intelligence and local fire support.',
    tags: ['military', 'building', 'sensor', 'intel'],
    unlocks: ['Sensor Array building'],
    effects: [unlockStructure('sensor_array', {
      intelHopBonus: 1,
      friendlyWeaponRangeMult: 1.1,
    })],
  }),
  mil_integrated_fire_control: v13Node({
    id: 'mil_integrated_fire_control', cluster: 'military', name: 'Integrated Fire Control',
    prereqs: ['mil_orbital_sensor_arrays', 'mil_beam_lances'], effect: 'weapon_range_10',
    description: 'Fuses fleet and orbital targeting data into a single precision engagement network.',
    tags: ['military', 'sensor', 'weapons', 'range'],
    unlocks: ['Improved friendly weapon range and beam accuracy'],
    effects: [multiply('weaponRangeMult', 1.1), multiply('beamDamageMult', 1.1)],
  }),

  // ─── v13 Megastructure expansion ───
  mega_solar_collectors: v13Node({
    id: 'mega_solar_collectors', cluster: 'megastructure', name: 'Solar Collectors',
    prereqs: ['mega_solarii_boost', 'eco_power_grid'], effect: 'unlock_solar_collector',
    description: 'Captures stellar power at the source to reinforce every stage of Dyson construction.',
    tags: ['megastructure', 'building', 'dyson', 'solarii'],
    unlocks: ['Solar Collector building'],
    effects: [unlockStructure('solar_collector', {
      foundryOutputMult: 1.15,
      launcherRateMult: 1.1,
      solariiOutputMult: 1.05,
    })],
  }),
  mega_collector_swarms: v13Node({
    id: 'mega_collector_swarms', cluster: 'megastructure', name: 'Collector Swarms',
    prereqs: ['mega_solar_collectors'], effect: 'solar_collector_output_15',
    description: 'Coordinates dense collector constellations around active Dyson construction sites.',
    tags: ['megastructure', 'dyson', 'collector', 'throughput'],
    unlocks: ['Improved collector and Solarii output'],
    effects: [multiply('solarCollectorOutputMult', 1.15), multiply('solariiIncomeMult', 1.05)],
  }),
  mega_foundry_refits: v13Node({
    id: 'mega_foundry_refits', cluster: 'megastructure', name: 'Foundry Refits',
    prereqs: ['mega_foundry_3', 'eco_nanoforges'], effect: 'dyson_industry_level_2',
    description: 'Rebuilds sail and launcher production lines around modular nanoforge assemblies.',
    tags: ['megastructure', 'foundry', 'launcher', 'upgrade'],
    unlocks: ['Dyson industrial structures level II'],
    effects: [
      multiply('foundryOutputMult', 1.15),
      levelCap(['sail_foundry', 'dyson_launcher', 'solar_collector'], 2),
    ],
  }),
  mega_stellar_forge: v13Node({
    id: 'mega_stellar_forge', cluster: 'megastructure', name: 'Stellar Forge',
    prereqs: ['mega_foundry_refits'], effect: 'dyson_industry_level_3',
    description: 'Turns an entire developed system into a coordinated ship and megastructure forge.',
    tags: ['megastructure', 'foundry', 'shipyard', 'upgrade'],
    unlocks: ['Shipyards and Dyson industrial structures level III'],
    effects: [
      multiply('industrialOutputMult', 1.2),
      levelCap(['shipyard', 'sail_foundry', 'dyson_launcher', 'solar_collector'], 3),
    ],
  }),
  mega_launcher_synchronization: v13Node({
    id: 'mega_launcher_synchronization', cluster: 'megastructure', name: 'Launcher Synchronization',
    prereqs: ['mega_dual_launcher', 'mil_integrated_fire_control'], effect: 'launcher_sync_15',
    description: 'Applies military fire-control timing to planet-scale sail launcher networks.',
    tags: ['megastructure', 'launcher', 'sensor', 'throughput'],
    unlocks: ['Synchronized launcher cadence'],
    effects: [multiply('launcherRateMult', 1.15)],
  }),
  mega_stellar_lattice: v13Node({
    id: 'mega_stellar_lattice', cluster: 'megastructure', name: 'Stellar Lattice',
    prereqs: ['mega_shell_harmonic'], effect: 'stellar_lattice_output_15',
    description: 'Links completed shell segments into a resilient stellar-scale energy lattice.',
    tags: ['megastructure', 'dyson', 'shell', 'energy'],
    unlocks: ['Improved Dyson and Solarii output'],
    effects: [multiply('dysonOutputMult', 1.15), multiply('solariiIncomeMult', 1.1)],
  }),
  mega_ascendant_engineering: v13Node({
    id: 'mega_ascendant_engineering', cluster: 'megastructure', name: 'Ascendant Engineering',
    prereqs: ['mega_stellar_lattice', 'res_ai_core', 'mega_dyson_overdrive'], effect: 'ascendant_engineering',
    description: 'Combines machine intelligence and stellar engineering into post-scarcity construction doctrine.',
    tags: ['megastructure', 'research', 'dyson', 'endgame'],
    unlocks: ['Ascendant megastructure efficiency'],
    effects: [multiply('dysonOutputMult', 1.25), multiply('industrialOutputMult', 1.15)],
  }),

  // ─── v13 Trade expansion ───
  trade_logistics_hubs: v13Node({
    id: 'trade_logistics_hubs', cluster: 'trade', name: 'Logistics Hubs',
    prereqs: ['trade_route_opt', 'eco_storage_depot'], effect: 'unlock_logistics_hub',
    description: 'Centralizes depot traffic, convoy dispatch, and regional route capacity.',
    tags: ['trade', 'building', 'logistics', 'cargo'],
    unlocks: ['Logistics Hub building'],
    effects: [unlockStructure('logistics_hub', {
      depotCapacityBonus: 100,
      dispatchIntervalMult: 0.8,
      convoyRouteBonus: 1,
    })],
  }),
  trade_predictive_dispatch: v13Node({
    id: 'trade_predictive_dispatch', cluster: 'trade', name: 'Predictive Dispatch',
    prereqs: ['trade_logistics_hubs'], effect: 'dispatch_interval_20',
    description: 'Forecasts cargo demand and dispatches convoys before local stock imbalances emerge.',
    tags: ['trade', 'logistics', 'convoy', 'automation'],
    unlocks: ['Faster dispatch and one additional convoy route'],
    effects: [multiply('logisticsDispatchIntervalMult', 0.8), add('convoyRouteBonus', 1)],
  }),
  trade_galactic_exchange: v13Node({
    id: 'trade_galactic_exchange', cluster: 'trade', name: 'Galactic Exchange',
    prereqs: ['trade_galactic_net', 'eco_finance_hub'], effect: 'unlock_galactic_exchange',
    description: 'Creates a trusted orbital exchange for high-volume Nexus settlement and route brokerage.',
    tags: ['trade', 'building', 'finance', 'nexus'],
    unlocks: ['Galactic Exchange building'],
    effects: [unlockStructure('galactic_exchange', {
      nexusDeliveryValueMult: 1.15,
      manualTradeRouteBonus: 2,
    })],
  }),
  trade_freeport_network: v13Node({
    id: 'trade_freeport_network', cluster: 'trade', name: 'Freeport Network',
    prereqs: ['trade_galactic_exchange', 'dip_embassy_complex'], effect: 'manual_trade_routes_2',
    description: 'Links protected neutral markets into a resilient cross-faction commerce network.',
    tags: ['trade', 'diplomacy', 'freeport', 'routes'],
    unlocks: ['Two additional manual trade routes'],
    effects: [add('manualTradeRouteBonus', 2), multiply('tradeIncomeMult', 1.1)],
  }),
  trade_quantum_markets: v13Node({
    id: 'trade_quantum_markets', cluster: 'trade', name: 'Quantum Markets',
    prereqs: ['trade_freeport_network', 'wh_empire_relay'], effect: 'nexus_delivery_15',
    description: 'Settles cargo contracts across interstellar distances with near-instant market clearing.',
    tags: ['trade', 'wormhole', 'finance', 'nexus'],
    unlocks: ['Improved Nexus delivery value'],
    effects: [multiply('nexusDeliveryValueMult', 1.15), multiply('tradeIncomeMult', 1.15)],
  }),
  trade_cargo_insurance: v13Node({
    id: 'trade_cargo_insurance', cluster: 'trade', name: 'Cargo Insurance',
    prereqs: ['trade_armored_convoy'], effect: 'cargo_loss_25',
    description: 'Pools convoy risk across the empire and standardizes loss recovery contracts.',
    tags: ['trade', 'cargo', 'convoy', 'insurance'],
    unlocks: ['Reduced cargo losses'],
    effects: [multiply('cargoLossMult', 0.75)],
  }),
  trade_salvage_doctrine: v13Node({
    id: 'trade_salvage_doctrine', cluster: 'trade', name: 'Salvage Doctrine',
    prereqs: ['trade_cargo_insurance', 'mil_drydock'], effect: 'unlock_salvage_yard',
    description: 'Formalizes battlefield recovery crews and routes reclaimed material into orbital yards.',
    tags: ['trade', 'building', 'salvage', 'military'],
    unlocks: ['Salvage Yard building'],
    effects: [unlockStructure('salvage_yard', {
      friendlyHullRecoveryRate: 0.2,
      carrierCraftRecoveryRate: 0.25,
    })],
  }),

  // ─── v13 Wormhole expansion ───
  wh_observatory: v13Node({
    id: 'wh_observatory', cluster: 'wormhole', name: 'Wormhole Observatory',
    prereqs: ['wh_core_mapping', 'res_lab_2'], effect: 'unlock_wormhole_observatory',
    description: 'Maps unanchored destinations from a black-hole observatory and accelerates jump calculations.',
    tags: ['wormhole', 'building', 'black-hole', 'intel'],
    unlocks: ['Wormhole Observatory building'],
    effects: [unlockStructure('wormhole_observatory', {
      anchorChargeRateMult: 1.25,
      fleetJumpChargeRateMult: 1.25,
      galaxyCap: 1,
      revealsUnanchoredDestinationPool: true,
    })],
  }),
  wh_route_prediction: v13Node({
    id: 'wh_route_prediction', cluster: 'wormhole', name: 'Route Prediction',
    prereqs: ['wh_observatory'], effect: 'wormhole_charge_20',
    description: 'Predicts destination drift and precomputes stable fleet-jump solutions.',
    tags: ['wormhole', 'navigation', 'routes', 'charge'],
    unlocks: ['Faster anchor and fleet-jump charge'],
    effects: [multiply('wormholeChargeRateMult', 1.2)],
  }),
  wh_anchor_network: v13Node({
    id: 'wh_anchor_network', cluster: 'wormhole', name: 'Anchor Network',
    prereqs: ['wh_stable_gate', 'trade_logistics_hubs'], effect: 'anchor_network_capacity',
    description: 'Coordinates anchor deployment through the same dispatch network used by strategic logistics.',
    tags: ['wormhole', 'anchor', 'logistics', 'network'],
    unlocks: ['Faster anchor deployment and expanded anchor support'],
    effects: [multiply('wormholeChargeRateMult', 1.15), add('anchorNetworkCapacityBonus', 1)],
  }),
  wh_interdiction_field: v13Node({
    id: 'wh_interdiction_field', cluster: 'wormhole', name: 'Interdiction Field',
    prereqs: ['wh_anchor_network', 'mil_gravitic_interdiction'], effect: 'interdiction_strength_25',
    description: 'Extends gravitic interdiction across anchored wormhole approaches.',
    tags: ['wormhole', 'military', 'interdiction', 'anchor'],
    unlocks: ['Stronger interdiction arrays'],
    effects: [multiply('interdictionStrengthMult', 1.25)],
  }),
  wh_mass_transit: v13Node({
    id: 'wh_mass_transit', cluster: 'wormhole', name: 'Mass Transit',
    prereqs: ['wh_fleet_jump', 'trade_bulk_freighter'], effect: 'wormhole_transit_20',
    description: 'Adapts stabilized wormholes for frequent bulk-freighter and fleet passage.',
    tags: ['wormhole', 'trade', 'freighter', 'transit'],
    unlocks: ['Faster high-mass wormhole transit'],
    effects: [multiply('wormholeTransitMult', 1.2)],
  }),
  wh_quantum_corridors: v13Node({
    id: 'wh_quantum_corridors', cluster: 'wormhole', name: 'Quantum Corridors',
    prereqs: ['wh_mass_transit', 'wh_empire_relay', 'sw_jump_gate'], effect: 'quantum_corridor',
    description: 'Maintains empire-scale corridors for simultaneous civilian, military, and superweapon transit.',
    tags: ['wormhole', 'superweapon', 'relay', 'endgame'],
    unlocks: ['Quantum corridor capacity'],
    effects: [multiply('wormholeChargeRateMult', 1.25), add('quantumCorridorCapacityBonus', 1)],
  }),

  // ─── v13 Research expansion ───
  res_quantum_archives: v13Node({
    id: 'res_quantum_archives', cluster: 'research', name: 'Quantum Archives',
    prereqs: ['res_archivist'], effect: 'unlock_quantum_archive',
    description: 'Stores entangled research records in redundant planetary archive complexes.',
    tags: ['research', 'building', 'archive', 'queue'],
    unlocks: ['Quantum Archive building'],
    effects: [unlockStructure('quantum_archive', {
      localResearchOutputMult: 1.15,
      firstEmpireQueueSlotBonus: 1,
    })],
  }),
  res_data_redundancy: v13Node({
    id: 'res_data_redundancy', cluster: 'research', name: 'Data Redundancy',
    prereqs: ['res_quantum_archives', 'wh_observatory'], effect: 'research_structure_level_2',
    description: 'Replicates live research state through observatory-linked quantum archives.',
    tags: ['research', 'archive', 'wormhole', 'upgrade'],
    unlocks: ['Research stations and Quantum Archives level II'],
    effects: [
      multiply('quantumArchiveOutputMult', 1.15),
      levelCap(['research_station', 'quantum_archive'], 2),
    ],
  }),
  res_applied_sciences: v13Node({
    id: 'res_applied_sciences', cluster: 'research', name: 'Applied Sciences',
    prereqs: ['res_station_2', 'eco_nanoforges'], effect: 'applied_science_output_10',
    description: 'Moves discoveries directly from laboratory models into programmable production lines.',
    tags: ['research', 'economy', 'nanoforge', 'industry'],
    unlocks: ['Improved research and industrial throughput'],
    effects: [multiply('researchSpeedMult', 1.1), multiply('industrialOutputMult', 1.1)],
  }),
  res_combat_analytics: v13Node({
    id: 'res_combat_analytics', cluster: 'research', name: 'Combat Analytics',
    prereqs: ['res_applied_sciences', 'mil_fleet_academy'], effect: 'combat_analytics_10',
    description: 'Feeds academy combat records into continuously refined tactical models.',
    tags: ['research', 'military', 'veterancy', 'combat'],
    unlocks: ['Improved fleet damage and veterancy gain'],
    effects: [multiply('fleetDamageMult', 1.1), multiply('veterancyExperienceMult', 1.15)],
  }),
  res_social_prediction: v13Node({
    id: 'res_social_prediction', cluster: 'research', name: 'Social Prediction',
    prereqs: ['res_archivist'], effect: 'social_prediction_10',
    description: 'Models faction behavior from deep diplomatic and economic archives.',
    tags: ['research', 'diplomacy', 'prediction', 'archives'],
    unlocks: ['Improved treaty effects'],
    effects: [multiply('treatyEffectMult', 1.1)],
  }),
  res_singularity_institute: v13Node({
    id: 'res_singularity_institute', cluster: 'research', name: 'Singularity Institute',
    prereqs: ['res_social_prediction', 'mega_stellar_lattice', 'res_ai_core'], effect: 'research_structure_level_3',
    description: 'Unifies advanced machine cognition, social models, and stellar-scale experimental science.',
    tags: ['research', 'ai', 'megastructure', 'upgrade', 'endgame'],
    unlocks: ['Research stations and Quantum Archives level III'],
    effects: [
      multiply('researchSpeedMult', 1.25),
      levelCap(['research_station', 'quantum_archive'], 3),
    ],
  }),

  // ─── v13 Diplomacy expansion ───
  dip_embassy_complex: v13Node({
    id: 'dip_embassy_complex', cluster: 'diplomacy', name: 'Embassy Complex',
    prereqs: ['dip_embassy_network'], effect: 'unlock_embassy_complex',
    description: 'Establishes permanent diplomatic missions on strategically important worlds.',
    tags: ['diplomacy', 'building', 'treaty', 'trade'],
    unlocks: ['Embassy Complex building'],
    effects: [unlockStructure('embassy_complex', {
      treatyCostMult: 0.8,
      tradeTreatyEffectMult: 1.1,
      allianceTreatyEffectMult: 1.1,
      empireCap: 3,
    })],
    requiresDiplomacy: true,
  }),
  dip_cultural_exchange: v13Node({
    id: 'dip_cultural_exchange', cluster: 'diplomacy', name: 'Cultural Exchange',
    prereqs: ['dip_embassy_complex', 'res_quantum_archives'], effect: 'treaty_cost_10',
    description: 'Shares archives and institutions to reduce diplomatic friction between civilizations.',
    tags: ['diplomacy', 'research', 'culture', 'treaty'],
    unlocks: ['Lower treaty costs and stronger treaty effects'],
    effects: [multiply('treatyCostMult', 0.9), multiply('treatyEffectMult', 1.1)],
    requiresDiplomacy: true,
  }),
  dip_joint_logistics: v13Node({
    id: 'dip_joint_logistics', cluster: 'diplomacy', name: 'Joint Logistics',
    prereqs: ['dip_cultural_exchange', 'trade_logistics_hubs'], effect: 'joint_logistics_15',
    description: 'Allows treaty partners to coordinate protected cargo routes and shared depots.',
    tags: ['diplomacy', 'trade', 'logistics', 'alliance'],
    unlocks: ['Improved allied trade and convoy capacity'],
    effects: [multiply('treatyEffectMult', 1.15), add('convoyRouteBonus', 1)],
    requiresDiplomacy: true,
  }),
  dip_defense_compact: v13Node({
    id: 'dip_defense_compact', cluster: 'diplomacy', name: 'Defense Compact',
    prereqs: ['dip_alliance_pact', 'mil_fortress_worlds'], effect: 'allied_defense_20',
    description: 'Coordinates fortress doctrine, warning networks, and mutual fleet response plans.',
    tags: ['diplomacy', 'military', 'alliance', 'defense'],
    unlocks: ['Improved allied defensive strength'],
    effects: [multiply('alliedDefenseMult', 1.2)],
    requiresDiplomacy: true,
  }),
  dip_galactic_council: v13Node({
    id: 'dip_galactic_council', cluster: 'diplomacy', name: 'Galactic Council',
    prereqs: ['dip_defense_compact', 'trade_freeport_network', 'hero_rally_doctrine'], effect: 'galactic_council',
    description: 'Convenes allied powers, freeports, and sovereign fleets under a permanent council.',
    tags: ['diplomacy', 'trade', 'flagship', 'endgame'],
    unlocks: ['Galactic Council mandate'],
    effects: [set('galacticCouncil'), multiply('treatyEffectMult', 1.25)],
    requiresDiplomacy: true,
  }),

  // ─── v13 Flagship expansion ───
  hero_command_suite: v13Node({
    id: 'hero_command_suite', cluster: 'flagship', name: 'Command Suite',
    prereqs: ['hero_command_aura'], effect: 'flagship_command_15',
    description: 'Refits the sovereign flagship as a true empire-scale fleet command center.',
    tags: ['flagship', 'command', 'fleet', 'aura'],
    unlocks: ['Improved flagship command aura'],
    effects: [multiply('flagshipCommandMult', 1.15)],
    requiresSuperweapon: true,
  }),
  hero_mobile_shipyard: v13Node({
    id: 'hero_mobile_shipyard', cluster: 'flagship', name: 'Mobile Shipyard',
    prereqs: ['hero_command_suite', 'eco_nanoforges'], effect: 'flagship_mobile_shipyard',
    description: 'Integrates nanoforge-fed repair and limited construction bays into the flagship.',
    tags: ['flagship', 'nanoforge', 'shipyard', 'repair'],
    unlocks: ['Flagship mobile shipyard capability'],
    effects: [set('flagshipMobileShipyard'), multiply('flagshipBuildSpeedMult', 1.2)],
    requiresSuperweapon: true,
  }),
  hero_wormhole_compass: v13Node({
    id: 'hero_wormhole_compass', cluster: 'flagship', name: 'Wormhole Compass',
    prereqs: ['hero_hull_unlock', 'wh_route_prediction'], effect: 'flagship_jump_charge_25',
    description: 'Gives the flagship an autonomous predictive navigator for unstable wormhole routes.',
    tags: ['flagship', 'wormhole', 'navigation', 'jump'],
    unlocks: ['Faster flagship wormhole charge'],
    effects: [multiply('flagshipJumpChargeMult', 1.25)],
    requiresSuperweapon: true,
  }),
  hero_diplomatic_mandate: v13Node({
    id: 'hero_diplomatic_mandate', cluster: 'flagship', name: 'Diplomatic Mandate',
    prereqs: ['hero_hull_unlock', 'dip_embassy_complex'], effect: 'flagship_diplomacy_15',
    description: 'Authorizes the flagship to negotiate with the full standing of the imperial court.',
    tags: ['flagship', 'diplomacy', 'embassy', 'treaty'],
    unlocks: ['Improved treaty influence while the flagship is present'],
    effects: [multiply('flagshipDiplomacyMult', 1.15)],
    requiresSuperweapon: true,
  }),
  hero_sovereign_core: v13Node({
    id: 'hero_sovereign_core', cluster: 'flagship', name: 'Sovereign Core',
    prereqs: [
      'hero_mobile_shipyard', 'hero_wormhole_compass', 'hero_diplomatic_mandate',
      'mega_ascendant_engineering', 'dip_galactic_council',
    ],
    effect: 'sovereign_core',
    description: 'Unifies command, engineering, navigation, and diplomacy inside the empire flagship.',
    tags: ['flagship', 'megastructure', 'diplomacy', 'endgame'],
    unlocks: ['Sovereign Core'],
    effects: [set('sovereignCore'), multiply('flagshipCommandMult', 1.25)],
    requiresSuperweapon: true,
  }),

  // ─── v13 Superweapon expansion ───
  sw_cradle_power_core: v13Node({
    id: 'sw_cradle_power_core', cluster: 'superweapon', name: 'Cradle Power Core',
    prereqs: ['sw_cradle_unlock', 'mega_stellar_lattice'], effect: 'cradle_power_core',
    description: 'Channels lattice-scale stellar energy into the superweapon cradle.',
    tags: ['superweapon', 'megastructure', 'power', 'cradle'],
    unlocks: ['Cradle power-core system'],
    effects: [set('cradlePowerCore'), multiply('superweaponPowerMult', 1.25)],
    requiresSuperweapon: true,
  }),
  sw_precision_targeting: v13Node({
    id: 'sw_precision_targeting', cluster: 'superweapon', name: 'Precision Targeting',
    prereqs: ['sw_cradle_unlock', 'mil_integrated_fire_control'], effect: 'superweapon_precision',
    description: 'Adapts integrated fleet fire control to stellar-scale superweapon targeting.',
    tags: ['superweapon', 'military', 'targeting', 'sensor'],
    unlocks: ['Precision targeting system'],
    effects: [set('precisionTargeting'), multiply('superweaponPrecisionMult', 1.25)],
    requiresSuperweapon: true,
  }),
  sw_genesis_matrix: v13Node({
    id: 'sw_genesis_matrix', cluster: 'superweapon', name: 'Genesis Matrix',
    prereqs: ['sw_create_star', 'eco_orbital_habitats'], effect: 'genesis_matrix',
    description: 'Applies habitat-scale ecological modeling to controlled stellar genesis.',
    tags: ['superweapon', 'economy', 'habitat', 'genesis'],
    unlocks: ['Genesis Matrix system'],
    effects: [set('genesisMatrix'), multiply('genesisEfficiencyMult', 1.25)],
    requiresSuperweapon: true,
  }),
  sw_gate_array: v13Node({
    id: 'sw_gate_array', cluster: 'superweapon', name: 'Gate Array',
    prereqs: ['sw_jump_gate', 'wh_quantum_corridors'], effect: 'superweapon_gate_array',
    description: 'Builds a corridor-linked gate array capable of moving the completed superweapon.',
    tags: ['superweapon', 'wormhole', 'gate', 'corridor'],
    unlocks: ['Superweapon Gate Array'],
    effects: [set('gateArray'), multiply('gateChargeMult', 1.25)],
    requiresSuperweapon: true,
  }),
  sw_sovereign_protocol: v13Node({
    id: 'sw_sovereign_protocol', cluster: 'superweapon', name: 'Sovereign Protocol',
    prereqs: [
      'sw_cradle_power_core', 'sw_precision_targeting', 'sw_genesis_matrix',
      'sw_gate_array', 'hero_sovereign_core',
    ],
    effect: 'sovereign_protocol',
    description: 'Authorizes the fully integrated cradle, targeting, genesis, gate, and sovereign systems.',
    tags: ['superweapon', 'flagship', 'endgame', 'protocol'],
    unlocks: ['Sovereign Protocol'],
    effects: [set('sovereignProtocol'), multiply('superweaponPowerMult', 1.25)],
    requiresSuperweapon: true,
  }),
};

function humanizeEffect(effect) {
  if (!effect || effect === 'seed') return 'Technology web foundation';
  return effect
    .replace(/^unlock_/, 'Unlock ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Preserve the legacy `effect` field while exposing normalized descriptors and
// searchable metadata on every node. Existing node costs are intentionally left
// untouched; only v13 nodes use the shared derived-tier curve below.
for (const node of Object.values(TECH_NODES)) {
  node.effects ??= node.effect ? [{ type: 'legacy', id: node.effect }] : [];
  node.description ??= `${node.name} advances the ${node.cluster} technology branch.`;
  node.tags ??= [node.cluster, ...String(node.effect ?? '').split('_').filter(Boolean)];
  node.unlocks ??= [humanizeEffect(node.effect)];
  node.milestones ??= [
    ...(node.requiresDiplomacy ? ['diplomacy'] : []),
    ...(node.requiresSuperweapon ? ['superweapon'] : []),
  ];
}

function rawDerivedTier(nodeId, memo = new Map(), visiting = new Set()) {
  if (memo.has(nodeId)) return memo.get(nodeId);
  const node = TECH_NODES[nodeId];
  if (!node) return 0;
  if (visiting.has(nodeId)) throw new Error(`Technology cycle encountered at ${nodeId}`);
  visiting.add(nodeId);
  const tier = node.prereqs.length === 0
    ? 1
    : 1 + Math.max(...node.prereqs.map((id) => rawDerivedTier(id, memo, visiting)));
  visiting.delete(nodeId);
  memo.set(nodeId, tier);
  return tier;
}

const tierMemo = new Map();
for (const node of Object.values(TECH_NODES)) {
  if (node.introducedIn !== 13) continue;
  const tier = rawDerivedTier(node.id, tierMemo);
  const cost = v13TechCostsForTier(tier);
  node.creditCost = cost.credits;
  node.solariiCost = cost.solarii;
  node.researchMs = cost.researchMs;
  node.costTier = tier;
}

export const V13_TECH_NODE_IDS = Object.freeze(
  Object.values(TECH_NODES)
    .filter((node) => node.introducedIn === 13)
    .map((node) => node.id),
);
