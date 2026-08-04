#!/usr/bin/env node

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { HULL_STATS } from '../src/js/constants.js';
import { invalidateAiShipSystemIndex } from '../src/js/ai-ships.js';
import {
  createDefaultLogisticsState,
  routeSecuritySummary,
} from '../src/js/logistics.js';

function ship(id, systemId, factionId = 'ai-0', overrides = {}) {
  const stats = HULL_STATS.corvette;
  return {
    id,
    hull: 'corvette',
    galaxyId: 'gal-0',
    systemId,
    factionId,
    hp: stats.hp,
    maxHp: stats.hp,
    transit: null,
    ...overrides,
  };
}

function fixture(aiShips = []) {
  return {
    activeGalaxyId: 'gal-0',
    time: 1_000,
    research: { unlocked: [] },
    playerShips: [],
    aiShips,
    factions: {
      list: [{
        id: 'ai-0',
        credits: 0,
        research: { unlocked: [] },
        technology: { unlocked: [] },
      }],
    },
    systemBattles: {},
    logistics: createDefaultLogisticsState(),
    pirates: { fleets: [], nests: [] },
    galaxies: {
      'gal-0': {
        graph: {
          stars: [
            { id: 'A', x: 0, y: 0 },
            { id: 'B', x: 10, y: 0 },
          ],
          lanes: [['A', 'B']],
        },
        systems: {},
      },
    },
  };
}

const depot = {
  id: 'depot:gal-0:A',
  galaxyId: 'gal-0',
  systemId: 'A',
  ownerId: 'ai-0',
  level: 1,
  storedCredits: 0,
  doctrineId: 'standard',
};
const summaryFor = (state, path = ['A', 'B']) => (
  routeSecuritySummary(state, depot, { path, creditLoad: 0 })
);

{
  const state = fixture([
    ship('on-route', 'A'),
    ship('off-route', 'C'),
    ship('other-faction', 'A', 'ai-1'),
    ship('dead', 'A', 'ai-0', { hp: 0 }),
    ship('moving', null, 'ai-0', { transit: { path: ['A', 'B'] } }),
    ship('legacy-missing-galaxy', 'A', 'ai-0', { galaxyId: undefined }),
  ]);
  const initial = summaryFor(state);
  const expectedCorvettePower = HULL_STATS.corvette.dps + HULL_STATS.corvette.hp / 20;
  assert.equal(
    initial.patrolPower,
    expectedCorvettePower,
    'patrol membership should match the original galaxy, owner, transit, and HP filters',
  );

  state.time += 50;
  assert.equal(
    summaryFor(state).patrolPower,
    initial.patrolPower,
    'time advancing without a ship mutation should preserve cached patrol membership',
  );

  state.aiShips[0].hp = 0;
  invalidateAiShipSystemIndex(state);
  assert.equal(
    summaryFor(state).patrolPower,
    0,
    'explicit HP invalidation should remove a destroyed patrol ship immediately',
  );

  state.aiShips[1].systemId = 'B';
  invalidateAiShipSystemIndex(state);
  assert.ok(
    summaryFor(state).patrolPower > 0,
    'explicit location invalidation should add an arriving patrol ship immediately',
  );

  const beforeGrowth = summaryFor(state).patrolPower;
  state.aiShips.push(ship('array-growth', 'A'));
  assert.ok(
    summaryFor(state).patrolPower > beforeGrowth,
    'same-array growth should invalidate patrol membership through the ship-count guard',
  );

  state.playerShips.push(ship('player-patrol', 'A', 'player'));
  const playerDepot = { ...depot, ownerId: 'player' };
  const playerInitial = routeSecuritySummary(state, playerDepot, {
    path: ['A', 'B'],
    creditLoad: 0,
  }).patrolPower;
  state.playerShips[0].systemId = 'C';
  assert.equal(
    routeSecuritySummary(state, playerDepot, {
      path: ['A', 'B'],
      creditLoad: 0,
    }).patrolPower,
    0,
    'player patrol power should observe same-tick location changes without a cached player index',
  );
  assert.ok(playerInitial > 0);
}

{
  const systems = 400;
  const state = fixture(Array.from({ length: 7_400 }, (_, index) => (
    ship(`stress-${index}`, `sys-${index % systems}`, `ai-${index % 4}`)
  )));
  const path = Array.from({ length: 20 }, (_, index) => `sys-${index}`);
  const stressDepot = { ...depot, systemId: path[0] };
  const startedAt = performance.now();
  let patrolPower = 0;
  for (let pass = 0; pass < 5_000; pass++) {
    patrolPower += routeSecuritySummary(state, stressDepot, {
      path,
      creditLoad: 0,
    }).patrolPower;
  }
  const wallMs = performance.now() - startedAt;
  assert.ok(patrolPower > 0);
  assert.ok(
    wallMs < 500,
    `7,400-ship cached patrol stress took ${wallMs.toFixed(1)}ms (limit 500ms)`,
  );
  console.log('Logistics patrol index verification passed', {
    ships: state.aiShips.length,
    systems,
    queries: 5_000,
    pathSystems: path.length,
    wallMs: Math.round(wallMs * 10) / 10,
  });
}
