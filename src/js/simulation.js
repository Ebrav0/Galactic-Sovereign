// Fixed-timestep tick driver (IMPLEMENTATION_PLAN §1).
// Advances state.time in whole TICK_MS steps; delegates per-tick work.

import { TICK_MS } from './constants.js';
import { applyIncomeTick } from './economy.js';
import { tickFlagship } from './flagship.js';

function tick(state) {
  state.time += TICK_MS;
  applyIncomeTick(state);
  tickFlagship(state);
}

// Consume accumulated wall-clock ms into whole ticks. Returns leftover ms.
// No-op while paused (the leftover is discarded so unpausing doesn't jump).
export function step(state, accumulatedMs) {
  if (state.paused) return 0;
  let remaining = accumulatedMs;
  while (remaining >= TICK_MS) {
    tick(state);
    remaining -= TICK_MS;
  }
  return remaining;
}

// Deterministic advancement for tests: exactly floor(ms / TICK_MS) ticks.
export function advance(state, ms) {
  if (state.paused) return;
  const ticks = Math.floor(ms / TICK_MS);
  for (let i = 0; i < ticks; i++) tick(state);
}

export function setPaused(state, paused) {
  state.paused = paused;
}

export function togglePaused(state) {
  state.paused = !state.paused;
  return state.paused;
}
