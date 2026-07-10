// Representative v11 -> v12 migration and corruption-safety verifier.
import { createNewGame, createDefaultDyson } from '../src/js/state.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const legacy = createNewGame(0x5a17);
const home = legacy.galaxies[legacy.homeGalaxyId];

// Strip v12-only generated identity to form a representative v11 fixture while
// retaining real graph/system data, ships, tech, structures, and manual routes.
for (const galaxy of Object.values(legacy.galaxies)) {
  for (const star of galaxy.graph.stars) {
    if (star.originalName) star.name = star.originalName;
    delete star.kind;
    delete star.tradeNexus;
    delete star.nexusOrdinal;
  }
  for (const system of Object.values(galaxy.systems ?? {})) {
    if (system.star?.kind === 'trade_nexus') {
      system.star.kind = 'yellow';
      system.star.type = 'yellow';
      system.star.color = '#ffd27d';
      system.dyson = createDefaultDyson();
      system.structures = system.structures.filter((structure) => structure.type !== 'trade_nexus');
    }
  }
}
delete legacy.logistics;
delete legacy.tacticalOrders;
delete legacy.battleReports;
delete legacy.solCommander;

const protectedStar = home.graph.stars.find((star) => star.id !== home.strongholdStarId);
const protectedSystem = home.systems[protectedStar.id];
protectedSystem.owner = 'player';
protectedSystem.dyson.completedShells = 3;
protectedSystem.dyson.shellSails = 147;
protectedSystem.structures.push({ id: 'legacy-foundry', type: 'sail_foundry', bodyId: protectedSystem.bodies[0]?.id ?? null });

const developedStar = home.graph.stars.find((star) => star.id !== protectedStar.id && star.id !== home.strongholdStarId);
const developedSystem = home.systems[developedStar.id];
developedSystem.owner = 'player';
const bodyId = developedSystem.bodies[0].id;
developedSystem.structures.push({ id: 'legacy-outpost', type: 'outpost', bodyId });
developedSystem.structures.push({ id: 'legacy-trade', type: 'trade_station', bodyId });

legacy.playerShips.push({
  id: 'legacy-carrier', hull: 'fleet_carrier', galaxyId: legacy.homeGalaxyId,
  systemId: legacy.stronghold, hp: 900, maxHp: 900,
  wingState: { ready: 5, launched: 2, lost: 1, ammo: 31, fuel: 620 },
});
legacy.research.unlocked.push('eco_trade_hub', 'mil_carrier_operations');
legacy.manualTradeRoutes.push({ fromSystemId: legacy.stronghold, toSystemId: developedStar.id });

const legacyStateJson = JSON.stringify(legacy);
const envelope = JSON.stringify({
  saveVersion: 11,
  checksum: crc32(legacyStateJson),
  savedAt: 123456789,
  state: JSON.parse(legacyStateJson),
});
const migrated = deserialize(envelope);
check('v11 fixture migrates successfully', migrated.ok, migrated.error ?? '');

if (migrated.ok) {
  const state = migrated.state;
  const migratedHome = state.galaxies[state.homeGalaxyId];
  const nexusStars = migratedHome.graph.stars.filter((star) => star.kind === 'trade_nexus');
  check('migration produces exactly four Trade Nexuses', nexusStars.length === 4, `count=${nexusStars.length}`);
  check('starting region has a nearby Trade Nexus', nexusStars.some((star) => {
    const start = migratedHome.graph.stars.find((candidate) => candidate.id === migratedHome.strongholdStarId);
    const distances = migratedHome.graph.stars
      .filter((candidate) => candidate.id !== start.id && candidate.id !== protectedStar.id)
      .map((candidate) => Math.hypot(candidate.x - start.x, candidate.y - start.y));
    return Math.hypot(star.x - start.x, star.y - start.y) <= Math.min(...distances) + 1e-9;
  }));
  check('completed Dyson system is never replaced by Nexus',
    migratedHome.systems[protectedStar.id].star.kind !== 'trade_nexus'
      && migratedHome.systems[protectedStar.id].dyson.completedShells === 3);
  check('legacy trade station becomes operational export depot',
    migratedHome.systems[developedStar.id].structures.some((structure) =>
      structure.id === 'legacy-trade' && structure.type === 'export_depot' && structure.operational));
  check('manual routes survive migration',
    state.manualTradeRoutes.some((route) => route.fromSystemId === legacy.stronghold && route.toSystemId === developedStar.id));
  const carrier = state.playerShips.find((ship) => ship.id === 'legacy-carrier');
  check('carrier wing state survives migration',
    carrier?.wingState?.ready === 5 && carrier?.wingState?.launched === 2 && carrier?.wingState?.lost === 1);
  check('v12 logistics, reports, and offline Sol state exist',
    state.logistics?.version === 1 && Array.isArray(state.battleReports)
      && state.solCommander?.settings?.providerMode === 'offline');
  check('migrated save serializes as v12', JSON.parse(serialize(state)).saveVersion === 12);
}

const corrupt = JSON.parse(envelope);
corrupt.checksum = '00000000';
const corruptBefore = JSON.stringify(corrupt);
const rejected = deserialize(JSON.stringify(corrupt));
check('corrupt save is rejected', !rejected.ok && /checksum/i.test(rejected.error));
check('corrupt input is not mutated', JSON.stringify(corrupt) === corruptBefore);

const passed = results.filter((result) => result.pass).length;
console.log(`\nSave v12 migration: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
