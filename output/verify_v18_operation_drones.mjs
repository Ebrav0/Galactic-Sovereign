import assert from 'node:assert/strict';

import { createNewGame, systemById } from '../src/js/state.js';
import { allTechNodes } from '../src/js/tech-web.js';
import { initBuilderDrones, spawnBuilderDrone, tickBuilderDrones } from '../src/js/builder-drones.js';
import {
  createBulkProductionOrder,
  previewBulkProductionOrder,
  tickBulkProduction,
} from '../src/js/bulk-production.js';
import { dispatchEmpireQueue } from '../src/js/empire-queue.js';
import { tickProduction } from '../src/js/production.js';
import { listConstructionTemplates } from '../src/js/construction-templates.js';
import { createExpansionCampaign, previewExpansionCampaign } from '../src/js/strategic-operations.js';
import { strategicIntegrationHooks, tickIntegratedStrategicOperations } from '../src/js/strategic-integration.js';
import { gatherIntel } from '../src/js/intel.js';
import { spawnPlayerShip, tickPlayerShips } from '../src/js/fleets.js';
import { crc32, deserialize } from '../src/js/save.js';
import { SAVE_VERSION } from '../src/js/constants.js';

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${label}`);
}

function builtShipyard(id, bodyId) {
  return {
    id,
    type: 'shipyard',
    bodyId,
    level: 1,
    builtAtTime: 0,
    hp: 900,
    maxHp: 900,
    operational: true,
    disabledUntil: 0,
    mothballed: false,
    builds: [],
  };
}

function lateGameState(seed = 181818) {
  const state = createNewGame(seed);
  state.paused = false;
  state.credits = 1_000_000_000;
  state.research.unlocked = allTechNodes().map((node) => node.id);
  const home = systemById(state, state.stronghold);
  const yard = builtShipyard(`v18-yard-${seed}`, home.bodies[0].id);
  home.structures = (home.structures ?? []).filter((structure) => structure.type !== 'shipyard');
  home.structures.push(yard);
  initBuilderDrones(state);
  return { state, home, yard };
}

function attachTarget(state, id = 'v18-target') {
  const galaxy = state.galaxies[state.activeGalaxyId];
  galaxy.graph.stars.push({ id, name: id, x: 50, y: 50, type: 'yellow' });
  galaxy.graph.lanes.push([state.stronghold, id]);
  galaxy.systems[id] = {
    id,
    name: 'V18 Target',
    owner: 'neutral',
    factionId: null,
    star: { kind: 'yellow' },
    bodies: [{
      id: `${id}-world`,
      name: 'V18 Prime',
      type: 'habitable',
      orbitRadius: 1,
      orbitPeriodMs: 1000,
      orbitPhase: 0,
      radius: 1,
      moons: [],
    }],
    structures: [],
    resourceTags: [],
    dyson: { completedShells: 0, disabled: false },
  };
  return id;
}

check('v20 is the active save format', () => assert.equal(SAVE_VERSION, 20));

{
  const { state } = lateGameState();
  const presets = Object.fromEntries(listConstructionTemplates(state)
    .filter((template) => template.preset)
    .map((template) => [template.id, template.doctrine]));
  check('all six presets carry distinct doctrine snapshots', () => {
    assert.deepEqual(Object.keys(presets).sort(), ['dyson', 'frontier', 'industrial', 'military', 'research', 'trade']);
    assert.equal(new Set(Object.values(presets).map((doctrine) => JSON.stringify(doctrine))).size, 6);
    assert.deepEqual(Object.fromEntries(Object.entries(presets).map(([id, doctrine]) => [id, doctrine.dronePayload])), {
      frontier: 2,
      industrial: 4,
      military: 3,
      research: 2,
      trade: 3,
      dyson: 5,
    });
  });

  const targetId = attachTarget(state);
  const previews = ['frontier', 'industrial', 'military', 'research', 'trade', 'dyson'].map((templateId) => (
    previewExpansionCampaign(state, {
      templateId,
      targets: [targetId],
      sourceSystemId: state.stronghold,
      ignoreTechnologyInPreview: true,
    }, { hooks: strategicIntegrationHooks() })
  ));
  check('every preset previews deterministic mixed ships, margins, drones, and build work', () => {
    assert.ok(previews.every((preview) => preview.ok));
    assert.ok(previews.every((preview) => preview.targets[0].projectedOperation.manifest.length > 0));
    assert.equal(new Set(previews.map((preview) => JSON.stringify(preview.targets[0].projectedOperation.manifest))).size, 6);
    assert.deepEqual(previews.map((preview) => preview.doctrine.dronePayload), [2, 4, 3, 2, 3, 5]);
    assert.ok(previews.every((preview) => preview.targets[0].projectedBuild.jobCount > 0));
  });
}

{
  const { state } = lateGameState(181821);
  const targetId = attachTarget(state, 'v18-lifecycle-target');
  gatherIntel(state, targetId);
  spawnBuilderDrone(state, state.stronghold);
  for (const hull of ['frigate', 'dreadnought', 'sensor_ship', 'builder_ship']) {
    spawnPlayerShip(state, state.stronghold, hull);
  }
  for (let index = 0; index < 12; index += 1) spawnPlayerShip(state, state.stronghold, 'corvette');
  const created = createExpansionCampaign(state, {
    name: 'Lifecycle verification',
    templateId: 'frontier',
    targets: [targetId],
    sourceSystemId: state.stronghold,
    ignoreTechnologyInPreview: true,
  }, { hooks: strategicIntegrationHooks() });
  assert.equal(created.ok, true, created.reason);
  const campaign = state.strategicOrders.campaigns.at(-1);
  const target = campaign.targets[0];
  const step = () => {
    state.time += 500;
    tickIntegratedStrategicOperations(state);
  };
  for (let index = 0; index < 8 && target.phase !== 'traveling'; index += 1) step();
  step();
  check('complete doctrine package embarks before campaign travel', () => {
    assert.equal(target.phase, 'traveling');
    assert.equal(target.droneTeam.status, 'embarked');
    assert.equal(target.droneTeam.droneIds.length, 2);
    assert.ok(target.dispatch.fleetIds.length > 0);
  });
  state.time += 1_000_000;
  tickPlayerShips(state, () => {});
  step();
  systemById(state, targetId).owner = 'player';
  for (let index = 0; index < 6 && target.phase !== 'constructing'; index += 1) step();
  step();
  check('captured task force disembarks its dedicated drone team for construction', () => {
    assert.equal(target.phase, 'constructing');
    assert.ok(['deployed', 'building'].includes(target.droneTeam.status)
      || target.construction?.status === 'active');
    assert.equal(target.droneTeam.droneIds.length, 2);
    assert.ok((target.construction?.orderIds ?? []).length > 0);
  });
  for (let index = 0; index < 20 && target.phase === 'constructing'; index += 1) {
    state.time += 250_000;
    tickBuilderDrones(state);
    tickIntegratedStrategicOperations(state);
  }
  for (let index = 0; index < 4 && target.phase !== 'complete'; index += 1) step();
  check('construction completes, surviving drones re-embark, and the target closes', () => {
    assert.equal(target.phase, 'complete');
    assert.equal(target.droneTeam.status, 'reembarked');
    assert.ok(target.construction.orderIds.every((id) => (
      state.builderConstructionOrders.find((order) => order.id === id)?.status === 'complete'
    )));
  });
}

{
  const { state, yard } = lateGameState(181819);
  check('technology unlock grants exactly two starter drones once', () => {
    assert.equal(state.builderDrones.length, 2);
    initBuilderDrones(state);
    assert.equal(state.builderDrones.length, 2);
  });
  const input = {
    name: 'Mixed ships and drones',
    manifest: [
      { hull: 'corvette', quantity: 1 },
      { kind: 'builder_drone', productId: 'builder_drone', quantity: 1 },
    ],
    priority: 'high',
    allowedShipyardIds: [yard.id],
    rally: { type: 'none' },
    packaging: null,
  };
  const preview = previewBulkProductionOrder(state, input);
  check('mixed legacy-hull and typed-drone manifests preview at exact cost', () => {
    assert.equal(preview.ok, true);
    assert.equal(preview.totalQuantity, 2);
    assert.equal(preview.config.manifest[1].kind, 'builder_drone');
    assert.equal(preview.totalCost, 300);
  });
  const order = createBulkProductionOrder(state, input);
  tickBulkProduction(state);
  dispatchEmpireQueue(state);
  state.time = Math.max(...yard.builds.map((build) => build.startedAt + build.durationMs));
  tickProduction(state);
  check('Construction Drone uses a shared physical shipyard slot and completes as an owned drone', () => {
    assert.equal(order.ok, true);
    assert.equal(state.builderDrones.length, 3);
    assert.ok(state.bulkProductionDeliveries.some((delivery) => delivery.kind === 'builder_drone' && delivery.droneId));
  });
  const capPreview = previewBulkProductionOrder(state, {
    ...input,
    manifest: [{ kind: 'builder_drone', productId: 'builder_drone', quantity: 94 }],
  });
  check('owned plus aggregate-queued drones cannot exceed 96', () => {
    assert.equal(capPreview.ok, false);
    assert.ok(capPreview.errors.some((error) => error.code === 'builder_drone_cap'));
  });
}

{
  const legacy = createNewGame(171718);
  legacy.strategicOrders = {
    version: 1,
    nextCampaignId: 2,
    nextTemplateId: 2,
    templates: [{
      id: 'template-1',
      name: 'Legacy Template',
      version: 1,
      steps: [{
        id: 'outpost',
        structureType: 'outpost',
        selector: 'best_habitable_planet',
        required: true,
        onUnavailable: 'wait',
      }],
    }],
    campaigns: [{
      id: 'expansion-1',
      name: 'Legacy In Flight',
      status: 'active',
      templateId: 'template-1',
      templateSnapshot: legacy.strategicOrders?.templates?.[0],
      source: { galaxyId: legacy.activeGalaxyId, systemId: legacy.stronghold },
      policy: {},
      targets: [
        { id: 'target-1', galaxyId: legacy.activeGalaxyId, systemId: legacy.stronghold, phase: 'traveling' },
        { id: 'target-2', galaxyId: legacy.activeGalaxyId, systemId: legacy.stronghold, phase: 'staging' },
      ],
    }],
  };
  const stateJson = JSON.stringify(legacy);
  const loaded = deserialize(JSON.stringify({
    saveVersion: 17,
    checksum: crc32(stateJson),
    savedAt: 1,
    state: legacy,
  }));
  check('v17 migration adds Generalist doctrine and preserves in-flight legacy execution', () => {
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.strategicOrders.version, 2);
    assert.equal(loaded.state.strategicOrders.templates[0].version, 2);
    assert.equal(loaded.state.strategicOrders.templates[0].doctrine.dronePayload, 2);
    assert.equal(loaded.state.strategicOrders.campaigns[0].targets[0].executionVersion, 1);
    assert.equal(loaded.state.strategicOrders.campaigns[0].targets[1].executionVersion, 2);
  });
}

console.log(`\n${passed}/${passed} v18 operation-drone checks passed`);
