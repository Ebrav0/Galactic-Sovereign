import assert from 'node:assert/strict';

import {
  commerceConvoyTraffic,
  convoyNexusServiceStatus,
  convoyReturnTransitStatus,
  createDefaultLogisticsState,
} from '../src/js/logistics.js';

function system(id, kind = 'yellow') {
  return {
    id,
    name: id,
    owner: kind === 'trade_nexus' ? 'neutral' : 'player',
    star: { kind, radius: kind === 'trade_nexus' ? 110 : 100 },
    bodies: [],
    structures: [],
    tradeNexus: kind === 'trade_nexus'
      ? { openAccess: true, acceptsPlayerTrade: true }
      : undefined,
  };
}

const state = {
  time: 1000,
  activeGalaxyId: 'gal-0',
  homeGalaxyId: 'gal-0',
  logistics: createDefaultLogisticsState(),
  galaxies: {
    'gal-0': {
      id: 'gal-0',
      graph: {
        stars: [
          { id: 'A', x: 0, y: 0 },
          { id: 'B', x: 5, y: 0 },
          { id: 'N', x: 10, y: 0 },
        ],
        blackHole: { id: 'core', x: 100, y: 100 },
        lanes: [['A', 'B'], ['B', 'N']],
      },
      systems: {
        A: system('A'),
        B: system('B'),
        N: system('N', 'trade_nexus'),
      },
    },
  },
};

const convoy = {
  id: 'convoy-visual-7',
  galaxyId: 'gal-0',
  ownerId: 'player',
  fromSystemId: 'A',
  destinationSystemId: 'N',
  currentNodeId: 'N',
  systemId: 'N',
  path: ['A', 'B', 'N'],
  status: 'delivered',
  deliveredAt: 1000,
  creditLoad: 400,
  convoySpeed: 1000,
};
state.logistics.convoys.push(convoy);

const timing = {
  approachMs: 100,
  berthMs: 50,
  unloadMs: 200,
  departureMs: 100,
  returnJumpMs: 100,
  originApproachMs: 100,
};
const options = {
  timing,
  config: {
    minLegMs: 100,
    convoySpeed: 1000,
  },
};

const phases = [];
function serviceAt(time) {
  state.time = time;
  const projection = convoyNexusServiceStatus(state, convoy, options);
  phases.push(projection?.phase ?? null);
  return projection;
}

const approach = serviceAt(1050);
assert.equal(approach.phase, 'approach');
assert.equal(approach.progress, 0.5);
assert.equal(approach.cargoRatio, 1);

const berth = serviceAt(1125);
assert.equal(berth.phase, 'berthing');
assert.equal(berth.portIndex, approach.portIndex, 'Dock assignment must remain stable');

const unloading = serviceAt(1250);
assert.equal(unloading.phase, 'unloading');
assert.equal(unloading.progress, 0.5);
assert.equal(unloading.cargoRatio, 0.5);

const departing = serviceAt(1400);
assert.equal(departing.phase, 'departing');
assert.equal(departing.cargoRatio, 0);
assert.equal(commerceConvoyTraffic(state, 'gal-0', options)[0].nexus.phase, 'departing');

const simultaneous = {
  ...convoy,
  id: 'convoy-visual-13',
};
state.logistics.convoys.push(simultaneous);
const occupiedPorts = commerceConvoyTraffic(state, 'gal-0', options)
  .map((entry) => entry.nexus?.portIndex)
  .filter(Number.isInteger);
assert.equal(new Set(occupiedPorts).size, occupiedPorts.length, 'Simultaneous ships must use different ports');
state.logistics.convoys.pop();

state.time = 1500;
const returnJump = convoyReturnTransitStatus(state, convoy, options);
assert.equal(returnJump.phase, 'return_jumping');
assert.equal(returnJump.destinationSystemId, 'A');
assert.equal(returnJump.cargoRatio, 0);

state.time = 1600;
const firstReturnLeg = convoyReturnTransitStatus(state, convoy, options);
assert.equal(firstReturnLeg.phase, 'returning');
assert.equal(firstReturnLeg.fromId, 'N');
assert.equal(firstReturnLeg.toId, 'B');
assert.equal(firstReturnLeg.progress, 0.5);
assert.ok(firstReturnLeg.x < 10 && firstReturnLeg.x > 5);

state.time = 1750;
const originArrival = convoyReturnTransitStatus(state, convoy, options);
assert.equal(originArrival.phase, 'origin_arrival');
assert.equal(originArrival.toId, 'A');
assert.equal(originArrival.progress, 0);

state.time = 1850;
assert.equal(convoyReturnTransitStatus(state, convoy, options), null);
assert.equal(commerceConvoyTraffic(state, 'gal-0', options).length, 0);

console.log('Trade Nexus traffic verification passed', {
  phases,
  portIndex: approach.portIndex,
  returnPath: ['N', 'B', 'A'],
});
