// Focused v13 technology-web verification.

import {
  TECH_GRAPH_VALIDATION,
  TECH_NODES,
  V13_TECH_NODE_IDS,
  allTechNodes,
  derivedTier,
  nodeEffectDescriptors,
  techEffects,
  techNodeCount,
  v13TechCostsForTier,
  validateTechGraph,
} from '../src/js/tech-web.js';

const results = [];
const check = (name, condition, detail = '') => {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const EXPECTED_NEW_NAMES = {
  economy: [
    'Power Grid', 'Orbital Habitats', 'Habitat Network',
    'Nanoforges', 'Industrial Automation', 'Zero-Waste Industry',
    'Outpost Administration', 'Sector Capitals', 'Imperial Provisioning',
  ],
  military: [
    'Fleet Academy', 'Veteran Corps', 'Missile Silo Network', 'Fortress Worlds',
    'Total-War Infrastructure', 'Gravitic Interdiction', 'Carrier Command',
    'Squadron Coordination', 'Orbital Sensor Arrays', 'Integrated Fire Control',
  ],
  megastructure: [
    'Solar Collectors', 'Collector Swarms', 'Foundry Refits', 'Stellar Forge',
    'Launcher Synchronization', 'Stellar Lattice', 'Ascendant Engineering',
  ],
  trade: [
    'Logistics Hubs', 'Predictive Dispatch', 'Galactic Exchange', 'Freeport Network',
    'Quantum Markets', 'Cargo Insurance', 'Salvage Doctrine',
  ],
  wormhole: [
    'Wormhole Observatory', 'Route Prediction', 'Anchor Network',
    'Interdiction Field', 'Mass Transit', 'Quantum Corridors',
  ],
  research: [
    'Quantum Archives', 'Data Redundancy', 'Applied Sciences',
    'Combat Analytics', 'Social Prediction', 'Singularity Institute',
  ],
  diplomacy: [
    'Embassy Complex', 'Cultural Exchange', 'Joint Logistics',
    'Defense Compact', 'Galactic Council',
  ],
  flagship: [
    'Command Suite', 'Mobile Shipyard', 'Wormhole Compass',
    'Diplomatic Mandate', 'Sovereign Core',
  ],
  superweapon: [
    'Cradle Power Core', 'Precision Targeting', 'Genesis Matrix',
    'Gate Array', 'Sovereign Protocol',
  ],
};

const REQUIRED_PREREQS = {
  eco_orbital_habitats: ['eco_power_grid', 'wh_nav_beacon'],
  eco_habitat_network: ['eco_orbital_habitats', 'trade_galactic_net'],
  eco_nanoforges: ['res_lab_2'],
  eco_industrial_automation: ['eco_nanoforges', 'mega_auto_sail'],
  eco_zero_waste_industry: ['eco_industrial_automation', 'mega_dyson_overdrive'],
  eco_sector_capitals: ['eco_outpost_administration', 'eco_finance_hub', 'mil_command_cruiser'],
  eco_imperial_provisioning: ['eco_sector_capitals', 'dip_embassy_network'],
  mil_veteran_corps: ['mil_fleet_academy', 'mil_command_cruiser'],
  mil_fortress_worlds: ['mil_missile_silo_network', 'mil_shield_generator'],
  mil_total_war_infrastructure: ['mil_fortress_worlds', 'mil_war_doctrine', 'mil_super_carrier'],
  mil_gravitic_interdiction: ['mil_ion_disruptors', 'wh_stable_gate'],
  mil_squadron_coordination: ['mil_carrier_command'],
  mil_integrated_fire_control: ['mil_orbital_sensor_arrays', 'mil_beam_lances'],
  mega_collector_swarms: ['mega_solar_collectors'],
  mega_foundry_refits: ['eco_nanoforges'],
  mega_stellar_forge: ['mega_foundry_refits'],
  mega_launcher_synchronization: ['mil_integrated_fire_control'],
  mega_stellar_lattice: ['mega_shell_harmonic'],
  mega_ascendant_engineering: ['mega_stellar_lattice', 'res_ai_core', 'mega_dyson_overdrive'],
  trade_logistics_hubs: ['eco_storage_depot'],
  trade_predictive_dispatch: ['trade_logistics_hubs'],
  trade_galactic_exchange: ['eco_finance_hub'],
  trade_freeport_network: ['trade_galactic_exchange', 'dip_embassy_complex'],
  trade_quantum_markets: ['trade_freeport_network', 'wh_empire_relay'],
  trade_cargo_insurance: ['trade_armored_convoy'],
  trade_salvage_doctrine: ['trade_cargo_insurance', 'mil_drydock'],
  wh_observatory: ['res_lab_2'],
  wh_route_prediction: ['wh_observatory'],
  wh_anchor_network: ['trade_logistics_hubs'],
  wh_interdiction_field: ['wh_anchor_network', 'mil_gravitic_interdiction'],
  wh_mass_transit: ['trade_bulk_freighter'],
  wh_quantum_corridors: ['wh_mass_transit', 'wh_empire_relay', 'sw_jump_gate'],
  res_data_redundancy: ['res_quantum_archives', 'wh_observatory'],
  res_applied_sciences: ['eco_nanoforges'],
  res_combat_analytics: ['res_applied_sciences', 'mil_fleet_academy'],
  res_social_prediction: ['res_archivist'],
  res_singularity_institute: ['res_social_prediction', 'mega_stellar_lattice', 'res_ai_core'],
  dip_cultural_exchange: ['dip_embassy_complex', 'res_quantum_archives'],
  dip_joint_logistics: ['dip_cultural_exchange', 'trade_logistics_hubs'],
  dip_defense_compact: ['mil_fortress_worlds'],
  dip_galactic_council: ['dip_defense_compact', 'trade_freeport_network', 'hero_rally_doctrine'],
  hero_mobile_shipyard: ['hero_command_suite', 'eco_nanoforges'],
  hero_wormhole_compass: ['wh_route_prediction'],
  hero_diplomatic_mandate: ['dip_embassy_complex'],
  hero_sovereign_core: ['mega_ascendant_engineering', 'dip_galactic_council'],
  sw_cradle_power_core: ['mega_stellar_lattice'],
  sw_precision_targeting: ['mil_integrated_fire_control'],
  sw_genesis_matrix: ['eco_orbital_habitats'],
  sw_gate_array: ['wh_quantum_corridors'],
  sw_sovereign_protocol: [
    'sw_cradle_power_core', 'sw_precision_targeting', 'sw_genesis_matrix',
    'sw_gate_array', 'hero_sovereign_core',
  ],
};

const EXPECTED_STRUCTURE_TECHS = {
  power_grid: 'eco_power_grid',
  orbital_habitat: 'eco_orbital_habitats',
  nanoforge: 'eco_nanoforges',
  fleet_academy: 'mil_fleet_academy',
  missile_silo: 'mil_missile_silo_network',
  interdiction_array: 'mil_gravitic_interdiction',
  carrier_command: 'mil_carrier_command',
  sensor_array: 'mil_orbital_sensor_arrays',
  solar_collector: 'mega_solar_collectors',
  logistics_hub: 'trade_logistics_hubs',
  galactic_exchange: 'trade_galactic_exchange',
  salvage_yard: 'trade_salvage_doctrine',
  wormhole_observatory: 'wh_observatory',
  quantum_archive: 'res_quantum_archives',
  embassy_complex: 'dip_embassy_complex',
};

check('technology web contains exactly 165 nodes', techNodeCount() === 165, String(techNodeCount()));
check('v13 contributes exactly 60 nodes', V13_TECH_NODE_IDS.length === 60, String(V13_TECH_NODE_IDS.length));
check('startup graph validation succeeds', TECH_GRAPH_VALIDATION.ok, TECH_GRAPH_VALIDATION.errors.join('; '));
check('all nine clusters remain represented', Object.keys(TECH_GRAPH_VALIDATION.clusterCounts).length === 9
  && Object.values(TECH_GRAPH_VALIDATION.clusterCounts).every((count) => count > 0));
check('all nodes are reachable from one baseline root', TECH_GRAPH_VALIDATION.roots.length === 1
  && TECH_GRAPH_VALIDATION.roots[0] === 'eco_baseline', TECH_GRAPH_VALIDATION.roots.join(','));

for (const [cluster, expectedNames] of Object.entries(EXPECTED_NEW_NAMES)) {
  const actualNames = V13_TECH_NODE_IDS
    .map((id) => TECH_NODES[id])
    .filter((node) => node.cluster === cluster)
    .map((node) => node.name);
  check(`${cluster} has the exact planned v13 node names`, expectedNames.length === actualNames.length
    && expectedNames.every((name) => actualNames.includes(name)), actualNames.join(', '));
}

for (const [nodeId, prereqs] of Object.entries(REQUIRED_PREREQS)) {
  check(`${nodeId} includes planned chain and cross prerequisites`, prereqs.every(
    (prereq) => TECH_NODES[nodeId].prereqs.includes(prereq),
  ), TECH_NODES[nodeId].prereqs.join(','));
}

check('every node exposes searchable metadata and normalized effects', allTechNodes().every((node) => (
  typeof node.description === 'string' && node.description.length > 0
  && Array.isArray(node.tags) && node.tags.length > 0
  && Array.isArray(node.unlocks) && node.unlocks.length > 0
  && nodeEffectDescriptors(node).length > 0
)));
check('every legacy effect field remains present', allTechNodes().every((node) => typeof node.effect === 'string'));

check('all v13 costs exactly follow the derived-tier curve', V13_TECH_NODE_IDS.every((id) => {
  const node = TECH_NODES[id];
  const tier = derivedTier(id);
  const expected = v13TechCostsForTier(tier);
  return node.costTier === tier
    && node.creditCost === expected.credits
    && node.solariiCost === expected.solarii
    && node.researchMs === expected.researchMs;
}));
check('existing node costs were retained', TECH_NODES.eco_surveyor.creditCost === 250
  && TECH_NODES.mil_command_cruiser.solariiCost === 3
  && TECH_NODES.sw_destroy_star.researchMs === 110000);
check('derived tiers are stable across repeated memoized queries', V13_TECH_NODE_IDS.every(
  (id) => derivedTier(id) === derivedTier(id),
));

const directUnlockIds = Object.values(EXPECTED_STRUCTURE_TECHS);
const directFx = techEffects({ research: { unlocked: directUnlockIds } });
check('all 15 building unlock descriptors set public flags', Object.values(directFx.structureUnlocks).filter(Boolean).length === 15);
for (const [structure, nodeId] of Object.entries(EXPECTED_STRUCTURE_TECHS)) {
  const descriptor = nodeEffectDescriptors(nodeId).find((effect) => effect.type === 'unlock-structure');
  check(`${nodeId} unlocks ${structure} with operational modifiers`, descriptor?.structure === structure
    && Object.keys(descriptor.modifiers ?? {}).length > 0
    && directFx.structureUnlocks[structure] === true);
}

const allV13Fx = techEffects({ research: { unlocked: V13_TECH_NODE_IDS } });
check('all upgradeable structures reach level III with full v13 research', Object.values(
  allV13Fx.structureLevelCaps,
).every((level) => level === 3));
check('v13 outpost technology changes cargo but not legacy passive-income multiplier',
  allV13Fx.outpostCargoOutputMult > 1 && allV13Fx.outpostIncomeMult === 1,
  `cargo=${allV13Fx.outpostCargoOutputMult}, passive=${allV13Fx.outpostIncomeMult}`);
check('endgame flags aggregate from normalized descriptors', allV13Fx.galacticCouncil
  && allV13Fx.sovereignCore && allV13Fx.sovereignProtocol);

const legacyFx = techEffects({ research: { unlocked: ['mil_destroyer_unlock', 'trade_light_hauler', 'res_queue_3'] } });
check('legacy effect compatibility remains intact', legacyFx.unlockDestroyerQueue
  && legacyFx.unlockLightHauler && legacyFx.researchQueueDepth === 3);

const missingGraph = structuredClone(TECH_NODES);
missingGraph.eco_power_grid.prereqs.push('tech_that_does_not_exist');
const missingValidation = validateTechGraph(missingGraph);
check('validation catches missing prerequisites', !missingValidation.ok
  && missingValidation.errors.some((error) => error.includes('missing prerequisite tech_that_does_not_exist')));

const cycleGraph = structuredClone(TECH_NODES);
cycleGraph.eco_baseline.prereqs.push('sw_sovereign_protocol');
const cycleValidation = validateTechGraph(cycleGraph);
check('validation catches cycles', !cycleValidation.ok
  && cycleValidation.errors.some((error) => error.includes('cycle detected')));

const badEffectGraph = structuredClone(TECH_NODES);
badEffectGraph.eco_power_grid.effects = [{ type: 'quantum-handwave' }];
const badEffectValidation = validateTechGraph(badEffectGraph);
check('validation catches unhandled effect shapes', !badEffectValidation.ok
  && badEffectValidation.errors.some((error) => error.includes('unhandled descriptor type')));

const failed = results.filter((result) => !result.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} v13 technology checks failed.`);
  process.exit(1);
}

console.log(`\n${results.length}/${results.length} v13 technology checks passed.`);
