// Technology tree — Dyson → Novacula spine with merge-back branches (GDD §10).

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
const hullRefit = (hull, refitId, label) => ({
  type: 'hull-refit',
  hull,
  refitId,
  label,
});
const flagshipUpgrade = (upgradeId, label) => ({
  type: 'flagship-upgrade',
  upgradeId,
  label,
});
const flagshipHullStage = (stage) => ({
  type: 'flagship-hull-stage',
  stage,
});
const swPart = (partId) => ({ type: 'sw-part-blueprint', partId });

/** Ordered Dyson → Novacula main path (layout + CSS). */
export const TECH_SPINE_IDS = Object.freeze([
  'eco_baseline',
  'eco_surveyor',
  'mega_foundry_unlock',
  'mega_launcher_unlock',
  'mega_shell_ops',
  'mega_dyson_maturity',
  'eco_sector_capitals',
  'sw_cradle_unlock',
  'sw_cradle_power_core',
  'sw_precision_targeting',
  'sw_novacula_online',
]);

function node(def) {
  const spine = TECH_SPINE_IDS.includes(def.id) || def.spine === true;
  const tags = [...new Set([
    ...(def.tags ?? [def.cluster]),
    ...(spine ? ['spine'] : []),
  ])];
  return {
    creditCost: def.creditCost ?? 0,
    solariiCost: def.solariiCost ?? 0,
    researchMs: def.researchMs ?? 0,
    description: def.description
      ?? `${def.name} advances the ${def.cluster} technology branch.`,
    tags,
    unlocks: def.unlocks ?? [def.name],
    effects: def.effects ?? (def.effect ? [{ type: 'legacy', id: def.effect }] : []),
    milestones: def.milestones ?? [
      ...(def.requiresDiplomacy ? ['diplomacy'] : []),
      ...(def.requiresSuperweapon ? ['superweapon'] : []),
    ],
    spine,
    spineIndex: spine ? TECH_SPINE_IDS.indexOf(def.id) : -1,
    ...def,
    tags,
  };
}

export const TECH_NODES = {
  // ═══ SPINE: Baseline → Foundry → Launcher → Sphere → Maturity → Orders → Cradle → Power → Focus → Novacula ═══
  eco_baseline: node({
    id: 'eco_baseline', cluster: 'economy', name: 'Baseline Economics',
    prereqs: [], creditCost: 0, solariiCost: 0, researchMs: 0, effect: 'seed',
    description: 'Founding economic doctrine. Root of the Dyson → Novacula path.',
    unlocks: ['Technology web foundation'],
  }),
  eco_surveyor: node({
    id: 'eco_surveyor', cluster: 'economy', name: 'Surveyor Drones',
    prereqs: ['eco_baseline'], creditCost: 250, solariiCost: 0, researchMs: 32000,
    effect: 'credit_income_5',
    description: 'Survey drones map claim sites and speed early construction.',
    unlocks: ['Surveyor drone bonus'],
  }),
  mega_foundry_unlock: node({
    id: 'mega_foundry_unlock', cluster: 'megastructure', name: 'Sail Foundry',
    prereqs: ['eco_surveyor'], creditCost: 500, solariiCost: 0, researchMs: 40000,
    effect: 'unlock_foundry',
    description: 'Unlocks the sail foundry — first step of every Dyson sphere.',
    tags: ['megastructure', 'dyson', 'spine'],
    unlocks: ['Sail Foundry'],
  }),
  mega_launcher_unlock: node({
    id: 'mega_launcher_unlock', cluster: 'megastructure', name: 'Dyson Launcher',
    prereqs: ['mega_foundry_unlock'], creditCost: 650, solariiCost: 0, researchMs: 45000,
    effect: 'unlock_launcher',
    description: 'Unlocks sail launchers. Each fires at least one sail per second.',
    tags: ['megastructure', 'dyson', 'spine'],
    unlocks: ['Dyson Launcher'],
  }),
  mega_shell_ops: node({
    id: 'mega_shell_ops', cluster: 'megastructure', name: 'Shell Operations',
    prereqs: ['mega_launcher_unlock'], creditCost: 800, solariiCost: 0, researchMs: 50000,
    effect: 'dyson_shell_bonus',
    description: 'Coordinates shell placement and Solarii harvest on incomplete spheres.',
    tags: ['megastructure', 'dyson', 'spine'],
    unlocks: ['Shell matrix bonus'],
    effects: [set('dysonShellBonus'), multiply('solariiIncomeMult', 1.1)],
  }),
  mega_dyson_maturity: node({
    id: 'mega_dyson_maturity', cluster: 'megastructure', name: 'Dyson Maturity',
    prereqs: ['mega_shell_ops', 'mil_parallel_dock'],
    creditCost: 1200, solariiCost: 1, researchMs: 60000,
    effect: 'dyson_shell_sync',
    description: 'First-sphere maturity. Military dock branch merges here. Mid-game gate.',
    tags: ['megastructure', 'dyson', 'spine', 'merge'],
    unlocks: ['Dyson shell sync'],
    effects: [set('dysonShellSync'), multiply('dysonOutputMult', 1.1)],
  }),
  eco_sector_capitals: node({
    id: 'eco_sector_capitals', cluster: 'economy', name: 'Sector Capitals',
    prereqs: ['mega_dyson_maturity', 'eco_trade_hub'],
    creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'sector_capitals',
    description: 'Authorizes mega-orders and expansion campaigns from sector capitals.',
    tags: ['economy', 'orders', 'campaign', 'spine', 'merge'],
    unlocks: ['Mega-orders', 'Expansion campaigns'],
    effects: [set('sectorCapitals', true), multiply('creditIncomeMult', 1.1)],
  }),
  sw_cradle_unlock: node({
    id: 'sw_cradle_unlock', cluster: 'superweapon', name: 'Cradle Frame',
    prereqs: ['eco_sector_capitals', 'dip_truce_protocol', 'res_station_protocol'],
    creditCost: 2500, solariiCost: 5, researchMs: 90000,
    effect: 'unlock_superweapon_cradle',
    description: 'Blueprint for an incomplete Novacula cradle at the Stronghold.',
    tags: ['superweapon', 'spine', 'merge'],
    unlocks: ['Superweapon cradle frame'],
    effects: [swPart('frame'), { type: 'legacy', id: 'unlock_superweapon_cradle' }],
    requiresSuperweapon: true,
  }),
  sw_cradle_power_core: node({
    id: 'sw_cradle_power_core', cluster: 'superweapon', name: 'Power Core',
    prereqs: ['sw_cradle_unlock'],
    creditCost: 2200, solariiCost: 6, researchMs: 85000,
    effect: 'cradle_power_core',
    description: 'Cradle power skeleton — install to enable charging.',
    tags: ['superweapon', 'spine'],
    unlocks: ['Power core blueprint'],
    effects: [swPart('power'), set('cradlePowerCore'), multiply('superweaponPowerMult', 1.15)],
    requiresSuperweapon: true,
  }),
  sw_precision_targeting: node({
    id: 'sw_precision_targeting', cluster: 'superweapon', name: 'Focus Array',
    prereqs: ['sw_cradle_power_core'],
    creditCost: 2400, solariiCost: 7, researchMs: 90000,
    effect: 'superweapon_precision',
    description: 'Focus / targeting skeleton — install to aim stellar fire.',
    tags: ['superweapon', 'spine'],
    unlocks: ['Focus array blueprint'],
    effects: [swPart('focus'), set('precisionTargeting'), multiply('superweaponPrecisionMult', 1.2)],
    requiresSuperweapon: true,
  }),
  sw_novacula_online: node({
    id: 'sw_novacula_online', cluster: 'superweapon', name: 'Novacula Online',
    prereqs: [
      'sw_precision_targeting',
      'sw_create_star',
      'sw_destroy_star',
      'sw_jump_gate',
      'hero_command_suite',
    ],
    creditCost: 4000, solariiCost: 12, researchMs: 120000,
    effect: 'sovereign_protocol',
    description: 'Integrates installed skeletons into a fully online Novacula.',
    tags: ['superweapon', 'spine', 'endgame', 'merge'],
    unlocks: ['Novacula online'],
    effects: [set('sovereignProtocol'), set('novaculaOnline'), multiply('superweaponPowerMult', 1.25)],
    requiresSuperweapon: true,
  }),

  // ═══ UPPER: Industry / Trade (fork surveyor → merge sector capitals) ═══
  eco_construction_drones: node({
    id: 'eco_construction_drones', cluster: 'economy', name: 'Construction Drones',
    prereqs: ['eco_surveyor'], creditCost: 350, solariiCost: 0, researchMs: 40000,
    effect: 'unlock_construction_drones',
    description: 'Remote construction drone fleets.',
    unlocks: ['Construction drones'],
  }),
  eco_miner_hull: node({
    id: 'eco_miner_hull', cluster: 'economy', name: 'Orbital Miners',
    prereqs: ['eco_construction_drones'], creditCost: 450, solariiCost: 0, researchMs: 42000,
    effect: 'unlock_miner_hull',
    unlocks: ['Miner hull'],
  }),
  eco_mining_complex: node({
    id: 'eco_mining_complex', cluster: 'economy', name: 'Mining Complexes',
    prereqs: ['eco_miner_hull'], creditCost: 550, solariiCost: 0, researchMs: 45000,
    effect: 'unlock_mining_complex',
    unlocks: ['Mining complex'],
  }),
  eco_refinery: node({
    id: 'eco_refinery', cluster: 'economy', name: 'Refinery Chains',
    prereqs: ['eco_mining_complex'], creditCost: 600, solariiCost: 0, researchMs: 48000,
    effect: 'unlock_refinery',
    unlocks: ['Refinery'],
  }),
  eco_storage_depot: node({
    id: 'eco_storage_depot', cluster: 'economy', name: 'Storage Depots',
    prereqs: ['eco_refinery'], creditCost: 650, solariiCost: 0, researchMs: 50000,
    effect: 'unlock_storage_depot',
    unlocks: ['Storage depot'],
  }),
  eco_asteroid_harvester: node({
    id: 'eco_asteroid_harvester', cluster: 'economy', name: 'Asteroid Harvesters',
    prereqs: ['eco_storage_depot', 'wh_scout_range'], creditCost: 900, solariiCost: 1, researchMs: 55000,
    effect: 'unlock_asteroid_harvester',
    unlocks: ['Asteroid harvester'],
  }),
  eco_trade_hub: node({
    id: 'eco_trade_hub', cluster: 'trade', name: 'Trade Hub Protocol',
    prereqs: ['eco_construction_drones'], creditCost: 500, solariiCost: 0, researchMs: 45000,
    effect: 'unlock_trade_station',
    description: 'Unlocks trade stations. Merges into Sector Capitals on the spine.',
    unlocks: ['Trade station'],
  }),
  trade_route_opt: node({
    id: 'trade_route_opt', cluster: 'trade', name: 'Route Optimization',
    prereqs: ['eco_trade_hub'], creditCost: 600, solariiCost: 0, researchMs: 48000,
    effect: 'trade_income_20',
    unlocks: ['Trade income +20%'],
  }),
  trade_light_hauler: node({
    id: 'trade_light_hauler', cluster: 'trade', name: 'Light Haulers',
    prereqs: ['trade_route_opt'], creditCost: 700, solariiCost: 0, researchMs: 50000,
    effect: 'unlock_light_hauler',
    unlocks: ['Light hauler'],
  }),
  trade_bulk_freighter: node({
    id: 'trade_bulk_freighter', cluster: 'trade', name: 'Bulk Freighters',
    prereqs: ['trade_light_hauler'], creditCost: 900, solariiCost: 1, researchMs: 55000,
    effect: 'unlock_bulk_freighter',
    unlocks: ['Bulk freighter'],
  }),
  trade_lane_secured: node({
    id: 'trade_lane_secured', cluster: 'trade', name: 'Secured Lanes',
    prereqs: ['trade_route_opt'], creditCost: 750, solariiCost: 0, researchMs: 52000,
    effect: 'trade_neutral_bridge',
    unlocks: ['Neutral trade bridges'],
  }),
  trade_logistics_hubs: node({
    id: 'trade_logistics_hubs', cluster: 'trade', name: 'Logistics Hubs',
    prereqs: ['trade_bulk_freighter'], creditCost: 1000, solariiCost: 1, researchMs: 58000,
    effect: 'unlock_logistics_hub',
    unlocks: ['Logistics hub'],
    effects: [unlockStructure('logistics_hub')],
  }),
  trade_galactic_exchange: node({
    id: 'trade_galactic_exchange', cluster: 'trade', name: 'Galactic Exchange',
    prereqs: ['trade_logistics_hubs', 'eco_sector_capitals'], creditCost: 1600, solariiCost: 3, researchMs: 70000,
    effect: 'unlock_galactic_exchange',
    unlocks: ['Galactic exchange'],
    effects: [unlockStructure('galactic_exchange'), multiply('tradeIncomeMult', 1.15)],
  }),
  trade_salvage_doctrine: node({
    id: 'trade_salvage_doctrine', cluster: 'trade', name: 'Salvage Doctrine',
    prereqs: ['trade_lane_secured'], creditCost: 850, solariiCost: 1, researchMs: 52000,
    effect: 'unlock_salvage_yard',
    unlocks: ['Salvage yard'],
    effects: [unlockStructure('salvage_yard')],
  }),
  trade_armored_convoy: node({
    id: 'trade_armored_convoy', cluster: 'trade', name: 'Armored Convoys',
    prereqs: ['trade_bulk_freighter', 'mil_destroyer_unlock'], creditCost: 1100, solariiCost: 2, researchMs: 60000,
    effect: 'unlock_armored_convoy',
    unlocks: ['Armored convoy'],
  }),
  eco_industrial_automation: node({
    id: 'eco_industrial_automation', cluster: 'economy', name: 'Industrial Automation',
    prereqs: ['eco_storage_depot', 'mega_shell_ops'], creditCost: 1000, solariiCost: 1, researchMs: 55000,
    effect: 'industrial_output_15',
    unlocks: ['Bulk production scheduling'],
    effects: [multiply('industrialOutputMult', 1.15), multiply('shipBuildSpeedMult', 1.1)],
  }),
  eco_power_grid: node({
    id: 'eco_power_grid', cluster: 'economy', name: 'Power Grids',
    prereqs: ['mega_shell_ops'], creditCost: 900, solariiCost: 1, researchMs: 52000,
    effect: 'unlock_power_grid',
    unlocks: ['Power grid'],
    effects: [unlockStructure('power_grid')],
  }),
  eco_orbital_habitats: node({
    id: 'eco_orbital_habitats', cluster: 'economy', name: 'Orbital Habitats',
    prereqs: ['eco_power_grid', 'wh_nav_beacon'], creditCost: 1200, solariiCost: 2, researchMs: 60000,
    effect: 'unlock_orbital_habitat',
    unlocks: ['Orbital habitat'],
    effects: [unlockStructure('orbital_habitat')],
  }),
  eco_nanoforges: node({
    id: 'eco_nanoforges', cluster: 'economy', name: 'Nanoforges',
    prereqs: ['eco_industrial_automation', 'res_lab_2'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'unlock_nanoforge',
    unlocks: ['Nanoforge'],
    effects: [unlockStructure('nanoforge'), multiply('shipBuildSpeedMult', 1.1)],
  }),
  mega_orbital_shield: node({
    id: 'mega_orbital_shield', cluster: 'megastructure', name: 'Orbital Shield',
    prereqs: ['mega_shell_ops'], creditCost: 1100, solariiCost: 2, researchMs: 58000,
    effect: 'dyson_shield',
    unlocks: ['Dyson orbital shield'],
    effects: [set('dysonShield')],
  }),
  mega_solar_collectors: node({
    id: 'mega_solar_collectors', cluster: 'megastructure', name: 'Solar Collectors',
    prereqs: ['mega_launcher_unlock'], creditCost: 700, solariiCost: 0, researchMs: 48000,
    effect: 'unlock_solar_collector',
    unlocks: ['Solar collector'],
    effects: [unlockStructure('solar_collector'), multiply('solariiIncomeMult', 1.1)],
  }),
  mega_foundry_output: node({
    id: 'mega_foundry_output', cluster: 'megastructure', name: 'Foundry Throughput',
    prereqs: ['mega_foundry_unlock'], creditCost: 550, solariiCost: 0, researchMs: 40000,
    effect: 'foundry_output_15',
    unlocks: ['Foundry output +15%'],
  }),
  mega_launcher_cadence: node({
    id: 'mega_launcher_cadence', cluster: 'megastructure', name: 'Launcher Cadence',
    prereqs: ['mega_launcher_unlock'], creditCost: 600, solariiCost: 0, researchMs: 42000,
    effect: 'launcher_rate_15',
    description: 'Raises launcher fire rate above the 1 sail/sec floor.',
    unlocks: ['Launcher rate +15%'],
  }),

  // ═══ UPPER: Military (fork launcher → merge maturity via parallel dock) ═══
  mil_parallel_dock: node({
    id: 'mil_parallel_dock', cluster: 'military', name: 'Parallel Docking',
    prereqs: ['mega_launcher_unlock', 'res_lab_1'], creditCost: 700, solariiCost: 0, researchMs: 50000,
    effect: 'shipyard_slots_2',
    description: 'Second shipyard queue. Required merge into Dyson Maturity.',
    tags: ['military', 'merge'],
    unlocks: ['Shipyard slots ×2'],
  }),
  mil_corvette_hardening: node({
    id: 'mil_corvette_hardening', cluster: 'military', name: 'Corvette Hardening',
    prereqs: ['mil_parallel_dock'], creditCost: 500, solariiCost: 0, researchMs: 40000,
    effect: 'corvette_hp_15',
    unlocks: ['Corvette Mk II'],
    effects: [
      { type: 'legacy', id: 'corvette_hp_15' },
      hullRefit('corvette', 'hardening', 'Mk II Hardening'),
    ],
  }),
  mil_patrol_cutter: node({
    id: 'mil_patrol_cutter', cluster: 'military', name: 'Patrol Cutters',
    prereqs: ['mil_parallel_dock'], creditCost: 450, solariiCost: 0, researchMs: 40000,
    effect: 'unlock_patrol_cutter',
    unlocks: ['Patrol cutter'],
  }),
  mil_destroyer_unlock: node({
    id: 'mil_destroyer_unlock', cluster: 'military', name: 'Destroyer Blueprints',
    prereqs: ['mil_parallel_dock'], creditCost: 800, solariiCost: 0, researchMs: 52000,
    effect: 'unlock_destroyer_queue',
    unlocks: ['Destroyer'],
  }),
  mil_destroyer_torpedoes: node({
    id: 'mil_destroyer_torpedoes', cluster: 'military', name: 'Torpedo Refit',
    prereqs: ['mil_destroyer_unlock'], creditCost: 700, solariiCost: 0, researchMs: 48000,
    effect: 'destroyer_dps_10',
    unlocks: ['Destroyer · Torpedo Refit'],
    effects: [
      { type: 'legacy', id: 'destroyer_dps_10' },
      hullRefit('destroyer', 'torpedo', 'Torpedo Refit'),
    ],
  }),
  mil_frigate_unlock: node({
    id: 'mil_frigate_unlock', cluster: 'military', name: 'Frigate Blueprints',
    prereqs: ['mil_destroyer_unlock'], creditCost: 900, solariiCost: 0, researchMs: 55000,
    effect: 'unlock_frigate_queue',
    unlocks: ['Frigate'],
  }),
  mil_frigate_alloy: node({
    id: 'mil_frigate_alloy', cluster: 'military', name: 'Armor Alloy',
    prereqs: ['mil_frigate_unlock'], creditCost: 750, solariiCost: 0, researchMs: 48000,
    effect: 'frigate_hp_10',
    unlocks: ['Frigate · Armor Alloy'],
    effects: [
      { type: 'legacy', id: 'frigate_hp_10' },
      hullRefit('frigate', 'alloy', 'Armor Alloy'),
    ],
  }),
  mil_point_defense: node({
    id: 'mil_point_defense', cluster: 'military', name: 'Point Defense Grid',
    prereqs: ['mil_patrol_cutter', 'mil_destroyer_unlock'], creditCost: 650, solariiCost: 0, researchMs: 45000,
    effect: 'point_defense_20',
    unlocks: ['Point defense +20%'],
    effects: [{ type: 'legacy', id: 'unlock_destroyer_aa' }],
  }),
  mil_healer_tech: node({
    id: 'mil_healer_tech', cluster: 'military', name: 'Field Medics',
    prereqs: ['mil_parallel_dock'], creditCost: 500, solariiCost: 0, researchMs: 42000,
    effect: 'healer_repair_10',
    unlocks: ['Healer repair +10%'],
  }),
  mil_healer_hospital: node({
    id: 'mil_healer_hospital', cluster: 'military', name: 'Field Hospital',
    prereqs: ['mil_healer_tech'], creditCost: 700, solariiCost: 0, researchMs: 48000,
    effect: 'healer_repair_15',
    unlocks: ['Healer · Field Hospital'],
    effects: [
      { type: 'legacy', id: 'healer_repair_15' },
      hullRefit('healer', 'hospital', 'Field Hospital'),
    ],
  }),
  mil_sensor_ship: node({
    id: 'mil_sensor_ship', cluster: 'military', name: 'Sensor Ships',
    prereqs: ['mil_healer_tech'], creditCost: 600, solariiCost: 0, researchMs: 45000,
    effect: 'unlock_sensor_ship',
    unlocks: ['Sensor ship'],
  }),
  mil_light_carrier: node({
    id: 'mil_light_carrier', cluster: 'military', name: 'Light Carrier',
    prereqs: ['mil_frigate_unlock'], creditCost: 1100, solariiCost: 1, researchMs: 60000,
    effect: 'unlock_light_carrier_queue',
    unlocks: ['Light carrier', 'Basic wings'],
    effects: [
      { type: 'legacy', id: 'unlock_light_carrier_queue' },
      { type: 'legacy', id: 'carrier_wings' },
    ],
  }),
  mil_carrier_hangar: node({
    id: 'mil_carrier_hangar', cluster: 'military', name: 'Hangar Expansion',
    prereqs: ['mil_light_carrier'], creditCost: 900, solariiCost: 1, researchMs: 52000,
    effect: 'carrier_dps_10',
    unlocks: ['Carrier · Hangar Expansion'],
    effects: [
      multiply('carrierWingCapacityMult', 1.25),
      hullRefit('light_carrier', 'hangar', 'Hangar Expansion'),
    ],
  }),
  mil_fleet_carrier: node({
    id: 'mil_fleet_carrier', cluster: 'military', name: 'Fleet Carrier',
    prereqs: ['mil_light_carrier', 'mega_dyson_maturity'], creditCost: 1600, solariiCost: 2, researchMs: 70000,
    effect: 'unlock_fleet_carrier_queue',
    unlocks: ['Fleet carrier'],
  }),
  mil_carrier_bombers: node({
    id: 'mil_carrier_bombers', cluster: 'military', name: 'Bomber Wings',
    prereqs: ['mil_fleet_carrier'], creditCost: 1200, solariiCost: 2, researchMs: 60000,
    effect: 'bomber_damage_20',
    unlocks: ['Carrier · Bomber Wings'],
    effects: [
      { type: 'legacy', id: 'bomber_damage_20' },
      hullRefit('fleet_carrier', 'bombers', 'Bomber Wings'),
    ],
  }),
  mil_cruiser_unlock: node({
    id: 'mil_cruiser_unlock', cluster: 'military', name: 'Cruiser Blueprints',
    prereqs: ['mil_frigate_unlock'], creditCost: 1200, solariiCost: 1, researchMs: 62000,
    effect: 'unlock_cruiser_queue',
    unlocks: ['Cruiser'],
  }),
  mil_cruiser_beams: node({
    id: 'mil_cruiser_beams', cluster: 'military', name: 'Beam Lance Refit',
    prereqs: ['mil_cruiser_unlock'], creditCost: 1000, solariiCost: 1, researchMs: 55000,
    effect: 'beam_damage_15',
    unlocks: ['Cruiser · Beam Lance'],
    effects: [
      { type: 'legacy', id: 'beam_damage_15' },
      hullRefit('cruiser', 'beam', 'Beam Lance Refit'),
    ],
  }),
  mil_command_cruiser: node({
    id: 'mil_command_cruiser', cluster: 'military', name: 'Command Cruiser',
    prereqs: ['mil_cruiser_unlock', 'res_lab_2'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'unlock_command_cruiser',
    unlocks: ['Command cruiser'],
  }),
  mil_battleship_unlock: node({
    id: 'mil_battleship_unlock', cluster: 'military', name: 'Battleship Hulls',
    prereqs: ['mil_cruiser_unlock', 'eco_sector_capitals'], creditCost: 1800, solariiCost: 3, researchMs: 75000,
    effect: 'unlock_battleship_queue',
    unlocks: ['Battleship'],
  }),
  mil_battleship_siege: node({
    id: 'mil_battleship_siege', cluster: 'military', name: 'Siege Refit',
    prereqs: ['mil_battleship_unlock'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'battleship_dps_10',
    unlocks: ['Battleship · Siege Refit'],
    effects: [
      { type: 'legacy', id: 'battleship_dps_10' },
      hullRefit('battleship', 'siege', 'Siege Refit'),
    ],
  }),
  mil_dreadnought_unlock: node({
    id: 'mil_dreadnought_unlock', cluster: 'military', name: 'Dreadnought',
    prereqs: ['mil_battleship_unlock', 'mil_battleship_siege'], creditCost: 2400, solariiCost: 4, researchMs: 90000,
    effect: 'unlock_dreadnought_queue',
    unlocks: ['Dreadnought'],
  }),
  mil_dreadnought_plate: node({
    id: 'mil_dreadnought_plate', cluster: 'military', name: 'Sovereign Plate',
    prereqs: ['mil_dreadnought_unlock'], creditCost: 2000, solariiCost: 4, researchMs: 80000,
    effect: 'fleet_damage_10',
    unlocks: ['Dreadnought · Sovereign Plate'],
    effects: [
      multiply('fleetDamageMult', 1.1),
      hullRefit('dreadnought', 'plate', 'Sovereign Plate'),
    ],
  }),
  mil_super_carrier: node({
    id: 'mil_super_carrier', cluster: 'military', name: 'Super Carrier',
    prereqs: ['mil_fleet_carrier', 'mega_launcher_cadence'], creditCost: 2800, solariiCost: 5, researchMs: 95000,
    effect: 'unlock_super_carrier_queue',
    unlocks: ['Super carrier'],
  }),
  mil_drydock: node({
    id: 'mil_drydock', cluster: 'military', name: 'Orbital Drydocks',
    prereqs: ['mil_parallel_dock'], creditCost: 800, solariiCost: 0, researchMs: 50000,
    effect: 'unlock_drydock',
    unlocks: ['Drydock'],
  }),
  mil_orbital_defense: node({
    id: 'mil_orbital_defense', cluster: 'military', name: 'Orbital Defense',
    prereqs: ['mil_parallel_dock'], creditCost: 750, solariiCost: 0, researchMs: 48000,
    effect: 'unlock_orbital_defense',
    unlocks: ['Orbital defense'],
  }),
  mil_shield_generator: node({
    id: 'mil_shield_generator', cluster: 'military', name: 'Planetary Shields',
    prereqs: ['mil_orbital_defense', 'mega_dyson_maturity'], creditCost: 1100, solariiCost: 2, researchMs: 58000,
    effect: 'unlock_planetary_shield',
    unlocks: ['Planetary shield'],
  }),
  mil_ion_battery: node({
    id: 'mil_ion_battery', cluster: 'military', name: 'Ion Batteries',
    prereqs: ['mil_orbital_defense'], creditCost: 900, solariiCost: 1, researchMs: 52000,
    effect: 'unlock_ion_battery',
    unlocks: ['Ion battery'],
  }),
  mil_fighter_factory: node({
    id: 'mil_fighter_factory', cluster: 'military', name: 'Fighter Factories',
    prereqs: ['mil_light_carrier'], creditCost: 1000, solariiCost: 1, researchMs: 55000,
    effect: 'unlock_fighter_factory',
    unlocks: ['Fighter factory'],
  }),
  mil_carrier_command: node({
    id: 'mil_carrier_command', cluster: 'military', name: 'Carrier Command',
    prereqs: ['mil_fleet_carrier'], creditCost: 1300, solariiCost: 2, researchMs: 62000,
    effect: 'unlock_carrier_command',
    unlocks: ['Carrier command'],
    effects: [unlockStructure('carrier_command')],
  }),
  mil_fleet_academy: node({
    id: 'mil_fleet_academy', cluster: 'military', name: 'Fleet Academy',
    prereqs: ['mil_cruiser_unlock', 'res_lab_2'], creditCost: 1200, solariiCost: 2, researchMs: 60000,
    effect: 'unlock_fleet_academy',
    unlocks: ['Fleet academy'],
    effects: [unlockStructure('fleet_academy'), multiply('veterancyExperienceMult', 1.25)],
  }),
  mil_missile_silo_network: node({
    id: 'mil_missile_silo_network', cluster: 'military', name: 'Missile Silos',
    prereqs: ['mil_shield_generator'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'unlock_missile_silo',
    unlocks: ['Missile silo'],
    effects: [unlockStructure('missile_silo')],
  }),
  mil_gravitic_interdiction: node({
    id: 'mil_gravitic_interdiction', cluster: 'military', name: 'Gravitic Interdiction',
    prereqs: ['mil_ion_battery', 'wh_stable_gate'], creditCost: 1800, solariiCost: 3, researchMs: 75000,
    effect: 'unlock_interdiction_array',
    unlocks: ['Interdiction array'],
    effects: [unlockStructure('interdiction_array')],
  }),
  mil_orbital_sensor_arrays: node({
    id: 'mil_orbital_sensor_arrays', cluster: 'military', name: 'Sensor Arrays',
    prereqs: ['mil_sensor_ship', 'res_lab_2'], creditCost: 1000, solariiCost: 1, researchMs: 55000,
    effect: 'unlock_sensor_array',
    unlocks: ['Orbital sensor array'],
    effects: [unlockStructure('sensor_array')],
  }),
  mil_builder_ship: node({
    id: 'mil_builder_ship', cluster: 'military', name: 'Builder Ships',
    prereqs: ['eco_construction_drones', 'mil_parallel_dock'], creditCost: 800, solariiCost: 0, researchMs: 50000,
    effect: 'unlock_builder_ship',
    unlocks: ['Builder ship'],
  }),
  mil_tri_dock: node({
    id: 'mil_tri_dock', cluster: 'military', name: 'Tri-Stream Docking',
    prereqs: ['mil_parallel_dock', 'mega_dyson_maturity'], creditCost: 1300, solariiCost: 2, researchMs: 62000,
    effect: 'shipyard_slots_3',
    unlocks: ['Shipyard slots ×3'],
  }),
  mil_war_doctrine: node({
    id: 'mil_war_doctrine', cluster: 'military', name: 'War Doctrine',
    prereqs: ['mil_cruiser_unlock', 'eco_sector_capitals'], creditCost: 1500, solariiCost: 2, researchMs: 70000,
    effect: 'capture_force_1',
    unlocks: ['Capture force +1'],
  }),

  // ═══ LOWER: Research / Wormhole (fork launcher → merge cradle) ═══
  res_lab_1: node({
    id: 'res_lab_1', cluster: 'research', name: 'Lab Protocols I',
    prereqs: ['eco_surveyor'], creditCost: 400, solariiCost: 0, researchMs: 40000,
    effect: 'research_speed_10',
    unlocks: ['Research speed +10%'],
  }),
  res_station_protocol: node({
    id: 'res_station_protocol', cluster: 'research', name: 'Research Station',
    prereqs: ['res_lab_1', 'mega_launcher_unlock'], creditCost: 700, solariiCost: 0, researchMs: 50000,
    effect: 'unlock_research_station',
    description: 'Unlocks research stations. Merges into Cradle Frame.',
    tags: ['research', 'merge'],
    unlocks: ['Research station'],
  }),
  res_lab_2: node({
    id: 'res_lab_2', cluster: 'research', name: 'Lab Protocols II',
    prereqs: ['res_station_protocol'], creditCost: 900, solariiCost: 1, researchMs: 55000,
    effect: 'research_speed_15',
    unlocks: ['Research speed +15%'],
  }),
  res_dual_core: node({
    id: 'res_dual_core', cluster: 'research', name: 'Dual Research Core',
    prereqs: ['res_lab_2'], creditCost: 1200, solariiCost: 2, researchMs: 60000,
    effect: 'research_queue_2',
    unlocks: ['Research queue ×2'],
  }),
  res_queue_3: node({
    id: 'res_queue_3', cluster: 'research', name: 'Tri-Core Research',
    prereqs: ['res_dual_core', 'eco_sector_capitals'], creditCost: 1800, solariiCost: 3, researchMs: 75000,
    effect: 'research_queue_3',
    unlocks: ['Research queue ×3'],
  }),
  res_quantum_archives: node({
    id: 'res_quantum_archives', cluster: 'research', name: 'Quantum Archives',
    prereqs: ['res_dual_core'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'unlock_quantum_archive',
    unlocks: ['Quantum archive'],
    effects: [unlockStructure('quantum_archive')],
  }),
  wh_nav_beacon: node({
    id: 'wh_nav_beacon', cluster: 'wormhole', name: 'Nav Beacons',
    prereqs: ['res_lab_1'], creditCost: 500, solariiCost: 0, researchMs: 42000,
    effect: 'intel_hop_1',
    unlocks: ['Intel hop +1'],
  }),
  wh_scout_range: node({
    id: 'wh_scout_range', cluster: 'wormhole', name: 'Extended Sensors',
    prereqs: ['wh_nav_beacon', 'mega_launcher_unlock'], creditCost: 650, solariiCost: 0, researchMs: 48000,
    effect: 'intel_hop_2',
    unlocks: ['Intel hop +2'],
  }),
  wh_observatory: node({
    id: 'wh_observatory', cluster: 'wormhole', name: 'Wormhole Observatory',
    prereqs: ['wh_scout_range', 'res_lab_2'], creditCost: 1100, solariiCost: 2, researchMs: 58000,
    effect: 'unlock_wormhole_observatory',
    unlocks: ['Wormhole observatory'],
    effects: [unlockStructure('wormhole_observatory')],
  }),
  wh_stable_gate: node({
    id: 'wh_stable_gate', cluster: 'wormhole', name: 'Stable Gate Theory',
    prereqs: ['wh_scout_range', 'res_lab_2'], creditCost: 1200, solariiCost: 2, researchMs: 60000,
    effect: 'anchor_cost_25',
    unlocks: ['Anchor cost −25%'],
  }),
  wh_fleet_jump: node({
    id: 'wh_fleet_jump', cluster: 'wormhole', name: 'Fleet Jump Doctrine',
    prereqs: ['wh_stable_gate', 'mil_frigate_unlock'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'wormhole_transit_10',
    unlocks: ['Fleet wormhole transit +10%'],
  }),
  wh_anchor_network: node({
    id: 'wh_anchor_network', cluster: 'wormhole', name: 'Anchor Network',
    prereqs: ['wh_stable_gate', 'eco_sector_capitals'], creditCost: 1600, solariiCost: 3, researchMs: 70000,
    effect: 'anchor_network',
    unlocks: ['Anchor network capacity'],
    effects: [add('anchorNetworkCapacityBonus', 2), multiply('wormholeChargeRateMult', 1.15)],
  }),

  // ═══ Diplomacy (fork maturity → merge cradle) ═══
  dip_truce_protocol: node({
    id: 'dip_truce_protocol', cluster: 'diplomacy', name: 'Truce Protocol',
    prereqs: ['mega_dyson_maturity'], creditCost: 1000, solariiCost: 1, researchMs: 55000,
    effect: 'unlock_diplomacy',
    description: 'Opens diplomacy. Merges into Cradle Frame.',
    tags: ['diplomacy', 'merge'],
    unlocks: ['Truce treaties'],
    requiresDiplomacy: true,
  }),
  dip_trade_charter: node({
    id: 'dip_trade_charter', cluster: 'diplomacy', name: 'Trade Charter',
    prereqs: ['dip_truce_protocol'], creditCost: 1200, solariiCost: 2, researchMs: 60000,
    effect: 'diplomacy_trade',
    unlocks: ['Trade treaties'],
    requiresDiplomacy: true,
  }),
  dip_embassy_network: node({
    id: 'dip_embassy_network', cluster: 'diplomacy', name: 'Embassy Network',
    prereqs: ['dip_trade_charter'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'diplomacy_trade_bonus',
    unlocks: ['Embassy network'],
    requiresDiplomacy: true,
  }),
  dip_embassy_complex: node({
    id: 'dip_embassy_complex', cluster: 'diplomacy', name: 'Embassy Complex',
    prereqs: ['dip_embassy_network'], creditCost: 1600, solariiCost: 3, researchMs: 70000,
    effect: 'unlock_embassy_complex',
    unlocks: ['Embassy complex'],
    effects: [unlockStructure('embassy_complex')],
    requiresDiplomacy: true,
  }),
  dip_alliance_pact: node({
    id: 'dip_alliance_pact', cluster: 'diplomacy', name: 'Alliance Pact',
    prereqs: ['dip_trade_charter', 'mil_war_doctrine'], creditCost: 2000, solariiCost: 4, researchMs: 80000,
    effect: 'diplomacy_alliance',
    unlocks: ['Alliance treaties'],
    requiresDiplomacy: true,
  }),
  dip_galactic_council: node({
    id: 'dip_galactic_council', cluster: 'diplomacy', name: 'Galactic Council',
    prereqs: ['dip_embassy_complex', 'sw_novacula_online'], creditCost: 3000, solariiCost: 6, researchMs: 100000,
    effect: 'galactic_council',
    unlocks: ['Galactic council'],
    effects: [set('galacticCouncil')],
    requiresDiplomacy: true,
    requiresSuperweapon: true,
  }),

  // ═══ Mode skeletons (fork focus → merge Novacula) ═══
  sw_create_star: node({
    id: 'sw_create_star', cluster: 'superweapon', name: 'Genesis Skeleton',
    prereqs: ['sw_precision_targeting'], creditCost: 0, solariiCost: 8, researchMs: 90000,
    effect: 'superweapon_create',
    description: 'Create-mode skeleton — install on the cradle to enable stellar genesis.',
    unlocks: ['Create mode blueprint'],
    effects: [swPart('create'), { type: 'legacy', id: 'superweapon_create' }],
    requiresSuperweapon: true,
  }),
  sw_destroy_star: node({
    id: 'sw_destroy_star', cluster: 'superweapon', name: 'Annihilation Skeleton',
    prereqs: ['sw_create_star'], creditCost: 0, solariiCost: 10, researchMs: 100000,
    effect: 'superweapon_destroy',
    description: 'Destroy-mode skeleton — install to enable stellar annihilation.',
    unlocks: ['Destroy mode blueprint'],
    effects: [swPart('destroy'), { type: 'legacy', id: 'superweapon_destroy' }],
    requiresSuperweapon: true,
  }),
  sw_jump_gate: node({
    id: 'sw_jump_gate', cluster: 'superweapon', name: 'Jump Skeleton',
    prereqs: ['sw_precision_targeting', 'wh_fleet_jump'], creditCost: 1800, solariiCost: 6, researchMs: 85000,
    effect: 'superweapon_jump',
    description: 'Jump-mode skeleton — install to relocate the cradle.',
    unlocks: ['Jump mode blueprint'],
    effects: [swPart('jump'), { type: 'legacy', id: 'superweapon_jump' }],
    requiresSuperweapon: true,
  }),

  // ═══ Hull Forge (mid-game flagship stages — own layout lane) ═══
  fs_hull_frame: node({
    id: 'fs_hull_frame', cluster: 'flagship', name: 'Reinforced Frame',
    prereqs: ['mil_parallel_dock'], creditCost: 600, solariiCost: 0, researchMs: 42000,
    effect: 'flagship_hull_frame',
    description: 'Hull Forge stage 1. Reinforced flagship frame and fleet plating doctrine.',
    unlocks: ['Flagship Mk I armor · +12% hull', 'Fleet hull +5% HP'],
    effects: [
      flagshipHullStage(1),
      flagshipUpgrade('frame', 'Reinforced Frame'),
      multiply('flagshipHpMult', 1.12),
      multiply('fleetHpMult', 1.05),
    ],
  }),
  fs_hull_drives: node({
    id: 'fs_hull_drives', cluster: 'flagship', name: 'Drive Lattice',
    prereqs: ['fs_hull_frame'], creditCost: 800, solariiCost: 0, researchMs: 48000,
    effect: 'flagship_hull_drives',
    description: 'Hull Forge stage 2. Drive lattice and escort wing readiness.',
    unlocks: ['Flagship Mk II drives · +12% speed', 'Wing capacity +8%'],
    effects: [
      flagshipHullStage(2),
      flagshipUpgrade('drives', 'Drive Lattice'),
      multiply('flagshipSpeedMult', 1.12),
      multiply('carrierWingCapacityMult', 1.08),
    ],
  }),
  fs_hull_arsenal: node({
    id: 'fs_hull_arsenal', cluster: 'flagship', name: 'Arsenal Hardpoints',
    prereqs: ['fs_hull_drives', 'mega_dyson_maturity'], creditCost: 1100, solariiCost: 1, researchMs: 55000,
    effect: 'flagship_hull_arsenal',
    description: 'Hull Forge stage 3. Capital hardpoints and lance mounts.',
    unlocks: ['Flagship Mk III arsenal · +15% DPS', 'Hardpoint batteries'],
    effects: [
      flagshipHullStage(3),
      flagshipUpgrade('arsenal', 'Arsenal Hardpoints'),
      multiply('flagshipDpsMult', 1.15),
    ],
  }),
  fs_hull_command: node({
    id: 'fs_hull_command', cluster: 'flagship', name: 'Command Lattice',
    prereqs: ['fs_hull_arsenal', 'res_lab_2'], creditCost: 1400, solariiCost: 2, researchMs: 65000,
    effect: 'flagship_hull_command',
    description: 'Hull Forge stage 4. Command lattice and capture aura.',
    unlocks: ['Flagship Mk IV command · +15% aura', 'Capture force bonus'],
    effects: [
      flagshipHullStage(4),
      flagshipUpgrade('command_lattice', 'Command Lattice'),
      multiply('flagshipCommandMult', 1.15),
    ],
  }),
  fs_hull_sovereign: node({
    id: 'fs_hull_sovereign', cluster: 'flagship', name: 'Sovereign Hull',
    prereqs: ['fs_hull_command', 'eco_sector_capitals'], creditCost: 1800, solariiCost: 3, researchMs: 75000,
    effect: 'flagship_hull_sovereign',
    description: 'Hull Forge stage 5. Full sovereign cladding — gates late Flagship protocols.',
    unlocks: ['Flagship Mk V sovereign · +20% hull', 'Fleet damage +5%'],
    effects: [
      flagshipHullStage(5),
      flagshipUpgrade('sovereign', 'Sovereign Hull'),
      multiply('flagshipHpMult', 1.2),
      multiply('fleetDamageMult', 1.05),
    ],
  }),

  // ═══ Flagship upgrades (fork power → merge Novacula) ═══
  hero_arsenal: node({
    id: 'hero_arsenal', cluster: 'flagship', name: 'Arsenal Suite',
    prereqs: ['fs_hull_arsenal', 'sw_cradle_power_core', 'mil_command_cruiser'],
    creditCost: 1600, solariiCost: 3, researchMs: 70000,
    effect: 'flagship_arsenal',
    unlocks: ['Late arsenal suite · weapon range'],
    effects: [
      flagshipUpgrade('arsenal_suite', 'Arsenal Suite'),
      multiply('weaponRangeMult', 1.1),
    ],
    requiresSuperweapon: true,
  }),
  hero_wing_bay: node({
    id: 'hero_wing_bay', cluster: 'flagship', name: 'Wing Bay',
    prereqs: ['hero_arsenal'], creditCost: 1700, solariiCost: 3, researchMs: 72000,
    effect: 'flagship_wing_bay',
    unlocks: ['Flagship wing bay'],
    effects: [flagshipUpgrade('wing', 'Wing Bay'), multiply('carrierWingCapacityMult', 1.1)],
    requiresSuperweapon: true,
  }),
  hero_hull_unlock: node({
    id: 'hero_hull_unlock', cluster: 'flagship', name: 'Hero Flagship Protocol',
    prereqs: ['hero_wing_bay', 'sw_cradle_unlock', 'fs_hull_sovereign'],
    creditCost: 2200, solariiCost: 5, researchMs: 85000,
    effect: 'unlock_hero_flagship',
    unlocks: ['Hero flagship'],
    effects: [
      { type: 'legacy', id: 'unlock_hero_flagship' },
      flagshipUpgrade('hero_hull', 'Hero Hull'),
    ],
    requiresSuperweapon: true,
  }),
  hero_rally_doctrine: node({
    id: 'hero_rally_doctrine', cluster: 'flagship', name: 'Rally Doctrine',
    prereqs: ['hero_hull_unlock'], creditCost: 1600, solariiCost: 3, researchMs: 70000,
    effect: 'hero_rally_bonus',
    unlocks: ['Hero rally'],
    requiresSuperweapon: true,
  }),
  hero_plate: node({
    id: 'hero_plate', cluster: 'flagship', name: 'Hero Plate',
    prereqs: ['hero_hull_unlock'], creditCost: 1800, solariiCost: 4, researchMs: 75000,
    effect: 'flagship_plate',
    unlocks: ['Hero flagship plate'],
    effects: [
      flagshipUpgrade('plate', 'Hero Plate'),
      multiply('defensePowerMult', 1.05),
    ],
    requiresSuperweapon: true,
  }),
  hero_command_suite: node({
    id: 'hero_command_suite', cluster: 'flagship', name: 'Command Suite',
    prereqs: ['hero_plate', 'hero_rally_doctrine', 'mil_war_doctrine'], creditCost: 2200, solariiCost: 5, researchMs: 85000,
    effect: 'hero_combat_bonus',
    description: 'Command suite. Merges into Novacula Online.',
    tags: ['flagship', 'merge'],
    unlocks: ['Flagship command suite'],
    effects: [
      { type: 'legacy', id: 'hero_combat_bonus' },
      flagshipUpgrade('command', 'Command Suite'),
    ],
    requiresSuperweapon: true,
  }),
};

/** Old tech IDs → nearest kept node (save migration). */
export const TECH_ID_MIGRATION = Object.freeze({
  eco_outpost_2: 'eco_surveyor',
  eco_outpost_3: 'eco_surveyor',
  eco_moon_rights: 'eco_miner_hull',
  eco_shipyard_bureau: 'mil_parallel_dock',
  eco_credits_surge: 'eco_sector_capitals',
  eco_industrial_chain: 'eco_industrial_automation',
  eco_zero_waste_industry: 'eco_industrial_automation',
  eco_habitat_network: 'eco_orbital_habitats',
  eco_finance_hub: 'trade_galactic_exchange',
  mega_foundry_2: 'mega_foundry_output',
  mega_foundry_3: 'mega_foundry_output',
  mega_sail_weave: 'mega_foundry_output',
  mega_launcher_rate: 'mega_launcher_cadence',
  mega_shell_matrix: 'mega_shell_ops',
  mega_shell_harmonic: 'mega_shell_ops',
  mega_solarii_boost: 'mega_solar_collectors',
  mega_dyson_overdrive: 'mega_dyson_maturity',
  mega_dual_launcher: 'mega_launcher_cadence',
  mega_ascendant_engineering: 'mega_dyson_maturity',
  mega_stellar_lattice: 'mega_dyson_maturity',
  mil_corvette_2: 'mil_corvette_hardening',
  mil_torpedo_bays: 'mil_destroyer_torpedoes',
  mil_armor_alloy: 'mil_frigate_alloy',
  mil_kinetic_batteries: 'mil_frigate_alloy',
  mil_hangar_deck: 'mil_carrier_hangar',
  mil_carrier_launch_doctrine: 'mil_light_carrier',
  mil_bomber_bays: 'mil_carrier_bombers',
  mil_beam_lances: 'mil_cruiser_beams',
  mil_siege_platform: 'mil_battleship_siege',
  mil_field_hospital: 'mil_healer_hospital',
  mil_interceptor_screens: 'mil_point_defense',
  mil_integrated_fire_control: 'sw_precision_targeting',
  mil_fortress_worlds: 'mil_missile_silo_network',
  trade_tariff_law: 'eco_trade_hub',
  trade_market_2: 'trade_route_opt',
  trade_galactic_net: 'trade_galactic_exchange',
  res_station_2: 'res_lab_2',
  res_lab_3: 'res_lab_2',
  res_archivist: 'res_dual_core',
  wh_probe_swarm: 'wh_scout_range',
  wh_anchor_discount: 'wh_stable_gate',
  wh_core_mapping: 'wh_scout_range',
  wh_mass_transit: 'wh_anchor_network',
  wh_empire_relay: 'wh_anchor_network',
  wh_route_prediction: 'wh_fleet_jump',
  wh_quantum_corridors: 'wh_anchor_network',
  wh_interdiction_field: 'mil_gravitic_interdiction',
  dip_defense_compact: 'dip_alliance_pact',
  dip_trade_charter_old: 'dip_trade_charter',
  hero_command_aura: 'hero_command_suite',
  hero_mobile_shipyard: 'hero_command_suite',
  hero_wormhole_compass: 'hero_command_suite',
  hero_diplomatic_mandate: 'hero_command_suite',
  hero_sovereign_core: 'hero_command_suite',
  sw_sovereign_protocol: 'sw_novacula_online',
  sw_genesis_matrix: 'sw_create_star',
  sw_gate_array: 'sw_jump_gate',
  sw_cradle_power_core_old: 'sw_cradle_power_core',
});

function humanizeEffect(effect) {
  if (!effect || effect === 'seed') return 'Technology web foundation';
  return effect
    .replace(/^unlock_/, 'Unlock ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

for (const tech of Object.values(TECH_NODES)) {
  tech.effects ??= tech.effect ? [{ type: 'legacy', id: tech.effect }] : [];
  tech.description ??= `${tech.name} advances the ${tech.cluster} technology branch.`;
  tech.tags ??= [tech.cluster, ...String(tech.effect ?? '').split('_').filter(Boolean)];
  if (tech.spine && !tech.tags.includes('spine')) tech.tags.push('spine');
  tech.unlocks ??= [humanizeEffect(tech.effect)];
  tech.milestones ??= [
    ...(tech.requiresDiplomacy ? ['diplomacy'] : []),
    ...(tech.requiresSuperweapon ? ['superweapon'] : []),
  ];
}

function rawDerivedTier(nodeId, memo = new Map(), visiting = new Set()) {
  if (memo.has(nodeId)) return memo.get(nodeId);
  const tech = TECH_NODES[nodeId];
  if (!tech) return 0;
  if (visiting.has(nodeId)) throw new Error(`Technology cycle encountered at ${nodeId}`);
  visiting.add(nodeId);
  const tier = tech.prereqs.length === 0
    ? 1
    : 1 + Math.max(...tech.prereqs.map((id) => rawDerivedTier(id, memo, visiting)));
  visiting.delete(nodeId);
  memo.set(nodeId, tier);
  return tier;
}

const tierMemo = new Map();
for (const tech of Object.values(TECH_NODES)) {
  if (tech.creditCost > 0 || tech.researchMs > 0) continue;
  if (tech.id === 'eco_baseline') continue;
  const tier = rawDerivedTier(tech.id, tierMemo);
  const cost = v13TechCostsForTier(tier);
  if (!tech.creditCost) tech.creditCost = cost.credits;
  if (tech.solariiCost == null) tech.solariiCost = cost.solarii;
  if (!tech.researchMs) tech.researchMs = cost.researchMs;
  tech.costTier = tier;
}

export const V13_TECH_NODE_IDS = Object.freeze(
  Object.values(TECH_NODES)
    .filter((tech) => tech.introducedIn === 13)
    .map((tech) => tech.id),
);

export function isSpineTech(nodeOrId) {
  const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId?.id;
  return TECH_SPINE_IDS.includes(id) || !!TECH_NODES[id]?.spine;
}
