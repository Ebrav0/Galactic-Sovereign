// Player combat fleet: production spawn + lane dispatch (Phase 2.3).

import {
  POST_BATTLE_RETURN_MAX_MS,
  POST_BATTLE_RETURN_MIN_MS,
  POST_BATTLE_RETURN_SPEED,
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
import { canRouteThroughSystem } from './diplomacy.js';

let nextShipId = 1;

export function resetShipIds(state) {
  let max = 0;
  for (const ship of state.playerShips ?? []) {
    const n = parseInt(String(ship.id).replace('ship-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextShipId = max + 1;
}

export function stationedOrbitPose(state, system, ship, idx, total, time = state.time) {
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

export function postBattleReturnPose(ship, target, time) {
  const recovery = ship?.postBattleReturn;
  if (!recovery || time >= recovery.completeAt) return target;
  const duration = Math.max(1, recovery.completeAt - recovery.startedAt);
  const t = Math.max(0, Math.min(1, (time - recovery.startedAt) / duration));
  const eased = 1 - (1 - t) ** 3;
  const fromX = Number(recovery.fromX) || 0;
  const fromY = Number(recovery.fromY) || 0;
  const dx = target.x - fromX;
  const dy = target.y - fromY;
  const distance = Math.hypot(dx, dy) || 1;
  const bendSign = recovery.bendSign ?? 1;
  const bend = Math.sin(Math.PI * t) * Math.min(90, distance * 0.14) * bendSign;
  const x = fromX + dx * eased + (-dy / distance) * bend;
  const y = fromY + dy * eased + (dx / distance) * bend;
  const lookAheadT = Math.min(1, t + 0.025);
  const lookAheadEase = 1 - (1 - lookAheadT) ** 3;
  const lookAheadBend = Math.sin(Math.PI * lookAheadT) * Math.min(90, distance * 0.14) * bendSign;
  const lookX = fromX + dx * lookAheadEase + (-dy / distance) * lookAheadBend;
  const lookY = fromY + dy * lookAheadEase + (dx / distance) * lookAheadBend;
  const pathHeading = Math.atan2(lookY - y, lookX - x);
  const fromHeading = Number.isFinite(recovery.fromHeading) ? recovery.fromHeading : pathHeading;
  let headingDelta = pathHeading - fromHeading;
  while (headingDelta > Math.PI) headingDelta -= Math.PI * 2;
  while (headingDelta < -Math.PI) headingDelta += Math.PI * 2;
  const headingBlend = Math.min(1, t / 0.15);
  return {
    x,
    y,
    heading: fromHeading + headingDelta * headingBlend,
    returning: true,
    progress: t,
  };
}

export function stationedShipPose(state, system, ship, idx, total, time = state.time) {
  const target = stationedOrbitPose(state, system, ship, idx, total, time);
  return postBattleReturnPose(ship, target, time);
}

export function beginPostBattleReturn(state, system, ship, idx, total, finalPose) {
  if (!ship || ship.hp <= 0 || !finalPose) return null;
  const target = stationedOrbitPose(state, system, ship, idx, total, state.time);
  return beginPostBattleReturnToPose(ship, target, finalPose, state.time);
}

export function beginPostBattleReturnToPose(ship, target, finalPose, now) {
  if (!ship || ship.hp <= 0 || !target || !finalPose) return null;
  const distance = Math.hypot(target.x - finalPose.x, target.y - finalPose.y);
  const durationMs = Math.max(
    POST_BATTLE_RETURN_MIN_MS,
    Math.min(POST_BATTLE_RETURN_MAX_MS, Math.round(distance / POST_BATTLE_RETURN_SPEED * 1000)),
  );
  ship.postBattleReturn = {
    fromX: finalPose.x,
    fromY: finalPose.y,
    fromHeading: finalPose.heading ?? 0,
    startedAt: now,
    completeAt: now + durationMs,
    bendSign: String(ship.id).length % 2 === 0 ? 1 : -1,
    anchorBodyId: ship.anchorBodyId ?? null,
  };
  return ship.postBattleReturn;
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
  if (ship.postBattleReturn && state.time < ship.postBattleReturn.completeAt) {
    return { ok: false, reason: 'Ship is returning to its assigned orbit' };
  }
  if (!ship.systemId) return { ok: false, reason: 'Ship has no location' };
  if (state.systemBattles?.[ship.systemId]?.active) {
    return { ok: false, reason: 'Ship is engaged in combat — issue an emergency retreat order' };
  }
  if (targetId === ship.systemId) return { ok: false, reason: 'Ship is already at that star' };

  const path = findPath(galaxy, ship.systemId, targetId, {
    canEnter: (systemId) => canRouteThroughSystem(
      state,
      systemId,
      'player',
      { galaxyId: state.activeGalaxyId, allowHostile: true },
    ).ok,
  });
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
    if (ship.postBattleReturn && state.time >= ship.postBattleReturn.completeAt) {
      ship.postBattleReturn = null;
    }
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
      {
        canEnter: (systemId) => canRouteThroughSystem(state, systemId, 'player', {
          galaxyId: ship.galaxyId,
          allowHostile: true,
        }).ok,
        onBlocked: (safeSystemId, blockedSystemId) => {
          ship.transit = null;
          ship.systemId = safeSystemId;
          arrivals.push({
            shipId: ship.id,
            systemId: safeSystemId,
            hull: ship.hull,
            blocked: true,
            blockedSystemId,
          });
          onArrive?.(safeSystemId, ship);
        },
      },
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
    const hero = group.anchorHeroId ? findHeroFlagship(state, group.anchorHeroId) : null;
    const anchorPresent = group.anchorFlagship
      ? state.flagship?.galaxyId === state.activeGalaxyId
        && !state.flagship.transit
        && !state.flagship.wormholeTransit
        && state.flagship.systemId === systemId
      : !!hero && !hero.transit && hero.systemId === systemId
        && state.time >= (hero.buildCompleteAt ?? 0);
    if (!anchorPresent) continue;
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
    const hero = group.anchorHeroId ? findHeroFlagship(state, group.anchorHeroId) : null;
    const anchorPresent = group.anchorFlagship
      ? state.flagship?.galaxyId === state.activeGalaxyId
        && !state.flagship.transit
        && !state.flagship.wormholeTransit
        && state.flagship.systemId === systemId
      : !!hero && !hero.transit && hero.systemId === systemId
        && state.time >= (hero.buildCompleteAt ?? 0);
    if (!anchorPresent) continue;
    for (const ship of shipsInBattleGroup(state, group.id)) {
      if (ship.transit || ship.hp <= 0 || !isCombatHull(ship.hull)) continue;
      if (ship.systemId !== systemId) out.push(ship);
    }
  }
  return out;
}
