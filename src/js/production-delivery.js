// Delivery bridge for aggregate bulk-production orders.
//
// The production scheduler deliberately stops at a completed hull. This module
// turns its compact delivery records into real fleet assignments and travel
// orders without expanding the original manifest into hundreds of queue rows.

import {
  assignShipToGroup,
  createBattleGroup,
  findBattleGroup,
  shipsInBattleGroup,
} from './battle-groups.js';
import {
  listPendingBulkDeliveries,
  setBulkDeliveryStatus,
} from './bulk-production.js';
import { findPlayerShip, orderShipTravel } from './fleets.js';
import { findScout, orderScoutTravel } from './scout.js';
import { deployBuilderDrone } from './builder-drones.js';

function transitDestination(entity) {
  return entity?.transit?.path?.[entity.transit.path.length - 1] ?? entity?.systemId ?? null;
}

function fleetDestination(state, fleetId, excludingShipId = null) {
  const group = findBattleGroup(state, fleetId);
  if (!group) return null;
  const counts = new Map();
  for (const ship of shipsInBattleGroup(state, fleetId)) {
    if (ship.id === excludingShipId) continue;
    const systemId = transitDestination(ship);
    if (!systemId) continue;
    counts.set(systemId, (counts.get(systemId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function existingDeliveryFleet(state, delivery) {
  if (delivery.assignedFleetId && findBattleGroup(state, delivery.assignedFleetId)) {
    return delivery.assignedFleetId;
  }
  return (state.bulkProductionDeliveries ?? []).find((candidate) => (
    candidate.id !== delivery.id
      && candidate.groupKey === delivery.groupKey
      && candidate.assignedFleetId
      && findBattleGroup(state, candidate.assignedFleetId)
  ))?.assignedFleetId ?? null;
}

function assignDeliveryFleet(state, delivery, ship) {
  const packaging = delivery.packaging ?? { mode: 'unassigned' };
  if (!ship || packaging.mode === 'unassigned') return { ok: true, fleetId: null };

  let fleetId = null;
  if (packaging.mode === 'reinforce') {
    fleetId = packaging.fleetId ?? delivery.rally?.fleetId ?? null;
    if (!fleetId || !findBattleGroup(state, fleetId)) {
      return { ok: false, reason: 'Reinforcement fleet no longer exists' };
    }
  } else if (packaging.mode === 'single_fleet' || packaging.mode === 'new_fleets') {
    fleetId = existingDeliveryFleet(state, delivery);
    if (!fleetId) fleetId = createBattleGroup(state).id;
  }

  if (!fleetId) return { ok: true, fleetId: null };
  const result = assignShipToGroup(state, ship.id, fleetId);
  if (!result.ok) return result;
  return { ok: true, fleetId };
}

function rallyTarget(state, delivery, ship, assignedFleetId) {
  const rally = delivery.rally ?? { type: 'none' };
  if (rally.type === 'none') return null;
  if (rally.type === 'system') return rally.systemId ?? null;
  if (rally.type === 'flagship') {
    return state.flagship?.transit?.path?.[state.flagship.transit.path.length - 1]
      ?? state.flagship?.systemId
      ?? null;
  }
  if (rally.type === 'fleet') {
    const fleetId = rally.fleetId ?? assignedFleetId;
    return fleetDestination(state, fleetId, ship?.id ?? null);
  }
  return null;
}

function routeDeliveryEntity(state, delivery, ship, scout, drone, targetSystemId) {
  const entity = ship ?? scout ?? drone;
  if (!entity) return { ok: false, reason: 'Completed unit no longer exists' };
  if (drone) {
    if (!targetSystemId || (!drone.transit && drone.systemId === targetSystemId)) {
      return { ok: true, arrived: true, systemId: drone.systemId ?? targetSystemId ?? null };
    }
    if (drone.status === 'outbound' && drone.targetSystemId === targetSystemId) {
      return { ok: true, inTransit: true, systemId: targetSystemId };
    }
    if (drone.status !== 'idle') return { ok: false, reason: `Drone is ${drone.status}` };
    const result = deployBuilderDrone(state, targetSystemId, drone.id);
    return result.ok
      ? { ok: true, inTransit: true, systemId: targetSystemId }
      : { ok: false, reason: result.reason ?? 'Unable to deploy completed drone' };
  }
  if (!targetSystemId) return { ok: true, arrived: true, systemId: entity.systemId ?? null };

  const currentTarget = transitDestination(entity);
  if (entity.transit && currentTarget === targetSystemId) {
    return { ok: true, inTransit: true, systemId: targetSystemId };
  }
  if (!entity.transit && entity.systemId === targetSystemId) {
    return { ok: true, arrived: true, systemId: targetSystemId };
  }
  if (entity.transit) {
    return { ok: false, reason: `Unit is already travelling to ${currentTarget ?? 'another system'}` };
  }

  const result = ship
    ? orderShipTravel(state, ship.id, targetSystemId)
    : orderScoutTravel(state, scout.id, targetSystemId);
  return result.ok
    ? { ok: true, inTransit: true, systemId: targetSystemId }
    : { ok: false, reason: result.reason ?? 'Unable to route completed unit' };
}

/** Process all outstanding deliveries and return only status-changing events. */
export function tickBulkDeliveries(state) {
  const events = [];
  for (const delivery of listPendingBulkDeliveries(state)) {
    const ship = delivery.shipId ? findPlayerShip(state, delivery.shipId) : null;
    const scout = delivery.scoutId ? findScout(state, delivery.scoutId) : null;
    const drone = delivery.droneId
      ? (state.builderDrones ?? []).find((entry) => entry.id === delivery.droneId) ?? null
      : null;

    const previousFleetId = delivery.assignedFleetId ?? null;
    const assignment = assignDeliveryFleet(state, delivery, ship);
    if (!assignment.ok) {
      if (delivery.status !== 'blocked' || delivery.blockedReason !== assignment.reason) {
        setBulkDeliveryStatus(state, delivery.id, 'blocked', { reason: assignment.reason });
        events.push({ type: 'bulk_delivery_blocked', deliveryId: delivery.id, reason: assignment.reason });
      }
      continue;
    }

    let fleetId = assignment.fleetId ?? previousFleetId;
    if (drone && !fleetId) {
      if (delivery.packaging?.mode === 'reinforce') {
        const candidate = delivery.packaging.fleetId ?? delivery.rally?.fleetId ?? null;
        if (candidate && findBattleGroup(state, candidate)) fleetId = candidate;
      } else if (['single_fleet', 'new_fleets'].includes(delivery.packaging?.mode)) {
        fleetId = existingDeliveryFleet(state, delivery);
      }
    }
    if (drone && fleetId) {
      drone.status = 'embarked';
      drone.systemId = null;
      drone.transit = null;
      drone.targetSystemId = null;
      drone.assignedFleetId = fleetId;
      setBulkDeliveryStatus(state, delivery.id, 'delivered', { assignedFleetId: fleetId });
      events.push({
        type: 'bulk_delivery_complete',
        deliveryId: delivery.id,
        droneId: drone.id,
        fleetId,
        systemId: null,
      });
      continue;
    }
    const targetSystemId = rallyTarget(state, delivery, ship ?? drone, fleetId);
    const routed = routeDeliveryEntity(state, delivery, ship, scout, drone, targetSystemId);
    if (!routed.ok) {
      if (delivery.status !== 'blocked' || delivery.blockedReason !== routed.reason) {
        setBulkDeliveryStatus(state, delivery.id, 'blocked', {
          assignedFleetId: fleetId,
          reason: routed.reason,
        });
        events.push({ type: 'bulk_delivery_blocked', deliveryId: delivery.id, reason: routed.reason });
      }
      continue;
    }

    const arrived = routed.arrived
      || (!ship?.transit && !scout?.transit && !drone?.transit
        && (ship?.systemId ?? scout?.systemId ?? drone?.systemId) === targetSystemId);
    const nextStatus = arrived ? 'delivered' : 'in_transit';
    if (delivery.status !== nextStatus || previousFleetId !== fleetId) {
      setBulkDeliveryStatus(state, delivery.id, nextStatus, {
        assignedFleetId: fleetId,
        systemId: routed.systemId ?? targetSystemId ?? ship?.systemId ?? scout?.systemId ?? null,
      });
      events.push({
        type: arrived ? 'bulk_delivery_complete' : 'bulk_delivery_dispatched',
        deliveryId: delivery.id,
        shipId: delivery.shipId,
        scoutId: delivery.scoutId,
        droneId: delivery.droneId,
        fleetId,
        systemId: routed.systemId ?? targetSystemId ?? null,
      });
    }
  }
  return events;
}
