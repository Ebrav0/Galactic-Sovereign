// Fixed-timestep tick driver (IMPLEMENTATION_PLAN §1).

import { TICK_MS } from './constants.js';
import { applyIncomeTick } from './economy.js';
import { tickFlagship } from './flagship.js';
import { tickProduction } from './production.js';
import { tickScouts } from './scout.js';
import { tickCapture } from './capture.js';
import { tickPlayerShips } from './fleets.js';
import { tickPirates } from './pirates.js';
import { onForcesArrive, tickCombat } from './combat.js';
import { tickDyson, applySolariiTick } from './dyson.js';
import { tickAbstractGalaxies } from './abstract-galaxy.js';
import { tickWormholeTransit } from './wormholes.js';

function handleArrival(state, systemId) {
  onForcesArrive(state, systemId);
}

function tickOnce(state) {
  state.time += TICK_MS;
  tickAbstractGalaxies(state);
  const wormholeArrival = tickWormholeTransit(state);
  applyIncomeTick(state);
  const prodReady = tickProduction(state);
  const scoutArrivals = tickScouts(state);
  const shipArrivals = tickPlayerShips(state, (destId) => handleArrival(state, destId));
  const pirateArrivals = tickPirates(state, (destId) => handleArrival(state, destId));
  if (!state.flagship.wormholeTransit) tickFlagship(state);
  const battleEvents = tickCombat(state);
  const dysonEvents = tickDyson(state);
  applySolariiTick(state);
  const capture = tickCapture(state);
  return {
    prodReady, scoutArrivals, shipArrivals, pirateArrivals, battleEvents, dysonEvents, capture,
    wormholeArrival,
  };
}

export function step(state, accumulatedMs) {
  if (state.paused) {
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], pirateArrivals: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [],
    };
  }
  let remaining = accumulatedMs;
  const captures = [];
  const prodReady = [];
  const scoutArrivals = [];
  const shipArrivals = [];
  const pirateArrivals = [];
  const battleEvents = [];
  const dysonEvents = [];
  const wormholeArrivals = [];
  while (remaining >= TICK_MS) {
    const events = tickOnce(state);
    prodReady.push(...events.prodReady);
    scoutArrivals.push(...events.scoutArrivals);
    shipArrivals.push(...events.shipArrivals);
    pirateArrivals.push(...events.pirateArrivals);
    battleEvents.push(...events.battleEvents);
    dysonEvents.push(...events.dysonEvents);
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
    remaining -= TICK_MS;
  }
  return {
    captures, prodReady, scoutArrivals, shipArrivals, pirateArrivals, battleEvents, dysonEvents,
    wormholeArrivals, remainingMs: remaining,
  };
}

export function advance(state, ms) {
  if (state.paused) {
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], pirateArrivals: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [],
    };
  }
  const ticks = Math.floor(ms / TICK_MS);
  const captures = [];
  const prodReady = [];
  const scoutArrivals = [];
  const shipArrivals = [];
  const pirateArrivals = [];
  const battleEvents = [];
  const dysonEvents = [];
  const wormholeArrivals = [];
  for (let i = 0; i < ticks; i++) {
    const events = tickOnce(state);
    prodReady.push(...events.prodReady);
    scoutArrivals.push(...events.scoutArrivals);
    shipArrivals.push(...events.shipArrivals);
    pirateArrivals.push(...events.pirateArrivals);
    battleEvents.push(...events.battleEvents);
    dysonEvents.push(...events.dysonEvents);
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
  }
  return {
    captures, prodReady, scoutArrivals, shipArrivals, pirateArrivals, battleEvents, dysonEvents,
    wormholeArrivals,
  };
}

export function setPaused(state, paused) {
  state.paused = paused;
}

export function togglePaused(state) {
  state.paused = !state.paused;
  return state.paused;
}
