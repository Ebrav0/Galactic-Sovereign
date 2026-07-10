// Save-v13 focused regression checks for operational shipyard dispatch/spawning
// and player battle-group auto-assignment + flagship anchoring.

import { createNewGame, systemById } from '../src/js/state.js';
import {
  dispatchEmpireQueue,
  enqueueHull,
  listPlayerShipyards,
} from '../src/js/empire-queue.js';
import { tickProduction } from '../src/js/production.js';
import { spawnPlayerShip } from '../src/js/fleets.js';
import { orderTravel as orderFlagshipTravel } from '../src/js/flagship.js';

const battleGroups = await import('../src/js/battle-groups.js');

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

const expectedBattleGroupApis = [
  'autoAssignShipsToFleets',
  'setBattleGroupFlagshipAnchor',
  'syncFlagshipAnchoredFleets',
];
for (const api of expectedBattleGroupApis) {
  check(`battle-group API exported: ${api}`, typeof battleGroups[api] === 'function');
}

function systemsFor(state) {
  return state.galaxies[state.activeGalaxyId].systems;
}

function resetProductionState(seed = 1313) {
  const state = createNewGame(seed);
  state.credits = 1_000_000;
  state.paused = false;
  state.empireQueue = [];
  state.playerShips = [];
  state.scouts = [];
  for (const system of Object.values(systemsFor(state))) {
    system.structures = (system.structures ?? []).filter((structure) => structure.type !== 'shipyard');
  }
  return state;
}

function builtShipyard(id, bodyId, overrides = {}) {
  return {
    id,
    type: 'shipyard',
    bodyId,
    level: 1,
    hp: 900,
    maxHp: 900,
    operational: true,
    disabledUntil: 0,
    mothballed: false,
    builds: [],
    ...overrides,
  };
}

// --- Shipyard eligibility: only a completed, operational player yard counts. ---
{
  const state = resetProductionState();
  check('empire queue sees no yard when none has been built', listPlayerShipyards(state).length === 0);
  const result = enqueueHull(state, 'corvette');
  check('empire queue rejects a hull without an operational built yard',
    result.ok === false && /shipyard/i.test(result.reason ?? ''), result.reason ?? '');
}

const invalidYardCases = [
  ['under-construction', { construction: { startedAt: 0, durationMs: 20_000 } }],
  ['disabled', { disabledUntil: 60_000 }],
  ['destroyed', { hp: 0 }],
  ['mothballed', { mothballed: true }],
  ['offline', { operational: false }],
];

for (const [label, overrides] of invalidYardCases) {
  const state = resetProductionState();
  const home = systemById(state, state.stronghold);
  const bodyId = home.bodies[0].id;
  home.structures.push(builtShipyard(`yard-${label}`, bodyId, overrides));
  const yards = listPlayerShipyards(state);
  check(`${label} shipyard is not production eligible`, yards.length === 0,
    `eligible=${yards.map((yard) => yard.shipyardId).join(',') || 'none'}`);
  const result = enqueueHull(state, 'corvette');
  check(`${label} shipyard cannot admit an empire-queue hull`, result.ok === false,
    result.reason ?? 'unexpectedly accepted');
}

// --- Assignment and completion must remain tied to the physical yard system. ---
{
  const state = resetProductionState(1314);
  const graph = state.galaxies[state.activeGalaxyId].graph;
  const lane = graph.lanes.find(([a, b]) => a === state.stronghold || b === state.stronghold);
  const remoteSystemId = lane[0] === state.stronghold ? lane[1] : lane[0];
  const remote = systemById(state, remoteSystemId);
  remote.owner = 'player';
  remote.factionId = null;
  const bodyId = remote.bodies[0]?.id ?? null;
  const yard = builtShipyard('yard-remote-built', bodyId);
  remote.structures.push(yard);

  const enqueue = enqueueHull(state, 'corvette');
  check('operational remote player shipyard admits hull', enqueue.ok, enqueue.reason ?? '');
  const dispatched = dispatchEmpireQueue(state);
  const item = state.empireQueue.find((entry) => entry.id === enqueue.item?.id);
  check('dispatcher records the exact assigned yard and system',
    dispatched.length === 1
      && dispatched[0].shipyardId === yard.id
      && dispatched[0].systemId === remoteSystemId
      && item?.assignedShipyardId === yard.id
      && item?.assignedSystemId === remoteSystemId);
  check('physical yard owns the dispatched build job',
    yard.builds.length === 1 && yard.builds[0].queueItemId === enqueue.item?.id);

  const build = yard.builds[0];
  state.time = build.startedAt + build.durationMs;
  const completed = tickProduction(state);
  const completion = completed.find((entry) => entry.hull === 'corvette');
  const spawned = state.playerShips.find((ship) => ship.id === completion?.shipId);
  check('completed hull reports its assigned yard system',
    completion?.systemId === remoteSystemId, `system=${completion?.systemId ?? 'none'}`);
  check('completed hull spawns only at the assigned physical yard',
    spawned?.systemId === remoteSystemId
      && spawned?.anchorBodyId === bodyId
      && spawned?.galaxyId === state.activeGalaxyId,
  `ship=${spawned?.id ?? 'none'} system=${spawned?.systemId ?? 'none'}`);
  check('completed empire item and yard job are removed',
    !state.empireQueue.some((entry) => entry.id === enqueue.item?.id) && yard.builds.length === 0);
}

// --- Auto-assignment: every live, active-galaxy player ship belongs exactly once. ---
if (typeof battleGroups.autoAssignShipsToFleets === 'function') {
  const state = resetProductionState(1315);
  const homeId = state.stronghold;
  const graph = state.galaxies[state.activeGalaxyId].graph;
  const lane = graph.lanes.find(([a, b]) => a === homeId || b === homeId);
  const neighborId = lane[0] === homeId ? lane[1] : lane[0];
  const ships = [
    spawnPlayerShip(state, homeId, 'corvette'),
    spawnPlayerShip(state, homeId, 'frigate'),
    spawnPlayerShip(state, neighborId, 'destroyer'),
    spawnPlayerShip(state, neighborId, 'healer'),
  ];
  const destroyed = spawnPlayerShip(state, homeId, 'corvette');
  destroyed.hp = 0;
  const foreign = spawnPlayerShip(state, homeId, 'corvette');
  foreign.galaxyId = 'gal-foreign';

  const firstGroup = battleGroups.createBattleGroup(state);
  battleGroups.assignShipToGroup(state, ships[0].id, firstGroup.id);
  const result = battleGroups.autoAssignShipsToFleets(state);
  const liveIds = new Set(ships.map((ship) => ship.id));
  const membershipCounts = new Map([...liveIds].map((id) => [id, 0]));
  for (const group of state.battleGroups) {
    for (const shipId of group.shipIds ?? []) {
      if (membershipCounts.has(shipId)) membershipCounts.set(shipId, membershipCounts.get(shipId) + 1);
    }
  }
  check('auto-assign reports success', result?.ok !== false, result?.reason ?? '');
  check('auto-assign assigns every live active-galaxy ship exactly once',
    [...membershipCounts.values()].every((count) => count === 1),
    [...membershipCounts.entries()].map(([id, count]) => `${id}:${count}`).join(','));
  check('auto-assign excludes destroyed and foreign-galaxy ships',
    state.battleGroups.every((group) => !group.shipIds.includes(destroyed.id) && !group.shipIds.includes(foreign.id)));
}

// --- Flagship anchoring: anchor is exclusive and follows station/transit target. ---
if (typeof battleGroups.setBattleGroupFlagshipAnchor === 'function'
  && typeof battleGroups.syncFlagshipAnchoredFleets === 'function') {
  const state = resetProductionState(1316);
  const homeId = state.stronghold;
  const graph = state.galaxies[state.activeGalaxyId].graph;
  const lane = graph.lanes.find(([a, b]) => a === homeId || b === homeId);
  const targetId = lane[0] === homeId ? lane[1] : lane[0];
  const shipA = spawnPlayerShip(state, homeId, 'corvette');
  const shipB = spawnPlayerShip(state, homeId, 'healer');
  const group = battleGroups.createBattleGroup(state);
  battleGroups.assignShipToGroup(state, shipA.id, group.id);
  battleGroups.assignShipToGroup(state, shipB.id, group.id);
  group.anchorHeroId = 'legacy-hero-anchor';

  const anchor = battleGroups.setBattleGroupFlagshipAnchor(state, group.id, true);
  check('flagship anchor enables and clears mutually exclusive hero anchor',
    anchor.ok && group.anchorFlagship === true && group.anchorHeroId == null);

  const flagshipOrder = orderFlagshipTravel(state, targetId);
  check('flagship begins lane travel for anchor test', flagshipOrder.ok, flagshipOrder.reason ?? '');
  const syncResult = battleGroups.syncFlagshipAnchoredFleets(state);
  const followsTarget = [shipA, shipB].every((ship) =>
    ship.transit?.path?.[ship.transit.path.length - 1] === targetId && ship.systemId == null);
  check('anchored fleet follows flagship current destination', followsTarget,
    `sync=${JSON.stringify(syncResult ?? null)}`);

  // A disabled anchor must stop future synchronization.
  battleGroups.setBattleGroupFlagshipAnchor(state, group.id, false);
  state.flagship.transit = null;
  state.flagship.systemId = targetId;
  shipA.transit = null;
  shipA.systemId = homeId;
  shipB.transit = null;
  shipB.systemId = homeId;
  battleGroups.syncFlagshipAnchoredFleets(state);
  check('cleared flagship anchor no longer moves fleet ships',
    !shipA.transit && shipA.systemId === homeId && !shipB.transit && shipB.systemId === homeId);
}

console.log(`\n${passed}/${passed + failed} fleet/shipyard checks passed.`);
if (failed) process.exitCode = 1;
