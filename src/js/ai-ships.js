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
import { factionTechContext } from './ai-tech.js';

let nextAiShipId = 1;

export function resetAiShipIds(state) {
  let max = 0;
  for (const ship of state.aiShips ?? []) {
    const n = parseInt(String(ship.id).replace('ai-ship-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextAiShipId = max + 1;
}

export function aiShipFactionId(state, ship, fallback = 'ai-0') {
  if (ship?.factionId) return ship.factionId;
  const system = state.galaxies?.[ship?.galaxyId ?? state.activeGalaxyId]?.systems?.[ship?.systemId];
  return system?.factionId ?? state.factions?.ai?.id ?? fallback;
}

export function assignAiShipFactionIds(state, fallback = 'ai-0') {
  for (const ship of state.aiShips ?? []) {
    ship.owner = 'ai';
    ship.factionId = aiShipFactionId(state, ship, fallback);
  }
  return state.aiShips ?? [];
}

/**
 * Backward compatible signature: the fifth argument may be a faction id or an
 * options object. Existing four-argument callers inherit the system faction.
 */
export function spawnAiShip(state, systemId, hull, anchorBodyId = null, factionIdOrOpts = null) {
  if (!state.aiShips) state.aiShips = [];
  const opts = factionIdOrOpts && typeof factionIdOrOpts === 'object'
    ? factionIdOrOpts
    : { factionId: factionIdOrOpts };
  const system = state.galaxies?.[state.activeGalaxyId]?.systems?.[systemId];
  const factionId = opts.factionId
    ?? system?.factionId
    ?? state.factions?.ai?.id
    ?? 'ai-0';
  const faction = state.factions?.list?.find((candidate) => candidate.id === factionId)
    ?? (state.factions?.ai?.id === factionId ? state.factions.ai : null);
  const instance = createShipInstance(
    `ai-ship-${nextAiShipId++}`,
    hull,
    faction ? factionTechContext(faction) : null,
  );
  if (!instance) return null;
  const ship = {
    ...instance,
    galaxyId: opts.galaxyId ?? state.activeGalaxyId,
    systemId,
    owner: 'ai',
    factionId,
    anchorBodyId,
    transit: null,
  };
  if (Number.isFinite(opts.veterancy)) ship.veterancy = Math.max(0, Math.min(3, opts.veterancy));
  state.aiShips.push(ship);
  return ship;
}

export function aiShipsInSystem(state, systemId, factionId = null) {
  return (state.aiShips ?? []).filter(
    (s) => s.galaxyId === state.activeGalaxyId
      && s.systemId === systemId
      && !s.transit
      && s.hp > 0
      && (!factionId || aiShipFactionId(state, s) === factionId),
  );
}

export function aiCombatPresence(state, systemId, factionId = null) {
  return aiShipsInSystem(state, systemId, factionId).reduce(
    (n, s) => n + captureForceForShip(s),
    0,
  );
}

export function aiShipLaneSpeed(hull) {
  const base = shipLaneSpeed(hull);
  return base || AI_LANE_SPEED;
}

export function orderAiShipTravel(state, ship, targetId) {
  if (ship?.systemId && state.systemBattles?.[ship.systemId]?.active) {
    return { ok: false, reason: 'Fleet is engaged in combat' };
  }
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
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: legMs,
    destId: targetId,
  };
  ship.systemId = null;
  return { ok: true, path, etaMs: legMs };
}

export function tickAiShips(state, onArrival) {
  const arrivals = [];
  for (const ship of state.aiShips ?? []) {
    if (ship.galaxyId !== state.activeGalaxyId || !ship.transit) continue;
    const galaxy = getGraph(state);
    advanceTransit(
      ship.transit,
      galaxy,
      state.time,
      aiShipLaneSpeed(ship.hull),
      AI_LANE_MIN_LEG_MS,
      (destId) => {
        ship.systemId = destId;
        ship.transit = null;
        arrivals.push(ship);
        onArrival?.(destId, ship);
      },
    );
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

export function aiFleetPowerInSystem(state, systemId, factionId = null) {
  return aiShipsInSystem(state, systemId, factionId).reduce((n, s) => n + Math.max(0, s.hp), 0);
}

export function aiShipsSummary(state) {
  return (state.aiShips ?? [])
    .filter((s) => s.galaxyId === state.activeGalaxyId)
    .map((s) => ({
      id: s.id,
      hull: s.hull,
      owner: 'ai',
      factionId: aiShipFactionId(state, s),
      systemId: s.systemId,
      inTransit: !!s.transit,
      hp: s.hp,
    }));
}
