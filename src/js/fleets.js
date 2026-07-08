// Player combat fleet: production spawn + lane dispatch (Phase 2.3).

import {
  SHIP_LANE_SPEED,
  SHIP_LANE_MIN_LEG_MS,
} from './constants.js';
import { createShipInstance, shipLaneSpeed, isCombatHull, captureForceForShip } from './hull.js';
import { planetPosition } from './state.js';
import { FLEET_STATION_ORBIT_PAD, FLEET_STATION_BODY_PAD } from './constants.js';
import { findPath } from './galaxy.js';
import { getGraph } from './galaxy-scope.js';
import {
  transitStatus as transitStatusCore,
  transitEtaMs,
  advanceTransit,
} from './transit.js';
import { effectiveLegDurationMs } from './strategic-structures.js';
import {
  battleGroupsForGalaxy,
  shipsInBattleGroup,
} from './battle-groups.js';
import { findHeroFlagship } from './hero-flagships.js';

let nextShipId = 1;

export function resetShipIds(state) {
  let max = 0;
  for (const ship of state.playerShips ?? []) {
    const n = parseInt(String(ship.id).replace('ship-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextShipId = max + 1;
}

export function stationedShipPose(state, system, ship, idx, total, time = state.time) {
  const starR = system.star?.radius ?? 200;
  const minOrbit = starR + FLEET_STATION_ORBIT_PAD;

  if (ship.anchorBodyId) {
    const planet = system.bodies.find((b) => b.id === ship.anchorBodyId);
    if (planet) {
      const pp = planetPosition(planet, time);
      const slotAngle = (idx / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
      const offset = planet.radius + FLEET_STATION_BODY_PAD;
      return {
        x: pp.x + Math.cos(slotAngle) * offset,
        y: pp.y + Math.sin(slotAngle) * offset,
        heading: slotAngle + Math.PI / 2,
      };
    }
  }

  const angle = (idx / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angle) * minOrbit,
    y: Math.sin(angle) * minOrbit,
    heading: angle + Math.PI / 2,
  };
}

export function spawnPlayerShip(state, systemId, hull, anchorBodyId = null) {
  const ship = {
    ...createShipInstance(`ship-${nextShipId++}`, hull, state),
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    anchorBodyId,
  };
  state.playerShips.push(ship);
  return ship;
}

export function findPlayerShip(state, shipId) {
  return state.playerShips.find((s) => s.id === shipId) ?? null;
}

export function playerShipsAtSystem(state, systemId) {
  return state.playerShips.filter(
    (s) => s.galaxyId === state.activeGalaxyId && s.systemId === systemId && !s.transit && s.hp > 0,
  );
}

export function playerCombatShipsAtSystem(state, systemId) {
  return playerShipsAtSystem(state, systemId).filter((s) => isCombatHull(s.hull));
}

export function playerShipStatus(ship, galaxy, time) {
  const speed = shipLaneSpeed(ship.hull);
  return transitStatusCore(ship.transit, galaxy, time, speed, SHIP_LANE_MIN_LEG_MS);
}

export function playerShipEtaMs(state, ship) {
  const speed = shipLaneSpeed(ship.hull);
  return transitEtaMs(ship.transit, getGraph(state), state.time, speed, SHIP_LANE_MIN_LEG_MS);
}

export function orderShipTravel(state, shipId, targetId) {
  const ship = findPlayerShip(state, shipId);
  const galaxy = getGraph(state);
  if (!ship) return { ok: false, reason: 'No such ship' };
  if (ship.galaxyId !== state.activeGalaxyId) return { ok: false, reason: 'Ship not in active galaxy' };
  if (ship.transit) return { ok: false, reason: 'Ship is already in transit' };
  if (!ship.systemId) return { ok: false, reason: 'Ship has no location' };
  if (targetId === ship.systemId) return { ok: false, reason: 'Ship is already at that star' };

  const path = findPath(galaxy, ship.systemId, targetId);
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  const speed = shipLaneSpeed(ship.hull);
  const durFn = (a, b) => effectiveLegDurationMs(state, galaxy, a, b, speed, SHIP_LANE_MIN_LEG_MS);
  ship.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: durFn(path[0], path[1]),
  };
  ship.systemId = null;
  return { ok: true, path, etaMs: playerShipEtaMs(state, ship) };
}

export function tickPlayerShips(state, onArrive) {
  const arrivals = [];
  const galaxy = getGraph(state);
  for (const ship of state.playerShips) {
    if (ship.galaxyId !== state.activeGalaxyId || !ship.transit) continue;
    const speed = shipLaneSpeed(ship.hull);
    const durFn = (a, b) => effectiveLegDurationMs(state, galaxy, a, b, speed, SHIP_LANE_MIN_LEG_MS);
    advanceTransit(
      ship.transit,
      galaxy,
      state.time,
      speed,
      SHIP_LANE_MIN_LEG_MS,
      (destId) => {
        ship.transit = null;
        ship.systemId = destId;
        arrivals.push({ shipId: ship.id, systemId: destId, hull: ship.hull });
        onArrive?.(destId, ship);
      },
      durFn,
    );
  }
  return arrivals;
}

export function playerShipTransitPositions(state) {
  const out = [];
  const galaxy = getGraph(state);
  for (const ship of state.playerShips) {
    if (ship.galaxyId !== state.activeGalaxyId || !ship.transit) continue;
    const status = playerShipStatus(ship, galaxy, state.time);
    if (status) out.push({ ship, ...status });
  }
  return out;
}

export function totalCaptureForceFromShips(state, systemId) {
  let force = 0;
  for (const ship of playerCombatShipsAtSystem(state, systemId)) {
    force += captureForceForShip(ship);
  }
  return force;
}

export function captureForceFromAnchoredGroups(state, systemId) {
  let force = 0;
  for (const group of battleGroupsForGalaxy(state)) {
    if (!group.anchorHeroId) continue;
    const hero = findHeroFlagship(state, group.anchorHeroId);
    if (!hero || hero.transit || hero.systemId !== systemId) continue;
    if (state.time < (hero.buildCompleteAt ?? 0)) continue;
    for (const ship of shipsInBattleGroup(state, group.id)) {
      if (ship.transit || ship.hp <= 0 || !isCombatHull(ship.hull)) continue;
      if (ship.systemId === systemId) continue;
      force += captureForceForShip(ship);
    }
  }
  return force;
}

export function anchoredCombatShipsAtSystem(state, systemId) {
  const out = [];
  for (const group of battleGroupsForGalaxy(state)) {
    if (!group.anchorHeroId) continue;
    const hero = findHeroFlagship(state, group.anchorHeroId);
    if (!hero || hero.transit || hero.systemId !== systemId) continue;
    if (state.time < (hero.buildCompleteAt ?? 0)) continue;
    for (const ship of shipsInBattleGroup(state, group.id)) {
      if (ship.transit || ship.hp <= 0 || !isCombatHull(ship.hull)) continue;
      if (ship.systemId !== systemId) out.push(ship);
    }
  }
  return out;
}
