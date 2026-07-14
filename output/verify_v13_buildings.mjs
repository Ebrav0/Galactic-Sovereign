// Save-v13 building catalog, upgrade, effect, and visual-site verification.

import {
  BODY_STRUCTURE_DEFS,
  NEW_BODY_STRUCTURE_TYPES,
  STRUCTURE_UPGRADE_DEFS,
  bodyStructureBuildRows,
  bodyStructureSummaryRows,
  bodyStructureUpgradeCost,
  buildBodyStructure,
  canBuildBodyStructure,
  canUpgradeBodyStructure,
  isOperationalStructure,
  outpostCargoProductionMultiplier,
  outpostStockCapacity,
  reconcileStructureTechnology,
  structureCargoProductionMultiplier,
  structureDepotCapacityBonus,
  structureDispatchIntervalMultiplier,
  structureEffectValue,
  structureLevel,
  upgradeBodyStructure,
} from '../src/js/body-structures.js';
import { OUTPOST_BASE_INCOME, SAVE_VERSION } from '../src/js/constants.js';
import { outpostSurfaceSites } from '../src/js/surface-structures.js';
import { SURFACE_BUILDING_VISUAL_TYPES } from '../src/js/surface-structures-render.js';
import { starNodeStructureSites, structureSites } from '../src/js/structure-sites.js';
import {
  ORBITAL_BUILDING_VISUAL_TYPES,
  STAR_NODE_BUILDING_VISUAL_TYPES,
} from '../src/js/structure-render.js';

const results = [];
function check(name, condition, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const directTechs = Object.values(BODY_STRUCTURE_DEFS).map((def) => def.tech).filter(Boolean);
const makePlanet = (id, type = 'habitable') => ({
  id,
  kind: 'planet',
  type,
  radius: 30,
  orbitRadius: id === 'p1' ? 1100 : 1800,
  orbitPeriodMs: 200000,
  orbitPhase: 0,
  moons: [],
});
const makeSystem = (id, owner = 'player', starKind = 'star') => ({
  id,
  owner,
  star: { kind: starKind, radius: starKind === 'blackhole' ? 30 : 200 },
  bodies: starKind === 'blackhole' ? [] : [makePlanet('p1'), makePlanet('p2', 'barren')],
  structures: [],
  dyson: { completedShells: 0 },
});

const systems = {
  sol: makeSystem('sol'),
  colony: makeSystem('colony'),
  frontier: makeSystem('frontier'),
  rim: makeSystem('rim'),
  bh: makeSystem('bh', 'neutral', 'blackhole'),
  ai_home: { ...makeSystem('ai_home', 'ai'), factionId: 'f-economic' },
};
const state = {
  time: 1000,
  paused: false,
  activeGalaxyId: 'gal-0',
  homeGalaxyId: 'gal-0',
  stronghold: 'sol',
  credits: 500000,
  research: { unlocked: [...new Set(directTechs)], queue: [] },
  flagship: { galaxyId: 'gal-0', systemId: 'sol', transit: null, wormholeTransit: null },
  playerShips: [],
  galaxies: { 'gal-0': { systems } },
  factions: {
    list: [{
      id: 'f-economic',
      credits: 500000,
      research: { unlocked: [...new Set(directTechs)] },
      structureLevelCaps: Object.fromEntries(Object.keys(STRUCTURE_UPGRADE_DEFS).map((type) => [type, 3])),
    }],
  },
};
const buildNow = (systemId, bodyId, type) =>
  buildBodyStructure(state, systemId, bodyId, type, { immediate: true });

const outpost = { id: 'outpost-1', type: 'outpost', bodyId: 'p1', level: 1, hp: 200, maxHp: 200 };
systems.sol.structures.push(outpost);
for (const id of ['colony', 'frontier', 'rim']) {
  systems[id].structures.push({ id: `outpost-${id}`, type: 'outpost', bodyId: 'p1', level: 1, hp: 200, maxHp: 200 });
}
systems.ai_home.structures.push({
  id: 'outpost-ai', type: 'outpost', bodyId: 'p1', level: 1, hp: 200, maxHp: 200, factionId: 'f-economic',
});

check('1. save version is current', SAVE_VERSION >= 13, `SAVE_VERSION=${SAVE_VERSION}`);
check('2. outpost base income constant is progressive base (10)', OUTPOST_BASE_INCOME === 10);
check('3. exactly 15 new structure IDs', NEW_BODY_STRUCTURE_TYPES.length === 15
  && new Set(NEW_BODY_STRUCTURE_TYPES).size === 15);
check('4. all 15 definitions are registered', NEW_BODY_STRUCTURE_TYPES.every((type) => BODY_STRUCTURE_DEFS[type]));
check('5. all new definitions have complete catalog metadata', NEW_BODY_STRUCTURE_TYPES.every((type) => {
  const def = BODY_STRUCTURE_DEFS[type];
  return def.label && def.description && def.placement && def.cost > 0 && def.hp > 0
    && def.tech && def.cap > 0 && def.capScope && def.visual && def.combat
    && Array.isArray(def.effects) && def.effects.length > 0;
}));
check('6. requested placement/cap exceptions are exact',
  BODY_STRUCTURE_DEFS.orbital_habitat.cap === 2
  && BODY_STRUCTURE_DEFS.orbital_habitat.capScope === 'system'
  && BODY_STRUCTURE_DEFS.missile_silo.cap === 2
  && BODY_STRUCTURE_DEFS.missile_silo.capScope === 'body'
  && BODY_STRUCTURE_DEFS.wormhole_observatory.capScope === 'galaxy'
  && BODY_STRUCTURE_DEFS.embassy_complex.empireCap === 3);

const power = buildNow('sol', 'p1', 'power_grid');
const habitat1 = buildNow('sol', 'p1', 'orbital_habitat');
const habitat2 = buildNow('sol', 'p2', 'orbital_habitat');
const habitat3 = buildNow('sol', 'p1', 'orbital_habitat');
check('7. system caps apply across different bodies', power.ok && habitat1.ok && habitat2.ok
  && !habitat3.ok && habitat3.reason === 'System cap reached', habitat3.reason);

const silo1 = buildNow('sol', 'p1', 'missile_silo');
const silo2 = buildNow('sol', 'p1', 'missile_silo');
const silo3 = buildNow('sol', 'p1', 'missile_silo');
check('8. per-body cap permits exactly two missile silos', silo1.ok && silo2.ok
  && !silo3.ok && silo3.reason === 'Cap reached on this body', silo3.reason);

state.research.unlocked = state.research.unlocked.filter((id) => id !== 'eco_nanoforges');
const lockedForge = canBuildBodyStructure(state, 'sol', 'p1', 'nanoforge');
check('9. direct tech lock blocks construction', !lockedForge.ok && /Research/.test(lockedForge.reason), lockedForge.reason);
state.research.unlocked.push('eco_nanoforges');

systems.sol.structures.push({ id: 'foundry-1', type: 'sail_foundry', bodyId: 'p1', level: 1 });
const collector = buildNow('sol', null, 'solar_collector');
check('10. Dyson-only collector accepts an active Dyson project', collector.ok, collector.reason ?? '');

state.flagship.systemId = 'bh';
const observatory = buildNow('bh', null, 'wormhole_observatory');
const observatoryDuplicate = canBuildBodyStructure(state, 'bh', null, 'wormhole_observatory');
check('11. one observatory is allowed on the neutral black-hole node', observatory.ok
  && !observatoryDuplicate.ok && observatoryDuplicate.reason === 'Galaxy cap reached', observatoryDuplicate.reason);
state.flagship.systemId = 'sol';

const powerStructure = systems.sol.structures.find((entry) => entry.id === power.structureId);
const cargoWithGrid = structureCargoProductionMultiplier(state, 'sol');
powerStructure.disabledUntil = state.time + 10000;
const cargoWhileDisabled = structureCargoProductionMultiplier(state, 'sol');
powerStructure.disabledUntil = 0;
check('12. disabled buildings contribute no operational effect', cargoWithGrid > cargoWhileDisabled,
  `${cargoWithGrid.toFixed(4)} -> ${cargoWhileDisabled.toFixed(4)}`);

const siloStructure = systems.sol.structures.find((entry) => entry.id === silo1.structureId);
const siloId = siloStructure.id;
const siloHp1 = siloStructure.maxHp;
const upgradeCost = bodyStructureUpgradeCost('missile_silo', 1);
const creditsBeforeUpgrade = state.credits;
const siloUpgrade = upgradeBodyStructure(state, 'sol', siloId, { ignoreTechCap: true, immediate: true });
check('13. tier upgrade keeps the structure ID and charges its declared cost', siloUpgrade.ok
  && siloStructure.id === siloId && structureLevel(siloStructure) === 2
  && state.credits === creditsBeforeUpgrade - upgradeCost);
check('14. defensive level II scales max HP by 1.5', siloStructure.maxHp === Math.round(siloHp1 * 1.5),
  `${siloHp1} -> ${siloStructure.maxHp}`);

const outpostId = outpost.id;
const outpostUpgrade2 = upgradeBodyStructure(state, 'sol', outpostId, { ignoreTechCap: true, immediate: true });
const outpostUpgrade3 = upgradeBodyStructure(state, 'sol', outpostId, { ignoreTechCap: true, immediate: true });
check('15. core outpost upgrades retain ID through level III', outpostUpgrade2.ok && outpostUpgrade3.ok
  && outpost.id === outpostId && outpost.level === 3);
check('16. level III outpost cargo/capacity values are exact',
  outpostCargoProductionMultiplier(outpost) === 1.6 && outpostStockCapacity(outpost) === 220);

const hpBeforeMothball = siloStructure.hp;
state.research.unlocked = state.research.unlocked.filter((id) => id !== 'mil_missile_silo_network');
const mothball = reconcileStructureTechnology(state, 'sol');
const upgradeWhileMothballed = canUpgradeBodyStructure(state, 'sol', siloId, { ignoreTechCap: true });
check('17. missing captured-owner tech mothballs without losing level/HP', mothball.mothballed.includes(siloId)
  && siloStructure.level === 2 && siloStructure.hp === hpBeforeMothball
  && !isOperationalStructure(state, siloStructure, { systemId: 'sol' }) && !upgradeWhileMothballed.ok);
state.research.unlocked.push('mil_missile_silo_network');
const reactivate = reconcileStructureTechnology(state, 'sol');
check('18. newly available tech reactivates the same structure', reactivate.reactivated.includes(siloId)
  && siloStructure.id === siloId && isOperationalStructure(state, siloStructure, { systemId: 'sol' }));

const hub = buildNow('sol', 'p1', 'logistics_hub');
check('19. reusable logistics effect queries expose the catalog values', hub.ok
  && structureDepotCapacityBonus(state, 'sol') >= 100
  && structureDispatchIntervalMultiplier(state, 'sol', 'local') === 0.8);

const aiBuild = buildBodyStructure(state, 'ai_home', 'p1', 'power_grid', {
  factionId: 'f-economic', remote: true,
});
check('20. faction build path pays faction credits and records faction identity', aiBuild.ok
  && systems.ai_home.structures.find((entry) => entry.id === aiBuild.structureId)?.factionId === 'f-economic'
  && state.factions.list[0].credits === 500000 - BODY_STRUCTURE_DEFS.power_grid.cost);

const buildRows = bodyStructureBuildRows(state, 'sol', 'p1');
const summaryRows = bodyStructureSummaryRows(state, 'sol');
check('21. build and summary rows carry v13 detail', buildRows.some((row) => row.type === 'power_grid'
  && row.description && row.effects.length > 0) && summaryRows.some((row) => row.id === siloId && row.level === 2));

const surfaceSites = outpostSurfaceSites(state, 'sol');
const orbitSites = structureSites(state, 'sol');
const starSites = starNodeStructureSites(state, 'sol');
check('22. surface/orbital/star site registration covers new structures',
  surfaceSites.some((site) => site.structureType === 'power_grid')
  && orbitSites.some((site) => site.structureType === 'orbital_habitat')
  && starSites.some((site) => site.structureType === 'solar_collector'));
check('23. compact visual registries cover every new placement type',
  ['power_grid', 'nanoforge', 'fleet_academy', 'missile_silo', 'quantum_archive', 'embassy_complex']
    .every((type) => SURFACE_BUILDING_VISUAL_TYPES.includes(type))
  && ['orbital_habitat', 'interdiction_array', 'carrier_command', 'sensor_array', 'logistics_hub', 'galactic_exchange', 'salvage_yard']
    .every((type) => ORBITAL_BUILDING_VISUAL_TYPES.includes(type))
  && ['solar_collector', 'wormhole_observatory'].every((type) => STAR_NODE_BUILDING_VISUAL_TYPES.includes(type)));

const passed = results.filter((entry) => entry.pass).length;
console.log(`\nV13 buildings: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
