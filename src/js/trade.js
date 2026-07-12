// Trade stations + automatic trade income (Phase 5, GDD §13).

import {
  TRADE_STATION_COST,
  TRADE_BASE_INCOME,
  TRADE_CONNECTIVITY_BONUS,
  TICK_MS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import { shellTradeBonus } from './dyson.js';
import { diplomaticTradeBonus } from './diplomacy.js';
import { allocateStructureId } from './economy.js';
import {
  findPlanet,
  hasOutpost,
  isPlayerOwned,
  isStructureActive,
  systemById,
} from './state.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import { neighborsOf } from './galaxy.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
import { flagshipInSystem } from './flagship-presence.js';
import { hasPendingJob, queueConstructionJob } from './drones.js';
import { blockadeTradeMultiplier } from './strategic-structures.js';
import {
  bodyStructureBlockadeMultiplier,
  bodyStructureTradeMultiplier,
} from './body-structures.js';

export function tradeStationCount(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  return system.structures.filter(
    (s) => ['trade_station', 'export_depot', 'trade_nexus'].includes(s.type) && isStructureActive(s),
  ).length;
}

export function canBuildTradeStation(state, systemId, planetId, opts = {}) {
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
  if (system.structures.some(
    (s) => ['trade_station', 'export_depot', 'trade_nexus'].includes(s.type) && isStructureActive(s),
  )) {
    return { ok: false, reason: 'This system already has an export depot' };
  }
  if (system.structures.some(
    (s) => ['trade_station', 'export_depot'].includes(s.type) && s.construction,
  ) || hasPendingJob(state, systemId, null, 'export_depot')) {
    return { ok: false, reason: 'Export depot construction already in progress' };
  }
  if (!opts.remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (!opts.ignoreCredits && state.credits < TRADE_STATION_COST) {
    return { ok: false, reason: `Need ${TRADE_STATION_COST} credits` };
  }
  return { ok: true };
}

export function buildTradeStation(state, systemId, planetId, opts = {}) {
  const check = canBuildTradeStation(state, systemId, planetId, opts);
  if (!check.ok) return check;

  if (opts.remote) {
    if (!opts.alreadyPaid) state.credits -= TRADE_STATION_COST;
    const structure = {
      id: allocateStructureId(), type: 'export_depot', bodyId: null,
      sourceBodyId: planetId, builtAtTime: state.time, hp: 520, maxHp: 520, operational: true,
    };
    systemById(state, systemId).structures.push(structure);
    return { ok: true, structureId: structure.id, type: structure.type, systemId };
  }

  return queueConstructionJob(state, {
    systemId,
    structureType: 'export_depot',
    bodyId: null,
    creditCost: TRADE_STATION_COST,
    durationMs: STRUCTURE_BUILD_MS.trade_station,
    extraStructureFields: {
      hp: 520,
      maxHp: 520,
      operational: true,
    },
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
  const sysA = owned.has(a);
  const sysB = owned.has(b);
  if (sysA || sysB) {
    const mid = sysA ? b : a;
    const midSys = graph.stars.find((s) => s.id === mid);
    if (midSys && !owned.has(mid)) return true;
  }
  return false;
}

export function buildTradeGraph(state) {
  const graph = getGraph(state);
  const tradeNodes = new Set(systemsWithTrade(state));
  const owned = new Set(
    Object.values(getSystems(state)).filter((s) => s.owner === 'player').map((s) => s.id),
  );
  const allowBridge = techEffects(state).tradeNeutralBridge
    || isTechUnlocked(state, 'trade_lane_secured');

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
        if (!canConnect(graph, owned, cur, next, allowBridge)) continue;
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
    let blockadeMult = 1;
    for (let i = 0; i < component.length - 1; i++) {
      for (let j = i + 1; j < component.length; j++) {
        if (neighborsOf(getGraph(state), component[i]).includes(component[j])) {
          let laneMult = blockadeTradeMultiplier(state, component[i], component[j]);
          laneMult = bodyStructureBlockadeMultiplier(state, component[i], laneMult);
          laneMult = bodyStructureBlockadeMultiplier(state, component[j], laneMult);
          blockadeMult = Math.min(blockadeMult, laneMult);
        }
      }
    }
    const refineryMult = component.reduce((m, sysId) => m * bodyStructureTradeMultiplier(state, sysId), 1);
    total += TRADE_BASE_INCOME * stationCount * connectivity * avgShell * tradeMult * blockadeMult * refineryMult
      * diplomaticTradeBonus(state);
  }
  return total;
}

export function tickTrade(state) {
  // Compatibility no-op: physical convoy delivery in logistics.js is now the
  // sole authority for trade credits.
  return 0;
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
    // Credits are now awarded exclusively by physical convoy delivery.
    incomePerSec: 0,
    projectedLegacyIncomePerSec: Math.round(tradeIncomePerSecondSync(state) * 100) / 100,
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
