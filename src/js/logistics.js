// Deterministic physical logistics simulation.
//
// This module deliberately has no DOM, renderer, save, or simulation-loop dependency.
// Call tickLogistics() once after state.time advances by the fixed 50 ms game tick.
// All mutable data lives under state.logistics and survives JSON round trips.

import {
  TICK_MS,
  LOGISTICS_PRODUCTION_RATES,
  LOGISTICS_MOON_PRODUCTION_BONUS,
  LOGISTICS_OUTPOST_STOCK_CAPACITY,
  LOGISTICS_LOCAL_DISPATCH_CARGO,
  LOGISTICS_LOCAL_TRANSPORT_CAPACITY,
  LOGISTICS_LOCAL_TRANSFER_MS,
  LOGISTICS_LOCAL_DISPATCH_INTERVAL_MS,
  LOGISTICS_DEPOT_CAPACITY,
  LOGISTICS_MIN_DISPATCH_CARGO,
  LOGISTICS_CONVOY_CAPACITY,
  LOGISTICS_DISPATCH_INTERVAL_MS,
  LOGISTICS_JUMP_CHARGE_MS,
  LOGISTICS_LANE_SPEED,
  LOGISTICS_LANE_MIN_LEG_MS,
  LOGISTICS_DEFAULT_CONVOY_ARMOR,
  LOGISTICS_CARGO_CREDIT_VALUE,
  LOGISTICS_RECENT_DELIVERY_WINDOW_MS,
} from './constants.js';
import {
  laneBezierAngle,
  laneBezierPoint,
  laneBulge,
  laneControlPoint,
} from './galaxy.js';
import { getGraph, getSystems } from './galaxy-scope.js';

export const CARGO_TYPES = Object.freeze([
  'rawMaterials',
  'fuel',
  'manufacturedGoods',
]);

const BASE_PRODUCTION_RATES = Object.freeze({
  habitable: Object.freeze({ ...LOGISTICS_PRODUCTION_RATES.habitable }),
  barren: Object.freeze({ ...LOGISTICS_PRODUCTION_RATES.barren }),
  gas: Object.freeze({ ...LOGISTICS_PRODUCTION_RATES.gas }),
});

export const DEFAULT_LOGISTICS_CONFIG = Object.freeze({
  productionRates: BASE_PRODUCTION_RATES,
  moonProductionBonus: LOGISTICS_MOON_PRODUCTION_BONUS,
  outpostStockCapacity: LOGISTICS_OUTPOST_STOCK_CAPACITY,
  localDispatchCargo: LOGISTICS_LOCAL_DISPATCH_CARGO,
  localTransportCapacity: LOGISTICS_LOCAL_TRANSPORT_CAPACITY,
  localTransitMs: LOGISTICS_LOCAL_TRANSFER_MS,
  localDispatchIntervalMs: LOGISTICS_LOCAL_DISPATCH_INTERVAL_MS,
  depotCapacity: LOGISTICS_DEPOT_CAPACITY,
  minDispatchCargo: LOGISTICS_MIN_DISPATCH_CARGO,
  convoyCapacity: LOGISTICS_CONVOY_CAPACITY,
  convoyDispatchIntervalMs: LOGISTICS_DISPATCH_INTERVAL_MS,
  jumpDurationMs: LOGISTICS_JUMP_CHARGE_MS,
  convoySpeed: LOGISTICS_LANE_SPEED,
  minLegMs: LOGISTICS_LANE_MIN_LEG_MS,
  defaultConvoyArmor: LOGISTICS_DEFAULT_CONVOY_ARMOR,
  cargoValues: Object.freeze({ ...LOGISTICS_CARGO_CREDIT_VALUE }),
  recentDeliveryWindowMs: LOGISTICS_RECENT_DELIVERY_WINDOW_MS,
  terminalConvoyLimit: 80,
  terminalLocalTransportLimit: 60,
  eventLimit: 120,
});

const CARGO_PRECISION = 1e6;
const EPSILON = 1e-7;

function roundCargo(value) {
  return Math.round(Math.max(0, Number(value) || 0) * CARGO_PRECISION) / CARGO_PRECISION;
}

function resolveConfig(overrides = {}) {
  const productionOverrides = overrides.productionRates ?? {};
  return {
    ...DEFAULT_LOGISTICS_CONFIG,
    ...overrides,
    productionRates: {
      habitable: { ...BASE_PRODUCTION_RATES.habitable, ...(productionOverrides.habitable ?? {}) },
      barren: { ...BASE_PRODUCTION_RATES.barren, ...(productionOverrides.barren ?? {}) },
      gas: { ...BASE_PRODUCTION_RATES.gas, ...(productionOverrides.gas ?? {}) },
    },
    cargoValues: {
      ...DEFAULT_LOGISTICS_CONFIG.cargoValues,
      ...(overrides.cargoValues ?? {}),
    },
  };
}

function configFrom(options) {
  return resolveConfig(options?.config ?? options ?? {});
}

export function emptyCargo() {
  return { rawMaterials: 0, fuel: 0, manufacturedGoods: 0 };
}

export function normalizeCargo(cargo = {}) {
  return {
    rawMaterials: roundCargo(cargo.rawMaterials),
    fuel: roundCargo(cargo.fuel),
    manufacturedGoods: roundCargo(cargo.manufacturedGoods),
  };
}

export function addCargo(a, b) {
  const left = normalizeCargo(a);
  const right = normalizeCargo(b);
  const result = emptyCargo();
  for (const type of CARGO_TYPES) result[type] = roundCargo(left[type] + right[type]);
  return result;
}

export function subtractCargo(a, b) {
  const left = normalizeCargo(a);
  const right = normalizeCargo(b);
  const result = emptyCargo();
  for (const type of CARGO_TYPES) result[type] = roundCargo(Math.max(0, left[type] - right[type]));
  return result;
}

export function scaleCargo(cargo, multiplier) {
  const source = normalizeCargo(cargo);
  const result = emptyCargo();
  const scale = Math.max(0, Number(multiplier) || 0);
  for (const type of CARGO_TYPES) result[type] = roundCargo(source[type] * scale);
  return result;
}

export function cargoTotal(cargo) {
  const normalized = normalizeCargo(cargo);
  return roundCargo(CARGO_TYPES.reduce((total, type) => total + normalized[type], 0));
}

export function cargoCreditValue(cargo, values = DEFAULT_LOGISTICS_CONFIG.cargoValues) {
  const normalized = normalizeCargo(cargo);
  return roundCargo(CARGO_TYPES.reduce(
    (total, type) => total + normalized[type] * Math.max(0, Number(values[type]) || 0),
    0,
  ));
}

/** Pure, deterministic proportional manifest that never exceeds capacity. */
export function cargoManifestFromInventory(inventory, capacity) {
  const source = normalizeCargo(inventory);
  const total = cargoTotal(source);
  const cap = Math.max(0, Number(capacity) || 0);
  if (total <= cap + EPSILON) return source;
  if (cap <= EPSILON || total <= EPSILON) return emptyCargo();

  const manifest = emptyCargo();
  let assigned = 0;
  for (let i = 0; i < CARGO_TYPES.length; i++) {
    const type = CARGO_TYPES[i];
    if (i === CARGO_TYPES.length - 1) {
      manifest[type] = roundCargo(Math.min(source[type], Math.max(0, cap - assigned)));
    } else {
      manifest[type] = roundCargo(Math.min(source[type], (source[type] / total) * cap));
      assigned = roundCargo(assigned + manifest[type]);
    }
  }
  return manifest;
}

function mutateCargo(target, next) {
  const normalized = normalizeCargo(next);
  for (const type of CARGO_TYPES) target[type] = normalized[type];
  return target;
}

function cargoRoom(inventory, capacity) {
  return Math.max(0, capacity - cargoTotal(inventory));
}

export function createDefaultLogisticsState() {
  return {
    version: 1,
    nextConvoyId: 1,
    nextLocalTransportId: 1,
    depots: {},
    routes: [],
    outpostStock: {},
    localTransports: [],
    convoys: [],
    blockades: { lanes: [], systems: [] },
    stats: {
      producedCargo: emptyCargo(),
      deliveredCargo: emptyCargo(),
      lostCargo: emptyCargo(),
      deliveredCredits: 0,
      convoysDispatched: 0,
      convoysDelivered: 0,
      convoysLost: 0,
      interceptionsRepelled: 0,
      recentDeliveries: [],
      lastDeliveryAt: null,
    },
    events: [],
    lastTickAt: null,
  };
}

/** Backfills a partial/migrated logistics record in place and returns it. */
export function ensureLogisticsState(state) {
  if (!state.logistics || typeof state.logistics !== 'object') {
    state.logistics = createDefaultLogisticsState();
    return state.logistics;
  }
  const base = createDefaultLogisticsState();
  const logistics = state.logistics;
  logistics.version = 1;
  logistics.nextConvoyId = Math.max(1, Number(logistics.nextConvoyId) || 1);
  logistics.nextLocalTransportId = Math.max(1, Number(logistics.nextLocalTransportId) || 1);
  logistics.depots = logistics.depots && typeof logistics.depots === 'object' ? logistics.depots : {};
  logistics.routes = Array.isArray(logistics.routes) ? logistics.routes : [];
  logistics.outpostStock = logistics.outpostStock && typeof logistics.outpostStock === 'object'
    ? logistics.outpostStock : {};
  logistics.localTransports = Array.isArray(logistics.localTransports) ? logistics.localTransports : [];
  logistics.convoys = Array.isArray(logistics.convoys) ? logistics.convoys : [];
  logistics.blockades = logistics.blockades && typeof logistics.blockades === 'object'
    ? logistics.blockades : base.blockades;
  logistics.blockades.lanes = Array.isArray(logistics.blockades.lanes) ? logistics.blockades.lanes : [];
  logistics.blockades.systems = Array.isArray(logistics.blockades.systems) ? logistics.blockades.systems : [];
  logistics.stats = { ...base.stats, ...(logistics.stats ?? {}) };
  logistics.stats.producedCargo = normalizeCargo(logistics.stats.producedCargo);
  logistics.stats.deliveredCargo = normalizeCargo(logistics.stats.deliveredCargo);
  logistics.stats.lostCargo = normalizeCargo(logistics.stats.lostCargo);
  logistics.stats.recentDeliveries = Array.isArray(logistics.stats.recentDeliveries)
    ? logistics.stats.recentDeliveries : [];
  logistics.events = Array.isArray(logistics.events) ? logistics.events : [];
  logistics.lastTickAt = Number.isFinite(logistics.lastTickAt) ? logistics.lastTickAt : null;
  return logistics;
}

export function resetLogisticsIds(state) {
  const logistics = ensureLogisticsState(state);
  let maxConvoy = 0;
  let maxLocal = 0;
  for (const convoy of logistics.convoys) {
    const n = Number.parseInt(String(convoy.id).replace('convoy-', ''), 10);
    if (Number.isFinite(n)) maxConvoy = Math.max(maxConvoy, n);
  }
  for (const transport of logistics.localTransports) {
    const n = Number.parseInt(String(transport.id).replace('local-', ''), 10);
    if (Number.isFinite(n)) maxLocal = Math.max(maxLocal, n);
  }
  logistics.nextConvoyId = maxConvoy + 1;
  logistics.nextLocalTransportId = maxLocal + 1;
}

function galaxyIdsForState(state, requested) {
  if (Array.isArray(requested)) return [...requested].sort();
  if (typeof requested === 'string') return [requested];
  if (state.galaxies) {
    return Object.keys(state.galaxies)
      .filter((id) => state.galaxies[id]?.graph && state.galaxies[id]?.systems)
      .sort();
  }
  return [state.activeGalaxyId ?? 'gal-0'];
}

function nodeMap(graph) {
  const nodes = new Map();
  for (const star of graph?.stars ?? []) nodes.set(star.id, star);
  if (graph?.blackHole) nodes.set(graph.blackHole.id, graph.blackHole);
  return nodes;
}

export function logisticsLaneKey(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function blockadeLaneId(galaxyId, a, b) {
  return `${galaxyId}:${logisticsLaneKey(a, b)}`;
}

function blockadeSystemId(galaxyId, systemId) {
  return `${galaxyId}:${systemId}`;
}

function routeBlockades(state, galaxyId) {
  const logistics = ensureLogisticsState(state);
  const prefix = `${galaxyId}:`;
  return {
    blockedLanes: new Set(logistics.blockades.lanes
      .filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))),
    blockedSystems: new Set(logistics.blockades.systems
      .filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))),
  };
}

/** Weighted Dijkstra route with stable lexical tie-breaking. */
export function shortestRoute(graph, fromSystemId, toSystemId, options = {}) {
  if (!graph || !fromSystemId || !toSystemId) return null;
  const nodes = nodeMap(graph);
  if (!nodes.has(fromSystemId) || !nodes.has(toSystemId)) return null;
  if (fromSystemId === toSystemId) return [fromSystemId];

  const blockedLanes = options.blockedLanes instanceof Set
    ? options.blockedLanes : new Set(options.blockedLanes ?? []);
  const blockedSystems = options.blockedSystems instanceof Set
    ? options.blockedSystems : new Set(options.blockedSystems ?? []);
  if (blockedSystems.has(toSystemId)) return null;

  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const [a, b] of graph.lanes ?? []) {
    if (!nodes.has(a) || !nodes.has(b) || blockedLanes.has(logisticsLaneKey(a, b))) continue;
    const pa = nodes.get(a);
    const pb = nodes.get(b);
    const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    adjacency.get(a).push({ id: b, distance });
    adjacency.get(b).push({ id: a, distance });
  }
  for (const neighbors of adjacency.values()) neighbors.sort((a, b) => a.id.localeCompare(b.id));

  const bestDistance = new Map([[fromSystemId, 0]]);
  const bestPathKey = new Map([[fromSystemId, fromSystemId]]);
  const previous = new Map();
  const queue = [{ id: fromSystemId, distance: 0, pathKey: fromSystemId }];

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance || a.pathKey.localeCompare(b.pathKey));
    const current = queue.shift();
    if (current.distance > (bestDistance.get(current.id) ?? Infinity) + EPSILON) continue;
    if (current.id === toSystemId) break;
    for (const edge of adjacency.get(current.id) ?? []) {
      if (edge.id !== toSystemId && blockedSystems.has(edge.id)) continue;
      const distance = current.distance + edge.distance;
      const pathKey = `${current.pathKey}>${edge.id}`;
      const knownDistance = bestDistance.get(edge.id) ?? Infinity;
      const knownKey = bestPathKey.get(edge.id) ?? '\uffff';
      if (distance < knownDistance - EPSILON
        || (Math.abs(distance - knownDistance) <= EPSILON && pathKey < knownKey)) {
        bestDistance.set(edge.id, distance);
        bestPathKey.set(edge.id, pathKey);
        previous.set(edge.id, current.id);
        queue.push({ id: edge.id, distance, pathKey });
      }
    }
  }

  if (!previous.has(toSystemId)) return null;
  const path = [toSystemId];
  let cursor = toSystemId;
  while (cursor !== fromSystemId) {
    cursor = previous.get(cursor);
    if (!cursor) return null;
    path.push(cursor);
  }
  return path.reverse();
}

export function routeDistance(graph, path) {
  if (!graph || !Array.isArray(path) || path.length < 2) return 0;
  const nodes = nodeMap(graph);
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const from = nodes.get(path[i]);
    const to = nodes.get(path[i + 1]);
    if (!from || !to) return Infinity;
    total += Math.hypot(from.x - to.x, from.y - to.y);
  }
  return total;
}

export function convoyLegDurationMs(graph, fromId, toId, options = {}) {
  const config = configFrom(options);
  const nodes = nodeMap(graph);
  const from = nodes.get(fromId);
  const to = nodes.get(toId);
  if (!from || !to) return Infinity;
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  return Math.max(config.minLegMs, Math.round((distance / config.convoySpeed) * 1000));
}

export function routeEtaMs(graph, path, options = {}) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let eta = 0;
  for (let i = 0; i < path.length - 1; i++) {
    eta += convoyLegDurationMs(graph, path[i], path[i + 1], options);
  }
  return eta;
}

export function nexusAcceptsPlayerCargo(system) {
  if (system?.star?.kind !== 'trade_nexus') return false;
  if (system.tradeNexus?.acceptsPlayerTrade === false) return false;
  if (system.owner === 'ai' && system.tradeNexus?.allied !== true) return false;
  return true;
}

/** Returns every generated nexus; available indicates whether it currently accepts player cargo. */
export function discoverTradeNexuses(state, galaxyId = state.activeGalaxyId) {
  return Object.values(getSystems(state, galaxyId))
    .filter((system) => system?.star?.kind === 'trade_nexus')
    .map((system) => ({
      galaxyId,
      systemId: system.id,
      name: system.name,
      owner: system.owner,
      available: nexusAcceptsPlayerCargo(system),
    }))
    .sort((a, b) => a.systemId.localeCompare(b.systemId));
}

function bestNexusRoute(state, galaxyId, fromSystemId, options = {}) {
  const graph = getGraph(state, galaxyId);
  const blockades = routeBlockades(state, galaxyId);
  const requested = options.destinationSystemId ?? null;
  const candidates = discoverTradeNexuses(state, galaxyId)
    .filter((nexus) => nexus.available && (!requested || nexus.systemId === requested));
  const routes = [];
  for (const nexus of candidates) {
    const path = shortestRoute(graph, fromSystemId, nexus.systemId, blockades);
    if (!path || path.length < 2) continue;
    routes.push({ nexus, path, distance: routeDistance(graph, path) });
  }
  routes.sort((a, b) => a.distance - b.distance || a.nexus.systemId.localeCompare(b.nexus.systemId));
  return routes[0] ?? null;
}

export function exportDepotId(galaxyId, systemId) {
  return `depot:${galaxyId}:${systemId}`;
}

export function findExportDepot(state, depotIdOrSystemId, galaxyId = state.activeGalaxyId) {
  const logistics = ensureLogisticsState(state);
  return logistics.depots[depotIdOrSystemId]
    ?? logistics.depots[exportDepotId(galaxyId, depotIdOrSystemId)]
    ?? null;
}

/** Registers simulation state after the structure/build layer creates an export_depot. */
export function registerExportDepot(state, galaxyId, systemId, options = {}) {
  const system = getSystems(state, galaxyId)[systemId];
  if (!system) return { ok: false, reason: 'No such system' };
  if (system.star?.kind === 'trade_nexus' && !options.force) {
    return { ok: false, reason: 'Trade Nexus systems cannot host export depots' };
  }
  if (system.owner !== 'player' && !options.allowNonPlayer) {
    return { ok: false, reason: 'System not under player control' };
  }

  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const id = options.id ?? exportDepotId(galaxyId, systemId);
  const existing = logistics.depots[id];
  if (existing) {
    if (options.structureId) {
      existing.structureId = options.structureId;
      existing.source = 'structure';
    }
    existing.operational = options.operational ?? true;
    existing.capacity = options.capacity ?? existing.capacity ?? config.depotCapacity;
    return { ok: true, depot: existing, created: false };
  }

  const depot = {
    id,
    galaxyId,
    systemId,
    structureId: options.structureId ?? null,
    source: options.structureId ? 'structure' : (options.source ?? 'registered'),
    operational: options.operational ?? true,
    capacity: options.capacity ?? config.depotCapacity,
    inventory: normalizeCargo(options.inventory),
    preferredNexusId: options.preferredNexusId ?? null,
    routePaused: false,
    pauseReason: null,
    lastDispatchAt: null,
    createdAt: Number.isFinite(options.createdAt) ? options.createdAt : (state.time ?? 0),
  };
  logistics.depots[id] = depot;
  return { ok: true, depot, created: true };
}

/** Discovers existing export_depot structures without constructing or charging for them. */
export function syncExportDepots(state, galaxyId = state.activeGalaxyId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const seen = new Set();
  const registered = [];
  for (const system of Object.values(getSystems(state, galaxyId))) {
    for (const structure of system.structures ?? []) {
      if (structure.type !== 'export_depot') continue;
      const result = registerExportDepot(state, galaxyId, system.id, {
        ...options,
        structureId: structure.id,
        operational: structure.operational !== false,
        createdAt: structure.builtAtTime,
      });
      if (!result.ok) continue;
      seen.add(result.depot.id);
      registered.push(result.depot);
    }
  }
  for (const depot of Object.values(logistics.depots)) {
    if (depot.galaxyId === galaxyId && depot.source === 'structure' && !seen.has(depot.id)) {
      depot.operational = false;
    }
  }
  return registered;
}

export function setDepotOperational(state, depotId, operational, reason = null) {
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export depot' };
  depot.operational = !!operational;
  if (!depot.operational) depot.pauseReason = reason ?? 'depot_offline';
  else if (!depot.routePaused) depot.pauseReason = null;
  return { ok: true, depot };
}

export function pauseDepotRoute(state, depotId, reason = 'manual') {
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export depot' };
  depot.routePaused = true;
  depot.pauseReason = reason;
  const route = ensureLogisticsState(state).routes.find((entry) => entry.depotId === depot.id);
  if (route) { route.paused = true; route.pauseReason = reason; }
  return { ok: true, depot };
}

export function resumeDepotRoute(state, depotId) {
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export depot' };
  if (!depot.operational) return { ok: false, reason: 'Export depot is offline' };
  depot.routePaused = false;
  depot.pauseReason = null;
  const route = ensureLogisticsState(state).routes.find((entry) => entry.depotId === depot.id);
  if (route) { route.paused = false; route.pauseReason = null; }
  return { ok: true, depot };
}

export function setDepotDestination(state, depotId, nexusSystemId = null) {
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export depot' };
  if (nexusSystemId !== null) {
    const system = getSystems(state, depot.galaxyId)[nexusSystemId];
    if (!nexusAcceptsPlayerCargo(system)) return { ok: false, reason: 'Destination is not an available Trade Nexus' };
  }
  depot.preferredNexusId = nexusSystemId;
  const logistics = ensureLogisticsState(state);
  const existing = logistics.routes.find((entry) => entry.depotId === depot.id);
  const route = existing ?? {
    id: `route:${depot.id}`,
    depotId: depot.id,
    galaxyId: depot.galaxyId,
    fromSystemId: depot.systemId,
    createdAt: state.time ?? 0,
  };
  route.toSystemId = nexusSystemId;
  route.paused = depot.routePaused;
  route.pauseReason = depot.pauseReason;
  if (!existing) logistics.routes.push(route);
  return { ok: true, depot };
}

function outpostStockId(galaxyId, systemId, outpostId) {
  return `${galaxyId}:${systemId}:${outpostId}`;
}

function ensureOutpostStock(logistics, galaxyId, system, outpost, config) {
  const id = outpostStockId(galaxyId, system.id, outpost.id);
  if (!logistics.outpostStock[id]) {
    logistics.outpostStock[id] = {
      id,
      galaxyId,
      systemId: system.id,
      outpostId: outpost.id,
      bodyId: outpost.bodyId,
      capacity: config.outpostStockCapacity,
      inventory: emptyCargo(),
      producedTotal: emptyCargo(),
      lastProducedAt: null,
      lastLocalDispatchAt: null,
    };
  }
  return logistics.outpostStock[id];
}

/** Pure per-outpost production for deltaMs. */
export function cargoProductionForOutpost(system, outpost, deltaMs = TICK_MS, options = {}) {
  const config = configFrom(options);
  const planet = system?.bodies?.find((body) => body.id === outpost?.bodyId);
  if (!planet || outpost?.type !== 'outpost') return emptyCargo();
  const rates = config.productionRates[planet.type] ?? config.productionRates.habitable;
  const moonMultiplier = 1 + config.moonProductionBonus * (planet.moons?.length ?? 0);
  const configuredMultiplier = Number(outpost.productionMultiplier);
  const structureMultiplier = Number.isFinite(configuredMultiplier) ? Math.max(0, configuredMultiplier) : 1;
  return scaleCargo(rates, (Math.max(0, deltaMs) / 1000) * moonMultiplier * structureMultiplier);
}

export function systemCargoProduction(system, deltaMs = TICK_MS, options = {}) {
  let total = emptyCargo();
  for (const outpost of system?.structures ?? []) {
    if (outpost.type === 'outpost') {
      total = addCargo(total, cargoProductionForOutpost(system, outpost, deltaMs, options));
    }
  }
  return total;
}

/** Produces into outpost buffers. Cargo only reaches a depot via local transports. */
export function tickOutpostProduction(state, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const deltaMs = options.tickMs ?? TICK_MS;
  let produced = emptyCargo();
  for (const galaxyId of galaxyIdsForState(state, options.galaxyIds ?? options.galaxyId)) {
    for (const system of Object.values(getSystems(state, galaxyId))) {
      if (system.owner !== 'player' || system.star?.kind === 'trade_nexus') continue;
      for (const outpost of system.structures ?? []) {
        if (outpost.type !== 'outpost') continue;
        const stock = ensureOutpostStock(logistics, galaxyId, system, outpost, config);
        const delta = cargoProductionForOutpost(system, outpost, deltaMs, config);
        const accepted = cargoManifestFromInventory(delta, cargoRoom(stock.inventory, stock.capacity));
        mutateCargo(stock.inventory, addCargo(stock.inventory, accepted));
        mutateCargo(stock.producedTotal, addCargo(stock.producedTotal, accepted));
        stock.lastProducedAt = state.time ?? 0;
        produced = addCargo(produced, accepted);
      }
    }
  }
  mutateCargo(logistics.stats.producedCargo, addCargo(logistics.stats.producedCargo, produced));
  return produced;
}

function recordEvent(logistics, event, config) {
  logistics.events.push(event);
  if (logistics.events.length > config.eventLimit) {
    logistics.events.splice(0, logistics.events.length - config.eventLimit);
  }
  return event;
}

function localTransportActive(transport) {
  return transport.status === 'inbound';
}

export function localTransportStatus(transport, time) {
  if (!transport) return null;
  const duration = Math.max(1, transport.arriveAt - transport.departAt);
  const sampleTime = transport.status === 'inbound' ? time : (transport.completedAt ?? time);
  return {
    id: transport.id,
    galaxyId: transport.galaxyId,
    systemId: transport.systemId,
    fromBodyId: transport.fromBodyId,
    depotId: transport.depotId,
    status: transport.status,
    loaded: transport.status === 'inbound',
    progress: Math.max(0, Math.min(1, (sampleTime - transport.departAt) / duration)),
    manifest: normalizeCargo(transport.manifest),
  };
}

function pruneTerminalLocalTransports(logistics, limit) {
  const active = logistics.localTransports.filter(localTransportActive);
  const terminal = logistics.localTransports
    .filter((transport) => !localTransportActive(transport))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, limit);
  logistics.localTransports = [...active, ...terminal]
    .sort((a, b) => (a.departAt ?? 0) - (b.departAt ?? 0) || a.id.localeCompare(b.id));
}

/** Advances outpost-to-depot transports, then dispatches any ready outpost stock. */
export function tickLocalTransports(state, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const events = [];
  const now = state.time ?? 0;

  for (const transport of logistics.localTransports) {
    if (!localTransportActive(transport) || now < transport.arriveAt) continue;
    const depot = logistics.depots[transport.depotId];
    const stock = logistics.outpostStock[transport.stockId];
    if (!depot?.operational) {
      if (stock) mutateCargo(stock.inventory, addCargo(stock.inventory, transport.manifest));
      transport.status = 'failed';
      transport.completedAt = now;
      const event = { type: 'local_transport_failed', at: now, transportId: transport.id, depotId: transport.depotId };
      events.push(recordEvent(logistics, event, config));
      continue;
    }
    const delivered = cargoManifestFromInventory(transport.manifest, cargoRoom(depot.inventory, depot.capacity));
    const overflow = subtractCargo(transport.manifest, delivered);
    mutateCargo(depot.inventory, addCargo(depot.inventory, delivered));
    if (stock) mutateCargo(stock.inventory, addCargo(stock.inventory, overflow));
    transport.status = 'delivered';
    transport.completedAt = now;
    const event = {
      type: 'cargo_arrived_at_depot', at: now, transportId: transport.id,
      depotId: depot.id, manifest: delivered, overflow,
    };
    events.push(recordEvent(logistics, event, config));
  }

  const stocks = Object.values(logistics.outpostStock)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const stock of stocks) {
    const depot = Object.values(logistics.depots)
      .filter((candidate) => candidate.galaxyId === stock.galaxyId && candidate.systemId === stock.systemId)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!depot?.operational) continue;
    if (cargoTotal(stock.inventory) + EPSILON < config.localDispatchCargo) continue;
    if (stock.lastLocalDispatchAt !== null
      && now - stock.lastLocalDispatchAt < config.localDispatchIntervalMs) continue;
    if (logistics.localTransports.some(
      (transport) => transport.stockId === stock.id && localTransportActive(transport),
    )) continue;

    const manifest = cargoManifestFromInventory(stock.inventory, config.localTransportCapacity);
    if (cargoTotal(manifest) <= EPSILON) continue;
    mutateCargo(stock.inventory, subtractCargo(stock.inventory, manifest));
    stock.lastLocalDispatchAt = now;
    const transport = {
      id: `local-${logistics.nextLocalTransportId++}`,
      galaxyId: stock.galaxyId,
      systemId: stock.systemId,
      stockId: stock.id,
      outpostId: stock.outpostId,
      fromBodyId: stock.bodyId,
      depotId: depot.id,
      manifest,
      status: 'inbound',
      departAt: now,
      arriveAt: now + config.localTransitMs,
      completedAt: null,
    };
    logistics.localTransports.push(transport);
    const event = {
      type: 'local_transport_dispatched', at: now, transportId: transport.id,
      depotId: depot.id, outpostId: stock.outpostId, manifest,
    };
    events.push(recordEvent(logistics, event, config));
  }
  pruneTerminalLocalTransports(logistics, config.terminalLocalTransportLimit);
  return events;
}

function findConvoy(state, convoyId) {
  return ensureLogisticsState(state).convoys.find((convoy) => convoy.id === convoyId) ?? null;
}

export function dispatchDepot(state, depotId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export depot' };
  if (!depot.operational) return { ok: false, reason: 'Export depot is offline' };
  if (depot.routePaused) return { ok: false, reason: `Route paused: ${depot.pauseReason ?? 'manual'}` };
  if (cargoTotal(depot.inventory) + EPSILON < config.minDispatchCargo) {
    return { ok: false, reason: `Need ${config.minDispatchCargo} cargo to dispatch` };
  }

  const destinationSystemId = options.destinationSystemId ?? depot.preferredNexusId;
  const route = bestNexusRoute(state, depot.galaxyId, depot.systemId, { destinationSystemId });
  if (!route) {
    const hasNexus = discoverTradeNexuses(state, depot.galaxyId).some((nexus) => nexus.available);
    return { ok: false, reason: hasNexus ? 'No unblocked route to a Trade Nexus' : 'No available Trade Nexus' };
  }
  const routeRecord = logistics.routes.find((entry) => entry.depotId === depot.id) ?? {
    id: `route:${depot.id}`,
    depotId: depot.id,
    galaxyId: depot.galaxyId,
    fromSystemId: depot.systemId,
    createdAt: state.time ?? 0,
  };
  routeRecord.toSystemId = route.nexus.systemId;
  routeRecord.path = [...route.path];
  routeRecord.paused = false;
  routeRecord.pauseReason = null;
  routeRecord.updatedAt = state.time ?? 0;
  if (!logistics.routes.includes(routeRecord)) logistics.routes.push(routeRecord);

  const manifest = cargoManifestFromInventory(depot.inventory, config.convoyCapacity);
  mutateCargo(depot.inventory, subtractCargo(depot.inventory, manifest));
  const now = state.time ?? 0;
  const graph = getGraph(state, depot.galaxyId);
  const convoy = {
    id: `convoy-${logistics.nextConvoyId++}`,
    galaxyId: depot.galaxyId,
    depotId: depot.id,
    fromSystemId: depot.systemId,
    destinationSystemId: route.nexus.systemId,
    path: route.path,
    legIndex: 0,
    currentNodeId: depot.systemId,
    status: 'jumping',
    systemId: depot.systemId,
    dispatchedAt: now,
    jumpStartedAt: now,
    jumpEndsAt: now + config.jumpDurationMs,
    legStartTime: now + config.jumpDurationMs,
    legDurationMs: convoyLegDurationMs(graph, route.path[0], route.path[1], config),
    pausedAt: null,
    resumeStatus: null,
    pauseReason: null,
    manifest,
    deliveryValue: cargoCreditValue(manifest, config.cargoValues),
    escortStrength: Math.max(0, Number(options.escortStrength) || 0),
    armor: Math.max(0, Number(options.armor) || config.defaultConvoyArmor),
    deliveredAt: null,
    interceptedAt: null,
  };
  logistics.convoys.push(convoy);
  depot.lastDispatchAt = now;
  logistics.stats.convoysDispatched += 1;
  const event = {
    type: 'convoy_dispatched', at: now, convoyId: convoy.id, depotId: depot.id,
    destinationSystemId: convoy.destinationSystemId, path: [...convoy.path], manifest,
  };
  recordEvent(logistics, event, config);
  return { ok: true, convoy, event };
}

export function tickDepotDispatch(state, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const events = [];
  const now = state.time ?? 0;
  const depots = Object.values(logistics.depots).sort((a, b) => a.id.localeCompare(b.id));
  for (const depot of depots) {
    if (!depot.operational || depot.routePaused) continue;
    if (depot.lastDispatchAt !== null
      && now - depot.lastDispatchAt < config.convoyDispatchIntervalMs) continue;
    const result = dispatchDepot(state, depot.id, config);
    if (result.ok) events.push(result.event);
  }
  return events;
}

export function setLaneBlockade(state, galaxyId, fromSystemId, toSystemId, blocked = true) {
  const logistics = ensureLogisticsState(state);
  const key = blockadeLaneId(galaxyId, fromSystemId, toSystemId);
  const lanes = new Set(logistics.blockades.lanes);
  if (blocked) lanes.add(key);
  else lanes.delete(key);
  logistics.blockades.lanes = [...lanes].sort();
  return { ok: true, key, blocked: !!blocked };
}

export function setSystemBlockade(state, galaxyId, systemId, blocked = true) {
  const logistics = ensureLogisticsState(state);
  const key = blockadeSystemId(galaxyId, systemId);
  const systems = new Set(logistics.blockades.systems);
  if (blocked) systems.add(key);
  else systems.delete(key);
  logistics.blockades.systems = [...systems].sort();
  return { ok: true, key, blocked: !!blocked };
}

export function isLaneBlockaded(state, galaxyId, fromSystemId, toSystemId) {
  return ensureLogisticsState(state).blockades.lanes
    .includes(blockadeLaneId(galaxyId, fromSystemId, toSystemId));
}

export function isSystemBlockaded(state, galaxyId, systemId) {
  return ensureLogisticsState(state).blockades.systems
    .includes(blockadeSystemId(galaxyId, systemId));
}

function pauseConvoyInternal(convoy, now, reason) {
  if (convoy.status === 'paused') {
    convoy.pauseReason = reason;
    return;
  }
  convoy.resumeStatus = convoy.status;
  convoy.status = 'paused';
  convoy.pausedAt = now;
  convoy.pauseReason = reason;
}

export function pauseConvoy(state, convoyId, reason = 'manual', options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const convoy = findConvoy(state, convoyId);
  if (!convoy) return { ok: false, reason: 'No such convoy' };
  if (['delivered', 'intercepted'].includes(convoy.status)) {
    return { ok: false, reason: `Convoy already ${convoy.status}` };
  }
  pauseConvoyInternal(convoy, state.time ?? 0, reason);
  const event = { type: 'convoy_paused', at: state.time ?? 0, convoyId, reason };
  recordEvent(logistics, event, config);
  return { ok: true, convoy, event };
}

function convoyAtRouteNode(convoy, now) {
  if (convoy.status === 'jumping' || (convoy.status === 'paused' && convoy.resumeStatus === 'jumping')) {
    return { ok: true, systemId: convoy.path[0] };
  }
  const sampleTime = convoy.status === 'paused' ? convoy.pausedAt : now;
  const toId = convoy.path[convoy.legIndex + 1];
  if (toId && convoy.currentNodeId === toId) {
    return { ok: true, systemId: toId };
  }
  if (sampleTime <= convoy.legStartTime + EPSILON) {
    return { ok: true, systemId: convoy.path[convoy.legIndex] };
  }
  if (sampleTime >= convoy.legStartTime + convoy.legDurationMs - EPSILON) {
    return { ok: false, reason: 'Advance convoy before rerouting' };
  }
  return { ok: false, reason: 'Convoy is between stars' };
}

export function rerouteConvoy(state, convoyId, destinationSystemId = null, options = {}) {
  const convoy = findConvoy(state, convoyId);
  if (!convoy) return { ok: false, reason: 'No such convoy' };
  if (['delivered', 'intercepted'].includes(convoy.status)) {
    return { ok: false, reason: `Convoy already ${convoy.status}` };
  }
  const now = state.time ?? 0;
  const origin = convoyAtRouteNode(convoy, now);
  if (!origin.ok) return origin;
  const route = bestNexusRoute(state, convoy.galaxyId, origin.systemId, { destinationSystemId });
  if (!route) return { ok: false, reason: 'No unblocked route to an available Trade Nexus' };

  const config = configFrom(options);
  const graph = getGraph(state, convoy.galaxyId);
  const wasJumping = convoy.status === 'jumping'
    || (convoy.status === 'paused' && convoy.resumeStatus === 'jumping');
  convoy.path = route.path;
  convoy.destinationSystemId = route.nexus.systemId;
  convoy.legIndex = 0;
  convoy.currentNodeId = origin.systemId;
  convoy.legStartTime = wasJumping ? Math.max(now, convoy.jumpEndsAt) : now;
  convoy.legDurationMs = convoyLegDurationMs(graph, route.path[0], route.path[1], config);
  convoy.status = wasJumping ? 'jumping' : 'in_transit';
  convoy.systemId = wasJumping ? origin.systemId : null;
  convoy.resumeStatus = null;
  convoy.pausedAt = null;
  convoy.pauseReason = null;
  return { ok: true, convoy, path: [...route.path] };
}

export function resumeConvoy(state, convoyId, options = {}) {
  const convoy = findConvoy(state, convoyId);
  if (!convoy) return { ok: false, reason: 'No such convoy' };
  if (convoy.status !== 'paused') return { ok: false, reason: 'Convoy is not paused' };
  if (convoy.pauseReason === 'blockade' || convoy.pauseReason === 'no_destination') {
    return rerouteConvoy(state, convoyId, null, options);
  }
  const now = state.time ?? 0;
  const pauseDuration = Math.max(0, now - (convoy.pausedAt ?? now));
  if (convoy.resumeStatus === 'jumping') {
    convoy.jumpEndsAt += pauseDuration;
    convoy.legStartTime += pauseDuration;
  } else {
    convoy.legStartTime += pauseDuration;
  }
  convoy.status = convoy.resumeStatus ?? 'in_transit';
  convoy.resumeStatus = null;
  convoy.pausedAt = null;
  convoy.pauseReason = null;
  return { ok: true, convoy };
}

export function setConvoyEscort(state, convoyId, escortStrength) {
  const convoy = findConvoy(state, convoyId);
  if (!convoy) return { ok: false, reason: 'No such convoy' };
  convoy.escortStrength = Math.max(0, Number(escortStrength) || 0);
  return { ok: true, convoy };
}

/** Deterministic interception resolution: escort + armor versus supplied threat. */
export function interceptConvoy(state, convoyId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const convoy = findConvoy(state, convoyId);
  if (!convoy) return { ok: false, reason: 'No such convoy' };
  if (['delivered', 'intercepted'].includes(convoy.status)) {
    return { ok: false, reason: `Convoy already ${convoy.status}` };
  }
  const now = state.time ?? 0;
  const threat = options.threatStrength;
  const defense = (convoy.escortStrength ?? 0) + (convoy.armor ?? 0);
  if (Number.isFinite(threat) && defense >= threat) {
    logistics.stats.interceptionsRepelled += 1;
    const event = { type: 'convoy_interception_repelled', at: now, convoyId, threatStrength: threat, defense };
    recordEvent(logistics, event, config);
    return { ok: true, destroyed: false, repelled: true, convoy, event };
  }

  const lossFraction = options.destroyed === true
    ? 1
    : Math.max(0, Math.min(1, options.cargoLossFraction ?? 1));
  const lostCargo = scaleCargo(convoy.manifest, lossFraction);
  mutateCargo(convoy.manifest, subtractCargo(convoy.manifest, lostCargo));
  convoy.deliveryValue = cargoCreditValue(convoy.manifest, config.cargoValues);
  mutateCargo(logistics.stats.lostCargo, addCargo(logistics.stats.lostCargo, lostCargo));
  const destroyed = options.destroyed ?? (cargoTotal(convoy.manifest) <= EPSILON);
  if (destroyed) {
    convoy.status = 'intercepted';
    convoy.systemId = null;
    convoy.interceptedAt = now;
    convoy.pauseReason = 'interception';
    logistics.stats.convoysLost += 1;
  } else {
    pauseConvoyInternal(convoy, now, 'interception');
  }
  if (options.pauseRoute !== false) pauseDepotRoute(state, convoy.depotId, 'interception');
  const event = {
    type: 'convoy_intercepted', at: now, convoyId, destroyed,
    lostCargo, remainingCargo: normalizeCargo(convoy.manifest),
  };
  recordEvent(logistics, event, config);
  return { ok: true, destroyed, repelled: false, lostCargo, convoy, event };
}

function nexusStillAvailable(state, convoy) {
  return nexusAcceptsPlayerCargo(getSystems(state, convoy.galaxyId)[convoy.destinationSystemId]);
}

function deliverConvoy(state, convoy, config) {
  const logistics = ensureLogisticsState(state);
  const now = state.time ?? 0;
  const credits = cargoCreditValue(convoy.manifest, config.cargoValues);
  state.credits = (Number(state.credits) || 0) + credits;
  convoy.status = 'delivered';
  convoy.systemId = convoy.destinationSystemId;
  convoy.currentNodeId = convoy.destinationSystemId;
  convoy.deliveredAt = now;
  convoy.deliveryValue = credits;
  logistics.stats.convoysDelivered += 1;
  logistics.stats.deliveredCredits = roundCargo(logistics.stats.deliveredCredits + credits);
  logistics.stats.lastDeliveryAt = now;
  mutateCargo(logistics.stats.deliveredCargo, addCargo(logistics.stats.deliveredCargo, convoy.manifest));
  logistics.stats.recentDeliveries.push({ at: now, convoyId: convoy.id, credits, cargo: normalizeCargo(convoy.manifest) });
  const cutoff = now - config.recentDeliveryWindowMs * 2;
  logistics.stats.recentDeliveries = logistics.stats.recentDeliveries.filter((delivery) => delivery.at >= cutoff);
  return recordEvent(logistics, {
    type: 'convoy_delivered', at: now, convoyId: convoy.id,
    destinationSystemId: convoy.destinationSystemId, manifest: normalizeCargo(convoy.manifest), credits,
  }, config);
}

function tryRerouteOrPause(state, convoy, reason, config) {
  const reroute = rerouteConvoy(state, convoy.id, null, config);
  if (reroute.ok) return true;
  pauseConvoyInternal(convoy, state.time ?? 0, reason);
  return false;
}

function tickOneConvoy(state, convoy, config, events) {
  const now = state.time ?? 0;
  if (convoy.status === 'paused') {
    if (convoy.pauseReason === 'blockade' || convoy.pauseReason === 'no_destination') {
      const location = convoyAtRouteNode(convoy, now);
      const system = location.ok ? getSystems(state, convoy.galaxyId)[location.systemId] : null;
      if (location.ok && nexusAcceptsPlayerCargo(system)) {
        convoy.destinationSystemId = location.systemId;
        events.push(deliverConvoy(state, convoy, config));
      } else {
        rerouteConvoy(state, convoy.id, null, config);
      }
    }
    return;
  }
  if (['delivered', 'intercepted'].includes(convoy.status)) return;

  if (convoy.status === 'jumping') {
    if (!nexusStillAvailable(state, convoy)
      && !tryRerouteOrPause(state, convoy, 'no_destination', config)) return;
    if (now < convoy.jumpEndsAt) return;
    convoy.status = 'in_transit';
    convoy.systemId = null;
  }

  const graph = getGraph(state, convoy.galaxyId);
  while (convoy.status === 'in_transit') {
    const fromId = convoy.path[convoy.legIndex];
    const toId = convoy.path[convoy.legIndex + 1];
    if (!fromId || !toId) {
      if (nexusStillAvailable(state, convoy)) events.push(deliverConvoy(state, convoy, config));
      else tryRerouteOrPause(state, convoy, 'no_destination', config);
      return;
    }

    const atLegStart = now <= convoy.legStartTime + EPSILON;
    if (atLegStart && !nexusStillAvailable(state, convoy)) {
      if (!tryRerouteOrPause(state, convoy, 'no_destination', config)) return;
      continue;
    }
    if (atLegStart && (isLaneBlockaded(state, convoy.galaxyId, fromId, toId)
      || isSystemBlockaded(state, convoy.galaxyId, toId))) {
      if (!tryRerouteOrPause(state, convoy, 'blockade', config)) return;
      continue;
    }

    const legEnd = convoy.legStartTime + convoy.legDurationMs;
    if (now < legEnd) return;
    convoy.currentNodeId = toId;
    if (convoy.legIndex + 2 >= convoy.path.length) {
      if (!nexusStillAvailable(state, convoy)) {
        if (!tryRerouteOrPause(state, convoy, 'no_destination', config)) return;
        continue;
      }
      events.push(deliverConvoy(state, convoy, config));
      return;
    }
    convoy.legIndex += 1;
    convoy.legStartTime = legEnd;
    convoy.legDurationMs = convoyLegDurationMs(
      graph,
      convoy.path[convoy.legIndex],
      convoy.path[convoy.legIndex + 1],
      config,
    );
  }
}

function pruneTerminalConvoys(logistics, limit) {
  const active = logistics.convoys.filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status));
  const terminal = logistics.convoys
    .filter((convoy) => ['delivered', 'intercepted'].includes(convoy.status))
    .sort((a, b) => (b.deliveredAt ?? b.interceptedAt ?? 0) - (a.deliveredAt ?? a.interceptedAt ?? 0))
    .slice(0, limit);
  logistics.convoys = [...active, ...terminal]
    .sort((a, b) => (a.dispatchedAt ?? 0) - (b.dispatchedAt ?? 0) || a.id.localeCompare(b.id));
}

export function tickConvoys(state, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const events = [];
  for (const convoy of logistics.convoys) tickOneConvoy(state, convoy, config, events);
  pruneTerminalConvoys(logistics, config.terminalConvoyLimit);
  return events;
}

/** Main 20 Hz integration entrypoint. state.time is advanced by the caller. */
export function tickLogistics(state, options = {}) {
  if (state.paused) return [];
  const logistics = ensureLogisticsState(state);
  const now = state.time ?? 0;
  if (logistics.lastTickAt === now) return [];
  const galaxyIds = galaxyIdsForState(state, options.galaxyIds ?? options.galaxyId);
  if (options.syncDepots !== false) {
    for (const galaxyId of galaxyIds) syncExportDepots(state, galaxyId, options);
  }
  tickOutpostProduction(state, { ...options, galaxyIds });
  const events = [
    ...tickLocalTransports(state, options),
    ...tickDepotDispatch(state, options),
    ...tickConvoys(state, options),
  ];
  logistics.lastTickAt = now;
  return events;
}

export function convoyEtaMs(state, convoy, options = {}) {
  if (!convoy || ['delivered', 'intercepted'].includes(convoy.status)) return 0;
  if (convoy.status === 'paused') return null;
  const graph = getGraph(state, convoy.galaxyId);
  const now = state.time ?? 0;
  let eta = convoy.status === 'jumping' ? Math.max(0, convoy.jumpEndsAt - now) : 0;
  const sampleTime = convoy.status === 'jumping' ? convoy.legStartTime : now;
  eta += Math.max(0, convoy.legStartTime + convoy.legDurationMs - sampleTime);
  for (let i = convoy.legIndex + 1; i < convoy.path.length - 1; i++) {
    eta += convoyLegDurationMs(graph, convoy.path[i], convoy.path[i + 1], options);
  }
  return Math.round(eta);
}

/** Pure render/status projection for the galaxy view. */
export function convoyTransitStatus(state, convoy, options = {}) {
  if (!convoy) return null;
  const graph = getGraph(state, convoy.galaxyId);
  const nodes = nodeMap(graph);
  if (convoy.status === 'jumping' || (convoy.status === 'paused' && convoy.resumeStatus === 'jumping')) {
    const now = convoy.status === 'paused' ? convoy.pausedAt : (state.time ?? 0);
    const origin = nodes.get(convoy.path[0]);
    const duration = Math.max(1, convoy.jumpEndsAt - convoy.jumpStartedAt);
    return {
      convoyId: convoy.id, phase: convoy.status === 'paused' ? 'paused' : 'jumping',
      x: origin?.x ?? 0, y: origin?.y ?? 0,
      progress: Math.max(0, Math.min(1, (now - convoy.jumpStartedAt) / duration)),
      fromId: convoy.path[0], toId: convoy.path[1],
      destinationSystemId: convoy.destinationSystemId,
      etaMs: convoyEtaMs(state, convoy, options),
    };
  }
  if (['delivered', 'intercepted'].includes(convoy.status)) {
    const node = nodes.get(convoy.systemId ?? convoy.currentNodeId);
    return {
      convoyId: convoy.id, phase: convoy.status, x: node?.x ?? 0, y: node?.y ?? 0,
      progress: 1, destinationSystemId: convoy.destinationSystemId, etaMs: 0,
    };
  }
  const sampleTime = convoy.status === 'paused' ? convoy.pausedAt : (state.time ?? 0);
  const fromId = convoy.path[convoy.legIndex];
  const toId = convoy.path[convoy.legIndex + 1];
  const from = nodes.get(fromId);
  const to = nodes.get(toId);
  if (!from || !to) return null;
  const progress = Math.max(0, Math.min(1,
    (sampleTime - convoy.legStartTime) / Math.max(1, convoy.legDurationMs)));
  const control = laneControlPoint(from, to, laneBulge(graph, fromId, toId));
  const position = laneBezierPoint(from, control, to, progress);
  return {
    convoyId: convoy.id,
    phase: convoy.status,
    fromId,
    toId,
    destinationSystemId: convoy.destinationSystemId,
    x: position.x,
    y: position.y,
    angle: laneBezierAngle(from, control, to, progress),
    progress,
    etaMs: convoyEtaMs(state, convoy, options),
  };
}

export function activeConvoys(state, galaxyId = state.activeGalaxyId) {
  return ensureLogisticsState(state).convoys.filter(
    (convoy) => convoy.galaxyId === galaxyId && !['delivered', 'intercepted'].includes(convoy.status),
  );
}

export function localTransportSnapshots(state, galaxyId = state.activeGalaxyId) {
  return ensureLogisticsState(state).localTransports
    .filter((transport) => transport.galaxyId === galaxyId && localTransportActive(transport))
    .map((transport) => localTransportStatus(transport, state.time ?? 0));
}

export function depotSummary(state, depotId, options = {}) {
  const depot = findExportDepot(state, depotId);
  if (!depot) return null;
  const config = configFrom(options);
  const convoys = ensureLogisticsState(state).convoys.filter((convoy) => convoy.depotId === depot.id);
  return {
    id: depot.id,
    galaxyId: depot.galaxyId,
    systemId: depot.systemId,
    operational: depot.operational,
    routePaused: depot.routePaused,
    pauseReason: depot.pauseReason,
    preferredNexusId: depot.preferredNexusId,
    inventory: normalizeCargo(depot.inventory),
    storedCargo: cargoTotal(depot.inventory),
    capacity: depot.capacity,
    inventoryCredits: cargoCreditValue(depot.inventory, config.cargoValues),
    activeConvoys: convoys.filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status)).length,
    lastDispatchAt: depot.lastDispatchAt,
  };
}

export function logisticsSummary(state, galaxyId = state.activeGalaxyId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const depots = Object.values(logistics.depots).filter((depot) => depot.galaxyId === galaxyId);
  const convoys = logistics.convoys.filter((convoy) => convoy.galaxyId === galaxyId);
  const outpostStock = Object.values(logistics.outpostStock).filter((stock) => stock.galaxyId === galaxyId);
  const cargoAtOutposts = outpostStock.reduce((total, stock) => addCargo(total, stock.inventory), emptyCargo());
  const cargoAtDepots = depots.reduce((total, depot) => addCargo(total, depot.inventory), emptyCargo());
  const cargoInTransit = convoys
    .filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status))
    .reduce((total, convoy) => addCargo(total, convoy.manifest), emptyCargo());
  const cutoff = (state.time ?? 0) - config.recentDeliveryWindowMs;
  const recent = logistics.stats.recentDeliveries.filter((delivery) => delivery.at >= cutoff);
  const throughputCreditsPerMinute = roundCargo(recent.reduce((sum, delivery) => sum + delivery.credits, 0)
    * (60000 / config.recentDeliveryWindowMs));
  const statuses = {};
  for (const convoy of convoys) statuses[convoy.status] = (statuses[convoy.status] ?? 0) + 1;
  return {
    galaxyId,
    nexusCount: discoverTradeNexuses(state, galaxyId).length,
    availableNexusCount: discoverTradeNexuses(state, galaxyId).filter((nexus) => nexus.available).length,
    depotCount: depots.length,
    operationalDepotCount: depots.filter((depot) => depot.operational).length,
    pausedRouteCount: depots.filter((depot) => depot.routePaused).length,
    convoyCount: convoys.length,
    activeConvoyCount: convoys.filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status)).length,
    convoyStatuses: statuses,
    cargoAtOutposts,
    cargoAtDepots,
    cargoInTransit,
    storedCargo: roundCargo(cargoTotal(cargoAtOutposts) + cargoTotal(cargoAtDepots)),
    throughputCreditsPerMinute,
    deliveredCredits: logistics.stats.deliveredCredits,
    lostCargo: normalizeCargo(logistics.stats.lostCargo),
    laneBlockadeCount: logistics.blockades.lanes.filter((key) => key.startsWith(`${galaxyId}:`)).length,
    systemBlockadeCount: logistics.blockades.systems.filter((key) => key.startsWith(`${galaxyId}:`)).length,
  };
}
