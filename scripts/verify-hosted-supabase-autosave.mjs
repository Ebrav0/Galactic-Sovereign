#!/usr/bin/env node
/**
 * Prove hosted New Game autosaves land in Supabase (not CT SQLite).
 *
 * Requires:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Flow mirrors production:
 *   login → PUT /api/v1/saves/autosave → GET autosave → revisioned follow-up save
 * then asserts SQLite save_slots stays empty while Supabase holds the envelope.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

import { AuthStore } from '../server/auth-store.mjs';
import { SupabaseSaveStore } from '../server/supabase-saves.mjs';
import { createNewGame } from '../src/js/state.js';
import { deserialize, serialize } from '../src/js/save.js';

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run this verifier.');
  process.exit(2);
}

const APP_PORT = 19_380 + Math.floor(Math.random() * 100);
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-hosted-supabase-autosave-'));
const accountDir = path.join(root, 'accounts');
const distDir = path.join(root, 'dist');
const gatewaySecret = 'test-only-gateway-secret-supabase-autosave';
const children = [];
const remote = new SupabaseSaveStore({ url, serviceRoleKey });
const testMarker = `autosave-test-${Date.now()}`;

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

async function waitForHttp(healthUrl, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch { /* retry */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${healthUrl}`);
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
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function sqliteSaveCount() {
  const dbPath = path.join(accountDir, 'accounts.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM save_slots').get().count || 0);
  } finally {
    db.close();
  }
}

async function main() {
  const bootstrap = new AuthStore({ dataDir: accountDir, sessionPepper: 'test-pepper-supabase-autosave' });
  const owner = await bootstrap.createUser({
    username: 'owner',
    displayName: 'Owner',
    password: 'Owner Password 123!',
    role: 'owner',
    mustChangePassword: false,
  });
  bootstrap.close();

  launch('node', ['server/app-host.mjs'], {
    GS_APP_HOST: '127.0.0.1',
    GS_APP_PORT: String(APP_PORT),
    GS_PUBLIC_ORIGIN: ORIGIN,
    GS_COOKIE_SECURE: '0',
    GS_DATA_DIR: accountDir,
    GS_DIST_DIR: distDir,
    GS_GATEWAY_SECRET: gatewaySecret,
    GS_SESSION_PEPPER: 'test-pepper-supabase-autosave',
    // No coop needed for solo autosave path
    GS_COOP_INTERNAL_URL: 'ws://127.0.0.1:1',
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  });
  await waitForHttp(`${ORIGIN}/healthz`);

  const login = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'owner', password: 'Owner Password 123!' },
  });
  assert(login.response.status === 200, `Login failed: ${JSON.stringify(login.payload)}`);
  const session = {
    cookie: login.response.headers.get('set-cookie')?.split(';')[0],
    csrfToken: login.payload.csrfToken,
    user: login.payload.user,
  };
  assert(session.cookie && session.user?.id === owner.id, 'Login session incomplete');

  // Cleanup any prior leftover for this user from aborted runs
  await remote.deleteSave(owner.id, 'autosave').catch(() => false);

  const state = createNewGame({ seed: 4242 });
  state.meta = { ...state.meta, testMarker };
  const envelope = serialize(state);

  // New Game first autosave (same slot main.js uses)
  const first = await request('/api/v1/saves/autosave', {
    method: 'PUT',
    session,
    csrf: true,
    body: { envelope, expectedRevision: 0 },
  });
  assert(first.response.status === 200, `First autosave failed: ${JSON.stringify(first.payload)}`);
  assert(first.payload.save?.revision === 1, `Expected revision 1, got ${first.payload.save?.revision}`);
  assert(first.payload.save?.slot === 'autosave' || first.payload.save?.revision === 1, 'Autosave response missing');

  assert(sqliteSaveCount() === 0, 'CT/SQLite save_slots grew — autosave did not stay off-box');

  const remoteMeta = await remote.getSaveMeta(owner.id, 'autosave');
  assert(remoteMeta?.revision === 1, 'Supabase missing autosave metadata after first write');

  const listed = await request('/api/v1/saves', { session });
  assert(listed.response.status === 200, 'List saves failed');
  assert(
    (listed.payload.saves || []).some((row) => row.slot === 'autosave' && row.revision === 1),
    'Gateway listSaves did not report autosave from Supabase',
  );

  const loaded = await request('/api/v1/saves/autosave', { session });
  assert(loaded.response.status === 200, `Continue/GET autosave failed: ${JSON.stringify(loaded.payload)}`);
  const decoded = deserialize(loaded.payload.save.envelope);
  assert(decoded.ok, `Deserialize failed: ${decoded.error}`);
  assert(decoded.state?.meta?.testMarker === testMarker, 'Continue did not rebuild the New Game marker from Supabase');

  // Periodic autosave (correct revision)
  state.credits = (state.credits || 0) + 17;
  const secondEnvelope = serialize(state);
  const second = await request('/api/v1/saves/autosave', {
    method: 'PUT',
    session,
    csrf: true,
    body: { envelope: secondEnvelope, expectedRevision: 1 },
  });
  assert(second.response.status === 200 && second.payload.save?.revision === 2, 'Follow-up autosave failed');
  assert(sqliteSaveCount() === 0, 'SQLite gained rows after second autosave');

  const conflict = await request('/api/v1/saves/autosave', {
    method: 'PUT',
    session,
    csrf: true,
    body: { envelope: secondEnvelope, expectedRevision: 0 },
  });
  assert(conflict.response.status === 409, 'Stale autosave did not 409');

  await remote.deleteSave(owner.id, 'autosave');
  console.log('[hosted-supabase-autosave] PASS: New Game autosave → Supabase → Continue; SQLite empty');
}

try {
  await main();
} finally {
  for (const child of children) child.kill('SIGTERM');
  await delay(250);
  fs.rmSync(root, { recursive: true, force: true });
}
