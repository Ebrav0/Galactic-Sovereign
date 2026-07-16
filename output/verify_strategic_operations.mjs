import assert from 'node:assert/strict';

import {
  PRESET_CONSTRUCTION_TEMPLATES,
  cloneConstructionTemplate,
  deleteConstructionTemplate,
  materializeConstructionTemplate,
  saveConstructionTemplate,
  validateConstructionTemplate,
} from '../src/js/construction-templates.js';
import {
  cancelExpansionCampaign,
  createExpansionCampaign,
  ensureStrategicOrdersState,
  pauseExpansionCampaign,
  previewExpansionCampaign,
  resumeExpansionCampaign,
  strategicOrdersSummary,
  tickStrategicOperations,
} from '../src/js/strategic-operations.js';

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function planet(id = 'p1', type = 'habitable', resourceScore = 0) {
  return {
    id,
    kind: 'planet',
    type,
    name: id,
    orbitRadius: Number(id.replace(/\D/g, '')) || 1,
    orbitPeriodMs: 1000,
    orbitPhase: 0,
    resourceScore,
    moons: [],
  };
}

function system(id, owner = 'neutral', bodies = [planet()]) {
  return {
    id,
    name: `System ${id}`,
    owner,
    factionId: owner === 'ai' ? 'ai-0' : null,
    star: { kind: 'yellow' },
    bodies,
    structures: [],
    dyson: { completedShells: 0, disabled: false },
  };
}

function makeState(targetCount = 1) {
  const systems = { source: system('source', 'player', [planet('home', 'habitable')]) };
  const stars = [{ id: 'source', name: 'Source', x: 0, y: 0 }];
  const lanes = [];
  for (let index = 1; index <= targetCount; index++) {
    const id = `sys-${String(index).padStart(3, '0')}`;
    systems[id] = system(id);
    stars.push({ id, name: id, x: index, y: index % 5 });
    lanes.push(['source', id]);
  }
  return {
    time: 0,
    credits: 1_000_000,
    activeGalaxyId: 'gal-0',
    homeGalaxyId: 'gal-0',
    stronghold: 'source',
    flagship: { galaxyId: 'gal-0', systemId: 'source', transit: null, wormholeTransit: null },
    research: {
      unlocked: ['eco_baseline', 'eco_construction_drones', 'eco_sector_capitals'],
      queue: [],
      activeNodeId: null,
      progress: 0,
    },
    factions: { list: [{ id: 'ai-0', name: 'Test Faction' }] },
    galaxies: {
      'gal-0': {
        status: 'active',
        graph: { stars, blackHole: { id: 'core', name: 'Core', x: -10, y: -10 }, lanes },
        systems,
        intel: { source: { gatheredAt: 0 } },
        capture: {},
      },
    },
  };
}

// State normalization and template CRUD.
const state = makeState(60);
const orders = ensureStrategicOrdersState(state);
check('strategic state initializes persistent collections', Array.isArray(orders.campaigns)
  && Array.isArray(orders.templates) && orders.nextCampaignId === 1);
check('six required construction presets exist',
  ['frontier', 'industrial', 'military', 'research', 'trade', 'dyson']
    .every((id) => PRESET_CONSTRUCTION_TEMPLATES[id]));

const invalidRequiredSkip = validateConstructionTemplate({
  name: 'Invalid',
  steps: [{ id: 'foundation', structureType: 'outpost', selector: 'best_habitable_planet', required: true, onUnavailable: 'skip' }],
});
check('required steps cannot silently skip', !invalidRequiredSkip.ok
  && invalidRequiredSkip.errors.some((error) => error.includes('cannot use skip')));

const saved = saveConstructionTemplate(state, {
  name: 'Custom Frontier',
  steps: [{
    id: 'foundation',
    structureType: 'outpost',
    selector: 'best_habitable_planet',
    required: true,
    onUnavailable: 'wait',
  }],
});
const cloned = cloneConstructionTemplate(state, saved.template.id, { name: 'Custom Frontier Copy' });
const deleted = deleteConstructionTemplate(state, saved.template.id);
check('custom templates save, clone, and delete with deterministic ids', saved.ok && cloned.ok && deleted.ok
  && saved.template.id === 'template-1' && cloned.template.id === 'template-2');

// Materialization determinism and projected dependency validation.
const templateState = makeState(1);
templateState.galaxies['gal-0'].systems['sys-001'].bodies = [
  planet('rich-barren', 'barren', 20),
  planet('habitable-anchor', 'habitable', 2),
  planet('gas-world', 'gas', 50),
];
const industrialA = materializeConstructionTemplate(templateState, 'sys-001', 'industrial', { ignoreTechnology: true });
const industrialB = materializeConstructionTemplate(templateState, 'sys-001', 'industrial', { ignoreTechnology: true });
check('template materialization is byte-for-byte deterministic',
  JSON.stringify(industrialA) === JSON.stringify(industrialB));
check('best valid resource placement respects projected outpost dependency', industrialA.jobs.some((job) => (
  job.structureType === 'power_grid'
  && job.bodyId === 'habitable-anchor'
  && job.dependsOnClientIds.includes(industrialA.jobs[0].clientId)
)));

const deadState = makeState(1);
deadState.galaxies['gal-0'].systems['sys-001'].bodies = [];
const deadFrontier = materializeConstructionTemplate(deadState, 'sys-001', 'frontier', { ignoreTechnology: true });
check('zero-planet Frontier uses explicit system-node Forward Base fallback', deadFrontier.ready
  && deadFrontier.jobs[0]?.structureType === 'forward_base'
  && deadFrontier.jobs[0]?.bodyId === null
  && deadFrontier.jobs[0]?.systemNodeFallback === true);

// 50-outpost preview and compact persistent order state.
const scaleSpec = {
  name: 'Fifty Outposts',
  sourceSystemId: 'source',
  count: 50,
  requiredStructureType: 'outpost',
  filters: { owner: 'neutral' },
  templateId: 'frontier',
  reserve: 50_000,
  concurrency: 3,
};
const scaleHooks = {
  hasIntel: () => false,
  previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 0 }),
};
const scalePreview = previewExpansionCampaign(state, scaleSpec, { hooks: scaleHooks });
check('50-outpost preview selects exactly fifty valid systems', scalePreview.ok
  && scalePreview.requestedCount === 50 && scalePreview.targets.length === 50);
check('unknown targets are explicitly marked for recon', scalePreview.targets.every((target) => target.requiresRecon));
check('Frontier doctrine force and default concurrency policies are applied', scalePreview.policy.captureForceMultiplier === 1.15
  && scalePreview.policy.combatPowerMultiplier === 1.2 && scalePreview.policy.concurrency === 3
  && scalePreview.policy.retryLimit === 2 && scalePreview.policy.casualtyCap === 0.35);
const scaleCreated = createExpansionCampaign(state, scalePreview);
check('50-target campaign persists as one compact strategic order', scaleCreated.ok
  && state.strategicOrders.campaigns.length === 1
  && scaleCreated.campaign.targets.length === 50
  && scaleCreated.campaign.targets.every((target) => target.phase === 'planned'));

// Full callback-driven phase progression, including recon, battle, capture, build, and secure.
const flowState = makeState(1);
const flowId = 'sys-001';
const flowPreview = previewExpansionCampaign(flowState, {
  sourceSystemId: 'source',
  targets: [flowId],
  templateId: 'frontier',
}, {
  hooks: {
    hasIntel: () => false,
    previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 20 }),
  },
});
const flowCreated = createExpansionCampaign(flowState, flowPreview);
assert.equal(flowCreated.ok, true);
const flowHooks = {
  hasIntel: () => false,
  requestScout: () => ({ ok: true, complete: true, scoutId: 'scout-1' }),
  assessTarget: (_state, { target }) => ({
    ok: true,
    requiredCaptureForce: target.requirements.captureForce,
    requiredCombatPower: target.requirements.combatPower,
    hostileCombatPower: 20,
    availableCaptureForce: 100,
    availableCombatPower: 100,
  }),
  dispatchFleet: () => ({ ok: true, arrived: true, fleetIds: ['fleet-1'], capturePower: 100, combatPower: 100 }),
  beginCombat: () => ({ ok: true, combatId: 'combat-1' }),
  combatStatus: () => ({ ok: true, status: 'victory' }),
  captureStatus: (liveState) => {
    liveState.galaxies['gal-0'].systems[flowId].owner = 'player';
    return { ok: true, complete: true, status: 'complete', progressMs: 20_000 };
  },
  dispatchBuild: (_state, { plan }) => ({ ok: true, complete: true, status: 'complete', orderIds: ['build-1'], spent: plan.totalCost }),
  secureTarget: () => ({ ok: true, complete: true, status: 'complete' }),
};
const observedPhases = [];
for (let index = 0; index < 8; index++) {
  flowState.time += 500;
  tickStrategicOperations(flowState, { force: true, hooks: flowHooks });
  observedPhases.push(flowState.strategicOrders.campaigns[0].targets[0].phase);
}
const flowCampaign = flowState.strategicOrders.campaigns[0];
check('injected hooks drive every operational phase to completion',
  ['staging', 'traveling', 'fighting', 'capturing', 'constructing', 'securing', 'complete']
    .every((phase) => observedPhases.includes(phase)), observedPhases.join(' → '));
check('completed campaign records spend, links, and terminal status', flowCampaign.status === 'complete'
  && flowCampaign.budget.spent === 300 && flowCampaign.targets[0].construction.orderIds[0] === 'build-1');

// Retry limit is a hard, resumable blocker on the second failed attempt.
const retryState = makeState(1);
const retryPreview = previewExpansionCampaign(retryState, {
  sourceSystemId: 'source', targets: ['sys-001'], templateId: 'frontier',
}, { hooks: { hasIntel: () => true, previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 10 }) } });
assert.equal(createExpansionCampaign(retryState, retryPreview).ok, true);
const retryHooks = {
  hasIntel: () => true,
  assessTarget: (_state, { target }) => ({
    ok: true,
    requiredCaptureForce: target.requirements.captureForce,
    requiredCombatPower: target.requirements.combatPower,
    hostileCombatPower: 10,
    availableCaptureForce: 100,
    availableCombatPower: 100,
  }),
  dispatchFleet: () => ({ ok: true, arrived: true, fleetIds: ['retry-fleet'], combatPower: 100, capturePower: 100 }),
  combatStatus: () => ({ ok: true, status: 'defeat', casualtiesPower: 0 }),
};
for (let index = 0; index < 8; index++) {
  retryState.time += 500;
  tickStrategicOperations(retryState, { force: true, hooks: retryHooks });
}
const retryCampaign = retryState.strategicOrders.campaigns[0];
check('second failed combat attempt pauses on retry limit', retryCampaign.status === 'paused'
  && retryCampaign.targets[0].attempts === 2
  && retryCampaign.targets[0].blockers.some((entry) => entry.code === 'retry_limit'));
check('paused campaign can be resumed after corrective action', resumeExpansionCampaign(retryState, retryCampaign.id).ok
  && retryCampaign.status === 'active');
check('manual pause remains non-destructive', pauseExpansionCampaign(retryState, retryCampaign.id).ok
  && retryCampaign.targets[0].phase === 'fighting');

const casualtyState = makeState(1);
const casualtyPreview = previewExpansionCampaign(casualtyState, {
  sourceSystemId: 'source', targets: ['sys-001'], templateId: 'frontier',
}, { hooks: { hasIntel: () => true, previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 10 }) } });
assert.equal(createExpansionCampaign(casualtyState, casualtyPreview).ok, true);
const casualtyHooks = {
  hasIntel: () => true,
  assessTarget: (_state, { target }) => ({
    ok: true,
    requiredCaptureForce: target.requirements.captureForce,
    requiredCombatPower: target.requirements.combatPower,
    hostileCombatPower: 10,
    availableCaptureForce: 100,
    availableCombatPower: 100,
  }),
  dispatchFleet: () => ({ ok: true, arrived: true, fleetIds: ['casualty-fleet'], combatPower: 100, capturePower: 100 }),
  combatStatus: () => ({ ok: true, status: 'defeat', casualtiesPower: 40 }),
};
for (let index = 0; index < 3; index++) {
  casualtyState.time += 500;
  tickStrategicOperations(casualtyState, { force: true, hooks: casualtyHooks });
}
const casualtyCampaign = casualtyState.strategicOrders.campaigns[0];
check('35% campaign casualty cap pauses before a retry', casualtyCampaign.status === 'paused'
  && casualtyCampaign.targets[0].blockers.some((entry) => entry.code === 'casualty_cap'));

// Named war authorization and cancellation modes.
const warState = makeState(1);
warState.galaxies['gal-0'].systems['sys-001'].owner = 'ai';
warState.galaxies['gal-0'].systems['sys-001'].factionId = 'zenith';
const unauthorized = previewExpansionCampaign(warState, {
  sourceSystemId: 'source', targets: ['sys-001'], templateId: 'frontier',
}, { hooks: { hasIntel: () => true, previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 10 }) } });
const authorized = previewExpansionCampaign(warState, {
  sourceSystemId: 'source', targets: ['sys-001'], templateId: 'frontier',
  warAuthorizations: [{ factionId: 'zenith', warGoal: 'claimed_conquest' }],
}, { hooks: { hasIntel: () => true, previewTarget: () => ({ baseCaptureRequirement: 10, hostileCombatPower: 10 }) } });
check('faction target is blocked without named war authorization', !unauthorized.ok
  && unauthorized.blockers.some((entry) => entry.code === 'war_authorization_required'));
check('named faction and war goal make the same preview legal', authorized.ok
  && authorized.targets[0].warAuthorization.warGoal === 'claimed_conquest');
const authCreated = createExpansionCampaign(warState, authorized);
const cancelled = cancelExpansionCampaign(warState, authCreated.campaign.id, 'return', {
  hooks: { returnAssets: () => ({ ok: true }) },
});
check('cancel-and-return terminates pending targets without deleting history', cancelled.ok
  && cancelled.mode === 'return'
  && warState.strategicOrders.campaigns[0].status === 'cancelled'
  && warState.strategicOrders.campaigns[0].targets[0].phase === 'cancelled');

const summary = strategicOrdersSummary(state);
check('summary is aggregate and UI-safe', summary.campaigns[0].progress.total === 50
  && summary.templates.some((template) => template.id === 'frontier')
  && !Object.hasOwn(summary.campaigns[0], 'templateSnapshot'));

const failed = checks.filter((entry) => !entry.pass);
console.log(`\nStrategic operations: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
