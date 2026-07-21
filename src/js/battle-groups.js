// Player battle groups — manual fleet organization + group dispatch.

import { getGraph } from './galaxy-scope.js';
import { findPlayerShip, orderShipTravel, playerShipStatus } from './fleets.js';
import { findHeroFlagship } from './hero-flagships.js';
import { getPlayerFlagship } from './flagship.js';
import { shipPower } from './fleet-power.js';
import { systemById } from './state.js';
import { HELIOCLAST_ID } from './constants.js';
import { getHelioclastShip, isHelioclastMobile, orderHelioclastTravel } from './superweapon.js';

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

/** Battle group that currently lists this ship, or null. */
export function battleGroupForShip(state, shipId) {
  const id = String(shipId ?? '');
  if (!id) return null;
  for (const group of ensureBattleGroups(state)) {
    if ((group.shipIds ?? []).some((entry) => String(entry) === id)) return group;
  }
  return null;
}

/**
 * In-system follow home for a player ship.
 * Hero-anchored fleets stick to their hero. Flagship-anchored groups (and
 * owner-stamped ships) escort that pilot's flagship so co-op screens agree —
 * alpha's ships follow alpha, beta's follow beta.
 * Returns null → use station orbit.
 */
export function fleetFollowHome(state, ship, systemId = ship?.systemId) {
  if (!ship || ship.hp <= 0 || ship.transit) return null;
  const sid = systemId ?? ship.systemId;
  if (!sid) return null;
  const galaxyId = ship.galaxyId ?? state.activeGalaxyId;

  const group = battleGroupForShip(state, ship.id);
  if (group?.anchorHeroId) {
    const hero = findHeroFlagship(state, group.anchorHeroId);
    if (
      hero
      && hero.hp > 0
      && !hero.transit
      && hero.systemId === sid
      && hero.galaxyId === galaxyId
    ) {
      return {
        x: Number(hero.x) || 80,
        y: Number(hero.y) || -100,
        heading: Number.isFinite(hero.heading) ? hero.heading : 0,
        vx: Number(hero.vx) || 0,
        vy: Number(hero.vy) || 0,
        kind: 'hero',
        homeId: String(hero.id),
      };
    }
    return null;
  }

  /** @type {string | null} */
  let pilotId = null;
  if (group?.anchorFlagship) {
    pilotId = group.anchorPilotId ?? group.ownerPlayerId ?? null;
  }
  if (!pilotId && ship.ownerPlayerId) pilotId = ship.ownerPlayerId;

  let flagship = pilotId ? getPlayerFlagship(state, pilotId) : null;
  // Solo / unowned team ships: escort the bound primary flagship.
  if (!flagship && !pilotId) flagship = state.flagship ?? null;
  if (
    flagship
    && !flagship.transit
    && !flagship.wormholeTransit
    && flagship.systemId === sid
    && (flagship.galaxyId == null || flagship.galaxyId === galaxyId)
  ) {
    const homePilot = flagship.pilotId ?? pilotId ?? 'solo';
    return {
      x: Number(flagship.x) || 0,
      y: Number(flagship.y) || 0,
      heading: Number.isFinite(flagship.heading) ? flagship.heading : 0,
      vx: Number(flagship.vx) || 0,
      vy: Number(flagship.vy) || 0,
      kind: 'flagship',
      homeId: `flagship:${homePilot}`,
      pilotId: homePilot,
    };
  }
  return null;
}

/** Ships sharing the same follow home in a system (sorted for stable slots). */
export function fleetFollowCohort(state, homeId, systemId) {
  if (!homeId || !systemId) return [];
  return (state.playerShips ?? [])
    .filter((ship) => (
      ship.hp > 0
      && !ship.transit
      && ship.systemId === systemId
      && fleetFollowHome(state, ship, systemId)?.homeId === homeId
    ))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function nextFleetOrdinal(state, galaxyId = state.activeGalaxyId) {
  const groups = ensureBattleGroups(state).filter((g) => g.galaxyId === galaxyId);
  if (groups.length === 0) return 1;
  const max = Math.max(...groups.map((g) => g.ordinal ?? 0));
  return max + 1;
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

export function createBattleGroup(state, opts = {}) {
  const groups = ensureBattleGroups(state);
  const ordinal = nextFleetOrdinal(state);
  const group = {
    id: `bg-${nextBattleGroupId++}`,
    galaxyId: state.activeGalaxyId,
    ordinal,
    shipIds: [],
    anchorHeroId: null,
    anchorFlagship: false,
    /** Co-op: which pilot's flagship this fleet escorts when anchorFlagship. */
    anchorPilotId: null,
    // Co-op: creating pilot owns the fleet; null = shared team asset.
    ownerPlayerId: opts.ownerPlayerId ?? null,
    grantedControllers: [],
  };
  groups.push(group);
  return group;
}

export function deleteBattleGroup(state, groupId) {
  const idx = ensureBattleGroups(state).findIndex((g) => g.id === groupId);
  if (idx < 0) return { ok: false, reason: 'No such fleet' };
  const [removed] = ensureBattleGroups(state).splice(idx, 1);
  if ((removed.shipIds ?? []).includes(HELIOCLAST_ID)) {
    const heli = getHelioclastShip(state);
    if (heli) {
      heli.fleetMode = 'flagship';
      heli.battleGroupId = null;
    }
  }
  return { ok: true };
}

export function assignShipToGroup(state, shipId, groupId) {
  if (shipId === HELIOCLAST_ID) {
    const heli = getHelioclastShip(state);
    if (!heli || !isHelioclastMobile(state)) {
      return { ok: false, reason: 'Helioclast is not yet mobile' };
    }
    if (groupId == null) {
      removeShipFromAllGroups(state, shipId);
      heli.fleetMode = 'flagship';
      heli.battleGroupId = null;
      return { ok: true, groupId: null };
    }
    const group = findBattleGroup(state, groupId);
    if (!group) return { ok: false, reason: 'No such fleet' };
    if (group.galaxyId !== state.activeGalaxyId) {
      return { ok: false, reason: 'Fleet not in active galaxy' };
    }
    removeShipFromAllGroups(state, shipId, groupId);
    if (!group.shipIds.includes(shipId)) group.shipIds.push(shipId);
    heli.fleetMode = 'group';
    heli.battleGroupId = group.id;
    return { ok: true, groupId: group.id };
  }

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
    if (shipId === HELIOCLAST_ID) {
      const heli = getHelioclastShip(state);
      if (heli && heli.hp > 0 && heli.galaxyId === group.galaxyId) ships.push(heli);
      continue;
    }
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
  if (isHelioclastMobile(state) && (getHelioclastShip(state)?.hp ?? 0) > 0) {
    liveIds.add(HELIOCLAST_ID);
  }
  for (const group of ensureBattleGroups(state)) {
    group.shipIds = group.shipIds.filter((id) => liveIds.has(id));
  }
  const heli = state.superweapon?.ship;
  if (heli?.fleetMode === 'group') {
    const group = findBattleGroup(state, heli.battleGroupId);
    if (!group || !(group.shipIds ?? []).includes(HELIOCLAST_ID)) {
      heli.fleetMode = 'flagship';
      heli.battleGroupId = null;
    }
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
    const res = ship.id === HELIOCLAST_ID
      ? orderHelioclastTravel(state, targetId)
      : orderShipTravel(state, ship.id, targetId);
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
  if (heroId) group.anchorFlagship = false;
  return { ok: true, groupId, anchorHeroId: heroId };
}

/** Attach or detach a battle group from a pilot's flagship (issuer's in co-op). */
export function setBattleGroupFlagshipAnchor(state, groupId, anchored = true) {
  const group = findBattleGroup(state, groupId);
  if (!group) return { ok: false, reason: 'No such fleet' };
  const flagship = state.flagship;
  if (anchored && (!flagship || flagship.galaxyId !== group.galaxyId)) {
    return { ok: false, reason: 'Player flagship is not in this galaxy' };
  }
  group.anchorFlagship = !!anchored;
  if (group.anchorFlagship) {
    group.anchorHeroId = null;
    group.anchorPilotId = flagship?.pilotId ?? group.ownerPlayerId ?? null;
  } else {
    group.anchorPilotId = null;
  }
  return {
    ok: true,
    groupId,
    anchorFlagship: group.anchorFlagship,
    anchorPilotId: group.anchorPilotId,
  };
}

function shipDestinationId(ship) {
  return ship?.transit?.path?.[ship.transit.path.length - 1] ?? ship?.systemId ?? null;
}

function groupPreferredSystem(state, group) {
  const counts = new Map();
  for (const ship of shipsInBattleGroup(state, group.id)) {
    const systemId = shipDestinationId(ship);
    if (systemId) counts.set(systemId, (counts.get(systemId) ?? 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [systemId, count] of counts) {
    if (count > bestCount) {
      best = systemId;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Assign every live, unassigned ship in the active galaxy. Fleets are kept
 * compact and location-aware; a selected/preferred fleet is filled first.
 */
export function autoAssignShipsToFleets(state, options = {}) {
  const maxShipsPerFleet = Math.max(1, Math.floor(options.maxShipsPerFleet ?? 8));
  const ships = unassignedPlayerShips(state).sort((a, b) => {
    const loc = String(shipDestinationId(a) ?? '').localeCompare(String(shipDestinationId(b) ?? ''));
    return loc || a.id.localeCompare(b.id);
  });
  const createdGroupIds = [];
  if (ships.length === 0) {
    return { ok: true, assigned: 0, createdGroupIds, groupIds: [] };
  }

  let groups = battleGroupsForGalaxy(state);
  const preferred = options.preferredGroupId
    ? groups.find((group) => group.id === options.preferredGroupId)
    : null;
  if (groups.length === 0) {
    const group = createBattleGroup(state);
    createdGroupIds.push(group.id);
    groups = [group];
  }

  let assigned = 0;
  const touched = new Set();
  for (const ship of ships) {
    const systemId = shipDestinationId(ship);
    const available = groups.filter((group) => group.shipIds.length < maxShipsPerFleet);
    let target = null;
    if (preferred && preferred.shipIds.length < maxShipsPerFleet) target = preferred;
    if (!target) {
      target = available
        .filter((group) => groupPreferredSystem(state, group) === systemId)
        .sort((a, b) => a.shipIds.length - b.shipIds.length || a.ordinal - b.ordinal)[0] ?? null;
    }
    if (!target) {
      target = available.sort((a, b) => a.shipIds.length - b.shipIds.length || a.ordinal - b.ordinal)[0] ?? null;
    }
    if (!target) {
      target = createBattleGroup(state);
      groups.push(target);
      createdGroupIds.push(target.id);
    }
    const result = assignShipToGroup(state, ship.id, target.id);
    if (result.ok) {
      assigned++;
      touched.add(target.id);
    }
  }
  return {
    ok: true,
    assigned,
    createdGroupIds,
    groupIds: [...touched],
  };
}

/**
 * Keep flagship-anchored fleets converging on their pilot's current course.
 * The existing anchored-combat rules keep the fleet tactically attached while
 * slower hulls are still travelling. Wormhole arrival carries the anchored
 * group across galaxies as one command formation.
 */
export function syncFlagshipAnchoredFleets(state) {
  const events = [];

  for (const group of ensureBattleGroups(state).filter((entry) => entry.anchorFlagship)) {
    const pilotId = group.anchorPilotId ?? group.ownerPlayerId ?? state.flagship?.pilotId ?? null;
    const flagship = (pilotId ? getPlayerFlagship(state, pilotId) : null) ?? state.flagship;
    if (!flagship) continue;
    if (flagship.wormholeTransit) continue;

    const targetId = flagship.transit?.path?.[flagship.transit.path.length - 1]
      ?? flagship.systemId
      ?? null;

    if (group.galaxyId !== flagship.galaxyId) {
      group.galaxyId = flagship.galaxyId;
      for (const shipId of group.shipIds) {
        const ship = findPlayerShip(state, shipId);
        if (!ship || ship.hp <= 0) continue;
        ship.galaxyId = flagship.galaxyId;
        ship.transit = null;
        ship.systemId = flagship.systemId;
      }
      events.push({ type: 'flagship_anchor_wormhole_sync', groupId: group.id, galaxyId: flagship.galaxyId });
    }
    if (!targetId || group.galaxyId !== state.activeGalaxyId) continue;
    for (const ship of shipsInBattleGroup(state, group.id)) {
      if (shipDestinationId(ship) === targetId) continue;
      if (ship.transit || !ship.systemId) continue;
      const result = orderShipTravel(state, ship.id, targetId);
      if (result.ok) {
        events.push({ type: 'flagship_anchor_dispatch', groupId: group.id, shipId: ship.id, targetId });
      }
    }
  }
  return events;
}

/** Galaxy-map markers: one entry per fleet per stationed system. */
export function fleetMarkersForGalaxy(state, selectedBattleGroupId = null) {
  const markers = new Map();
  for (const group of battleGroupsForGalaxy(state)) {
    for (const shipId of group.shipIds) {
      const ship = findPlayerShip(state, shipId);
      if (!ship || ship.galaxyId !== state.activeGalaxyId || ship.hp <= 0) continue;
      if (ship.transit || !ship.systemId) continue;

      const key = `${group.id}:${ship.systemId}`;
      let marker = markers.get(key);
      if (!marker) {
        marker = {
          groupId: group.id,
          ordinal: group.ordinal,
          name: formatFleetName(group.ordinal),
          systemId: ship.systemId,
          shipCount: 0,
          power: 0,
          selected: group.id === selectedBattleGroupId,
        };
        markers.set(key, marker);
      }
      marker.shipCount++;
      marker.power += shipPower(ship, state);
    }
  }
  return [...markers.values()].map((m) => ({
    ...m,
    power: Math.round(m.power),
  }));
}

/** Lane keys (a|b) used by battle-group ships currently in transit. */
export function fleetTransitLaneKeys(state, selectedBattleGroupId = null) {
  const all = new Set();
  const selected = new Set();
  for (const group of battleGroupsForGalaxy(state)) {
    for (const shipId of group.shipIds) {
      const ship = findPlayerShip(state, shipId);
      if (!ship?.transit || ship.galaxyId !== state.activeGalaxyId) continue;
      const t = ship.transit;
      for (let i = t.legIndex; i < t.path.length - 1; i++) {
        const a = t.path[i];
        const b = t.path[i + 1];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        all.add(key);
        if (group.id === selectedBattleGroupId) selected.add(key);
      }
    }
  }
  return { all, selected };
}

/** Moving fleet badges — centroid of each group's in-transit ships on the lane graph. */
export function fleetTransitMarkersForGalaxy(state, selectedBattleGroupId = null) {
  const galaxy = getGraph(state);
  const out = [];
  for (const group of battleGroupsForGalaxy(state)) {
    const transiting = [];
    for (const shipId of group.shipIds) {
      const ship = findPlayerShip(state, shipId);
      if (!ship || ship.galaxyId !== state.activeGalaxyId || ship.hp <= 0 || !ship.transit) continue;
      transiting.push(ship);
    }
    if (transiting.length === 0) continue;

    let x = 0;
    let y = 0;
    let angle = 0;
    let power = 0;
    let placed = 0;
    let destId = null;
    for (const ship of transiting) {
      const status = playerShipStatus(ship, galaxy, state.time);
      if (!status) continue;
      x += status.x;
      y += status.y;
      angle += status.angle;
      power += shipPower(ship, state);
      destId = ship.transit.path[ship.transit.path.length - 1];
      placed++;
    }
    if (placed === 0) continue;

    out.push({
      groupId: group.id,
      ordinal: group.ordinal,
      name: formatFleetName(group.ordinal),
      x: x / placed,
      y: y / placed,
      angle: angle / placed,
      destId,
      shipCount: placed,
      power: Math.round(power),
      selected: group.id === selectedBattleGroupId,
      inTransit: true,
    });
  }
  return out;
}
