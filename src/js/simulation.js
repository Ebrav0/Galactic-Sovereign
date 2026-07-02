// Fixed-timestep tick driver (IMPLEMENTATION_PLAN §1).
// Advances state.time in whole TICK_MS steps; delegates per-tick work.

import { TICK_MS } from './constants.js';
import { applyIncomeTick } from './economy.js';
import { tickFlagship } from './flagship.js';
import { tickProduction } from './production.js';
import { tickScouts } from './scout.js';
import { tickCapture } from './capture.js';

function tickOnce(state) {
  state.time += TICK_MS;
  applyIncomeTick(state);
  const scoutReady = tickProduction(state);
  const scoutArrivals = tickScouts(state);
  tickFlagship(state);
  const capture = tickCapture(state);
  return { scoutReady, scoutArrivals, capture };
}

// Consume accumulated wall-clock ms into whole ticks. Returns events from ticks.
export function step(state, accumulatedMs) {
  if (state.paused) return { captures: [], scoutReady: [], scoutArrivals: [] };
  let remaining = accumulatedMs;
  const captures = [];
  const scoutReady = [];
  const scoutArrivals = [];
  while (remaining >= TICK_MS) {
    const events = tickOnce(state);
    scoutReady.push(...events.scoutReady);
    scoutArrivals.push(...events.scoutArrivals);
    if (events.capture) captures.push(events.capture);
    remaining -= TICK_MS;
  }
  return { captures, scoutReady, scoutArrivals, remainingMs: remaining };
}

// Deterministic advancement for tests: exactly floor(ms / TICK_MS) ticks.
export function advance(state, ms) {
  if (state.paused) return { captures: [], scoutReady: [], scoutArrivals: [] };
  const ticks = Math.floor(ms / TICK_MS);
  const captures = [];
  const scoutReady = [];
  const scoutArrivals = [];
  for (let i = 0; i < ticks; i++) {
    const events = tickOnce(state);
    scoutReady.push(...events.scoutReady);
    scoutArrivals.push(...events.scoutArrivals);
    if (events.capture) captures.push(events.capture);
  }
  return { captures, scoutReady, scoutArrivals };
}

export function setPaused(state, paused) {
  state.paused = paused;
}

export function togglePaused(state) {
  state.paused = !state.paused;
  return state.paused;
}
