// Technology tree node definitions — large interconnected web (GDD §10).

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
  mil_light_carrier: {
    id: 'mil_light_carrier', cluster: 'military', name: 'Light Carrier',
    prereqs: ['mil_parallel_dock', 'mil_frigate_unlock'], creditCost: 1400, solariiCost: 2, researchMs: 78750, effect: 'unlock_light_carrier_queue',
  },
  mil_hangar_deck: {
    id: 'mil_hangar_deck', cluster: 'military', name: 'Hangar Decks',
    prereqs: ['mil_light_carrier'], creditCost: 1600, solariiCost: 2, researchMs: 80000, effect: 'carrier_dps_10',
  },
  mil_cruiser_unlock: {
    id: 'mil_cruiser_unlock', cluster: 'military', name: 'Cruiser Blueprints',
    prereqs: ['mil_frigate_unlock', 'mil_armor_alloy'], creditCost: 1500, solariiCost: 2, researchMs: 78750, effect: 'unlock_cruiser_queue',
  },
  mil_battleship_unlock: {
    id: 'mil_battleship_unlock', cluster: 'military', name: 'Battleship Hulls',
    prereqs: ['mil_cruiser_unlock', 'mil_torpedo_bays'], creditCost: 2000, solariiCost: 3, researchMs: 90000, effect: 'unlock_battleship_queue',
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
};
