import fs from 'node:fs';
import {
  createNewGame,
} from '../src/js/state.js';
import {
  applyIncomeTick,
  incomePerSecond,
  incomePerSecondInSystem,
  operationalOutpostCount,
} from '../src/js/economy.js';
import { seedAiFaction } from '../src/js/ai-faction.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';

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

const state = createNewGame(1313);
const systems = state.galaxies[state.activeGalaxyId].systems;
const system = systems[state.stronghold];
const bodies = system.bodies.filter((body) => body.type === 'habitable');
const first = {
  id: 'v13-outpost-1', type: 'outpost', bodyId: bodies[0].id,
  level: 3, hp: 240, maxHp: 240, operational: true,
};
system.structures.push(first);
check('one operational outpost reports exactly 40 cr/s', incomePerSecond(state) === 40);
check('system passive rate is exactly 40 cr/s', incomePerSecondInSystem(state, system.id) === 40);

const creditsBefore = state.credits;
for (let tick = 0; tick < 20; tick += 1) {
  state.time += 50;
  applyIncomeTick(state);
}
check('one outpost awards exactly 40 credits in one second', Math.abs(state.credits - creditsBefore - 40) < 1e-8);

const second = {
  id: 'v13-outpost-2', type: 'outpost', bodyId: bodies[1]?.id ?? bodies[0].id,
  level: 1, hp: 240, maxHp: 240, operational: true,
};
system.structures.push(second);
check('two operational outposts report exactly 80 cr/s', incomePerSecond(state) === 80);

first.level = 1;
first.productionMultiplier = 100;
system.dyson.completedShells = 8;
state.research.unlocked.push('eco_outpost_2', 'eco_outpost_3', 'eco_finance_hub');
check('levels tech moon and Dyson state do not modify passive rate', incomePerSecond(state) === 80);

second.disabledUntil = state.time + 1000;
check('disabled outpost pays nothing', incomePerSecond(state) === 40);
second.disabledUntil = 0;
second.hp = 0;
check('destroyed outpost pays nothing', incomePerSecond(state) === 40);
second.hp = 240;
second.mothballed = true;
check('mothballed outpost pays nothing', incomePerSecond(state) === 40);
second.mothballed = false;
first.operational = false;
check('offline outpost pays nothing', incomePerSecond(state) === 40);
first.operational = true;
check('operational count matches payable outposts', operationalOutpostCount(state) === 2);

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
check('migrated state serializes as save-v13', reserialized.saveVersion === 13);

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/save-v13.json', import.meta.url), 'utf8'));
check('save-v13 schema declares version 13', schema.properties?.saveVersion?.const === 13);

console.log(`\n${passed}/${passed + failed} v13 income/save checks passed.`);
if (failed) process.exitCode = 1;
