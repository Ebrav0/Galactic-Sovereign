#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

import { AuthStore, generateTemporaryPassword } from './auth-store.mjs';
import { createAccessAuth } from './access-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GS_APP_PORT || 8080);
const HOST = process.env.GS_APP_HOST || '127.0.0.1';
const PUBLIC_ORIGIN = String(process.env.GS_PUBLIC_ORIGIN || `http://${HOST}:${PORT}`).replace(/\/$/, '');
const ADMIN_ORIGIN = String(process.env.GS_ADMIN_ORIGIN || '').replace(/\/$/, '');
const DATA_DIR = path.resolve(process.env.GS_DATA_DIR || path.join(__dirname, 'data'));
const DIST_DIR = path.resolve(process.env.GS_DIST_DIR || path.join(__dirname, '..', 'dist'));
const ADMIN_DIST_DIR = path.resolve(process.env.GS_ADMIN_DIST_DIR || path.join(__dirname, '..', 'admin-dist'));
const COOP_URL = process.env.GS_COOP_INTERNAL_URL || 'ws://127.0.0.1:9090';
const COOP_HEALTH_URL = COOP_URL.replace(/^ws/i, 'http').replace(/\/$/, '') + '/health';
const COOKIE_SECURE = process.env.GS_COOKIE_SECURE != null
  ? process.env.GS_COOKIE_SECURE === '1'
  : PUBLIC_ORIGIN.startsWith('https://');
const COOKIE_NAME = COOKIE_SECURE ? '__Host-gs_session' : 'gs_session';
const MAX_JSON_BYTES = 8 * 1024 * 1024 + 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function readCredential(name, fileName) {
  const direct = process.env[name];
  if (direct) return direct;
  const credentialsDir = process.env.CREDENTIALS_DIRECTORY;
  if (credentialsDir) {
    try { return fs.readFileSync(path.join(credentialsDir, fileName), 'utf8').trim(); } catch { /* continue */ }
  }
  const explicitPath = process.env[`${name}_FILE`];
  if (explicitPath) return fs.readFileSync(explicitPath, 'utf8').trim();
  return '';
}

const GATEWAY_SECRET = readCredential('GS_GATEWAY_SECRET', 'gateway-secret');
const SESSION_PEPPER = readCredential('GS_SESSION_PEPPER', 'session-pepper');
const ADMIN_CSRF_SECRET = readCredential('GS_ADMIN_CSRF_SECRET', 'admin-csrf-secret') || (
  SESSION_PEPPER
    ? crypto.createHmac('sha256', SESSION_PEPPER)
      .update('galactic-sovereign-admin-csrf-v1')
      .digest('base64url')
    : ''
);
const ACCESS_AUTH = createAccessAuth({
  teamDomain: process.env.GS_ACCESS_TEAM_DOMAIN,
  audience: readCredential('GS_ACCESS_AUD', 'access-audience'),
  adminOrigin: ADMIN_ORIGIN,
  csrfSecret: ADMIN_CSRF_SECRET,
});
if ((process.env.NODE_ENV === 'production' || GATEWAY_SECRET) && !SESSION_PEPPER) {
  throw new Error('Missing session-pepper credential (required in production and whenever gateway secret is configured)');
}
const store = new AuthStore({ dataDir: DATA_DIR, sessionPepper: SESSION_PEPPER });
const loginAttempts = new Map();
const liveSockets = new Set();
const BACKUP_DIR = path.resolve(process.env.GS_BACKUP_DIR || '/var/lib/galactic-sovereign/backups');
const HEALTH_DIR = path.resolve(process.env.GS_HEALTH_DIR || '/var/lib/galactic-sovereign/health');
const ADMIN_OPS_SOCKET = process.env.GS_ADMIN_OPS_SOCKET || '/run/galactic-sovereign/admin-ops.sock';
const GAME_RELEASES_DIR = path.resolve(process.env.GS_RELEASES_DIR || '/opt/galactic-sovereign/releases');
const SITE_RELEASES_DIR = path.resolve(process.env.GS_SITE_RELEASES_DIR || '/opt/galactic-sovereign/site-releases');
const GAME_CURRENT_LINK = path.resolve(process.env.GS_CURRENT_LINK || '/opt/galactic-sovereign/current');
const SITE_CURRENT_LINK = path.resolve(process.env.GS_SITE_CURRENT_LINK || '/opt/galactic-sovereign/site-current');

function requestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',', 1)[0].trim().toLowerCase();
}

function isAdminHost(req) {
  return Boolean(ACCESS_AUTH.adminHost && requestHost(req) === ACCESS_AUTH.adminHost);
}

function listBackupMetadata() {
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && !/\.(env|pem|key|token|secret)$/i.test(entry.name)) {
        try {
          const stat = fs.statSync(full);
          files.push({ name: path.relative(BACKUP_DIR, full), sizeBytes: stat.size, modifiedAt: stat.mtimeMs });
        } catch { /* file changed during scan */ }
      }
    }
  };
  walk(BACKUP_DIR);
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 200);
}

async function fetchCoopHealth() {
  try {
    const response = await fetch(COOP_HEALTH_URL, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true, ...await response.json() };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function healthFindings(health, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!health) return [{ key: 'telemetry-unavailable', severity: 'warning', message: 'Operations telemetry is not available yet' }];
  const findings = [];
  for (const [name, ok] of Object.entries(health.services || {})) {
    if (ok === false) findings.push({ key: `service-${name}`, severity: 'critical', message: `${name} service is unavailable` });
  }
  if (Number(health.backupAgeSeconds) > 1800) findings.push({ key: 'backup-stale', severity: 'critical', message: 'Newest backup is older than 30 minutes' });
  if (Number(health.diskUsePercent) >= 90) findings.push({ key: 'disk-critical', severity: 'critical', message: `Disk use is ${health.diskUsePercent}%` });
  else if (Number(health.diskUsePercent) >= 80) findings.push({ key: 'disk-warning', severity: 'warning', message: `Disk use is ${health.diskUsePercent}%` });
  if (health.firewallOk === false) findings.push({ key: 'firewall-drift', severity: 'critical', message: 'Firewall differs from the approved policy' });
  if (health.restoreTestAt && nowSeconds - Number(health.restoreTestAt) > 8 * 86400) findings.push({ key: 'restore-stale', severity: 'critical', message: 'Local restore verification is overdue' });
  if (health.offsiteRestoreTestAt && nowSeconds - Number(health.offsiteRestoreTestAt) > 35 * 86400) findings.push({ key: 'offsite-restore-stale', severity: 'critical', message: 'Offsite restore verification is overdue' });
  if (/\bLB\b|LOW/i.test(String(health.upsState || ''))) findings.push({ key: 'ups-low', severity: 'critical', message: `UPS reports ${health.upsState}` });
  const age = nowSeconds - Number(health.timestamp || 0);
  if (age > 300) findings.push({ key: 'telemetry-stale', severity: 'critical', message: 'Operations telemetry is more than five minutes old' });
  return findings;
}

function operationsState() {
  const health = safeReadJson(path.join(HEALTH_DIR, 'latest.json'));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const findings = healthFindings(health, nowSeconds);
  const critical = findings.filter((item) => item.severity === 'critical').length;
  const warnings = findings.filter((item) => item.severity === 'warning').length;
  return {
    ok: critical === 0,
    readiness: health ? Math.max(0, 100 - critical * 25 - warnings * 8) : null,
    telemetry: health,
    telemetryAgeSeconds: health ? Math.max(0, nowSeconds - Number(health.timestamp || 0)) : null,
    findings,
  };
}

function telemetrySeries(period = '24h') {
  const windows = { '24h': { seconds: 86400, bucket: 900 }, '7d': { seconds: 7 * 86400, bucket: 3600 }, '30d': { seconds: 30 * 86400, bucket: 6 * 3600 } };
  const config = windows[period] || windows['24h'];
  const cutoff = Math.floor(Date.now() / 1000) - config.seconds;
  const files = (() => {
    try { return fs.readdirSync(HEALTH_DIR).filter((name) => /^metrics-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort(); }
    catch { return []; }
  })();
  const buckets = new Map();
  for (const name of files) {
    let lines = [];
    try { lines = fs.readFileSync(path.join(HEALTH_DIR, name), 'utf8').split('\n'); } catch { continue; }
    for (const line of lines) {
      if (!line) continue;
      let point;
      try { point = JSON.parse(line); } catch { continue; }
      const timestamp = Number(point.timestamp || 0);
      if (timestamp < cutoff) continue;
      const bucketAt = Math.floor(timestamp / config.bucket) * config.bucket;
      const entry = buckets.get(bucketAt) || { timestamp: bucketAt, samples: 0, diskUsePercent: 0, backupAgeSeconds: 0, playersOnline: 0, availableServices: 0 };
      entry.samples += 1;
      entry.diskUsePercent += Number(point.diskUsePercent || 0);
      entry.backupAgeSeconds += Number(point.backupAgeSeconds || 0);
      entry.playersOnline += Number(point.playersOnline || 0);
      entry.availableServices += Object.values(point.services || {}).filter(Boolean).length;
      buckets.set(bucketAt, entry);
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp).map((entry) => ({
    timestamp: entry.timestamp,
    diskUsePercent: Number((entry.diskUsePercent / entry.samples).toFixed(2)),
    backupAgeSeconds: Math.round(entry.backupAgeSeconds / entry.samples),
    playersOnline: Number((entry.playersOnline / entry.samples).toFixed(2)),
    availableServices: Number((entry.availableServices / entry.samples).toFixed(2)),
  }));
}

function releaseInventory(root, currentLink, surface) {
  let currentPath = null;
  try { currentPath = fs.realpathSync(currentLink); } catch { /* unavailable locally */ }
  const releases = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { /* unavailable locally */ }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    try {
      const stat = fs.statSync(full);
      releases.push({ id: entry.name, surface, installedAt: stat.mtimeMs, current: currentPath === full });
    } catch { /* release changed during read */ }
  }
  releases.sort((a, b) => b.installedAt - a.installedAt);
  return { current: releases.find((release) => release.current)?.id || null, releases: releases.slice(0, 12) };
}

function liveMultiplayerRows() {
  const byAccount = new Map();
  for (const socket of liveSockets) {
    const user = socket.gsUser;
    if (!user?.id) continue;
    const row = byAccount.get(user.id) || {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      connectedAt: socket.gsConnectedAt || null,
      lastActivityAt: socket.gsLastActivityAt || socket.gsConnectedAt || null,
      connections: 0,
    };
    row.connections += 1;
    row.connectedAt = Math.min(row.connectedAt || Infinity, socket.gsConnectedAt || Infinity);
    row.lastActivityAt = Math.max(row.lastActivityAt || 0, socket.gsLastActivityAt || 0);
    byAccount.set(user.id, row);
  }
  return [...byAccount.values()].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
}

function adminOpsRequest(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ADMIN_OPS_SOCKET);
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.statusCode = 503;
      reject(error);
    };
    socket.setTimeout(150_000);
    socket.on('connect', () => socket.end(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) { socket.destroy(); fail('Operations broker returned too much data'); return; }
      chunks.push(chunk);
    });
    socket.on('timeout', () => { socket.destroy(); fail('Operations broker timed out'); });
    socket.on('error', () => fail('Operations broker is unavailable'));
    socket.on('end', () => {
      if (settled) return;
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!response.ok) {
          settled = true;
          const error = new Error(response.error || 'Operations broker rejected the request');
          error.statusCode = Number(response.statusCode) || 409;
          reject(error);
          return;
        }
        settled = true;
        resolve(response);
      } catch { fail('Operations broker returned an invalid response'); }
    });
  });
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (PUBLIC_ORIGIN.startsWith('https://')) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
}

function forwardedProtocol(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',', 1)[0].trim().toLowerCase();
}

function redirectForwardedHttp(req, res) {
  const canonicalOrigin = isAdminHost(req) ? ADMIN_ORIGIN : PUBLIC_ORIGIN;
  if (!canonicalOrigin.startsWith('https://') || forwardedProtocol(req) !== 'http') return false;
  const location = new URL(req.url || '/', canonicalOrigin).toString();
  res.writeHead(308, { location, 'cache-control': 'no-store' });
  res.end();
  return true;
}

function parseCookies(req) {
  const cookies = {};
  for (const piece of String(req.headers.cookie || '').split(';')) {
    const at = piece.indexOf('=');
    if (at < 1) continue;
    cookies[piece.slice(0, at).trim()] = decodeURIComponent(piece.slice(at + 1).trim());
  }
  return cookies;
}

function sessionFor(req, opts = {}) {
  return store.getSession(parseCookies(req)[COOKIE_NAME], opts);
}

function setSessionCookie(res, token, maxAgeSeconds = null) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(COOKIE_SECURE ? ['Secure'] : []),
    ...(maxAgeSeconds == null ? [] : [`Max-Age=${maxAgeSeconds}`]),
  ];
  res.setHeader('set-cookie', attrs.join('; '));
}

function requestOrigin(req) {
  return String(req.headers.origin || '').replace(/\/$/, '');
}

function validOrigin(req) {
  return requestOrigin(req) === PUBLIC_ORIGIN;
}

function requireSession(req, res, { ready = false, owner = false, csrf = false } = {}) {
  const session = sessionFor(req);
  if (!session) {
    json(res, 401, { ok: false, error: 'Authentication required' });
    return null;
  }
  if (ready && session.user.mustChangePassword) {
    json(res, 403, { ok: false, code: 'password_change_required', error: 'Change your temporary password first' });
    return null;
  }
  if (owner && session.user.role !== 'owner') {
    json(res, 403, { ok: false, error: 'Owner access required' });
    return null;
  }
  if (csrf) {
    const supplied = String(req.headers['x-csrf-token'] || '');
    const expected = String(session.csrfToken || '');
    if (!validOrigin(req) || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      json(res, 403, { ok: false, error: 'Request verification failed' });
      return null;
    }
  }
  return session;
}

async function readJson(req, maxBytes = MAX_JSON_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function clientKey(req, username = '') {
  const forwarded = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
  return crypto.createHash('sha256').update(`${forwarded}|${String(username).toLowerCase()}`).digest('hex');
}

function loginAllowed(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.startedAt > LOGIN_WINDOW_MS) return true;
  return entry.count < LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.startedAt > LOGIN_WINDOW_MS) loginAttempts.set(key, { startedAt: Date.now(), count: 1 });
  else entry.count += 1;
}

function parseExpectedRevision(req, body) {
  const header = String(req.headers['if-match'] || '').replace(/^W\//, '').replaceAll('"', '');
  if (header) {
    const match = /^rev-(\d+)$/.exec(header);
    if (!match) throw new Error('Invalid If-Match revision');
    return Number(match[1]);
  }
  return Number.isInteger(body.expectedRevision) ? body.expectedRevision : null;
}

function publicSession(session) {
  return { ok: true, authenticated: true, user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith('/api/v1/admin')) {
    return json(res, 404, { ok: false, error: 'API route not found' });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/session') {
    const session = sessionFor(req);
    if (!session) return json(res, 200, { ok: true, authenticated: false });
    return json(res, 200, publicSession(session));
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
    if (!validOrigin(req)) return json(res, 403, { ok: false, error: 'Invalid origin' });
    const body = await readJson(req, 16 * 1024);
    const key = clientKey(req, body.username);
    if (!loginAllowed(key)) return json(res, 429, { ok: false, error: 'Too many login attempts; try again later' });
    const user = await store.authenticate(body.username, body.password);
    if (!user) {
      recordLoginFailure(key);
      return json(res, 401, { ok: false, error: 'Invalid username or password' });
    }
    loginAttempts.delete(key);
    const created = store.createSession(user.id);
    setSessionCookie(res, created.token);
    return json(res, 200, publicSession({ ...created, user }));
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    const session = requireSession(req, res, { csrf: true });
    if (!session) return;
    store.revokeSessionHash(session.tokenHash, session.user.id);
    setSessionCookie(res, '', 0);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/auth/change-password') {
    const session = requireSession(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req, 16 * 1024);
    await store.changePassword(session.user.id, body.currentPassword, body.newPassword);
    setSessionCookie(res, '', 0);
    return json(res, 200, { ok: true, reloginRequired: true });
  }

  if (url.pathname === '/api/v1/saves' && req.method === 'GET') {
    const session = requireSession(req, res, { ready: true });
    if (!session) return;
    return json(res, 200, { ok: true, saves: store.listSaves(session.user.id) });
  }

  const saveMatch = /^\/api\/v1\/saves\/([^/]+)$/.exec(url.pathname);
  if (saveMatch && req.method === 'GET') {
    const session = requireSession(req, res, { ready: true });
    if (!session) return;
    const record = store.getSave(session.user.id, decodeURIComponent(saveMatch[1]));
    if (!record) return json(res, 404, { ok: false, error: 'No save in this slot' });
    return json(res, 200, { ok: true, save: record }, { etag: `"rev-${record.revision}"` });
  }
  if (saveMatch && req.method === 'PUT') {
    const session = requireSession(req, res, { ready: true, csrf: true });
    if (!session) return;
    const body = await readJson(req);
    const expectedRevision = parseExpectedRevision(req, body);
    try {
      const record = store.putSave(session.user.id, decodeURIComponent(saveMatch[1]), body.envelope, expectedRevision);
      return json(res, 200, { ok: true, save: { ...record, envelope: undefined } }, { etag: `"rev-${record.revision}"` });
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT') {
        return json(res, 409, { ok: false, error: error.message, currentRevision: error.currentRevision });
      }
      throw error;
    }
  }
  if (saveMatch && req.method === 'DELETE') {
    const session = requireSession(req, res, { ready: true, csrf: true });
    if (!session) return;
    const deleted = store.deleteSave(session.user.id, decodeURIComponent(saveMatch[1]));
    return json(res, 200, { ok: true, deleted });
  }

  if (url.pathname === '/api/v1/admin/users' && req.method === 'GET') {
    const session = requireSession(req, res, { ready: true, owner: true });
    if (!session) return;
    return json(res, 200, { ok: true, users: store.listUsers() });
  }
  if (url.pathname === '/api/v1/admin/users' && req.method === 'POST') {
    const session = requireSession(req, res, { ready: true, owner: true, csrf: true });
    if (!session) return;
    const body = await readJson(req, 32 * 1024);
    const temporaryPassword = generateTemporaryPassword();
    const user = await store.createUser({
      username: body.username,
      displayName: body.displayName,
      password: temporaryPassword,
      role: 'player',
      mustChangePassword: true,
      actorUserId: session.user.id,
    });
    return json(res, 201, { ok: true, user, temporaryPassword });
  }

  const statusMatch = /^\/api\/v1\/admin\/users\/([^/]+)\/status$/.exec(url.pathname);
  if (statusMatch && req.method === 'PATCH') {
    const session = requireSession(req, res, { ready: true, owner: true, csrf: true });
    if (!session) return;
    const body = await readJson(req, 8 * 1024);
    const user = store.setUserStatus(decodeURIComponent(statusMatch[1]), body.status, session.user.id);
    return json(res, 200, { ok: true, user });
  }

  const resetMatch = /^\/api\/v1\/admin\/users\/([^/]+)\/reset-password$/.exec(url.pathname);
  if (resetMatch && req.method === 'POST') {
    const session = requireSession(req, res, { ready: true, owner: true, csrf: true });
    if (!session) return;
    const temporaryPassword = generateTemporaryPassword();
    const user = await store.resetPassword(decodeURIComponent(resetMatch[1]), temporaryPassword, session.user.id);
    return json(res, 200, { ok: true, user, temporaryPassword });
  }

  const revokeMatch = /^\/api\/v1\/admin\/users\/([^/]+)\/revoke-sessions$/.exec(url.pathname);
  if (revokeMatch && req.method === 'POST') {
    const session = requireSession(req, res, { ready: true, owner: true, csrf: true });
    if (!session) return;
    const userId = decodeURIComponent(revokeMatch[1]);
    const revoked = store.revokeUserSessions(userId, session.user.id);
    return json(res, 200, { ok: true, revoked });
  }

  if (url.pathname === '/api/v1/admin/legacy-pilots' && req.method === 'GET') {
    const session = requireSession(req, res, { ready: true, owner: true });
    if (!session) return;
    return json(res, 200, { ok: true, pilots: store.listLegacyPilots() });
  }
  const legacyClaimMatch = /^\/api\/v1\/admin\/legacy-pilots\/([^/]+)\/claim$/.exec(url.pathname);
  if (legacyClaimMatch && req.method === 'POST') {
    const session = requireSession(req, res, { ready: true, owner: true, csrf: true });
    if (!session) return;
    const body = await readJson(req, 8 * 1024);
    const pilot = store.claimLegacyPilot(decodeURIComponent(legacyClaimMatch[1]), body.userId, session.user.id);
    return json(res, 200, { ok: true, pilot });
  }

  return json(res, 404, { ok: false, error: 'API route not found' });
}

function adminActor(identity) {
  return `access:${identity.email || identity.sub}`.slice(0, 180);
}

function adminRequestId(req) {
  return String(req.headers['cf-ray'] || req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 120);
}

async function adminMutation(req, res, identity, { action, resource, targetUserId = null }, operation) {
  const requestId = adminRequestId(req);
  ACCESS_AUTH.verifyMutation(req, identity);
  try {
    const result = await operation(adminActor(identity));
    store.audit(`admin.${action}`, {
      actorUserId: adminActor(identity), targetUserId,
      detail: { result: 'success', requestId, resource },
    });
    return json(res, result.status || 200, { ok: true, requestId, ...result.payload });
  } catch (error) {
    store.audit(`admin.${action}`, {
      actorUserId: adminActor(identity), targetUserId,
      detail: { result: 'failure', requestId, resource, error: String(error.message || error).slice(0, 240) },
    });
    throw error;
  }
}

async function handleAdminApi(req, res, url, identity) {
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/session') {
    return json(res, 200, {
      ok: true,
      identity: { sub: identity.sub, email: identity.email },
      capabilities: [
        'operations:read', 'analytics:read', 'players:read', 'players:write',
        'sessions:read', 'sessions:write', 'saves:read', 'backups:read',
        'releases:read', 'releases:write', 'audit:read', 'multiplayer:read', 'multiplayer:write',
      ],
      csrfToken: ACCESS_AUTH.csrfFor(identity),
      expiresAt: identity.expiresAt,
      playOrigin: PUBLIC_ORIGIN,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/overview') {
    const multiplayer = await fetchCoopHealth();
    return json(res, 200, {
      ok: true, gateway: { ok: true }, multiplayer, liveRelayCount: liveSockets.size,
      releaseId: process.env.GS_RELEASE_ID || null,
      ...store.adminOverviewCounts(),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/operations') {
    return json(res, 200, { ok: true, operations: operationsState() });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/telemetry') {
    const requestedPeriod = url.searchParams.get('period');
    if (requestedPeriod && !['24h', '7d', '30d'].includes(requestedPeriod)) throw new Error('Telemetry period must be 24h, 7d, or 30d');
    const period = requestedPeriod || '24h';
    return json(res, 200, { ok: true, period, points: telemetrySeries(period) });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/multiplayer') {
    return json(res, 200, { ok: true, health: await fetchCoopHealth(), live: liveMultiplayerRows() });
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/multiplayer/notice') {
    return adminMutation(req, res, identity, { action: 'multiplayer.notice', resource: 'multiplayer' }, async () => {
      const body = await readJson(req, 8 * 1024);
      const message = String(body.message || '').trim().replace(/\s+/g, ' ').slice(0, 180);
      if (message.length < 3) throw new Error('Maintenance notice must be at least 3 characters');
      let delivered = 0;
      for (const socket of liveSockets) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        socket.send(JSON.stringify({ type: 'adminNotice', notice: `Owner notice: ${message}` }));
        delivered += 1;
      }
      return { payload: { delivered, message } };
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/users') {
    return json(res, 200, { ok: true, users: store.listUsers() });
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/users') {
    return adminMutation(req, res, identity, { action: 'player.create', resource: 'player' }, async (actor) => {
      const body = await readJson(req, 32 * 1024);
      const temporaryPassword = generateTemporaryPassword();
      const user = await store.createUser({ username: body.username, displayName: body.displayName, password: temporaryPassword, role: 'player', mustChangePassword: true, actorUserId: actor });
      return { status: 201, payload: { user, temporaryPassword } };
    });
  }
  const statusMatch = /^\/api\/v1\/admin\/users\/([^/]+)\/status$/.exec(url.pathname);
  if (statusMatch && req.method === 'PATCH') {
    const userId = decodeURIComponent(statusMatch[1]);
    return adminMutation(req, res, identity, { action: 'player.status', resource: `player:${userId}`, targetUserId: userId }, async (actor) => {
      const body = await readJson(req, 8 * 1024);
      return { payload: { user: store.setUserStatus(userId, body.status, actor) } };
    });
  }
  const resetMatch = /^\/api\/v1\/admin\/users\/([^/]+)\/reset-password$/.exec(url.pathname);
  if (resetMatch && req.method === 'POST') {
    const userId = decodeURIComponent(resetMatch[1]);
    return adminMutation(req, res, identity, { action: 'player.reset_password', resource: `player:${userId}`, targetUserId: userId }, async (actor) => {
      const temporaryPassword = generateTemporaryPassword();
      const user = await store.resetPassword(userId, temporaryPassword, actor);
      return { payload: { user, temporaryPassword } };
    });
  }
  const revokeMatch = /^\/api\/v1\/admin\/users\/([^/]+)\/revoke-sessions$/.exec(url.pathname);
  if (revokeMatch && req.method === 'POST') {
    const userId = decodeURIComponent(revokeMatch[1]);
    return adminMutation(req, res, identity, { action: 'player.revoke_sessions', resource: `player:${userId}`, targetUserId: userId }, async (actor) => ({ payload: { revoked: store.revokeUserSessions(userId, actor) } }));
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/sessions') return json(res, 200, { ok: true, sessions: store.listActiveSessions() });
  const sessionMatch = /^\/api\/v1\/admin\/sessions\/([a-f0-9]{12})$/.exec(url.pathname);
  if (sessionMatch && req.method === 'DELETE') {
    const sessionId = sessionMatch[1];
    return adminMutation(req, res, identity, { action: 'session.revoke', resource: `session:${sessionId}` }, async (actor) => ({ payload: store.revokeSessionPrefix(sessionId, actor) }));
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/saves') return json(res, 200, { ok: true, saves: store.listAllSaveSummaries({ limit: 200 }) });
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/backups') return json(res, 200, { ok: true, backups: listBackupMetadata() });
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/audit') return json(res, 200, { ok: true, events: store.listAuditEvents(Number(url.searchParams.get('limit') || 100)) });
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/releases') {
    return json(res, 200, {
      ok: true,
      game: releaseInventory(GAME_RELEASES_DIR, GAME_CURRENT_LINK, 'game'),
      site: releaseInventory(SITE_RELEASES_DIR, SITE_CURRENT_LINK, 'site'),
      rollbackAvailable: fs.existsSync(ADMIN_OPS_SOCKET),
    });
  }
  const rollbackMatch = /^\/api\/v1\/admin\/releases\/(game|site)\/([A-Za-z0-9][A-Za-z0-9._-]{5,79})\/rollback$/.exec(url.pathname);
  if (rollbackMatch && req.method === 'POST') {
    const [, surface, releaseId] = rollbackMatch;
    return adminMutation(req, res, identity, { action: 'release.rollback', resource: `${surface}-release:${releaseId}` }, async () => {
      const body = await readJson(req, 8 * 1024);
      if (body.confirmation !== releaseId) throw new Error('Typed confirmation does not match the release ID');
      const result = await adminOpsRequest({ operation: 'rollback', surface, releaseId, requestId: adminRequestId(req) });
      return { payload: { surface, releaseId, health: result.health } };
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/legacy-pilots') return json(res, 200, { ok: true, pilots: store.listLegacyPilots() });
  const legacyMatch = /^\/api\/v1\/admin\/legacy-pilots\/([^/]+)\/claim$/.exec(url.pathname);
  if (legacyMatch && req.method === 'POST') {
    const pilotId = decodeURIComponent(legacyMatch[1]);
    return adminMutation(req, res, identity, { action: 'legacy_pilot.claim', resource: `legacy-pilot:${pilotId}` }, async (actor) => {
      const body = await readJson(req, 8 * 1024);
      return { payload: { pilot: store.claimLegacyPilot(pilotId, body.userId, actor) } };
    });
  }
  const kickMatch = /^\/api\/v1\/admin\/multiplayer\/([^/]+)\/kick$/.exec(url.pathname);
  if (kickMatch && req.method === 'POST') {
    const userId = decodeURIComponent(kickMatch[1]);
    return adminMutation(req, res, identity, { action: 'multiplayer.kick', resource: `player:${userId}`, targetUserId: userId }, async () => {
      let closed = 0;
      for (const socket of liveSockets) if (socket.gsUser?.id === userId) { socket.close(4001, 'Removed by administrator'); closed += 1; }
      return { payload: { closed } };
    });
  }
  return json(res, 404, { ok: false, error: 'Admin API route not found' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, url, rootDir = DIST_DIR) {
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const relative = requested.replace(/^\/+/, '');
  let target = path.resolve(rootDir, relative);
  if (!target.startsWith(`${rootDir}${path.sep}`) && target !== rootDir) return json(res, 400, { ok: false, error: 'Invalid path' });
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (req.method === 'GET' && !path.extname(relative)) target = path.join(rootDir, 'index.html');
    else return json(res, 404, { ok: false, error: 'Not found' });
  }
  const ext = path.extname(target).toLowerCase();
  const fingerprinted = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\./.test(target);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': fingerprinted ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  if (redirectForwardedHttp(req, res)) return;
  const url = new URL(req.url || '/', PUBLIC_ORIGIN);
  try {
    if (isAdminHost(req)) {
      const identity = await ACCESS_AUTH.authenticate(req);
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'galactic-sovereign-admin' });
      if (url.pathname.startsWith('/api/v1/admin')) return await handleAdminApi(req, res, url, identity);
      if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'API route not found' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { ok: false, error: 'Method not allowed' });
      return serveStatic(req, res, url, ADMIN_DIST_DIR);
    }
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/v1/admin')) {
      return json(res, 404, { ok: false, error: 'Not found' });
    }
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'galactic-sovereign' });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { ok: false, error: 'Method not allowed' });
    return serveStatic(req, res, url);
  } catch (error) {
    const status = Number(error.statusCode) || 400;
    console.error('[app] request failed', { path: url.pathname, status, error: String(error.message || error) });
    return json(res, status, { ok: false, error: status >= 500 ? 'Internal server error' : String(error.message || error) });
  }
});

const relayServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  if (PUBLIC_ORIGIN.startsWith('https://') && forwardedProtocol(req) === 'http') {
    socket.write(`HTTP/1.1 308 Permanent Redirect\r\nLocation: ${new URL(req.url || '/', PUBLIC_ORIGIN)}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return socket.destroy();
  }
  const url = new URL(req.url || '/', PUBLIC_ORIGIN);
  if (url.pathname !== '/ws/multiplayer') return rejectUpgrade(socket, 404, 'Not Found');
  if (!validOrigin(req)) return rejectUpgrade(socket, 403, 'Forbidden');
  const session = sessionFor(req, { touch: false });
  if (!session || session.user.mustChangePassword) return rejectUpgrade(socket, 401, 'Unauthorized');
  if (!GATEWAY_SECRET) return rejectUpgrade(socket, 503, 'Gateway Not Configured');
  relayServer.handleUpgrade(req, socket, head, (client) => {
    client.gsSessionHash = session.tokenHash;
    client.gsUser = session.user;
    relayServer.emit('connection', client, req);
  });
});

relayServer.on('connection', (client) => {
  client.gsConnectedAt = Date.now();
  client.gsLastActivityAt = client.gsConnectedAt;
  liveSockets.add(client);
  const pending = [];
  let pendingBytes = 0;
  const legacyPilot = store.claimedPilotForUser(client.gsUser.id);
  const upstream = new WebSocket(COOP_URL, {
    maxPayload: 8 * 1024 * 1024,
    headers: {
      'x-gs-gateway-secret': GATEWAY_SECRET,
      'x-gs-user-id': encodeURIComponent(legacyPilot?.pilotId ?? client.gsUser.id),
      'x-gs-account-id': client.gsUser.id,
      'x-gs-display-name': encodeURIComponent(legacyPilot?.displayName ?? client.gsUser.displayName),
    },
  });

  client.on('message', (data, binary) => {
    client.gsLastActivityAt = Date.now();
    if (data.length > 256 * 1024) return client.close(1009, 'Message too large');
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
    else if (pendingBytes + data.length <= 512 * 1024) {
      pending.push([data, binary]);
      pendingBytes += data.length;
    } else client.close(1013, 'Upstream unavailable');
  });
  upstream.on('open', () => {
    for (const [data, binary] of pending) upstream.send(data, { binary });
    pending.length = 0;
  });
  upstream.on('message', (data, binary) => {
    client.gsLastActivityAt = Date.now();
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  upstream.on('close', (code, reason) => {
    if (client.readyState === WebSocket.OPEN) client.close(code || 1011, reason.toString().slice(0, 120));
  });
  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'Multiplayer unavailable');
  });
  client.on('close', () => {
    liveSockets.delete(client);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
});

const sessionAuditTimer = setInterval(() => {
  for (const socket of liveSockets) {
    if (!store.db.prepare(`
      SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' AND u.must_change_password=0
    `).get(socket.gsSessionHash, Date.now())) socket.close(4003, 'Session revoked');
  }
}, 5_000);
sessionAuditTimer.unref();

server.listen(PORT, HOST, () => {
  console.log(`[app] listening on http://${HOST}:${PORT}`);
  console.log(`[app] public origin ${PUBLIC_ORIGIN}`);
  console.log(`[app] data ${DATA_DIR}`);
});

function shutdown(signal) {
  console.log(`[app] ${signal} — closing`);
  clearInterval(sessionAuditTimer);
  for (const socket of liveSockets) socket.close(1001, 'Server shutdown');
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
