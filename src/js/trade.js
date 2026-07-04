// Trade stations + automatic trade income (Phase 5, GDD §13).

import {
  TRADE_STATION_COST,
  TRADE_BASE_INCOME,
  TRADE_CONNECTIVITY_BONUS,
  TICK_MS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import { shellTradeBonus } from './dyson.js';
import { allocateStructureId } from './economy.js';
import {
  findPlanet,
  hasOutpost,
  isPlayerOwned,
  isStructureActive,
  structuresOn,
  systemById,
} from './state.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import { neighborsOf } from './galaxy.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
import { flagshipInSystem } from './flagship-presence.js';
import { hasPendingJob, queueConstructionJob } from './drones.js';

export function tradeStationCount(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  return system.structures.filter(
    (s) => s.type === 'trade_station' && isStructureActive(s),
  ).length;
}

export function canBuildTradeStation(state, systemId, planetId) {
  if (!isTechUnlocked(state, 'eco_trade_hub')) {
    return { ok: false, reason: 'Research Trade Hub Protocol first' };
  }
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const planet = findPlanet(state, systemId, planetId);
  if (!planet) return { ok: false, reason: 'No such planet' };
  if (planet.type === 'gas') return { ok: false, reason: 'Gas giants have no surface — orbital structures only' };
  if (planet.type === 'barren') return { ok: false, reason: 'Barren world — cannot support a trade station' };
  if (!hasOutpost(state, systemId, planetId)) {
    return { ok: false, reason: 'Outpost required before trade station' };
  }
  if (structuresOn(state, systemId, planetId).some(
    (s) => s.type === 'trade_station' && isStructureActive(s),
  )) {
    return { ok: false, reason: 'Trade station already built on this body' };
  }
  if (structuresOn(state, systemId, planetId).some(
    (s) => s.type === 'trade_station' && s.construction,
  ) || hasPendingJob(state, systemId, planetId, 'trade_station')) {
    return { ok: false, reason: 'Trade station construction already in progress' };
  }
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < TRADE_STATION_COST) {
    return { ok: false, reason: `Need ${TRADE_STATION_COST} credits` };
  }
  return { ok: true };
}

export function buildTradeStation(state, systemId, planetId) {
  const check = canBuildTradeStation(state, systemId, planetId);
  if (!check.ok) return check;

  return queueConstructionJob(state, {
    systemId,
    structureType: 'trade_station',
    bodyId: planetId,
    creditCost: TRADE_STATION_COST,
    durationMs: STRUCTURE_BUILD_MS.trade_station,
  });
}

function systemsWithTrade(state) {
  const ids = [];
  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    if (tradeStationCount(state, system.id) > 0) ids.push(system.id);
  }
  return ids;
}

function canConnect(graph, owned, a, b, allowNeutralBridge) {
  if (!neighborsOf(graph, a).includes(b)) return false;
  if (owned.has(a) && owned.has(b)) return true;
  if (!allowNeutralBridge) return false;
  // One-hop neutral bridge: owned — neutral — owned
  return false; // simplified: only direct owned adjacency in Phase 5 base; bridge via tech
}

export function buildTradeGraph(state) {
  const graph = getGraph(state);
  const tradeNodes = new Set(systemsWithTrade(state));
  const owned = new Set(
    Object.values(getSystems(state)).filter((s) => s.owner === 'player').map((s) => s.id),
  );
  const allowBridge = false; // trade_lane_secured expands later

  const visited = new Set();
  const components = [];

  for (const start of tradeNodes) {
    if (visited.has(start)) continue;
    const component = [];
    const queue = [start];
    visited.add(start);
    while (queue.length) {
      const cur = queue.shift();
      component.push(cur);
      for (const next of neighborsOf(graph, cur)) {
        if (!tradeNodes.has(next) || visited.has(next)) continue;
        if (!owned.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }

  return components;
}

export function tradeIncomePerSecond(state) {
  return tradeIncomePerSecondSync(state);
}

export function tradeIncomePerSecondSync(state) {
  const components = buildTradeGraph(state);
  const tradeMult = techEffects(state).tradeIncomeMult;
  let total = 0;

  for (const component of components) {
    let stationCount = 0;
    let shellMultSum = 0;
    for (const sysId of component) {
      const n = tradeStationCount(state, sysId);
      stationCount += n;
      const system = systemById(state, sysId);
      shellMultSum += n * shellTradeBonus(system);
    }
    if (stationCount === 0) continue;
    const connectivity = 1 + TRADE_CONNECTIVITY_BONUS * Math.max(0, component.length - 1);
    const avgShell = shellMultSum / stationCount;
    total += TRADE_BASE_INCOME * stationCount * connectivity * avgShell * tradeMult;
  }
  return total;
}

export function tickTrade(state) {
  if (state.paused) return 0;
  const rate = tradeIncomePerSecondSync(state);
  const delta = rate * (TICK_MS / 1000);
  state.credits += delta;
  return delta;
}

export function tradeSummary(state) {
  const components = buildTradeGraph(state);
  let stationCount = 0;
  for (const system of Object.values(getSystems(state))) {
    if (isPlayerOwned(state, system.id)) stationCount += tradeStationCount(state, system.id);
  }
  return {
    stationCount,
    componentCount: components.length,
    largestComponent: components.reduce((m, c) => Math.max(m, c.length), 0),
    incomePerSec: Math.round(tradeIncomePerSecondSync(state) * 100) / 100,
  };
}

export function tradeFlowIntensity(state, laneKey) {
  // Deterministic pulse intensity 0..1 for galaxy render
  const [a, b] = laneKey.split('|');
  const components = buildTradeGraph(state);
  for (const comp of components) {
    if (comp.includes(a) && comp.includes(b)) {
      const stations = comp.reduce((n, id) => n + tradeStationCount(state, id), 0);
      return Math.min(1, 0.2 + stations * 0.15);
    }
  }
  return 0;
}
