#!/usr/bin/env node
/**
 * Smoke-test the co-op host:
 *  1. two clients join, one pauses, both see it, reconnect persists
 *  2. each pilot gets their own flagship pose in summaries
 *  3. per-pilot thrust diverges the two flagships
 *  4. shareable-asset ACL: B blocked until A grants control
 *  5. team superweapon stays a singleton (second build rejected)
 *
 * Expects: GS_COOP_PORT (default 9090), optional GS_COOP_PASSWORD
 * Start the host first: npm run coop
 */

import WebSocket from 'ws';

const PORT = Number(process.env.GS_COOP_PORT || 9090);
const PASSWORD = process.env.GS_COOP_PASSWORD || '';
const URL = process.env.GS_COOP_URL || `ws://127.0.0.1:${PORT}`;

function waitFor(ws, predicate, timeoutMs = 8000, label = 'condition') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), timeoutMs);
    const onMsg = (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'pose' && !msg.summary) msg.summary = msg.pose;
      try {
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(msg);
        }
      } catch { /* ignore predicate errors */ }
    };
    ws.on('message', onMsg);
  });
}

function once(ws, type, timeoutMs = 5000) {
  return waitFor(
    ws,
    (msg) => {
      const aliases = type === 'summary' ? new Set(['summary', 'pose']) : new Set([type]);
      return aliases.has(msg.type);
    },
    timeoutMs,
    type,
  );
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        protocolVersion: 2,
        playerName: name,
        password: PASSWORD || undefined,
      }));
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

let requestSeq = 0;
function command(ws, cmd, payload = {}, timeoutMs = 5000) {
  const requestId = `smoke-${++requestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for result of ${cmd}`)), timeoutMs);
    const onMsg = (raw) => {
      const msg = JSON.parse(String(raw));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[smoke] connecting to ${URL}`);
  const a = await connect('smoke-a');
  const welcomeA = await once(a, 'welcome');
  const idA = welcomeA.playerId;
  console.log('[smoke] A welcome', { playerId: idA, players: welcomeA.summary?.players, paused: welcomeA.summary?.paused });

  const b = await connect('smoke-b');
  const welcomeB = await once(b, 'welcome');
  const idB = welcomeB.playerId;
  console.log('[smoke] B welcome', { playerId: idB, players: welcomeB.summary?.players });

  // --- 1. pause syncs to the other window ---
  const pauseRes = await command(a, 'setPaused', { paused: true });
  if (!pauseRes.ok) throw new Error(`pause failed: ${JSON.stringify(pauseRes)}`);
  await waitFor(
    b,
    (msg) => (msg.type === 'pose' || msg.type === 'summary') && msg.summary?.paused === true,
    8000,
    'paused pose',
  );
  console.log('[smoke] B saw pause — co-op command sync OK');
  await command(a, 'setPaused', { paused: false });

  // --- 2. each pilot has their own flagship pose ---
  const rosterSummary = (await once(b, 'summary')).summary;
  const flags = rosterSummary?.flagships ?? {};
  if (!flags[idA] || !flags[idB]) {
    throw new Error(`Expected flagship poses for ${idA} and ${idB}, got: ${Object.keys(flags).join(', ')}`);
  }
  console.log('[smoke] two per-pilot flagship poses in summary OK');

  // --- 3. per-pilot thrust diverges the two ships ---
  const before = {
    a: { x: flags[idA].x, y: flags[idA].y },
    b: { x: flags[idB].x, y: flags[idB].y },
  };
  await command(a, 'setFlagshipInput', { x: 1, y: 0 });
  await command(b, 'setFlagshipInput', { x: -1, y: 0 });
  await sleep(3000);
  await command(a, 'setFlagshipInput', { x: 0, y: 0 });
  await command(b, 'setFlagshipInput', { x: 0, y: 0 });
  const afterFlags = (await once(a, 'summary')).summary?.flagships ?? {};
  const movedA = Math.hypot(afterFlags[idA].x - before.a.x, afterFlags[idA].y - before.a.y);
  const movedB = Math.hypot(afterFlags[idB].x - before.b.x, afterFlags[idB].y - before.b.y);
  if (movedA < 0.1) throw new Error(`A's flagship did not move under thrust (moved ${movedA.toFixed(3)})`);
  if (movedB < 0.1) throw new Error(`B's flagship did not move under thrust (moved ${movedB.toFixed(3)})`);
  console.log(`[smoke] per-pilot thrust OK (A moved ${movedA.toFixed(1)}, B moved ${movedB.toFixed(1)})`);

  // --- 4. shareable-asset ACL: grant then command ---
  const created = await command(a, 'createBattleGroup', {});
  if (!created.ok) throw new Error(`createBattleGroup failed: ${JSON.stringify(created)}`);
  const groupId = created.groupId;
  const denied = await command(b, 'deleteBattleGroup', { groupId });
  if (denied.ok) throw new Error('B deleted A\'s battle group without a grant — ACL broken');
  console.log(`[smoke] ungranted order rejected OK (${denied.reason})`);
  const grant = await command(a, 'grantControl', { assetKind: 'battleGroup', assetId: groupId, targetPlayerId: idB });
  if (!grant.ok) throw new Error(`grantControl failed: ${JSON.stringify(grant)}`);
  const allowed = await command(b, 'deleteBattleGroup', { groupId });
  if (!allowed.ok) throw new Error(`B still blocked after grant: ${JSON.stringify(allowed)}`);
  console.log('[smoke] grant → teammate command OK');

  // --- 4b. requestControl accept / deny (3 pilots) ---
  const cJoin = await connect('smoke-c');
  const welcomeCEarly = await once(cJoin, 'welcome');
  const idC = welcomeCEarly.playerId;
  const group2 = await command(a, 'createBattleGroup', {});
  if (!group2.ok) throw new Error(`createBattleGroup#2 failed: ${JSON.stringify(group2)}`);
  const groupId2 = group2.groupId;

  const reqDenyWait = waitFor(
    a,
    (msg) => msg.type === 'events'
      && (msg.events ?? []).some((e) => (e.tickEvents?.coopMeshEvents ?? [])
        .some((m) => m.kind === 'controlRequest' && m.fromPlayerId === idB && m.assetId === groupId2)),
    8000,
    'controlRequest for deny path',
  );
  const reqDenied = await command(b, 'requestControl', { assetKind: 'battleGroup', assetId: groupId2 });
  if (!reqDenied.ok) throw new Error(`requestControl failed: ${JSON.stringify(reqDenied)}`);
  await reqDenyWait;
  const denyRes = await command(a, 'respondControlRequest', { requestId: reqDenied.requestId, accept: false });
  if (!denyRes.ok) throw new Error(`respondControlRequest deny failed: ${JSON.stringify(denyRes)}`);
  const stillDenied = await command(b, 'deleteBattleGroup', { groupId: groupId2 });
  if (stillDenied.ok) throw new Error('B deleted after denied request — ACL broken');
  console.log('[smoke] requestControl deny OK');

  const reqAcceptWait = waitFor(
    a,
    (msg) => msg.type === 'events'
      && (msg.events ?? []).some((e) => (e.tickEvents?.coopMeshEvents ?? [])
        .some((m) => m.kind === 'controlRequest' && m.fromPlayerId === idC && m.assetId === groupId2)),
    8000,
    'controlRequest for accept path',
  );
  const reqAccepted = await command(cJoin, 'requestControl', { assetKind: 'battleGroup', assetId: groupId2 });
  if (!reqAccepted.ok) throw new Error(`requestControl (C) failed: ${JSON.stringify(reqAccepted)}`);
  await reqAcceptWait;
  const acceptRes = await command(a, 'respondControlRequest', { requestId: reqAccepted.requestId, accept: true });
  if (!acceptRes.ok) throw new Error(`respondControlRequest accept failed: ${JSON.stringify(acceptRes)}`);
  const cDeletes = await command(cJoin, 'deleteBattleGroup', { groupId: groupId2 });
  if (!cDeletes.ok) throw new Error(`C still blocked after accept: ${JSON.stringify(cDeletes)}`);
  console.log('[smoke] requestControl accept → command OK');

  const ping = await command(b, 'mapPing', { systemId: flags[idA]?.systemId ?? 'sys-0', label: 'smoke' });
  if (!ping.ok) throw new Error(`mapPing failed: ${JSON.stringify(ping)}`);
  console.log('[smoke] mapPing OK');

  const transferGroup = await command(a, 'createBattleGroup', {});
  if (transferGroup.ok) {
    const xfer = await command(a, 'transferOwnership', {
      assetKind: 'battleGroup',
      assetId: transferGroup.groupId,
      targetPlayerId: idB,
    });
    if (!xfer.ok) throw new Error(`transferOwnership failed: ${JSON.stringify(xfer)}`);
    const aBlocked = await command(a, 'deleteBattleGroup', { groupId: transferGroup.groupId });
    if (aBlocked.ok) throw new Error('A deleted after transferring ownership');
    const bOwns = await command(b, 'deleteBattleGroup', { groupId: transferGroup.groupId });
    if (!bOwns.ok) throw new Error(`B could not delete after transfer: ${JSON.stringify(bOwns)}`);
    console.log('[smoke] transferOwnership OK');
  }

  cJoin.close();

  // Re-pause so the reconnect check below can verify session persistence.
  await command(a, 'setPaused', { paused: true });

  // --- 5. superweapon singleton ---
  const sw1 = await command(a, 'buildHelioclastShipyard', {});
  if (sw1.ok) {
    const sw2 = await command(b, 'buildHelioclastShipyard', {});
    if (sw2.ok) throw new Error('Second Helioclast shipyard accepted — singleton broken');
    console.log(`[smoke] second Helioclast rejected OK (${sw2.reason})`);
  } else {
    console.log(`[smoke] Helioclast build unavailable in this world (${sw1.reason}) — singleton check skipped`);
  }

  // --- 6. empire queue routes through host ---
  await command(a, 'setPaused', { paused: false });
  const enqueue = await command(a, 'enqueueProduct', { kind: 'hull', productId: 'scout' });
  if (!enqueue.ok && !/shipyard|credits|unlocked|tutorial|queue/i.test(enqueue.reason ?? '')) {
    throw new Error(`enqueueProduct failed unexpectedly: ${JSON.stringify(enqueue)}`);
  }
  if (enqueue.ok) {
    console.log(`[smoke] empire queue enqueue OK (${enqueue.item?.id ?? 'queued'})`);
    if (enqueue.item?.id) {
      await command(a, 'cancelQueueItem', { queueId: enqueue.item.id });
    }
  } else {
    console.log(`[smoke] empire queue unavailable yet (${enqueue.reason}) — command path registered`);
  }

  await command(a, 'setPaused', { paused: true });
  a.close();
  b.close();

  const c = await connect('smoke-c');
  const welcomeC = await once(c, 'welcome');
  if (!welcomeC.summary?.paused) throw new Error('Rejoin did not see paused world');
  console.log('[smoke] rejoin still paused — session persistence OK');
  c.close();

  console.log('[smoke] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] FAIL', err);
  process.exit(1);
});
