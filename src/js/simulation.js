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
import { evaluateActiveMission } from './missions.js';
import { tryAdvanceTutorial } from './tutorial.js';
import { tickBodyStructureEffects } from './body-structures.js';
import { tickBuilderDrones } from './builder-drones.js';
import { tickLogistics } from './logistics.js';
import { syncFlagshipAnchoredFleets } from './battle-groups.js';
import { tickBulkProduction } from './bulk-production.js';
import { tickBulkDeliveries } from './production-delivery.js';
import { tickIntegratedStrategicOperations } from './strategic-integration.js';
import { systemById } from './state.js';

let lastSimPerf = {
  ticksAdvanced: 0,
  totalMs: 0,
  abstractMs: 0,
  wormholeMs: 0,
  logisticsMs: 0,
  aiMs: 0,
  combatMs: 0,
};

export function simPerfSummary() {
  return { ...lastSimPerf };
}

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
  let t0 = performance.now();
  tickAbstractGalaxies(state);
  const abstractMs = performance.now() - t0;

  t0 = performance.now();
  const wormholeArrival = tickWormholeTransit(state);
  const wormholeMs = performance.now() - t0;

  applyIncomeTick(state);
  tickTrade(state);

  t0 = performance.now();
  const logisticsEvents = tickLogistics(state);
  const logisticsMs = performance.now() - t0;

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

  t0 = performance.now();
  const aiEvents = tickAiFaction(state);
  tickHeroFlagships(state);
  const scoutArrivals = tickScouts(state);
  const shipArrivals = tickPlayerShips(state, (destId) => handleArrival(state, destId, 'player'));
  const aiArrivals = tickAiShips(state, (destId, ship) => handleArrival(state, destId, aiShipFactionId(state, ship)));
  const pirateArrivals = tickPirates(state, (destId) => handleArrival(state, destId));
  const pirateInterdictions = tickPirateInterdictions(state, (destId) => handleArrival(state, destId));
  tickFlagship(state); // per-pilot roster; wormhole-transiting ships skip inside
  const flagshipAnchorEvents = syncFlagshipAnchoredFleets(state);
  const aiMs = performance.now() - t0;

  t0 = performance.now();
  const battleEvents = tickCombat(state);
  const combatMs = performance.now() - t0;

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
  const mission = evaluateActiveMission(state);
  if (mission?.complete) {
    campaignEvents.push({
      type: 'mission_complete',
      missionId: mission.missionId,
      objectiveId: mission.objectiveId,
    });
  }
  return {
    prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, pirateInterdictions, battleEvents, dysonEvents, capture,
    wormholeArrival, campaignEvents, bodyStructureEvents, builderDroneEvents, droneCompletions, logisticsEvents,
    flagshipAnchorEvents, bulkProductionEvents, bulkDeliveryEvents, strategicOperationEvents, diplomacyEvents,
    aiEvents,
    _perf: { abstractMs, wormholeMs, logisticsMs, aiMs, combatMs },
  };
}

export function step(state, accumulatedMs, { maxTicks = Infinity } = {}) {
  if (state.paused) {
    lastSimPerf = {
      ticksAdvanced: 0,
      totalMs: 0,
      abstractMs: 0,
      wormholeMs: 0,
      logisticsMs: 0,
      aiMs: 0,
      combatMs: 0,
    };
    return {
      captures: [], prodReady: [], scoutArrivals: [], shipArrivals: [], aiArrivals: [], pirateArrivals: [], pirateInterdictions: [],
      battleEvents: [], dysonEvents: [], wormholeArrivals: [], builderDroneEvents: [], droneCompletions: [], logisticsEvents: [],
      bulkProductionEvents: [], bulkDeliveryEvents: [],
      strategicOperationEvents: [],
      diplomacyEvents: [],
      aiEvents: [],
      campaignEvents: [],
      remainingMs: 0,
      ticksAdvanced: 0,
    };
  }
  const stepStartedAt = performance.now();
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
  const aiEvents = [];
  const campaignEvents = [];
  let ticks = 0;
  let abstractMs = 0;
  let wormholeMs = 0;
  let logisticsMs = 0;
  let aiMs = 0;
  let combatMs = 0;
  while (remaining >= TICK_MS && ticks < maxTicks) {
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
    aiEvents.push(...(events.aiEvents ?? []));
    campaignEvents.push(...(events.campaignEvents ?? []));
    if (events.capture) captures.push(events.capture);
    if (events.wormholeArrival) wormholeArrivals.push(events.wormholeArrival);
    abstractMs += events._perf?.abstractMs ?? 0;
    wormholeMs += events._perf?.wormholeMs ?? 0;
    logisticsMs += events._perf?.logisticsMs ?? 0;
    aiMs += events._perf?.aiMs ?? 0;
    combatMs += events._perf?.combatMs ?? 0;
    remaining -= TICK_MS;
    ticks += 1;
  }
  // If we hit the catch-up cap, discard the backlog so hitch cascades cannot compound.
  if (Number.isFinite(maxTicks) && ticks >= maxTicks && remaining >= TICK_MS) {
    remaining %= TICK_MS;
  }
  const totalMs = performance.now() - stepStartedAt;
  lastSimPerf = {
    ticksAdvanced: ticks,
    totalMs: Math.round(totalMs * 100) / 100,
    abstractMs: Math.round(abstractMs * 100) / 100,
    wormholeMs: Math.round(wormholeMs * 100) / 100,
    logisticsMs: Math.round(logisticsMs * 100) / 100,
    aiMs: Math.round(aiMs * 100) / 100,
    combatMs: Math.round(combatMs * 100) / 100,
  };
  return {
    captures, prodReady, scoutArrivals, shipArrivals, aiArrivals, pirateArrivals, pirateInterdictions, battleEvents, dysonEvents,
    wormholeArrivals, remainingMs: remaining, ticksAdvanced: ticks,
    builderDroneEvents, droneCompletions, logisticsEvents,
    bulkProductionEvents, bulkDeliveryEvents,
    strategicOperationEvents,
    diplomacyEvents,
    aiEvents,
    campaignEvents,
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
      aiEvents: [],
      campaignEvents: [],
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
  const aiEvents = [];
  const campaignEvents = [];
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
    aiEvents.push(...(events.aiEvents ?? []));
    campaignEvents.push(...(events.campaignEvents ?? []));
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
    aiEvents,
    campaignEvents,
  };
}

export function setPaused(state, paused) {
  state.paused = paused;
}

export function togglePaused(state) {
  state.paused = !state.paused;
  return state.paused;
}
