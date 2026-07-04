// Fixed-timestep tick driver (IMPLEMENTATION_PLAN §1, Phase 5 tick order).

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
import { tickTrade } from './trade.js';
import { tickResearch } from './research.js';
import { dispatchEmpireQueue } from './empire-queue.js';
import { tickAiFaction } from './ai-faction.js';
import { tickAiShips } from './ai-ships.js';
import { tickDrones } from './drones.js';

function handleArrival(state, systemId) {
  onForcesArrive(state, systemId);
}

function tickOnce(state) {
  state.time += TICK_MS;
  // Phase 5 order: abstract → wormhole → income → trade → research → dispatch → production
  // → AI faction → fleet transits → pirates → combat → dyson → capture
  tickAbstractGalaxies(state);
  const wormholeArrival = tickWormholeTransit(state);
  applyIncomeTick(state);
  tickTrade(state);
  tickResearch(state);
  dispatchEmpireQueue(state);
  const prodReady = tickProduction(state);
  const droneCompletions = tickDrones(state);
  tickAiFaction(state);
  const scoutArrivals = tickScouts(state);
  const shipArrivals = tickPlayerShips(state, (destId) => handleArrival(state, destId));
  const aiArrivals = tickAiShips(state, (destId) => handleArrival(state, destId));
  const pirateArrivals = tickPirates(state, (destId) => handleArrival(state, destId));
  if (!state.flagship.wormholeTransit) tickFlagship(state);
  const battleEvents = tickCombat(state);
  const dysonEvents = tickDyson(state);
  applySolariiTick(state);
  const capture = tickCapture(state);
  return {
    prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, battleEvents, dysonEvents, capture,
    wormholeArrival, droneCompletions,
  };
}

export function step(state, accumulatedMs) {
  if (state.paused) {
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], aiArrivals: [], pirateArrivals: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [], droneCompletions: [],
    };
  }
  let remaining = accumulatedMs;
  const captures = [];
  const prodReady = [];
  const scoutArrivals = [];
  const shipArrivals = [];
  const aiArrivals = [];
  const pirateArrivals = [];
  const battleEvents = [];
  const dysonEvents = [];
  const wormholeArrivals = [];
  const droneCompletions = [];
  while (remaining >= TICK_MS) {
    const events = tickOnce(state);
    prodReady.push(...events.prodReady);
    scoutArrivals.push(...events.scoutArrivals);
    shipArrivals.push(...events.shipArrivals);
    aiArrivals.push(...events.aiArrivals);
    pirateArrivals.push(...events.pirateArrivals);
    battleEvents.push(...events.battleEvents);
    dysonEvents.push(...events.dysonEvents);
    droneCompletions.push(...(events.droneCompletions ?? []));
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
    remaining -= TICK_MS;
  }
  return {
    captures, prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, battleEvents, dysonEvents,
    wormholeArrivals, droneCompletions, remainingMs: remaining,
  };
}

export function advance(state, ms) {
  if (state.paused) {
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], aiArrivals: [], pirateArrivals: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [], droneCompletions: [],
    };
  }
  const ticks = Math.floor(ms / TICK_MS);
  const captures = [];
  const prodReady = [];
  const scoutArrivals = [];
  const shipArrivals = [];
  const aiArrivals = [];
  const pirateArrivals = [];
  const battleEvents = [];
  const dysonEvents = [];
  const wormholeArrivals = [];
  const droneCompletions = [];
  for (let i = 0; i < ticks; i++) {
    const events = tickOnce(state);
    prodReady.push(...events.prodReady);
    scoutArrivals.push(...events.scoutArrivals);
    shipArrivals.push(...events.shipArrivals);
    aiArrivals.push(...events.aiArrivals);
    pirateArrivals.push(...events.pirateArrivals);
    battleEvents.push(...events.battleEvents);
    dysonEvents.push(...events.dysonEvents);
    droneCompletions.push(...(events.droneCompletions ?? []));
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
  }
  return {
    captures, prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, battleEvents, dysonEvents,
    wormholeArrivals, droneCompletions,
  };
}

export function setPaused(state, paused) {
  state.paused = paused;
}

export function togglePaused(state) {
  state.paused = !state.paused;
  return state.paused;
}
