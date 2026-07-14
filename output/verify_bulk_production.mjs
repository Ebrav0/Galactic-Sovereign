// Focused aggregate bulk-production verification.

import { createNewGame, systemById } from '../src/js/state.js';
import {
  dispatchEmpireQueue,
  enqueueHull,
  listPlayerShipyards,
} from '../src/js/empire-queue.js';
import { tickProduction } from '../src/js/production.js';
import { hullQueueCost } from '../src/js/hull.js';
import {
  bulkProductionSummary,
  cancelBulkProductionOrder,
  createBulkProductionOrder,
  ensureBulkProductionState,
  listPendingBulkDeliveries,
  pauseBulkProductionOrder,
  previewBulkProductionOrder,
  recordBulkShipCompletion,
  resumeBulkProductionOrder,
  setBulkDeliveryStatus,
  tickBulkProduction,
} from '../src/js/bulk-production.js';

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

function productionState(seed, { credits = 1_000_000, bulkTech = true } = {}) {
  const state = createNewGame(seed);
  state.paused = false;
  state.credits = credits;
  state.empireQueue = [];
  state.playerShips = [];
  state.scouts = [];
  delete state.bulkProductionOrders;
  delete state.bulkProductionDeliveries;
  delete state.bulkProductionMeta;
  if (bulkTech) {
    state.research.unlocked.push('mil_parallel_dock', 'eco_industrial_automation');
  }
  const home = systemById(state, state.stronghold);
  home.structures = (home.structures ?? []).filter((structure) => structure.type !== 'shipyard');
  const bodyId = home.bodies[0].id;
  const yard = builtShipyard(`bulk-yard-${seed}`, bodyId);
  home.structures.push(yard);
  return { state, home, yard };
}

function orderInput(yard, overrides = {}) {
  return {
    name: 'Four Hundred Corvettes',
    manifest: [{ hull: 'corvette', quantity: 400 }],
    priority: 'normal',
    budgetCap: null,
    protectedReserve: 0,
    allowedShipyardIds: [yard.id],
    rally: { type: 'system', systemId: 'rally-system' },
    packaging: { mode: 'new_fleets', splitSize: 40 },
    linkedCampaignId: 'campaign-50-outposts',
    ...overrides,
  };
}

function finishCurrentBuilds(state, yard) {
  const taggedItems = state.empireQueue.map((item) => ({ ...item, delivery: { ...item.delivery } }));
  const lastEnd = yard.builds.reduce(
    (end, build) => Math.max(end, build.startedAt + build.durationMs),
    state.time,
  );
  state.time = lastEnd;
  const completions = tickProduction(state);
  return taggedItems.map((queueItem, index) => {
    const completion = completions[index];
    const ship = state.playerShips.find((candidate) => candidate.id === completion?.shipId) ?? null;
    return { queueItem, completion, ship };
  });
}

// State initialization is deterministic and uses explicit aggregate collections.
{
  const { state } = productionState(8800);
  const initialized = ensureBulkProductionState(state);
  check('bulk state initializes aggregate order collection', initialized.orders === state.bulkProductionOrders);
  check('bulk state initializes delivery collection', initialized.deliveries === state.bulkProductionDeliveries);
  check('bulk state initializes deterministic counters', initialized.meta.nextOrderId === 1);
}

// A 400-hull request remains one aggregate line and admits only free physical slots.
{
  const { state, yard } = productionState(8801);
  const preview = previewBulkProductionOrder(state, orderInput(yard));
  check('400-corvette preview passes late-game tech and shipyard validation', preview.ok,
    preview.errors.map((error) => error.message).join('; '));
  check('preview reports aggregate total without expanding rows',
    preview.totalQuantity === 400 && preview.config.manifest.length === 1);
  check('preview is bounded by two real parallel dock slots', preview.materializableNow === 2,
    `now=${preview.materializableNow}`);

  const created = createBulkProductionOrder(state, orderInput(yard));
  check('400-corvette aggregate order creates successfully', created.ok, created.reason ?? '');
  check('creation emits no per-ship queue rows', state.empireQueue.length === 0);
  check('creation stores one manifest line, not 400 items',
    state.bulkProductionOrders.length === 1
      && state.bulkProductionOrders[0].manifest.length === 1
      && state.bulkProductionOrders[0].manifest[0].quantity === 400);

  const firstTick = tickBulkProduction(state);
  check('first tick materializes only available shipyard slots',
    firstTick.materializedCount === 2 && state.empireQueue.length === 2,
    `materialized=${firstTick.materializedCount} queue=${state.empireQueue.length}`);
  check('materialized rows carry bulk, campaign, and delivery tags', state.empireQueue.every((item) => (
    item.bulkOrderId === created.order.id
      && item.bulkLineId === created.order.manifest[0].id
      && item.linkedCampaignId === 'campaign-50-outposts'
      && item.delivery?.packaging?.splitSize === 40
      && item.delivery?.rally?.type === 'system'
  )));
  const secondTick = tickBulkProduction(state);
  check('repeated tick cannot inflate pending tickets past bounded capacity',
    secondTick.materializedCount === 0 && state.empireQueue.length === 2);

  dispatchEmpireQueue(state);
  check('bounded tickets dispatch through unchanged empire queue',
    state.empireQueue.every((item) => item.status === 'building') && yard.builds.length === 2);
  check('bulk tick does not queue behind already occupied physical slots',
    tickBulkProduction(state).materializedCount === 0 && state.empireQueue.length === 2);

  const completed = finishCurrentBuilds(state, yard);
  check('physical production completed the bounded wave',
    completed.length === 2 && state.empireQueue.length === 0 && state.playerShips.length === 2);
  for (const entry of completed) {
    recordBulkShipCompletion(state, { ...entry.completion, queueItem: entry.queueItem }, entry.ship);
  }
  const afterCompletion = bulkProductionSummary(state, created.order.id);
  check('completion advances aggregate count and releases active ticket metadata',
    afterCompletion.counts.completed === 2 && afterCompletion.counts.activeTickets === 0);
  check('completion creates pending delivery records instead of queue rows',
    listPendingBulkDeliveries(state).length === 2 && state.empireQueue.length === 0);
  check('delivery records retain campaign, rally, packaging, and ship identity',
    listPendingBulkDeliveries(state).every((delivery) => (
      delivery.linkedCampaignId === 'campaign-50-outposts'
        && delivery.rally.type === 'system'
        && delivery.packaging.mode === 'new_fleets'
        && !!delivery.shipId
    )));
  check('next bulk tick replenishes only the newly freed wave',
    tickBulkProduction(state).materializedCount === 2 && state.empireQueue.length === 2);

  const delivery = listPendingBulkDeliveries(state)[0];
  const marked = setBulkDeliveryStatus(state, delivery.id, 'delivered', {
    assignedFleetId: 'bulk-fleet-1',
  });
  check('routing layer can mark delivery status and fleet assignment',
    marked.ok
      && marked.delivery.status === 'delivered'
      && marked.delivery.assignedFleetId === 'bulk-fleet-1'
      && listPendingBulkDeliveries(state).length === 1);
}

// Rolling order budget blocks admission before it can overspend.
{
  const { state, yard } = productionState(8802);
  const cost = hullQueueCost(state, 'corvette');
  const created = createBulkProductionOrder(state, orderInput(yard, {
    budgetCap: cost,
    rally: null,
    packaging: null,
  }));
  const tick = tickBulkProduction(state);
  const summary = bulkProductionSummary(state, created.order.id);
  check('rolling budget admits exactly one affordable ticket',
    tick.materializedCount === 1 && summary.spent === cost && state.empireQueue.length === 1);
  check('rolling budget reports a resumable budget blocker',
    summary.blockers.some((blocker) => blocker.code === 'budget_cap'));
}

// Protected reserve uses current credits and is re-evaluated for every ticket.
{
  const probe = productionState(8803);
  const cost = hullQueueCost(probe.state, 'corvette');
  probe.state.credits = cost * 2;
  const created = createBulkProductionOrder(probe.state, orderInput(probe.yard, {
    protectedReserve: cost,
    rally: null,
    packaging: null,
  }));
  const tick = tickBulkProduction(probe.state);
  const summary = bulkProductionSummary(probe.state, created.order.id);
  check('protected reserve admits only spend above reserve',
    tick.materializedCount === 1 && probe.state.credits === cost);
  check('protected reserve emits exact blocker metadata',
    summary.blockers.some((blocker) => blocker.code === 'protected_reserve'
      && blocker.protectedReserve === cost));
}

// Pause prevents new tickets; resume returns the same aggregate order to scheduling.
{
  const { state, yard } = productionState(8804);
  const created = createBulkProductionOrder(state, orderInput(yard));
  const paused = pauseBulkProductionOrder(state, created.order.id);
  const whilePaused = tickBulkProduction(state);
  check('paused order admits no new tickets',
    paused.ok && whilePaused.materializedCount === 0 && state.empireQueue.length === 0);
  const resumed = resumeBulkProductionOrder(state, created.order.id);
  check('resumed order re-enters bounded scheduling',
    resumed.ok && tickBulkProduction(state).materializedCount === 2 && state.empireQueue.length === 2);
}

// Cancelling pending tickets refunds them and resolves all unstarted aggregate demand.
{
  const { state, yard } = productionState(8805);
  const startingCredits = state.credits;
  const created = createBulkProductionOrder(state, orderInput(yard));
  tickBulkProduction(state);
  const spentCredits = startingCredits - state.credits;
  const cancelled = cancelBulkProductionOrder(state, created.order.id);
  const summary = bulkProductionSummary(state, created.order.id);
  check('cancel removes every unstarted linked queue ticket',
    cancelled.ok && state.empireQueue.length === 0 && summary.counts.activeTickets === 0);
  check('cancel refunds pending ticket spend exactly',
    cancelled.refunded === spentCredits && state.credits === startingCredits && summary.spent === 0);
  check('cancel resolves all 400 aggregate units without row expansion',
    summary.storedStatus === 'cancelled'
      && summary.counts.cancelled === 400
      && summary.counts.completed === 0);
}

// Started hulls are not refunded; they finish and still produce delivery records.
{
  const { state, yard } = productionState(8808);
  const cost = hullQueueCost(state, 'corvette');
  const created = createBulkProductionOrder(state, orderInput(yard, {
    manifest: [{ hull: 'corvette', quantity: 2 }],
  }));
  tickBulkProduction(state);
  dispatchEmpireQueue(state);
  const cancelled = cancelBulkProductionOrder(state, created.order.id);
  check('cancel preserves already-started physical builds without refund',
    cancelled.status === 'cancelling'
      && cancelled.activeBuilds === 2
      && cancelled.refunded === 0
      && state.credits === 1_000_000 - cost * 2);
  const completed = finishCurrentBuilds(state, yard);
  for (const entry of completed) {
    recordBulkShipCompletion(state, { ...entry.completion, queueItem: entry.queueItem }, entry.ship);
  }
  const summary = bulkProductionSummary(state, created.order.id);
  check('cancelled order closes after its active builds finish',
    summary.storedStatus === 'cancelled'
      && summary.counts.completed === 2
      && summary.counts.cancelled === 0);
  check('completed started hulls retain normal pending delivery',
    listPendingBulkDeliveries(state).length === 2);
}

// A fully resolved, non-cancelled manifest reaches complete automatically.
{
  const { state, yard } = productionState(8809);
  const created = createBulkProductionOrder(state, orderInput(yard, {
    manifest: [{ hull: 'corvette', quantity: 2 }],
  }));
  tickBulkProduction(state);
  dispatchEmpireQueue(state);
  const completed = finishCurrentBuilds(state, yard);
  for (const entry of completed) {
    recordBulkShipCompletion(state, { ...entry.completion, queueItem: entry.queueItem }, entry.ship);
  }
  const summary = bulkProductionSummary(state, created.order.id);
  check('fully completed manifest transitions to complete',
    summary.storedStatus === 'complete'
      && summary.counts.completed === 2
      && summary.counts.remaining === 0);
}

// Equal-priority manifests receive one ticket each when only two slots are free.
{
  const { state, yard } = productionState(8806);
  const first = createBulkProductionOrder(state, orderInput(yard, { name: 'First' }));
  const second = createBulkProductionOrder(state, orderInput(yard, { name: 'Second' }));
  tickBulkProduction(state);
  const firstCount = state.empireQueue.filter((item) => item.bulkOrderId === first.order.id).length;
  const secondCount = state.empireQueue.filter((item) => item.bulkOrderId === second.order.id).length;
  check('equal-priority orders are round-robin fair across scarce slots',
    firstCount === 1 && secondCount === 1,
    `first=${firstCount} second=${secondCount}`);
}

// Existing quantity-one queue behavior remains independent of bulk technology/state.
{
  const { state } = productionState(8807, { bulkTech: false });
  const direct = enqueueHull(state, 'corvette');
  check('legacy quantity-one enqueue remains available without bulk technologies', direct.ok,
    direct.reason ?? '');
  check('legacy enqueue does not create aggregate state by itself',
    !Object.hasOwn(state, 'bulkProductionOrders'));
  check('legacy queue still sees the same operational shipyard', listPlayerShipyards(state).length === 1);
}

console.log(`\nBulk production verifier: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
