// Direct deterministic verifier for src/js/logistics.js (no browser or DOM required).

import {
  addCargo,
  cargoCreditValue,
  cargoManifestFromInventory,
  cargoProductionForOutpost,
  cargoTotal,
  convoyTransitStatus,
  createDefaultLogisticsState,
  depotSummary,
  discoverTradeNexuses,
  dispatchDepot,
  ensureLogisticsState,
  exportDepotId,
  interceptConvoy,
  isLaneBlockaded,
  logisticsSummary,
  pauseConvoy,
  registerExportDepot,
  rerouteConvoy,
  resumeConvoy,
  resumeDepotRoute,
  setDepotOperational,
  setLaneBlockade,
  setSystemBlockade,
  shortestRoute,
  subtractCargo,
  syncExportDepots,
  tickLogistics,
} from '../src/js/logistics.js';

const results = [];
function check(name, condition, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

function near(actual, expected, epsilon = 1e-6) {
  return Math.abs(actual - expected) <= epsilon;
}

const FAST_CONFIG = {
  productionRates: {
    habitable: { rawMaterials: 20, fuel: 10, manufacturedGoods: 10 },
  },
  moonProductionBonus: 0,
  outpostStockCapacity: 1000,
  localDispatchCargo: 1,
  localTransportCapacity: 100,
  localTransitMs: 50,
  localDispatchIntervalMs: 0,
  depotCapacity: 1000,
  minDispatchCargo: 1,
  convoyCapacity: 100,
  convoyDispatchIntervalMs: 100000,
  jumpDurationMs: 50,
  convoySpeed: 1000,
  minLegMs: 50,
  cargoValues: { rawMaterials: 4, fuel: 6, manufacturedGoods: 10 },
};

function makeSystem(id, owner = 'neutral', starKind = 'yellow') {
  return {
    id,
    name: id,
    owner,
    star: { kind: starKind, radius: 100 },
    bodies: [],
    structures: [],
    dyson: {},
  };
}

function fixture({ nexus = true, depotStructure = true } = {}) {
  const graph = {
    stars: [
      { id: 'A', name: 'A', x: 0, y: 0 },
      { id: 'B', name: 'B', x: 4, y: 0 },
      { id: 'C', name: 'C', x: 0, y: 8 },
      { id: 'N', name: 'N', x: 10, y: 0 },
    ],
    blackHole: { id: 'core', name: 'Core', x: 100, y: 100 },
    lanes: [['A', 'B'], ['B', 'N'], ['A', 'C'], ['C', 'N']],
  };
  const a = makeSystem('A', 'player');
  a.bodies.push({
    id: 'p1', kind: 'planet', type: 'habitable', name: 'A-I',
    moons: [{ id: 'm1' }, { id: 'm2' }],
  });
  a.structures.push({ id: 'outpost-a', type: 'outpost', bodyId: 'p1', builtAtTime: 0 });
  if (depotStructure) {
    a.structures.push({ id: 'depot-structure-a', type: 'export_depot', bodyId: null, builtAtTime: 0 });
  }
  const systems = {
    A: a,
    B: makeSystem('B'),
    C: makeSystem('C'),
    N: makeSystem('N', 'neutral', nexus ? 'trade_nexus' : 'yellow'),
  };
  return {
    meta: { seed: 42 },
    time: 0,
    credits: 0,
    paused: false,
    activeGalaxyId: 'gal-0',
    homeGalaxyId: 'gal-0',
    galaxies: {
      'gal-0': { id: 'gal-0', status: 'active', graph, systems },
    },
    logistics: createDefaultLogisticsState(),
  };
}

function stepLogistics(state, ticks, config = FAST_CONFIG) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    state.time += 50;
    events.push(...tickLogistics(state, { config }));
  }
  return events;
}

// Pure cargo helpers.
{
  const inventory = { rawMaterials: 12, fuel: 6, manufacturedGoods: 2 };
  const manifest = cargoManifestFromInventory(inventory, 10);
  check('1.1 proportional manifest respects capacity', near(cargoTotal(manifest), 10), JSON.stringify(manifest));
  check('1.2 cargo subtraction conserves quantities',
    near(cargoTotal(addCargo(subtractCargo(inventory, manifest), manifest)), cargoTotal(inventory)));
  check('1.3 cargo credit valuation', cargoCreditValue({ rawMaterials: 1, fuel: 1, manufacturedGoods: 1 }) === 20);
}

// Nexus discovery and deterministic weighted routing.
{
  const state = fixture();
  const graph = state.galaxies['gal-0'].graph;
  const nexusList = discoverTradeNexuses(state, 'gal-0');
  check('2.1 discovers star.kind trade_nexus',
    nexusList.length === 1 && nexusList[0].systemId === 'N' && nexusList[0].available);
  check('2.2 shortest route uses weighted lane distance',
    shortestRoute(graph, 'A', 'N').join('>') === 'A>B>N');
  check('2.3 shortest route has deterministic blocked-lane alternative',
    shortestRoute(graph, 'A', 'N', { blockedLanes: new Set(['B|N']) }).join('>') === 'A>C>N');
  check('2.4 blocked destination is unreachable',
    shortestRoute(graph, 'A', 'N', { blockedSystems: new Set(['N']) }) === null);
}

// Structure synchronization, outpost production, local delivery, jump, route, payout.
{
  const state = fixture();
  const synced = syncExportDepots(state, 'gal-0', { config: FAST_CONFIG });
  const depotId = exportDepotId('gal-0', 'A');
  check('3.1 sync registers export_depot structure', synced.length === 1 && !!state.logistics.depots[depotId]);

  const production = cargoProductionForOutpost(
    state.galaxies['gal-0'].systems.A,
    state.galaxies['gal-0'].systems.A.structures[0],
    50,
    { config: FAST_CONFIG },
  );
  check('3.2 deterministic three-class outpost production',
    production.rawMaterials === 1 && production.fuel === 0.5 && production.manufacturedGoods === 0.5,
    JSON.stringify(production));

  const events = stepLogistics(state, 5);
  const convoy = state.logistics.convoys[0];
  check('3.3 physical local transport deposits before convoy dispatch',
    events.some((event) => event.type === 'local_transport_dispatched')
      && events.some((event) => event.type === 'cargo_arrived_at_depot')
      && events.some((event) => event.type === 'convoy_dispatched'));
  check('3.4 convoy records jump and shortest route', convoy.path.join('>') === 'A>B>N');
  check('3.5 convoy delivery pays only delivered cargo value',
    convoy.status === 'delivered' && near(state.credits, 12),
    `status=${convoy.status} credits=${state.credits}`);
  check('3.6 delivery summary exposes throughput and manifests',
    logisticsSummary(state, 'gal-0', { config: FAST_CONFIG }).throughputCreditsPerMinute === 12
      && state.logistics.stats.deliveredCargo.rawMaterials === 1);
}

// Blockade, explicit reroute, pause/resume, and render projection.
{
  const state = fixture({ depotStructure: false });
  const registered = registerExportDepot(state, 'gal-0', 'A', {
    config: FAST_CONFIG,
    inventory: { rawMaterials: 10, fuel: 10, manufacturedGoods: 10 },
  });
  const result = dispatchDepot(state, registered.depot.id, { config: FAST_CONFIG });
  const convoy = result.convoy;
  check('4.1 direct depot dispatch starts jump phase', result.ok && convoy.status === 'jumping');
  setLaneBlockade(state, 'gal-0', 'B', 'N', true);
  check('4.2 blockade hook is serializable and queryable',
    isLaneBlockaded(state, 'gal-0', 'N', 'B')
      && JSON.stringify(state.logistics.blockades).includes('gal-0:B|N'));
  const reroute = rerouteConvoy(state, convoy.id, null, { config: FAST_CONFIG });
  check('4.3 in-node convoy reroutes around blockade', reroute.ok && convoy.path.join('>') === 'A>C>N');

  const oldJumpEnd = convoy.jumpEndsAt;
  pauseConvoy(state, convoy.id, 'manual', { config: FAST_CONFIG });
  state.time += 500;
  const resumed = resumeConvoy(state, convoy.id, { config: FAST_CONFIG });
  check('4.4 pause/resume freezes jump timeline',
    resumed.ok && convoy.jumpEndsAt === oldJumpEnd + 500,
    `old=${oldJumpEnd} new=${convoy.jumpEndsAt}`);
  const status = convoyTransitStatus(state, convoy, { config: FAST_CONFIG });
  check('4.5 convoy status exposes jump projection and ETA',
    status.phase === 'jumping' && Number.isFinite(status.x) && Number.isFinite(status.etaMs));

  setSystemBlockade(state, 'gal-0', 'N', true);
  check('4.6 system blockade prevents fresh route',
    shortestRoute(state.galaxies['gal-0'].graph, 'A', 'N', { blockedSystems: new Set(['N']) }) === null);
}

// Interception/escort hooks, route pause, offline depot, and no-destination safety.
{
  const state = fixture({ depotStructure: false });
  const depot = registerExportDepot(state, 'gal-0', 'A', {
    config: FAST_CONFIG,
    inventory: { rawMaterials: 30, fuel: 20, manufacturedGoods: 10 },
  }).depot;
  const first = dispatchDepot(state, depot.id, { config: FAST_CONFIG, escortStrength: 5 }).convoy;
  const repelled = interceptConvoy(state, first.id, { config: FAST_CONFIG, threatStrength: 5 });
  check('5.1 escort plus armor deterministically repels weaker interception',
    repelled.ok && repelled.repelled && first.status === 'jumping');
  const destroyed = interceptConvoy(state, first.id, { config: FAST_CONFIG, threatStrength: 20 });
  check('5.2 successful interception destroys cargo and convoy',
    destroyed.ok && destroyed.destroyed && first.status === 'intercepted'
      && cargoTotal(destroyed.lostCargo) === 60);
  check('5.3 interception pauses affected depot route', depot.routePaused && depot.pauseReason === 'interception');
  check('5.4 route can recover after explicit resume', resumeDepotRoute(state, depot.id).ok && !depot.routePaused);
  check('5.5 destroyed/offline depot rejects dispatch',
    setDepotOperational(state, depot.id, false, 'destroyed').ok
      && !dispatchDepot(state, depot.id, { config: FAST_CONFIG }).ok);

  const noDestination = fixture({ nexus: false, depotStructure: false });
  const noDestDepot = registerExportDepot(noDestination, 'gal-0', 'A', {
    config: FAST_CONFIG,
    inventory: { rawMaterials: 10, fuel: 0, manufacturedGoods: 0 },
  }).depot;
  const inventoryBefore = JSON.stringify(noDestDepot.inventory);
  const failed = dispatchDepot(noDestination, noDestDepot.id, { config: FAST_CONFIG });
  check('5.6 no destination does not consume cargo',
    !failed.ok && /No available Trade Nexus/.test(failed.reason)
      && JSON.stringify(noDestDepot.inventory) === inventoryBefore);

  const destroyedHub = fixture({ depotStructure: false });
  const hubDepot = registerExportDepot(destroyedHub, 'gal-0', 'A', {
    config: FAST_CONFIG,
    inventory: { rawMaterials: 10, fuel: 0, manufacturedGoods: 0 },
  }).depot;
  const stranded = dispatchDepot(destroyedHub, hubDepot.id, { config: FAST_CONFIG }).convoy;
  destroyedHub.galaxies['gal-0'].systems.N.star.kind = 'yellow';
  stepLogistics(destroyedHub, 1);
  check('5.7 destroyed destination hub pauses convoy without losing manifest',
    stranded.status === 'paused' && stranded.pauseReason === 'no_destination'
      && cargoTotal(stranded.manifest) === 10);
  destroyedHub.galaxies['gal-0'].systems.N.star.kind = 'trade_nexus';
  stepLogistics(destroyedHub, 3);
  check('5.8 restored destination lets stranded convoy recover and deliver',
    stranded.status === 'delivered' && destroyedHub.credits === 40);
}

// Identical state + ticks must remain byte-for-byte deterministic and JSON-safe.
{
  const stateA = fixture();
  const stateB = JSON.parse(JSON.stringify(stateA));
  ensureLogisticsState(stateB);
  stepLogistics(stateA, 12);
  stepLogistics(stateB, 12);
  check('6.1 identical fixed-tick runs are byte deterministic',
    JSON.stringify(stateA) === JSON.stringify(stateB));
  const roundTrip = JSON.parse(JSON.stringify(stateA));
  check('6.2 logistics state survives JSON round trip',
    JSON.stringify(roundTrip.logistics) === JSON.stringify(stateA.logistics));
  const summary = depotSummary(stateA, exportDepotId('gal-0', 'A'), { config: FAST_CONFIG });
  check('6.3 depot summary exposes capacity, inventory, and active route state',
    summary && summary.capacity === 1000 && summary.inventoryCredits >= 0);
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(`Failed: ${failed.map((result) => result.name).join(', ')}`);
  process.exit(1);
}
