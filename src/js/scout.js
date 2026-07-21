// Scout ships: lane transit + intel gathering (GDD §9).

import {
  SCOUT_LANE_SPEED,
  SCOUT_LANE_MIN_LEG_MS,
} from './constants.js';
import { findPath, nodeById } from './galaxy.js';
import { systemById } from './state.js';
import { getGraph } from './galaxy-scope.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  transitEtaMs,
  advanceTransit,
} from './transit.js';
import { canRouteThroughSystem } from './diplomacy.js';
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

export function spawnScout(state, systemId, opts = {}) {
  const scout = {
    id: `scout-${nextScoutId++}`,
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    // Co-op: queuing pilot owns the scout; null = shared team asset.
    ownerPlayerId: opts.ownerPlayerId ?? null,
    grantedControllers: [],
  };
  state.scouts.push(scout);
  return scout;
}

export function findScout(state, scoutId) {
  return state.scouts.find((s) => s.id === scoutId) ?? null;
}

export function idleScouts(state) {
  return state.scouts.filter((s) => !s.transit && s.galaxyId === state.activeGalaxyId);
}

export function scoutsAtSystem(state, systemId) {
  return state.scouts.filter(
    (s) => s.galaxyId === state.activeGalaxyId && s.systemId === systemId && !s.transit,
  );
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
    getGraph(state),
    state.time,
    SCOUT_LANE_SPEED,
    SCOUT_LANE_MIN_LEG_MS,
  );
}

export function orderScoutTravel(state, scoutId, targetId) {
  const scout = findScout(state, scoutId);
  const galaxy = getGraph(state);
  if (!scout) return { ok: false, reason: 'No such scout' };
  if (scout.galaxyId !== state.activeGalaxyId) return { ok: false, reason: 'Scout not in active galaxy' };
  if (scout.transit) return { ok: false, reason: 'Scout is already in transit' };
  if (!nodeById(galaxy, targetId)) return { ok: false, reason: 'No such star' };
  if (targetId === scout.systemId) return { ok: false, reason: 'Scout is already at that star' };

  const path = findPath(galaxy, scout.systemId, targetId, {
    canEnter: (systemId) => canRouteThroughSystem(
      state,
      systemId,
      'player',
      { galaxyId: scout.galaxyId ?? state.activeGalaxyId, allowHostile: true },
    ).ok,
  });
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  scout.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: legDurationMs(
      galaxy,
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
  const galaxy = getGraph(state);
  for (const scout of state.scouts) {
    if (scout.galaxyId !== state.activeGalaxyId || !scout.transit) continue;
    advanceTransit(
      scout.transit,
      galaxy,
      state.time,
      SCOUT_LANE_SPEED,
      SCOUT_LANE_MIN_LEG_MS,
      (destId) => {
        scout.transit = null;
        scout.systemId = destId;
        gatherIntel(state, destId);
        arrivals.push({ scoutId: scout.id, systemId: destId });
      },
      null,
      {
        canEnter: (systemId) => canRouteThroughSystem(state, systemId, 'player', {
          galaxyId: scout.galaxyId,
          allowHostile: true,
        }).ok,
        onBlocked: (safeSystemId, blockedSystemId) => {
          scout.transit = null;
          scout.systemId = safeSystemId;
          arrivals.push({ scoutId: scout.id, systemId: safeSystemId, blocked: true, blockedSystemId });
        },
      },
    );
  }
  return arrivals;
}

export function scoutTransitPositions(state) {
  const out = [];
  const galaxy = getGraph(state);
  for (const scout of state.scouts) {
    if (scout.galaxyId !== state.activeGalaxyId || !scout.transit) continue;
    const status = scoutStatus(scout, galaxy, state.time);
    if (status) out.push({ scout, ...status });
  }
  return out;
}
