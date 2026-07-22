// Server-side command dispatch for co-op (shared empire, per-pilot capitals).
//
// Every command runs with state.flagship temporarily bound to the issuing
// pilot's flagship, so all existing single-ship code paths (travel, orbit,
// wing, wormholes, presence checks) act on the right vessel. Shareable assets
// (ships / scouts / battle groups) are gated by the ownership ACL; the
// superweapon stays a team-unique singleton any pilot may operate.

import { setPaused, togglePaused } from '../src/js/simulation.js';
import {
  orderTravel,
  toggleFlagshipOrbit,
  ensurePlayerFlagships,
  getPlayerFlagship,
  setFlagshipInputFor,
} from '../src/js/flagship.js';
import { orderScoutTravel, findScout } from '../src/js/scout.js';
import { orderShipTravel, findPlayerShip } from '../src/js/fleets.js';
import {
  orderBattleGroupTravel,
  createBattleGroup,
  deleteBattleGroup,
  assignShipToGroup,
  setBattleGroupHeroAnchor,
  setBattleGroupFlagshipAnchor,
  findBattleGroup,
  autoAssignShipsToFleets,
} from '../src/js/battle-groups.js';
import { buildOutpost } from '../src/js/economy.js';
import { buildShipyard, queueScout, queueHull } from '../src/js/production.js';
import {
  enqueueProduct,
  cancelQueueItem,
  pinQueueItem,
  reorderQueueItem,
} from '../src/js/empire-queue.js';
import { buildFoundry, buildLauncher } from '../src/js/dyson.js';
import {
  deployBuilderDrone,
  cancelBuilderDrone,
  confirmBuilderConstructionPlan,
  cancelBuilderConstructionOrder,
} from '../src/js/builder-drones.js';
import { startResearch, cancelResearch, buildResearchStation } from '../src/js/research.js';
import { buildTradeStation } from '../src/js/trade.js';
import { toggleFlagshipWingHangar } from '../src/js/flagship-wing.js';
import {
  buildHeroFlagship,
  orderHeroTravel,
  setHeroRally,
  findHeroFlagship,
} from '../src/js/hero-flagships.js';
import {
  buildHelioclastShipyard,
  installSuperweaponPart,
  markLiveFireComplete,
  superweaponCreate,
  superweaponDestroy,
  superweaponJump,
  orderHelioclastTravel,
  setHelioclastFleetMode,
} from '../src/js/superweapon.js';
import { orderWormholeTravel, buildWormholeAnchor } from '../src/js/wormholes.js';
import {
  setCombatDoctrine,
  getBattleState,
  cancelTacticalRetreat,
  promoteBattleToTactical,
} from '../src/js/combat.js';
import { setAdvancedTactics, setCombatFleetPriority } from '../src/js/combat-autonomy.js';
import { applyFleetOrder } from '../src/js/combat-orders.js';
import {
  activeConvoys,
  dispatchDepot,
  setDepotDestination,
  pauseDepotRoute,
  resumeDepotRoute,
  rerouteConvoy,
  setConvoyEscort,
} from '../src/js/logistics.js';
import { upgradeBodyStructure, buildBodyStructure } from '../src/js/body-structures.js';
import { buildStrategicStructure } from '../src/js/strategic-structures.js';
import {
  createBulkProductionOrder,
  pauseBulkProductionOrder,
  resumeBulkProductionOrder,
  cancelBulkProductionOrder,
} from '../src/js/bulk-production.js';
import {
  createExpansionCampaign,
  pauseExpansionCampaign,
  resumeExpansionCampaign,
  cancelExpansionCampaign,
} from '../src/js/strategic-operations.js';
import {
  submitProposal,
  respondToProposal,
  createClaim,
  withdrawClaim,
  declareWar,
  concludePeace,
  castCouncilVote,
  proposeCouncilResolution,
  respondToCallToArms,
  establishContact,
  markTransmissionRead,
} from '../src/js/diplomacy.js';
import { getGraph } from '../src/js/galaxy-scope.js';
import {
  assertControl,
  grantControl,
  revokeControl,
  releaseControl,
  transferOwnership,
  findShareableAsset,
  SHAREABLE_KINDS as SHAREABLE_KIND_LIST,
} from '../src/js/coop-acl.js';
import { devAction } from '../src/js/dev.js';

/** Run fn with state.flagship bound to this pilot's ship (restored after). */
function withPilotFlagship(state, playerId, fn) {
  ensurePlayerFlagships(state);
  const prev = state.flagship;
  const mine = playerId ? getPlayerFlagship(state, playerId) : null;
  if (mine) state.flagship = mine;
  try {
    return fn();
  } finally {
    state.flagship = prev;
  }
}

function ownerOnly(playerId, asset, label) {
  if (!playerId || !asset?.ownerPlayerId || asset.ownerPlayerId === playerId) return { ok: true };
  return { ok: false, reason: `${label} belongs to ${asset.ownerPlayerId} — personal capitals cannot be shared` };
}

const SHAREABLE_KINDS = new Set(SHAREABLE_KIND_LIST);

function setPauseState(state, paused, playerId) {
  setPaused(state, !!paused);
  if (state.paused) state.pausedBy = playerId ?? state.pausedBy ?? null;
  else state.pausedBy = null;
  return { ok: true, paused: state.paused, pausedBy: state.pausedBy };
}

function dispatch(state, command, payload, playerId, ctx = {}) {
  switch (command) {
    case 'setPaused':
      return setPauseState(state, !!payload.paused, playerId);
    case 'togglePaused': {
      const paused = togglePaused(state);
      if (paused) state.pausedBy = playerId ?? null;
      else state.pausedBy = null;
      return { ok: true, paused, pausedBy: state.pausedBy };
    }

    // --- Personal flagship (bound to issuing pilot) ---
    case 'setFlagshipInput': {
      const x = Math.max(-1, Math.min(1, Number(payload.x) || 0));
      const y = Math.max(-1, Math.min(1, Number(payload.y) || 0));
      setFlagshipInputFor(playerId ?? 'solo', x, y);
      return { ok: true };
    }
    case 'orderTravel': {
      if (!payload.targetId) return { ok: false, reason: 'targetId required' };
      return orderTravel(state, payload.targetId);
    }
    case 'toggleOrbit':
      return toggleFlagshipOrbit(state, payload.bodyId ?? null);
    case 'toggleWingHangar':
      return toggleFlagshipWingHangar(state);
    case 'enterWormhole':
      return orderWormholeTravel(state, {
        targetGalaxyId: payload.targetGalaxyId ?? null,
        forceAnchored: !!payload.forceAnchored,
      });
    case 'buildWormholeAnchor': {
      if (!payload.targetGalaxyId) return { ok: false, reason: 'targetGalaxyId required' };
      return buildWormholeAnchor(state, payload.targetGalaxyId);
    }

    // --- Shareable assets (owner or granted controller) ---
    case 'orderScoutTravel': {
      if (!payload.scoutId || !payload.targetId) return { ok: false, reason: 'scoutId and targetId required' };
      const acl = assertControl(playerId, findScout(state, payload.scoutId), 'Scout');
      if (!acl.ok) return acl;
      return orderScoutTravel(state, payload.scoutId, payload.targetId);
    }
    case 'orderShipTravel': {
      if (!payload.shipId || !payload.targetId) return { ok: false, reason: 'shipId and targetId required' };
      const acl = assertControl(playerId, findPlayerShip(state, payload.shipId), 'Ship');
      if (!acl.ok) return acl;
      return orderShipTravel(state, payload.shipId, payload.targetId);
    }
    case 'orderBattleGroupTravel': {
      if (!payload.groupId || !payload.targetId) return { ok: false, reason: 'groupId and targetId required' };
      const acl = assertControl(playerId, findBattleGroup(state, payload.groupId), 'Fleet');
      if (!acl.ok) return acl;
      return orderBattleGroupTravel(state, payload.groupId, payload.targetId);
    }
    case 'createBattleGroup': {
      const group = createBattleGroup(state, { ownerPlayerId: playerId ?? null });
      return { ok: true, groupId: group.id, ordinal: group.ordinal };
    }
    case 'deleteBattleGroup': {
      if (!payload.groupId) return { ok: false, reason: 'groupId required' };
      const acl = assertControl(playerId, findBattleGroup(state, payload.groupId), 'Fleet');
      if (!acl.ok) return acl;
      return deleteBattleGroup(state, payload.groupId);
    }
    case 'assignShipToGroup': {
      if (!payload.shipId) return { ok: false, reason: 'shipId required' };
      const shipAcl = assertControl(playerId, findPlayerShip(state, payload.shipId), 'Ship');
      if (!shipAcl.ok && payload.shipId !== 'helioclast') return shipAcl;
      if (payload.groupId) {
        const groupAcl = assertControl(playerId, findBattleGroup(state, payload.groupId), 'Fleet');
        if (!groupAcl.ok) return groupAcl;
      }
      return assignShipToGroup(state, payload.shipId, payload.groupId ?? null);
    }
    case 'setBattleGroupAnchor': {
      if (!payload.groupId) return { ok: false, reason: 'groupId required' };
      const group = findBattleGroup(state, payload.groupId);
      const acl = assertControl(playerId, group, 'Fleet');
      if (!acl.ok) return acl;
      if (payload.anchor === 'flagship') return setBattleGroupFlagshipAnchor(state, payload.groupId, true);
      if (payload.anchor === 'hero') {
        const hero = findHeroFlagship(state, payload.heroId);
        const heroAcl = ownerOnly(playerId, hero, 'Hero flagship');
        if (!heroAcl.ok) return heroAcl;
        return setBattleGroupHeroAnchor(state, payload.groupId, payload.heroId);
      }
      setBattleGroupFlagshipAnchor(state, payload.groupId, false);
      return setBattleGroupHeroAnchor(state, payload.groupId, null);
    }
    case 'grantControl':
    case 'revokeControl': {
      const { assetKind, assetId, targetPlayerId } = payload;
      if (!SHAREABLE_KINDS.has(assetKind)) return { ok: false, reason: `Cannot share asset kind: ${assetKind}` };
      if (!assetId || !targetPlayerId) return { ok: false, reason: 'assetId and targetPlayerId required' };
      const asset = findShareableAsset(state, assetKind, assetId);
      if (!asset) return { ok: false, reason: 'No such asset' };
      if (!asset.ownerPlayerId) return { ok: false, reason: 'Team asset — every pilot can already command it' };
      if (playerId && asset.ownerPlayerId !== playerId) {
        return { ok: false, reason: `Only the owner (${asset.ownerPlayerId}) can change control grants` };
      }
      return command === 'grantControl'
        ? grantControl(asset, targetPlayerId)
        : revokeControl(asset, targetPlayerId);
    }
    case 'transferOwnership': {
      const { assetKind, assetId, targetPlayerId } = payload;
      if (!SHAREABLE_KINDS.has(assetKind)) return { ok: false, reason: `Cannot transfer asset kind: ${assetKind}` };
      if (!assetId || !targetPlayerId) return { ok: false, reason: 'assetId and targetPlayerId required' };
      const asset = findShareableAsset(state, assetKind, assetId);
      if (!asset) return { ok: false, reason: 'No such asset' };
      if (playerId && asset.ownerPlayerId && asset.ownerPlayerId !== playerId) {
        return { ok: false, reason: `Only the owner (${asset.ownerPlayerId}) can transfer ownership` };
      }
      return transferOwnership(asset, targetPlayerId);
    }
    case 'releaseControl': {
      const { assetKind, assetId } = payload;
      if (!SHAREABLE_KINDS.has(assetKind)) return { ok: false, reason: `Cannot release asset kind: ${assetKind}` };
      if (!assetId) return { ok: false, reason: 'assetId required' };
      const asset = findShareableAsset(state, assetKind, assetId);
      if (!asset) return { ok: false, reason: 'No such asset' };
      return releaseControl(asset, playerId);
    }
    // Host-ephemeral mesh commands (pending requests / pings) — handled in coop-host.
    case 'requestControl':
    case 'respondControlRequest':
    case 'mapPing':
      return { ok: false, reason: 'Host mesh handler required', mesh: command };

    // --- Per-pilot hero flagships (personal capitals) ---
    case 'buildHeroFlagship':
      return buildHeroFlagship(state, payload.rallyStarId ?? null, { ownerPlayerId: playerId ?? null });
    case 'orderHeroTravel': {
      if (!payload.heroId || !payload.targetId) return { ok: false, reason: 'heroId and targetId required' };
      const acl = ownerOnly(playerId, findHeroFlagship(state, payload.heroId), 'Hero flagship');
      if (!acl.ok) return acl;
      return orderHeroTravel(state, payload.heroId, payload.targetId);
    }
    case 'setHeroRally': {
      if (!payload.heroId || !payload.starId) return { ok: false, reason: 'heroId and starId required' };
      const acl = ownerOnly(playerId, findHeroFlagship(state, payload.heroId), 'Hero flagship');
      if (!acl.ok) return acl;
      return setHeroRally(state, payload.heroId, payload.starId);
    }

    // --- Team-unique superweapon (singleton; any pilot) ---
    case 'buildHelioclastShipyard':
      return buildHelioclastShipyard(state, payload.systemId ?? state.stronghold);
    case 'installSuperweaponPart': {
      if (!payload.partId) return { ok: false, reason: 'partId required' };
      return installSuperweaponPart(state, payload.partId);
    }
    case 'markLiveFire':
      return markLiveFireComplete(state);
    case 'superweaponAction': {
      const { mode, targetId } = payload;
      if (!targetId) return { ok: false, reason: 'targetId required' };
      if (mode === 'create') return superweaponCreate(state, targetId);
      if (mode === 'destroy') return superweaponDestroy(state, targetId);
      if (mode === 'jump') return superweaponJump(state, targetId);
      return { ok: false, reason: `Unknown superweapon mode: ${mode}` };
    }
    case 'orderHelioclastTravel': {
      if (!payload.targetId) return { ok: false, reason: 'targetId required' };
      return orderHelioclastTravel(state, payload.targetId);
    }
    case 'setHelioclastFleetMode':
      return setHelioclastFleetMode(state, payload.mode, payload.battleGroupId ?? null);

    // --- Shared-empire builds / research / drones (any pilot) ---
    case 'buildOutpost': {
      if (!payload.systemId || !payload.planetId) return { ok: false, reason: 'systemId and planetId required' };
      return buildOutpost(state, payload.systemId, payload.planetId);
    }
    case 'buildShipyard': {
      if (!payload.systemId || !payload.planetId) return { ok: false, reason: 'systemId and planetId required' };
      return buildShipyard(state, payload.systemId, payload.planetId);
    }
    case 'queueScout': {
      if (!payload.shipyardId || !payload.systemId) return { ok: false, reason: 'shipyardId and systemId required' };
      return queueScout(state, payload.shipyardId, payload.systemId, { ownerPlayerId: playerId ?? null });
    }
    case 'queueHull': {
      if (!payload.shipyardId || !payload.systemId || !payload.hull) {
        return { ok: false, reason: 'shipyardId, systemId, and hull required' };
      }
      return queueHull(state, payload.shipyardId, payload.systemId, payload.hull, {
        ownerPlayerId: playerId ?? null,
      });
    }
    case 'enqueueProduct': {
      const product = payload.product ?? payload;
      if (!product?.productId && !product?.hull && !payload.kind) {
        return { ok: false, reason: 'productId or hull required' };
      }
      return enqueueProduct(state, {
        kind: product.kind ?? payload.kind ?? 'hull',
        productId: product.productId ?? product.hull ?? payload.productId ?? payload.hull,
      }, { ownerPlayerId: playerId ?? null });
    }
    case 'cancelQueueItem': {
      if (!payload.queueId) return { ok: false, reason: 'queueId required' };
      return cancelQueueItem(state, payload.queueId);
    }
    case 'pinQueueItem': {
      if (!payload.queueId) return { ok: false, reason: 'queueId required' };
      return pinQueueItem(state, payload.queueId, payload.shipyardId ?? null);
    }
    case 'reorderQueueItem': {
      if (!payload.queueId || payload.newIndex == null) {
        return { ok: false, reason: 'queueId and newIndex required' };
      }
      return reorderQueueItem(state, payload.queueId, payload.newIndex);
    }
    case 'buildFoundry': {
      if (!payload.systemId || !payload.planetId) return { ok: false, reason: 'systemId and planetId required' };
      return buildFoundry(state, payload.systemId, payload.planetId);
    }
    case 'buildLauncher': {
      if (!payload.systemId || !payload.bodyId) return { ok: false, reason: 'systemId and bodyId required' };
      return buildLauncher(state, payload.systemId, payload.bodyId);
    }
    case 'buildResearchStation': {
      if (!payload.systemId) return { ok: false, reason: 'systemId required' };
      return buildResearchStation(state, payload.systemId, payload);
    }
    case 'buildTradeStation': {
      if (!payload.systemId || !payload.planetId) return { ok: false, reason: 'systemId and planetId required' };
      return buildTradeStation(state, payload.systemId, payload.planetId);
    }
    case 'startResearch': {
      if (!payload.techId) return { ok: false, reason: 'techId required' };
      return startResearch(state, payload.techId);
    }
    case 'cancelResearch':
      return cancelResearch(state);
    case 'buildBodyStructure': {
      if (!payload.systemId || !payload.structureType) {
        return { ok: false, reason: 'systemId and structureType required' };
      }
      return buildBodyStructure(
        state,
        payload.systemId,
        payload.bodyId ?? null,
        payload.structureType,
        { ownerPlayerId: playerId ?? null },
      );
    }
    case 'buildStrategicStructure': {
      if (!payload.systemId || !payload.structureType) return { ok: false, reason: 'systemId and structureType required' };
      return buildStrategicStructure(state, payload.systemId, payload.structureType, payload.planetId ?? null);
    }
    case 'upgradeBodyStructure': {
      if (!payload.systemId || !payload.structureId) return { ok: false, reason: 'systemId and structureId required' };
      return upgradeBodyStructure(state, payload.systemId, payload.structureId);
    }
    case 'autoAssignShipsToFleets':
      return autoAssignShipsToFleets(state, { preferredGroupId: payload.preferredGroupId ?? null });

    // --- Logistics (team assets) ---
    case 'setDepotDestination': {
      if (!payload.depotId) return { ok: false, reason: 'depotId required' };
      return setDepotDestination(state, payload.depotId, payload.nexusSystemId ?? null);
    }
    case 'pauseDepotRoute': {
      if (!payload.depotId) return { ok: false, reason: 'depotId required' };
      return pauseDepotRoute(state, payload.depotId);
    }
    case 'resumeDepotRoute': {
      if (!payload.depotId) return { ok: false, reason: 'depotId required' };
      return resumeDepotRoute(state, payload.depotId);
    }
    case 'dispatchDepot': {
      if (!payload.depotId) return { ok: false, reason: 'depotId required' };
      return dispatchDepot(state, payload.depotId);
    }
    case 'rerouteConvoy': {
      if (!payload.convoyId) return { ok: false, reason: 'convoyId required' };
      return rerouteConvoy(state, payload.convoyId, payload.destinationSystemId ?? null);
    }
    case 'setConvoyEscort': {
      if (!payload.convoyId) return { ok: false, reason: 'convoyId required' };
      return setConvoyEscort(state, payload.convoyId, payload.escortStrength ?? 0);
    }

    case 'deployBuilderDrone': {
      if (!payload.systemId) return { ok: false, reason: 'systemId required' };
      return deployBuilderDrone(state, payload.systemId, payload.droneId ?? null);
    }
    case 'cancelBuilderDrone': {
      if (!payload.droneId) return { ok: false, reason: 'droneId required' };
      return cancelBuilderDrone(state, payload.droneId);
    }
    case 'confirmBuilderConstructionPlan': {
      if (!payload.systemId) return { ok: false, reason: 'systemId required' };
      return confirmBuilderConstructionPlan(
        state,
        payload.systemId,
        payload.draftOrders ?? [],
        { ownerPlayerId: playerId ?? null },
      );
    }
    case 'cancelBuilderConstructionOrder': {
      if (!payload.orderId) return { ok: false, reason: 'orderId required' };
      return cancelBuilderConstructionOrder(state, payload.orderId);
    }

    // --- Bulk production / expansion campaigns ---
    case 'createBulkProductionOrder':
      return createBulkProductionOrder(state, payload.spec ?? payload);
    case 'pauseBulkProductionOrder': {
      if (!payload.orderId) return { ok: false, reason: 'orderId required' };
      return pauseBulkProductionOrder(state, payload.orderId);
    }
    case 'resumeBulkProductionOrder': {
      if (!payload.orderId) return { ok: false, reason: 'orderId required' };
      return resumeBulkProductionOrder(state, payload.orderId);
    }
    case 'cancelBulkProductionOrder': {
      if (!payload.orderId) return { ok: false, reason: 'orderId required' };
      return cancelBulkProductionOrder(state, payload.orderId);
    }
    case 'createExpansionCampaign':
      return createExpansionCampaign(state, payload.spec ?? payload, payload.options ?? {});
    case 'pauseExpansionCampaign': {
      if (!payload.campaignId) return { ok: false, reason: 'campaignId required' };
      return pauseExpansionCampaign(state, payload.campaignId);
    }
    case 'resumeExpansionCampaign': {
      if (!payload.campaignId) return { ok: false, reason: 'campaignId required' };
      return resumeExpansionCampaign(state, payload.campaignId);
    }
    case 'cancelExpansionCampaign': {
      if (!payload.campaignId) return { ok: false, reason: 'campaignId required' };
      return cancelExpansionCampaign(state, payload.campaignId, payload.mode ?? payload.cancelMode ?? null);
    }

    // --- Diplomacy ---
    case 'diplomacyAction': {
      const action = payload.action;
      const args = payload.args ?? {};
      switch (action) {
        case 'establishContact':
          return establishContact(state, args.factionId, args.options ?? {});
        case 'submitProposal':
          return submitProposal(state, args.input, args.options ?? { autoResolve: true });
        case 'respondToProposal':
          return respondToProposal(state, args.proposalId, args.decision, args.options ?? {});
        case 'createClaim':
          return createClaim(state, args.input ?? args);
        case 'withdrawClaim':
          return withdrawClaim(state, args.claimId, args.options ?? {});
        case 'declareWar':
          return declareWar(state, args.input ?? args, args.options ?? {});
        case 'concludePeace':
          return concludePeace(state, args.factionIdOrWar, args.terms ?? {});
        case 'castCouncilVote':
          return castCouncilVote(state, args.resolutionId, args.voterId ?? 'player', args.vote);
        case 'proposeCouncilResolution':
          return proposeCouncilResolution(state, args.input ?? args);
        case 'respondToCallToArms':
          return respondToCallToArms(state, args.callId, !!args.accept, args.actorId ?? 'player');
        case 'markTransmissionRead':
          return markTransmissionRead(state, args.transmissionId);
        default:
          return { ok: false, reason: `Unknown diplomacy action: ${action}` };
      }
    }

    // --- Combat orders (host-authoritative battles) ---
    case 'setCombatDoctrine':
      return setCombatDoctrine(state, payload.doctrine, payload.systemId ?? null);
    case 'setAdvancedTactics':
      return setAdvancedTactics(state, !!payload.enabled, payload.systemId ?? null);
    case 'setCombatPriority':
      return setCombatFleetPriority(state, payload.priority, payload.systemId ?? null);
    case 'cancelTacticalRetreat': {
      if (!payload.systemId) return { ok: false, reason: 'systemId required' };
      return cancelTacticalRetreat(state, payload.systemId);
    }
    case 'promoteBattleToTactical': {
      if (!payload.systemId) return { ok: false, reason: 'systemId required' };
      return promoteBattleToTactical(state, payload.systemId);
    }
    case 'issueTacticalOrder': {
      const { systemId, order } = payload;
      if (!systemId || !order?.type) return { ok: false, reason: 'systemId and order required' };
      const battle = getBattleState(state, systemId);
      if (!battle?.active || battle.mode !== 'tactical') {
        return { ok: false, reason: 'No controllable tactical battle in that system' };
      }
      const liveIds = battle.units
        .filter((unit) => unit.side === 'player' && unit.hp > 0)
        .map((unit) => String(unit.id));
      const subjectIds = Array.isArray(order.subjectIds) && order.subjectIds.length
        ? order.subjectIds.map(String).filter((id) => liveIds.includes(id))
        : liveIds;
      if (!subjectIds.length) return { ok: false, reason: 'No live player units for that order' };
      return applyFleetOrder(battle, { ...order, side: 'player', subjectIds }, {
        time: state.time,
        units: battle.units,
        ownedUnitIds: subjectIds,
        targetIds: battle.units.filter((unit) => unit.hp > 0).map((unit) => unit.id),
        convoyIds: activeConvoys(state).map((convoy) => convoy.id),
        destinationIds: getGraph(state).stars.map((star) => star.id),
      });
    }

    case 'requestSnapshot':
      return { ok: true, snapshot: true };

    // Dev panel cheats / spawns — host-authoritative so both screens see them.
    // Disabled in production / gateway-locked hosts (ctx.allowDevActions === false).
    case 'devAction': {
      if (ctx?.allowDevActions === false) {
        return { ok: false, reason: 'Dev actions disabled on this host' };
      }
      const action = payload.action;
      if (!action || typeof action !== 'string') {
        return { ok: false, reason: 'action required' };
      }
      const { action: _a, ...params } = payload;
      return withPilotFlagship(state, playerId, () => devAction(state, action, params));
    }

    default:
      return { ok: false, reason: `Unknown command: ${command}` };
  }
}

/**
 * @param {any} state
 * @param {string} command
 * @param {Record<string, any>} payload
 * @param {{ playerId?: string | null, allowDevActions?: boolean }} [ctx] issuing pilot (null = trusted local/test)
 */
export function applyCoopCommand(state, command, payload = {}, ctx = {}) {
  const playerId = ctx.playerId ?? null;
  if (command === 'devAction' && ctx.allowDevActions === false) {
    return { ok: false, reason: 'Dev actions disabled on this host' };
  }
  return withPilotFlagship(state, playerId, () => dispatch(state, command, payload, playerId, ctx));
}

/** Commands that mutate the shared world beyond flagship poses / HUD fields. */
export const WORLD_MUTATING_COMMANDS = new Set([
  'buildOutpost', 'buildShipyard', 'buildFoundry', 'buildLauncher',
  'buildResearchStation', 'buildTradeStation', 'queueScout', 'queueHull',
  'enqueueProduct', 'cancelQueueItem', 'pinQueueItem', 'reorderQueueItem',
  'startResearch', 'cancelResearch', 'deployBuilderDrone', 'cancelBuilderDrone',
  'confirmBuilderConstructionPlan', 'cancelBuilderConstructionOrder',
  'buildBodyStructure', 'buildStrategicStructure', 'upgradeBodyStructure',
  'autoAssignShipsToFleets',
  'setDepotDestination', 'pauseDepotRoute', 'resumeDepotRoute',
  'dispatchDepot', 'rerouteConvoy', 'setConvoyEscort',
  'createBulkProductionOrder', 'pauseBulkProductionOrder',
  'resumeBulkProductionOrder', 'cancelBulkProductionOrder',
  'createExpansionCampaign', 'pauseExpansionCampaign',
  'resumeExpansionCampaign', 'cancelExpansionCampaign',
  'diplomacyAction',
  'buildHeroFlagship', 'orderHeroTravel', 'setHeroRally',
  'buildHelioclastShipyard', 'installSuperweaponPart', 'markLiveFire',
  'superweaponAction', 'orderHelioclastTravel', 'setHelioclastFleetMode',
  'enterWormhole', 'buildWormholeAnchor',
  'createBattleGroup', 'deleteBattleGroup', 'assignShipToGroup', 'setBattleGroupAnchor',
  'grantControl', 'revokeControl', 'transferOwnership', 'releaseControl',
  'requestControl', 'respondControlRequest', 'mapPing',
  'orderScoutTravel', 'orderShipTravel', 'orderBattleGroupTravel',
  'setCombatDoctrine', 'setAdvancedTactics', 'setCombatPriority',
  'cancelTacticalRetreat', 'promoteBattleToTactical', 'issueTacticalOrder',
  'setPaused', 'togglePaused',
  'devAction',
]);

/** Full registry of host-handled commands (for fail-closed audits). */
export const COOP_COMMAND_REGISTRY = new Set([
  ...WORLD_MUTATING_COMMANDS,
  'setFlagshipInput',
  'orderTravel',
  'toggleOrbit',
  'toggleWingHangar',
  'requestSnapshot',
]);

/** High-frequency commands that shouldn't trigger an immediate summary broadcast. */
export const QUIET_COMMANDS = new Set(['setFlagshipInput']);
