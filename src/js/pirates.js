// Wandering pirate faction — seed-deterministic test opponent (Phase 2.10).

import {
  PIRATE_FLEET_COUNT,
  PIRATE_WANDER_MS,
  PIRATE_RAID_CHANCE,
  PIRATE_RAID_MAX_HOPS,
  PIRATE_INTERDICTION_PROGRESS_DELTA,
  PIRATE_RESPAWN_MS,
  PIRATE_LANE_SPEED,
  PIRATE_LANE_MIN_LEG_MS,
  PIRATE_SHIPS,
  TICK_MS,
} from './constants.js';
import { createRng, hashSeed, isPlayerOwned, systemById } from './state.js';
import { createShipInstance, hullStats } from './hull.js';
import { BLACK_HOLE_ID, findPath, neighborsOf } from './galaxy.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  transitEtaMs,
  advanceTransit,
} from './transit.js';
import { playerShipStatus } from './fleets.js';
import { fleetPower } from './fleet-power.js';

let nextPirateShipId = 1;
let nextFleetId = 1;

function pirateRng(seed, fleetId, salt) {
  return createRng(hashSeed(seed, `pirate:${fleetId}:${salt}`));
}

function rimStarIds(galaxy, strongholdId) {
  const stars = galaxy.stars.filter((s) => s.id !== strongholdId);
  const scored = stars.map((s) => ({
    id: s.id,
    dist: Math.hypot(s.x, s.y),
  }));
  scored.sort((a, b) => b.dist - a.dist);
  const rimCount = Math.max(PIRATE_FLEET_COUNT + 2, Math.floor(stars.length * 0.35));
  return scored.slice(0, rimCount).map((s) => s.id);
}

function buildFleetShips(seed, fleetId) {
  const ships = [];
  const rng = pirateRng(seed, fleetId, 'ships');
  for (const entry of PIRATE_SHIPS) {
    for (let i = 0; i < entry.count; i++) {
      ships.push(createShipInstance(`ps-${nextPirateShipId++}`, entry.hull));
    }
  }
  return ships;
}

export function resetPirateIds(state) {
  let maxShip = 0;
  let maxFleet = 0;
  for (const fleet of state.pirates?.fleets ?? []) {
    const fn = parseInt(String(fleet.id).replace('pirate-', ''), 10);
    if (Number.isFinite(fn)) maxFleet = Math.max(maxFleet, fn);
    for (const ship of fleet.ships) {
      const sn = parseInt(String(ship.id).replace('ps-', ''), 10);
      if (Number.isFinite(sn)) maxShip = Math.max(maxShip, sn);
    }
  }
  for (const pending of state.pirates?.pendingRespawn ?? []) {
    const fn = parseInt(String(pending.fleetId).replace('pirate-', ''), 10);
    if (Number.isFinite(fn)) maxFleet = Math.max(maxFleet, fn);
  }
  nextPirateShipId = maxShip + 1;
  nextFleetId = maxFleet + 1;
}

export function spawnPirateFleets(state) {
  nextPirateShipId = 1;
  nextFleetId = 1;
  const seed = state.meta?.seed ?? 1;
  const rim = rimStarIds(getGraph(state), state.stronghold);
  const rng = createRng(hashSeed(seed, 'pirate-spawn'));
  const fleets = [];
  const used = new Set();

  for (let i = 0; i < PIRATE_FLEET_COUNT; i++) {
    const fleetId = `pirate-${nextFleetId++}`;
    let systemId = rim[Math.floor(rng() * rim.length)];
    let guard = 0;
    while (used.has(systemId) && guard++ < 20) {
      systemId = rim[Math.floor(rng() * rim.length)];
    }
    used.add(systemId);
    fleets.push({
      id: fleetId,
      galaxyId: state.activeGalaxyId,
      systemId,
      transit: null,
      ships: buildFleetShips(seed, fleetId),
      wanderCooldownMs: Math.floor(rng() * PIRATE_WANDER_MS),
      intent: { type: 'wander', targetSystemId: null },
    });
  }

  return { fleets, pendingRespawn: [] };
}

function pickWanderTarget(state, fleet) {
  const galaxy = getGraph(state);
  const adj = neighborsOf(galaxy, fleet.systemId);
  const candidates = adj.filter((id) => id !== BLACK_HOLE_ID);
  if (!candidates.length) return null;
  const rng = pirateRng(state.meta.seed, fleet.id, `wander:${state.time}`);
  return candidates[Math.floor(rng() * candidates.length)];
}

function pathHopCount(path) {
  return Math.max(0, (path?.length ?? 1) - 1);
}

function playerDefendedSystems(state) {
  const ids = new Set([state.stronghold]);
  const systems = getSystems(state);
  for (const ship of state.playerShips ?? []) {
    if (ship.galaxyId === state.activeGalaxyId && ship.systemId && !ship.transit && ship.hp > 0) {
      ids.add(ship.systemId);
    }
  }
  for (const [systemId, system] of Object.entries(systems)) {
    if (isPlayerOwned(state, systemId)) ids.add(systemId);
    if (system.structures?.some((s) => s.type === 'shipyard' || s.type === 'orbital_defense' || s.type === 'ion_battery')) {
      ids.add(systemId);
    }
  }
  return [...ids].filter((id) => id !== BLACK_HOLE_ID);
}

function pickRaidTarget(state, fleet) {
  const galaxy = getGraph(state);
  const candidates = [];
  for (const systemId of playerDefendedSystems(state)) {
    if (systemId === fleet.systemId) continue;
    const path = findPath(galaxy, fleet.systemId, systemId);
    const hops = pathHopCount(path);
    if (!path || hops < 1 || hops > PIRATE_RAID_MAX_HOPS) continue;
    let weight = systemId === state.stronghold ? 5 : 1;
    if (isPlayerOwned(state, systemId)) weight += 3;
    weight += (state.playerShips ?? []).filter(
      (s) => s.galaxyId === state.activeGalaxyId && s.systemId === systemId && !s.transit && s.hp > 0,
    ).length;
    candidates.push({ systemId, hops, weight });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.hops - b.hops) || (b.weight - a.weight) || a.systemId.localeCompare(b.systemId));
  const top = candidates.slice(0, Math.min(5, candidates.length));
  const total = top.reduce((n, c) => n + c.weight / c.hops, 0);
  const rng = pirateRng(state.meta.seed, fleet.id, `raid:${state.time}`);
  let roll = rng() * total;
  for (const c of top) {
    roll -= c.weight / c.hops;
    if (roll <= 0) return c.systemId;
  }
  return top[0].systemId;
}

function orderFleetTravel(state, fleet, targetId, intentType = 'wander') {
  if (fleet.transit || !targetId || targetId === fleet.systemId) return false;
  const path = findPath(getGraph(state), fleet.systemId, targetId);
  if (!path || path.length < 2) return false;

  fleet.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: legDurationMs(
      getGraph(state),
      path[0],
      path[1],
      PIRATE_LANE_SPEED,
      PIRATE_LANE_MIN_LEG_MS,
    ),
  };
  fleet.systemId = null;
  fleet.wanderCooldownMs = PIRATE_WANDER_MS;
  fleet.intent = { type: intentType, targetSystemId: targetId };
  return true;
}

export function pirateFleetAtSystem(state, systemId) {
  return (state.pirates?.fleets ?? []).filter(
    (f) => f.galaxyId === state.activeGalaxyId
      && f.systemId === systemId && !f.transit && f.ships.some((s) => s.hp > 0),
  );
}

export function pirateCombatPresence(state, systemId) {
  let force = 0;
  for (const fleet of pirateFleetAtSystem(state, systemId)) {
    for (const ship of fleet.ships) {
      if (ship.hp > 0) force += 1;
    }
  }
  return force;
}

export function pirateFleetPower(fleet, state = null) {
  return fleetPower((fleet?.ships ?? []).filter((s) => s.hp > 0), state);
}

export function pirateFleetStatus(fleet, galaxy, time) {
  return transitStatusCore(
    fleet.transit,
    galaxy,
    time,
    PIRATE_LANE_SPEED,
    PIRATE_LANE_MIN_LEG_MS,
  );
}

export function pirateFleetEtaMs(state, fleet) {
  return transitEtaMs(
    fleet.transit,
    getGraph(state),
    state.time,
    PIRATE_LANE_SPEED,
    PIRATE_LANE_MIN_LEG_MS,
  );
}

export function pirateSystemsWithPresence(state) {
  const ids = new Set();
  for (const fleet of state.pirates?.fleets ?? []) {
    if (fleet.galaxyId !== state.activeGalaxyId) continue;
    if (fleet.systemId && !fleet.transit) ids.add(fleet.systemId);
  }
  return [...ids];
}

export function pirateFleetMarkersForGalaxy(state) {
  return (state.pirates?.fleets ?? [])
    .filter((fleet) => fleet.galaxyId === state.activeGalaxyId && fleet.systemId && !fleet.transit)
    .map((fleet) => ({
      fleetId: fleet.id,
      systemId: fleet.systemId,
      shipCount: fleet.ships.filter((s) => s.hp > 0).length,
      power: pirateFleetPower(fleet, state),
      intent: fleet.intent?.type ?? 'wander',
      targetSystemId: fleet.intent?.targetSystemId ?? null,
      side: 'enemy',
    }));
}

export function pirateTransitLaneKeys(state) {
  const keys = new Set();
  for (const fleet of state.pirates?.fleets ?? []) {
    if (fleet.galaxyId !== state.activeGalaxyId || !fleet.transit) continue;
    const t = fleet.transit;
    for (let i = t.legIndex; i < t.path.length - 1; i++) {
      const a = t.path[i];
      const b = t.path[i + 1];
      keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }
  return keys;
}

export function pirateFleetTransitMarkersForGalaxy(state) {
  const galaxy = getGraph(state);
  const out = [];
  for (const fleet of state.pirates?.fleets ?? []) {
    if (fleet.galaxyId !== state.activeGalaxyId || !fleet.transit) continue;
    const status = pirateFleetStatus(fleet, galaxy, state.time);
    if (!status) continue;
    out.push({
      fleetId: fleet.id,
      x: status.x,
      y: status.y,
      angle: status.angle,
      destId: status.destId,
      shipCount: fleet.ships.filter((s) => s.hp > 0).length,
      power: pirateFleetPower(fleet, state),
      intent: fleet.intent?.type ?? 'wander',
      targetSystemId: fleet.intent?.targetSystemId ?? status.destId,
      side: 'enemy',
      inTransit: true,
    });
  }
  return out;
}

function scheduleRespawn(state, fleetId) {
  state.pirates.pendingRespawn = state.pirates.pendingRespawn ?? [];
  state.pirates.pendingRespawn.push({
    fleetId,
    respawnAt: state.time + PIRATE_RESPAWN_MS,
  });
}

function respawnFleet(state, pending) {
  const seed = state.meta.seed;
  const rim = rimStarIds(getGraph(state), state.stronghold);
  const rng = createRng(hashSeed(seed, `respawn:${pending.fleetId}:${state.time}`));
  const systemId = rim[Math.floor(rng() * rim.length)];
  nextPirateShipId = 1;
  return {
    id: pending.fleetId,
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    ships: buildFleetShips(seed, pending.fleetId),
    wanderCooldownMs: PIRATE_WANDER_MS,
    intent: { type: 'wander', targetSystemId: null },
  };
}

export function forcePirateIntoSystem(state, systemId) {
  if (!state.pirates?.fleets?.length) return false;
  const fleet = state.pirates.fleets[0];
  fleet.transit = null;
  fleet.systemId = systemId;
  fleet.wanderCooldownMs = PIRATE_WANDER_MS;
  fleet.intent = { type: 'raid', targetSystemId: systemId };
  return true;
}

function sameLane(a, b) {
  return a && b && ((a.fromId === b.fromId && a.toId === b.toId) || (a.fromId === b.toId && a.toId === b.fromId));
}

function closesEnough(a, b) {
  if (a.fromId === b.fromId && a.toId === b.toId) {
    return Math.abs(a.progress - b.progress) <= PIRATE_INTERDICTION_PROGRESS_DELTA;
  }
  return Math.abs((a.progress + b.progress) - 1) <= PIRATE_INTERDICTION_PROGRESS_DELTA;
}

function dropoutSystemId(status) {
  return status.progress < 0.5 ? status.fromId : status.toId;
}

export function tickPirateInterdictions(state, onInterdict) {
  const events = [];
  const galaxy = getGraph(state);
  const pirateStatuses = [];
  for (const fleet of state.pirates?.fleets ?? []) {
    if (fleet.galaxyId !== state.activeGalaxyId || !fleet.transit) continue;
    const status = pirateFleetStatus(fleet, galaxy, state.time);
    if (status) pirateStatuses.push({ fleet, status });
  }
  if (!pirateStatuses.length) return events;

  for (const ship of state.playerShips ?? []) {
    if (ship.galaxyId !== state.activeGalaxyId || !ship.transit || ship.hp <= 0) continue;
    const shipStatus = playerShipStatus(ship, galaxy, state.time);
    if (!shipStatus) continue;
    const match = pirateStatuses.find(({ fleet, status }) => (
      fleet.transit && sameLane(status, shipStatus) && closesEnough(status, shipStatus)
    ));
    if (!match) continue;
    const systemId = dropoutSystemId(shipStatus);
    ship.transit = null;
    ship.systemId = systemId;
    match.fleet.transit = null;
    match.fleet.systemId = systemId;
    match.fleet.wanderCooldownMs = PIRATE_WANDER_MS;
    match.fleet.intent = { type: 'interdict', targetSystemId: systemId };
    const event = {
      type: 'pirate_interdiction',
      fleetId: match.fleet.id,
      shipId: ship.id,
      systemId,
      power: pirateFleetPower(match.fleet, state),
    };
    events.push(event);
    onInterdict?.(systemId, match.fleet, ship, event);
  }
  return events;
}

export function tickPirates(state, onArrive) {
  const arrivals = [];

  state.pirates.pendingRespawn = (state.pirates.pendingRespawn ?? []).filter((p) => {
    if (state.time < p.respawnAt) return true;
    state.pirates.fleets.push(respawnFleet(state, p));
    return false;
  });

  for (const fleet of state.pirates.fleets) {
    if (fleet.galaxyId !== state.activeGalaxyId) continue;
    if (fleet.transit) {
      advanceTransit(
        fleet.transit,
        getGraph(state),
        state.time,
        PIRATE_LANE_SPEED,
        PIRATE_LANE_MIN_LEG_MS,
        (destId) => {
          fleet.transit = null;
          fleet.systemId = destId;
          fleet.wanderCooldownMs = PIRATE_WANDER_MS;
          if (fleet.intent?.targetSystemId === destId) fleet.intent = { type: fleet.intent.type, targetSystemId: destId };
          arrivals.push({ fleetId: fleet.id, systemId: destId });
          onArrive?.(destId, fleet);
        },
      );
      continue;
    }

    if (!fleet.systemId || fleet.ships.every((s) => s.hp <= 0)) {
      if (fleet.ships.every((s) => s.hp <= 0)) {
        state.pirates.fleets = state.pirates.fleets.filter((f) => f.id !== fleet.id);
        scheduleRespawn(state, fleet.id);
      }
      continue;
    }

    fleet.wanderCooldownMs = Math.max(0, (fleet.wanderCooldownMs ?? 0) - TICK_MS);
    if (fleet.wanderCooldownMs <= 0) {
      const rng = pirateRng(state.meta.seed, fleet.id, `choice:${state.time}`);
      const raidTarget = rng() < PIRATE_RAID_CHANCE ? pickRaidTarget(state, fleet) : null;
      const target = raidTarget ?? pickWanderTarget(state, fleet);
      if (target) orderFleetTravel(state, fleet, target, raidTarget ? 'raid' : 'wander');
      else fleet.wanderCooldownMs = PIRATE_WANDER_MS;
    }
  }

  return arrivals;
}

export function removePirateShip(state, fleetId, shipId) {
  const fleet = state.pirates.fleets.find((f) => f.id === fleetId);
  if (!fleet) return;
  const ship = fleet.ships.find((s) => s.id === shipId);
  if (ship) ship.hp = 0;
  if (fleet.ships.every((s) => s.hp <= 0)) {
    state.pirates.fleets = state.pirates.fleets.filter((f) => f.id !== fleetId);
    scheduleRespawn(state, fleetId);
  }
}

export function ensurePiratesState(state) {
  if (!state.pirates) {
    state.pirates = { fleets: [], pendingRespawn: [] };
  } else {
    state.pirates.fleets = state.pirates.fleets ?? [];
    state.pirates.pendingRespawn = state.pirates.pendingRespawn ?? [];
  }
  for (const fleet of state.pirates.fleets) {
    const path = fleet.transit?.path;
    fleet.intent = fleet.intent ?? {
      type: fleet.transit ? 'raid' : 'wander',
      targetSystemId: path?.length ? path[path.length - 1] : (fleet.systemId ?? null),
    };
  }
}

function validateComposition(composition) {
  if (!Array.isArray(composition) || !composition.length) {
    return { ok: false, reason: 'Composition must be a non-empty array' };
  }
  for (const entry of composition) {
    if (!entry?.hull || !Number.isFinite(entry.count) || entry.count < 1) {
      return { ok: false, reason: 'Each composition entry needs hull and count >= 1' };
    }
    if (!hullStats(entry.hull)) {
      return { ok: false, reason: `Unknown hull in composition: ${entry.hull}` };
    }
  }
  return { ok: true };
}

function buildFleetShipsFromComposition(composition) {
  const ships = [];
  for (const entry of composition) {
    for (let i = 0; i < entry.count; i++) {
      ships.push(createShipInstance(`ps-${nextPirateShipId++}`, entry.hull));
    }
  }
  return ships;
}

/** Dev: spawn a new pirate fleet at a system. */
export function devSpawnEnemyFleetAtSystem(state, systemId, composition = PIRATE_SHIPS) {
  ensurePiratesState(state);
  if (!systemById(state, systemId)) {
    return { ok: false, code: 'INVALID_SYSTEM', reason: 'No such system' };
  }
  const compCheck = validateComposition(composition);
  if (!compCheck.ok) {
    return { ok: false, code: 'INVALID_HULL', reason: compCheck.reason };
  }

  const seed = state.meta?.seed ?? 1;
  const fleetId = `pirate-${nextFleetId++}`;
  const fleet = {
    id: fleetId,
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    ships: buildFleetShipsFromComposition(composition),
    wanderCooldownMs: PIRATE_WANDER_MS,
    intent: { type: 'raid', targetSystemId: systemId },
  };
  state.pirates.fleets.push(fleet);
  return {
    ok: true,
    details: {
      fleetId,
      systemId,
      shipCount: fleet.ships.length,
      seed,
    },
  };
}

/** Dev: teleport an existing fleet to a system. */
export function devTeleportPirateFleet(state, systemId, fleetIndex = 0) {
  ensurePiratesState(state);
  if (!systemById(state, systemId)) {
    return { ok: false, code: 'INVALID_SYSTEM', reason: 'No such system' };
  }
  if (!state.pirates.fleets.length) {
    return { ok: false, code: 'NO_FLEET', reason: 'No pirate fleets available' };
  }
  const fleet = state.pirates.fleets[fleetIndex];
  if (!fleet) {
    return { ok: false, code: 'NO_FLEET', reason: `No fleet at index ${fleetIndex}` };
  }
  fleet.transit = null;
  fleet.systemId = systemId;
  fleet.galaxyId = state.activeGalaxyId;
  fleet.wanderCooldownMs = PIRATE_WANDER_MS;
  fleet.intent = { type: 'raid', targetSystemId: systemId };
  return { ok: true, details: { fleetId: fleet.id, systemId } };
}
