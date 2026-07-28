#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createLoginNotifier } from '../server/login-notifier.mjs';

const secret = 'test-only-login-notification-secret-123456789';
const calls = [];
let failNext = true;
const notifier = createLoginNotifier({
  endpoint: 'http://127.0.0.1/events/login',
  secret,
  production: false,
  retryDelaysMs: [0, 0],
  randomUUID: () => '4eaa42d1-1597-46c8-a03c-67e6a87127fa',
  now: () => 2_000_000_000_000,
  fetchImpl: async (_url, init) => {
    calls.push(init);
    if (failNext) {
      failNext = false;
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 200 });
  },
});

assert.equal(await notifier.notify({
  id: 'user-1', username: 'pilot', displayName: 'Pilot One', role: 'player',
}), true);
assert.equal(calls.length, 2, 'transient delivery failure was not retried');
assert.equal(calls[0].body, calls[1].body, 'retry changed the event body');
const expected = crypto.createHmac('sha256', secret).update(calls[0].body).digest('hex');
assert.equal(calls[0].headers['x-gs-signature'], expected, 'event signature mismatch');
const payload = JSON.parse(calls[0].body);
assert.equal(payload.type, 'user.login');
assert.equal(payload.user.username, 'pilot');

calls.length = 0;
assert.equal(await notifier.notify({
  id: 'user-1', username: 'pilot', displayName: 'Pilot One', role: 'player',
}, { type: 'solo.enter', context: { mode: 'solo', reason: 'new_game' } }), true);
assert.equal(JSON.parse(calls[0].body).type, 'solo.enter');
assert.equal(JSON.parse(calls[0].body).context.reason, 'new_game');

calls.length = 0;
assert.equal(await notifier.notify({
  id: 'user-1', username: 'pilot', displayName: 'Pilot One', role: 'player',
}, { type: 'multiplayer.join', context: { mode: 'multiplayer' } }), true);
assert.equal(JSON.parse(calls[0].body).type, 'multiplayer.join');

assert.throws(() => createLoginNotifier({
  endpoint: 'http://monitor.example.test/events/login',
  secret,
  production: true,
}), /HTTPS/);
assert.equal(createLoginNotifier({ secret }).enabled, false, 'secret-only upgrade state should stay disabled');
assert.throws(() => createLoginNotifier({
  endpoint: 'https://monitor.example.test/events/login',
}), /requires login-notification-secret/);

console.log('[login-notifications] PASS: signed events, stable retries, and production transport guard');
