// Manual trade routes (Phase 6 deferral from Phase 5, GDD §13).

import { MANUAL_TRADE_ROUTE_MAX, MANUAL_TRADE_ROUTE_BONUS } from './constants.js';
import { tradeStationCount } from './trade.js';
import { isPlayerOwned, systemById } from './state.js';
import { getGraph } from './galaxy-scope.js';
import { neighborsOf } from './galaxy.js';
import { isTechUnlocked } from './tech-web.js';

let nextRouteId = 1;

export function ensureTradeRoutes(state) {
  if (!state.manualTradeRoutes) state.manualTradeRoutes = [];
}

export function resetTradeRouteIds(state) {
  let max = 0;
  for (const r of state.manualTradeRoutes ?? []) {
    const n = parseInt(String(r.id).replace('route-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextRouteId = max + 1;
}

function routeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function canAddTradeRoute(state, fromSystemId, toSystemId) {
  if (!isTechUnlocked(state, 'trade_route_opt')) {
    return { ok: false, reason: 'Research Route Optimization first' };
  }
  if (fromSystemId === toSystemId) {
    return { ok: false, reason: 'Cannot route a system to itself' };
  }
  ensureTradeRoutes(state);
  if (state.manualTradeRoutes.length >= MANUAL_TRADE_ROUTE_MAX) {
    return { ok: false, reason: 'Maximum manual routes reached' };
  }
  if (!isPlayerOwned(state, fromSystemId) || !isPlayerOwned(state, toSystemId)) {
    return { ok: false, reason: 'Both systems must be player-owned' };
  }
  if (tradeStationCount(state, fromSystemId) < 1 || tradeStationCount(state, toSystemId) < 1) {
    return { ok: false, reason: 'Both systems need trade stations' };
  }
  const graph = getGraph(state);
  const adjacent = neighborsOf(graph, fromSystemId).includes(toSystemId);
  const bridge = isTechUnlocked(state, 'trade_lane_secured');
  if (!adjacent && !bridge) {
    return { ok: false, reason: 'Systems must be lane-adjacent (or research Secured Lanes)' };
  }
  const key = routeKey(fromSystemId, toSystemId);
  if (state.manualTradeRoutes.some((r) => routeKey(r.fromSystemId, r.toSystemId) === key)) {
    return { ok: false, reason: 'Route already exists' };
  }
  return { ok: true };
}

export function addTradeRoute(state, fromSystemId, toSystemId) {
  const check = canAddTradeRoute(state, fromSystemId, toSystemId);
  if (!check.ok) return check;
  ensureTradeRoutes(state);
  const route = {
    id: `route-${nextRouteId++}`,
    fromSystemId,
    toSystemId,
    createdAt: state.time,
  };
  state.manualTradeRoutes.push(route);
  return { ok: true, route };
}

export function clearTradeRoutes(state) {
  ensureTradeRoutes(state);
  const n = state.manualTradeRoutes.length;
  state.manualTradeRoutes = [];
  return { ok: true, cleared: n };
}

export function manualRouteBonus(state) {
  ensureTradeRoutes(state);
  if (state.manualTradeRoutes.length === 0) return 1;
  return 1 + MANUAL_TRADE_ROUTE_BONUS * state.manualTradeRoutes.length;
}

export function tradeRoutesSummary(state) {
  ensureTradeRoutes(state);
  return {
    count: state.manualTradeRoutes.length,
    max: MANUAL_TRADE_ROUTE_MAX,
    bonus: manualRouteBonus(state),
    routes: state.manualTradeRoutes.map((r) => ({
      id: r.id,
      from: r.fromSystemId,
      to: r.toSystemId,
    })),
  };
}
