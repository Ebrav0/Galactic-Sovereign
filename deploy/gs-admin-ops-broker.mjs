#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SOCKET_PATH = process.env.GS_ADMIN_OPS_SOCKET || '/run/galactic-sovereign/admin-ops.sock';
const GAME_RELEASES = '/opt/galactic-sovereign/releases';
const SITE_RELEASES = '/opt/galactic-sovereign/site-releases';
const GAME_CURRENT = '/opt/galactic-sovereign/current';
const SITE_CURRENT = '/opt/galactic-sovereign/site-current';
const MAX_REQUEST = 16 * 1024;

function validReleaseId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$/.test(String(value || ''));
}

function surfaceConfig(surface) {
  if (surface === 'game') return {
    root: GAME_RELEASES,
    current: GAME_CURRENT,
    required: ['package.json', 'server/app-host.mjs'],
    units: ['galactic-sovereign-coop.service', 'galactic-sovereign-gateway.service'],
    health: ['http://127.0.0.1:8080/healthz', 'http://127.0.0.1:9090/health'],
  };
  if (surface === 'site') return {
    root: SITE_RELEASES,
    current: SITE_CURRENT,
    required: ['server.mjs', 'dist/client/index.html'],
    units: ['galactic-sovereign-site.service'],
    health: ['http://127.0.0.1:8081/healthz'],
  };
  throw new Error('Invalid release surface');
}

function targetRelease(config, releaseId) {
  if (!validReleaseId(releaseId)) throw new Error('Invalid release ID');
  const target = path.join(config.root, releaseId);
  const resolvedRoot = fs.realpathSync(config.root);
  const resolvedTarget = fs.realpathSync(target);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Release is outside the approved directory');
  for (const required of config.required) {
    if (!fs.statSync(path.join(resolvedTarget, required)).isFile()) throw new Error('Release is incomplete');
  }
  return resolvedTarget;
}

function switchCurrent(link, target) {
  const temporary = `${link}.admin-${process.pid}-${Date.now()}`;
  try {
    fs.symlinkSync(target, temporary);
    fs.renameSync(temporary, link);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* already renamed */ }
  }
}

async function restartUnits(units) {
  await execFileAsync('/usr/bin/systemctl', ['restart', ...units], { timeout: 60_000, maxBuffer: 64 * 1024 });
}

async function backup() {
  await execFileAsync('/usr/local/sbin/gsctl', ['backup'], { timeout: 180_000, maxBuffer: 128 * 1024 });
}

async function healthCheck(urls) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const results = await Promise.all(urls.map(async (url) => {
      try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
    }));
    if (results.every(Boolean)) return { ok: true, checked: urls };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Release health validation failed');
}

async function rollback(surface, releaseId) {
  const config = surfaceConfig(surface);
  const target = targetRelease(config, releaseId);
  const original = fs.realpathSync(config.current);
  if (target === original) throw new Error('That release is already active');
  await backup();
  switchCurrent(config.current, target);
  try {
    await restartUnits(config.units);
    return await healthCheck(config.health);
  } catch (error) {
    switchCurrent(config.current, original);
    await restartUnits(config.units);
    await healthCheck(config.health);
    throw error;
  }
}

async function dispatch(request) {
  if (request?.operation !== 'rollback') throw new Error('Operation is not allowed');
  return { ok: true, health: await rollback(request.surface, request.releaseId) };
}

fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true, mode: 0o750 });
try { fs.unlinkSync(SOCKET_PATH); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const server = net.createServer((socket) => {
  let raw = '';
  let handled = false;
  socket.setEncoding('utf8');
  socket.setTimeout(160_000, () => socket.destroy());
  socket.on('data', (chunk) => {
    if (handled) return;
    raw += chunk;
    if (raw.length > MAX_REQUEST) {
      handled = true;
      socket.end(JSON.stringify({ ok: false, statusCode: 413, error: 'Request is too large' }));
    }
  });
  socket.on('end', async () => {
    if (handled) return;
    handled = true;
    try {
      const request = JSON.parse(raw.trim());
      socket.end(JSON.stringify(await dispatch(request)));
    } catch (error) {
      socket.end(JSON.stringify({ ok: false, statusCode: 409, error: String(error.message || error).slice(0, 240) }));
    }
  });
});

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`[admin-ops] listening on ${SOCKET_PATH}`);
});

function shutdown() {
  server.close(() => {
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* already removed */ }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
