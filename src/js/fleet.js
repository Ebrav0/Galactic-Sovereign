// Combat ship lane transit (Phase 2).

import {
  SHIP_LANE_SPEED,
  SHIP_LANE_MIN_LEG_MS,
} from './constants.js';
import { findPath, nodeById } from './galaxy.js';
import { findShip } from './ships.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  transitEtaMs,
  advanceTransit,
} from './transit.js';
import { tryEngageOnArrival } from './combat.js';

export function shipStatus(ship, galaxy, time) {
  return transitStatusCore(
    ship.transit,
    galaxy,
    time,
    SHIP_LANE_SPEED,
    SHIP_LANE_MIN_LEG_MS,
  );
}

export function shipEtaMs(state, ship) {
  return transitEtaMs(
    ship.transit,
    state.galaxy,
    state.time,
    SHIP_LANE_SPEED,
    SHIP_LANE_MIN_LEG_MS,
  );
}

export function orderShipTravel(state, shipId, targetId) {
  const ship = findShip(state, shipId);
  if (!ship) return { ok: false, reason: 'No such ship' };
  if (ship.hp <= 0) return { ok: false, reason: 'Ship destroyed' };
  if (ship.transit) return { ok: false, reason: 'Ship is already in transit' };
  if (!nodeById(state.galaxy, targetId)) return { ok: false, reason: 'No such star' };
  if (targetId === ship.systemId) return { ok: false, reason: 'Ship is already at that star' };

  const path = findPath(state.galaxy, ship.systemId, targetId);
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  ship.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: legDurationMs(
      state.galaxy,
      path[0],
      path[1],
      SHIP_LANE_SPEED,
      SHIP_LANE_MIN_LEG_MS,
    ),
  };
  ship.systemId = null;
  return { ok: true, path, etaMs: shipEtaMs(state, ship) };
}

export function tickShips(state) {
  const arrivals = [];
  for (const ship of state.ships ?? []) {
    if (!ship.transit || ship.hp <= 0) continue;
    advanceTransit(
      ship.transit,
      state.galaxy,
      state.time,
      SHIP_LANE_SPEED,
      SHIP_LANE_MIN_LEG_MS,
      (destId) => {
        ship.transit = null;
        ship.systemId = destId;
        arrivals.push({ shipId: ship.id, systemId: destId });
        tryEngageOnArrival(state, destId);
      },
    );
  }
  return arrivals;
}

export function shipTransitPositions(state) {
  const out = [];
  for (const ship of state.ships ?? []) {
    if (!ship.transit || ship.hp <= 0) continue;
    const status = shipStatus(ship, state.galaxy, state.time);
    if (status) out.push({ ship, ...status });
  }
  return out;
}

export function shipsStationedAtSystem(state, systemId) {
  return (state.ships ?? []).filter((s) => s.systemId === systemId && !s.transit && s.hp > 0);
}
