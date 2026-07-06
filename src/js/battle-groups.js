// Player battle groups — manual fleet organization + group dispatch.

import { findPlayerShip, orderShipTravel } from './fleets.js';
import { findHeroFlagship } from './hero-flagships.js';
import { systemById } from './state.js';

let nextBattleGroupId = 1;

function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function formatFleetName(ordinal) {
  return `${ordinal}${ordinalSuffix(ordinal)} Fleet`;
}

export function resetBattleGroupIds(state) {
  let max = 0;
  for (const group of state.battleGroups ?? []) {
    const n = parseInt(String(group.id).replace('bg-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextBattleGroupId = max + 1;
}

function ensureBattleGroups(state) {
  if (!state.battleGroups) state.battleGroups = [];
  return state.battleGroups;
}

export function findBattleGroup(state, groupId) {
  return ensureBattleGroups(state).find((g) => g.id === groupId) ?? null;
}

export function nextFleetOrdinal(state, galaxyId = state.activeGalaxyId) {
  const groups = ensureBattleGroups(state).filter((g) => g.galaxyId === galaxyId);
  if (groups.length === 0) return 1;
  const max = Math.max(...groups.map((g) => g.ordinal ?? 0));
  return max + 2;
}

export function battleGroupsForGalaxy(state, galaxyId = state.activeGalaxyId) {
  return ensureBattleGroups(state)
    .filter((g) => g.galaxyId === galaxyId)
    .sort((a, b) => a.ordinal - b.ordinal);
}

function removeShipFromAllGroups(state, shipId, exceptGroupId = null) {
  for (const group of ensureBattleGroups(state)) {
    if (exceptGroupId && group.id === exceptGroupId) continue;
    group.shipIds = group.shipIds.filter((id) => id !== shipId);
  }
}

export function createBattleGroup(state) {
  const groups = ensureBattleGroups(state);
  const ordinal = nextFleetOrdinal(state);
  const group = {
    id: `bg-${nextBattleGroupId++}`,
    galaxyId: state.activeGalaxyId,
    ordinal,
    shipIds: [],
    anchorHeroId: null,
  };
  groups.push(group);
  return group;
}

export function deleteBattleGroup(state, groupId) {
  const idx = ensureBattleGroups(state).findIndex((g) => g.id === groupId);
  if (idx < 0) return { ok: false, reason: 'No such fleet' };
  ensureBattleGroups(state).splice(idx, 1);
  return { ok: true };
}

export function assignShipToGroup(state, shipId, groupId) {
  const ship = findPlayerShip(state, shipId);
  if (!ship) return { ok: false, reason: 'No such ship' };
  if (ship.galaxyId !== state.activeGalaxyId) {
    return { ok: false, reason: 'Ship not in active galaxy' };
  }

  if (groupId == null) {
    removeShipFromAllGroups(state, shipId);
    return { ok: true, groupId: null };
  }

  const group = findBattleGroup(state, groupId);
  if (!group) return { ok: false, reason: 'No such fleet' };
  if (group.galaxyId !== state.activeGalaxyId) {
    return { ok: false, reason: 'Fleet not in active galaxy' };
  }

  removeShipFromAllGroups(state, shipId, groupId);
  if (!group.shipIds.includes(shipId)) group.shipIds.push(shipId);
  return { ok: true, groupId: group.id };
}

export function shipsInBattleGroup(state, groupId) {
  const group = findBattleGroup(state, groupId);
  if (!group) return [];
  const ships = [];
  for (const shipId of group.shipIds) {
    const ship = findPlayerShip(state, shipId);
    if (ship && ship.galaxyId === group.galaxyId && ship.hp > 0) ships.push(ship);
  }
  return ships;
}

export function unassignedPlayerShips(state) {
  const assigned = new Set();
  for (const group of battleGroupsForGalaxy(state)) {
    for (const shipId of group.shipIds) assigned.add(shipId);
  }
  return (state.playerShips ?? []).filter(
    (s) => s.galaxyId === state.activeGalaxyId && s.hp > 0 && !assigned.has(s.id),
  );
}

export function fleetLocationSummary(state, groupId) {
  const ships = shipsInBattleGroup(state, groupId);
  if (ships.length === 0) return 'empty';

  const systems = new Set();
  for (const ship of ships) {
    if (ship.transit) {
      const destId = ship.transit.path[ship.transit.path.length - 1];
      systems.add(`→ ${systemById(state, destId)?.name ?? destId}`);
    } else if (ship.systemId) {
      systems.add(systemById(state, ship.systemId)?.name ?? ship.systemId);
    }
  }

  if (systems.size === 1) {
    const loc = [...systems][0];
    return loc.startsWith('→') ? loc : `@ ${loc}`;
  }
  return `split · ${systems.size} locations`;
}

export function pruneBattleGroups(state) {
  const liveIds = new Set(
    (state.playerShips ?? []).filter((s) => s.hp > 0).map((s) => s.id),
  );
  for (const group of ensureBattleGroups(state)) {
    group.shipIds = group.shipIds.filter((id) => liveIds.has(id));
  }
}

export function orderBattleGroupTravel(state, groupId, targetId) {
  const group = findBattleGroup(state, groupId);
  if (!group) return { ok: false, reason: 'No such fleet', dispatched: 0, skipped: 0, reasons: [] };

  const ships = shipsInBattleGroup(state, groupId);
  if (ships.length === 0) {
    return { ok: false, reason: 'Fleet has no ships', dispatched: 0, skipped: 0, reasons: [] };
  }

  let dispatched = 0;
  let skipped = 0;
  const reasons = [];

  for (const ship of ships) {
    const res = orderShipTravel(state, ship.id, targetId);
    if (res.ok) {
      dispatched++;
    } else {
      skipped++;
      reasons.push(`${ship.id}: ${res.reason}`);
    }
  }

  if (dispatched === 0) {
    return {
      ok: false,
      reason: reasons[0]?.split(': ').slice(1).join(': ') ?? 'No ships available to dispatch',
      dispatched,
      skipped,
      reasons,
    };
  }

  return { ok: true, dispatched, skipped, reasons, fleetName: formatFleetName(group.ordinal) };
}

export function setBattleGroupHeroAnchor(state, groupId, heroId) {
  const group = findBattleGroup(state, groupId);
  if (!group) return { ok: false, reason: 'No such fleet' };
  if (heroId) {
    const hero = findHeroFlagship(state, heroId);
    if (!hero) return { ok: false, reason: 'No such hero flagship' };
    if (hero.galaxyId !== group.galaxyId) return { ok: false, reason: 'Hero not in this galaxy' };
  }
  group.anchorHeroId = heroId;
  return { ok: true, groupId, anchorHeroId: heroId };
}
