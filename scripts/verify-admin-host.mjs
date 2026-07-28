#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import WebSocket from 'ws';

const APP_PORT = 20_100 + Math.floor(Math.random() * 200);
const COOP_PORT = APP_PORT + 300;
const JWKS_PORT = APP_PORT + 600;
const ADMIN_ORIGIN = 'http://admin.test';
const ISSUER = `http://127.0.0.1:${JWKS_PORT}`;
const AUDIENCE = 'admin-integration-audience';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-admin-host-'));
const dataDir = path.join(root, 'data');
const adminDist = path.join(root, 'admin-dist');
const gameDist = path.join(root, 'dist');
const children = [];

fs.mkdirSync(adminDist, { recursive: true });
fs.mkdirSync(gameDist, { recursive: true });
fs.writeFileSync(path.join(adminDist, 'index.html'), '<!doctype html><title>Owner Operations</title><main>Verified admin shell</main>');
fs.writeFileSync(path.join(gameDist, 'index.html'), '<!doctype html><title>Play</title>');

const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
Object.assign(publicJwk, { kid: 'integration-key', alg: 'RS256', use: 'sig' });
const jwksServer = http.createServer((req, res) => {
  if (req.url !== '/cdn-cgi/access/certs') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ keys: [publicJwk] }));
});

function launch(file, env) {
  const child = spawn('node', [file], {
    cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${path.basename(file)}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${path.basename(file)}] ${chunk}`));
  children.push(child);
}

async function waitFor(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let token;
async function adminRequest(pathname, { method = 'GET', body, csrf, origin = ADMIN_ORIGIN, assertion = token, host = 'admin.test' } = {}) {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}${pathname}`, {
    method,
    headers: {
      'x-forwarded-host': host,
      ...(assertion == null ? {} : { 'cf-access-jwt-assertion': assertion }),
      ...(origin == null ? {} : { origin }),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') || '';
  return { response, payload: contentType.includes('json') ? await response.json() : await response.text() };
}

async function playRequest(pathname, { method = 'GET', body, cookie, csrf } = {}) {
  const origin = `http://127.0.0.1:${APP_PORT}`;
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

function connectPresence(cookie) {
  const origin = `http://127.0.0.1:${APP_PORT}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws/presence`, {
      origin,
      headers: { cookie },
    });
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for presenceReady')), 10_000);
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'presenceReady') {
        clearTimeout(timeout);
        resolve({ socket, ready: message });
      }
    });
    socket.once('error', reject);
  });
}

function waitForAdminNotice(socket, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for adminNotice')), timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type !== 'adminNotice') return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

try {
  await new Promise((resolve) => jwksServer.listen(JWKS_PORT, '127.0.0.1', resolve));
  token = await new SignJWT({ email: 'owner@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject('owner-access-subject')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);

  launch('server/coop-host.mjs', {
    GS_COOP_HOST: '127.0.0.1', GS_COOP_PORT: String(COOP_PORT), GS_COOP_DATA_DIR: path.join(root, 'world'),
    GS_GATEWAY_SECRET: 'admin-integration-gateway-secret',
  });
  launch('server/app-host.mjs', {
    GS_APP_HOST: '127.0.0.1', GS_APP_PORT: String(APP_PORT), GS_PUBLIC_ORIGIN: `http://127.0.0.1:${APP_PORT}`,
    GS_ADMIN_ORIGIN: ADMIN_ORIGIN, GS_ACCESS_TEAM_DOMAIN: ISSUER, GS_ACCESS_AUD: AUDIENCE,
    GS_ADMIN_CSRF_SECRET: 'admin-integration-csrf-secret-at-least-32-characters',
    GS_DATA_DIR: dataDir, GS_DIST_DIR: gameDist, GS_ADMIN_DIST_DIR: adminDist,
    GS_HEALTH_DIR: path.join(root, 'health'), GS_GAME_RELEASES_DIR: path.join(root, 'game-releases'),
    GS_SITE_RELEASES_DIR: path.join(root, 'site-releases'), GS_GAME_CURRENT_LINK: path.join(root, 'game-current'),
    GS_SITE_CURRENT_LINK: path.join(root, 'site-current'), GS_ADMIN_OPS_SOCKET: path.join(root, 'admin-ops.sock'),
    GS_COOP_INTERNAL_URL: `ws://127.0.0.1:${COOP_PORT}`, GS_GATEWAY_SECRET: 'admin-integration-gateway-secret',
    GS_SESSION_PEPPER: 'admin-integration-session-pepper',
  });
  await waitFor(`http://127.0.0.1:${APP_PORT}/healthz`);

  assert.equal((await adminRequest('/api/v1/admin/session', { assertion: null })).response.status, 403);
  assert.equal((await adminRequest('/api/v1/admin/session', { host: 'play.galacticsovereign.xyz' })).response.status, 404);
  assert.equal((await adminRequest('/api/v1/admin/session', { assertion: `${token}tampered` })).response.status, 403);

  const session = await adminRequest('/api/v1/admin/session');
  assert.equal(session.response.status, 200);
  assert.deepEqual(Object.keys(session.payload.identity).sort(), ['email', 'sub']);
  assert.ok(session.payload.capabilities.includes('players:write'));
  assert.ok(session.payload.capabilities.includes('operations:read'));
  assert.ok(session.payload.capabilities.includes('releases:write'));
  assert.ok(session.payload.csrfToken);

  const page = await adminRequest('/');
  assert.equal(page.response.status, 200);
  assert.match(page.payload, /Verified admin shell/);
  assert.doesNotMatch(page.payload, /password|login/i);

  const denied = await adminRequest('/api/v1/admin/users', {
    method: 'POST', csrf: session.payload.csrfToken, origin: 'https://play.galacticsovereign.xyz',
    body: { username: 'denied', displayName: 'Denied' },
  });
  assert.equal(denied.response.status, 403);

  const created = await adminRequest('/api/v1/admin/users', {
    method: 'POST', csrf: session.payload.csrfToken,
    body: { username: 'pilot', displayName: 'Test Pilot' },
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.payload.requestId);
  assert.ok(created.payload.temporaryPassword);

  const playerLogin = await playRequest('/api/v1/auth/login', {
    method: 'POST', body: { username: 'pilot', password: created.payload.temporaryPassword },
  });
  assert.equal(playerLogin.response.status, 200);
  let playerCookie = playerLogin.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(playerCookie);
  const passwordChange = await playRequest('/api/v1/auth/change-password', {
    method: 'POST',
    cookie: playerCookie,
    csrf: playerLogin.payload.csrfToken,
    body: { currentPassword: created.payload.temporaryPassword, newPassword: 'Pilot Password 123!' },
  });
  assert.equal(passwordChange.response.status, 200);
  const readyLogin = await playRequest('/api/v1/auth/login', {
    method: 'POST', body: { username: 'pilot', password: 'Pilot Password 123!' },
  });
  assert.equal(readyLogin.response.status, 200);
  playerCookie = readyLogin.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(playerCookie);

  for (const route of ['/api/v1/admin/overview', '/api/v1/admin/operations', '/api/v1/admin/telemetry?period=7d', '/api/v1/admin/multiplayer', '/api/v1/admin/releases', '/api/v1/admin/users', '/api/v1/admin/sessions', '/api/v1/admin/saves', '/api/v1/admin/backups', '/api/v1/admin/audit']) {
    assert.equal((await adminRequest(route)).response.status, 200, `${route} failed`);
  }

  const presence = await connectPresence(playerCookie);
  assert.equal(presence.ready.mode, 'online');
  presence.socket.send(JSON.stringify({ type: 'presence', mode: 'solo' }));
  await delay(100);
  const noticeWait = waitForAdminNotice(presence.socket);
  const notice = await adminRequest('/api/v1/admin/multiplayer/notice', {
    method: 'POST', csrf: session.payload.csrfToken, body: { message: 'Integration maintenance notice' },
  });
  assert.equal(notice.response.status, 200);
  assert.ok(notice.payload.requestId);
  assert.equal(notice.payload.delivered, 1);
  const deliveredNotice = await noticeWait;
  assert.match(deliveredNotice.notice, /Integration maintenance notice/);
  const live = await adminRequest('/api/v1/admin/multiplayer');
  assert.equal(live.response.status, 200);
  assert.equal(live.payload.live.some((row) => row.username === 'pilot' && row.mode === 'solo'), true);
  presence.socket.close();
  await delay(100);
  const liveAfter = await adminRequest('/api/v1/admin/multiplayer');
  assert.equal(liveAfter.payload.live.some((row) => row.username === 'pilot'), false);

  assert.equal((await adminRequest('/api/v1/admin/telemetry?period=invalid')).response.status, 400);

  const sessions = await adminRequest('/api/v1/admin/sessions');
  const playerSession = sessions.payload.sessions.find((row) => row.username === 'pilot');
  assert.match(playerSession.sessionId, /^[a-f0-9]{12}$/);
  const revoked = await adminRequest(`/api/v1/admin/sessions/${playerSession.sessionId}`, {
    method: 'DELETE', csrf: session.payload.csrfToken,
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.payload.revoked, 1);
  const revokedSession = await playRequest('/api/v1/session', { cookie: playerCookie });
  assert.equal(revokedSession.response.status, 200);
  assert.equal(revokedSession.payload.authenticated, false);
  const audit = await adminRequest('/api/v1/admin/audit');
  const mutation = audit.payload.events.find((event) => event.action === 'admin.player.create');
  assert.ok(mutation);
  assert.match(mutation.actorUserId, /^access:/);
  assert.equal(mutation.detail.result, 'success');
  assert.ok(mutation.detail.requestId);

  const db = new DatabaseSync(path.join(dataDir, 'accounts.sqlite'));
  assert.throws(() => db.exec('DELETE FROM audit_events;'), /append-only/);
  assert.throws(() => db.exec("UPDATE audit_events SET action='tampered';"), /append-only/);
  db.close();
  console.log('[admin-host] PASS: JWT, host, origin, CSRF, API, audit, and append-only enforcement');
} finally {
  for (const child of children) child.kill('SIGTERM');
  jwksServer.close();
  await delay(200);
  fs.rmSync(root, { recursive: true, force: true });
}
