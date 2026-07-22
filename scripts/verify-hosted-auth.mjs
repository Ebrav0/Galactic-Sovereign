#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

import { AuthStore } from '../server/auth-store.mjs';
import { createNewGame } from '../src/js/state.js';
import { serialize } from '../src/js/save.js';

const APP_PORT = 19_280 + Math.floor(Math.random() * 100);
const COOP_PORT = APP_PORT + 100;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-hosted-auth-'));
const accountDir = path.join(root, 'accounts');
const worldDir = path.join(root, 'world');
const distDir = path.join(root, 'dist');
const gatewaySecret = 'test-only-gateway-secret-that-is-not-deployed';
const children = [];

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>test</title>');

function assert(value, message) {
  if (!value) throw new Error(message);
}

function launch(command, args, env) {
  const child = spawn(command, args, {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => process.stdout.write(`[${path.basename(args[0])}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${path.basename(args[0])}] ${data}`));
  children.push(child);
  return child;
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* retry */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function request(pathname, { method = 'GET', body, session, csrf = false } = {}) {
  const response = await fetch(`${ORIGIN}${pathname}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body == null ? {} : { 'content-type': 'application/json' }),
      ...(session?.cookie ? { cookie: session.cookie } : {}),
      ...(csrf && session?.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function login(username, password) {
  const result = await request('/api/v1/auth/login', { method: 'POST', body: { username, password } });
  assert(result.response.status === 200, `Login failed for ${username}: ${JSON.stringify(result.payload)}`);
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  return { cookie, csrfToken: result.payload.csrfToken, user: result.payload.user };
}

function connectMultiplayer(session, hello = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws/multiplayer`, {
      origin: ORIGIN,
      headers: { cookie: session.cookie },
    });
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for multiplayer welcome')), 10_000);
    socket.once('open', () => socket.send(JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      playerName: 'spoofed-name',
      playerId: 'spoofed-player-id',
      reconnectToken: 'spoofed-reconnect-token',
      ...hello,
    })));
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'welcome') {
        clearTimeout(timeout);
        resolve({ socket, welcome: message });
      }
    });
    socket.once('error', reject);
  });
}

async function main() {
  const bootstrap = new AuthStore({ dataDir: accountDir });
  const owner = await bootstrap.createUser({
    username: 'owner', displayName: 'Owner', password: 'Owner Password 123!', role: 'owner', mustChangePassword: false,
  });
  const player = await bootstrap.createUser({
    username: 'pilot', displayName: 'Pilot', password: 'Pilot Password 123!', role: 'player', mustChangePassword: false,
  });
  bootstrap.close();

  launch('node', ['server/coop-host.mjs'], {
    GS_COOP_HOST: '127.0.0.1', GS_COOP_PORT: String(COOP_PORT), GS_COOP_DATA_DIR: worldDir,
    GS_GATEWAY_SECRET: gatewaySecret, GS_COOP_AUTOSAVE_MS: '300000',
  });
  launch('node', ['server/app-host.mjs'], {
    GS_APP_HOST: '127.0.0.1', GS_APP_PORT: String(APP_PORT), GS_PUBLIC_ORIGIN: ORIGIN,
    GS_COOKIE_SECURE: '0', GS_DATA_DIR: accountDir, GS_DIST_DIR: distDir,
    GS_COOP_INTERNAL_URL: `ws://127.0.0.1:${COOP_PORT}`, GS_GATEWAY_SECRET: gatewaySecret,
    GS_SESSION_PEPPER: 'test-only-session-pepper-that-is-not-deployed',
  });
  await waitForHttp(`${ORIGIN}/healthz`);

  const ownerSession = await login('owner', 'Owner Password 123!');
  const playerSession = await login('pilot', 'Pilot Password 123!');
  const envelope = serialize(createNewGame(123));

  const ownerWrite = await request('/api/v1/saves/slot-1', {
    method: 'PUT', session: ownerSession, csrf: true, body: { envelope, expectedRevision: 0 },
  });
  assert(ownerWrite.response.status === 200 && ownerWrite.payload.save.revision === 1, 'Owner save write failed');
  const isolatedRead = await request('/api/v1/saves/slot-1', { session: playerSession });
  assert(isolatedRead.response.status === 404, 'Player could read owner save');
  const playerWrite = await request('/api/v1/saves/slot-1', {
    method: 'PUT', session: playerSession, csrf: true, body: { envelope, expectedRevision: 0 },
  });
  assert(playerWrite.response.status === 200, 'Player save write failed');
  const staleWrite = await request('/api/v1/saves/slot-1', {
    method: 'PUT', session: ownerSession, csrf: true, body: { envelope, expectedRevision: 0 },
  });
  assert(staleWrite.response.status === 409 && staleWrite.payload.currentRevision === 1, 'Stale save did not return 409');

  const ownerMultiplayer = await connectMultiplayer(ownerSession);
  assert(ownerMultiplayer.welcome.playerId === owner.id, 'Gateway did not replace spoofed multiplayer playerId');
  assert(ownerMultiplayer.welcome.displayName === owner.displayName, 'Gateway did not replace spoofed display name');
  assert(!ownerMultiplayer.welcome.reconnectToken, 'Authenticated welcome leaked a reconnect token');
  ownerMultiplayer.socket.close();

  const playerMultiplayer = await connectMultiplayer(playerSession);
  const closePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Disabled user WebSocket was not revoked')), 8_000);
    playerMultiplayer.socket.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  const disable = await request(`/api/v1/admin/users/${player.id}/status`, {
    method: 'PATCH', session: ownerSession, csrf: true, body: { status: 'disabled' },
  });
  assert(disable.response.status === 200, `Disable failed: ${JSON.stringify(disable.payload)}`);
  const closeCode = await closePromise;
  assert(closeCode === 4003, `Disabled WebSocket closed with unexpected code ${closeCode}`);
  const revokedApi = await request('/api/v1/saves', { session: playerSession });
  assert(revokedApi.response.status === 401, 'Disabled user retained API access');

  console.log('[hosted-auth] PASS: isolation, ETags, gateway identity, and immediate revocation');
}

try {
  await main();
} finally {
  for (const child of children) child.kill('SIGTERM');
  await delay(200);
  fs.rmSync(root, { recursive: true, force: true });
}
