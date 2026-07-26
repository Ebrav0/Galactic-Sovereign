#!/usr/bin/env node

import assert from 'node:assert/strict';

import { createCoopInputRelay } from '../src/js/coop-input-relay.js';
import { createRemotePoseBuffer, reconcilePredictedPose } from '../src/js/coop-motion.js';
import { createNewGame } from '../src/js/state.js';
import { step } from '../src/js/simulation.js';

function verifyFixedStepRemainder() {
  const state = createNewGame(424242);
  state.paused = false;
  const startTime = state.time;
  let remainingMs = 0;
  let ticksAdvanced = 0;
  for (const elapsedMs of [49, 51, 49, 51, 49, 51, 49, 51]) {
    const result = step(state, remainingMs + elapsedMs);
    remainingMs = result.remainingMs;
    ticksAdvanced += result.ticksAdvanced;
  }
  assert.equal(state.time - startTime, 400);
  assert.equal(ticksAdvanced, 8);
  assert.equal(remainingMs, 0);

  const delayed = step(state, 251);
  assert.equal(delayed.ticksAdvanced, 5);
  assert.equal(delayed.remainingMs, 1);

  state.paused = true;
  const paused = step(state, 49);
  assert.equal(paused.ticksAdvanced, 0);
  assert.equal(paused.remainingMs, 0);
}

function verifyLatestInputRelay() {
  let clock = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const sent = [];
  const schedule = (callback, delayMs) => {
    const id = nextTimerId++;
    timers.set(id, { at: clock + delayMs, callback });
    return id;
  };
  const cancel = (id) => timers.delete(id);
  const runTo = (time) => {
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > time) break;
      const [id, timer] = next;
      timers.delete(id);
      clock = timer.at;
      timer.callback();
    }
    clock = time;
  };
  const relay = createCoopInputRelay({
    minIntervalMs: 50,
    now: () => clock,
    schedule,
    cancel,
    send: (x, y) => sent.push({ at: clock, x, y }),
  });

  relay.update(1, 0);
  runTo(15);
  relay.update(1, -1);
  runTo(30);
  relay.update(0, -1);
  runTo(50);
  assert.deepEqual(sent, [
    { at: 0, x: 1, y: 0 },
    { at: 50, x: 0, y: -1 },
  ]);

  runTo(55);
  relay.update(0, 0);
  relay.update(0, 0);
  assert.deepEqual(sent.at(-1), { at: 55, x: 0, y: 0 });
  assert.equal(sent.length, 3);

  runTo(100);
  relay.update(1, 0);
  runTo(110);
  relay.update(1, 1);
  relay.reset({ preserveDesired: true });
  assert.equal(timers.size, 0);
  relay.reset({ preserveDesired: true, resendDesired: true });
  assert.deepEqual(sent.at(-1), { at: 110, x: 1, y: 1 });
}

function verifyRemoteInterpolation() {
  const buffer = createRemotePoseBuffer({
    interpolationDelayMs: 120,
    maxExtrapolationMs: 100,
  });
  buffer.push('remote', { systemId: 'sys-1', x: 0, y: 0, vx: 100, vy: 0, heading: 0 }, 1000);
  buffer.push('remote', { systemId: 'sys-1', x: 10, y: 0, vx: 100, vy: 0, heading: 0 }, 1100);

  const midway = buffer.sample('remote', 1170);
  assert.equal(midway.x, 5);
  const latest = buffer.sample('remote', 1220);
  assert.equal(latest.x, 10);
  const capped = buffer.sample('remote', 1400);
  assert.equal(capped.x, 20);
}

function verifyTimeBasedReconciliation() {
  const target = { x: 0, y: 0, vx: 0, vy: 0, heading: 0 };
  const sample = { time: 0, x: 10, y: 0, vx: 0, vy: 0, heading: 0 };
  const first = reconcilePredictedPose(target, sample, {
    renderTimeMs: 0,
    dtMs: 140,
    maxErr: 85,
  });
  assert.equal(first.hardSnapped, false);
  assert.ok(target.x > 6 && target.x < 7);

  const snap = reconcilePredictedPose(target, { ...sample, x: 1000 }, {
    renderTimeMs: 0,
    dtMs: 16,
    maxErr: 85,
  });
  assert.equal(snap.hardSnapped, true);
  assert.equal(target.x, 1000);
}

verifyFixedStepRemainder();
verifyLatestInputRelay();
verifyRemoteInterpolation();
verifyTimeBasedReconciliation();

console.log('[verify-coop-movement-core] PASS');
