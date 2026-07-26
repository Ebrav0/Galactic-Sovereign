#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

import { AuthStore } from '../server/auth-store.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mode = process.env.GS_MOVEMENT_MODE === 'verify' ? 'verify' : 'record';
const durationScale = Math.max(0.25, Math.min(4, Number(process.env.GS_MOVEMENT_DURATION_SCALE || 1)));
const runLabel = String(process.env.GS_MOVEMENT_RUN || `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  .replace(/[^a-zA-Z0-9._-]/g, '-')
  .slice(0, 80);
const outputDir = path.resolve(
  process.env.GS_MOVEMENT_OUTPUT_DIR
    || path.join(repoRoot, 'output', 'playwright', 'multiplayer-stutter-20260722', runLabel),
);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-coop-movement-'));
const accountDir = path.join(temporaryRoot, 'accounts');
const worldDir = path.join(temporaryRoot, 'world');
const password = `${crypto.randomBytes(24).toString('base64url')}!aA7`;
const gatewaySecret = crypto.randomBytes(32).toString('base64url');
const sessionPepper = crypto.randomBytes(32).toString('base64url');
const children = [];
const childLogs = new Map();
const accounts = [];
let browser = null;
let runResult = null;
let runError = null;

fs.mkdirSync(outputDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms * durationScale))));
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))];
}

function summaryStats(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { samples: 0, mean: null, p50: null, p95: null, p99: null, max: null };
  return {
    samples: finite.length,
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    p99: percentile(finite, 0.99),
    max: Math.max(...finite),
  };
}

function shortestAngle(a, b) {
  let delta = Number(a || 0) - Number(b || 0);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function startProcess(label, args, env) {
  const lines = [];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  childLogs.set(label, lines);
  const capture = (stream, chunk) => {
    const text = String(chunk);
    lines.push(`[${stream}] ${text}`);
    process.stdout.write(`[${label}] ${text}`);
  };
  child.stdout.on('data', (chunk) => capture('stdout', chunk));
  child.stderr.on('data', (chunk) => capture('stderr', chunk));
  return child;
}

async function waitForHealth(url, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch { /* service is starting */ }
    await sleep(100);
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

function decodeWsPayload(payloadData) {
  try {
    return JSON.parse(String(payloadData));
  } catch {
    return null;
  }
}

async function setNetwork(client, { latency = 0, downloadMbps = 50, uploadMbps = 20, packetLoss = 0 } = {}) {
  const params = {
    offline: false,
    latency,
    downloadThroughput: (downloadMbps * 1024 * 1024) / 8,
    uploadThroughput: (uploadMbps * 1024 * 1024) / 8,
    connectionType: 'cellular4g',
    packetLoss,
    packetQueueLength: 100,
    packetReordering: packetLoss > 0,
  };
  try {
    await client.cdp.send('Network.emulateNetworkConditions', params);
    client.networkImpairment = { ...params, applied: true };
  } catch (error) {
    const fallback = { ...params };
    delete fallback.packetLoss;
    delete fallback.packetQueueLength;
    delete fallback.packetReordering;
    await client.cdp.send('Network.emulateNetworkConditions', fallback);
    client.networkImpairment = { ...fallback, packetLossRequested: packetLoss, applied: true, fallback: String(error.message || error) };
  }
}

async function startRafProbe(page, label = 'warmup') {
  await page.evaluate((initialLabel) => {
    if (window.__gsMovementProbe?.running) return;
    const probe = {
      running: true,
      label: initialLabel,
      samples: [],
      markers: [{ label: initialLabel, at: performance.now() }],
    };
    window.__gsMovementProbe = probe;
    const tick = (now) => {
      if (!probe.running) return;
      const state = window.getGameState?.();
      const status = window.__coopStatus?.();
      const roster = Array.isArray(state?.playerFlagships) ? state.playerFlagships : [];
      probe.samples.push({
        at: now,
        label: probe.label,
        stateTime: Number(state?.time),
        playerId: status?.playerId ?? null,
        active: status?.active === true,
        flagships: roster.map((entry) => ({
          id: entry.pilotId,
          x: Number(entry.x),
          y: Number(entry.y),
          vx: Number(entry.vx),
          vy: Number(entry.vy),
          heading: Number(entry.heading),
          systemId: entry.systemId ?? null,
        })),
      });
      if (probe.samples.length > 12_000) probe.samples.splice(0, probe.samples.length - 12_000);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, label);
}

async function mark(client, label) {
  client.markers[label] = performance.now();
  await client.page.evaluate((next) => {
    const probe = window.__gsMovementProbe;
    if (!probe) return;
    probe.label = next;
    probe.markers.push({ label: next, at: performance.now() });
  }, label);
}

async function finishProbe(client) {
  const data = await client.page.evaluate(() => {
    const probe = window.__gsMovementProbe;
    if (!probe) return { samples: [], markers: [] };
    probe.running = false;
    return { samples: probe.samples, markers: probe.markers };
  });
  client.probeSegments.push(data);
  return data;
}

async function openAuthenticatedClient({ account, index, baseUrl }) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const client = {
    index,
    account: { id: account.id, username: account.username, displayName: account.displayName },
    context,
    page,
    cdp,
    received: [],
    sent: [],
    errors: [],
    markers: {},
    probeSegments: [],
    identity: null,
    networkImpairment: null,
  };
  page.on('console', (message) => {
    if (message.type() === 'error') client.errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => client.errors.push(`page: ${error.message}`));
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    const message = decodeWsPayload(response?.payloadData);
    if (!message || !['welcome', 'pose', 'delta', 'events', 'checkpoint'].includes(message.type)) return;
    const pose = message.pose ?? message.summary ?? null;
    client.received.push({
      at: performance.now(),
      type: message.type,
      bytes: Buffer.byteLength(String(response.payloadData || '')),
      tick: Number(message.tick) || 0,
      revision: Number(message.revision) || 0,
      hostTime: Number(pose?.time),
      flagships: pose?.flagships ?? null,
    });
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    const message = decodeWsPayload(response?.payloadData);
    if (message?.type !== 'command') return;
    client.sent.push({
      at: performance.now(),
      command: message.command,
      payload: message.payload ?? {},
      requestId: message.requestId ?? null,
    });
  });

  await setNetwork(client, { latency: 0, packetLoss: 0 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('#account-gate:not(.hidden)').waitFor({ timeout: 30_000 });
  await page.locator('#account-username').fill(account.username);
  await page.locator('#account-password').fill(password);
  await page.locator('#account-login-form button[type=submit]').click();
  await page.locator('#account-chip:not(.hidden)').waitFor({ timeout: 30_000 });
  await page.locator('#title-multiplayer-door').click();
  await page.locator('#title-mp-server-card').click();
  await page.locator('#title-mp-join-btn').click();
  await page.waitForFunction(() => window.__coopStatus?.().active === true, null, { timeout: 45_000 });
  await page.evaluate(() => window.__setCoopIntroElapsed?.(7_000));
  await page.waitForFunction(() => {
    try { return JSON.parse(window.render_game_to_text?.() || '{}').bootPhase === 'playing'; } catch { return false; }
  }, null, { timeout: 15_000 });
  await page.locator('#game-canvas').click({ force: true });
  client.identity = await page.evaluate(() => window.__coopStatus().playerId);
  assert(client.identity === account.id, `Authenticated identity mismatch for ${account.username}`);
  await startRafProbe(page);
  return client;
}

async function releaseAll(client) {
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    await client.page.keyboard.up(key).catch(() => {});
  }
}

function analyzeHostTiming(frames, startAt, endAt) {
  const poses = frames.filter((entry) => entry.type === 'pose'
    && entry.at >= startAt && entry.at <= endAt && Number.isFinite(entry.hostTime));
  const arrivalGaps = [];
  const hostDeltas = [];
  const motionDeltas = [];
  for (let i = 1; i < poses.length; i += 1) {
    arrivalGaps.push(poses[i].at - poses[i - 1].at);
    hostDeltas.push(poses[i].hostTime - poses[i - 1].hostTime);
    const before = poses[i - 1].flagships ?? {};
    const after = poses[i].flagships ?? {};
    let distance = 0;
    for (const [id, pose] of Object.entries(after)) {
      const prev = before[id];
      if (!prev || !Number.isFinite(pose?.x) || !Number.isFinite(prev?.x)) continue;
      distance += Math.hypot(pose.x - prev.x, pose.y - prev.y);
    }
    motionDeltas.push(distance);
  }
  const wallElapsedMs = poses.length > 1 ? poses.at(-1).at - poses[0].at : 0;
  const simulatedElapsedMs = poses.length > 1 ? poses.at(-1).hostTime - poses[0].hostTime : 0;
  return {
    poses: poses.length,
    wallElapsedMs,
    simulatedElapsedMs,
    driftMs: wallElapsedMs - simulatedElapsedMs,
    simulatedToWallRatio: wallElapsedMs > 0 ? simulatedElapsedMs / wallElapsedMs : null,
    arrivalGapsMs: summaryStats(arrivalGaps),
    hostDeltasMs: summaryStats(hostDeltas),
    duplicateHostTimes: hostDeltas.filter((value) => value === 0).length,
    subNominalHostDeltas: hostDeltas.filter((value) => value > 0 && value < 100).length,
    duplicateMovingPoses: motionDeltas.filter((distance, index) => distance < 0.001 && hostDeltas[index] === 0).length,
    posePayloadBytes: summaryStats(poses.map((entry) => entry.bytes)),
  };
}

function analyzeSamples(samples, playerId) {
  const byLabel = {};
  for (let i = 1; i < samples.length; i += 1) {
    const before = samples[i - 1];
    const after = samples[i];
    if (before.label !== after.label) continue;
    const prev = before.flagships.find((entry) => entry.id === playerId);
    const next = after.flagships.find((entry) => entry.id === playerId);
    if (!prev || !next) continue;
    const dtMs = after.at - before.at;
    if (!(dtMs > 0)) continue;
    const dt = dtMs / 1000;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const expectedDx = prev.vx * dt;
    const expectedDy = prev.vy * dt;
    const displacement = Math.hypot(dx, dy);
    const speed = Math.hypot(prev.vx, prev.vy);
    const residual = Math.hypot(dx - expectedDx, dy - expectedDy);
    const bucket = byLabel[before.label] ??= { frameGaps: [], residuals: [], backwards: 0, movingFrames: 0, frozenMovingFrames: 0 };
    bucket.frameGaps.push(dtMs);
    bucket.residuals.push(residual);
    if (speed > 20) {
      bucket.movingFrames += 1;
      if (displacement < speed * dt * 0.2) bucket.frozenMovingFrames += 1;
      if ((dx * prev.vx + dy * prev.vy) < -0.25) bucket.backwards += 1;
    }
  }
  return Object.fromEntries(Object.entries(byLabel).map(([label, bucket]) => [label, {
    frameGapsMs: summaryStats(bucket.frameGaps),
    motionResidualUnits: summaryStats(bucket.residuals),
    longFramesOver50Ms: bucket.frameGaps.filter((value) => value > 50).length,
    longFramesOver100Ms: bucket.frameGaps.filter((value) => value > 100).length,
    backwardsFrames: bucket.backwards,
    movingFrames: bucket.movingFrames,
    frozenMovingFrames: bucket.frozenMovingFrames,
  }]));
}

function finalDivergence(observations) {
  const ids = new Set(observations.flatMap((entry) => entry.flagships.map((flagship) => flagship.id)));
  let maxPosition = 0;
  let maxVelocity = 0;
  let maxHeading = 0;
  const perPilot = {};
  for (const id of ids) {
    const poses = observations.map((entry) => entry.flagships.find((flagship) => flagship.id === id)).filter(Boolean);
    let pos = 0;
    let vel = 0;
    let heading = 0;
    for (let i = 0; i < poses.length; i += 1) {
      for (let j = i + 1; j < poses.length; j += 1) {
        pos = Math.max(pos, Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y));
        vel = Math.max(vel, Math.hypot(poses[i].vx - poses[j].vx, poses[i].vy - poses[j].vy));
        heading = Math.max(heading, shortestAngle(poses[i].heading, poses[j].heading));
      }
    }
    perPilot[id] = { observers: poses.length, maxPositionUnits: pos, maxVelocityUnitsPerSec: vel, maxHeadingRadians: heading };
    maxPosition = Math.max(maxPosition, pos);
    maxVelocity = Math.max(maxVelocity, vel);
    maxHeading = Math.max(maxHeading, heading);
  }
  return { maxPositionUnits: maxPosition, maxVelocityUnitsPerSec: maxVelocity, maxHeadingRadians: maxHeading, perPilot };
}

async function captureObservation(client) {
  return client.page.evaluate(() => {
    const state = window.getGameState();
    return {
      playerId: window.__coopStatus().playerId,
      stateTime: state.time,
      flagships: (state.playerFlagships ?? []).map((entry) => ({
        id: entry.pilotId,
        x: Number(entry.x), y: Number(entry.y),
        vx: Number(entry.vx), vy: Number(entry.vy),
        heading: Number(entry.heading), systemId: entry.systemId ?? null,
      })),
    };
  });
}

async function main() {
  const appPort = Number(process.env.GS_MOVEMENT_APP_PORT) || await freePort();
  let coopPort = Number(process.env.GS_MOVEMENT_COOP_PORT) || await freePort();
  while (coopPort === appPort) coopPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const accountStore = new AuthStore({ dataDir: accountDir, sessionPepper });
  try {
    assert(accountStore.listUsers().length === 0, 'Fresh account database was not empty');
    for (let index = 1; index <= 3; index += 1) {
      const suffix = crypto.randomBytes(4).toString('hex');
      const user = await accountStore.createUser({
        username: `movement-${index}-${suffix}`,
        displayName: `Movement Pilot ${index}`,
        password,
        role: 'player',
        mustChangePassword: false,
      });
      accounts.push({ id: user.id, username: user.username, displayName: user.displayName, created: true, deleted: false });
    }
  } finally {
    accountStore.close();
  }

  startProcess('coop', ['server/coop-host.mjs'], {
    NODE_ENV: 'production',
    GS_COOP_HOST: '127.0.0.1',
    GS_COOP_PORT: String(coopPort),
    GS_COOP_DATA_DIR: worldDir,
    GS_COOP_AUTOSAVE_MS: '300000',
    GS_COOP_MAX_PLAYERS: '5',
    GS_GATEWAY_SECRET: gatewaySecret,
  });
  startProcess('gateway', ['server/app-host.mjs'], {
    NODE_ENV: 'production',
    GS_APP_HOST: '127.0.0.1',
    GS_APP_PORT: String(appPort),
    GS_PUBLIC_ORIGIN: baseUrl,
    GS_COOKIE_SECURE: '0',
    GS_SESSION_PEPPER: sessionPepper,
    GS_DATA_DIR: accountDir,
    GS_DIST_DIR: path.join(repoRoot, 'dist'),
    GS_COOP_INTERNAL_URL: `ws://127.0.0.1:${coopPort}`,
    GS_GATEWAY_SECRET: gatewaySecret,
  });
  const health = await waitForHealth(`${baseUrl}/healthz`, 'Authenticated gateway');
  assert(health.ok, 'Gateway health was not healthy');

  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const clients = [];
  clients.push(await openAuthenticatedClient({ account: accounts[0], index: 1, baseUrl }));
  clients.push(await openAuthenticatedClient({ account: accounts[1], index: 2, baseUrl }));
  assert(new Set(clients.map((client) => client.identity)).size === 2, 'Initial authenticated identities were not unique');

  await Promise.all(clients.map((client) => mark(client, 'active-join-sustained')));
  await clients[0].page.keyboard.down('KeyD');
  await clients[1].page.keyboard.down('KeyA');
  await sleep(2_000);

  clients.push(await openAuthenticatedClient({ account: accounts[2], index: 3, baseUrl }));
  assert(new Set(clients.map((client) => client.identity)).size === 3, 'Three unique authenticated identities were not present');
  await mark(clients[2], 'active-join-sustained');
  await clients[2].page.keyboard.down('KeyW');
  const hostAnalysisStart = performance.now();
  await sleep(6_000);

  await Promise.all(clients.map(releaseAll));
  await Promise.all(clients.map((client) => mark(client, 'deceleration')));
  await sleep(2_500);

  const rapidStart = performance.now();
  await Promise.all(clients.map((client) => mark(client, 'rapid-diagonal')));
  await Promise.all([
    clients[0].page.keyboard.down('KeyW'),
    clients[1].page.keyboard.down('KeyS'),
    clients[2].page.keyboard.down('KeyD'),
  ]);
  await new Promise((resolve) => setTimeout(resolve, Math.max(8, Math.round(15 * durationScale))));
  await Promise.all([
    clients[0].page.keyboard.down('KeyD'),
    clients[1].page.keyboard.down('KeyA'),
    clients[2].page.keyboard.down('KeyW'),
  ]);
  await sleep(4_000);
  const rapidEnd = performance.now();
  await Promise.all(clients.map(releaseAll));

  await Promise.all(clients.map((client) => mark(client, 'reverse-rotation')));
  await Promise.all([
    clients[0].page.keyboard.down('KeyA'),
    clients[1].page.keyboard.down('KeyD'),
    clients[2].page.keyboard.down('KeyS'),
  ]);
  await sleep(3_000);
  await Promise.all(clients.map(releaseAll));
  const hostAnalysisEnd = performance.now();

  await clients[0].page.screenshot({ path: path.join(outputDir, 'normal-flight.png'), fullPage: true });

  await Promise.all(clients.map((client) => mark(client, 'degraded-network')));
  const degradedStart = performance.now();
  const patterns = [
    [45, 90, 135],
    [80, 140, 60],
    [120, 55, 105],
    [65, 125, 85],
  ];
  await Promise.all([
    clients[0].page.keyboard.down('KeyD'),
    clients[1].page.keyboard.down('KeyA'),
    clients[2].page.keyboard.down('KeyW'),
  ]);
  for (const pattern of patterns) {
    await Promise.all(clients.map((client, index) => setNetwork(client, {
      latency: pattern[index], downloadMbps: 12, uploadMbps: 4, packetLoss: 3,
    })));
    await sleep(1_250);
  }
  const degradedEnd = performance.now();
  await Promise.all(clients.map(releaseAll));
  await Promise.all(clients.map((client) => setNetwork(client, { latency: 0, packetLoss: 0 })));
  await sleep(1_500);

  const reconnectClient = clients[2];
  const beforeReconnect = reconnectClient.identity;
  await finishProbe(reconnectClient);
  await reconnectClient.page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await reconnectClient.page.waitForFunction(() => window.__coopStatus?.().active === true, null, { timeout: 45_000 });
  await reconnectClient.page.evaluate(() => window.__setCoopIntroElapsed?.(7_000));
  await reconnectClient.page.waitForFunction(() => {
    try { return JSON.parse(window.render_game_to_text?.() || '{}').bootPhase === 'playing'; } catch { return false; }
  }, null, { timeout: 15_000 });
  reconnectClient.identity = await reconnectClient.page.evaluate(() => window.__coopStatus().playerId);
  assert(reconnectClient.identity === beforeReconnect, 'Reconnect changed authenticated identity');
  await startRafProbe(reconnectClient.page, 'reconnected');
  await sleep(2_000);
  await clients[0].page.screenshot({ path: path.join(outputDir, 'degraded-recovered.png'), fullPage: true });
  await reconnectClient.page.screenshot({ path: path.join(outputDir, 'reconnected-player-3.png'), fullPage: true });

  await Promise.all(clients.map(releaseAll));
  await sleep(1_500);
  const observations = await Promise.all(clients.map(captureObservation));
  const divergence = finalDivergence(observations);

  for (const client of clients) await finishProbe(client);
  const clientsReport = clients.map((client) => {
    const samples = client.probeSegments.flatMap((segment) => segment.samples ?? []);
    const expectedRapid = client.index === 1
      ? { x: 1, y: -1 }
      : client.index === 2
        ? { x: -1, y: 1 }
        : { x: 1, y: -1 };
    const rapidInputs = client.sent.filter((entry) => entry.command === 'setFlagshipInput'
      && entry.at >= rapidStart && entry.at <= rapidEnd);
    return {
      index: client.index,
      account: client.account,
      identity: client.identity,
      errors: client.errors,
      receivedFrames: client.received.length,
      sentCommands: client.sent.length,
      expectedRapidInput: expectedRapid,
      rapidInputDelivered: rapidInputs.some((entry) => entry.payload.x === expectedRapid.x && entry.payload.y === expectedRapid.y),
      rapidInputs,
      presentation: analyzeSamples(samples, client.identity),
      diagnostics: null,
      networkImpairment: client.networkImpairment,
    };
  });
  for (let index = 0; index < clients.length; index += 1) {
    clientsReport[index].diagnostics = await clients[index].page.evaluate(() => window.__coopStatus().diagnostics);
  }

  const hostTiming = analyzeHostTiming(clients[0].received, hostAnalysisStart, hostAnalysisEnd);
  const degradedTiming = analyzeHostTiming(clients[0].received, degradedStart, degradedEnd);
  runResult = {
    ok: true,
    mode,
    runLabel,
    durationScale,
    environment: {
      node: process.version,
      browser: await browser.version(),
      clients: clients.length,
      authenticated: true,
      appPort,
      coopPort,
      serverAuthority: true,
      simulationStepMs: 50,
      poseTargetMs: 100,
      degradedNetwork: { latencyRangeMs: [45, 140], packetLossPercentRequested: 3, downloadMbps: 12, uploadMbps: 4 },
    },
    scenarios: [
      'two pilots sustain opposing flight',
      'third authenticated pilot joins the active flight',
      'simultaneous acceleration and deceleration',
      '15ms two-key diagonal direction changes',
      'rapid reverse direction and rotation',
      'simultaneous flight under changing latency, jitter, and requested 3% packet loss',
      'authenticated reload and identity-preserving reconnect',
    ],
    hostTiming,
    degradedTiming,
    divergence,
    observations,
    clients: clientsReport,
  };

  if (mode === 'verify') {
    assert(hostTiming.poses >= 20, `Too few normal pose samples: ${hostTiming.poses}`);
    assert(Math.abs(hostTiming.driftMs) <= 100, `Authoritative simulation drift exceeded 100ms: ${hostTiming.driftMs.toFixed(1)}ms`);
    assert(hostTiming.duplicateHostTimes <= 1, `Duplicate authoritative host times: ${hostTiming.duplicateHostTimes}`);
    assert(hostTiming.arrivalGapsMs.p95 <= 250, `Normal pose p95 exceeded 250ms: ${hostTiming.arrivalGapsMs.p95}`);
    assert(clientsReport.every((entry) => entry.rapidInputDelivered), 'At least one rapid diagonal input never reached the server socket');
    assert(clientsReport.every((entry) => entry.errors.length === 0), 'Browser console/page errors occurred');
    assert(clientsReport.every((entry) => entry.diagnostics?.lastPoseAgeMs < 500), 'A client ended with a stale pose stream');
    assert(divergence.maxPositionUnits <= 25, `Cross-client position divergence exceeded 25 units: ${divergence.maxPositionUnits}`);
    assert(divergence.maxVelocityUnitsPerSec <= 25, `Cross-client velocity divergence exceeded 25 units/s: ${divergence.maxVelocityUnitsPerSec}`);
    assert(divergence.maxHeadingRadians <= 0.2, `Cross-client heading divergence exceeded 0.2 rad: ${divergence.maxHeadingRadians}`);
    for (const entry of clientsReport) {
      const labels = Object.values(entry.presentation);
      assert(labels.every((label) => (label.frameGapsMs.p99 ?? 0) <= 100), `Client ${entry.index} frame p99 exceeded 100ms`);
      assert(labels.reduce((sum, label) => sum + label.backwardsFrames, 0) === 0, `Client ${entry.index} moved backward during correction`);
    }
  }
}

async function stopChildren() {
  for (const child of children) {
    if (child.exitCode == null) child.kill('SIGTERM');
  }
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode != null) return resolve();
    const timer = setTimeout(() => {
      if (child.exitCode == null) child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  })));
}

async function cleanup() {
  await browser?.close().catch(() => {});
  browser = null;
  await stopChildren();
  for (const [label, lines] of childLogs) {
    fs.writeFileSync(path.join(outputDir, `${label}.log`), lines.join(''));
  }

  const cleanupReport = {
    isolatedRoot: temporaryRoot,
    accountDirectory: accountDir,
    worldDirectory: worldDir,
    usersBeforeDelete: [],
    exactCreatedSetVerified: false,
    rootDeleted: false,
    existingExternalStoresTouched: false,
  };
  if (fs.existsSync(accountDir)) {
    const store = new AuthStore({ dataDir: accountDir, sessionPepper });
    try {
      cleanupReport.usersBeforeDelete = store.listUsers().map((user) => ({ id: user.id, username: user.username }));
    } finally {
      store.close();
    }
    const expected = [...accounts].map((entry) => entry.id).sort();
    const actual = cleanupReport.usersBeforeDelete.map((entry) => entry.id).sort();
    cleanupReport.exactCreatedSetVerified = expected.length === actual.length
      && expected.every((id, index) => id === actual[index]);
  }
  const safePrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
  const safeOwnedRoot = path.resolve(temporaryRoot).startsWith(safePrefix)
    && path.basename(temporaryRoot).startsWith('gs-coop-movement-');
  if (!safeOwnedRoot) throw new Error(`Refusing to delete unexpected temporary root: ${temporaryRoot}`);
  if (!cleanupReport.exactCreatedSetVerified && accounts.length > 0) {
    throw new Error('Refusing cleanup because isolated account inventory did not exactly match task-created accounts');
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  cleanupReport.rootDeleted = !fs.existsSync(temporaryRoot);
  for (const account of accounts) account.deleted = cleanupReport.rootDeleted && cleanupReport.exactCreatedSetVerified;
  const ledger = {
    runLabel,
    accounts: accounts.map((entry) => ({
      id: entry.id,
      username: entry.username,
      displayName: entry.displayName,
      created: entry.created,
      deleted: entry.deleted,
    })),
    cleanup: cleanupReport,
  };
  fs.writeFileSync(path.join(outputDir, 'resource-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  if (runResult) runResult.resources = ledger;
  return ledger;
}

try {
  await main();
} catch (error) {
  runError = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    runError = runError
      ? new AggregateError([runError, cleanupError], 'Movement run and cleanup both failed')
      : cleanupError;
  }
  const report = runResult ?? { ok: false, mode, runLabel, durationScale };
  if (runError) report.error = String(runError?.stack || runError);
  fs.writeFileSync(path.join(outputDir, 'movement-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

if (runError) {
  console.error(`[movement] FAIL: ${runError.stack || runError}`);
  process.exit(1);
}

console.log(JSON.stringify(runResult, null, 2));
console.log(`[movement] ${mode.toUpperCase()} PASS · artifacts ${outputDir}`);
