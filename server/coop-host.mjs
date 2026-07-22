#!/usr/bin/env node
/**
 * Galactic Sovereign — co-op host (Milestone 0)
 *
 * Runs the existing simulation headlessly, persists a shared world to disk,
 * and lets multiple clients join the same empire over WebSocket.
 *
 * Usage:
 *   npm run coop
 *   GS_COOP_PORT=9090 GS_COOP_PASSWORD=secret npm run coop
 *   GS_COOP_SEED=42 npm run coop          # new world seed
 *   GS_COOP_RESET=1 npm run coop          # wipe world and start fresh
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { TICK_MS } from '../src/js/constants.js';
import { createNewGame } from '../src/js/state.js';
import { step } from '../src/js/simulation.js';
import { serialize, deserialize } from '../src/js/save.js';
import { ensurePlayerFlagships, adoptOrSpawnPilotFlagship, setFlagshipInputFor } from '../src/js/flagship.js';
import { constructionJobsSummary } from '../src/js/drones.js';
import {
  findShareableAsset,
  grantControl,
  canControl,
  assetKindLabel,
  SHAREABLE_KINDS,
} from '../src/js/coop-acl.js';
import {
  encode,
  decode,
  welcomeMessage,
  summaryFromState,
} from './protocol.js';
import { PROTOCOL_VERSION, battleLifecycleFingerprint, fleetRosterFingerprint } from '../src/js/coop-protocol.js';
import {
  diffSharedState,
  projectSharedState,
  replicationManifest,
} from '../src/js/coop-replication.js';
import { applyCoopCommand, QUIET_COMMANDS } from './actions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.GS_COOP_DATA_DIR
  ? path.resolve(process.env.GS_COOP_DATA_DIR)
  : path.join(__dirname, 'data');
const WORLD_PATH = path.join(DATA_DIR, 'world.json');
const PORT = Number(process.env.GS_COOP_PORT || 9090);
const HOST = process.env.GS_COOP_HOST || '0.0.0.0';
const PASSWORD = process.env.GS_COOP_PASSWORD || '';
const SEED = Number(process.env.GS_COOP_SEED || Date.now() % 1_000_000_000);
const AUTOSAVE_MS = Number(process.env.GS_COOP_AUTOSAVE_MS || 60_000);
const SUMMARY_EVERY_TICKS = Number(process.env.GS_COOP_SUMMARY_EVERY || 2); // 10 Hz poses
const DELTA_EVERY_TICKS = Number(process.env.GS_COOP_DELTA_EVERY || 5); // 4 Hz shared state
const MAX_BUFFERED_BYTES = Number(process.env.GS_COOP_MAX_BUFFERED_BYTES || 2_000_000);
const REQUEST_CACHE_LIMIT = Number(process.env.GS_COOP_REQUEST_CACHE_LIMIT || 512);
/** Offline parked pilots retained for reconnect; extras are pruned so snapshots stay small. */
const MAX_OFFLINE_FLAGSHIPS = Number(process.env.GS_COOP_MAX_OFFLINE_FLAGSHIPS || 6);
const BACKPRESSURE_LOG_MS = Number(process.env.GS_COOP_BACKPRESSURE_LOG_MS || 5_000);
const MAX_ONLINE_PLAYERS = Number(process.env.GS_COOP_MAX_PLAYERS || 5);
const COMMANDS_PER_SECOND = Number(process.env.GS_COOP_COMMANDS_PER_SECOND || 20);
const COMMAND_BURST = Number(process.env.GS_COOP_COMMAND_BURST || 40);

function readCredential(name, fileName) {
  if (process.env[name]) return process.env[name];
  const credentialsDir = process.env.CREDENTIALS_DIRECTORY;
  if (credentialsDir) {
    try { return fs.readFileSync(path.join(credentialsDir, fileName), 'utf8').trim(); } catch { /* continue */ }
  }
  const explicitPath = process.env[`${name}_FILE`];
  if (explicitPath) return fs.readFileSync(explicitPath, 'utf8').trim();
  return '';
}

const GATEWAY_SECRET = readCredential('GS_GATEWAY_SECRET', 'gateway-secret');


fs.mkdirSync(DATA_DIR, { recursive: true });

/** @type {any} */
let state;
let tickCount = 0;
let lastSavedAt = null;
let dirty = false;
let playerSeq = 0;
let cachedSnapshotJson = null;
let snapshotCacheTick = -1;
let projectedState = null;
let poseRevision = 0;
let deltaRevision = 0;
let eventRevision = 0;
let checkpointRevision = 0;
/** @type {string} */
let lastBattleLifecycleFp = '';
/** @type {string} */
let lastFleetRosterFp = '';

/** @type {Map<import('ws').WebSocket, { id: string, authed: boolean, pendingPose?: string|null }>} */
const clients = new Map();
/** @type {Map<string, { result: any, appliedTick: number }>} */
const requestResults = new Map();
/** @type {Map<string, { requestId: string, assetKind: string, assetId: string, fromPlayerId: string, ownerPlayerId: string, label: string, createdAt: number }>} */
const controlRequests = new Map();
const CONTROL_REQUEST_TTL_MS = 60_000;
const MAP_PING_TTL_MS = 8_000;
let lastPoseBackpressureLogAt = 0;
let lastPauseNoticeAt = 0;
let lastPauseBy = null;

function ensureCoopMetadata() {
  if (!state.coopMeta || typeof state.coopMeta !== 'object') state.coopMeta = {};
  if (!state.coopMeta.worldId) state.coopMeta.worldId = crypto.randomUUID();
  if (!state.coopMeta.identities || typeof state.coopMeta.identities !== 'object') {
    state.coopMeta.identities = {};
  }
  return state.coopMeta;
}

function currentManifest() {
  return replicationManifest({
    worldId: ensureCoopMetadata().worldId,
    tick: tickCount,
    poseRevision,
    deltaRevision,
    eventRevision,
  });
}

function loadOrCreateWorld() {
  if (process.env.GS_COOP_RESET === '1' && fs.existsSync(WORLD_PATH)) {
    fs.unlinkSync(WORLD_PATH);
    console.log(`[coop] reset: removed ${WORLD_PATH}`);
  }

  if (fs.existsSync(WORLD_PATH)) {
    const raw = fs.readFileSync(WORLD_PATH, 'utf8');
    const result = deserialize(raw);
    if (!result.ok) {
      throw new Error(`Failed to load world: ${result.error}`);
    }
    state = result.state;
    ensurePlayerFlagships(state);
    ensureCoopMetadata();
    projectedState = projectSharedState(state);
    lastSavedAt = fs.statSync(WORLD_PATH).mtimeMs;
    console.log(`[coop] loaded world from ${WORLD_PATH} (time=${state.time}, pilots=${state.playerFlagships.length})`);
    return;
  }

  state = createNewGame(SEED);
  ensurePlayerFlagships(state);
  ensureCoopMetadata();
  projectedState = projectSharedState(state);
  state.paused = false;
  saveWorld('create');
  console.log(`[coop] created new world seed=${SEED}`);
}

function saveWorld(reason = 'autosave') {
  const json = serialize(state);
  const tmp = `${WORLD_PATH}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, WORLD_PATH);
  lastSavedAt = Date.now();
  dirty = false;
  console.log(`[coop] saved (${reason}) time=${state.time} credits=${state.credits}`);
}

function onlineCount() {
  let n = 0;
  for (const meta of clients.values()) if (meta.authed) n += 1;
  return n;
}

function playersRoster() {
  const online = new Set();
  for (const meta of clients.values()) if (meta.authed) online.add(meta.id);
  return (state.playerFlagships ?? []).map((f) => ({
    id: f.pilotId,
    callsign: f.callsign ?? f.pilotId,
    online: online.has(f.pilotId),
  }));
}

function onlinePilotIds() {
  const online = new Set();
  for (const meta of clients.values()) if (meta.authed) online.add(meta.id);
  return online;
}

/** Drop excess offline ghost pilots so welcome snapshots / client state stay lean. */
function pruneStaleOfflineFlagships() {
  const roster = Array.isArray(state.playerFlagships) ? state.playerFlagships : [];
  if (roster.length <= MAX_OFFLINE_FLAGSHIPS + onlineCount()) return 0;
  const online = onlinePilotIds();
  const identities = ensureCoopMetadata().identities || {};
  const offline = roster
    .filter((f) => f?.pilotId && !online.has(f.pilotId))
    .sort((a, b) => {
      const aAt = Number(identities[a.pilotId]?.createdAt) || 0;
      const bAt = Number(identities[b.pilotId]?.createdAt) || 0;
      return bAt - aAt; // newest first
    });
  if (offline.length <= MAX_OFFLINE_FLAGSHIPS) return 0;
  const drop = new Set(offline.slice(MAX_OFFLINE_FLAGSHIPS).map((f) => f.pilotId));
  state.playerFlagships = roster.filter((f) => !drop.has(f.pilotId));
  for (const id of drop) delete identities[id];
  if (state.flagship && drop.has(state.flagship.pilotId)) {
    state.flagship = state.playerFlagships[0] ?? state.flagship;
  }
  dirty = true;
  console.log(`[coop] pruned ${drop.size} offline ghost pilots (kept ${MAX_OFFLINE_FLAGSHIPS} offline)`);
  return drop.size;
}

function currentSummary() {
  const summary = summaryFromState(state, {
    playersOnline: onlineCount(),
    players: playersRoster(),
    builds: constructionJobsSummary(state),
    tick: tickCount,
    worldId: ensureCoopMetadata().worldId,
    savedAt: lastSavedAt,
  });
  summary.pausedBy = state.paused ? (state.pausedBy ?? null) : null;
  // Pose channel (~10 Hz): only live pilots. Offline parked ships stay in
  // checkpoints/snapshots — they must not inflate every pose packet.
  const online = onlinePilotIds();
  if (summary.flagships && typeof summary.flagships === 'object') {
    const filtered = {};
    for (const [pilotId, pose] of Object.entries(summary.flagships)) {
      if (online.has(pilotId)) filtered[pilotId] = pose;
    }
    summary.flagships = filtered;
  }
  return summary;
}

function logPoseBackpressureCoalesce(meta, bufferedAmount) {
  const now = Date.now();
  if (now - lastPoseBackpressureLogAt < BACKPRESSURE_LOG_MS) return;
  lastPoseBackpressureLogAt = now;
  console.log(
    `[coop] pose backpressure: coalescing latest pose for ${meta.id} `
    + `(buffered=${bufferedAmount}, limit=${MAX_BUFFERED_BYTES})`,
  );
}

/** Keep the newest pose for a slow client; flush when the socket drains. */
function coalescePendingPose(meta, raw, bufferedAmount) {
  const wasEmpty = meta.pendingPose == null;
  meta.pendingPose = raw;
  if (wasEmpty) logPoseBackpressureCoalesce(meta, bufferedAmount);
}

function coalescePendingReliable(meta, raw) {
  // Keep newest delta/event for a slow socket instead of disconnecting them.
  meta.pendingReliable = raw;
}

function flushPendingPoses() {
  for (const [ws, meta] of clients) {
    if (ws.readyState !== ws.OPEN) {
      meta.pendingPose = null;
      meta.pendingReliable = null;
      continue;
    }
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
    if (meta.pendingReliable != null) {
      ws.send(meta.pendingReliable);
      meta.pendingReliable = null;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
    }
    if (meta.pendingPose != null) {
      ws.send(meta.pendingPose);
      meta.pendingPose = null;
    }
  }
}

function send(ws, msg) {
  if (ws.readyState !== ws.OPEN) return false;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES && msg.type === 'pose') {
    const meta = clients.get(ws);
    if (meta) coalescePendingPose(meta, encode(msg), ws.bufferedAmount);
    return false;
  }
  ws.send(encode(msg));
  if (msg.type === 'pose') {
    const meta = clients.get(ws);
    if (meta) meta.pendingPose = null;
  }
  return true;
}

function broadcast(msg, { requireAuth = true } = {}) {
  const raw = encode(msg);
  for (const [ws, meta] of clients) {
    if (requireAuth && !meta.authed) continue;
    if (ws.readyState !== ws.OPEN) continue;
    // Under pressure: coalesce latest pose / reliable channel. Never kick for
    // a single bloated tick — friends playtests need all seats to stay online.
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      if (msg.type === 'pose') {
        coalescePendingPose(meta, raw, ws.bufferedAmount);
      } else if (msg.type === 'delta' || msg.type === 'events') {
        coalescePendingReliable(meta, raw);
      }
      // checkpoints / other: skip this tick; reconnect path still available
      continue;
    }
    if (msg.type === 'pose') meta.pendingPose = null;
    if (msg.type === 'delta' || msg.type === 'events') meta.pendingReliable = null;
    ws.send(raw);
  }
}

function snapshotJson() {
  // Reuse the serialized world within the same tick so join + debounce
  // don't pay 1MB+ JSON.stringify twice.
  if (cachedSnapshotJson && snapshotCacheTick === tickCount) return cachedSnapshotJson;
  cachedSnapshotJson = serialize(state);
  snapshotCacheTick = tickCount;
  return cachedSnapshotJson;
}

function publishPose(notice = null) {
  poseRevision += 1;
  broadcast({
    type: 'pose',
    worldId: ensureCoopMetadata().worldId,
    tick: tickCount,
    revision: poseRevision,
    pose: currentSummary(),
    ...(notice ? { notice } : {}),
  });
}

function publishDelta({ force = false } = {}) {
  const next = projectSharedState(state);
  const operations = projectedState == null
    ? Object.entries(next).map(([key, value]) => ({ op: 'set', path: [key], value }))
    : diffSharedState(projectedState, next);
  projectedState = next;
  if (!operations.length && !force) return false;
  deltaRevision += 1;
  broadcast({
    type: 'delta',
    worldId: ensureCoopMetadata().worldId,
    tick: tickCount,
    revision: deltaRevision,
    operations,
  });
  return true;
}

function publishEvents(tickEvents) {
  if (!tickEvents || typeof tickEvents !== 'object') return false;
  const payload = {};
  for (const [key, value] of Object.entries(tickEvents)) {
    if (key === 'remainingMs') continue;
    if (Array.isArray(value) && value.length) payload[key] = value;
  }
  if (!Object.keys(payload).length) return false;
  eventRevision += 1;
  broadcast({
    type: 'events',
    worldId: ensureCoopMetadata().worldId,
    tick: tickCount,
    revision: eventRevision,
    events: [{ id: `${tickCount}:${eventRevision}`, tickEvents: payload }],
  });
  return true;
}

function publishMeshEvents(events) {
  if (!Array.isArray(events) || !events.length) return false;
  return publishEvents({ coopMeshEvents: events });
}

function expireControlRequests(now = Date.now()) {
  for (const [id, req] of [...controlRequests.entries()]) {
    if (now - req.createdAt > CONTROL_REQUEST_TTL_MS) controlRequests.delete(id);
  }
}

function handleMeshCommand(command, payload, playerId) {
  expireControlRequests();
  if (command === 'requestControl') {
    const { assetKind, assetId } = payload ?? {};
    if (!SHAREABLE_KINDS.includes(assetKind)) {
      return { ok: false, reason: `Cannot request control of: ${assetKind}` };
    }
    if (!assetId) return { ok: false, reason: 'assetId required' };
    const asset = findShareableAsset(state, assetKind, assetId);
    if (!asset) return { ok: false, reason: 'No such asset' };
    if (!asset.ownerPlayerId) return { ok: false, reason: 'Team asset — every pilot can already command it' };
    if (canControl(playerId, asset)) return { ok: false, reason: 'You already control this asset' };
    if (!onlinePilotIds().has(asset.ownerPlayerId)) {
      return { ok: false, reason: 'Owner is offline — try again when they reconnect' };
    }
    for (const existing of controlRequests.values()) {
      if (
        existing.assetKind === assetKind
        && existing.assetId === assetId
        && existing.fromPlayerId === playerId
      ) {
        return {
          ok: true,
          already: true,
          requestId: existing.requestId,
          expiresInMs: Math.max(0, CONTROL_REQUEST_TTL_MS - (Date.now() - existing.createdAt)),
        };
      }
    }
    const requestId = crypto.randomUUID();
    const label = `${assetKindLabel(assetKind)} ${assetId}`;
    const req = {
      requestId,
      assetKind,
      assetId,
      fromPlayerId: playerId,
      ownerPlayerId: asset.ownerPlayerId,
      label,
      createdAt: Date.now(),
    };
    controlRequests.set(requestId, req);
    publishMeshEvents([{
      kind: 'controlRequest',
      ...req,
      fromCallsign: playersRoster().find((p) => p.id === playerId)?.callsign ?? playerId,
    }]);
    return { ok: true, requestId, expiresInMs: CONTROL_REQUEST_TTL_MS };
  }

  if (command === 'respondControlRequest') {
    const { requestId, accept } = payload ?? {};
    if (!requestId) return { ok: false, reason: 'requestId required' };
    const req = controlRequests.get(String(requestId));
    if (!req) return { ok: false, reason: 'No such control request (expired or unknown)' };
    if (req.ownerPlayerId !== playerId) {
      return { ok: false, reason: 'Only the asset owner can respond to this request' };
    }
    controlRequests.delete(String(requestId));
    let grantResult = null;
    if (accept) {
      const asset = findShareableAsset(state, req.assetKind, req.assetId);
      if (!asset) return { ok: false, reason: 'Asset no longer exists' };
      grantResult = grantControl(asset, req.fromPlayerId);
      if (!grantResult.ok) return grantResult;
      dirty = true;
    }
    publishMeshEvents([{
      kind: 'controlRequestResolved',
      requestId: req.requestId,
      accept: !!accept,
      assetKind: req.assetKind,
      assetId: req.assetId,
      fromPlayerId: req.fromPlayerId,
      ownerPlayerId: req.ownerPlayerId,
      label: req.label,
    }]);
    return {
      ok: true,
      accept: !!accept,
      requestId: req.requestId,
      grantedControllers: grantResult?.grantedControllers ?? null,
    };
  }

  if (command === 'mapPing') {
    const galaxyId = payload?.galaxyId ?? state.activeGalaxyId ?? null;
    const systemId = payload?.systemId ?? null;
    if (!systemId && !(Number.isFinite(payload?.x) && Number.isFinite(payload?.y))) {
      return { ok: false, reason: 'systemId or x/y required' };
    }
    const ping = {
      kind: 'mapPing',
      fromPlayerId: playerId,
      fromCallsign: playersRoster().find((p) => p.id === playerId)?.callsign ?? playerId,
      galaxyId,
      systemId,
      x: Number.isFinite(payload?.x) ? payload.x : null,
      y: Number.isFinite(payload?.y) ? payload.y : null,
      label: String(payload?.label ?? '').slice(0, 48) || null,
      expiresAt: Date.now() + MAP_PING_TTL_MS,
    };
    publishMeshEvents([ping]);
    return { ok: true, expiresAt: ping.expiresAt };
  }

  return null;
}

function sendCheckpoint(ws, reason = 'resync') {
  checkpointRevision += 1;
  send(ws, {
    type: 'checkpoint',
    worldId: ensureCoopMetadata().worldId,
    tick: tickCount,
    revision: checkpointRevision,
    manifest: currentManifest(),
    snapshotJson: snapshotJson(),
    pose: currentSummary(),
    reason,
  });
}

function applyCommand(type, payload = {}, playerId = null) {
  const result = applyCoopCommand(state, type, payload, { playerId });
  if (result?.ok && type !== 'requestSnapshot') dirty = true;
  return result;
}

function sanitizePlayerName(value) {
  const cleaned = String(value ?? 'pilot').trim().slice(0, 32);
  return cleaned || 'pilot';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function trustedIdentityFromRequest(req) {
  if (!GATEWAY_SECRET || !safeEqual(req.headers['x-gs-gateway-secret'], GATEWAY_SECRET)) return null;
  let id = '';
  try { id = decodeURIComponent(String(req.headers['x-gs-user-id'] ?? '')).slice(0, 80); } catch { return null; }
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) return null;
  const accountId = String(req.headers['x-gs-account-id'] ?? id).slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  let displayName = 'pilot';
  try { displayName = decodeURIComponent(String(req.headers['x-gs-display-name'] ?? 'pilot')); } catch { /* use fallback */ }
  return { id, accountId, displayName: sanitizePlayerName(displayName) };
}

function resolveIdentity(msg, trustedIdentity = null) {
  const coopMeta = ensureCoopMetadata();
  if (trustedIdentity) {
    const known = coopMeta.identities[trustedIdentity.id] ?? {};
    coopMeta.identities[trustedIdentity.id] = {
      displayName: trustedIdentity.displayName,
      accountId: trustedIdentity.accountId,
      createdAt: Number(known.createdAt) || Date.now(),
    };
    dirty = true;
    return { id: trustedIdentity.id, displayName: trustedIdentity.displayName, reconnectToken: null };
  }
  const token = String(msg.reconnectToken ?? '').slice(0, 128);
  const requestedId = msg.playerId ? String(msg.playerId).slice(0, 64) : null;
  const displayName = sanitizePlayerName(msg.playerName);

  if (requestedId) {
    const known = coopMeta.identities[requestedId];
    if (known && token && known.reconnectToken === token) {
      known.displayName = displayName;
      return { id: requestedId, displayName, reconnectToken: token };
    }
  }

  // First connection for an existing callsign keeps the human-readable id.
  let id = displayName;
  if (coopMeta.identities[id]) {
    do {
      id = `${displayName}-${++playerSeq}`;
    } while (coopMeta.identities[id]);
  }
  const reconnectToken = token || crypto.randomUUID();
  coopMeta.identities[id] = { displayName, reconnectToken, createdAt: Date.now() };
  dirty = true;
  return { id, displayName, reconnectToken };
}

function handleMessage(ws, raw) {
  const meta = clients.get(ws);
  if (!meta) return;

  let msg;
  try {
    msg = decode(raw);
  } catch {
    send(ws, { type: 'error', error: 'Invalid JSON message' });
    return;
  }

  if (msg.type === 'ping') {
    send(ws, { type: 'pong', t: msg.t ?? Date.now() });
    return;
  }

  if (msg.type === 'hello') {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      send(ws, {
        type: 'error',
        code: 'protocol_mismatch',
        error: `Protocol mismatch: host requires ${PROTOCOL_VERSION}, client sent ${msg.protocolVersion ?? 'none'}`,
        protocolVersion: PROTOCOL_VERSION,
      });
      ws.close(4002, 'protocol mismatch');
      return;
    }
    if (!meta.trustedIdentity && PASSWORD && msg.password !== PASSWORD) {
      send(ws, { type: 'error', error: 'Invalid password' });
      ws.close(4001, 'Invalid password');
      return;
    }
    const identity = resolveIdentity(msg, meta.trustedIdentity);
    const replacesExisting = [...clients.values()].some((candidate) => candidate !== meta && candidate.authed && candidate.id === identity.id);
    if (!replacesExisting && onlineCount() >= MAX_ONLINE_PLAYERS) {
      send(ws, { type: 'error', code: 'server_full', error: `Server is limited to ${MAX_ONLINE_PLAYERS} players` });
      ws.close(4004, 'server full');
      return;
    }
    meta.authed = true;
    meta.id = identity.id;
    meta.displayName = identity.displayName;
    meta.reconnectToken = identity.reconnectToken;
    // Replace stale sockets from the same callsign (refreshes / leftover tabs).
    for (const [otherWs, otherMeta] of [...clients.entries()]) {
      if (otherWs === ws || !otherMeta.authed) continue;
      if (otherMeta.id === meta.id) {
        try { otherWs.close(4000, 'replaced by new session'); } catch { /* ignore */ }
        clients.delete(otherWs);
        console.log(`[coop] replaced stale session for ${meta.id}`);
      }
    }
    // Personal capital: bind (or spawn) this pilot's own flagship before the
    // welcome snapshot so every client sees the full roster immediately.
    const pilotShip = adoptOrSpawnPilotFlagship(state, meta.id, meta.id);
    if (pilotShip.spawned || pilotShip.adopted) {
      dirty = true;
      snapshotCacheTick = -1;
      console.log(`[coop] ${pilotShip.spawned ? 'spawned' : 'adopted'} flagship for ${meta.id}`);
    }
    pruneStaleOfflineFlagships();
    snapshotCacheTick = -1;
    send(ws, welcomeMessage({
      playerId: meta.id,
      displayName: meta.displayName,
      reconnectToken: meta.reconnectToken,
      passwordRequired: !!PASSWORD,
      summary: currentSummary(),
      snapshotJson: snapshotJson(),
      worldId: ensureCoopMetadata().worldId,
      tick: tickCount,
      manifest: currentManifest(),
    }));
    publishDelta();
    publishPose(`${meta.displayName} joined the co-op session`);
    console.log(`[coop] ${meta.id} joined (${onlineCount()} online)`);
    return;
  }

  if (!meta.authed) {
    send(ws, { type: 'error', error: 'Send hello first' });
    return;
  }

  if (msg.type === 'command') {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, now - meta.commandRefillAt) / 1000;
    meta.commandTokens = Math.min(COMMAND_BURST, meta.commandTokens + elapsedSeconds * COMMANDS_PER_SECOND);
    meta.commandRefillAt = now;
    if (meta.commandTokens < 1) {
      send(ws, { type: 'commandResult', requestId: msg.requestId ?? null, result: { ok: false, reason: 'Command rate limit exceeded' } });
      return;
    }
    meta.commandTokens -= 1;
    const requestId = String(msg.requestId ?? '');
    if (!requestId) {
      send(ws, { type: 'commandResult', requestId: null, result: { ok: false, reason: 'requestId required' } });
      return;
    }
    const requestKey = `${meta.id}:${requestId}`;
    const cached = requestResults.get(requestKey);
    if (cached) {
      send(ws, {
        type: 'commandResult',
        command: msg.command,
        requestId,
        appliedTick: cached.appliedTick,
        result: cached.result,
        replayed: true,
      });
      return;
    }

    const result = (() => {
      if (msg.command === 'requestControl' || msg.command === 'respondControlRequest' || msg.command === 'mapPing') {
        return handleMeshCommand(msg.command, msg.payload ?? {}, meta.id);
      }
      return applyCommand(msg.command, msg.payload ?? {}, meta.id);
    })();
    const appliedTick = tickCount;
    requestResults.set(requestKey, { result, appliedTick });
    while (requestResults.size > REQUEST_CACHE_LIMIT) {
      requestResults.delete(requestResults.keys().next().value);
    }
    send(ws, {
      type: 'commandResult',
      command: msg.command,
      requestId,
      worldId: ensureCoopMetadata().worldId,
      appliedTick,
      result,
    });

    if (msg.command === 'requestSnapshot' || result.snapshot) {
      sendCheckpoint(ws, 'requested');
      return;
    }

    if (result.ok && !QUIET_COMMANDS.has(msg.command)) {
      let notice = null;
      if (msg.command === 'grantControl') {
        notice = `${meta.id} granted control of ${msg.payload?.assetId} to ${msg.payload?.targetPlayerId}`;
      } else if (msg.command === 'revokeControl') {
        notice = `${meta.id} revoked control of ${msg.payload?.assetId} from ${msg.payload?.targetPlayerId}`;
      } else if (msg.command === 'transferOwnership') {
        notice = `${meta.id} transferred ${msg.payload?.assetId} to ${msg.payload?.targetPlayerId}`;
      } else if (msg.command === 'releaseControl') {
        notice = `${meta.id} released control of ${msg.payload?.assetId}`;
      } else if (msg.command === 'togglePaused' || msg.command === 'setPaused') {
        if (result.paused) {
          const now = Date.now();
          if (lastPauseBy && lastPauseBy !== meta.id && now - lastPauseNoticeAt < 2000) {
            notice = `${meta.id} paused (was just paused by ${lastPauseBy})`;
          } else {
            notice = `${meta.id} paused the empire`;
          }
          lastPauseBy = meta.id;
          lastPauseNoticeAt = now;
        } else {
          notice = `${meta.id} resumed the empire`;
          lastPauseBy = null;
        }
      }
      // Mesh request/ping already published events; still push pose for pause/grants.
      if (msg.command !== 'requestControl' && msg.command !== 'mapPing') {
        if (msg.command !== 'respondControlRequest' || result.accept) {
          publishDelta();
        }
        publishPose(notice);
      } else if (notice) {
        publishPose(notice);
      }
    }
    return;
  }

  send(ws, { type: 'error', error: `Unknown message type: ${msg.type}` });
}

function startTickLoop() {
  let last = Date.now();
  lastBattleLifecycleFp = battleLifecycleFingerprint(state);
  lastFleetRosterFp = fleetRosterFingerprint(state);
  setInterval(() => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    const events = step(state, dt);
    tickCount += 1;

    if ((events?.droneCompletions?.length ?? 0) > 0) {
      dirty = true;
      publishDelta();
    }

    const battleFp = battleLifecycleFingerprint(state);
    if (battleFp !== lastBattleLifecycleFp) {
      lastBattleLifecycleFp = battleFp;
      dirty = true;
      publishPose();
    }

    // Fleet spawn / despawn / transit — push a summary immediately so both
    // screens see ships without waiting for the next periodic tick or a
    // full 1MB snapshot (those were stomping the peer's view).
    const fleetFp = fleetRosterFingerprint(state);
    if (fleetFp !== lastFleetRosterFp) {
      lastFleetRosterFp = fleetFp;
      dirty = true;
      publishPose();
    }

    if (tickCount % SUMMARY_EVERY_TICKS === 0) {
      publishPose();
    }
    if (tickCount % DELTA_EVERY_TICKS === 0) {
      publishDelta();
    }
    publishEvents(events);
    // Drain coalesced poses once sockets have room again.
    flushPendingPoses();
  }, TICK_MS);
}

function startAutosave() {
  // Always persist on the interval so reconnects match the live world
  // even if a code path forgot to set dirty.
  setInterval(() => saveWorld('autosave'), AUTOSAVE_MS);
}

function healthPayload() {
  return {
    ok: true,
    mode: 'coop',
    protocolVersion: PROTOCOL_VERSION,
    worldId: ensureCoopMetadata().worldId,
    tick: tickCount,
    revisions: currentManifest(),
    playersOnline: onlineCount(),
    lastSavedAt,
    passwordRequired: !!PASSWORD,
  };
}

loadOrCreateWorld();

const server = http.createServer((req, res) => {
  // Allow the static game (:8080) and other origins to probe health.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(healthPayload(), null, 2));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const trustedIdentity = trustedIdentityFromRequest(req);
  if (GATEWAY_SECRET && !trustedIdentity) {
    ws.close(4003, 'gateway authentication required');
    return;
  }
  clients.set(ws, {
    id: 'connecting',
    authed: false,
    trustedIdentity,
    commandTokens: COMMAND_BURST,
    commandRefillAt: Date.now(),
  });
  ws.on('message', (data) => handleMessage(ws, data.toString()));
  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta) {
      meta.pendingPose = null;
      meta.pendingReliable = null;
    }
    clients.delete(ws);
    if (meta?.authed) {
      // Kill the departed pilot's thrust so their ship coasts to a stop.
      setFlagshipInputFor(meta.id, 0, 0);
      pruneStaleOfflineFlagships();
      publishPose(`${meta.displayName ?? meta.id} left the co-op session`);
      console.log(`[coop] ${meta.id} left (${onlineCount()} online)`);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[coop] listening on http://${HOST}:${PORT}`);
  console.log(`[coop] websocket ws://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  console.log(`[coop] password ${PASSWORD ? 'ENABLED' : GATEWAY_SECRET ? 'disabled (gateway identity only)' : 'disabled (open development session)'}`);
  console.log(`[coop] gateway authentication ${GATEWAY_SECRET ? 'REQUIRED' : 'disabled (development mode)'}`);
  console.log(`[coop] world ${WORLD_PATH}`);
  console.log(`[coop] pose every ${SUMMARY_EVERY_TICKS} ticks · delta every ${DELTA_EVERY_TICKS} ticks`);
  startTickLoop();
  startAutosave();
});

function shutdown(signal) {
  console.log(`[coop] ${signal} — saving and exiting`);
  try { saveWorld('shutdown'); } catch (err) {
    console.error('[coop] save on shutdown failed', err);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
