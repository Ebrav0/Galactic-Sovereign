#!/usr/bin/env node

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  buildGeodesicMesh,
  foundryLauncherSupplyLines,
  inFlightSailDots,
} from '../src/js/dyson-visuals.js';
import { geodesicMeshForRender } from '../src/js/dyson-megastructure-render.js';
import { sailShuttlePositions } from '../src/js/sail-shuttles.js';
import { structureSites } from '../src/js/structure-sites.js';
import {
  createNewGame,
  ensureDyson,
  systemById,
} from '../src/js/state.js';

const state = createNewGame(54);
state.time = 1_234_500;
const systemId = state.stronghold;
const system = systemById(state, systemId);
const host = system.bodies.find((body) => body.type === 'habitable') ?? system.bodies[0];

system.structures.push({
  id: 'site-reuse-foundry',
  type: 'sail_foundry',
  bodyId: host.id,
  builtAtTime: state.time - 10_000,
  level: 1,
  operational: true,
});

const launcherCount = 57;
for (let index = 0; index < launcherCount; index += 1) {
  const body = index % 3 === 0 && host.moons?.length
    ? host.moons[index % host.moons.length]
    : host;
  system.structures.push({
    id: `site-reuse-launcher-${String(index).padStart(2, '0')}`,
    type: 'dyson_launcher',
    bodyId: body.id,
    builtAtTime: state.time - 5_000,
    level: 1,
    operational: true,
  });
}

const dyson = ensureDyson(system);
dyson.shellSails = 4;
dyson.launcherLastFireAt['site-reuse-launcher-00'] = state.time - 100;

const starRadius = system.star.radius;
const sites = structureSites(state, systemId, state.time);
const launcherSites = sites.filter((site) => site.kind === 'launcher');
assert.equal(launcherSites.length, launcherCount, 'fixture exposes every launcher site');

const withoutSnapshot = {
  lines: foundryLauncherSupplyLines(state, systemId, state.time),
  dots: inFlightSailDots(state, systemId, starRadius, state.time),
  shuttles: sailShuttlePositions(state, systemId, state.time),
};
const withSnapshot = {
  lines: foundryLauncherSupplyLines(state, systemId, state.time, sites),
  dots: inFlightSailDots(state, systemId, starRadius, state.time, sites),
  shuttles: sailShuttlePositions(state, systemId, state.time, sites),
};

assert.deepEqual(withSnapshot, withoutSnapshot, 'frame snapshot preserves all visual output');
assert.equal(withSnapshot.lines.length, launcherCount, 'one supply tie remains per launcher');
assert.equal(withSnapshot.shuttles.length, launcherCount, 'one shuttle remains per launcher');
assert.equal(withSnapshot.dots.length, 1, 'active launcher retains its in-flight sail');

const firstLauncher = launcherSites.find(
  (site) => site.launcherId === 'site-reuse-launcher-00',
);
const sentinelSites = sites.map((site) => (
  site !== firstLauncher
    ? site
    : {
      ...site,
      dockX: site.dockX + 1_000,
      dockY: site.dockY - 700,
      muzzleX: site.muzzleX + 900,
      muzzleY: site.muzzleY - 600,
    }
));
const sentinelLines = foundryLauncherSupplyLines(
  state,
  systemId,
  state.time,
  sentinelSites,
);
const sentinelDots = inFlightSailDots(
  state,
  systemId,
  starRadius,
  state.time,
  sentinelSites,
);
const sentinelShuttles = sailShuttlePositions(
  state,
  systemId,
  state.time,
  sentinelSites,
);
const sentinelLine = sentinelLines.find((line) => line.launcherId === firstLauncher.launcherId);
const sentinelShuttle = sentinelShuttles.find(
  (shuttle) => shuttle.launcherId === firstLauncher.launcherId,
);

assert.equal(sentinelLine.toX, firstLauncher.dockX + 1_000, 'supply tie consumes snapshot dock');
assert.equal(sentinelLine.toY, firstLauncher.dockY - 700, 'supply tie consumes snapshot dock Y');
assert.equal(sentinelShuttle.toX, firstLauncher.dockX + 1_000, 'shuttle consumes snapshot dock');
assert.equal(sentinelShuttle.toY, firstLauncher.dockY - 700, 'shuttle consumes snapshot dock Y');
assert.notDeepEqual(sentinelDots, withSnapshot.dots, 'in-flight sails consume snapshot muzzle');
assert.equal(
  sailShuttlePositions(state, systemId, state.time, []).length,
  0,
  'a supplied snapshot is authoritative and cannot restore quadratic fallback scans',
);

function timed(iterations, callback) {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) callback();
  return performance.now() - startedAt;
}

const iterations = 50;
const snapshotMs = timed(iterations, () => {
  foundryLauncherSupplyLines(state, systemId, state.time, sites);
  inFlightSailDots(state, systemId, starRadius, state.time, sites);
  sailShuttlePositions(state, systemId, state.time, sites);
});

const expectedMesh = buildGeodesicMesh(starRadius, 8, state.seed);
const cachedMesh = geodesicMeshForRender(starRadius, 8, state.seed);
const cachedAgain = geodesicMeshForRender(starRadius, 8, state.seed);
assert.deepEqual(cachedMesh, expectedMesh, 'mesh cache preserves every deterministic node and edge');
assert.equal(cachedAgain, cachedMesh, 'identical mesh inputs reuse the exact immutable draw result');
assert.notEqual(
  geodesicMeshForRender(starRadius + 1, 8, state.seed),
  cachedMesh,
  'radius invalidates the mesh cache',
);
assert.notEqual(
  geodesicMeshForRender(starRadius, 7, state.seed),
  cachedMesh,
  'shell tier invalidates the mesh cache',
);
assert.notEqual(
  geodesicMeshForRender(starRadius, 8, state.seed + 1),
  cachedMesh,
  'system seed invalidates the mesh cache',
);

console.log('Dyson visual site reuse: PASS');
console.log(`  launchers=${launcherCount} iterations=${iterations} snapshotMs=${snapshotMs.toFixed(3)}`);
