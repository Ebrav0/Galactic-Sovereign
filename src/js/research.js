// Research stations + tech web progress (Phase 5, GDD §10).

import {
  RESEARCH_STATION_COST,
  RESEARCH_STATION_CAP,
  RESEARCH_STATION_BONUS,
  RESEARCH_BASE_MS,
  TICK_MS,
} from './constants.js';
import { shellResearchBonus } from './dyson.js';
import {
  allocateStructureId,
} from './economy.js';
import {
  ensureDyson,
  findPlanet,
  isPlayerOwned,
  systemById,
} from './state.js';
import { getSystems } from './galaxy-scope.js';
import {
  techNode,
  techPrereqsMet,
  techCost,
  derivedTier,
  isTechUnlocked,
  applyTechEffect,
  techEffects,
} from './tech-web.js';

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

export function ensureResearchState(state) {
  if (!state.research) {
    state.research = {
      activeNodeId: null,
      progress: 0,
      unlocked: ['eco_baseline'],
      queue: [],
    };
  }
  if (!state.research.unlocked) state.research.unlocked = ['eco_baseline'];
  if (!state.research.queue) state.research.queue = [];
}

export function researchStationCount(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  if (system.researchStationCount != null) return system.researchStationCount;
  return system.structures.filter((s) => s.type === 'research_station').length;
}

export function canBuildResearchStation(state, systemId) {
  if (!isTechUnlocked(state, 'res_station_protocol')) {
    return { ok: false, reason: 'Research Research Station protocol first' };
  }
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  if (researchStationCount(state, systemId) >= RESEARCH_STATION_CAP) {
    return { ok: false, reason: `Research station cap (${RESEARCH_STATION_CAP}/system)` };
  }
  const host = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
  if (!host) return { ok: false, reason: 'No anchor body for research station' };
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < RESEARCH_STATION_COST) {
    return { ok: false, reason: `Need ${RESEARCH_STATION_COST} credits` };
  }
  return { ok: true, anchorBodyId: host.id };
}

export function buildResearchStation(state, systemId) {
  const check = canBuildResearchStation(state, systemId);
  if (!check.ok) return check;

  state.credits -= RESEARCH_STATION_COST;
  const system = systemById(state, systemId);
  const orbitIndex = researchStationCount(state, systemId);
  system.structures.push({
    id: allocateStructureId(),
    type: 'research_station',
    bodyId: check.anchorBodyId,
    orbitIndex,
    builtAtTime: state.time,
  });
  system.researchStationCount = researchStationCount(state, systemId) + 1;
  return { ok: true };
}

export function totalResearchStationBonus(state) {
  let count = 0;
  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    count += researchStationCount(state, system.id);
  }
  return count * RESEARCH_STATION_BONUS;
}

export function researchSpeedMultiplier(state, systemId = null) {
  ensureResearchState(state);
  let mult = 1 + totalResearchStationBonus(state);
  mult *= techEffects(state).researchSpeedMult;
  if (systemId) {
    const system = systemById(state, systemId);
    if (system) mult *= shellResearchBonus(system);
  } else {
    // Use best shell bonus among player systems with stations
    let best = 1;
    for (const system of Object.values(getSystems(state))) {
      if (!isPlayerOwned(state, system.id)) continue;
      if (researchStationCount(state, system.id) > 0) {
        best = Math.max(best, shellResearchBonus(system));
      }
    }
    mult *= best;
  }
  return mult;
}

function nodeResearchMs(nodeId) {
  const node = techNode(nodeId);
  if (!node) return RESEARCH_BASE_MS;
  const depth = derivedTier(nodeId);
  return node.researchMs || Math.round(RESEARCH_BASE_MS * (1 + (depth - 1) * 0.25));
}

export function canStartResearch(state, nodeId) {
  ensureResearchState(state);
  const node = techNode(nodeId);
  if (!node) return { ok: false, reason: 'Unknown tech node' };
  if (isTechUnlocked(state, nodeId)) return { ok: false, reason: 'Already researched' };
  if (!techPrereqsMet(state, nodeId)) return { ok: false, reason: 'Prerequisites not met' };
  if (state.research.activeNodeId && state.research.activeNodeId !== nodeId) {
    const maxQueue = techEffects(state).researchQueueDepth - 1;
    if (state.research.queue.length >= maxQueue) {
      return { ok: false, reason: 'Research queue full' };
    }
  }

  const cost = techCost(nodeId);
  if (cost.solarii > 0 && !state.solariiUnlocked) {
    return { ok: false, reason: 'Requires Solarii (complete Shell #1 first)' };
  }
  if (state.credits < cost.credits) return { ok: false, reason: `Need ${cost.credits} credits` };
  if ((state.solarii ?? 0) < cost.solarii) return { ok: false, reason: `Need ${cost.solarii} Solarii` };

  return { ok: true, cost, durationMs: nodeResearchMs(nodeId) };
}

export function startResearch(state, nodeId) {
  const check = canStartResearch(state, nodeId);
  if (!check.ok) return check;

  ensureResearchState(state);
  if (state.research.activeNodeId) {
    state.research.queue.push(nodeId);
    state.credits -= check.cost.credits;
    state.solarii = (state.solarii ?? 0) - check.cost.solarii;
    return { ok: true, queued: true, nodeId };
  }

  state.credits -= check.cost.credits;
  state.solarii = (state.solarii ?? 0) - check.cost.solarii;
  state.research.activeNodeId = nodeId;
  state.research.progress = 0;
  state.research.durationMs = check.durationMs;
  return { ok: true, nodeId, durationMs: check.durationMs };
}

export function cancelResearch(state) {
  ensureResearchState(state);
  if (!state.research.activeNodeId) return { ok: false, reason: 'No active research' };
  // No refund on cancel once started
  state.research.activeNodeId = null;
  state.research.progress = 0;
  state.research.durationMs = null;
  if (state.research.queue.length > 0) {
    const next = state.research.queue.shift();
    return startResearch(state, next);
  }
  return { ok: true };
}

export function tickResearch(state) {
  if (state.paused) return [];
  ensureResearchState(state);
  const events = [];
  if (!state.research.activeNodeId) return events;

  const durationMs = state.research.durationMs ?? nodeResearchMs(state.research.activeNodeId);
  const speed = researchSpeedMultiplier(state);
  const delta = (TICK_MS / durationMs) * speed;
  state.research.progress += delta;

  if (state.research.progress < 1) return events;

  const nodeId = state.research.activeNodeId;
  state.research.unlocked.push(nodeId);
  applyTechEffect(state, nodeId);
  events.push({ type: 'research_complete', nodeId });

  state.research.activeNodeId = null;
  state.research.progress = 0;
  state.research.durationMs = null;

  if (state.research.queue.length > 0) {
    const next = state.research.queue.shift();
    const res = startResearch(state, next);
    if (res.ok && !res.queued) events.push({ type: 'research_started', nodeId: next });
  }

  return events;
}

export function researchSummary(state) {
  ensureResearchState(state);
  return {
    activeNodeId: state.research.activeNodeId,
    progress: Math.round((state.research.progress ?? 0) * 1000) / 1000,
    unlocked: [...(state.research.unlocked ?? [])],
    queue: [...(state.research.queue ?? [])],
    stationCount: Object.values(getSystems(state)).reduce(
      (n, sys) => n + (isPlayerOwned(state, sys.id) ? researchStationCount(state, sys.id) : 0),
      0,
    ),
    speedMult: Math.round(researchSpeedMultiplier(state) * 100) / 100,
  };
}
