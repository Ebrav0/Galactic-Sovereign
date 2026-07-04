// AI fleet spawn + transit (Phase 5, D8).

import {
  AI_LANE_SPEED,
  AI_LANE_MIN_LEG_MS,
  FLEET_STATION_ORBIT_PAD,
  FLEET_STATION_BODY_PAD,
} from './constants.js';
import { createShipInstance, shipLaneSpeed, captureForceForShip } from './hull.js';
import { planetPosition } from './state.js';
import { findPath } from './galaxy.js';
import { getGraph } from './galaxy-scope.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  advanceTransit,
} from './transit.js';

let nextAiShipId = 1;

export function resetAiShipIds(state) {
  let max = 0;
  for (const ship of state.aiShips ?? []) {
    const n = parseInt(String(ship.id).replace('ai-ship-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextAiShipId = max + 1;
}

export function spawnAiShip(state, systemId, hull, anchorBodyId = null) {
  if (!state.aiShips) state.aiShips = [];
  const ship = {
    ...createShipInstance(`ai-ship-${nextAiShipId++}`, hull),
    galaxyId: state.activeGalaxyId,
    systemId,
    owner: 'ai',
    anchorBodyId,
    transit: null,
  };
  state.aiShips.push(ship);
  return ship;
}

export function aiShipsInSystem(state, systemId) {
  return (state.aiShips ?? []).filter(
    (s) => s.galaxyId === state.activeGalaxyId && s.systemId === systemId && !s.transit && s.hp > 0,
  );
}

export function aiCombatPresence(state, systemId) {
  return aiShipsInSystem(state, systemId).reduce(
    (n, s) => n + captureForceForShip(s),
    0,
  );
}

export function aiShipLaneSpeed(hull) {
  const base = shipLaneSpeed(hull);
  return base || AI_LANE_SPEED;
}

export function orderAiShipTravel(state, ship, targetId) {
  const galaxy = getGraph(state);
  const path = findPath(galaxy, ship.systemId, targetId);
  if (!path || path.length < 2) return { ok: false, reason: 'No path' };

  const nextId = path[1];
  const legMs = legDurationMs(
    galaxy,
    ship.systemId,
    nextId,
    aiShipLaneSpeed(ship.hull),
    AI_LANE_MIN_LEG_MS,
  );
  ship.transit = {
    path,
    pathIndex: 0,
    legStartTime: state.time,
    legDurationMs: legMs,
    destId: targetId,
  };
  return { ok: true, path, etaMs: legMs };
}

export function tickAiShips(state, onArrival) {
  const arrivals = [];
  for (const ship of state.aiShips ?? []) {
    if (ship.galaxyId !== state.activeGalaxyId || !ship.transit) continue;
    const galaxy = getGraph(state);
    const done = advanceTransit(ship, galaxy, state.time, aiShipLaneSpeed(ship.hull), AI_LANE_MIN_LEG_MS);
    if (done) {
      ship.systemId = ship.transit.destId;
      ship.transit = null;
      arrivals.push(ship);
      if (onArrival) onArrival(ship.systemId);
    }
  }
  return arrivals;
}

export function stationedAiPose(state, system, ship, idx, total) {
  const starR = system.star?.radius ?? 200;
  const minOrbit = starR + FLEET_STATION_ORBIT_PAD;
  if (ship.anchorBodyId) {
    const planet = system.bodies.find((b) => b.id === ship.anchorBodyId);
    if (planet) {
      const pp = planetPosition(planet, state.time);
      const slotAngle = (idx / Math.max(1, total)) * Math.PI * 2;
      const offset = planet.radius + FLEET_STATION_BODY_PAD;
      return { x: pp.x + Math.cos(slotAngle) * offset, y: pp.y + Math.sin(slotAngle) * offset };
    }
  }
  const angle = (idx / Math.max(1, total)) * Math.PI * 2;
  return { x: Math.cos(angle) * minOrbit, y: Math.sin(angle) * minOrbit };
}

export function aiFleetPowerInSystem(state, systemId) {
  return aiShipsInSystem(state, systemId).reduce((n, s) => n + Math.max(0, s.hp), 0);
}

export function aiShipsSummary(state) {
  return (state.aiShips ?? [])
    .filter((s) => s.galaxyId === state.activeGalaxyId)
    .map((s) => ({
      id: s.id,
      hull: s.hull,
      systemId: s.systemId,
      inTransit: !!s.transit,
      hp: s.hp,
    }));
}
