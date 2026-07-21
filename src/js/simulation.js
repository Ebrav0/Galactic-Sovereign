// Fixed-timestep tick driver (IMPLEMENTATION_PLAN §1, Phase 5 tick order).

import { TICK_MS } from './constants.js';
import { applyIncomeTick } from './economy.js';
import { tickFlagship } from './flagship.js';
import { tickProduction } from './production.js';
import { tickScouts } from './scout.js';
import { tickCapture } from './capture.js';
import { tickPlayerShips } from './fleets.js';
import { tickPirates, tickPirateInterdictions } from './pirates.js';
import { onForcesArrive, tickCombat } from './combat.js';
import { tickDyson, applySolariiTick } from './dyson.js';
import { tickAbstractGalaxies } from './abstract-galaxy.js';
import { tickWormholeTransit } from './wormholes.js';
import { tickTrade } from './trade.js';
import { tickResearch } from './research.js';
import { dispatchEmpireQueue } from './empire-queue.js';
import { tickAiFaction } from './ai-faction.js';
import { aiShipFactionId, tickAiShips } from './ai-ships.js';
import { tickDrones } from './drones.js';
import { recordDiplomaticEvent, tickDiplomacy } from './diplomacy.js';
import { tickSuperweapon } from './superweapon.js';
import { tickFlagshipWing } from './flagship-wing.js';
import { tickHeroFlagships } from './hero-flagships.js';
import { tickCampaign } from './campaign.js';
import { tryAdvanceTutorial } from './tutorial.js';
import { tickBodyStructureEffects } from './body-structures.js';
import { tickBuilderDrones } from './builder-drones.js';
import { tickLogistics } from './logistics.js';
import { syncFlagshipAnchoredFleets } from './battle-groups.js';
import { tickBulkProduction } from './bulk-production.js';
import { tickBulkDeliveries } from './production-delivery.js';
import { tickIntegratedStrategicOperations } from './strategic-integration.js';
import { systemById } from './state.js';

function handleArrival(state, systemId, actorId = null) {
  const system = systemById(state, systemId);
  const controller = system?.owner === 'player' ? 'player'
    : system?.owner === 'ai' ? system.factionId : null;
  if (actorId && controller && actorId !== controller) {
    const detectedFaction = actorId === 'player' ? controller : controller === 'player' ? actorId : null;
    if (detectedFaction && detectedFaction !== 'player') recordDiplomaticEvent(state, {
      type: 'contact_detected',
      target: detectedFaction,
      trigger: actorId === 'player' ? 'border_encounter' : 'intercepted_ship',
      intelligence: 30,
    });
    recordDiplomaticEvent(state, {
      type: 'border_friction', actor: actorId, target: controller,
      systemId, severity: 0.5,
    });
  }
  onForcesArrive(state, systemId);
}

function tickOnce(state) {
  state.time += TICK_MS;
  // Phase 6 order: abstract → wormhole → income → trade → research → diplomacy
  // → superweapon cooldowns → dispatch → production → AI → hero flagships
  // → fleet transits → pirates → combat → dyson → capture → campaign
  tickAbstractGalaxies(state);
  const wormholeArrival = tickWormholeTransit(state);
  applyIncomeTick(state);
  tickTrade(state);
  const logisticsEvents = tickLogistics(state);
  tickResearch(state);
  const diplomacyEvents = tickDiplomacy(state);
  tickSuperweapon(state);
  tickFlagshipWing(state);
  const bulkProductionTick = tickBulkProduction(state);
  const bulkProductionEvents = bulkProductionTick.materializedCount > 0
    ? [{
      type: 'bulk_production_tick',
      materializedCount: bulkProductionTick.materializedCount,
      spent: bulkProductionTick.spent,
      blocked: bulkProductionTick.blocked,
    }]
    : [];
  dispatchEmpireQueue(state);
  const prodReady = tickProduction(state);
  const bulkDeliveryEvents = tickBulkDeliveries(state);
  const droneCompletions = tickDrones(state);
  const strategicOperationEvents = tickIntegratedStrategicOperations(state);
  tickAiFaction(state);
  tickHeroFlagships(state);
  const scoutArrivals = tickScouts(state);
  const shipArrivals = tickPlayerShips(state, (destId) => handleArrival(state, destId, 'player'));
  const aiArrivals = tickAiShips(state, (destId, ship) => handleArrival(state, destId, aiShipFactionId(state, ship)));
  const pirateArrivals = tickPirates(state, (destId) => handleArrival(state, destId));
  const pirateInterdictions = tickPirateInterdictions(state, (destId) => handleArrival(state, destId));
  if (!state.flagship.wormholeTransit) tickFlagship(state);
  const flagshipAnchorEvents = syncFlagshipAnchoredFleets(state);
  const battleEvents = tickCombat(state);
  const bodyStructureEvents = tickBodyStructureEffects(state);
  const builderDroneEvents = tickBuilderDrones(state);
  const dysonEvents = tickDyson(state);
  for (const event of dysonEvents) if (event.shellCompleted && event.shellNumber >= 8) {
    for (const faction of state.factions?.list ?? []) recordDiplomaticEvent(state, {
      type: 'dyson_completed', actor: 'player', target: faction.id, systemId: event.systemId,
    });
  }
  applySolariiTick(state);
  const capture = tickCapture(state);
  tryAdvanceTutorial(state);
  const campaignEvents = tickCampaign(state);
  return {
    prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, pirateInterdictions, battleEvents, dysonEvents, capture,
    wormholeArrival, campaignEvents, bodyStructureEvents, builderDroneEvents, droneCompletions, logisticsEvents,
    flagshipAnchorEvents, bulkProductionEvents, bulkDeliveryEvents, strategicOperationEvents, diplomacyEvents,
  };
}

export function step(state, accumulatedMs) {
  if (state.paused) {
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], aiArrivals: [], pirateArrivals: [], pirateInterdictions: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [], builderDroneEvents: [], droneCompletions: [], logisticsEvents: [],
      bulkProductionEvents: [], bulkDeliveryEvents: [],
      strategicOperationEvents: [],
      diplomacyEvents: [],
    };
  }
  let remaining = accumulatedMs;
  const captures = [];
  const prodReady = [];
  const scoutArrivals = [];
  const shipArrivals = [];
  const aiArrivals = [];
  const pirateArrivals = [];
  const pirateInterdictions = [];
  const battleEvents = [];
  const dysonEvents = [];
  const wormholeArrivals = [];
  const droneCompletions = [];
  const builderDroneEvents = [];
  const logisticsEvents = [];
  const bulkProductionEvents = [];
  const bulkDeliveryEvents = [];
  const strategicOperationEvents = [];
  const diplomacyEvents = [];
  while (remaining >= TICK_MS) {
    const events = tickOnce(state);
    prodReady.push(...events.prodReady);
    scoutArrivals.push(...events.scoutArrivals);
    shipArrivals.push(...events.shipArrivals);
    aiArrivals.push(...events.aiArrivals);
    pirateArrivals.push(...events.pirateArrivals);
    pirateInterdictions.push(...events.pirateInterdictions);
    battleEvents.push(...events.battleEvents);
    dysonEvents.push(...events.dysonEvents);
    droneCompletions.push(...(events.droneCompletions ?? []));
    builderDroneEvents.push(...events.builderDroneEvents);
    logisticsEvents.push(...events.logisticsEvents);
    bulkProductionEvents.push(...(events.bulkProductionEvents ?? []));
    bulkDeliveryEvents.push(...events.bulkDeliveryEvents);
    if (events.strategicOperationEvents?.ticked) strategicOperationEvents.push(...events.strategicOperationEvents.events);
    diplomacyEvents.push(...(events.diplomacyEvents ?? []));
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
    remaining -= TICK_MS;
  }
  return {
    captures, prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, pirateInterdictions, battleEvents, dysonEvents,
    wormholeArrivals, remainingMs: remaining,
    builderDroneEvents, droneCompletions, logisticsEvents,
    bulkProductionEvents, bulkDeliveryEvents,
    strategicOperationEvents,
    diplomacyEvents,
  };
}

export function advance(state, ms) {
  if (state.paused) {
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], aiArrivals: [], pirateArrivals: [], pirateInterdictions: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [], builderDroneEvents: [], droneCompletions: [], logisticsEvents: [],
      bulkProductionEvents: [], bulkDeliveryEvents: [],
      strategicOperationEvents: [],
      diplomacyEvents: [],
    };
  }
  const ticks = Math.floor(ms / TICK_MS);
  const captures = [];
  const prodReady = [];
  const scoutArrivals = [];
  const shipArrivals = [];
  const aiArrivals = [];
  const pirateArrivals = [];
  const pirateInterdictions = [];
  const battleEvents = [];
  const dysonEvents = [];
  const wormholeArrivals = [];
  const droneCompletions = [];
  const builderDroneEvents = [];
  const logisticsEvents = [];
  const bulkProductionEvents = [];
  const bulkDeliveryEvents = [];
  const strategicOperationEvents = [];
  const diplomacyEvents = [];
  for (let i = 0; i < ticks; i++) {
    const events = tickOnce(state);
    prodReady.push(...events.prodReady);
    scoutArrivals.push(...events.scoutArrivals);
    shipArrivals.push(...events.shipArrivals);
    aiArrivals.push(...events.aiArrivals);
    pirateArrivals.push(...events.pirateArrivals);
    pirateInterdictions.push(...events.pirateInterdictions);
    battleEvents.push(...events.battleEvents);
    dysonEvents.push(...events.dysonEvents);
    droneCompletions.push(...(events.droneCompletions ?? []));
    builderDroneEvents.push(...events.builderDroneEvents);
    logisticsEvents.push(...events.logisticsEvents);
    bulkProductionEvents.push(...(events.bulkProductionEvents ?? []));
    bulkDeliveryEvents.push(...events.bulkDeliveryEvents);
    if (events.strategicOperationEvents?.ticked) strategicOperationEvents.push(...events.strategicOperationEvents.events);
    diplomacyEvents.push(...(events.diplomacyEvents ?? []));
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
  }
  return {
    captures, prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, pirateInterdictions, battleEvents, dysonEvents,
    wormholeArrivals,
    builderDroneEvents, droneCompletions, logisticsEvents,
    bulkProductionEvents, bulkDeliveryEvents,
    strategicOperationEvents,
    diplomacyEvents,
  };
}

export function setPaused(state, paused) {
  state.paused = paused;
}

export function togglePaused(state) {
  state.paused = !state.paused;
  return state.paused;
}
