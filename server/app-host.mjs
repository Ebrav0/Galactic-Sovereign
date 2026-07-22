#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

import { AuthStore, generateTemporaryPassword } from './auth-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GS_APP_PORT || 8080);
const HOST = process.env.GS_APP_HOST || '127.0.0.1';
const PUBLIC_ORIGIN = String(process.env.GS_PUBLIC_ORIGIN || `http://${HOST}:${PORT}`).replace(/\/$/, '');
const DATA_DIR = path.resolve(process.env.GS_DATA_DIR || path.join(__dirname, 'data'));
const DIST_DIR = path.resolve(process.env.GS_DIST_DIR || path.join(__dirname, '..', 'dist'));
const COOP_URL = process.env.GS_COOP_INTERNAL_URL || 'ws://127.0.0.1:9090';
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
if ((process.env.NODE_ENV === 'production' || GATEWAY_SECRET) && !SESSION_PEPPER) {
  throw new Error('Missing session-pepper credential (required in production and whenever gateway secret is configured)');
}
const store = new AuthStore({ dataDir: DATA_DIR, sessionPepper: SESSION_PEPPER });
const loginAttempts = new Map();
const liveSockets = new Set();

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
  if (!PUBLIC_ORIGIN.startsWith('https://') || forwardedProtocol(req) !== 'http') return false;
  const location = new URL(req.url || '/', PUBLIC_ORIGIN).toString();
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

function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const relative = requested.replace(/^\/+/, '');
  let target = path.resolve(DIST_DIR, relative);
  if (!target.startsWith(`${DIST_DIR}${path.sep}`) && target !== DIST_DIR) return json(res, 400, { ok: false, error: 'Invalid path' });
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (req.method === 'GET' && !path.extname(relative)) target = path.join(DIST_DIR, 'index.html');
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
