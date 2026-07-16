import assert from 'node:assert/strict';

import { SAVE_VERSION } from '../src/js/constants.js';
import { createNewGame } from '../src/js/state.js';
import { hydrateGalaxy, dehydrateGalaxy } from '../src/js/hydration.js';
import { devRevealAllIntel } from '../src/js/dev.js';
import { hydratedGalaxyCount } from '../src/js/galaxy-scope.js';
import { setCompletedDysonsForTest } from '../src/js/milestones.js';
import { buildSuperweaponCradle, superweaponCreate } from '../src/js/superweapon.js';
import { solariiPerSecondInSystem } from '../src/js/dyson.js';
import {
  CANONICAL_STAR_TYPES,
  STELLAR_GENERATION_PROFILES,
  stellarSolariiMultiplier,
} from '../src/js/star-types.js';

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, condition });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

check('save version is 20', SAVE_VERSION === 20, String(SAVE_VERSION));

const state = createNewGame(200020);
for (const galaxy of Object.values(state.galaxies)) {
  const numbers = galaxy.graph.stars.map((star) => star.catalogNumber);
  const classes = new Set(galaxy.graph.stars.map((star) => star.stellarClass).filter(Boolean));
  check(`${galaxy.id} reserves all classes`, CANONICAL_STAR_TYPES.every((type) => classes.has(type)));
  check(`${galaxy.id} numbers are unique 001–400`, new Set(numbers).size === 400
    && Math.min(...numbers) === 1 && Math.max(...numbers) === 400);
  check(`${galaxy.id} excludes Trade Nexuses`, galaxy.graph.stars
    .filter((star) => star.kind === 'trade_nexus').every((star) => !star.stellarClass));
}
const homeGalaxy = state.galaxies[state.homeGalaxyId];
check('home Stronghold is a Yellow Dwarf', homeGalaxy.graph.stars
  .find((star) => star.id === state.stronghold)?.stellarClass === 'yellow_dwarf');
check('Stronghold fixed roster is unchanged', homeGalaxy.systems[state.stronghold].bodies.length === 8);

const exactSolarii = {
  yellow_dwarf: 1, orange_dwarf: .98, red_dwarf: .92, brown_dwarf: .85,
  red_giant: 1.03, white_dwarf: .9, neutron_star: .88, pulsar: .95,
  magnetar: 1, wolf_rayet: 1.1, red_supergiant: 1.1, blue_supergiant: 1.12,
  hypergiant: 1.15, black_hole_system: 1.05, binary: 1.05, quasar: 1.15,
};
check('all exact Dyson multipliers are authored', CANONICAL_STAR_TYPES.every((type) =>
  STELLAR_GENERATION_PROFILES[type].solarii === exactSolarii[type]));

const observed = Object.fromEntries(CANONICAL_STAR_TYPES.map((type) => [type, {
  systems: 0, planetless: 0, environments: [0, 0, 0, 0], planets: [0, 0, 0],
}]));
const environmentNames = ['clear', 'nebula', 'ion_storm', 'debris_field'];
const planetTypes = ['habitable', 'barren', 'gas'];
for (let seed = 100; seed < 120; seed++) {
  const sample = createNewGame(seed);
  const galaxy = sample.galaxies['gal-0'];
  for (const node of galaxy.graph.stars) {
    if (!node.stellarClass || node.kind === 'trade_nexus' || node.id === sample.stronghold) continue;
    const system = galaxy.systems[node.id];
    const bucket = observed[node.stellarClass];
    bucket.systems++;
    if (system.bodies.length === 0) bucket.planetless++;
    bucket.environments[environmentNames.indexOf(system.environment)]++;
    for (const planet of system.bodies) bucket.planets[planetTypes.indexOf(planet.type)]++;
  }
}
check('class planetless rates follow authored biases', CANONICAL_STAR_TYPES.every((type) => {
  const actual = observed[type].planetless / observed[type].systems;
  return Math.abs(actual - STELLAR_GENERATION_PROFILES[type].planetlessChance) <= .14;
}));
check('class environment distributions follow authored biases', CANONICAL_STAR_TYPES.every((type) => {
  const bucket = observed[type];
  return bucket.environments.every((count, index) =>
    Math.abs(count / bucket.systems - STELLAR_GENERATION_PROFILES[type].environmentWeights[index]) <= .16);
}));
check('class planet mixes follow authored biases', CANONICAL_STAR_TYPES.every((type) => {
  const bucket = observed[type];
  const total = bucket.planets.reduce((sum, value) => sum + value, 0);
  return bucket.planets.every((count, index) =>
    Math.abs(count / total - STELLAR_GENERATION_PROFILES[type].planetWeights[index]) <= .16);
}));

const graphBeforeHydration = JSON.stringify(state.galaxies['gal-1'].graph.stars
  .map((star) => [star.id, star.stellarClass, star.catalogNumber]));
check('hydrate second galaxy succeeds', hydrateGalaxy(state, 'gal-1').ok);
check('hydration mirrors graph class into system star', state.galaxies['gal-1'].graph.stars.every((node) =>
  node.kind === 'trade_nexus' || state.galaxies['gal-1'].systems[node.id]?.star?.type === node.stellarClass));
check('dehydrate second galaxy succeeds', dehydrateGalaxy(state, 'gal-1').ok);
check('rehydrate second galaxy succeeds', hydrateGalaxy(state, 'gal-1').ok);
check('hydration cycle never rerolls catalog', graphBeforeHydration === JSON.stringify(
  state.galaxies['gal-1'].graph.stars.map((star) => [star.id, star.stellarClass, star.catalogNumber])));

const hydrationBeforeReveal = hydratedGalaxyCount(state);
const reveal = devRevealAllIntel(state);
check('Reveal All returns exact counts', reveal.ok && reveal.details.systems === 4010
  && reveal.details.galaxies === 10 && reveal.details.wormholes === 10);
check('Reveal All does not hydrate abstract galaxies', hydratedGalaxyCount(state) === hydrationBeforeReveal);
check('Reveal All marks every graph and Core', Object.values(state.galaxies).every((galaxy) =>
  Object.keys(galaxy.intel).length === 401));

hydrateGalaxy(state, state.homeGalaxyId);
state.research.unlocked.push('sw_cradle_unlock', 'sw_create_star');
setCompletedDysonsForTest(state, 3);
state.solarii = 10000;
state.credits = 100000;
check('superweapon cradle fixture builds', buildSuperweaponCradle(state).ok);
const first = superweaponCreate(state, state.stronghold, { immediate: true });
const active = state.galaxies[state.activeGalaxyId];
const firstNode = active.graph.stars.find((node) => node.id === first.systemId);
check('first created star receives S401', first.ok && firstNode.catalogNumber === 401
  && firstNode.catalogId === 'G001-S401');
active.graph.stars = active.graph.stars.filter((node) => node.id !== first.systemId);
active.graph.lanes = active.graph.lanes.filter(([a, b]) => a !== first.systemId && b !== first.systemId);
delete active.systems[first.systemId];
state.superweapon.cooldownUntil = 0;
state.solarii = 10000;
const second = superweaponCreate(state, state.stronghold, { immediate: true });
const secondNode = active.graph.stars.find((node) => node.id === second.systemId);
check('destroyed catalog numbers are never reused', second.ok && secondNode.catalogNumber === 402
  && active.graph.nextCatalogNumber === 403);

const outputSystem = active.systems[state.stronghold];
outputSystem.dyson.completedShells = 1;
outputSystem.star.type = 'yellow_dwarf';
const yellowRate = solariiPerSecondInSystem(state, state.stronghold);
outputSystem.star.type = 'hypergiant';
const hyperRate = solariiPerSecondInSystem(state, state.stronghold);
check('Dyson output integrates the exact stellar multiplier', Math.abs(hyperRate / yellowRate - 1.15) < 1e-9,
  `${(hyperRate / yellowRate).toFixed(2)}x`);
check('multiplier helper agrees with integration', stellarSolariiMultiplier(outputSystem.star) === 1.15);

const failures = checks.filter((entry) => !entry.condition);
console.log(`\nStellar catalog v20: ${checks.length - failures.length}/${checks.length} checks passed`);
assert.equal(failures.length, 0);
