// End-to-end, browser-free verification for the v16 diplomacy, strategic-order,
// and aggregate production overhaul. This intentionally uses the production
// save envelope and live queue/delivery bridges instead of isolated mocks.

import { createNewGame, systemById } from '../src/js/state.js';
import { serialize, deserialize } from '../src/js/save.js';
import {
  AGREEMENT_OPEN_BORDERS,
  canAttackSystem,
  concludePeace,
  createAgreement,
  declareWar,
  establishContact,
  getActiveWar,
  recordOccupation,
  routeLegality,
} from '../src/js/diplomacy.js';
import {
  bulkProductionSummary,
  createBulkProductionOrder,
  previewBulkProductionOrder,
  tickBulkProduction,
} from '../src/js/bulk-production.js';
import { dispatchEmpireQueue } from '../src/js/empire-queue.js';
import { tickProduction } from '../src/js/production.js';
import { tickBulkDeliveries } from '../src/js/production-delivery.js';
import {
  createExpansionCampaign,
  previewExpansionCampaign,
  strategicOrdersSummary,
} from '../src/js/strategic-operations.js';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${detail ? ` - ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

function addTech(state, ...ids) {
  state.research.unlocked = [...new Set([...(state.research.unlocked ?? []), ...ids])];
}

function integrationSystem(id, { owner = 'neutral', factionId = null, tagged = false } = {}) {
  return {
    id,
    name: `Integration ${id}`,
    owner,
    factionId,
    star: { kind: 'yellow' },
    resourceTags: tagged ? ['v16-integration-target'] : [],
    bodies: [{
      id: `${id}-world`,
      name: `${id} Prime`,
      kind: 'planet',
      type: 'habitable',
      orbitRadius: 1,
      orbitPeriodMs: 1000,
      orbitPhase: 0,
      radius: 1,
      moons: [],
    }],
    structures: [],
    dyson: { completedShells: 0, disabled: false },
  };
}

function attachSystem(state, id, options = {}) {
  const galaxy = state.galaxies[state.activeGalaxyId];
  galaxy.graph.stars.push({
    id,
    name: `Integration ${id}`,
    x: galaxy.graph.stars.length + 10,
    y: galaxy.graph.stars.length % 7,
    type: 'yellow',
  });
  galaxy.graph.lanes.push([state.stronghold, id]);
  galaxy.systems[id] = integrationSystem(id, options);
  return galaxy.systems[id];
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

const state = createNewGame(160016);
state.paused = false;
state.credits = 1_000_000_000;
state.factions.ai = state.factions.list[0];
addTech(
  state,
  'mil_parallel_dock',
  'eco_industrial_automation',
  'eco_construction_drones',
  'eco_sector_capitals',
  'dip_trade_charter',
  'dip_truce_protocol',
);

// Add a deterministic 50-system frontier without replacing the generated game
// state. The unique tag makes count selection exact and independent of seed.
const frontierIds = [];
for (let index = 1; index <= 50; index += 1) {
  const id = `v16-frontier-${String(index).padStart(2, '0')}`;
  frontierIds.push(id);
  attachSystem(state, id, { tagged: true });
}
const aiRestoreId = 'v16-ai-restore';
const aiCedeId = 'v16-ai-cede';
attachSystem(state, aiRestoreId, { owner: 'ai', factionId: 'ai-0' });
attachSystem(state, aiCedeId, { owner: 'ai', factionId: 'ai-0' });

// --- Strategic scale: one 50-target campaign record. ---

const campaignSpec = {
  name: 'Fifty Outposts Integration',
  sourceSystemId: state.stronghold,
  count: 50,
  requiredStructureType: 'outpost',
  filters: {
    owner: 'neutral',
    resourceTags: ['v16-integration-target'],
  },
  templateId: 'frontier',
  reserve: 50_000,
  concurrency: 4,
};
const campaignHooks = {
  hasIntel: () => false,
  previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 0 }),
};
const campaignPreview = previewExpansionCampaign(state, campaignSpec, { hooks: campaignHooks });
check(
  '50-outpost count preview selects exactly fifty tagged targets',
  campaignPreview.ok
    && campaignPreview.mode === 'count'
    && campaignPreview.requestedCount === 50
    && campaignPreview.targets.length === 50
    && new Set(campaignPreview.targets.map((target) => target.systemId)).size === 50,
  campaignPreview.blockers?.map((entry) => entry.message).join('; ') ?? '',
);
const campaignCreated = createExpansionCampaign(state, campaignSpec, { hooks: campaignHooks });
const campaignId = campaignCreated.campaign?.id;
check(
  '50-outpost request persists as one aggregate campaign record',
  campaignCreated.ok
    && state.strategicOrders.campaigns.length === 1
    && state.strategicOrders.campaigns[0].targets.length === 50
    && state.strategicOrders.campaigns[0].selection.requestedCount === 50,
);
check(
  'strategic summary reports the single aggregate campaign',
  strategicOrdersSummary(state).campaigns.length === 1,
);

// --- Bulk scale: one 400-corvette manifest and only bounded live tickets. ---

const home = systemById(state, state.stronghold);
const homeBody = home.bodies.find((body) => body.type === 'habitable') ?? home.bodies[0];
const shipyard = builtShipyard('v16-integration-yard', homeBody.id);
home.structures = (home.structures ?? []).filter((structure) => structure.type !== 'shipyard');
home.structures.push(shipyard);
state.empireQueue = [];
state.playerShips = [];
state.battleGroups = [];

const bulkSpec = {
  name: 'Four Hundred Corvettes Integration',
  manifest: [{ hull: 'corvette', quantity: 400 }],
  priority: 'high',
  allowedShipyardIds: [shipyard.id],
  protectedReserve: 100_000,
  rally: { type: 'system', systemId: state.stronghold },
  packaging: { mode: 'single_fleet' },
  linkedCampaignId: campaignId,
};
const bulkPreview = previewBulkProductionOrder(state, bulkSpec);
check(
  '400-corvette preview remains a one-line aggregate manifest',
  bulkPreview.ok
    && bulkPreview.totalQuantity === 400
    && bulkPreview.config.manifest.length === 1
    && bulkPreview.config.manifest[0].quantity === 400,
  bulkPreview.errors?.map((entry) => entry.message).join('; ') ?? '',
);
const bulkCreated = createBulkProductionOrder(state, bulkSpec);
const bulkOrderId = bulkCreated.order?.id;
check(
  'creating 400 corvettes emits one aggregate order and no queue explosion',
  bulkCreated.ok
    && state.bulkProductionOrders.length === 1
    && state.bulkProductionOrders[0].manifest.length === 1
    && state.empireQueue.length === 0,
);
const firstWave = tickBulkProduction(state);
check(
  'bulk scheduler materializes only bounded physical capacity',
  firstWave.materializedCount > 0
    && firstWave.materializedCount === state.empireQueue.length
    && firstWave.materializedCount <= bulkPreview.capacity.availableTickets
    && firstWave.materializedCount < 400
    && state.bulkProductionOrders[0].tickets.length === firstWave.materializedCount,
  `wave=${firstWave.materializedCount} capacity=${bulkPreview.capacity.availableTickets}`,
);
const noInflation = tickBulkProduction(state);
check(
  'repeated scheduling cannot inflate active tickets past capacity',
  noInflation.materializedCount === 0
    && state.empireQueue.length === firstWave.materializedCount,
);

// Exercise the real empire queue, shipyard completion, automatic bulk progress,
// fleet packaging, and same-system delivery path for the first bounded wave.
const dispatched = dispatchEmpireQueue(state);
check(
  'bounded bulk tickets dispatch through the real empire queue',
  dispatched.length === firstWave.materializedCount
    && shipyard.builds.length === firstWave.materializedCount,
);
state.time = Math.max(...shipyard.builds.map((build) => build.startedAt + build.durationMs));
const completions = tickProduction(state);
const afterProduction = bulkProductionSummary(state, bulkOrderId);
check(
  'real production completion advances aggregate counters and creates deliveries',
  completions.length === firstWave.materializedCount
    && afterProduction.counts.completed === firstWave.materializedCount
    && afterProduction.counts.activeTickets === 0
    && state.bulkProductionDeliveries.length === firstWave.materializedCount,
);
const deliveryEvents = tickBulkDeliveries(state);
const delivered = state.bulkProductionDeliveries.filter((delivery) => delivery.status === 'delivered');
check(
  'delivery bridge packages and delivers the completed wave to its rally',
  deliveryEvents.length === firstWave.materializedCount
    && delivered.length === firstWave.materializedCount
    && delivered.every((delivery) => delivery.assignedFleetId)
    && new Set(delivered.map((delivery) => delivery.assignedFleetId)).size === 1,
);
check(
  '400-unit order remains aggregate after completion and delivery wiring',
  state.bulkProductionOrders.length === 1
    && state.bulkProductionOrders[0].manifest.length === 1
    && state.bulkProductionOrders[0].manifest[0].quantity === 400
    && state.empireQueue.length === 0,
);

// --- Diplomacy legality plus two-system peace settlement. ---

establishContact(state, 'ai-0', { stage: 'established', trigger: 'integration_test' });
const closedRoute = routeLegality(
  state,
  [state.stronghold, aiRestoreId],
  'player',
  { skipOrigin: true },
);
check(
  'closed borders reject transit through AI territory',
  !closedRoute.ok && closedRoute.systemId === aiRestoreId && /closed borders/i.test(closedRoute.reason),
);
const borders = createAgreement(state, AGREEMENT_OPEN_BORDERS, 'ai-0');
const openRoute = routeLegality(
  state,
  [state.stronghold, aiRestoreId],
  'player',
  { skipOrigin: true },
);
check('open-borders agreement enables the same route', borders.ok && openRoute.ok);

const war = declareWar(state, 'ai-0', {
  force: true,
  goals: [{ type: 'claimed_conquest', systemIds: [aiRestoreId, aiCedeId] }],
});
const ordinaryWarRoute = routeLegality(
  state,
  [state.stronghold, aiRestoreId],
  'player',
  { skipOrigin: true },
);
const hostileWarRoute = routeLegality(
  state,
  [state.stronghold, aiRestoreId],
  'player',
  { skipOrigin: true, allowHostile: true },
);
check(
  'formal war closes civilian transit but enables explicitly hostile routing',
  war.ok && !ordinaryWarRoute.ok && hostileWarRoute.ok && canAttackSystem(state, aiRestoreId).ok,
);

const restoreOccupation = recordOccupation(state, {
  systemId: aiRestoreId,
  occupier: 'player',
  previousActor: 'ai-0',
  warId: war.war.id,
});
const cedeOccupation = recordOccupation(state, {
  systemId: aiCedeId,
  occupier: 'player',
  previousActor: 'ai-0',
  warId: war.war.id,
});
check(
  'two wartime occupations change only temporary controllers',
  restoreOccupation.ok
    && cedeOccupation.ok
    && state.galaxies[state.activeGalaxyId].systems[aiRestoreId].owner === 'player'
    && state.galaxies[state.activeGalaxyId].systems[aiCedeId].owner === 'player',
);
const peace = concludePeace(state, war.war.id, {
  cededSystemIds: [aiCedeId],
  truceMs: 120_000,
});
const restoredRecord = state.diplomacy.occupations.find(
  (entry) => entry.id === restoreOccupation.occupation.id,
);
const cededRecord = state.diplomacy.occupations.find(
  (entry) => entry.id === cedeOccupation.occupation.id,
);
check(
  'peace restores an unceded occupation to its sovereign',
  peace.ok
    && restoredRecord?.status === 'restored'
    && restoredRecord?.recipient === 'ai-0'
    && state.galaxies[state.activeGalaxyId].systems[aiRestoreId].owner === 'ai'
    && state.galaxies[state.activeGalaxyId].systems[aiRestoreId].factionId === 'ai-0',
);
check(
  'peace permanently transfers an explicitly ceded occupation',
  cededRecord?.status === 'ceded'
    && cededRecord?.recipient === 'player'
    && state.galaxies[state.activeGalaxyId].systems[aiCedeId].owner === 'player'
    && !getActiveWar(state, 'ai-0'),
);
check(
  'postwar truce blocks renewed attacks and does not imply open borders',
  !canAttackSystem(state, aiRestoreId).ok
    && !routeLegality(state, [state.stronghold, aiRestoreId], 'player', { skipOrigin: true }).ok,
);

// --- Save/reload round trip with all three systems active. ---

const envelope = serialize(state);
const loadedResult = deserialize(envelope);
check('v16 overhaul state passes production checksum and deserialize pipeline', loadedResult.ok, loadedResult.error ?? '');
if (loadedResult.ok) {
  const loaded = loadedResult.state;
  const loadedBulk = bulkProductionSummary(loaded, bulkOrderId);
  const loadedCampaign = loaded.strategicOrders.campaigns.find((entry) => entry.id === campaignId);
  const loadedRestored = loaded.diplomacy.occupations.find((entry) => entry.id === restoreOccupation.occupation.id);
  const loadedCeded = loaded.diplomacy.occupations.find((entry) => entry.id === cedeOccupation.occupation.id);
  check(
    'save/reload preserves aggregate 400-corvette progress without row expansion',
    loadedBulk?.counts.ordered === 400
      && loadedBulk?.counts.completed === firstWave.materializedCount
      && loaded.bulkProductionOrders.length === 1
      && loaded.bulkProductionOrders[0].manifest.length === 1
      && loaded.empireQueue.length === 0,
    JSON.stringify({
      counts: loadedBulk?.counts,
      orders: loaded.bulkProductionOrders.length,
      lines: loaded.bulkProductionOrders[0]?.manifest?.length,
      queue: loaded.empireQueue.length,
    }),
  );
  check(
    'save/reload preserves the one-record 50-outpost campaign',
    loadedCampaign?.targets.length === 50
      && loaded.strategicOrders.campaigns.length === 1
      && strategicOrdersSummary(loaded).campaigns.length === 1,
  );
  check(
    'save/reload preserves restored and ceded sovereignty outcomes',
    loadedRestored?.status === 'restored'
      && loadedCeded?.status === 'ceded'
      && loaded.galaxies[loaded.activeGalaxyId].systems[aiRestoreId].factionId === 'ai-0'
      && loaded.galaxies[loaded.activeGalaxyId].systems[aiCedeId].owner === 'player',
  );
  check(
    'save/reload preserves completed delivery fleet assignments',
    loaded.bulkProductionDeliveries.length === firstWave.materializedCount
      && loaded.bulkProductionDeliveries.every((delivery) => (
        delivery.status === 'delivered' && !!delivery.assignedFleetId
      )),
  );
}

console.log(`\nV16 OVERHAUL INTEGRATION: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
