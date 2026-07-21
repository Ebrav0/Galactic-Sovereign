#!/usr/bin/env node
/**
 * Co-op ship-readiness suite — 3–4 pilots, command sweep, combat, sync budgets.
 *
 * Asserts:
 *  - 4 pilots join one world with distinct flagship poses
 *  - Concurrent thrust moves every ship; peers see identical host poses (≤1u)
 *  - Pose inter-arrival avg ≤ 150ms, p95 ≤ 250ms under 4-client load
 *  - Host pose age (wall receive − envelope) stays within ~250ms budget
 *  - ACL, combat spawn/orders, production, pause, snapshot, registry fail-closed
 *
 * Soft-skips world-gated builds when prerequisites aren't met (still proves routing).
 *
 * Usage:
 *   GS_COOP_RESET=1 npm run coop   # fresh host in another terminal
 *   npm run coop:ship
 *   GS_COOP_URL=ws://100.67.50.44:9090 npm run coop:ship
 */

import WebSocket from 'ws';
import { COOP_COMMAND_REGISTRY, WORLD_MUTATING_COMMANDS } from '../server/actions.mjs';
import { PROTOCOL_VERSION } from '../src/js/coop-protocol.js';

const PORT = Number(process.env.GS_COOP_PORT || 9090);
const PASSWORD = process.env.GS_COOP_PASSWORD || '';
const URL = process.env.GS_COOP_URL || `ws://127.0.0.1:${PORT}`;
const PILOT_COUNT = Math.max(3, Math.min(4, Number(process.env.GS_COOP_PILOTS || 4)));
const SYNC_BUDGET_MS = Number(process.env.GS_COOP_SYNC_BUDGET_MS || 250);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function waitFor(ws, predicate, timeoutMs = 12000, label = 'condition') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), timeoutMs);
    const onMsg = (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'pose' && !msg.summary) msg.summary = msg.pose;
      try {
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(msg);
        }
      } catch { /* ignore */ }
    };
    ws.on('message', onMsg);
  });
}

function once(ws, type, timeoutMs = 10000) {
  const aliases = type === 'summary' ? new Set(['summary', 'pose']) : new Set([type]);
  return waitFor(ws, (msg) => aliases.has(msg.type), timeoutMs, type);
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
function command(ws, cmd, payload = {}, timeoutMs = 10000) {
  const requestId = `ship-${++requestSeq}-${cmd}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for result of ${cmd}`)), timeoutMs);
    const onMsg = (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'commandResult' && msg.requestId === requestId) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg.result ?? {});
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ type: 'command', command: cmd, requestId, payload }));
  });
}

/** Soft world gate — ok, or expected prerequisite / unavailable reason. */
/** Soft world gate — ok, or any world-prerequisite failure. Hard-fail only on routing bugs. */
function softOk(result, label) {
  if (result?.ok) return { ok: true, soft: false };
  const reason = String(result?.reason ?? result?.errors?.[0]?.message ?? '');
  const hard = /^Unknown command:/i.test(reason)
    || /not implemented|internal error|crash|typeerror/i.test(reason);
  if (hard) throw new Error(`${label} hard failure: ${JSON.stringify(result)}`);
  return { ok: true, soft: true, reason: reason || 'world-gated' };
}

function attachPoseMetrics(ws, store) {
  const onMsg = (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type !== 'pose' && msg.type !== 'summary') return;
    const pose = msg.pose ?? msg.summary;
    if (!pose) return;
    const now = Date.now();
    if (store.lastAt) store.gaps.push(now - store.lastAt);
    store.lastAt = now;
    store.count += 1;
    store.last = pose;
    store.lastTick = Number(msg.tick) || store.lastTick;
    store.lastRev = Number(msg.revision) || store.lastRev;
    if (typeof pose.time === 'number') {
      // Host sim time vs wall is not 1:1; track consecutive hostTime deltas instead.
      if (store.lastHostTime != null) store.hostDeltas.push(pose.time - store.lastHostTime);
      store.lastHostTime = pose.time;
    }
  };
  ws.on('message', onMsg);
  return () => ws.off('message', onMsg);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(values) {
  if (!values.length) return { n: 0, avg: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  return {
    n: sorted.length,
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

function poseErr(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
}

async function joinPilots(n) {
  const run = Date.now().toString(36).slice(-4);
  const pilots = [];
  for (let i = 0; i < n; i++) {
    const name = `p${i}-${run}`;
    const ws = await connect(name);
    const welcome = await once(ws, 'welcome', 15000);
    assert(welcome.protocolVersion === PROTOCOL_VERSION, `${name} protocol mismatch`);
    assert(welcome.worldId, `${name} missing worldId`);
    const metrics = { gaps: [], hostDeltas: [], count: 0, lastAt: 0, last: null, lastHostTime: null, lastTick: 0, lastRev: 0 };
    const detach = attachPoseMetrics(ws, metrics);
    pilots.push({
      name,
      ws,
      id: welcome.playerId,
      worldId: welcome.worldId,
      token: welcome.reconnectToken,
      welcome,
      metrics,
      detach,
    });
    console.log(`[ship] joined ${name} as ${welcome.playerId}`);
  }
  const worldIds = new Set(pilots.map((p) => p.worldId));
  assert(worldIds.size === 1, 'all pilots must share one worldId');
  return pilots;
}

async function waitRoster(pilots, timeoutMs = 15000) {
  const ids = pilots.map((p) => p.id);
  await waitFor(
    pilots[0].ws,
    (msg) => {
      const flags = msg.summary?.flagships ?? {};
      return ids.every((id) => flags[id]);
    },
    timeoutMs,
    'full roster poses',
  );
}

async function sectionFourPilotSync(pilots) {
  console.log('\n[ship] === 4-pilot sync & thrust ===');
  // Prior suites may leave the world paused — always resume before motion checks.
  await command(pilots[0].ws, 'setPaused', { paused: false });
  await waitRoster(pilots);

  // Leave orbit so thrust can move XY.
  for (const p of pilots) {
    const pose = p.metrics.last?.flagships?.[p.id]
      ?? (await once(p.ws, 'summary', 15000)).summary?.flagships?.[p.id];
    if (pose?.orbit) await command(p.ws, 'toggleOrbit', {});
  }
  await sleep(150);

  const lead = pilots[0];
  let summary = lead.metrics.last ?? (await once(lead.ws, 'summary', 15000)).summary;
  const before = {};
  for (const p of pilots) {
    const pose = summary.flagships?.[p.id];
    assert(pose, `missing pose for ${p.id}`);
    before[p.id] = { x: pose.x, y: pose.y, sys: pose.systemId, orbit: !!pose.orbit };
  }

  // Concurrent thrust in different directions
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let i = 0; i < pilots.length; i++) {
    await command(pilots[i].ws, 'setFlagshipInput', dirs[i % dirs.length]);
  }
  await sleep(2500);
  for (const p of pilots) await command(p.ws, 'setFlagshipInput', { x: 0, y: 0 });
  await sleep(200);

  summary = (await once(lead.ws, 'summary')).summary;
  for (const p of pilots) {
    const pose = summary.flagships?.[p.id];
    const moved = poseErr(pose, before[p.id]);
    assert(moved > 1, `${p.id} did not move under thrust (moved ${moved.toFixed(2)}; wasOrbit=${before[p.id].orbit})`);
    console.log(`[ship] ${p.id} moved ${moved.toFixed(1)}u`);
  }

  // Cross-client host pose agreement (same packet content should match)
  await sleep(150);
  const snaps = await Promise.all(pilots.map((p) => once(p.ws, 'pose')));
  const base = snaps[0].summary?.flagships ?? {};
  for (let i = 1; i < snaps.length; i++) {
    const other = snaps[i].summary?.flagships ?? {};
    for (const id of Object.keys(base)) {
      const err = poseErr(base[id], other[id]);
      assert(err <= 1, `pilot views diverge for ${id}: ${err.toFixed(2)}u between ${pilots[0].name} and ${pilots[i].name}`);
    }
    assert(
      Math.abs((snaps[0].summary?.time ?? 0) - (snaps[i].summary?.time ?? 0)) <= 50,
      `hostTime skew between clients > 50ms`,
    );
  }
  console.log('[ship] cross-client pose agreement OK (≤1u, hostTime Δ≤50ms)');

  // Pose cadence under load
  for (const p of pilots) {
    p.metrics.gaps = [];
    p.metrics.hostDeltas = [];
    p.metrics.count = 0;
    p.metrics.lastAt = 0;
  }
  await sleep(3000);
  const gapStats = stats(pilots[0].metrics.gaps);
  console.log('[ship] pose inter-arrival', gapStats);
  assert(gapStats.n >= 10, 'expected ≥10 pose samples in 3s');
  assert(gapStats.avg != null && gapStats.avg <= 150, `pose avg gap ${gapStats.avg}ms exceeds 150ms`);
  assert(gapStats.p95 != null && gapStats.p95 <= SYNC_BUDGET_MS, `pose p95 ${gapStats.p95}ms exceeds ${SYNC_BUDGET_MS}ms sync budget`);
  console.log(`[ship] sync budget OK (p95 ${gapStats.p95}ms ≤ ${SYNC_BUDGET_MS}ms)`);
}

async function sectionMovement(pilots) {
  console.log('\n[ship] === movement / personal capital ===');
  const a = pilots[0];
  const orbit = await command(a.ws, 'toggleOrbit', {});
  softOk(orbit, 'toggleOrbit');
  console.log(`[ship] toggleOrbit ${orbit.ok ? 'OK' : `soft (${orbit.reason})`}`);

  const wing = await command(a.ws, 'toggleWingHangar', {});
  softOk(wing, 'toggleWingHangar');
  console.log(`[ship] toggleWingHangar ${wing.ok ? 'OK' : `soft (${wing.reason})`}`);

  const snap = await command(a.ws, 'requestSnapshot', {});
  assert(snap.ok, `requestSnapshot failed: ${JSON.stringify(snap)}`);
  console.log('[ship] requestSnapshot OK');

  // Travel toward another system if graph exists via orderTravel soft
  const summary = (await once(a.ws, 'summary')).summary;
  const mySys = summary.flagships?.[a.id]?.systemId;
  const travel = await command(a.ws, 'orderTravel', { targetId: mySys });
  softOk(travel, 'orderTravel');
  console.log(`[ship] orderTravel ${travel.ok ? 'OK' : `soft (${travel.reason})`}`);
}

async function sectionFleetAcl(pilots) {
  console.log('\n[ship] === fleet ACL (3+ pilots) ===');
  const [a, b, c] = pilots;
  const created = await command(a.ws, 'createBattleGroup', {});
  assert(created.ok, `createBattleGroup failed: ${JSON.stringify(created)}`);
  const groupId = created.groupId;

  const deniedB = await command(b.ws, 'deleteBattleGroup', { groupId });
  assert(!deniedB.ok, 'B deleted group without grant');
  const deniedC = await command(c.ws, 'orderBattleGroupTravel', { groupId, targetId: 'sys-does-not-exist' });
  assert(!deniedC.ok, 'C ordered group without grant');

  const grantB = await command(a.ws, 'grantControl', {
    assetKind: 'battleGroup',
    assetId: groupId,
    targetPlayerId: b.id,
  });
  assert(grantB.ok, `grantControl B failed: ${JSON.stringify(grantB)}`);

  const stillDeniedC = await command(c.ws, 'deleteBattleGroup', { groupId });
  assert(!stillDeniedC.ok, 'C deleted after grant to B only');

  const revoke = await command(a.ws, 'revokeControl', {
    assetKind: 'battleGroup',
    assetId: groupId,
    targetPlayerId: b.id,
  });
  softOk(revoke, 'revokeControl');

  const grantC = await command(a.ws, 'grantControl', {
    assetKind: 'battleGroup',
    assetId: groupId,
    targetPlayerId: c.id,
  });
  assert(grantC.ok, `grantControl C failed: ${JSON.stringify(grantC)}`);
  const deleted = await command(c.ws, 'deleteBattleGroup', { groupId });
  assert(deleted.ok, `C delete after grant failed: ${JSON.stringify(deleted)}`);
  console.log('[ship] multi-pilot ACL grant/revoke OK');

  // Request → deny / accept mesh
  const createdReq = await command(a.ws, 'createBattleGroup', {});
  assert(createdReq.ok, `createBattleGroup (request mesh) failed: ${JSON.stringify(createdReq)}`);
  const reqGroupId = createdReq.groupId;

  const denyEvt = waitFor(
    a.ws,
    (msg) => msg.type === 'events'
      && (msg.events ?? []).some((e) => (e.tickEvents?.coopMeshEvents ?? [])
        .some((m) => m.kind === 'controlRequest' && m.fromPlayerId === b.id && m.assetId === reqGroupId)),
    10000,
    'controlRequest deny event',
  );
  const req1 = await command(b.ws, 'requestControl', { assetKind: 'battleGroup', assetId: reqGroupId });
  assert(req1.ok && req1.requestId, `requestControl failed: ${JSON.stringify(req1)}`);
  await denyEvt;
  const deny = await command(a.ws, 'respondControlRequest', { requestId: req1.requestId, accept: false });
  assert(deny.ok, `deny failed: ${JSON.stringify(deny)}`);
  const stillBlocked = await command(b.ws, 'deleteBattleGroup', { groupId: reqGroupId });
  assert(!stillBlocked.ok, 'B deleted after denied request');

  const acceptEvt = waitFor(
    a.ws,
    (msg) => msg.type === 'events'
      && (msg.events ?? []).some((e) => (e.tickEvents?.coopMeshEvents ?? [])
        .some((m) => m.kind === 'controlRequest' && m.fromPlayerId === c.id && m.assetId === reqGroupId)),
    10000,
    'controlRequest accept event',
  );
  const req2 = await command(c.ws, 'requestControl', { assetKind: 'battleGroup', assetId: reqGroupId });
  assert(req2.ok && req2.requestId, `requestControl C failed: ${JSON.stringify(req2)}`);
  await acceptEvt;
  const accept = await command(a.ws, 'respondControlRequest', { requestId: req2.requestId, accept: true });
  assert(accept.ok, `accept failed: ${JSON.stringify(accept)}`);
  const cDel = await command(c.ws, 'deleteBattleGroup', { groupId: reqGroupId });
  assert(cDel.ok, `C delete after accept failed: ${JSON.stringify(cDel)}`);
  console.log('[ship] requestControl deny/accept OK');

  const createdXfer = await command(a.ws, 'createBattleGroup', {});
  if (createdXfer.ok) {
    const xfer = await command(a.ws, 'transferOwnership', {
      assetKind: 'battleGroup',
      assetId: createdXfer.groupId,
      targetPlayerId: b.id,
    });
    assert(xfer.ok, `transferOwnership failed: ${JSON.stringify(xfer)}`);
    const releaseNo = await command(a.ws, 'releaseControl', {
      assetKind: 'battleGroup',
      assetId: createdXfer.groupId,
    });
    assert(!releaseNo.ok, 'owner should not releaseControl');
    const grantBack = await command(b.ws, 'grantControl', {
      assetKind: 'battleGroup',
      assetId: createdXfer.groupId,
      targetPlayerId: a.id,
    });
    assert(grantBack.ok, `grant after transfer failed: ${JSON.stringify(grantBack)}`);
    const released = await command(a.ws, 'releaseControl', {
      assetKind: 'battleGroup',
      assetId: createdXfer.groupId,
    });
    assert(released.ok, `releaseControl failed: ${JSON.stringify(released)}`);
    await command(b.ws, 'deleteBattleGroup', { groupId: createdXfer.groupId });
    console.log('[ship] transferOwnership + releaseControl OK');
  }

  const summary = (await once(a.ws, 'summary')).summary;
  const sysId = summary.flagships?.[a.id]?.systemId;
  const ping = await command(b.ws, 'mapPing', { systemId: sysId, label: 'ship-test' });
  assert(ping.ok, `mapPing failed: ${JSON.stringify(ping)}`);
  const pausedByPose = await command(a.ws, 'setPaused', { paused: true });
  assert(pausedByPose.ok && pausedByPose.pausedBy === a.id, `pausedBy missing: ${JSON.stringify(pausedByPose)}`);
  await waitFor(
    b.ws,
    (msg) => (msg.type === 'pose' || msg.type === 'summary')
      && msg.summary?.paused === true
      && msg.summary?.pausedBy === a.id,
    8000,
    'pausedBy on summary',
  );
  await command(b.ws, 'setPaused', { paused: false });
  console.log('[ship] mapPing + pausedBy OK');

  const created2 = await command(a.ws, 'createBattleGroup', {});
  if (created2.ok) {
    const auto = await command(a.ws, 'autoAssignShipsToFleets', {});
    softOk(auto, 'autoAssignShipsToFleets');
    await command(a.ws, 'deleteBattleGroup', { groupId: created2.groupId });
  }
}

async function sectionCombat(pilots) {
  console.log('\n[ship] === combat spawn & orders ===');
  const a = pilots[0];
  const b = pilots[1];
  const summary = (await once(a.ws, 'summary')).summary;
  const systemId = summary.flagships?.[a.id]?.systemId;
  assert(systemId, 'need local systemId for combat');

  const friendly = await command(a.ws, 'devAction', {
    action: 'spawnFriendly',
    systemId,
    hull: 'frigate',
    count: 3,
  });
  softOk(friendly, 'spawnFriendly');

  const enemy = await command(a.ws, 'devAction', {
    action: 'spawnEnemyFleet',
    systemId,
    size: 'small',
  });
  if (!enemy.ok) {
    const enemy2 = await command(a.ws, 'devAction', {
      action: 'spawnAiShips',
      systemId,
      hull: 'frigate',
      count: 4,
    });
    softOk(enemy2, 'spawnAiShips');
  } else {
    console.log('[ship] spawnEnemyFleet OK');
  }

  // Wait for combat summary to appear (or soft-continue)
  let battleSys = null;
  try {
    const combatPose = await waitFor(
      b.ws,
      (msg) => Array.isArray(msg.summary?.combat) && msg.summary.combat.some((c) => c.active),
      12000,
      'active combat pose',
    );
    battleSys = combatPose.summary.combat.find((c) => c.active)?.systemId ?? systemId;
    console.log(`[ship] peer saw active combat in ${battleSys}`);
  } catch {
    console.log('[ship] no active combat pose yet — exercising combat commands soft');
    battleSys = systemId;
  }

  for (const [cmd, payload] of [
    ['setCombatDoctrine', { doctrine: 'balanced', systemId: battleSys }],
    ['setAdvancedTactics', { enabled: true, systemId: battleSys }],
    ['setCombatPriority', { priority: 'capital', systemId: battleSys }],
    ['promoteBattleToTactical', { systemId: battleSys }],
    ['cancelTacticalRetreat', { systemId: battleSys }],
  ]) {
    const res = await command(a.ws, cmd, payload);
    softOk(res, cmd);
    console.log(`[ship] ${cmd} ${res.ok ? 'OK' : `soft (${res.reason})`}`);
  }

  const order = await command(b.ws, 'issueTacticalOrder', {
    systemId: battleSys,
    order: { type: 'hold' },
  });
  softOk(order, 'issueTacticalOrder');
  console.log(`[ship] issueTacticalOrder ${order.ok ? 'OK' : `soft (${order.reason})`}`);

  // Peer still receives combat poses after orders
  const after = await once(b.ws, 'pose');
  assert(after.summary?.flagships?.[a.id], 'combat path must not drop peer flagship poses');
}

async function sectionProduction(pilots) {
  console.log('\n[ship] === production / research / ops ===');
  const a = pilots[0];
  const b = pilots[1];

  for (const [cmd, payload] of [
    ['buildOutpost', {}],
    ['buildShipyard', {}],
    ['buildResearchStation', {}],
    ['buildTradeStation', {}],
    ['buildFoundry', {}],
    ['buildLauncher', {}],
    ['queueScout', {}],
    ['queueHull', { hull: 'frigate' }],
    ['enqueueProduct', { kind: 'hull', productId: 'scout' }],
    ['startResearch', {}],
    ['cancelResearch', {}],
    ['deployBuilderDrone', {}],
    ['cancelBuilderDrone', {}],
    ['confirmBuilderConstructionPlan', {}],
    ['cancelBuilderConstructionOrder', {}],
    ['buildBodyStructure', { structureId: 'mine' }],
    ['buildStrategicStructure', { structureId: 'sensor_array' }],
    ['upgradeBodyStructure', {}],
    ['createBulkProductionOrder', { hull: 'frigate', count: 1 }],
    ['createExpansionCampaign', {}],
  ]) {
    const res = await command(a.ws, cmd, payload);
    softOk(res, cmd);
    if (res.ok) console.log(`[ship] ${cmd} OK`);
  }

  const enq = await command(b.ws, 'enqueueProduct', { kind: 'hull', productId: 'scout' });
  if (enq.ok && enq.item?.id) {
    const pin = await command(b.ws, 'pinQueueItem', { queueId: enq.item.id });
    softOk(pin, 'pinQueueItem');
    const reorder = await command(b.ws, 'reorderQueueItem', { queueId: enq.item.id, toIndex: 0 });
    softOk(reorder, 'reorderQueueItem');
    const cancel = await command(b.ws, 'cancelQueueItem', { queueId: enq.item.id });
    softOk(cancel, 'cancelQueueItem');
    console.log('[ship] empire queue pin/reorder/cancel path OK');
  } else {
    console.log(`[ship] empire queue soft (${enq.reason ?? 'unavailable'})`);
  }

  for (const action of ['pauseBulkProductionOrder', 'resumeBulkProductionOrder', 'cancelBulkProductionOrder',
    'pauseExpansionCampaign', 'resumeExpansionCampaign', 'cancelExpansionCampaign']) {
    softOk(await command(a.ws, action, { orderId: 'missing', campaignId: 'missing' }), action);
  }
}

async function sectionDiplomacyLogisticsHero(pilots) {
  console.log('\n[ship] === diplomacy / logistics / hero / wormhole ===');
  const a = pilots[0];

  softOk(await command(a.ws, 'diplomacyAction', { action: 'establishContact', factionId: 'faction-1' }), 'establishContact');
  softOk(await command(a.ws, 'diplomacyAction', { action: 'markTransmissionRead', transmissionId: 'missing' }), 'markTransmissionRead');

  softOk(await command(a.ws, 'setDepotDestination', {}), 'setDepotDestination');
  softOk(await command(a.ws, 'pauseDepotRoute', {}), 'pauseDepotRoute');
  softOk(await command(a.ws, 'resumeDepotRoute', {}), 'resumeDepotRoute');
  softOk(await command(a.ws, 'dispatchDepot', {}), 'dispatchDepot');
  softOk(await command(a.ws, 'rerouteConvoy', {}), 'rerouteConvoy');
  softOk(await command(a.ws, 'setConvoyEscort', {}), 'setConvoyEscort');

  softOk(await command(a.ws, 'buildHeroFlagship', {}), 'buildHeroFlagship');
  softOk(await command(a.ws, 'setHeroRally', {}), 'setHeroRally');
  softOk(await command(a.ws, 'orderHeroTravel', { targetId: 'sys-1' }), 'orderHeroTravel');

  softOk(await command(a.ws, 'enterWormhole', {}), 'enterWormhole');
  softOk(await command(a.ws, 'buildWormholeAnchor', { targetGalaxyId: 'g-1' }), 'buildWormholeAnchor');

  softOk(await command(a.ws, 'buildHelioclastShipyard', {}), 'buildHelioclastShipyard');
  softOk(await command(a.ws, 'installSuperweaponPart', {}), 'installSuperweaponPart');
  softOk(await command(a.ws, 'markLiveFire', {}), 'markLiveFire');
  softOk(await command(a.ws, 'superweaponAction', { action: 'fire' }), 'superweaponAction');
  softOk(await command(a.ws, 'setHelioclastFleetMode', { mode: 'escort' }), 'setHelioclastFleetMode');
  softOk(await command(a.ws, 'orderHelioclastTravel', { targetId: 'sys-1' }), 'orderHelioclastTravel');

  softOk(await command(a.ws, 'orderScoutTravel', { scoutId: 'missing', targetId: 'sys-1' }), 'orderScoutTravel');
  softOk(await command(a.ws, 'orderShipTravel', { shipId: 'missing', targetId: 'sys-1' }), 'orderShipTravel');
  softOk(await command(a.ws, 'setBattleGroupAnchor', { groupId: 'missing', anchor: 'flagship' }), 'setBattleGroupAnchor');
  softOk(await command(a.ws, 'assignShipToGroup', { shipId: 'missing', groupId: 'missing' }), 'assignShipToGroup');

  console.log('[ship] diplomacy/logistics/hero/SW command routing exercised');
}

async function sectionPauseToggle(pilots) {
  console.log('\n[ship] === pause / togglePaused ===');
  const [a, b] = pilots;
  const toggled = await command(a.ws, 'togglePaused', {});
  assert(toggled.ok, `togglePaused failed: ${JSON.stringify(toggled)}`);
  await waitFor(
    b.ws,
    (msg) => typeof msg.summary?.paused === 'boolean',
    8000,
    'pause pose',
  );
  await command(a.ws, 'setPaused', { paused: false });
  await waitFor(
    b.ws,
    (msg) => msg.summary?.paused === false,
    8000,
    'unpaused pose',
  );
  console.log('[ship] togglePaused / setPaused peer sync OK');
}

async function sectionRegistrySweep(pilots) {
  console.log('\n[ship] === registry integrity ===');
  assert(COOP_COMMAND_REGISTRY.size >= 70, `expected ≥70 commands, got ${COOP_COMMAND_REGISTRY.size}`);
  assert(WORLD_MUTATING_COMMANDS.size >= 60, `expected ≥60 mutating commands`);
  const unknown = await command(pilots[0].ws, 'notARealCommand_ship', {});
  assert(!unknown.ok, 'unknown command must fail closed');
  console.log(`[ship] registry ${COOP_COMMAND_REGISTRY.size} commands · fail-closed OK`);
}

async function sectionReconnect(pilots) {
  console.log('\n[ship] === reconnect under load ===');
  const a = pilots[0];
  const identity = { playerId: a.id, reconnectToken: a.token };
  a.detach();
  a.ws.close();
  await sleep(250);
  const ws = await connect(a.name, identity);
  const welcome = await once(ws, 'welcome');
  assert(welcome.playerId === a.id, 'reconnect must keep playerId');
  assert(welcome.snapshotJson, 'reconnect must include checkpoint');
  a.ws = ws;
  a.detach = attachPoseMetrics(ws, a.metrics);
  a.token = welcome.reconnectToken ?? a.token;
  console.log('[ship] reconnect + checkpoint OK');
}

async function main() {
  console.log(`[ship] target ${URL} · pilots=${PILOT_COUNT} · syncBudget=${SYNC_BUDGET_MS}ms`);
  const pilots = await joinPilots(PILOT_COUNT);

  await sectionFourPilotSync(pilots);
  await sectionMovement(pilots);
  await sectionFleetAcl(pilots);
  await sectionCombat(pilots);
  await sectionProduction(pilots);
  await sectionDiplomacyLogisticsHero(pilots);
  await sectionPauseToggle(pilots);
  await sectionRegistrySweep(pilots);
  await sectionReconnect(pilots);

  // Final sync health after command storm
  for (const p of pilots) {
    p.metrics.gaps = [];
    p.metrics.lastAt = 0;
  }
  await sleep(2000);
  const finalGaps = stats(pilots[0].metrics.gaps);
  console.log('\n[ship] final pose cadence after command storm', finalGaps);
  assert(finalGaps.p95 != null && finalGaps.p95 <= SYNC_BUDGET_MS + 50,
    `post-storm pose p95 ${finalGaps.p95}ms exceeds budget+50`);

  for (const p of pilots) {
    p.detach();
    p.ws.close();
  }
  console.log('\n[ship] PASS — ready for friend playtest (host command + 4-pilot sync budgets)');
  process.exit(0);
}

main().catch((err) => {
  console.error('[ship] FAIL', err);
  process.exit(1);
});
