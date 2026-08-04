import { HULL_STATS } from '../src/js/constants.js';
import { applyIncomeTick, incomePerSecond } from '../src/js/economy.js';
import {
  activeConvoys,
  availableConvoyDoctrines,
  commerceConvoyTraffic,
  convoyDoctrine,
  createDefaultLogisticsState,
  dispatchDepot,
  ensureLogisticsState,
  freighterPoolSummary,
  interceptConvoy,
  logisticsSummary,
  registerExportDepot,
  routeSecuritySummary,
  setConvoyReserve,
  setExportCenterDoctrine,
  setLaneBlockade,
  setSystemBlockade,
  tickDepotDispatch,
  tickLogistics,
  upgradeExportCenter,
} from '../src/js/logistics.js';
import {
  destroyPirateNest,
  removePirateShip,
  tickPirateInterdictions,
  tickPirates,
} from '../src/js/pirates.js';
import { applyCoopCommand, WORLD_MUTATING_COMMANDS } from '../server/actions.mjs';
import { applyAiFactionIncomeTick } from '../src/js/ai-faction.js';

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function makeSystem(id, owner = 'neutral', kind = 'yellow') {
  return {
    id,
    name: id,
    owner,
    factionId: owner === 'ai' ? 'ai-0' : undefined,
    star: { kind, radius: 100 },
    bodies: [],
    structures: [],
    dyson: {},
  };
}

function fixture() {
  const a = makeSystem('A', 'player');
  a.bodies.push({
    id: 'p1',
    kind: 'planet',
    type: 'habitable',
    moons: [{ id: 'm1' }],
  });
  a.structures.push({
    id: 'outpost-a',
    type: 'outpost',
    bodyId: 'p1',
    hp: 100,
    maxHp: 100,
    operational: true,
  });
  a.structures.push({
    id: 'depot-a',
    type: 'export_depot',
    bodyId: null,
    level: 1,
    hp: 520,
    maxHp: 520,
    operational: true,
  });
  const n = makeSystem('N', 'neutral', 'trade_nexus');
  n.tradeNexus = { openAccess: true, acceptsPlayerTrade: true };
  return {
    meta: { seed: 77 },
    time: 0,
    paused: false,
    credits: 2000,
    activeGalaxyId: 'gal-0',
    homeGalaxyId: 'gal-0',
    stronghold: 'A',
    research: { unlocked: [] },
    battleGroups: [],
    playerShips: [],
    aiShips: [],
    factions: { list: [] },
    systemBattles: {},
    logistics: createDefaultLogisticsState(),
    pirates: { fleets: [], pendingRespawn: [], nests: [] },
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
          A: a,
          B: makeSystem('B'),
          N: n,
        },
      },
    },
  };
}

const FAST = {
  productionRates: {
    habitable: { rawMaterials: 100, fuel: 0, manufacturedGoods: 0 },
  },
  moonProductionBonus: 0,
  cargoValues: { rawMaterials: 1, fuel: 1, manufacturedGoods: 1 },
  outpostCreditCapacity: 20,
  localCreditCapacity: 120,
  localTransitMs: 100000,
  localDispatchIntervalMs: 0,
  convoyDispatchIntervalMs: 0,
  jumpDurationMs: 50,
  convoySpeed: 1000,
  minLegMs: 50,
  escortRallyMs: 30000,
};

// System rendering may scope retained commerce traffic before doing route
// projection. The scoped result must equal the corresponding visible subset
// of the unscoped Galaxy result.
{
  const state = fixture();
  state.time = 10_000;
  state.logistics.convoys.push(
    {
      id: 'delivered-a',
      galaxyId: 'gal-0',
      status: 'delivered',
      fromSystemId: 'A',
      destinationSystemId: 'N',
      path: ['A', 'B', 'N'],
      creditLoad: 400,
      deliveredAt: 9_000,
    },
    {
      id: 'delivered-b',
      galaxyId: 'gal-0',
      status: 'delivered',
      fromSystemId: 'B',
      destinationSystemId: 'N',
      path: ['B', 'N'],
      creditLoad: 300,
      deliveredAt: 9_100,
    },
  );
  const all = commerceConvoyTraffic(state);
  const origin = commerceConvoyTraffic(state, 'gal-0', { originSystemId: 'A' });
  const nexus = commerceConvoyTraffic(state, 'gal-0', { nexusSystemId: 'N' });
  check('scoped commerce projection preserves the exact visible subsets',
    JSON.stringify(origin) === JSON.stringify(all.filter(({ convoy }) => convoy.fromSystemId === 'A'))
      && JSON.stringify(nexus) === JSON.stringify(all.filter(
        ({ convoy }) => convoy.destinationSystemId === 'N',
      )),
    `all=${all.length} origin=${origin.length} nexus=${nexus.length}`);
}

// The dispatch loop passes its already-resolved config through a nested
// options envelope. That reuse path must remain byte-for-byte equivalent to
// the legacy direct-options shape accepted by the public security projection.
{
  const state = fixture();
  const depot = registerExportDepot(state, 'gal-0', 'A', { storedCredits: 400 }).depot;
  const direct = routeSecuritySummary(state, depot, { ...FAST, doctrineId: 'standard' });
  const reused = routeSecuritySummary(state, depot, { config: FAST, doctrineId: 'standard' });
  check('resolved dispatch config reuse preserves route-security output',
    JSON.stringify(reused) === JSON.stringify(direct),
    JSON.stringify({ direct, reused }));
}

// No research means no credits appear in the spendable wallet.
{
  const state = fixture();
  const before = state.credits;
  applyIncomeTick(state);
  state.time = 1000;
  tickLogistics(state, { config: FAST });
  const summary = logisticsSummary(state);
  check('idle outpost income is disabled', incomePerSecond(state) === 0 && state.credits === before);
  check('outpost output becomes capped physical credits',
    summary.creditsAtOutposts <= 20 && summary.producedCredits > 0,
    `stored=${summary.creditsAtOutposts} produced=${summary.producedCredits}`);
}

{
  const state = fixture();
  const faction = {
    id: 'ai-0',
    credits: 1000,
    solarii: 0,
    research: { unlocked: [] },
    technology: { unlocked: [] },
  };
  state.factions.list.push(faction);
  state.galaxies['gal-0'].systems.B.owner = 'ai';
  state.galaxies['gal-0'].systems.B.factionId = faction.id;
  state.galaxies['gal-0'].systems.B.structures.push({
    id: 'ai-outpost',
    type: 'outpost',
    hp: 100,
    maxHp: 100,
    operational: true,
  });
  const before = faction.credits;
  applyAiFactionIncomeTick(state, faction, 1000);
  check('AI outposts do not retain a parallel passive-credit path', faction.credits === before);
}

// Late onsite processing converts exactly ten percent into the wallet.
{
  const state = fixture();
  state.research.unlocked.push('trade_onsite_processing');
  const before = state.credits;
  state.time = 1000;
  tickLogistics(state, {
    config: {
      ...FAST,
      localDispatchIntervalMs: 100000,
    },
  });
  check('onsite processing pays exactly ten percent',
    state.credits - before === 0.5 && state.logistics.stats.onsiteCredits === 0.5,
    `walletDelta=${state.credits - before}`);
}

// Free freighter pool, paid overflow construction, and ten-second completion.
{
  const state = fixture();
  const a = state.galaxies['gal-0'].systems.A;
  a.bodies.push({ id: 'p2', kind: 'planet', type: 'habitable', moons: [] });
  a.structures.push({
    id: 'outpost-b',
    type: 'outpost',
    bodyId: 'p2',
    hp: 100,
    maxHp: 100,
    operational: true,
  });
  state.time = 1000;
  tickLogistics(state, {
    config: {
      ...FAST,
      freeFreighters: 1,
      freighterCost: 50,
      freighterBuildMs: 10000,
    },
  });
  const queued = freighterPoolSummary(state, 'player', { freeFreighters: 1 });
  check('overflow freighter is auto-queued for 50 credits',
    queued.total === 1 && queued.building === 1 && state.credits === 1950,
    JSON.stringify(queued));
  state.time += 10000;
  tickLogistics(state, {
    config: {
      ...FAST,
      freeFreighters: 1,
      freighterCost: 50,
      freighterBuildMs: 10000,
    },
  });
  check('paid freighter completes after ten seconds',
    freighterPoolSummary(state, 'player', { freeFreighters: 1 }).total === 2);
}

// Center levels, doctrine tech, capacity tech, real reserve ships, and auto-dispatch.
{
  const state = fixture();
  state.research.unlocked.push(
    'trade_logistics_hubs',
    'trade_lane_secured',
    'trade_armored_convoy',
    'trade_galactic_exchange',
    'trade_fast_couriers',
    'trade_bulk_freighter',
    'trade_mass_convoy_frames',
  );
  const depot = registerExportDepot(state, 'gal-0', 'A', {
    structureId: 'depot-a',
    storedCredits: 360,
  }).depot;
  check('researched convoy doctrines become selectable',
    availableConvoyDoctrines(state).includes('fast')
      && availableConvoyDoctrines(state).includes('bulk')
      && availableConvoyDoctrines(state).includes('armored'));
  check('convoy capacity technology multiplies doctrine capacity',
    convoyDoctrine(state, 'standard').capacity === 600);
  check('center upgrade charges wallet and raises capacity/bays',
    upgradeExportCenter(state, depot.id).ok
      && depot.level === 2
      && depot.capacity === 5000
      && depot.assemblyBays === 2
      && state.credits === 1200);
  check('host command changes a center doctrine atomically',
    applyCoopCommand(state, 'setExportCenterDoctrine', {
      depotId: depot.id,
      doctrineId: 'bulk',
    }).ok && depot.doctrineId === 'bulk');
  setExportCenterDoctrine(state, depot.id, 'standard');
  depot.storedCredits = 540; // 90% of the 600-credit researched standard convoy.
  const hp = HULL_STATS.corvette.hp;
  state.playerShips.push({
    id: 'escort-1',
    hull: 'corvette',
    galaxyId: 'gal-0',
    systemId: 'A',
    hp,
    maxHp: hp,
    transit: null,
  });
  state.battleGroups.push({
    id: 'group-1',
    ordinal: 1,
    galaxyId: 'gal-0',
    shipIds: ['escort-1'],
    convoyReserve: false,
  });
  check('escort reserve command opts a real fleet into convoy duty',
    setConvoyReserve(state, 'battle_group', 'group-1', true).ok);
  tickDepotDispatch(state, { config: FAST });
  state.time += 30000;
  tickDepotDispatch(state, { config: FAST });
  const convoy = activeConvoys(state)[0];
  check('ninety-percent auto-dispatch waits through rally and claims real ships',
    convoy?.creditLoad === 540
      && convoy.escortShipIds.includes('escort-1')
      && state.playerShips[0].convoyEscortId === convoy.id,
    convoy ? JSON.stringify({ load: convoy.creditLoad, escorts: convoy.escortShipIds }) : 'no convoy');
  check('new logistics mutations are registered as multiplayer world commands',
    ['setExportCenterDoctrine', 'upgradeExportCenter', 'setConvoyReserve']
      .every((command) => WORLD_MUTATING_COMMANDS.has(command)));
}

// Dispatch always observes the current route blockades.
{
  const state = fixture();
  const depot = registerExportDepot(state, 'gal-0', 'A', { storedCredits: 400 }).depot;
  tickDepotDispatch(state, { config: { ...FAST, escortRallyMs: 30000 } });
  setLaneBlockade(state, 'gal-0', 'A', 'B', true);
  tickDepotDispatch(state, { config: { ...FAST, escortRallyMs: 0 } });
  const blockedCount = activeConvoys(state).length;
  setLaneBlockade(state, 'gal-0', 'A', 'B', false);
  tickDepotDispatch(state, { config: { ...FAST, escortRallyMs: 0 } });
  check('lane blockade changes preserve fresh dispatch validation',
    blockedCount === 0 && activeConvoys(state).length === 1,
    `blocked=${blockedCount} reopened=${activeConvoys(state).length}`);
}

{
  const state = fixture();
  const depot = registerExportDepot(state, 'gal-0', 'A', { storedCredits: 400 }).depot;
  tickDepotDispatch(state, { config: { ...FAST, escortRallyMs: 30000 } });
  setSystemBlockade(state, 'gal-0', 'B', true);
  tickDepotDispatch(state, { config: { ...FAST, escortRallyMs: 0 } });
  const blockedCount = activeConvoys(state).length;
  setSystemBlockade(state, 'gal-0', 'B', false);
  tickDepotDispatch(state, { config: { ...FAST, escortRallyMs: 0 } });
  check('system blockade changes preserve fresh dispatch validation',
    blockedCount === 0 && activeConvoys(state).length === 1,
    `blocked=${blockedCount} reopened=${activeConvoys(state).length}`);
}

// Stolen credits remain physical on pirate fleets; killing the carrier recovers them.
{
  const state = fixture();
  const depot = registerExportDepot(state, 'gal-0', 'A', { storedCredits: 400 }).depot;
  const convoy = dispatchDepot(state, depot.id).convoy;
  state.pirates.nests.push({
    id: 'nest-1',
    galaxyId: 'gal-0',
    systemId: 'A',
    hp: 100,
    maxHp: 100,
    destroyed: false,
    lootVault: 0,
    lootByOwner: {},
  });
  state.pirates.fleets.push({
    id: 'pirate-1',
    galaxyId: 'gal-0',
    systemId: 'A',
    transit: null,
    nestId: 'nest-1',
    size: 'small',
    ships: [{ id: 'pirate-ship-1', hull: 'corvette', hp: 100, maxHp: 100 }],
    wanderCooldownMs: 1000,
    intent: { type: 'raid_convoy', convoyId: convoy.id, targetSystemId: 'A' },
  });
  const walletBeforeRecovery = state.credits;
  const theft = interceptConvoy(state, convoy.id, {
    destroyed: true,
    attackerId: 'pirates',
    pirateFleetId: 'pirate-1',
    systemId: 'A',
  });
  check('destroyed convoy credits transfer to a physical pirate fleet',
    theft.lostCredits === 400 && state.pirates.fleets[0].stolenCredits === 400);
  removePirateShip(state, 'pirate-1', 'pirate-ship-1');
  check('destroying the loot carrier recovers all unbanked credits',
    state.credits === walletBeforeRecovery + 400);
}

// Pirate fleets physically drop a targeted convoy out of its lane for combat.
{
  const state = fixture();
  const depot = registerExportDepot(state, 'gal-0', 'A', { storedCredits: 400 }).depot;
  const convoy = dispatchDepot(state, depot.id).convoy;
  convoy.status = 'in_transit';
  convoy.systemId = null;
  convoy.currentNodeId = 'A';
  convoy.legIndex = 0;
  convoy.legStartTime = 0;
  convoy.legDurationMs = 1000;
  state.time = 500;
  state.pirates.fleets.push({
    id: 'pirate-interdict',
    galaxyId: 'gal-0',
    systemId: null,
    transit: {
      path: ['A', 'B'],
      legIndex: 0,
      legStartTime: 0,
      legDurationMs: 1000,
    },
    nestId: null,
    size: 'small',
    ships: [{ id: 'pirate-interdict-ship', hull: 'corvette', hp: 100, maxHp: 100 }],
    wanderCooldownMs: 1000,
    intent: { type: 'raid_convoy', convoyId: convoy.id, targetSystemId: 'B' },
  });
  const events = tickPirateInterdictions(state);
  check('pirate pursuit physically drops the convoy and attacker into one system',
    events.some((event) => event.type === 'pirate_convoy_interdiction')
      && convoy.status === 'paused'
      && convoy.pauseReason === 'pirate_interdiction'
      && state.pirates.fleets[0].systemId === convoy.currentNodeId,
    JSON.stringify(events[0] ?? {}));
}

// Once banked, only half the pirate nest vault is recoverable.
{
  const state = fixture();
  state.pirates.nests.push({
    id: 'nest-2',
    galaxyId: 'gal-0',
    systemId: 'A',
    hp: 100,
    maxHp: 100,
    destroyed: false,
    lootVault: 0,
    lootByOwner: {},
  });
  state.pirates.fleets.push({
    id: 'pirate-2',
    galaxyId: 'gal-0',
    systemId: 'A',
    transit: null,
    nestId: 'nest-2',
    size: 'small',
    ships: [{ id: 'pirate-ship-2', hull: 'corvette', hp: 100, maxHp: 100 }],
    stolenCredits: 600,
    stolenFromOwnerId: 'player',
    wanderCooldownMs: 1000,
    intent: { type: 'return_loot', targetSystemId: 'A' },
  });
  tickPirates(state);
  const beforeNest = state.credits;
  destroyPirateNest(state, 'nest-2');
  check('destroying a nest recovers half of banked convoy loot',
    state.credits === beforeNest + 300,
    `recovered=${state.credits - beforeNest}`);
}

ensureLogisticsState(fixture());
const passed = checks.filter((entry) => entry.pass).length;
console.log(`\nLogistics v2: ${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
