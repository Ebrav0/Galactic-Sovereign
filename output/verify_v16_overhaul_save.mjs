import assert from 'node:assert/strict';

import { SAVE_VERSION } from '../src/js/constants.js';
import { createNewGame } from '../src/js/state.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';

const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

check('v20 is the active save schema', () => {
  assert.equal(SAVE_VERSION, 20);
});

const fresh = createNewGame(160016);
check('new game initializes overhaul state', () => {
  assert.equal(fresh.diplomacy.version, 2);
  assert.ok(Array.isArray(fresh.diplomacy.proposals));
  assert.ok(Array.isArray(fresh.bulkProductionOrders));
  assert.ok(Array.isArray(fresh.bulkProductionDeliveries));
  assert.equal(fresh.bulkProductionMeta.nextOrderId, 1);
  assert.ok(Array.isArray(fresh.strategicOrders.campaigns));
});

check('v20 state round-trips with checksum', () => {
  fresh.bulkProductionOrders.push({ id: 'bulk-1', status: 'paused', manifest: [] });
  fresh.strategicOrders.campaigns.push({ id: 'campaign-1', status: 'blocked', targets: [] });
  const loaded = deserialize(serialize(fresh));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.bulkProductionOrders[0].id, 'bulk-1');
  assert.equal(loaded.state.strategicOrders.campaigns[0].id, 'campaign-1');
});

check('v16 combat state migrates to command-first autonomy', () => {
  const legacy = structuredClone(createNewGame(161617));
  delete legacy.combatSettings;
  legacy.systemBattles = {
    'sys-test': {
      id: 'battle-test',
      systemId: 'sys-test',
      active: true,
      mode: 'tactical',
      startedAt: 200,
      units: [{ id: 'wing-test', hull: 'interceptor', isWing: true, hp: 40, ammo: 3, fuel: 80 }],
    },
  };
  const stateJson = JSON.stringify(legacy);
  const loaded = deserialize(JSON.stringify({
    saveVersion: 16,
    checksum: crc32(stateJson),
    savedAt: 1234,
    state: legacy,
  }));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.combatSettings.controlMode, 'command');
  assert.equal(loaded.state.combatSettings.advancedTactics, false);
  assert.equal(loaded.state.combatSettings.flagshipAutopilot, true);
  assert.equal(loaded.state.systemBattles['sys-test'].fleetPriority, 'auto');
  assert.equal(loaded.state.systemBattles['sys-test'].alertAcknowledged, false);
  assert.equal(loaded.state.systemBattles['sys-test'].units[0].sortieNumber, 1);
});

check('v15 save migrates without inventing active orders', () => {
  const legacy = structuredClone(createNewGame(151515));
  delete legacy.bulkProductionOrders;
  delete legacy.bulkProduction;
  delete legacy.bulkProductionDeliveries;
  delete legacy.bulkProductionMeta;
  delete legacy.strategicOrders;
  legacy.diplomacy = { relations: { 'ai-0': { status: 'trade', treaties: ['trade'], lastChangedAt: 100 } } };
  const stateJson = JSON.stringify(legacy);
  const envelope = JSON.stringify({
    saveVersion: 15,
    checksum: crc32(stateJson),
    savedAt: 1234,
    state: legacy,
  });
  const loaded = deserialize(envelope);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.diplomacy.version, 2);
  assert.deepEqual(loaded.state.bulkProductionOrders, []);
  assert.deepEqual(loaded.state.strategicOrders.campaigns, []);
  assert.equal(loaded.state.diplomacy.relations['ai-0'].status, 'trade');
});

console.log(`\n${checks.length}/${checks.length} v20 save checks passed`);
