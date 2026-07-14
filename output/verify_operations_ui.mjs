import assert from 'node:assert/strict';

import { createBulkProductionOrder } from '../src/js/bulk-production.js';
import { listPlayerShipyards } from '../src/js/empire-queue.js';
import {
  createExpansionCampaign,
  previewExpansionCampaign,
} from '../src/js/strategic-operations.js';
import {
  operationsPanelSnapshot,
  parseBulkManifest,
  parseWarAuthorizations,
} from '../src/js/operations-ui.js';
import { createNewGame, systemById } from '../src/js/state.js';

let passed = 0;
function check(label, condition, details = '') {
  assert.ok(condition, `${label}${details ? `: ${details}` : ''}`);
  passed += 1;
  console.log(`PASS ${label}${details ? ` - ${details}` : ''}`);
}

const parsed = parseBulkManifest('corvette x400\n20 destroyer\ncorvette: 5');
check('multi-hull parser accepts common command formats', parsed.ok);
check('multi-hull parser merges duplicate hull lines',
  parsed.manifest.find((line) => line.hull === 'corvette')?.quantity === 405);
check('multi-hull parser rejects invalid quantities',
  !parseBulkManifest('corvette x 0').ok);

const wars = parseWarAuthorizations('ai-0: claimed conquest\nai-2=border security');
check('named war authorization parser accepts faction goals', wars.ok
  && wars.authorizations[0].factionId === 'ai-0'
  && wars.authorizations[1].warGoal === 'border_security');

const state = createNewGame(99123);
state.credits = 1_000_000_000;
for (const tech of [
  'mil_parallel_dock',
  'eco_industrial_automation',
  'eco_construction_drones',
  'eco_sector_capitals',
]) {
  if (!state.research.unlocked.includes(tech)) state.research.unlocked.push(tech);
}
if (listPlayerShipyards(state).length === 0) {
  const home = systemById(state, state.stronghold);
  home.structures.push({
    id: 'operations-ui-yard',
    type: 'shipyard',
    bodyId: home.bodies[0].id,
    level: 1,
    builtAtTime: 0,
    hp: 900,
    maxHp: 900,
    operational: true,
    disabledUntil: 0,
    mothballed: false,
    builds: [],
  });
}

const bulk = createBulkProductionOrder(state, {
  name: 'Four Hundred Corvettes',
  manifest: [{ hull: 'corvette', quantity: 400 }],
  priority: 'normal',
  allowedShipyardIds: null,
  rally: { type: 'flagship' },
  packaging: { mode: 'new_fleets', splitSize: 40 },
});
check('scale fixture creates one 400-ship aggregate order', bulk.ok, bulk.reason);

const campaignPreview = previewExpansionCampaign(state, {
  name: 'Fifty Outposts',
  count: 50,
  filters: { owner: 'neutral' },
  templateId: 'frontier',
  concurrency: 3,
  requiredStructureType: 'outpost',
}, {
  hooks: {
    hasIntel: () => false,
    previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 0 }),
  },
});
check('scale fixture previews 50 targets', campaignPreview.ok
  && campaignPreview.selectedCount === 50);
const campaign = createExpansionCampaign(state, campaignPreview);
check('scale fixture creates one aggregate campaign', campaign.ok);

const snapshot = operationsPanelSnapshot(state);
check('operations snapshot keeps 400 ships as one manifest line',
  snapshot.bulk.orders.length === 1
  && snapshot.bulk.orders[0].manifest.length === 1
  && snapshot.bulk.orders[0].counts.ordered === 400);
check('operations snapshot keeps 50 targets as aggregate phase counts',
  snapshot.strategic.campaigns.length === 1
  && snapshot.strategic.campaigns[0].progress.total === 50
  && !Object.hasOwn(snapshot.strategic.campaigns[0], 'targets'));
check('operations snapshot omits individual delivery and ship rows',
  !JSON.stringify(snapshot).includes('shipId')
  && !Object.hasOwn(snapshot.bulk, 'pendingDeliveries'));

console.log(`\n${passed} operations UI checks passed.`);
