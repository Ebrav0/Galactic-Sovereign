// Pure unit verification for the renderer-side Sol commander contract.
import assert from 'node:assert/strict';
import {
  SOL_COMMANDER_SCHEMA_VERSION,
  SOL_TOOL_NAMES,
  SOL_TOOL_SCHEMAS,
  appendSolConversationEntry,
  buildRedactedSolSnapshot,
  buildSolRequestMetadata,
  createOfflineSolAdvice,
  createSolCommanderState,
  deleteSolConversationHistory,
  parseSolCommanderResponse,
  updateSolCommanderSettings,
  validateSolCommand,
  validateSolCommanderResponse,
} from '../src/js/sol-commander.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (cause) {
    results.push({ name, pass: false, detail: cause.stack ?? String(cause) });
    console.error(`FAIL ${name} — ${cause.message}`);
  }
}

function fixture() {
  return {
    meta: { seed: 42, createdAt: 123, apiKey: 'sk-meta-secret' },
    time: 12500,
    paused: false,
    credits: 2400,
    solarii: 8,
    activeGalaxyId: 'gal-0',
    homeGalaxyId: 'gal-0',
    apiKey: 'sk-live-secret',
    authorization: 'Bearer ultra-secret',
    research: { activeNodeId: 'eco_trade_hub', progress: 0.4, unlocked: ['eco_baseline'], queue: [] },
    galaxies: {
      'gal-0': {
        graph: {
          stars: [{ id: 'sys-home' }, { id: 'sys-mid' }, { id: 'sys-nexus' }],
          lanes: [['sys-home', 'sys-mid'], ['sys-mid', 'sys-nexus']],
        },
        systems: {
          'sys-home': {
            id: 'sys-home', owner: 'player', star: { kind: 'yellow' },
            bodies: [{ id: 'p1', type: 'habitable' }],
            structures: [{ id: 'st1', type: 'outpost', bodyId: 'p1' }],
            privateNotes: 'do not transmit this note',
          },
          'sys-mid': {
            id: 'sys-mid', owner: 'player', star: { kind: 'red' }, bodies: [], structures: [],
          },
          'sys-nexus': {
            id: 'sys-nexus', owner: 'neutral', star: { kind: 'trade_nexus', type: 'trade_nexus' },
            bodies: [], structures: [{ id: 'nexus-1', type: 'trade_nexus' }],
          },
        },
      },
    },
    flagship: { galaxyId: 'gal-0', systemId: 'sys-home' },
    playerShips: [
      { id: 'ship-1', hull: 'destroyer', hp: 350, maxHp: 350, galaxyId: 'gal-0', systemId: 'sys-home', transit: null },
      { id: 'ship-2', hull: 'frigate', hp: 200, maxHp: 200, galaxyId: 'gal-0', systemId: 'sys-home', transit: null },
    ],
    battleGroups: [{ id: 'bg-1', galaxyId: 'gal-0', shipIds: ['ship-1', 'ship-2'] }],
    tacticalOrders: {},
    systemBattles: {
      'sys-mid': { id: 'battle-1', active: true, playerUnits: [{ id: 'a' }], enemyUnits: [{ id: 'e1' }, { id: 'e2' }] },
    },
    battleReports: [],
    diplomacy: { relations: {} },
    logistics: {
      version: 1,
      depots: {
        'depot-1': { id: 'depot-1', systemId: 'sys-home', capacity: 220, cargo: { rawMaterials: 40, fuel: 12, manufacturedGoods: 6 } },
      },
      convoys: [{ id: 'convoy-1', routeId: 'route-1', fromSystemId: 'sys-home', toSystemId: 'sys-nexus', status: 'lane', cargo: { fuel: 10 } }],
      routes: [{ id: 'route-1', fromSystemId: 'sys-home', toSystemId: 'sys-nexus', cargoClass: 'fuel', danger: 0.2 }],
      blockedLanes: {},
      stats: { deliveredCargo: 90, lostCargo: 3, creditsEarned: 200 },
    },
    solCommander: {
      enabled: true,
      conversation: [{ role: 'user', text: 'private strategy discussion' }],
      apiKey: 'sk-commander-secret',
    },
  };
}

const validResponse = () => ({
  schemaVersion: SOL_COMMANDER_SCHEMA_VERSION,
  summary: 'Hold the fleet while inspecting the active trade network.',
  recommendations: [
    {
      id: 'rec-1',
      tool: 'propose_fleet_order',
      title: 'Hold the fleet',
      rationale: 'Preserve a ready response force while the convoy is exposed.',
      confidence: 0.9,
      arguments: { fleetId: 'bg-1', order: 'hold' },
    },
  ],
});

check('tool contract contains all seven strict actions', () => {
  assert.deepEqual([...SOL_TOOL_NAMES].sort(), [
    'explain_battle', 'inspect_empire', 'inspect_logistics', 'inspect_system',
    'propose_build', 'propose_fleet_order', 'propose_route',
  ]);
  for (const tool of SOL_TOOL_NAMES) assert.equal(SOL_TOOL_SCHEMAS[tool].parameters.additionalProperties, false);
});

check('snapshot is compact, allowlisted, redacted, and read-only', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const snapshot = buildRedactedSolSnapshot(state);
  const serialized = JSON.stringify(snapshot);
  assert.equal(JSON.stringify(state), before);
  assert.equal(snapshot.activeGalaxyId, 'gal-0');
  assert.equal(snapshot.empire.shipCount, 2);
  assert.equal(snapshot.logistics.depots[0].cargo.rawMaterials, 40);
  assert(serialized.length < before.length);
  for (const forbidden of ['sk-live-secret', 'sk-meta-secret', 'sk-commander-secret', 'ultra-secret', 'private strategy discussion', 'do not transmit this note']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(Object.isFrozen(snapshot), true);
});

check('valid structured recommendation parses without mutating input', () => {
  const response = validResponse();
  const before = JSON.stringify(response);
  const parsed = parseSolCommanderResponse(JSON.stringify(response));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.value.recommendations[0].tool, 'propose_fleet_order');
  assert.equal(JSON.stringify(response), before);
  assert.equal(Object.isFrozen(parsed.value), true);
});

check('malformed, unknown, and malicious model output is rejected', () => {
  assert.equal(parseSolCommanderResponse('```json\n{}\n```').ok, false);

  const unknownTool = validResponse();
  unknownTool.recommendations[0].tool = 'execute_shell_command';
  assert.equal(validateSolCommanderResponse(unknownTool).ok, false);

  const unknownRoot = { ...validResponse(), apiKey: 'sk-injected' };
  assert.equal(validateSolCommanderResponse(unknownRoot).ok, false);

  const unknownArgument = validResponse();
  unknownArgument.recommendations[0].arguments.overrideValidation = true;
  assert.equal(validateSolCommanderResponse(unknownArgument).ok, false);

  const unknownOrder = validResponse();
  unknownOrder.recommendations[0].arguments.order = 'delete_save';
  assert.equal(validateSolCommanderResponse(unknownOrder).ok, false);

  const duplicate = validResponse();
  duplicate.recommendations.push({ ...duplicate.recommendations[0] });
  assert.equal(validateSolCommanderResponse(duplicate).ok, false);

  const polluted = JSON.parse('{"schemaVersion":1,"summary":"x","recommendations":[],"__proto__":{"admin":true}}');
  assert.equal(validateSolCommanderResponse(polluted).ok, false);
  assert.equal({}.admin, undefined);
});

check('second-stage validation gates confirmation and never executes', () => {
  const state = fixture();
  const recommendation = validResponse().recommendations[0];
  const before = JSON.stringify(state);

  const display = validateSolCommand(state, recommendation, { stage: 'display' });
  assert.equal(display.ok, true);
  assert.equal(display.requiresConfirmation, true);
  assert.equal(display.executable, false);

  const declined = validateSolCommand(state, recommendation, { stage: 'execute', confirmed: false });
  assert.equal(declined.ok, false);
  assert.equal(declined.code, 'confirmation_required');

  const accepted = validateSolCommand(state, recommendation, { stage: 'execute', confirmed: true });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.executable, true);
  assert.deepEqual(accepted.command, { tool: 'propose_fleet_order', arguments: { fleetId: 'bg-1', order: 'hold' } });
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.tacticalOrders['bg-1'], undefined);
});

check('state validator checks routes and authoritative build policy', () => {
  const state = fixture();
  const route = {
    id: 'rec-route', tool: 'propose_route', title: 'Route cargo',
    rationale: 'Move cargo along the shortest unblocked lane path.', confidence: 0.8,
    arguments: { fromSystemId: 'sys-home', toSystemId: 'sys-nexus', cargoClass: 'fuel' },
  };
  const routeResult = validateSolCommand(state, route, { stage: 'execute', confirmed: true });
  assert.equal(routeResult.ok, true);
  assert.deepEqual(routeResult.path, ['sys-home', 'sys-mid', 'sys-nexus']);

  const build = {
    id: 'rec-build', tool: 'propose_build', title: 'Build depot',
    rationale: 'Stage physical exports from this controlled system.', confidence: 0.75,
    arguments: { systemId: 'sys-home', structureType: 'export_depot' },
  };
  assert.equal(validateSolCommand(state, build, { stage: 'display' }).code, 'build_policy_required');
  const buildResult = validateSolCommand(state, build, {
    stage: 'execute', confirmed: true,
    buildCatalog: { export_depot: { cost: 400, tech: 'eco_baseline', disallowOnTradeNexus: true } },
  });
  assert.equal(buildResult.ok, true);
  assert.equal(buildResult.cost, 400);
  assert.equal(state.credits, 2400);
});

check('offline advisor is deterministic and emits the strict schema', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const first = createOfflineSolAdvice(state);
  const second = createOfflineSolAdvice(state);
  assert.deepEqual(first, second);
  assert.equal(validateSolCommanderResponse(first).ok, true);
  assert(first.recommendations.some((rec) => rec.tool === 'inspect_empire'));
  assert(first.recommendations.some((rec) => rec.tool === 'explain_battle'));
  assert(first.recommendations.some((rec) => rec.tool === 'propose_fleet_order'));
  assert.equal(JSON.stringify(state), before);
});

check('settings and conversation deletion are immutable and complete', () => {
  const base = createSolCommanderState();
  assert.equal(base.settings.enabled, false);
  assert.equal(base.settings.providerMode, 'offline');
  assert.equal(base.settings.confirmationRequired, true);

  const enabled = updateSolCommanderSettings(base, { enabled: true, providerMode: 'sol', requestLimitPerHour: 6 });
  const withHistory = appendSolConversationEntry(enabled, {
    id: 'message-1', role: 'user', text: 'Protect the convoy.', gameTimeMs: 12500,
  });
  const cleared = deleteSolConversationHistory(withHistory);
  assert.equal(withHistory.history.length, 1);
  assert.equal(cleared.history.length, 0);
  assert.equal(cleared.settings.enabled, true);
  assert.equal(base.settings.enabled, false);
  assert.throws(() => updateSolCommanderSettings(base, { apiKey: 'sk-nope' }), /Unknown Sol setting/);
});

check('request metadata contains correlation data but no snapshot or secret', () => {
  const snapshot = buildRedactedSolSnapshot(fixture());
  const metadata = buildSolRequestMetadata({
    snapshot,
    requestId: 'request-1',
    mode: 'sol',
    model: 'gpt-5.6-sol',
    apiKey: 'sk-must-be-ignored',
  });
  const serialized = JSON.stringify(metadata);
  assert.equal(metadata.mode, 'sol');
  assert.equal(metadata.requestId, 'request-1');
  assert.equal(typeof metadata.snapshotHash, 'string');
  assert.equal(Object.hasOwn(metadata, 'snapshot'), false);
  assert.equal(serialized.includes('sk-must-be-ignored'), false);
  assert.equal(serialized.includes('sys-home'), false);
});

const failed = results.filter((result) => !result.pass);
console.log(`\nSol commander unit verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
