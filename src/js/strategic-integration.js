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

const MAX_AUTOMATED_FLEET_SIZE = 40;

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
  if (!ship || ship.hp <= 0 || !isCombatHull(ship.hull) || ship.transit) return false;
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

function chooseRequisitionHull(state) {
  const unlocked = empireQueueHulls(state).filter((hull) => isCombatHull(hull));
  for (const preferred of ['corvette', 'patrol_cutter', 'frigate', 'destroyer']) {
    if (unlocked.includes(preferred)) return preferred;
  }
  return unlocked[0] ?? null;
}

function requisitionQuantity(hull, captureShortfall, combatShortfall) {
  const stats = hullStats(hull);
  if (!stats) return 0;
  const capturePerHull = Math.max(0.01, stats.captureForce ?? 0);
  const combatPerHull = Math.max(0.01, (stats.dps ?? 0) + (stats.hp ?? 0) / 40 + (stats.healRate ?? 0) * 0.35);
  return Math.max(
    1,
    Math.ceil(captureShortfall / capturePerHull),
    Math.ceil(combatShortfall / combatPerHull),
  );
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
  return {
    ok: true,
    requiredCaptureForce: target.requirements?.captureForce ?? captureRequirement(state, target.systemId),
    requiredCombatPower: target.requirements?.combatPower ?? enemyCombatPresence(state, target.systemId),
    hostileCombatPower: enemyCombatPresence(state, target.systemId),
    availableCaptureForce: available.capturePower,
    availableCombatPower: available.combatPower,
  };
}

function requestRequisition(state, context) {
  const { campaign, target, captureForceShortfall, combatPowerShortfall } = context;
  const hull = chooseRequisitionHull(state);
  if (!hull) return { ok: false, reason: 'No combat hull is unlocked for automated requisition' };
  const quantity = requisitionQuantity(hull, captureForceShortfall, combatPowerShortfall);
  const result = createBulkProductionOrder(state, {
    name: `${campaign.name} · ${target.systemName ?? target.systemId} task force`,
    manifest: [{ hull, quantity }],
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
  return {
    ok: true,
    requisitionId: result.order.id,
    bulkOrderId: result.order.id,
    status: 'pending',
    capturePower: 0,
    combatPower: 0,
  };
}

function requisitionStatus(state, { campaign, target, requisition, assessment }) {
  const ships = availableShips(state, campaign, target);
  const force = forceSummary(state, ships);
  const ready = force.capturePower >= assessment.requiredCaptureForce
    && force.combatPower >= assessment.requiredCombatPower;
  if (ready) {
    return {
      ok: true,
      complete: true,
      status: 'complete',
      capturePower: force.capturePower,
      combatPower: force.combatPower,
      bulkOrderIds: requisition.bulkOrderIds ?? [requisition.id].filter(Boolean),
    };
  }
  const summaries = (requisition.bulkOrderIds ?? [requisition.id])
    .filter(Boolean)
    .map((id) => bulkProductionSummary(state, id))
    .filter(Boolean);
  if (summaries.some((summary) => summary.storedStatus === 'cancelled')) {
    return { ok: false, status: 'failed', reason: 'Fleet requisition was cancelled' };
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
  const eligibleIds = new Set(eligible.map((ship) => ship.id));
  const selected = [];
  let capturePower = 0;
  let combatPower = 0;
  const meetsThreshold = () => capturePower >= assessment.requiredCaptureForce
    && combatPower >= assessment.requiredCombatPower;

  const groups = battleGroupsForGalaxy(state, target.galaxyId)
    .filter((group) => groupEligibleAtSource(state, group, eligibleIds))
    .sort((a, b) => fleetPower(shipsInBattleGroup(state, b.id), state)
      - fleetPower(shipsInBattleGroup(state, a.id), state));
  const groupedIds = new Set();
  for (const group of groups) {
    if (meetsThreshold()) break;
    const ships = shipsInBattleGroup(state, group.id);
    selected.push(group.id);
    ships.forEach((ship) => groupedIds.add(ship.id));
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
    selected.push(group.id);
    const force = forceSummary(state, batch);
    capturePower += force.capturePower;
    combatPower += force.combatPower;
  }
  return { groupIds: selected, capturePower, combatPower, ready: meetsThreshold() };
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
  const live = fleetIds.flatMap((fleetId) => shipsInBattleGroup(state, fleetId));
  if (live.length === 0) return { ok: false, status: 'lost', reason: 'All assigned campaign fleets were lost' };
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

function confirmPlanAtTarget(state, target) {
  const result = confirmBuilderConstructionPlan(state, target.systemId, planDraft(target));
  return result.ok
    ? { ok: true, orderIds: result.orders.map((order) => order.id), spent: result.totalCost }
    : result;
}

function dispatchBuild(state, { campaign, target, plan }) {
  initBuilderDrones(state);
  const idleAtTarget = (state.builderDrones ?? []).find((drone) => (
    drone.galaxyId === target.galaxyId && drone.status === 'idle' && drone.systemId === target.systemId
  ));
  if (idleAtTarget) {
    const confirmed = confirmPlanAtTarget(state, target);
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

function buildStatus(state, { target, construction }) {
  if ((construction.orderIds ?? []).length === 0) {
    const idleAtTarget = (state.builderDrones ?? []).find((drone) => (
      drone.galaxyId === target.galaxyId && drone.status === 'idle' && drone.systemId === target.systemId
    ));
    if (!idleAtTarget) return { ok: true, status: 'waiting_builder', reason: 'Builder drone is en route' };
    const confirmed = confirmPlanAtTarget(state, target);
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
  return { ok: true, complete: true, status: 'complete' };
}

function cancelTarget(state, { campaign, target }) {
  for (const ship of state.playerShips ?? []) {
    if (ship.strategicCampaignId === campaign.id && ship.strategicTargetId === target.id) {
      ship.strategicCampaignId = null;
      ship.strategicTargetId = null;
    }
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
}

export function strategicIntegrationHooks() {
  return {
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
