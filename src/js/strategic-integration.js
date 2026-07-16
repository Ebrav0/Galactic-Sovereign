// Live-system adapter for persistent strategic expansion campaigns.
//
// strategic-operations.js owns deterministic campaign state. This file binds
// those phases to the game's actual scouts, diplomacy, bulk docks, fleets,
// combat, capture, builder drones, and anchored wormhole travel.

import {
  assignShipToGroup,
  battleGroupsForGalaxy,
  createBattleGroup,
  findBattleGroup,
  orderBattleGroupTravel,
  setBattleGroupFlagshipAnchor,
  shipsInBattleGroup,
} from './battle-groups.js';
import {
  confirmBuilderConstructionPlan,
  deployBuilderDrone,
  initBuilderDrones,
} from './builder-drones.js';
import {
  bulkProductionSummary,
  cancelBulkProductionOrder,
  createBulkProductionOrder,
} from './bulk-production.js';
import {
  canAttackSystem,
  canRouteThroughSystem,
  declareWar,
  getActiveWar,
  routeLegality,
} from './diplomacy.js';
import {
  captureForceInSystem,
  captureProgressMs,
  captureRequirement,
  enemyCombatPresence,
} from './capture.js';
import { battleSummaryForSystem, checkBattleTrigger, getBattleState } from './combat.js';
import { fleetPower, shipPower } from './fleet-power.js';
import { findPlayerShip } from './fleets.js';
import { getGraph, getSystems, wormholeIdForGalaxy } from './galaxy-scope.js';
import { captureForceForShip, hullStats, isCombatHull } from './hull.js';
import { hasIntel } from './intel.js';
import { findScout, orderScoutTravel } from './scout.js';
import {
  strategicOrdersSummary,
  tickStrategicOperations,
} from './strategic-operations.js';
import { empireQueueHulls } from './tech-web.js';
import { orderTravel as orderFlagshipTravel } from './flagship.js';
import { orderWormholeTravel } from './wormholes.js';
import {
  BUILDER_DRONE_PRODUCT_ID,
  PRODUCTION_KIND_BUILDER_DRONE,
  productionProductDefinition,
} from './production-products.js';

const MAX_AUTOMATED_FLEET_SIZE = 40;

const FALLBACK_ROLES = Object.freeze(['escort', 'line']);

function doctrineForCampaign(campaign) {
  return campaign?.operationDoctrine ?? campaign?.templateSnapshot?.doctrine ?? {
    captureForceMultiplier: 1.2,
    combatPowerMultiplier: 1.35,
    dronePayload: 2,
    campaignReserveDrones: 1,
    roleMix: { escort: 0.6, line: 0.25, support: 0.15 },
    preferredHulls: {
      escort: ['frigate', 'patrol_cutter', 'corvette'],
      line: ['dreadnought', 'battleship', 'cruiser', 'destroyer'],
      support: ['command_cruiser', 'healer', 'sensor_ship', 'builder_ship'],
    },
    roleMinimums: {},
  };
}

function operationHullSet(doctrine) {
  return new Set(Object.values(doctrine.preferredHulls ?? {}).flat());
}

function plannedShip(hull) {
  const stats = hullStats(hull);
  return stats ? { hull, hp: stats.hp, maxHp: stats.hp } : null;
}

function roleForHull(hull, doctrine) {
  for (const [role, hulls] of Object.entries(doctrine.preferredHulls ?? {})) {
    if (hulls.includes(hull)) return role;
  }
  return null;
}

function availableDronePool(state, campaign, target = null) {
  const sourceId = sourceSystemId(campaign);
  const reserved = new Set(campaign.reserveDroneIds ?? []);
  return (state.builderDrones ?? []).filter((drone) => {
    if (reserved.has(drone.id)) return false;
    if (drone.galaxyId !== (target?.galaxyId ?? campaign.source?.galaxyId)) return false;
    if (drone.strategicCampaignId && drone.strategicCampaignId !== campaign.id) return false;
    if (drone.strategicTargetId && drone.strategicTargetId !== target?.id) return false;
    if (drone.status === 'embarked') return drone.strategicCampaignId === campaign.id;
    return drone.status === 'idle' && drone.systemId === sourceId;
  });
}

function campaignReservePool(state, campaign) {
  const reserveIds = new Set(campaign.reserveDroneIds ?? []);
  return (state.builderDrones ?? []).filter((drone) => (
    reserveIds.has(drone.id)
      && drone.strategicCampaignId === campaign.id
      && !drone.strategicTargetId
  ));
}

function assignCampaignReserve(state, campaign) {
  campaign.reserveDroneIds ??= [];
  const required = Math.max(0, Math.floor(doctrineForCampaign(campaign).campaignReserveDrones ?? 1));
  campaign.reserveDroneIds = campaignReservePool(state, campaign).map((drone) => drone.id);
  const sourceId = sourceSystemId(campaign);
  while (campaign.reserveDroneIds.length < required) {
    const drone = (state.builderDrones ?? []).find((entry) => (
      entry.status === 'idle'
      && entry.systemId === sourceId
      && entry.galaxyId === campaign.source?.galaxyId
      && !entry.strategicTargetId
      && (!entry.strategicCampaignId || entry.strategicCampaignId === campaign.id)
      && !campaign.reserveDroneIds.includes(entry.id)
    ));
    if (!drone) break;
    drone.strategicCampaignId = campaign.id;
    drone.strategicTargetId = null;
    drone.assignedFleetId = null;
    campaign.reserveDroneIds.push(drone.id);
  }
  return { required, available: campaignReservePool(state, campaign).length };
}

function operationPackagePlan(state, {
  campaign,
  target,
  assessment,
  doctrine = doctrineForCampaign(campaign),
  includeReserve = false,
  preview = false,
  ignoreExistingAssets = false,
}) {
  const unlocked = new Set(empireQueueHulls(state));
  const substitutions = [];
  const roleCandidates = {};
  const effectiveMix = { ...(doctrine.roleMix ?? {}) };
  for (const role of Object.keys(effectiveMix)) {
    const candidate = (doctrine.preferredHulls?.[role] ?? []).find((hull) => unlocked.has(hull));
    if (candidate) {
      roleCandidates[role] = candidate;
      continue;
    }
    const fallbackRoles = FALLBACK_ROLES.filter((entry) => (
      (doctrine.preferredHulls?.[entry] ?? []).some((hull) => unlocked.has(hull))
    ));
    if (fallbackRoles.length > 0) {
      const redistributed = effectiveMix[role] / fallbackRoles.length;
      for (const fallbackRole of fallbackRoles) {
        effectiveMix[fallbackRole] = (effectiveMix[fallbackRole] ?? 0) + redistributed;
      }
      substitutions.push({
        role,
        fallbackRole: fallbackRoles.join('+'),
        fallbackRoles,
        reason: `No unlocked ${role} hull`,
      });
    }
    delete effectiveMix[role];
  }
  for (const role of Object.keys(effectiveMix)) {
    roleCandidates[role] ??= (doctrine.preferredHulls?.[role] ?? []).find((hull) => unlocked.has(hull));
  }

  const existing = ignoreExistingAssets ? [] : availableShips(state, campaign, target);
  const existingCounts = {};
  for (const ship of existing) {
    const role = roleForHull(ship.hull, doctrine);
    if (role) existingCounts[role] = (existingCounts[role] ?? 0) + 1;
  }
  let capturePower = forceSummary(state, existing).capturePower;
  let combatPower = forceSummary(state, existing).combatPower;
  const additions = [];
  const addRole = (role) => {
    const hull = roleCandidates[role];
    if (!hull) return false;
    additions.push(hull);
    const ship = plannedShip(hull);
    capturePower += captureForceForShip(ship);
    combatPower += shipPower(ship, state);
    return true;
  };

  for (const [role, minimum] of Object.entries(doctrine.roleMinimums ?? {})) {
    if (!roleCandidates[role]) continue;
    const missing = Math.max(0, minimum - (existingCounts[role] ?? 0));
    for (let index = 0; index < missing; index += 1) addRole(role);
  }
  const roles = Object.keys(effectiveMix).sort();
  let guard = 0;
  while ((capturePower < assessment.requiredCaptureForce || combatPower < assessment.requiredCombatPower)
      && additions.length < 200 && guard++ < 400) {
    const total = Math.max(1, existing.length + additions.length);
    let selectedRole = roles[0];
    let selectedDeficit = -Infinity;
    for (const role of roles) {
      const count = (existingCounts[role] ?? 0)
        + additions.filter((hull) => roleForHull(hull, doctrine) === role).length;
      const deficit = (effectiveMix[role] ?? 0) - count / total;
      if (deficit > selectedDeficit || (deficit === selectedDeficit && role < selectedRole)) {
        selectedDeficit = deficit;
        selectedRole = role;
      }
    }
    if (!addRole(selectedRole)) break;
  }

  const byHull = new Map();
  for (const hull of additions) byHull.set(hull, (byHull.get(hull) ?? 0) + 1);
  const requiredDrones = Math.max(1, Math.floor(doctrine.dronePayload ?? 2));
  const rawAvailableDrones = availableDronePool(state, campaign, target).length;
  const reserveState = preview
    ? {
      required: Math.max(0, Math.floor(doctrine.campaignReserveDrones ?? 1)),
      available: Math.min(
        Math.max(0, Math.floor(doctrine.campaignReserveDrones ?? 1)),
        rawAvailableDrones,
      ),
    }
    : assignCampaignReserve(state, campaign);
  const availableDrones = preview && includeReserve
    ? Math.max(0, rawAvailableDrones - reserveState.available)
    : rawAvailableDrones;
  const reserveShortfall = includeReserve
    ? Math.max(0, reserveState.required - reserveState.available)
    : 0;
  const droneShortfall = Math.max(0, requiredDrones - availableDrones);
  const productionDroneShortfall = droneShortfall + reserveShortfall;
  const manifest = [...byHull.entries()].map(([hull, quantity]) => ({
    kind: 'hull', productId: hull, hull, quantity,
  }));
  if (productionDroneShortfall > 0) {
    manifest.push({
      kind: PRODUCTION_KIND_BUILDER_DRONE,
      productId: BUILDER_DRONE_PRODUCT_ID,
      hull: null,
      quantity: productionDroneShortfall,
    });
  }
  const costedManifest = manifest.map((line) => ({
    ...line,
    unitCost: productionProductDefinition(state, line).cost ?? 0,
  }));
  const productionCost = costedManifest.reduce((total, line) => {
    return total + line.unitCost * line.quantity;
  }, 0);
  const combined = [...existing, ...additions.map(plannedShip).filter(Boolean)];
  const roleReady = Object.entries(doctrine.roleMinimums ?? {}).every(([role, minimum]) => {
    if (!roleCandidates[role]) return true;
    return combined.filter((ship) => roleForHull(ship.hull, doctrine) === role).length >= minimum;
  });
  return {
    manifest: costedManifest,
    roleSubstitutions: substitutions,
    requiredDrones,
    availableDrones,
    droneShortfall,
    reserveDrones: reserveState,
    productionDroneShortfall,
    droneReady: droneShortfall === 0 && reserveState.available >= reserveState.required,
    roleReady,
    projectedCapturePower: Math.round(capturePower),
    projectedCombatPower: Math.round(combatPower),
    productionCost,
  };
}

function systemFaction(system) {
  if (!system || system.owner === 'neutral' || system.owner === 'player') return null;
  return system.factionId ?? (system.owner === 'ai' ? 'ai-0' : system.owner);
}

function entityDestination(entity) {
  return entity?.transit?.path?.[entity.transit.path.length - 1] ?? entity?.systemId ?? null;
}

function sourceSystemId(campaign) {
  return campaign.source?.systemId ?? null;
}

function shipAvailableForCampaign(state, ship, campaign, target) {
  const doctrine = doctrineForCampaign(campaign);
  const eligibleHulls = operationHullSet(doctrine);
  if (!ship || ship.hp <= 0 || (!isCombatHull(ship.hull) && !eligibleHulls.has(ship.hull)) || ship.transit) return false;
  if (ship.galaxyId !== campaign.source?.galaxyId && ship.galaxyId !== target.galaxyId) return false;
  if (state.systemBattles?.[ship.systemId]?.active) return false;
  if (ship.strategicTargetId && ship.strategicTargetId !== target.id) return false;
  if (ship.strategicCampaignId && ship.strategicCampaignId !== campaign.id) return false;
  if (ship.strategicCampaignId === campaign.id) return true;
  return ship.systemId === sourceSystemId(campaign);
}

function availableShips(state, campaign, target) {
  return (state.playerShips ?? []).filter((ship) => shipAvailableForCampaign(state, ship, campaign, target));
}

function forceSummary(state, ships) {
  return {
    capturePower: ships.reduce((sum, ship) => sum + captureForceForShip(ship), 0),
    combatPower: fleetPower(ships, state),
  };
}

function campaignOrderIds(campaign) {
  return new Set(campaign.linkedBulkOrderIds ?? []);
}

function requestScout(state, { campaign, target }) {
  const existing = (state.scouts ?? []).find((scout) => (
    scout.galaxyId === target.galaxyId && !scout.transit && scout.systemId
  ));
  if (existing) {
    if (existing.systemId === target.systemId) return { ok: true, scoutId: existing.id, complete: true };
    const dispatch = orderScoutTravel(state, existing.id, target.systemId);
    return dispatch.ok
      ? { ok: true, scoutId: existing.id, status: 'dispatched' }
      : dispatch;
  }

  const order = createBulkProductionOrder(state, {
    name: `${campaign.name} reconnaissance`,
    manifest: [{ hull: 'scout', quantity: 1 }],
    priority: 'high',
    protectedReserve: campaign.budget?.reserve ?? 0,
    rally: { type: 'system', systemId: target.systemId },
    packaging: { mode: 'unassigned' },
    linkedCampaignId: campaign.id,
  });
  if (!order.ok) return { ok: false, reason: order.reason, code: 'scout_requisition_failed' };
  if (!campaign.linkedBulkOrderIds.includes(order.order.id)) campaign.linkedBulkOrderIds.push(order.order.id);
  return { ok: true, id: order.order.id, status: 'pending' };
}

function scoutStatus(state, { target, scout }) {
  if (hasIntel(state, target.systemId)) return { ok: true, complete: true, status: 'complete' };
  const live = findScout(state, scout.id);
  if (live) return { ok: true, status: live.transit ? 'dispatched' : 'pending' };
  const delivery = (state.bulkProductionDeliveries ?? []).find((entry) => (
    entry.bulkOrderId === scout.id && entry.scoutId
  ));
  if (!delivery) {
    const summary = bulkProductionSummary(state, scout.id);
    if (!summary) return { ok: false, status: 'failed', reason: 'Scout requisition was lost' };
    return { ok: true, status: summary.status === 'cancelled' ? 'failed' : 'pending' };
  }
  const produced = findScout(state, delivery.scoutId);
  return produced
    ? { ok: true, status: produced.transit ? 'dispatched' : 'pending' }
    : { ok: false, status: 'failed', reason: 'Completed scout is unavailable' };
}

function assessTarget(state, { campaign, target }) {
  const ships = availableShips(state, campaign, target);
  const available = forceSummary(state, ships);
  const assessment = {
    ok: true,
    requiredCaptureForce: target.requirements?.captureForce ?? captureRequirement(state, target.systemId),
    requiredCombatPower: target.requirements?.combatPower ?? enemyCombatPresence(state, target.systemId),
    hostileCombatPower: enemyCombatPresence(state, target.systemId),
    availableCaptureForce: available.capturePower,
    availableCombatPower: available.combatPower,
  };
  const packagePlan = operationPackagePlan(state, { campaign, target, assessment });
  return { ...assessment, ...packagePlan };
}

function requestRequisition(state, context) {
  const { campaign, target, assessment } = context;
  const reserve = assignCampaignReserve(state, campaign);
  const reserveOrder = campaign.reserveDroneOrderId
    ? bulkProductionSummary(state, campaign.reserveDroneOrderId)
    : null;
  const includeReserve = reserve.available < reserve.required
    && (!reserveOrder || ['complete', 'cancelled'].includes(reserveOrder.storedStatus));
  const packagePlan = operationPackagePlan(state, {
    campaign,
    target,
    assessment,
    includeReserve,
  });
  if (packagePlan.manifest.length === 0) {
    return {
      ok: true,
      complete: true,
      status: 'complete',
      capturePower: assessment.availableCaptureForce,
      combatPower: assessment.availableCombatPower,
      requiredDrones: packagePlan.requiredDrones,
      manifest: [],
    };
  }
  const result = createBulkProductionOrder(state, {
    name: `${campaign.name} · ${target.systemName ?? target.systemId} task force`,
    manifest: packagePlan.manifest,
    priority: 'high',
    budgetCap: campaign.budget?.limit == null
      ? null
      : Math.max(0, campaign.budget.limit - campaign.budget.spent),
    protectedReserve: campaign.budget?.reserve ?? 0,
    rally: { type: 'system', systemId: sourceSystemId(campaign) },
    packaging: { mode: 'new_fleets', splitSize: MAX_AUTOMATED_FLEET_SIZE },
    linkedCampaignId: campaign.id,
  });
  if (!result.ok) return { ok: false, reason: result.reason, code: 'bulk_requisition_failed' };
  if (!campaign.linkedBulkOrderIds.includes(result.order.id)) campaign.linkedBulkOrderIds.push(result.order.id);
  if (packagePlan.reserveDrones?.required > packagePlan.reserveDrones?.available) {
    campaign.reserveDroneRequested = true;
    campaign.reserveDroneOrderId = result.order.id;
  }
  return {
    ok: true,
    requisitionId: result.order.id,
    bulkOrderId: result.order.id,
    status: 'pending',
    capturePower: 0,
    combatPower: 0,
    requiredDrones: packagePlan.requiredDrones,
    manifest: packagePlan.manifest,
  };
}

function requisitionStatus(state, { campaign, target, requisition, assessment }) {
  const reserve = assignCampaignReserve(state, campaign);
  const reserveOrder = campaign.reserveDroneOrderId
    ? bulkProductionSummary(state, campaign.reserveDroneOrderId)
    : null;
  const includeReserve = reserve.available < reserve.required
    && (!reserveOrder || ['complete', 'cancelled'].includes(reserveOrder.storedStatus));
  const ships = availableShips(state, campaign, target);
  const force = forceSummary(state, ships);
  const packagePlan = operationPackagePlan(state, {
    campaign,
    target,
    assessment,
    includeReserve,
  });
  const ready = force.capturePower >= assessment.requiredCaptureForce
    && force.combatPower >= assessment.requiredCombatPower
    && packagePlan.droneReady
    && packagePlan.roleReady;
  if (ready) {
    return {
      ok: true,
      complete: true,
      status: 'complete',
      capturePower: force.capturePower,
      combatPower: force.combatPower,
      bulkOrderIds: requisition.bulkOrderIds ?? [requisition.id].filter(Boolean),
      requiredDrones: packagePlan.requiredDrones,
      manifest: packagePlan.manifest,
    };
  }
  const summaries = (requisition.bulkOrderIds ?? [requisition.id])
    .filter(Boolean)
    .map((id) => bulkProductionSummary(state, id))
    .filter(Boolean);
  if (summaries.some((summary) => summary.storedStatus === 'cancelled')) {
    return { ok: false, status: 'failed', reason: 'Fleet requisition was cancelled' };
  }
  if (summaries.length > 0
      && summaries.every((summary) => summary.storedStatus === 'complete')
      && packagePlan.manifest.length > 0) {
    const replacement = createBulkProductionOrder(state, {
      name: `${campaign.name} · ${target.systemName ?? target.systemId} replacements`,
      manifest: packagePlan.manifest,
      priority: 'high',
      budgetCap: campaign.budget?.limit == null
        ? null
        : Math.max(0, campaign.budget.limit - campaign.budget.spent),
      protectedReserve: campaign.budget?.reserve ?? 0,
      rally: { type: 'system', systemId: sourceSystemId(campaign) },
      packaging: { mode: 'new_fleets', splitSize: MAX_AUTOMATED_FLEET_SIZE },
      linkedCampaignId: campaign.id,
    });
    if (!replacement.ok) return { ok: false, status: 'failed', reason: replacement.reason };
    requisition.bulkOrderIds ??= [requisition.id].filter(Boolean);
    requisition.bulkOrderIds.push(replacement.order.id);
    if (!campaign.linkedBulkOrderIds.includes(replacement.order.id)) {
      campaign.linkedBulkOrderIds.push(replacement.order.id);
    }
    if (includeReserve) {
      campaign.reserveDroneRequested = true;
      campaign.reserveDroneOrderId = replacement.order.id;
    }
    return {
      ok: true,
      status: 'pending',
      replacementPending: true,
      bulkOrderIds: requisition.bulkOrderIds,
    };
  }
  return { ok: true, status: 'pending', capturePower: force.capturePower, combatPower: force.combatPower };
}

function previewRoute(state, { path, spec, to }) {
  const authorizations = spec?.warAuthorizations ?? spec?.authorizedWars ?? [];
  const authorized = new Set((Array.isArray(authorizations) ? authorizations : Object.keys(authorizations))
    .map((entry) => typeof entry === 'string' ? entry : entry?.factionId)
    .filter(Boolean));
  for (let index = 1; index < path.length; index += 1) {
    const system = getSystems(state, to.galaxyId)[path[index]];
    const factionId = systemFaction(system);
    if (factionId && authorized.has(factionId)) continue;
    const result = canRouteThroughSystem(state, system ?? path[index], 'player', {
      galaxyId: to.galaxyId,
      allowHostile: true,
    });
    if (!result.ok) return { ok: false, code: 'route_illegal', reason: `${path[index]}: ${result.reason}` };
  }
  return { ok: true, target: to.systemId ?? path.at(-1) };
}

function diplomacyCheck(state, { campaign, target, system, route }) {
  const factionId = systemFaction(system);
  const requiredWars = new Map();
  for (const systemId of (route ?? []).slice(1)) {
    const routeSystem = getSystems(state, target.galaxyId)[systemId];
    const routeFactionId = systemFaction(routeSystem);
    if (!routeFactionId || getActiveWar(state, routeFactionId)) continue;
    const transit = canRouteThroughSystem(state, routeSystem ?? systemId, 'player', {
      galaxyId: target.galaxyId,
      allowHostile: true,
    });
    if (transit.ok) continue;
    const authorization = campaign.warAuthorizations?.[routeFactionId];
    if (!authorization?.authorized) {
      return {
        ok: false,
        canTravel: false,
        code: 'war_authorization_required',
        reason: `Route through ${systemId} requires authorization against ${routeFactionId}`,
      };
    }
    requiredWars.set(routeFactionId, {
      factionId: routeFactionId,
      warGoal: authorization.warGoal,
      systemId,
    });
  }
  if (factionId && !getActiveWar(state, factionId) && !requiredWars.has(factionId)) {
    const authorization = campaign.warAuthorizations?.[factionId];
    if (!authorization?.authorized) {
      return { ok: false, canTravel: false, code: 'war_authorization_required', reason: `War against ${factionId} is not authorized` };
    }
    requiredWars.set(factionId, {
      factionId,
      warGoal: authorization.warGoal,
      systemId: target.systemId,
    });
  }
  if (requiredWars.size > 0) {
    return { ok: true, canTravel: false, requiresWars: [...requiredWars.values()], factionId };
  }
  const legality = routeLegality(state, (route ?? []).slice(1), 'player', {
    galaxyId: target.galaxyId,
    allowHostile: true,
  });
  if (!legality.ok) return { ok: false, canTravel: false, code: 'route_illegal', reason: legality.reason };
  const attack = canAttackSystem(state, system, 'player');
  return attack.ok || system.owner === 'neutral'
    ? { ok: true, canTravel: true, atWar: !!factionId, factionId }
    : { ok: false, canTravel: false, reason: attack.reason, factionId };
}

function declareCampaignWar(state, { campaign, target, factionId, warGoal, warTargetSystemId }) {
  const result = declareWar(state, factionId, {
    attacker: 'player',
    goals: [{ type: warGoal, systemIds: [warTargetSystemId ?? target.systemId] }],
    authorizedByCampaignId: campaign.id,
  });
  return result.ok ? { ok: true, warId: result.war.id } : result;
}

function groupEligibleAtSource(state, group, eligibleIds) {
  const ships = shipsInBattleGroup(state, group.id);
  return ships.length > 0 && ships.every((ship) => eligibleIds.has(ship.id));
}

function reserveGroup(state, groupId, campaign, target) {
  for (const ship of shipsInBattleGroup(state, groupId)) {
    ship.strategicCampaignId = campaign.id;
    ship.strategicTargetId = target.id;
  }
}

function selectDispatchGroups(state, campaign, target, assessment) {
  const eligible = availableShips(state, campaign, target);
  const doctrine = doctrineForCampaign(campaign);
  const unlocked = new Set(empireQueueHulls(state));
  const eligibleIds = new Set(eligible.map((ship) => ship.id));
  const selected = [];
  const selectedShipIds = new Set();
  let capturePower = 0;
  let combatPower = 0;
  const rolesReady = () => Object.entries(doctrine.roleMinimums ?? {}).every(([role, minimum]) => {
    const roleAvailable = (doctrine.preferredHulls?.[role] ?? []).some((hull) => unlocked.has(hull));
    if (!roleAvailable) return true;
    return eligible.filter((ship) => selectedShipIds.has(ship.id) && roleForHull(ship.hull, doctrine) === role).length >= minimum;
  });
  const meetsThreshold = () => capturePower >= assessment.requiredCaptureForce
    && combatPower >= assessment.requiredCombatPower
    && rolesReady();

  const groups = battleGroupsForGalaxy(state, target.galaxyId)
    .filter((group) => groupEligibleAtSource(state, group, eligibleIds))
    .sort((a, b) => fleetPower(shipsInBattleGroup(state, b.id), state)
      - fleetPower(shipsInBattleGroup(state, a.id), state));
  const groupedIds = new Set();
  for (const group of groups) {
    if (meetsThreshold()) break;
    const ships = shipsInBattleGroup(state, group.id);
    selected.push(group.id);
    ships.forEach((ship) => {
      groupedIds.add(ship.id);
      selectedShipIds.add(ship.id);
    });
    const force = forceSummary(state, ships);
    capturePower += force.capturePower;
    combatPower += force.combatPower;
  }

  const ungrouped = eligible
    .filter((ship) => !groupedIds.has(ship.id))
    .sort((a, b) => shipPower(b, state) - shipPower(a, state));
  while (!meetsThreshold() && ungrouped.length) {
    const group = createBattleGroup(state);
    const batch = ungrouped.splice(0, MAX_AUTOMATED_FLEET_SIZE);
    for (const ship of batch) assignShipToGroup(state, ship.id, group.id);
    batch.forEach((ship) => selectedShipIds.add(ship.id));
    selected.push(group.id);
    const force = forceSummary(state, batch);
    capturePower += force.capturePower;
    combatPower += force.combatPower;
  }
  return { groupIds: selected, capturePower, combatPower, ready: meetsThreshold() };
}

function groupSystemIds(state, groupIds) {
  return new Set(groupIds.flatMap((groupId) => (
    shipsInBattleGroup(state, groupId).map((ship) => ship.systemId).filter(Boolean)
  )));
}

function reserveAndEmbarkDroneTeam(state, campaign, target, groupIds) {
  initBuilderDrones(state);
  const required = Math.max(1, Math.floor(campaign.operationDoctrine?.dronePayload ?? 2));
  const systems = groupSystemIds(state, groupIds);
  const reserveIds = new Set(campaign.reserveDroneIds ?? []);
  const alreadyAssigned = (state.builderDrones ?? []).filter((drone) => (
    drone.strategicCampaignId === campaign.id && drone.strategicTargetId === target.id
  ));
  const candidates = [
    ...alreadyAssigned,
    ...(state.builderDrones ?? []).filter((drone) => {
      if (alreadyAssigned.includes(drone)) return false;
      if (drone.galaxyId !== target.galaxyId) return false;
      if (drone.strategicCampaignId && drone.strategicCampaignId !== campaign.id) return false;
      if (drone.strategicTargetId) return false;
      if (drone.status === 'embarked') {
        if (!drone.assignedFleetId) return false;
        return groupIds.includes(drone.assignedFleetId)
          || shipsInBattleGroup(state, drone.assignedFleetId).some((ship) => systems.has(ship.systemId));
      }
      return drone.status === 'idle' && systems.has(drone.systemId);
    }).sort((a, b) => Number(reserveIds.has(a.id)) - Number(reserveIds.has(b.id))),
  ].slice(0, required);
  if (candidates.length < required) {
    return {
      ok: false,
      code: 'drone_payload_shortfall',
      reason: `Task force requires ${required} construction drones; ${candidates.length} are ready`,
    };
  }
  candidates.forEach((drone, index) => {
    campaign.reserveDroneIds = (campaign.reserveDroneIds ?? []).filter((id) => id !== drone.id);
    drone.strategicCampaignId = campaign.id;
    drone.strategicTargetId = target.id;
    drone.assignedFleetId = groupIds[index % groupIds.length];
    drone.status = 'embarked';
    drone.systemId = null;
    drone.targetSystemId = null;
    drone.transit = null;
    drone.returnTransit = null;
    drone.awaitingOrders = false;
  });
  target.droneTeam = {
    droneIds: candidates.map((drone) => drone.id),
    required,
    status: 'embarked',
  };
  return { ok: true, droneIds: target.droneTeam.droneIds };
}

function disembarkDroneTeam(state, campaign, target) {
  const team = target.droneTeam?.droneIds ?? [];
  const drones = team.map((id) => (state.builderDrones ?? []).find((drone) => drone.id === id)).filter(Boolean);
  if (drones.length < (target.droneTeam?.required ?? 0)) {
    return { ok: false, reason: 'Campaign construction-drone payload was lost' };
  }
  for (const drone of drones) {
    drone.status = 'idle';
    drone.systemId = target.systemId;
    drone.originSystemId = target.systemId;
    drone.strategicCampaignId = campaign.id;
    drone.strategicTargetId = target.id;
    drone.targetSystemId = null;
    drone.awaitingOrders = true;
  }
  target.droneTeam.status = 'deployed';
  return { ok: true, drones };
}

function reembarkDroneTeam(state, campaign, target) {
  const groupIds = target.dispatch?.fleetIds ?? [];
  const liveGroups = groupIds.filter((groupId) => (
    findBattleGroup(state, groupId) && shipsInBattleGroup(state, groupId).length > 0
  ));
  if (!liveGroups.length) return { ok: false, reason: 'No surviving fleet can recover the drone team' };
  const drones = (target.droneTeam?.droneIds ?? [])
    .map((id) => (state.builderDrones ?? []).find((drone) => drone.id === id))
    .filter(Boolean);
  drones.forEach((drone, index) => {
    drone.status = 'embarked';
    drone.systemId = null;
    drone.assignedFleetId = liveGroups[index % liveGroups.length];
    drone.strategicCampaignId = campaign.id;
    drone.strategicTargetId = null;
    drone.targetSystemId = null;
    drone.awaitingOrders = false;
  });
  target.droneTeam.status = 'reembarked';
  return { ok: true, droneIds: drones.map((drone) => drone.id) };
}

function anchoredRouteAvailable(state, fromGalaxyId, toGalaxyId) {
  const fromId = wormholeIdForGalaxy(fromGalaxyId);
  const toId = wormholeIdForGalaxy(toGalaxyId);
  return state.wormholes?.[fromId]?.anchor === toId
    && state.wormholes?.[toId]?.anchor === fromId
    && state.wormholes?.[fromId]?.anchorOwner === 'player';
}

function resolveAnchoredRoute(state, { from, to }) {
  if (!anchoredRouteAvailable(state, from.galaxyId, to.galaxyId)) {
    return { ok: false, reason: 'No player-owned anchored wormhole joins these galaxies' };
  }
  const fromCore = getGraph(state, from.galaxyId)?.blackHole?.id;
  const toCore = getGraph(state, to.galaxyId)?.blackHole?.id;
  if (!fromCore || !toCore) return { ok: false, reason: 'Wormhole core route is unavailable' };
  return {
    ok: true,
    deterministic: true,
    anchored: true,
    path: [from.systemId, fromCore, `${from.galaxyId}->${to.galaxyId}`, toCore, to.systemId],
  };
}

function dispatchFleet(state, { campaign, target, assessment }) {
  const selection = selectDispatchGroups(state, campaign, target, assessment);
  if (!selection.ready || selection.groupIds.length === 0) {
    return { ok: false, code: 'force_shortfall', reason: 'No available fleet satisfies campaign force thresholds' };
  }
  const drones = reserveAndEmbarkDroneTeam(state, campaign, target, selection.groupIds);
  if (!drones.ok) return drones;
  const crossGalaxy = campaign.source.galaxyId !== target.galaxyId;
  const destination = crossGalaxy
    ? getGraph(state, campaign.source.galaxyId)?.blackHole?.id
    : target.systemId;
  if (!destination) return { ok: false, reason: 'Campaign destination is unavailable' };
  for (const groupId of selection.groupIds) {
    reserveGroup(state, groupId, campaign, target);
    const result = orderBattleGroupTravel(state, groupId, destination);
    if (!result.ok) return { ok: false, reason: result.reason, code: 'dispatch_failed' };
  }
  if (crossGalaxy) {
    target.crossGalaxyTransit = {
      stage: 'to_source_core',
      sourceGalaxyId: campaign.source.galaxyId,
      targetGalaxyId: target.galaxyId,
      sourceCoreId: destination,
      targetCoreId: getGraph(state, target.galaxyId)?.blackHole?.id ?? destination,
    };
  }
  return {
    ok: true,
    dispatchId: `${campaign.id}:${target.id}`,
    fleetIds: selection.groupIds,
    status: 'traveling',
    capturePower: selection.capturePower,
    combatPower: selection.combatPower,
  };
}

function groupsAt(state, fleetIds, systemId, galaxyId) {
  let liveCount = 0;
  for (const fleetId of fleetIds) {
    const group = findBattleGroup(state, fleetId);
    if (!group || group.galaxyId !== galaxyId) return false;
    const ships = shipsInBattleGroup(state, fleetId);
    if (ships.length === 0) return false;
    liveCount += ships.length;
    if (!ships.every((ship) => !ship.transit && ship.systemId === systemId)) return false;
  }
  return liveCount > 0;
}

function advanceCrossGalaxyDispatch(state, target, fleetIds) {
  const transit = target.crossGalaxyTransit;
  if (!transit) return null;
  if (transit.stage === 'to_source_core') {
    if (!groupsAt(state, fleetIds, transit.sourceCoreId, transit.sourceGalaxyId)) return { ok: true, status: 'traveling' };
    const flagship = state.flagship;
    if (flagship.galaxyId !== transit.sourceGalaxyId) {
      return { ok: false, status: 'blocked', reason: 'Flagship must be in the source galaxy for anchored transport' };
    }
    if (flagship.wormholeTransit) return { ok: true, status: 'traveling' };
    if (flagship.systemId !== transit.sourceCoreId) {
      if (!flagship.transit) {
        const move = orderFlagshipTravel(state, transit.sourceCoreId);
        if (!move.ok) return { ok: false, status: 'blocked', reason: move.reason };
      }
      return { ok: true, status: 'traveling' };
    }
    for (const fleetId of fleetIds) setBattleGroupFlagshipAnchor(state, fleetId, true);
    const jump = orderWormholeTravel(state, { targetGalaxyId: transit.targetGalaxyId, forceAnchored: true });
    if (!jump.ok) return { ok: false, status: 'blocked', reason: jump.reason };
    transit.stage = 'wormhole';
    return { ok: true, status: 'traveling' };
  }
  if (transit.stage === 'wormhole') {
    if (state.flagship.wormholeTransit || state.flagship.galaxyId !== transit.targetGalaxyId) {
      return { ok: true, status: 'traveling' };
    }
    if (!groupsAt(state, fleetIds, transit.targetCoreId, transit.targetGalaxyId)) {
      return { ok: true, status: 'traveling' };
    }
    for (const fleetId of fleetIds) {
      setBattleGroupFlagshipAnchor(state, fleetId, false);
      const move = orderBattleGroupTravel(state, fleetId, target.systemId);
      if (!move.ok) return { ok: false, status: 'blocked', reason: move.reason };
    }
    transit.stage = 'to_target';
  }
  if (transit.stage === 'to_target') {
    if (groupsAt(state, fleetIds, target.systemId, target.galaxyId)) {
      transit.stage = 'arrived';
      return { ok: true, arrived: true, status: 'arrived' };
    }
    return { ok: true, status: 'traveling' };
  }
  return transit.stage === 'arrived'
    ? { ok: true, arrived: true, status: 'arrived' }
    : { ok: true, status: 'traveling' };
}

function fleetStatus(state, { target, dispatch }) {
  const fleetIds = dispatch.fleetIds ?? [];
  const destroyedGroups = new Set(fleetIds.filter((fleetId) => (
    !findBattleGroup(state, fleetId) || shipsInBattleGroup(state, fleetId).length === 0
  )));
  let dronePayloadLost = false;
  if (destroyedGroups.size > 0) {
    const lostDroneIds = new Set();
    state.builderDrones = (state.builderDrones ?? []).filter((drone) => {
      if (drone.status !== 'embarked' || !destroyedGroups.has(drone.assignedFleetId)) return true;
      lostDroneIds.add(drone.id);
      return false;
    });
    if (target.droneTeam?.droneIds) {
      target.droneTeam.droneIds = target.droneTeam.droneIds.filter((id) => !lostDroneIds.has(id));
      if (lostDroneIds.size > 0) {
        target.droneTeam.status = 'losses';
        dronePayloadLost = true;
      }
    }
  }
  const live = fleetIds.flatMap((fleetId) => shipsInBattleGroup(state, fleetId));
  if (live.length === 0) return { ok: false, status: 'lost', reason: 'All assigned campaign fleets were lost' };
  if (dronePayloadLost) {
    return { ok: false, status: 'lost', reason: 'An assigned fleet and its embarked construction drones were lost' };
  }
  const crossGalaxy = advanceCrossGalaxyDispatch(state, target, fleetIds);
  if (crossGalaxy) return crossGalaxy;
  if (groupsAt(state, fleetIds, target.systemId, target.galaxyId)) {
    return { ok: true, arrived: true, status: 'arrived' };
  }
  if (live.some((ship) => ship.transit)) return { ok: true, status: 'traveling' };
  return { ok: false, status: 'blocked', reason: 'Assigned fleet stopped before reaching the target' };
}

function combatStatus(state, { target }) {
  const battle = getBattleState(state, target.systemId);
  if (battle?.active) {
    const summary = battleSummaryForSystem(state, target.systemId);
    return { ok: true, status: 'engaged', summary };
  }
  const liveShips = (state.playerShips ?? []).filter((ship) => (
    ship.strategicTargetId === target.id && ship.hp > 0
  ));
  if (liveShips.length === 0) return { ok: false, status: 'defeat', defeat: true, reason: 'Campaign fleet was destroyed' };
  return enemyCombatPresence(state, target.systemId) <= 0
    ? { ok: true, status: 'victory', victory: true }
    : { ok: true, status: 'engaged' };
}

function beginCapture(state, { target }) {
  const attack = canAttackSystem(state, target.systemId, 'player', { galaxyId: target.galaxyId });
  if (!attack.ok && getSystems(state, target.galaxyId)[target.systemId]?.owner !== 'neutral') return attack;
  return { ok: true, status: 'active', captureId: `${target.galaxyId}:${target.systemId}` };
}

function captureStatus(state, { target }) {
  const system = getSystems(state, target.galaxyId)[target.systemId];
  if (system?.owner === 'player') return { ok: true, complete: true, status: 'complete' };
  if (enemyCombatPresence(state, target.systemId) > 0) return { ok: true, status: 'contested' };
  return { ok: true, status: 'active', progressMs: captureProgressMs(state, target.systemId) };
}

function planDraft(target) {
  return (target.actualBuildPlan?.jobs ?? []).map((job) => ({
    clientId: job.clientId,
    structureType: job.structureType,
    bodyId: job.bodyId ?? null,
    systemNodeFallback: !!job.systemNodeFallback,
  }));
}

function confirmPlanAtTarget(state, campaign, target) {
  const result = confirmBuilderConstructionPlan(
    state,
    target.systemId,
    planDraft(target),
    target.executionVersion === 1 ? {} : {
      strategicCampaignId: campaign.id,
      strategicTargetId: target.id,
    },
  );
  return result.ok
    ? { ok: true, orderIds: result.orders.map((order) => order.id), spent: result.totalCost }
    : result;
}

function dispatchBuild(state, { campaign, target, plan }) {
  initBuilderDrones(state);
  if (target.executionVersion === 1) {
    const idleAtTarget = (state.builderDrones ?? []).find((drone) => (
      drone.galaxyId === target.galaxyId && drone.status === 'idle' && drone.systemId === target.systemId
    ));
    if (idleAtTarget) {
      const confirmed = confirmPlanAtTarget(state, campaign, target);
      if (!confirmed.ok) return confirmed;
      return {
        ok: true,
        constructionId: `${campaign.id}:${target.id}`,
        orderIds: confirmed.orderIds,
        status: confirmed.orderIds.length ? 'active' : 'complete',
        spent: confirmed.spent,
        complete: confirmed.orderIds.length === 0,
      };
    }
    const idle = (state.builderDrones ?? []).find((drone) => (
      drone.galaxyId === target.galaxyId && drone.status === 'idle' && drone.systemId
    ));
    if (!idle) return { ok: false, status: 'waiting_builder', reason: 'All builder drones are busy' };
    const deployed = deployBuilderDrone(state, target.systemId, idle.id);
    if (!deployed.ok) return { ...deployed, status: 'waiting_builder' };
    return {
      ok: true,
      constructionId: `${campaign.id}:${target.id}`,
      orderIds: [],
      status: 'active',
      costReserved: plan.totalCost,
    };
  }
  const disembarked = disembarkDroneTeam(state, campaign, target);
  if (!disembarked.ok) return { ...disembarked, status: 'waiting_builder' };
  const idleAtTarget = (state.builderDrones ?? []).find((drone) => (
    drone.galaxyId === target.galaxyId && drone.status === 'idle' && drone.systemId === target.systemId
      && drone.strategicCampaignId === campaign.id && drone.strategicTargetId === target.id
  ));
  if (idleAtTarget) {
    const confirmed = confirmPlanAtTarget(state, campaign, target);
    if (!confirmed.ok) return confirmed;
    return {
      ok: true,
      constructionId: `${campaign.id}:${target.id}`,
      orderIds: confirmed.orderIds,
      status: confirmed.orderIds.length ? 'active' : 'complete',
      spent: confirmed.spent,
      complete: confirmed.orderIds.length === 0,
    };
  }
  return { ok: false, status: 'waiting_builder', reason: 'Dedicated drone team is not ready' };
}

function buildStatus(state, { campaign, target, construction }) {
  if ((construction.orderIds ?? []).length === 0) {
    const idleAtTarget = (state.builderDrones ?? []).find((drone) => (
      drone.galaxyId === target.galaxyId && drone.status === 'idle' && drone.systemId === target.systemId
        && (target.executionVersion === 1 || (
          drone.strategicCampaignId === campaign.id && drone.strategicTargetId === target.id
        ))
    ));
    if (!idleAtTarget) return { ok: true, status: 'waiting_builder', reason: 'Builder drone is en route' };
    const confirmed = confirmPlanAtTarget(state, campaign, target);
    if (!confirmed.ok) return { ...confirmed, status: 'failed' };
    construction.orderIds = confirmed.orderIds;
    if (confirmed.orderIds.length === 0) return { ok: true, complete: true, status: 'complete' };
  }
  const orders = construction.orderIds.map((id) => (
    (state.builderConstructionOrders ?? []).find((order) => order.id === id)
  ));
  if (orders.some((order) => !order)) return { ok: false, status: 'failed', reason: 'Construction order was lost' };
  if (orders.some((order) => ['failed', 'cancelled'].includes(order.status))) {
    return { ok: false, status: 'failed', reason: 'A required construction order failed' };
  }
  return orders.every((order) => order.status === 'complete')
    ? { ok: true, complete: true, status: 'complete' }
    : { ok: true, status: 'active' };
}

function secureTarget(state, { campaign, target }) {
  const system = getSystems(state, target.galaxyId)[target.systemId];
  if (system?.owner !== 'player') return { ok: false, reason: 'System control was lost during consolidation' };
  for (const ship of state.playerShips ?? []) {
    if (ship.strategicCampaignId === campaign.id && ship.strategicTargetId === target.id) {
      ship.strategicTargetId = null;
    }
  }
  if (target.executionVersion === 1) return { ok: true, complete: true, status: 'complete' };
  const recovered = reembarkDroneTeam(state, campaign, target);
  if (!recovered.ok) return recovered;
  return { ok: true, complete: true, status: 'complete' };
}

function cancelTarget(state, { campaign, target, mode = 'hold' }) {
  for (const orderId of target.requisition?.bulkOrderIds ?? [target.requisition?.id].filter(Boolean)) {
    cancelBulkProductionOrder(state, orderId);
  }
  if (mode === 'return') return;
  for (const ship of state.playerShips ?? []) {
    if (ship.strategicCampaignId === campaign.id && ship.strategicTargetId === target.id) {
      ship.strategicCampaignId = null;
      ship.strategicTargetId = null;
    }
  }
  for (const drone of state.builderDrones ?? []) {
    if (drone.strategicCampaignId !== campaign.id || drone.strategicTargetId !== target.id) continue;
    drone.strategicTargetId = null;
    if (drone.status === 'embarked') {
      const escort = shipsInBattleGroup(state, drone.assignedFleetId)[0];
      drone.status = 'idle';
      drone.systemId = escort?.systemId ?? target.systemId ?? drone.homeSystemId;
    }
    drone.strategicCampaignId = null;
    drone.assignedFleetId = null;
  }
}

function returnAssets(state, { campaign }) {
  const groupIds = new Set();
  for (const ship of state.playerShips ?? []) {
    if (ship.strategicCampaignId !== campaign.id) continue;
    for (const group of state.battleGroups ?? []) if (group.shipIds?.includes(ship.id)) groupIds.add(group.id);
    ship.strategicCampaignId = null;
    ship.strategicTargetId = null;
  }
  if (campaign.source?.galaxyId === state.activeGalaxyId) {
    for (const groupId of groupIds) orderBattleGroupTravel(state, groupId, campaign.source.systemId);
  }
  for (const drone of state.builderDrones ?? []) {
    if (drone.strategicCampaignId !== campaign.id) continue;
    drone.strategicCampaignId = null;
    drone.strategicTargetId = null;
    if (drone.status === 'embarked') {
      drone.returnHomeSystemId = campaign.source.systemId;
    } else {
      drone.status = 'idle';
      drone.systemId ??= campaign.source.systemId;
      drone.assignedFleetId = null;
    }
  }
}

function releaseTerminalCampaignAssets(state) {
  const terminal = new Set((state.strategicOrders?.campaigns ?? [])
    .filter((campaign) => ['complete', 'cancelled'].includes(campaign.status))
    .map((campaign) => campaign.id));
  for (const ship of state.playerShips ?? []) {
    if (!terminal.has(ship.strategicCampaignId)) continue;
    ship.strategicCampaignId = null;
    ship.strategicTargetId = null;
  }
  for (const drone of state.builderDrones ?? []) {
    if (drone.status === 'embarked' && drone.returnHomeSystemId) {
      const escorts = shipsInBattleGroup(state, drone.assignedFleetId);
      if (escorts.length > 0 && escorts.every((ship) => (
        ship.systemId === drone.returnHomeSystemId && !ship.transit
      ))) {
        drone.status = 'idle';
        drone.systemId = drone.returnHomeSystemId;
        drone.returnHomeSystemId = null;
        drone.assignedFleetId = null;
      }
      continue;
    }
    if (!terminal.has(drone.strategicCampaignId)) continue;
    const escort = shipsInBattleGroup(state, drone.assignedFleetId)[0];
    drone.strategicCampaignId = null;
    drone.strategicTargetId = null;
    drone.assignedFleetId = null;
    if (drone.status === 'embarked') {
      drone.status = 'idle';
      drone.systemId = escort?.systemId ?? drone.homeSystemId ?? null;
    }
  }
}

export function strategicIntegrationHooks() {
  return {
    previewOperationPackage: (state, context) => {
      const campaign = {
        id: '__preview__',
        source: context.source,
        operationDoctrine: context.doctrine,
        templateSnapshot: { doctrine: context.doctrine },
      };
      const target = { ...context.target, requirements: context.requirements };
      return operationPackagePlan(state, {
        campaign,
        target,
        assessment: {
          requiredCaptureForce: context.requirements.captureForce,
          requiredCombatPower: context.requirements.combatPower,
        },
        doctrine: context.doctrine,
        includeReserve: context.targetIndex === 0,
        preview: true,
        ignoreExistingAssets: context.targetIndex > 0,
      });
    },
    hasIntel: (state, { target }) => hasIntel(state, target.systemId),
    requestScout,
    scoutStatus,
    assessTarget,
    requestRequisition,
    requisitionStatus,
    canEnterSystem: (state, { systemId, to, spec }) => {
      const system = getSystems(state, to.galaxyId)[systemId];
      const factionId = systemFaction(system);
      const raw = spec?.warAuthorizations ?? spec?.authorizedWars ?? [];
      const authorizations = Array.isArray(raw)
        ? raw
        : Object.entries(raw).map(([id, value]) => ({ factionId: id, ...(typeof value === 'object' ? value : {}) }));
      if (factionId && authorizations.some((entry) => (
        (typeof entry === 'string' ? entry : entry?.factionId) === factionId
          && (typeof entry === 'string' || entry.authorized !== false)
      ))) return { ok: true, authorizedWar: true };
      return canRouteThroughSystem(state, system ?? systemId, 'player', {
        galaxyId: to.galaxyId,
        allowHostile: true,
      });
    },
    previewRoute,
    diplomacyCheck,
    declareWar: declareCampaignWar,
    dispatchFleet,
    fleetStatus,
    beginCombat: (state, { target }) => {
      const battle = checkBattleTrigger(state, target.systemId);
      return { ok: true, combatId: battle?.id ?? `${target.galaxyId}:${target.systemId}`, status: battle ? 'engaged' : 'clear' };
    },
    combatStatus,
    beginCapture,
    captureStatus,
    dispatchBuild,
    buildStatus,
    secureTarget,
    securityStatus: () => ({ ok: true, complete: true, status: 'complete' }),
    resolveAnchoredRoute,
    cancelTarget,
    returnAssets,
  };
}

export function tickIntegratedStrategicOperations(state, options = {}) {
  const result = tickStrategicOperations(state, {
    ...options,
    hooks: { ...strategicIntegrationHooks(), ...(options.hooks ?? {}) },
  });
  releaseTerminalCampaignAssets(state);
  return result;
}

export function integratedStrategicSummary(state) {
  return strategicOrdersSummary(state);
}
