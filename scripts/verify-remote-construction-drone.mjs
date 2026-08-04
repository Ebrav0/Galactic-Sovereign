import assert from 'node:assert/strict';

import {
  BUILDER_DRONE_DEPLOY_COST,
  OUTPOST_COST,
} from '../src/js/constants.js';
import {
  confirmBuilderConstructionPlan,
  deployBuilderDrone,
  initBuilderDrones,
  tickBuilderDrones,
} from '../src/js/builder-drones.js';
import { createNewGame } from '../src/js/state.js';

function fixture(seed = 779) {
  const state = createNewGame(seed);
  state.research.unlocked.push('eco_construction_drones');
  state.credits = 10_000;
  state.paused = false;
  initBuilderDrones(state);

  const galaxy = state.galaxies[state.activeGalaxyId];
  const neighbours = galaxy.graph.lanes
    .map(([from, to]) => from === state.stronghold ? to : to === state.stronghold ? from : null)
    .filter((systemId) => systemId && galaxy.systems[systemId]);
  const neighbourId = neighbours.find(
    (systemId) => galaxy.systems[systemId].bodies.some((body) => body.type === 'habitable'),
  ) ?? neighbours[0];
  assert.ok(neighbourId, 'fixture requires a neighbouring system');
  const target = galaxy.systems[neighbourId];
  if (!target.bodies.some((body) => body.type === 'habitable')) {
    const template = galaxy.systems[state.stronghold].bodies.find((body) => body.type === 'habitable');
    target.bodies = [{
      ...structuredClone(template),
      id: `remote-world-${seed}`,
      name: 'Remote Test World',
    }];
  }
  target.owner = 'player';
  const body = target.bodies.find((entry) => entry.type === 'habitable');
  return { state, targetId: neighbourId, bodyId: body.id };
}

function outpostDraft(bodyId) {
  return [{ clientId: 'remote-outpost', bodyId, structureType: 'outpost' }];
}

{
  const { state, targetId, bodyId } = fixture();
  const creditsBefore = state.credits;
  const result = confirmBuilderConstructionPlan(state, targetId, outpostDraft(bodyId));

  assert.equal(result.ok, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCost, BUILDER_DRONE_DEPLOY_COST);
  assert.equal(result.grandTotal, OUTPOST_COST + BUILDER_DRONE_DEPLOY_COST);
  assert.equal(state.credits, creditsBefore - result.grandTotal);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].status, 'queued');
  assert.equal(
    state.builderDrones.find((drone) => drone.id === result.droneId)?.status,
    'outbound',
  );

  state.time += 120_000;
  tickBuilderDrones(state);
  tickBuilderDrones(state);
  assert.equal(result.orders[0].status, 'active');

  state.time += result.orders[0].workRequiredMs + 100;
  tickBuilderDrones(state);
  assert.equal(result.orders[0].status, 'complete');
  assert.ok(
    state.galaxies[state.activeGalaxyId].systems[targetId].structures
      .some((structure) => structure.type === 'outpost' && structure.bodyId === bodyId),
  );
}

{
  const { state, targetId, bodyId } = fixture(780);
  state.credits = OUTPOST_COST + BUILDER_DRONE_DEPLOY_COST - 1;
  const creditsBefore = state.credits;
  const result = confirmBuilderConstructionPlan(state, targetId, outpostDraft(bodyId));

  assert.equal(result.ok, false);
  assert.match(result.reason, new RegExp(`Need ${OUTPOST_COST + BUILDER_DRONE_DEPLOY_COST}`));
  assert.equal(state.credits, creditsBefore);
  assert.equal(state.builderConstructionOrders.length, 0);
  assert.ok(state.builderDrones.every((drone) => drone.status === 'idle'));
}

{
  const { state, targetId, bodyId } = fixture(781);
  const dispatch = deployBuilderDrone(state, targetId);
  assert.equal(dispatch.ok, true);
  const creditsBeforePlan = state.credits;
  const result = confirmBuilderConstructionPlan(state, targetId, outpostDraft(bodyId));

  assert.equal(result.ok, true);
  assert.equal(result.dispatched, false);
  assert.equal(result.dispatchCost, 0);
  assert.equal(state.credits, creditsBeforePlan - OUTPOST_COST);
  assert.equal(result.orders[0].status, 'queued');
}

console.log('remote construction drone verification passed');
