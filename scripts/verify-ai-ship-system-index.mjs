#!/usr/bin/env node

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  aiFactionIdsInSystem,
  aiOccupiedSystemIds,
  aiShipFactionId,
  aiShipsInSystem,
  invalidateAiShipSystemIndex,
  orderAiShipTravel,
  spawnAiShip,
  tickAiShips,
} from '../src/js/ai-ships.js';
import { applySharedStateDelta } from '../src/js/coop-replication.js';
import { createNewGame } from '../src/js/state.js';

function ship(id, systemId, factionId = 'ai-0', overrides = {}) {
  return {
    id,
    galaxyId: 'gal-0',
    systemId,
    factionId,
    hp: 100,
    transit: null,
    ...overrides,
  };
}

function assertHostilityParity(state, systemId, hostileFactionIds, message) {
  const oldPerShipResult = aiShipsInSystem(state, systemId)
    .some((candidate) => hostileFactionIds.has(aiShipFactionId(state, candidate)));
  const indexedFactionResult = aiFactionIdsInSystem(state, systemId)
    .some((factionId) => hostileFactionIds.has(factionId));
  assert.equal(indexedFactionResult, oldPerShipResult, message);
}

const state = {
  activeGalaxyId: 'gal-0',
  time: 1_000,
  aiShips: [
    ship('a', 'sys-a'),
    ship('b', 'sys-a', 'ai-1'),
    ship('dead', 'sys-a', 'ai-0', { hp: 0 }),
    ship('moving', null, 'ai-0', { transit: { path: ['sys-a', 'sys-b'] } }),
    ship('remote', 'sys-a', 'ai-0', { galaxyId: 'gal-1' }),
  ],
};

assert.deepEqual(
  aiShipsInSystem(state, 'sys-a').map((candidate) => candidate.id),
  ['a', 'b'],
  'system lookup should preserve array order while excluding dead, moving, and remote ships',
);
assert.deepEqual(
  aiShipsInSystem(state, 'sys-a', 'ai-0').map((candidate) => candidate.id),
  ['a'],
  'faction lookup should filter the indexed system group',
);
assert.deepEqual(
  aiOccupiedSystemIds(state),
  ['sys-a'],
  'occupied-system lookup should preserve first-seen ship order while excluding dead, moving, and remote ships',
);
assert.deepEqual(
  aiFactionIdsInSystem(state, 'sys-a'),
  ['ai-0', 'ai-1'],
  'faction presence should preserve first-seen order for mixed-faction systems',
);
assertHostilityParity(
  state,
  'sys-a',
  new Set(['ai-1']),
  'mixed-faction indexed hostility should match the previous per-ship predicate',
);
assertHostilityParity(
  state,
  'sys-a',
  new Set(['ai-9']),
  'a peaceful mixed-faction system should match the previous per-ship predicate',
);

state.aiShips[0].hp = 0;
state.aiShips[2].hp = 50;
invalidateAiShipSystemIndex(state);
assert.deepEqual(
  aiShipsInSystem(state, 'sys-a', 'ai-0').map((candidate) => candidate.id),
  ['dead'],
  'external same-tick HP changes should be reflected after explicit invalidation',
);
assert.deepEqual(
  aiOccupiedSystemIds(state),
  ['sys-a'],
  'occupied-system lookup should rebuild after explicit HP invalidation',
);
assert.deepEqual(
  aiFactionIdsInSystem(state, 'sys-a'),
  ['ai-1', 'ai-0'],
  'faction presence should exclude dead ships and rebuild after HP invalidation',
);

state.aiShips[1].hp = 0;
invalidateAiShipSystemIndex(state);
assert.deepEqual(
  aiFactionIdsInSystem(state, 'sys-a'),
  ['ai-0'],
  'a faction represented only by dead ships should not have combat presence',
);
state.aiShips[1].hp = 100;
state.aiShips[1].transit = { path: ['sys-a', 'sys-b'] };
invalidateAiShipSystemIndex(state);
assert.deepEqual(
  aiFactionIdsInSystem(state, 'sys-a'),
  ['ai-0'],
  'a faction represented only by transiting ships should not have combat presence',
);
state.aiShips[1].transit = null;
invalidateAiShipSystemIndex(state);

state.aiShips.push(ship('new', 'sys-a', 'ai-0'));
assert.deepEqual(
  aiShipsInSystem(state, 'sys-a', 'ai-0').map((candidate) => candidate.id),
  ['dead', 'new'],
  'same-tick array growth should invalidate the cached grouping',
);

state.aiShips = [ship('replacement', 'sys-b', 'ai-1')];
assert.deepEqual(
  aiShipsInSystem(state, 'sys-b').map((candidate) => candidate.id),
  ['replacement'],
  'same-length array replacement should invalidate the cached grouping',
);

state.aiShips[0].systemId = 'sys-c';
invalidateAiShipSystemIndex(state);
assert.deepEqual(
  aiShipsInSystem(state, 'sys-c').map((candidate) => candidate.id),
  ['replacement'],
  'external same-array location changes should rebuild after explicit invalidation',
);
assert.deepEqual(
  aiOccupiedSystemIds(state),
  ['sys-c'],
  'occupied-system lookup should share the explicitly invalidated location grouping',
);

applySharedStateDelta(state, [{
  op: 'set',
  path: ['aiShips', 0, 'systemId'],
  value: 'sys-d',
}]);
assert.deepEqual(
  aiOccupiedSystemIds(state),
  ['sys-d'],
  'co-op same-length ship deltas should invalidate indexed location membership',
);
assert.deepEqual(
  aiFactionIdsInSystem(state, 'sys-d'),
  ['ai-1'],
  'co-op same-length ship deltas should preserve indexed faction membership',
);

const legacyState = {
  activeGalaxyId: 'gal-0',
  aiShips: [ship('legacy', 'sys-legacy', null)],
  galaxies: {
    'gal-0': {
      systems: {
        'sys-legacy': { id: 'sys-legacy', owner: 'ai', factionId: 'ai-legacy-a' },
      },
    },
  },
  factions: { ai: { id: 'ai-default' }, list: [{ id: 'ai-default' }] },
};
assert.deepEqual(
  aiFactionIdsInSystem(legacyState, 'sys-legacy'),
  ['ai-legacy-a'],
  'legacy ships should derive combat faction presence from their current system',
);
assertHostilityParity(
  legacyState,
  'sys-legacy',
  new Set(['ai-legacy-a']),
  'legacy indexed hostility should match the previous per-ship fallback predicate',
);
legacyState.galaxies['gal-0'].systems['sys-legacy'].factionId = 'ai-legacy-b';
assert.deepEqual(
  aiFactionIdsInSystem(legacyState, 'sys-legacy'),
  ['ai-legacy-b'],
  'legacy fallback presence should follow ownership changes without an index rebuild',
);
assertHostilityParity(
  legacyState,
  'sys-legacy',
  new Set(['ai-legacy-b']),
  'legacy ownership changes should preserve old-vs-indexed hostility parity',
);

const travelState = createNewGame(7_731);
const [fromSystemId, toSystemId] = travelState.galaxies[travelState.activeGalaxyId].graph.lanes[0];
const traveler = spawnAiShip(travelState, fromSystemId, 'corvette', null, 'ai-0');
assert.ok(traveler, 'travel test ship should spawn');
assert.deepEqual(
  aiShipsInSystem(travelState, fromSystemId).map((candidate) => candidate.id),
  [traveler.id],
  'spawned ship should be indexed at its origin',
);
const order = orderAiShipTravel(travelState, traveler, toSystemId);
assert.equal(order.ok, true, order.reason);
assert.equal(
  aiShipsInSystem(travelState, fromSystemId).length,
  0,
  'travel departure should invalidate the origin group immediately',
);
assert.equal(
  aiOccupiedSystemIds(travelState).includes(fromSystemId),
  false,
  'travel departure should invalidate occupied-system membership immediately',
);
assert.deepEqual(
  aiFactionIdsInSystem(travelState, fromSystemId),
  [],
  'travel departure should remove faction presence from the origin immediately',
);
travelState.time += order.etaMs + 1;
tickAiShips(travelState);
assert.deepEqual(
  aiShipsInSystem(travelState, toSystemId).map((candidate) => candidate.id),
  [traveler.id],
  'arrival should invalidate and rebuild the destination group immediately',
);
assert.equal(
  aiOccupiedSystemIds(travelState).includes(toSystemId),
  true,
  'arrival should expose the destination through occupied-system membership immediately',
);
assert.deepEqual(
  aiFactionIdsInSystem(travelState, toSystemId),
  ['ai-0'],
  'arrival should expose faction presence at the destination immediately',
);

const benchmarkState = {
  activeGalaxyId: 'gal-0',
  time: 20_000,
  aiShips: Array.from({ length: 5_400 }, (_, index) => (
    ship(
      `stress-${index}`,
      `sys-${index % 400}`,
      `ai-${index % 4}`,
    )
  )),
};
const benchmarkStartedAt = performance.now();
let matches = 0;
let factionMatches = 0;
for (let pass = 0; pass < 20; pass++) {
  for (let system = 0; system < 400; system++) {
    matches += aiShipsInSystem(
      benchmarkState,
      `sys-${system}`,
      `ai-${system % 4}`,
    ).length;
    factionMatches += aiFactionIdsInSystem(benchmarkState, `sys-${system}`).length;
  }
  assert.equal(aiOccupiedSystemIds(benchmarkState).length, 400);
}
const benchmarkMs = performance.now() - benchmarkStartedAt;
assert.equal(matches, 108_000, 'indexed stress lookup should return deterministic membership');
assert.equal(factionMatches, 8_000, 'indexed faction summaries should return deterministic membership');
assert.ok(
  benchmarkMs < 250,
  `5,400-ship indexed stress lookup took ${benchmarkMs.toFixed(1)}ms (limit 250ms)`,
);

console.log('AI ship system index verification passed', {
  ships: benchmarkState.aiShips.length,
  systems: 400,
  queries: 8_000,
  matches,
  factionMatches,
  wallMs: Math.round(benchmarkMs * 10) / 10,
});
