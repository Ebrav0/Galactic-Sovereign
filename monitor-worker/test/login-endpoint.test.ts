import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../src/index';

const secret = 'test-only-login-notification-secret-123456789';

function createEnv() {
  const values = new Map<string, string>();
  const sent: unknown[] = [];
  return {
    sent,
    env: {
      LOGIN_NOTIFICATION_SECRET: secret,
      MONITOR_HOST: 'monitor.example.test',
      MOBILE_HOST: 'mobile.example.test',
      LOCAL_DEV_BYPASS: '0',
      ALERT_TO: 'owner@example.test',
      ALERT_FROM: 'alerts@example.test',
      ALERT_EMAIL: { async send(message: unknown) { sent.push(message); } },
      HEALTH: {
        async get(key: string) { return values.get(key) ?? null; },
        async put(key: string, value: string) { values.set(key, value); },
        async delete(key: string) { values.delete(key); },
      },
    } as unknown as Env,
  };
}

function loginRequest(overrides: Record<string, unknown> = {}, signatureSecret = secret) {
  const body = JSON.stringify({
    version: 1,
    type: 'user.login',
    eventId: '4eaa42d1-1597-46c8-a03c-67e6a87127fa',
    timestamp: Math.floor(Date.now() / 1_000),
    user: { id: 'user-1', username: 'pilot', displayName: 'Pilot One', role: 'player' },
    ...overrides,
  });
  const signature = crypto.createHmac('sha256', signatureSecret).update(body).digest('hex');
  return new Request('https://monitor.example.test/events/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gs-signature': signature },
    body,
  });
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const fetchWorker = worker.fetch as unknown as (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response>;

test('login endpoint authenticates, emails once, and deduplicates a retry', async () => {
  const { env, sent } = createEnv();
  const first = await fetchWorker(loginRequest(), env, ctx);
  const duplicate = await fetchWorker(loginRequest(), env, ctx);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
  assert.equal(sent.length, 1);
});

test('login endpoint emails solo and multiplayer activity events', async () => {
  const { env, sent } = createEnv();
  const solo = await fetchWorker(loginRequest({
    type: 'solo.enter',
    eventId: '5eaa42d1-1597-46c8-a03c-67e6a87127fa',
    context: { mode: 'solo', reason: 'new_game' },
  }), env, ctx);
  const multiplayer = await fetchWorker(loginRequest({
    type: 'multiplayer.join',
    eventId: '6eaa42d1-1597-46c8-a03c-67e6a87127fa',
    context: { mode: 'multiplayer' },
  }), env, ctx);
  assert.equal(solo.status, 200);
  assert.equal(multiplayer.status, 200);
  assert.equal(sent.length, 2);
  assert.match(String((sent[0] as { subject?: string }).subject), /^SOLO:/);
  assert.match(String((sent[1] as { subject?: string }).subject), /^MULTIPLAYER:/);
});

test('login endpoint rejects an invalid signature without sending', async () => {
  const { env, sent } = createEnv();
  const response = await fetchWorker(loginRequest({}, `${secret}-wrong`), env, ctx);
  assert.equal(response.status, 403);
  assert.equal(sent.length, 0);
});
