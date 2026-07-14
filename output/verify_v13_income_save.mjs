import fs from 'node:fs';
import {
  createNewGame,
} from '../src/js/state.js';
import {
  applyIncomeTick,
  incomePerSecond,
  incomePerSecondInSystem,
  operationalOutpostCount,
  outpostIncomePerSecond,
} from '../src/js/economy.js';
import { OUTPOST_BASE_INCOME, MOON_YIELD_BONUS, SHELL_BONUS_CREDIT_MULT } from '../src/js/constants.js';
import { seedAiFaction } from '../src/js/ai-faction.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';
import { techEffects } from '../src/js/tech-web.js';

let passed = 0;
let failed = 0;
function check(label, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${details ? ` - ${details}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${details ? ` - ${details}` : ''}`);
  }
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

const state = createNewGame(1313);
const systems = state.galaxies[state.activeGalaxyId].systems;
const system = systems[state.stronghold];
const bodies = system.bodies.filter((body) => body.type === 'habitable');
const firstBody = bodies[0];
const moons = firstBody.moons?.length ?? 0;
const expectedFirst = OUTPOST_BASE_INCOME * (1 + moons * MOON_YIELD_BONUS);

const first = {
  id: 'v13-outpost-1', type: 'outpost', bodyId: firstBody.id,
  level: 3, hp: 240, maxHp: 240, operational: true,
};
system.structures.push(first);
check('one operational outpost uses progressive base+moons', approx(incomePerSecond(state), expectedFirst),
  `got=${incomePerSecond(state)} expected=${expectedFirst}`);
check('system income matches progressive formula', approx(incomePerSecondInSystem(state, system.id), expectedFirst));

const creditsBefore = state.credits;
for (let tick = 0; tick < 20; tick += 1) {
  state.time += 50;
  applyIncomeTick(state);
}
check('one outpost awards progressive credits in one second',
  approx(state.credits - creditsBefore, expectedFirst));

const secondBody = bodies[1] ?? bodies[0];
const secondMoons = secondBody.moons?.length ?? 0;
const expectedSecond = OUTPOST_BASE_INCOME * (1 + secondMoons * MOON_YIELD_BONUS);
const second = {
  id: 'v13-outpost-2', type: 'outpost', bodyId: secondBody.id,
  level: 1, hp: 240, maxHp: 240, operational: true,
};
system.structures.push(second);
const expectedTwo = expectedFirst + expectedSecond;
check('two operational outposts sum progressive rates', approx(incomePerSecond(state), expectedTwo));

first.level = 1;
first.productionMultiplier = 100;
system.dyson = system.dyson ?? {};
system.dyson.completedShells = 8;
const shellMult = SHELL_BONUS_CREDIT_MULT[8];
const withShell = expectedTwo * shellMult;
check('Dyson shell credit bonus increases income', approx(incomePerSecond(state), withShell),
  `got=${incomePerSecond(state)} expected=${withShell}`);

state.research.unlocked.push('eco_outpost_2', 'eco_outpost_3', 'eco_finance_hub');
const fx = techEffects(state);
const withTech = withShell * fx.outpostIncomeMult * fx.creditIncomeMult;
check('income tech multipliers apply', approx(incomePerSecond(state), withTech)
  && (fx.outpostIncomeMult > 1 || fx.creditIncomeMult > 1),
  `mults=${fx.outpostIncomeMult}/${fx.creditIncomeMult}`);

system.dyson.completedShells = 0;
state.research.unlocked = state.research.unlocked.filter(
  (id) => !['eco_outpost_2', 'eco_outpost_3', 'eco_finance_hub'].includes(id),
);

second.disabledUntil = state.time + 1000;
check('disabled outpost pays nothing', approx(incomePerSecond(state), expectedFirst));
second.disabledUntil = 0;
second.hp = 0;
check('destroyed outpost pays nothing', approx(incomePerSecond(state), expectedFirst));
second.hp = 240;
second.mothballed = true;
check('mothballed outpost pays nothing', approx(incomePerSecond(state), expectedFirst));
second.mothballed = false;
first.operational = false;
check('offline outpost pays nothing', approx(incomePerSecond(state), expectedSecond));
first.operational = true;
check('operational count matches payable outposts', operationalOutpostCount(state) === 2);
check('outpostIncomePerSecond helper matches body moons',
  approx(outpostIncomePerSecond(state, system, first), expectedFirst));

state.paused = true;
const pausedCredits = state.credits;
applyIncomeTick(state);
check('paused direct income tick awards nothing', state.credits === pausedCredits);
state.paused = false;

seedAiFaction(state);
const legacyState = JSON.parse(JSON.stringify(state));
delete legacyState.aiDifficulty;
for (const faction of legacyState.factions.list ?? []) {
  delete faction.solarii;
  delete faction.research;
  delete faction.productionQueue;
  delete faction.logistics;
}
for (const galaxy of Object.values(legacyState.galaxies)) {
  for (const legacySystem of Object.values(galaxy.systems ?? {})) {
    delete legacySystem.factionId;
    for (const structure of legacySystem.structures ?? []) delete structure.level;
  }
}
for (const ship of legacyState.aiShips ?? []) delete ship.factionId;
const legacyJson = JSON.stringify(legacyState);
const migrated = deserialize(JSON.stringify({
  saveVersion: 12,
  checksum: crc32(legacyJson),
  savedAt: 1,
  state: legacyState,
}));
check('v12 save migrates to v13 state', migrated.ok);
check('migration defaults AI difficulty to normal', migrated.state?.aiDifficulty === 'normal');
check('migration initializes faction research and resources', (migrated.state?.factions?.list ?? []).every(
  (faction) => faction.research?.unlocked?.includes('eco_baseline') && Number.isFinite(faction.solarii),
));
check('migration assigns faction IDs to AI systems', Object.values(migrated.state?.galaxies ?? {}).every(
  (galaxy) => Object.values(galaxy.systems ?? {}).filter((entry) => entry.owner === 'ai').every((entry) => !!entry.factionId),
));
check('migration defaults structures to level I', Object.values(migrated.state?.galaxies ?? {}).every(
  (galaxy) => Object.values(galaxy.systems ?? {}).every(
    (entry) => (entry.structures ?? []).every((structure) => structure.level >= 1 && structure.level <= 3),
  ),
));
const reserialized = JSON.parse(serialize(migrated.state));
check('migrated state serializes as current save', reserialized.saveVersion >= 13);

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/save-v13.json', import.meta.url), 'utf8'));
check('save-v13 schema declares version 13', schema.properties?.saveVersion?.const === 13);

console.log(`\n${passed}/${passed + failed} v13 income/save checks passed.`);
if (failed) process.exitCode = 1;
