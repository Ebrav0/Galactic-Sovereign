#!/usr/bin/env node

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { logisticsLaneKey, shortestRoute } from '../src/js/logistics.js';

const EPSILON = 1e-7;

function gridGraph(width, height) {
  const stars = [];
  const lanes = [];
  const id = (x, y) => `n-${String(y * width + x).padStart(3, '0')}`;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      stars.push({ id: id(x, y), x: x * 10, y: y * 10 });
      if (x > 0) lanes.push([id(x - 1, y), id(x, y)]);
      if (y > 0) lanes.push([id(x, y - 1), id(x, y)]);
      if (x > 0 && y > 0 && (x + y) % 3 === 0) {
        lanes.push([id(x - 1, y - 1), id(x, y)]);
      }
    }
  }
  return { stars, blackHole: null, lanes };
}

function referenceTopology(graph) {
  const nodes = new Map(graph.stars.map((star) => [star.id, star]));
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const [leftId, rightId] of graph.lanes) {
    const left = nodes.get(leftId);
    const right = nodes.get(rightId);
    if (!left || !right) continue;
    const distance = Math.hypot(left.x - right.x, left.y - right.y);
    const key = logisticsLaneKey(leftId, rightId);
    adjacency.get(leftId).push({ id: rightId, distance, key });
    adjacency.get(rightId).push({ id: leftId, distance, key });
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.id.localeCompare(right.id));
  }
  return { nodes, adjacency };
}

function sortedQueueShortestRoute(topology, fromSystemId, toSystemId, options = {}) {
  const { nodes, adjacency } = topology;
  if (!nodes.has(fromSystemId) || !nodes.has(toSystemId)) return null;
  if (fromSystemId === toSystemId) return [fromSystemId];
  const blockedLanes = options.blockedLanes instanceof Set
    ? options.blockedLanes
    : new Set(options.blockedLanes ?? []);
  const blockedSystems = options.blockedSystems instanceof Set
    ? options.blockedSystems
    : new Set(options.blockedSystems ?? []);
  if (blockedSystems.has(toSystemId)) return null;

  const bestDistance = new Map([[fromSystemId, 0]]);
  const bestPathKey = new Map([[fromSystemId, fromSystemId]]);
  const previous = new Map();
  const queue = [{ id: fromSystemId, distance: 0, pathKey: fromSystemId }];
  while (queue.length) {
    queue.sort((left, right) => (
      left.distance - right.distance || left.pathKey.localeCompare(right.pathKey)
    ));
    const current = queue.shift();
    if (current.distance > (bestDistance.get(current.id) ?? Infinity) + EPSILON) continue;
    if (current.id === toSystemId) break;
    for (const edge of adjacency.get(current.id) ?? []) {
      if (blockedLanes.has(edge.key)) continue;
      if (edge.id !== toSystemId && blockedSystems.has(edge.id)) continue;
      const distance = current.distance + edge.distance;
      const pathKey = `${current.pathKey}>${edge.id}`;
      const knownDistance = bestDistance.get(edge.id) ?? Infinity;
      const knownKey = bestPathKey.get(edge.id) ?? '\uffff';
      if (distance < knownDistance - EPSILON
        || (Math.abs(distance - knownDistance) <= EPSILON && pathKey < knownKey)) {
        bestDistance.set(edge.id, distance);
        bestPathKey.set(edge.id, pathKey);
        previous.set(edge.id, current.id);
        queue.push({ id: edge.id, distance, pathKey });
      }
    }
  }
  if (!previous.has(toSystemId)) return null;
  const path = [toSystemId];
  let cursor = toSystemId;
  while (cursor !== fromSystemId) {
    cursor = previous.get(cursor);
    if (!cursor) return null;
    path.push(cursor);
  }
  return path.reverse();
}

const tieGraph = {
  stars: [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 1, y: 1 },
    { id: 'C', x: 1, y: -1 },
    { id: 'D', x: 2, y: 0 },
  ],
  blackHole: null,
  lanes: [['A', 'B'], ['B', 'D'], ['A', 'C'], ['C', 'D']],
};
assert.deepEqual(
  shortestRoute(tieGraph, 'A', 'D'),
  ['A', 'B', 'D'],
  'equal-distance routes should retain lexical path tie-breaking',
);
assert.deepEqual(
  shortestRoute(tieGraph, 'A', 'D', { blockedLanes: new Set(['A|B']) }),
  ['A', 'C', 'D'],
  'lane blockades should still reroute',
);
assert.equal(
  shortestRoute(tieGraph, 'A', 'D', { blockedSystems: new Set(['B', 'C']) }),
  null,
  'system blockades should still return no route when every path is closed',
);
{
  const mutableBlockades = new Set();
  const cachedPath = shortestRoute(tieGraph, 'A', 'D', { blockedLanes: mutableBlockades });
  cachedPath.push('caller-mutation');
  assert.deepEqual(
    shortestRoute(tieGraph, 'A', 'D', { blockedLanes: mutableBlockades }),
    ['A', 'B', 'D'],
    'cached paths should be isolated from caller mutations',
  );
  mutableBlockades.add('A|B');
  assert.deepEqual(
    shortestRoute(tieGraph, 'A', 'D', { blockedLanes: mutableBlockades }),
    ['A', 'C', 'D'],
    'same-set blockade mutations should produce a fresh route signature',
  );
  mutableBlockades.delete('A|B');
  assert.deepEqual(
    shortestRoute(tieGraph, 'A', 'D', { blockedLanes: mutableBlockades }),
    ['A', 'B', 'D'],
    'removing a same-set blockade should recover the original route',
  );
}
{
  const topologyGraph = structuredClone(tieGraph);
  assert.deepEqual(shortestRoute(topologyGraph, 'A', 'D'), ['A', 'B', 'D']);
  topologyGraph.lanes.push(['A', 'D']);
  assert.deepEqual(
    shortestRoute(topologyGraph, 'A', 'D'),
    ['A', 'D'],
    'graph growth should invalidate both topology and route caches',
  );
  topologyGraph.lanes = topologyGraph.lanes.filter(([left, right]) => (
    !(left === 'A' && right === 'D')
  ));
  assert.deepEqual(
    shortestRoute(topologyGraph, 'A', 'D'),
    ['A', 'B', 'D'],
    'graph array replacement should invalidate both topology and route caches',
  );
}

const parityGraph = gridGraph(12, 12);
const parityTopology = referenceTopology(parityGraph);
const parityIds = parityGraph.stars.map((star) => star.id);
let parityCases = 0;
for (let index = 0; index < 180; index++) {
  const from = parityIds[(index * 37) % parityIds.length];
  const to = parityIds[(index * 83 + 11) % parityIds.length];
  const blockedLanes = index % 3 === 0
    ? new Set(parityGraph.lanes
      .filter((_, laneIndex) => laneIndex % 47 === index % 47)
      .map(([left, right]) => logisticsLaneKey(left, right)))
    : new Set();
  const blockedSystems = index % 5 === 0
    ? new Set(parityIds.filter((_, nodeIndex) => nodeIndex % 53 === index % 53))
    : new Set();
  const options = { blockedLanes, blockedSystems };
  assert.deepEqual(
    shortestRoute(parityGraph, from, to, options),
    sortedQueueShortestRoute(parityTopology, from, to, options),
    `heap route should match the sorted-queue reference for case ${index}`,
  );
  parityCases += 1;
}

const performanceGraph = gridGraph(25, 16);
const performanceTopology = referenceTopology(performanceGraph);
const performanceIds = performanceGraph.stars.map((star) => star.id);
const queries = Array.from({ length: 160 }, (_, index) => ({
  from: performanceIds[(index * 97) % performanceIds.length],
  to: performanceIds[(index * 211 + 173) % performanceIds.length],
  options: index % 7 === 0
    ? {
      blockedLanes: new Set(performanceGraph.lanes
        .filter((_, laneIndex) => laneIndex % 89 === index % 89)
        .map(([left, right]) => logisticsLaneKey(left, right))),
    }
    : {},
}));

function benchmark(run) {
  let bestMs = Infinity;
  let checksum = 0;
  for (let round = 0; round < 3; round++) {
    const startedAt = performance.now();
    let roundChecksum = 0;
    for (const query of queries) {
      roundChecksum += run(query)?.length ?? 0;
    }
    bestMs = Math.min(bestMs, performance.now() - startedAt);
    checksum = roundChecksum;
  }
  return { bestMs, checksum };
}

// Warm both implementations before recording the best of three bounded runs.
shortestRoute(performanceGraph, queries[0].from, queries[0].to, queries[0].options);
sortedQueueShortestRoute(
  performanceTopology,
  queries[0].from,
  queries[0].to,
  queries[0].options,
);
const sortedQueue = benchmark((query) => sortedQueueShortestRoute(
  performanceTopology,
  query.from,
  query.to,
  query.options,
));
const binaryHeap = benchmark((query) => shortestRoute(
  performanceGraph,
  query.from,
  query.to,
  query.options,
));
assert.equal(binaryHeap.checksum, sortedQueue.checksum, 'benchmark routes should remain equivalent');
assert.ok(
  binaryHeap.bestMs < sortedQueue.bestMs * 0.75,
  `binary heap ${binaryHeap.bestMs.toFixed(1)}ms did not beat sorted queue ${sortedQueue.bestMs.toFixed(1)}ms by 25%`,
);

console.log('Logistics shortest-route verification passed', {
  parityCases,
  nodes: performanceGraph.stars.length,
  lanes: performanceGraph.lanes.length,
  performanceQueries: queries.length,
  sortedQueueMs: Math.round(sortedQueue.bestMs * 10) / 10,
  binaryHeapMs: Math.round(binaryHeap.bestMs * 10) / 10,
  speedup: Math.round((sortedQueue.bestMs / binaryHeap.bestMs) * 100) / 100,
});
