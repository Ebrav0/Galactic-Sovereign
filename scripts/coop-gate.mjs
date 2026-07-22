#!/usr/bin/env node
/**
 * Co-op parity gate — protocol + host-integration checks.
 *
 * Requires a running host: GS_COOP_RESET=1 npm run coop
 * Then: npm run coop:gate
 */

import WebSocket from 'ws';
import { COOP_COMMAND_REGISTRY, WORLD_MUTATING_COMMANDS } from '../server/actions.mjs';
import {
  projectSharedState,
  diffSharedState,
  applySharedStateDelta,
} from '../src/js/coop-replication.js';
import { PROTOCOL_VERSION } from '../src/js/coop-protocol.js';

const PORT = Number(process.env.GS_COOP_PORT || 9090);
const PASSWORD = process.env.GS_COOP_PASSWORD || '';
const URL = process.env.GS_COOP_URL || `ws://127.0.0.1:${PORT}`;

function once(ws, type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const onMsg = (raw) => {
      const msg = JSON.parse(String(raw));
      const aliases = type === 'summary' ? new Set(['summary', 'pose']) : new Set([type]);
      if (aliases.has(msg.type)) {
        if (msg.type === 'pose' && !msg.summary) msg.summary = msg.pose;
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
  });
}

function connect(name, identity = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        playerName: name,
        playerId: identity.playerId,
        reconnectToken: identity.reconnectToken,
        password: PASSWORD || undefined,
      }));
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

let requestSeq = 0;
function command(ws, cmd, payload = {}, timeoutMs = 8000) {
  const requestId = `gate-${++requestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for result of ${cmd}`)), timeoutMs);
    const onMsg = (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'commandResult' && msg.requestId === requestId) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ type: 'command', command: cmd, requestId, payload }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function unitReplication() {
  const before = {
    credits: 1000,
    empireQueue: [{ id: 'eq-1', status: 'pending', productId: 'scout' }],
    research: { progress: 0 },
  };
  const after = {
    credits: 900,
    empireQueue: [{ id: 'eq-1', status: 'building', productId: 'scout' }, { id: 'eq-2', status: 'pending', productId: 'frigate' }],
    research: { progress: 12 },
  };
  const projectedA = projectSharedState(before);
  const projectedB = projectSharedState(after);
  const ops = diffSharedState(projectedA, projectedB);
  assert(ops.length > 0, 'expected non-empty delta ops');
  const clone = structuredClone(projectedA);
  applySharedStateDelta(clone, ops);
  assert(clone.credits === 900, 'delta should update credits');
  assert(clone.empireQueue.length === 2, 'delta should replace queue list');

  const positionalBefore = projectSharedState({
    graph: { lanes: [['sys-1', 'sys-2'], ['sys-2', 'sys-3']] },
    logistics: { events: [{ type: 'dispatch', amount: 4 }, { type: 'delivery', amount: 8 }] },
  });
  const positionalSame = projectSharedState(structuredClone(positionalBefore));
  const unchangedOps = diffSharedState(positionalBefore, positionalSame);
  assert(unchangedOps.length === 0, 'unchanged positional arrays must not be retransmitted');

  const positionalAfter = structuredClone(positionalSame);
  positionalAfter.logistics.events[1].amount = 12;
  const positionalOps = diffSharedState(positionalBefore, positionalAfter);
  assert(positionalOps.length === 1, `one nested positional change should produce one op, got ${positionalOps.length}`);
  assert(
    positionalOps[0].path.join('.') === 'logistics.events.1.amount',
    `unexpected positional delta path: ${positionalOps[0].path.join('.')}`,
  );
  const positionalClone = structuredClone(positionalBefore);
  applySharedStateDelta(positionalClone, positionalOps);
  assert(positionalClone.logistics.events[1].amount === 12, 'positional delta should apply at the changed index');

  const resizedAfter = structuredClone(positionalAfter);
  resizedAfter.graph.lanes.push(['sys-3', 'sys-4']);
  const resizedOps = diffSharedState(positionalAfter, resizedAfter);
  assert(
    resizedOps.length === 1 && resizedOps[0].path.join('.') === 'graph.lanes',
    'resized positional arrays should still be replaced atomically',
  );

  const rosterBefore = { playerFlagships: [{ pilotId: 'alpha', callsign: 'Alpha' }] };
  const rosterAfter = { playerFlagships: [{ pilotId: 'beta', callsign: 'Beta' }] };
  const rosterOps = diffSharedState(rosterBefore, rosterAfter);
  assert(
    rosterOps.length === 1 && rosterOps[0].path.join('.') === 'playerFlagships',
    'same-length entity roster identity changes should remain atomic',
  );
  console.log('[gate] unit replication PASS');
}

function registryAudit() {
  const required = [
    'enqueueProduct', 'cancelQueueItem', 'pinQueueItem', 'reorderQueueItem',
    'buildBodyStructure', 'confirmBuilderConstructionPlan',
    'diplomacyAction', 'createBulkProductionOrder', 'createExpansionCampaign',
    'setCombatPriority', 'cancelTacticalRetreat', 'promoteBattleToTactical',
    'issueTacticalOrder', 'setCombatDoctrine', 'setAdvancedTactics',
    'togglePaused', 'requestSnapshot', 'revokeControl', 'grantControl',
    'buildHeroFlagship', 'enterWormhole', 'devAction',
  ];
  for (const name of required) {
    assert(COOP_COMMAND_REGISTRY.has(name), `missing command registry entry: ${name}`);
  }
  for (const name of required) {
    if (name === 'requestSnapshot') continue;
    if (name === 'setFlagshipInput') continue;
    // pose-only commands are allowed outside WORLD_MUTATING
    const poseOnly = new Set(['orderTravel', 'toggleOrbit', 'toggleWingHangar', 'requestSnapshot', 'setFlagshipInput']);
    if (poseOnly.has(name)) continue;
    assert(WORLD_MUTATING_COMMANDS.has(name), `missing world-mutating entry: ${name}`);
  }
  assert(COOP_COMMAND_REGISTRY.size >= 70, `registry too small: ${COOP_COMMAND_REGISTRY.size}`);
  console.log(`[gate] registry audit PASS (${COOP_COMMAND_REGISTRY.size} commands)`);
}

async function hostIntegration() {
  console.log(`[gate] connecting to ${URL}`);
  const a = await connect('gate-a');
  const welcomeA = await once(a, 'welcome');
  assert(welcomeA.protocolVersion === PROTOCOL_VERSION, 'welcome protocol mismatch');
  assert(welcomeA.worldId, 'welcome missing worldId');
  assert(welcomeA.reconnectToken, 'welcome missing reconnectToken');

  const b = await connect('gate-b');
  const welcomeB = await once(b, 'welcome');
  assert(welcomeB.worldId === welcomeA.worldId, 'pilots must share worldId');

  // Idempotent command replay
  const pause1 = await command(a, 'setPaused', { paused: true });
  assert(pause1.result?.ok, `pause failed: ${JSON.stringify(pause1.result)}`);
  const pause2 = await command(a, 'setPaused', { paused: true });
  // Same requestId cache is per requestId; different ids both apply.
  assert(pause2.result?.ok, 'second pause should succeed');

  // Pose channel
  const pose = await once(b, 'pose');
  assert(pose.tick >= 0 && pose.revision > 0, 'pose missing tick/revision');
  assert(pose.summary?.flagships?.['gate-a'], 'missing gate-a flagship pose');
  assert(pose.summary?.flagships?.['gate-b'], 'missing gate-b flagship pose');

  // Unknown command fails closed
  const unknown = await command(a, 'notARealCommand', {});
  assert(!unknown.result?.ok, 'unknown command should fail closed');

  // Reconnect with stable identity
  const identity = {
    playerId: welcomeA.playerId,
    reconnectToken: welcomeA.reconnectToken,
  };
  a.close();
  await sleep(200);
  const a2 = await connect('gate-a', identity);
  const welcomeA2 = await once(a2, 'welcome');
  assert(welcomeA2.playerId === welcomeA.playerId, 'reconnect should keep playerId');

  // Catch-up checkpoint / welcome snapshot
  assert(welcomeA2.snapshotJson, 'reconnect welcome should include checkpoint snapshot');

  await command(a2, 'setPaused', { paused: false });
  a2.close();
  b.close();
  console.log('[gate] host integration PASS');
}

async function main() {
  unitReplication();
  registryAudit();
  await hostIntegration();
  console.log('[gate] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[gate] FAIL', err);
  process.exit(1);
});
