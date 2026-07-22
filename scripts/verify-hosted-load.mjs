#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

import { AuthStore } from '../server/auth-store.mjs';

const durationMs = Number(process.env.GS_LOAD_DURATION_MS || 60_000);
const appPort = Number(process.env.GS_LOAD_APP_PORT || 19680);
const coopPort = Number(process.env.GS_LOAD_COOP_PORT || 19780);
const baseUrl = `http://127.0.0.1:${appPort}`;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-hosted-load-'));
const accountDir = path.join(temporaryRoot, 'accounts');
const worldDir = path.join(temporaryRoot, 'world');
const password = 'Hosted Load Test Password 1234';
const gatewaySecret = 'load-test-only-gateway-secret';
const sessionPepper = 'load-test-only-session-pepper';
const children = [];

function assert(value, message) {
  if (!value) throw new Error(message);
}

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: path.resolve('.'),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (chunk) => process.stdout.write(`[${path.basename(args[0])}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${path.basename(args[0])}] ${chunk}`));
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Hosted load-test gateway did not become healthy');
}

const store = new AuthStore({ dataDir: accountDir, sessionPepper });
try {
  for (let index = 1; index <= 5; index += 1) {
    await store.createUser({
      username: `load-pilot-${index}`,
      displayName: `Load Pilot ${index}`,
      password,
      mustChangePassword: false,
    });
  }
} finally {
  store.close();
}

start('node', ['server/coop-host.mjs'], {
  GS_COOP_HOST: '127.0.0.1',
  GS_COOP_PORT: String(coopPort),
  GS_COOP_DATA_DIR: worldDir,
  GS_COOP_AUTOSAVE_MS: '300000',
  GS_GATEWAY_SECRET: gatewaySecret,
});
start('node', ['server/app-host.mjs'], {
  GS_APP_HOST: '127.0.0.1',
  GS_APP_PORT: String(appPort),
  GS_PUBLIC_ORIGIN: baseUrl,
  GS_COOKIE_SECURE: '0',
  GS_SESSION_PEPPER: sessionPepper,
  GS_DATA_DIR: accountDir,
  GS_DIST_DIR: path.resolve('dist'),
  GS_COOP_INTERNAL_URL: `ws://127.0.0.1:${coopPort}`,
  GS_GATEWAY_SECRET: gatewaySecret,
});

let browser;
try {
  await waitForHealth();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const pages = [];
  for (let index = 1; index <= 5; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/healthz`, { waitUntil: 'domcontentloaded' });
    const joined = await page.evaluate(async ({ username, password: loginPassword }) => {
      const login = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: loginPassword }),
      });
      if (!login.ok) throw new Error(`Login failed: ${login.status}`);
      window.__loadMetrics = { playerId: null, lastPoseAt: 0, maxPoseGapMs: 0, latencies: [], pending: {} };
      const socket = new WebSocket(`ws://${location.host}/ws/multiplayer`);
      window.__loadSocket = socket;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket welcome timed out')), 15_000);
        socket.addEventListener('open', () => socket.send(JSON.stringify({
          type: 'hello', protocolVersion: 2, playerName: username,
        })));
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'welcome') {
            window.__loadMetrics.playerId = message.playerId;
            clearTimeout(timer);
            resolve({ playerId: message.playerId });
          } else if (message.type === 'pose') {
            const at = performance.now();
            if (window.__loadMetrics.lastPoseAt) {
              window.__loadMetrics.maxPoseGapMs = Math.max(
                window.__loadMetrics.maxPoseGapMs,
                at - window.__loadMetrics.lastPoseAt,
              );
            }
            window.__loadMetrics.lastPoseAt = at;
          } else if (message.type === 'commandResult') {
            const startedAt = window.__loadMetrics.pending[message.requestId];
            if (startedAt != null) {
              window.__loadMetrics.latencies.push(performance.now() - startedAt);
              delete window.__loadMetrics.pending[message.requestId];
            }
          }
        });
        socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')));
      });
    }, { username: `load-pilot-${index}`, password });
    assert(joined.playerId, `Browser context ${index} did not receive an identity`);
    pages.push(page);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await Promise.all(pages.map((page, index) => page.evaluate((direction) => {
      const requestId = crypto.randomUUID();
      window.__loadMetrics.pending[requestId] = performance.now();
      window.__loadSocket.send(JSON.stringify({
        type: 'command', command: 'setFlagshipInput', requestId, payload: { x: direction, y: 0 },
      }));
    }, index % 2 ? -0.15 : 0.15)));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await Promise.all(pages.map((page) => page.evaluate(() => {
    const requestId = crypto.randomUUID();
    window.__loadMetrics.pending[requestId] = performance.now();
    window.__loadSocket.send(JSON.stringify({
      type: 'command', command: 'setFlagshipInput', requestId, payload: { x: 0, y: 0 },
    }));
  })));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const reports = await Promise.all(pages.map((page) => page.evaluate(() => {
    const sorted = [...window.__loadMetrics.latencies].sort((a, b) => a - b);
    return {
      active: window.__loadSocket.readyState === WebSocket.OPEN,
      playerId: window.__loadMetrics.playerId,
      commandSamples: sorted.length,
      commandAckP95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
      maxPoseGapMs: window.__loadMetrics.maxPoseGapMs,
      lastPoseAgeMs: performance.now() - window.__loadMetrics.lastPoseAt,
    };
  })));
  assert(reports.every((report) => report.active), 'One or more browser contexts disconnected');
  assert(new Set(reports.map((report) => report.playerId)).size === 5, 'Five unique account identities were not present');
  for (const report of reports) {
    assert(report.commandAckP95Ms < 250, `Command p95 exceeded 250 ms: ${report.commandAckP95Ms}`);
    assert(report.maxPoseGapMs < 500, `Pose gap exceeded 500 ms: ${report.maxPoseGapMs}`);
  }
  console.log(JSON.stringify({ ok: true, durationMs, players: reports }, null, 2));
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode != null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 5000).unref();
  })));
}
