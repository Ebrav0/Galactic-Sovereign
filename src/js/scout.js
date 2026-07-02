// Scout ships: lane transit + intel gathering (GDD §9).

import {
  SCOUT_LANE_SPEED,
  SCOUT_LANE_MIN_LEG_MS,
} from './constants.js';
import { findPath, nodeById } from './galaxy.js';
import { systemById } from './state.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  transitEtaMs,
  advanceTransit,
} from './transit.js';
import { gatherIntel } from './intel.js';

let nextScoutId = 1;

export function resetScoutIds(state) {
  let max = 0;
  for (const scout of state.scouts) {
    const n = parseInt(scout.id.replace('scout-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextScoutId = max + 1;
}

export function spawnScout(state, systemId) {
  const scout = { id: `scout-${nextScoutId++}`, systemId, transit: null };
  state.scouts.push(scout);
  return scout;
}

export function findScout(state, scoutId) {
  return state.scouts.find((s) => s.id === scoutId) ?? null;
}

export function idleScouts(state) {
  return state.scouts.filter((s) => !s.transit);
}

export function scoutsAtSystem(state, systemId) {
  return state.scouts.filter((s) => s.systemId === systemId && !s.transit);
}

export function scoutStatus(scout, galaxy, time) {
  return transitStatusCore(
    scout.transit,
    galaxy,
    time,
    SCOUT_LANE_SPEED,
    SCOUT_LANE_MIN_LEG_MS,
  );
}

export function scoutEtaMs(state, scout) {
  return transitEtaMs(
    scout.transit,
    state.galaxy,
    state.time,
    SCOUT_LANE_SPEED,
    SCOUT_LANE_MIN_LEG_MS,
  );
}

// Returns {ok, path, etaMs} or {ok:false, reason}.
export function orderScoutTravel(state, scoutId, targetId) {
  const scout = findScout(state, scoutId);
  if (!scout) return { ok: false, reason: 'No such scout' };
  if (scout.transit) return { ok: false, reason: 'Scout is already in transit' };
  if (!nodeById(state.galaxy, targetId)) return { ok: false, reason: 'No such star' };
  if (targetId === scout.systemId) return { ok: false, reason: 'Scout is already at that star' };

  const path = findPath(state.galaxy, scout.systemId, targetId);
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  scout.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: legDurationMs(
      state.galaxy,
      path[0],
      path[1],
      SCOUT_LANE_SPEED,
      SCOUT_LANE_MIN_LEG_MS,
    ),
  };
  scout.systemId = null;
  return { ok: true, path, etaMs: scoutEtaMs(state, scout) };
}

export function tickScouts(state) {
  const arrivals = [];
  for (const scout of state.scouts) {
    if (!scout.transit) continue;
    advanceTransit(
      scout.transit,
      state.galaxy,
      state.time,
      SCOUT_LANE_SPEED,
      SCOUT_LANE_MIN_LEG_MS,
      (destId) => {
        scout.transit = null;
        scout.systemId = destId;
        gatherIntel(state, destId);
        arrivals.push({ scoutId: scout.id, systemId: destId });
      },
    );
  }
  return arrivals;
}

// Galaxy-map position for rendering; null when stationed (draw at star instead).
export function scoutTransitPositions(state) {
  const out = [];
  for (const scout of state.scouts) {
    if (!scout.transit) continue;
    const status = scoutStatus(scout, state.galaxy, state.time);
    if (status) out.push({ scout, ...status });
  }
  return out;
}
