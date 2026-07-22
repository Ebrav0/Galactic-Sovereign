#!/usr/bin/env node
/**
 * Lightweight security regression checks (no long-running hosts).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { decode } from '../server/protocol.js';
import { applySharedStateDelta } from '../src/js/coop-replication.js';
import { applyCoopCommand, COOP_COMMAND_REGISTRY } from '../server/actions.mjs';
import { createNewGame } from '../src/js/state.js';

assert.equal(COOP_COMMAND_REGISTRY.has('devAction'), true);

const state = createNewGame(1);
const blocked = applyCoopCommand(state, 'devAction', { action: 'grantCredits', amount: 1 }, {
  playerId: 'pilot',
  allowDevActions: false,
});
assert.equal(blocked.ok, false, 'devAction must fail when allowDevActions=false');

assert.throws(() => decode(JSON.stringify({ type: 'explode' })), /Invalid message type/);
assert.throws(() => decode('{"type":"hello","__proto__":{"x":1}}'), /Forbidden message key/i);
assert.throws(() => decode('{"type":"ping"}' + 'x'.repeat(300_000)), /too large/i);

const polluted = { credits: 10 };
const applied = applySharedStateDelta(polluted, [
  { op: 'set', path: ['__proto__', 'polluted'], value: true },
  { op: 'set', path: ['credits'], value: 11 },
]);
assert.equal(applied, 1);
assert.equal(Object.prototype.polluted, undefined);
assert.equal(polluted.credits, 11);

const refused = spawnSync(process.execPath, ['server/coop-host.mjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    GS_COOP_HOST: '127.0.0.1',
    GS_COOP_PORT: '19091',
    GS_COOP_DATA_DIR: '/tmp/gs-security-check-coop-data',
  },
  encoding: 'utf8',
  timeout: 5000,
});
assert.notEqual(refused.status, 0, 'production coop without gateway secret must exit non-zero');
assert.match(refused.stderr + refused.stdout, /GS_GATEWAY_SECRET|gateway/i);

const refusedBind = spawnSync(process.execPath, ['server/coop-host.mjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    GS_GATEWAY_SECRET: 'test-only-not-deployed',
    GS_COOP_HOST: '0.0.0.0',
    GS_COOP_PORT: '19092',
    GS_COOP_DATA_DIR: '/tmp/gs-security-check-coop-data-2',
  },
  encoding: 'utf8',
  timeout: 5000,
});
assert.notEqual(refusedBind.status, 0, 'production coop on 0.0.0.0 must exit non-zero');
assert.match(refusedBind.stderr + refusedBind.stdout, /loopback/i);

console.log('[security-check] PASS');
