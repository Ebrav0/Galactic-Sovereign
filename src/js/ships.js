// Player combat/transport ships (Phase 2). Scouts remain in scout.js.

import { HULL_STATS, CARRIER_DEFAULT_WINGS } from './constants.js';
import { hullStats } from './hulls.js';

let nextShipId = 1;

export function resetShipIds(state) {
  let max = 0;
  for (const ship of state.ships ?? []) {
    const n = parseInt(ship.id.replace('ship-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextShipId = max + 1;
}

export function spawnShip(state, systemId, hull) {
  const stats = hullStats(hull);
  if (!stats || hull === 'scout') return null;

  const ship = {
    id: `ship-${nextShipId++}`,
    hull,
    systemId,
    transit: null,
    hp: stats.hp,
    maxHp: stats.hp,
    wings: hull === 'light_carrier'
      ? { ...CARRIER_DEFAULT_WINGS }
      : null,
  };
  if (!state.ships) state.ships = [];
  state.ships.push(ship);
  return ship;
}

export function findShip(state, shipId) {
  return state.ships?.find((s) => s.id === shipId) ?? null;
}

export function shipsInSystem(state, systemId) {
  return (state.ships ?? []).filter((s) => s.systemId === systemId && !s.transit && s.hp > 0);
}

export function shipsAtSystem(state, systemId) {
  return (state.ships ?? []).filter((s) => s.systemId === systemId && !s.transit);
}

export function idleShips(state) {
  return (state.ships ?? []).filter((s) => !s.transit && s.hp > 0);
}

export function alivePlayerCombatShips(state, systemId) {
  return shipsInSystem(state, systemId).filter((s) => {
    const stats = hullStats(s.hull);
    return stats && (stats.contestsCapture || stats.captureForce > 0);
  });
}

export function removeShip(state, shipId) {
  const idx = state.ships?.findIndex((s) => s.id === shipId) ?? -1;
  if (idx >= 0) state.ships.splice(idx, 1);
}

export function syncShipHpFromBattle(state, refId, hp) {
  if (refId === 'flagship') {
    state.flagship.hp = Math.max(0, hp);
    return;
  }
  const ship = findShip(state, refId);
  if (ship) ship.hp = Math.max(0, hp);
}

export function fleetSummary(state) {
  const ships = state.ships ?? [];
  const bySystem = {};
  let inTransit = 0;
  for (const ship of ships) {
    if (ship.hp <= 0) continue;
    if (ship.transit) {
      inTransit += 1;
    } else if (ship.systemId) {
      bySystem[ship.systemId] = (bySystem[ship.systemId] ?? 0) + 1;
    }
  }
  return {
    totalShips: ships.filter((s) => s.hp > 0).length,
    bySystem,
    inTransit,
    scoutCount: state.scouts?.length ?? 0,
  };
}

export function shipSummaries(state) {
  return (state.ships ?? []).map((ship) => ({
    id: ship.id,
    hull: ship.hull,
    systemId: ship.systemId,
    hp: ship.hp,
    maxHp: ship.maxHp,
    inTransit: !!ship.transit,
  }));
}
