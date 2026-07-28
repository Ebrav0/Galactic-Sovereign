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
  LOGISTICS_CREDIT_STOCK_CAPACITY,
  LOGISTICS_LOCAL_CREDIT_CAPACITY,
  LOGISTICS_EXPORT_CENTER_CAPACITY,
  LOGISTICS_EXPORT_CENTER_BAYS,
  LOGISTICS_EXPORT_CENTER_UPGRADE_COST,
  LOGISTICS_FREE_FREIGHTERS,
  LOGISTICS_FREIGHTER_COST,
  LOGISTICS_FREIGHTER_BUILD_MS,
  LOGISTICS_CONVOY_PARTIAL_DISPATCH_MS,
  LOGISTICS_CONVOY_FILL_RATIO,
  LOGISTICS_CONVOY_PARTIAL_FILL_RATIO,
  LOGISTICS_ESCORT_RALLY_MS,
  LOGISTICS_ONSITE_PROCESSING_SHARE,
  LOGISTICS_CONVOY_DOCTRINES,
  HULL_STATS,
} from './constants.js';
import {
  laneBezierAngle,
  laneBezierPoint,
  laneBulge,
  laneControlPoint,
} from './galaxy.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import {
  outpostCargoProductionMultiplier,
  outpostStockCapacity,
  isOperationalStructure,
  structureActiveConvoyRouteBonus,
  structureCargoProductionMultiplier,
  structureDepotCapacityBonus,
  structureDispatchIntervalMultiplier,
  structureNexusDeliveryMultiplier,
} from './body-structures.js';
import {
  AGREEMENT_ALLIANCE,
  AGREEMENT_TRADE,
  canRouteThroughSystem,
  hasAgreement,
  recordDiplomaticEvent,
  settleDiplomaticTradeDelivery,
} from './diplomacy.js';
import { techEffects } from './tech-web.js';
import { factionTechContext } from './ai-tech.js';

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

function ownerContext(state, ownerId = 'player') {
  if (!ownerId || ownerId === 'player') return { techState: state, effectOpts: {} };
  const faction = state.factions?.list?.find((candidate) => candidate.id === ownerId);
  return {
    techState: faction ? factionTechContext(faction) : null,
    effectOpts: { owner: 'ai', factionId: ownerId },
  };
}

function systemOwnerContext(state, system) {
  return ownerContext(state, system?.owner === 'player' ? 'player' : system?.factionId ?? 'ai-0');
}

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
  outpostCreditCapacity: LOGISTICS_CREDIT_STOCK_CAPACITY,
  localCreditCapacity: LOGISTICS_LOCAL_CREDIT_CAPACITY,
  exportCenterCapacity: LOGISTICS_EXPORT_CENTER_CAPACITY,
  exportCenterBays: LOGISTICS_EXPORT_CENTER_BAYS,
  exportCenterUpgradeCost: LOGISTICS_EXPORT_CENTER_UPGRADE_COST,
  freeFreighters: LOGISTICS_FREE_FREIGHTERS,
  freighterCost: LOGISTICS_FREIGHTER_COST,
  freighterBuildMs: LOGISTICS_FREIGHTER_BUILD_MS,
  convoyPartialDispatchMs: LOGISTICS_CONVOY_PARTIAL_DISPATCH_MS,
  convoyFillRatio: LOGISTICS_CONVOY_FILL_RATIO,
  convoyPartialFillRatio: LOGISTICS_CONVOY_PARTIAL_FILL_RATIO,
  escortRallyMs: LOGISTICS_ESCORT_RALLY_MS,
  onsiteProcessingShare: LOGISTICS_ONSITE_PROCESSING_SHARE,
  convoyDoctrines: LOGISTICS_CONVOY_DOCTRINES,
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

const roundCredits = roundCargo;

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

function creditRoom(storedCredits, capacity) {
  return Math.max(0, roundCredits(capacity) - roundCredits(storedCredits));
}

function legacyCredits(record, cargoKey = 'inventory') {
  if (Number.isFinite(record?.storedCredits)) return roundCredits(record.storedCredits);
  if (Number.isFinite(record?.creditLoad)) return roundCredits(record.creditLoad);
  return cargoCreditValue(record?.[cargoKey]);
}

function ownerWallet(state, ownerId = 'player') {
  if (!ownerId || ownerId === 'player') {
    return {
      get: () => Math.max(0, Number(state.credits) || 0),
      set: (value) => { state.credits = Math.max(0, Number(value) || 0); },
    };
  }
  const faction = state.factions?.list?.find((candidate) => candidate.id === ownerId);
  if (!faction) return null;
  return {
    get: () => Math.max(0, Number(faction.credits) || 0),
    set: (value) => { faction.credits = Math.max(0, Number(value) || 0); },
  };
}

export function recoverStolenCredits(state, ownerId = 'player', amount = 0, source = 'pirate_fleet') {
  const credits = roundCredits(Math.max(0, Number(amount) || 0));
  if (credits <= 0) return { ok: true, credits: 0 };
  const wallet = ownerWallet(state, ownerId);
  if (!wallet) return { ok: false, reason: 'No wallet for convoy owner' };
  wallet.set(wallet.get() + credits);
  const logistics = ensureLogisticsState(state);
  logistics.stats.recoveredCredits = roundCredits(logistics.stats.recoveredCredits + credits);
  const event = {
    type: 'convoy_credits_recovered',
    at: state.time ?? 0,
    ownerId,
    credits,
    source,
  };
  recordEvent(logistics, event, DEFAULT_LOGISTICS_CONFIG);
  return { ok: true, credits, event };
}

export function createDefaultLogisticsState() {
  return {
    version: 2,
    nextConvoyId: 1,
    nextLocalTransportId: 1,
    depots: {},
    routes: [],
    outpostStock: {},
    localTransports: [],
    freighterPools: {},
    convoys: [],
    blockades: { lanes: [], systems: [] },
    stats: {
      producedCargo: emptyCargo(),
      deliveredCargo: emptyCargo(),
      lostCargo: emptyCargo(),
      producedCredits: 0,
      onsiteCredits: 0,
      lostCredits: 0,
      recoveredCredits: 0,
      deliveredCredits: 0,
      deliveredCreditsByOwner: {},
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
  logistics.version = 2;
  logistics.nextConvoyId = Math.max(1, Number(logistics.nextConvoyId) || 1);
  logistics.nextLocalTransportId = Math.max(1, Number(logistics.nextLocalTransportId) || 1);
  logistics.depots = logistics.depots && typeof logistics.depots === 'object' ? logistics.depots : {};
  logistics.routes = Array.isArray(logistics.routes) ? logistics.routes : [];
  logistics.outpostStock = logistics.outpostStock && typeof logistics.outpostStock === 'object'
    ? logistics.outpostStock : {};
  logistics.localTransports = Array.isArray(logistics.localTransports) ? logistics.localTransports : [];
  logistics.freighterPools = logistics.freighterPools && typeof logistics.freighterPools === 'object'
    ? logistics.freighterPools : {};
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
  logistics.stats.deliveredCreditsByOwner = logistics.stats.deliveredCreditsByOwner
    && typeof logistics.stats.deliveredCreditsByOwner === 'object'
    ? logistics.stats.deliveredCreditsByOwner : {};
  logistics.events = Array.isArray(logistics.events) ? logistics.events : [];
  logistics.lastTickAt = Number.isFinite(logistics.lastTickAt) ? logistics.lastTickAt : null;

  for (const depot of Object.values(logistics.depots)) {
    depot.ownerId = depot.ownerId ?? 'player';
    depot.level = Math.max(1, Math.min(4, Math.floor(Number(depot.level) || 1)));
    depot.doctrineId = LOGISTICS_CONVOY_DOCTRINES[depot.doctrineId] ? depot.doctrineId : 'standard';
    depot.storedCredits = legacyCredits(depot);
    depot.capacity = LOGISTICS_EXPORT_CENTER_CAPACITY[depot.level];
    depot.assemblyBays = LOGISTICS_EXPORT_CENTER_BAYS[depot.level];
    depot.assemblyBusyUntil = Array.isArray(depot.assemblyBusyUntil)
      ? depot.assemblyBusyUntil.slice(0, depot.assemblyBays).map((time) => Math.max(0, Number(time) || 0))
      : [];
    while (depot.assemblyBusyUntil.length < depot.assemblyBays) depot.assemblyBusyUntil.push(0);
    depot.readySince = Number.isFinite(depot.readySince) ? depot.readySince : null;
    depot.waitingForEscortsSince = Number.isFinite(depot.waitingForEscortsSince)
      ? depot.waitingForEscortsSince : null;
  }
  for (const stock of Object.values(logistics.outpostStock)) {
    stock.ownerId = stock.ownerId ?? 'player';
    stock.storedCredits = legacyCredits(stock);
    stock.capacity = Math.max(LOGISTICS_CREDIT_STOCK_CAPACITY, Number(stock.capacityCredits) || 0);
    stock.producedCredits = Math.max(
      0,
      Number(stock.producedCredits) || cargoCreditValue(stock.producedTotal),
    );
  }
  for (const transport of logistics.localTransports) {
    transport.ownerId = transport.ownerId ?? 'player';
    transport.creditLoad = Number.isFinite(transport.creditLoad)
      ? roundCredits(transport.creditLoad)
      : cargoCreditValue(transport.manifest);
  }
  for (const convoy of logistics.convoys) {
    convoy.ownerId = convoy.ownerId ?? 'player';
    convoy.creditLoad = Number.isFinite(convoy.creditLoad)
      ? roundCredits(convoy.creditLoad)
      : cargoCreditValue(convoy.manifest);
    convoy.doctrineId = LOGISTICS_CONVOY_DOCTRINES[convoy.doctrineId]
      ? convoy.doctrineId : 'standard';
    convoy.escortShipIds = Array.isArray(convoy.escortShipIds)
      ? [...new Set(convoy.escortShipIds.map(String))] : [];
    convoy.threat = Math.max(0, Math.min(100, Number(convoy.threat) || 0));
    convoy.threatScore = Math.max(
      0,
      Math.min(100, Number(convoy.threatScore ?? convoy.threat) || 0),
    );
    convoy.threatBand = convoy.threatBand
      ?? (convoy.threatScore < 25 ? 'safe'
        : convoy.threatScore < 50 ? 'watched'
          : convoy.threatScore < 75 ? 'threatened' : 'critical');
  }
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

function ownerResearchUnlocked(state, ownerId, techId) {
  const { techState } = ownerContext(state, ownerId);
  return !!techState?.research?.unlocked?.includes?.(techId);
}

function ensureFreighterPool(state, ownerId = 'player', options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const id = ownerId || 'player';
  const existing = logistics.freighterPools[id] ?? {};
  const pool = {
    ownerId: id,
    total: Math.max(config.freeFreighters, Math.floor(Number(existing.total) || config.freeFreighters)),
    paid: Math.max(0, Math.floor(Number(existing.paid) || 0)),
    nextFreighterId: Math.max(
      config.freeFreighters + 1,
      Math.floor(Number(existing.nextFreighterId) || config.freeFreighters + 1),
    ),
    builds: Array.isArray(existing.builds) ? existing.builds : [],
    backlog: Math.max(0, Math.floor(Number(existing.backlog) || 0)),
  };
  logistics.freighterPools[id] = pool;
  return pool;
}

function activeFreighterIds(logistics, ownerId) {
  return new Set(logistics.localTransports
    .filter((transport) => transport.ownerId === ownerId && localTransportActive(transport))
    .map((transport) => String(transport.freighterId))
    .filter(Boolean));
}

function availableFreighterId(state, ownerId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const pool = ensureFreighterPool(state, ownerId, options);
  const active = activeFreighterIds(logistics, ownerId);
  for (let index = 1; index <= pool.total; index++) {
    const id = `freighter:${ownerId}:${index}`;
    if (!active.has(id)) return id;
  }
  return null;
}

function tickFreighterBuilds(state, options = {}) {
  const logistics = ensureLogisticsState(state);
  const now = state.time ?? 0;
  const events = [];
  for (const pool of Object.values(logistics.freighterPools)) {
    const completed = pool.builds.filter((build) => now >= build.completeAt);
    pool.builds = pool.builds.filter((build) => now < build.completeAt);
    for (const build of completed) {
      pool.total += 1;
      pool.paid += build.cost > 0 ? 1 : 0;
      events.push({
        type: 'freighter_completed',
        at: now,
        ownerId: pool.ownerId,
        freighterId: build.freighterId,
        cost: build.cost,
      });
    }
  }
  return events;
}

function queueFreighterBuild(state, ownerId, options = {}) {
  const config = configFrom(options);
  const pool = ensureFreighterPool(state, ownerId, options);
  if (pool.builds.length > 0) return { ok: false, reason: 'Freighter already building' };
  const wallet = ownerWallet(state, ownerId);
  if (!wallet || wallet.get() + EPSILON < config.freighterCost) {
    pool.backlog += 1;
    return { ok: false, reason: `Need ${config.freighterCost} credits for another freighter` };
  }
  wallet.set(wallet.get() - config.freighterCost);
  const ordinal = pool.nextFreighterId++;
  const build = {
    freighterId: `freighter:${ownerId}:${ordinal}`,
    ownerId,
    cost: config.freighterCost,
    startedAt: state.time ?? 0,
    completeAt: (state.time ?? 0) + config.freighterBuildMs,
  };
  pool.builds.push(build);
  return { ok: true, build };
}

export function freighterPoolSummary(state, ownerId = 'player', options = {}) {
  const logistics = ensureLogisticsState(state);
  const pool = ensureFreighterPool(state, ownerId, options);
  const active = activeFreighterIds(logistics, ownerId).size;
  return {
    ownerId,
    freeAllowance: configFrom(options).freeFreighters,
    total: pool.total,
    paid: pool.paid,
    active,
    available: Math.max(0, pool.total - active),
    building: pool.builds.length,
    backlog: pool.backlog,
  };
}

export function availableConvoyDoctrines(state, ownerId = 'player') {
  const result = ['standard'];
  if (ownerResearchUnlocked(state, ownerId, 'trade_fast_couriers')) result.push('fast');
  if (ownerResearchUnlocked(state, ownerId, 'trade_bulk_freighter')) result.push('bulk');
  if (ownerResearchUnlocked(state, ownerId, 'trade_armored_convoy')) result.push('armored');
  if (ownerResearchUnlocked(state, ownerId, 'trade_signature_masking')) result.push('stealth');
  return result;
}

function preferredAiConvoyDoctrine(state, ownerId) {
  const available = new Set(availableConvoyDoctrines(state, ownerId));
  const personality = state.factions?.list?.find((faction) => faction.id === ownerId)?.personality;
  const preference = {
    economic: ['bulk', 'armored', 'fast', 'stealth'],
    militarist: ['armored', 'bulk', 'fast', 'stealth'],
    expansionist: ['fast', 'stealth', 'bulk', 'armored'],
    scientific: ['stealth', 'fast', 'armored', 'bulk'],
  }[personality] ?? ['armored', 'bulk', 'fast', 'stealth'];
  return preference.find((doctrineId) => available.has(doctrineId)) ?? 'standard';
}

function doctrineCapacityMultiplier(state, ownerId) {
  const effects = techEffects(ownerContext(state, ownerId).techState);
  return Math.max(1, Number(effects.convoyCapacityMult) || 1);
}

export function convoyDoctrine(state, doctrineId = 'standard', ownerId = 'player', options = {}) {
  const config = configFrom(options);
  const id = config.convoyDoctrines[doctrineId] ? doctrineId : 'standard';
  const base = config.convoyDoctrines[id];
  return {
    id,
    ...base,
    capacity: roundCredits(base.capacity * doctrineCapacityMultiplier(state, ownerId)),
  };
}

export function setExportCenterDoctrine(state, depotId, doctrineId) {
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export center' };
  if (!availableConvoyDoctrines(state, depot.ownerId).includes(doctrineId)) {
    return { ok: false, reason: 'Convoy doctrine is not researched' };
  }
  depot.doctrineId = doctrineId;
  return { ok: true, depot, doctrine: convoyDoctrine(state, doctrineId, depot.ownerId) };
}

export function upgradeExportCenter(state, depotId, options = {}) {
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export center' };
  const nextLevel = Math.min(4, (depot.level ?? 1) + 1);
  if (nextLevel === depot.level) return { ok: false, reason: 'Export center is already fully upgraded' };
  const ownerId = depot.ownerId ?? 'player';
  const requirements = {
    2: ['trade_logistics_hubs'],
    3: ['trade_lane_secured', 'trade_armored_convoy'],
    4: ['trade_galactic_exchange'],
  };
  const missing = requirements[nextLevel].filter((techId) => !ownerResearchUnlocked(state, ownerId, techId));
  if (missing.length) return { ok: false, reason: 'Required export-center technology is not researched' };
  const config = configFrom(options);
  const cost = config.exportCenterUpgradeCost[nextLevel];
  const wallet = ownerWallet(state, ownerId);
  if (!wallet || wallet.get() + EPSILON < cost) return { ok: false, reason: `Need ${cost} credits` };
  wallet.set(wallet.get() - cost);
  depot.level = nextLevel;
  depot.capacity = config.exportCenterCapacity[nextLevel];
  depot.assemblyBays = config.exportCenterBays[nextLevel];
  while (depot.assemblyBusyUntil.length < depot.assemblyBays) depot.assemblyBusyUntil.push(0);
  const system = getSystems(state, depot.galaxyId)[depot.systemId];
  const structure = system?.structures?.find((entry) => entry.id === depot.structureId);
  if (structure) {
    structure.level = nextLevel;
    structure.maxHp = [0, 520, 720, 1020, 1320][nextLevel];
    structure.hp = Math.max(structure.hp ?? 0, structure.maxHp);
  }
  return { ok: true, depot, level: nextLevel, cost };
}

export function setConvoyReserve(state, subjectType, subjectId, enabled = true) {
  if (!['ship', 'battle_group'].includes(subjectType)) {
    return { ok: false, reason: 'Convoy reserve subject must be a ship or battle group' };
  }
  const target = subjectType === 'ship'
    ? state.playerShips?.find((ship) => ship.id === subjectId)
    : state.battleGroups?.find((group) => group.id === subjectId);
  if (!target) return { ok: false, reason: `No such ${subjectType.replace('_', ' ')}` };
  target.convoyReserve = !!enabled;
  return { ok: true, subjectType, subjectId, enabled: !!enabled };
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

export function nexusAcceptsCargo(system, ownerId = 'player', state = null) {
  if (system?.star?.kind !== 'trade_nexus') return false;
  if (system.tradeNexus?.blockedOwners?.includes?.(ownerId)) return false;
  const systemActor = system.owner === 'player' ? 'player' : system.factionId ?? null;
  const treatyAccess = state && systemActor && systemActor !== ownerId
    && (hasAgreement(state, systemActor, AGREEMENT_TRADE, ownerId)
      || hasAgreement(state, systemActor, AGREEMENT_ALLIANCE, ownerId));
  if (ownerId !== 'player') return treatyAccess || system.tradeNexus?.openAccess !== false;
  if (system.tradeNexus?.acceptsPlayerTrade === false) return false;
  if (system.owner === 'ai' && system.tradeNexus?.allied !== true && !treatyAccess) return false;
  return true;
}

export function nexusAcceptsPlayerCargo(system) {
  return nexusAcceptsCargo(system, 'player');
}

/** Returns every generated nexus; available indicates whether it currently accepts player cargo. */
export function discoverTradeNexuses(state, galaxyId = state.activeGalaxyId, ownerId = 'player') {
  return Object.values(getSystems(state, galaxyId))
    .filter((system) => system?.star?.kind === 'trade_nexus')
    .map((system) => ({
      galaxyId,
      systemId: system.id,
      name: system.name,
      owner: system.owner,
      available: nexusAcceptsCargo(system, ownerId, state),
    }))
    .sort((a, b) => a.systemId.localeCompare(b.systemId));
}

function bestNexusRoute(state, galaxyId, fromSystemId, options = {}) {
  const graph = getGraph(state, galaxyId);
  const blockades = routeBlockades(state, galaxyId);
  const actorId = options.ownerId ?? 'player';
  for (const system of Object.values(getSystems(state, galaxyId))) {
    if (system.id === fromSystemId) continue;
    const legality = canRouteThroughSystem(state, system, actorId, {
      galaxyId,
      allowHostile: true,
    });
    if (!legality.ok) blockades.blockedSystems.add(system.id);
  }
  const requested = options.destinationSystemId ?? null;
  const candidates = discoverTradeNexuses(state, galaxyId, options.ownerId ?? 'player')
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
  const ownerId = options.ownerId
    ?? (system.owner === 'player' ? 'player' : system.factionId ?? 'ai-0');
  const existing = logistics.depots[id];
  if (existing) {
    if (options.structureId) {
      existing.structureId = options.structureId;
      existing.source = 'structure';
    }
    existing.operational = options.operational ?? true;
    existing.level = Math.max(1, Math.min(4, Number(options.level ?? existing.level) || 1));
    existing.capacity = config.exportCenterCapacity[existing.level];
    existing.assemblyBays = config.exportCenterBays[existing.level];
    existing.assemblyBusyUntil = Array.isArray(existing.assemblyBusyUntil)
      ? existing.assemblyBusyUntil.slice(0, existing.assemblyBays) : [];
    while (existing.assemblyBusyUntil.length < existing.assemblyBays) existing.assemblyBusyUntil.push(0);
    existing.ownerId = ownerId;
    return { ok: true, depot: existing, created: false };
  }

  const level = Math.max(1, Math.min(4, Number(options.level) || 1));
  const depot = {
    id,
    galaxyId,
    systemId,
    structureId: options.structureId ?? null,
    source: options.structureId ? 'structure' : (options.source ?? 'registered'),
    operational: options.operational ?? true,
    level,
    capacity: config.exportCenterCapacity[level],
    assemblyBays: config.exportCenterBays[level],
    assemblyBusyUntil: Array(config.exportCenterBays[level]).fill(0),
    storedCredits: Number.isFinite(options.storedCredits)
      ? roundCredits(options.storedCredits)
      : cargoCreditValue(options.inventory),
    doctrineId: config.convoyDoctrines[options.doctrineId] ? options.doctrineId : 'standard',
    inventory: normalizeCargo(options.inventory),
    preferredNexusId: options.preferredNexusId ?? null,
    routePaused: false,
    pauseReason: null,
    lastDispatchAt: null,
    readySince: null,
    waitingForEscortsSince: null,
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
    const { effectOpts } = systemOwnerContext(state, system);
    const developed = ['player', 'ai'].includes(system.owner)
      && system.star?.kind !== 'trade_nexus'
      && (system.structures ?? []).some((structure) => structure.type === 'outpost'
        && isOperationalStructure(state, structure, { ...effectOpts, systemId: system.id, galaxyId }));
    if (developed && !(system.structures ?? []).some((structure) => structure.type === 'export_depot')) {
      system.structures.push({
        id: `depot-auto-${galaxyId}-${system.id}`,
        type: 'export_depot',
        bodyId: null,
        builtAtTime: state.time ?? 0,
        level: 1,
        hp: 520,
        maxHp: 520,
        operational: true,
        factionId: system.owner === 'ai' ? system.factionId ?? 'ai-0' : undefined,
      });
    }
    for (const structure of system.structures ?? []) {
      if (structure.type !== 'export_depot') continue;
      const result = registerExportDepot(state, galaxyId, system.id, {
        ...options,
        allowNonPlayer: options.allowNonPlayer ?? system.owner === 'ai',
        ownerId: system.owner === 'player' ? 'player' : system.factionId ?? 'ai-0',
        structureId: structure.id,
        level: structure.level ?? 1,
        operational: isOperationalStructure(state, structure, { ...effectOpts, systemId: system.id, galaxyId }),
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

function ensureOutpostStock(logistics, galaxyId, system, outpost, config, capacityBonus = 0) {
  const id = outpostStockId(galaxyId, system.id, outpost.id);
  if (!logistics.outpostStock[id]) {
    logistics.outpostStock[id] = {
      id,
      galaxyId,
      systemId: system.id,
      outpostId: outpost.id,
      bodyId: outpost.bodyId,
      ownerId: system.owner === 'player' ? 'player' : system.factionId ?? 'ai-0',
      capacity: config.outpostCreditCapacity + Math.max(0, capacityBonus) * 6,
      storedCredits: 0,
      producedCredits: 0,
      inventory: emptyCargo(),
      producedTotal: emptyCargo(),
      lastProducedAt: null,
      lastLocalDispatchAt: null,
    };
  }
  logistics.outpostStock[id].ownerId = system.owner === 'player'
    ? 'player' : system.factionId ?? logistics.outpostStock[id].ownerId ?? 'ai-0';
  logistics.outpostStock[id].capacity = config.outpostCreditCapacity + Math.max(0, capacityBonus) * 6;
  return logistics.outpostStock[id];
}

/** Pure per-outpost production for deltaMs. */
export function cargoProductionForOutpost(system, outpost, deltaMs = TICK_MS, options = {}) {
  const config = configFrom(options);
  const planet = system?.bodies?.find((body) => body.id === outpost?.bodyId);
  if (!planet || outpost?.type !== 'outpost') return emptyCargo();
  const rates = config.productionRates[planet.type] ?? config.productionRates.habitable;
  const moonMultiplier = 1 + config.moonProductionBonus
    * (planet.moons?.length ?? 0)
    * Math.max(0, Number(options.moonYieldMultiplier ?? 1) || 1);
  const configuredMultiplier = Number(outpost.productionMultiplier);
  const legacyMultiplier = Number.isFinite(configuredMultiplier) ? Math.max(0, configuredMultiplier) : 1;
  const levelMultiplier = outpostCargoProductionMultiplier(outpost);
  const systemMultiplier = Math.max(0, Number(options.systemProductionMultiplier ?? 1) || 1);
  return scaleCargo(
    rates,
    (Math.max(0, deltaMs) / 1000) * moonMultiplier * legacyMultiplier * levelMultiplier * systemMultiplier,
  );
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

/** Produces unbanked credits into capped outpost storage. */
export function tickOutpostProduction(state, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const deltaMs = options.tickMs ?? TICK_MS;
  let producedCredits = 0;
  let onsiteCredits = 0;
  for (const galaxyId of galaxyIdsForState(state, options.galaxyIds ?? options.galaxyId)) {
    for (const system of Object.values(getSystems(state, galaxyId))) {
      if (!['player', 'ai'].includes(system.owner) || system.star?.kind === 'trade_nexus') continue;
      const { techState, effectOpts } = systemOwnerContext(state, system);
      const effects = techEffects(techState);
      for (const outpost of system.structures ?? []) {
        if (outpost.type !== 'outpost' || !isOperationalStructure(state, outpost, {
          ...effectOpts,
          systemId: system.id,
          galaxyId,
        })) continue;
        const stock = ensureOutpostStock(
          logistics,
          galaxyId,
          system,
          outpost,
          config,
          effects.outpostStockCapacityBonus,
        );
        const deltaCargo = cargoProductionForOutpost(system, outpost, deltaMs, {
          ...config,
          moonYieldMultiplier: effects.moonYieldMult,
          systemProductionMultiplier: structureCargoProductionMultiplier(state, system.id, {
            ...effectOpts,
            galaxyId,
          }) * effects.cargoProductionMult * effects.outpostCargoOutputMult,
        });
        const grossCredits = cargoCreditValue(deltaCargo, config.cargoValues);
        stock.productionCreditsPerSecond = deltaMs > 0
          ? roundCredits(grossCredits * (1000 / deltaMs)) : 0;
        const ownerId = stock.ownerId ?? 'player';
        const processingShare = effects.onsiteProcessingShare
          ?? (ownerResearchUnlocked(state, ownerId, 'trade_onsite_processing')
            ? config.onsiteProcessingShare : 0);
        const directCredits = roundCredits(grossCredits * Math.max(0, Math.min(1, processingShare)));
        const physicalCredits = roundCredits(grossCredits - directCredits);
        const acceptedCredits = Math.min(physicalCredits, creditRoom(stock.storedCredits, stock.capacity));
        stock.storedCredits = roundCredits(stock.storedCredits + acceptedCredits);
        stock.producedCredits = roundCredits(stock.producedCredits + acceptedCredits);
        stock.lastProducedAt = state.time ?? 0;
        producedCredits = roundCredits(producedCredits + acceptedCredits);
        if (directCredits > 0) {
          const wallet = ownerWallet(state, ownerId);
          if (wallet) wallet.set(wallet.get() + directCredits);
          onsiteCredits = roundCredits(onsiteCredits + directCredits);
        }
      }
    }
  }
  logistics.stats.producedCredits = roundCredits(logistics.stats.producedCredits + producedCredits);
  logistics.stats.onsiteCredits = roundCredits(logistics.stats.onsiteCredits + onsiteCredits);
  return { producedCredits, onsiteCredits };
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
    ownerId: transport.ownerId ?? 'player',
    galaxyId: transport.galaxyId,
    systemId: transport.systemId,
    fromBodyId: transport.fromBodyId,
    depotId: transport.depotId,
    status: transport.status,
    loaded: transport.status === 'inbound',
    progress: Math.max(0, Math.min(1, (sampleTime - transport.departAt) / duration)),
    creditLoad: roundCredits(transport.creditLoad),
    freighterId: transport.freighterId ?? null,
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
      if (stock) stock.storedCredits = roundCredits(stock.storedCredits + transport.creditLoad);
      transport.status = 'failed';
      transport.completedAt = now;
      const event = { type: 'local_transport_failed', at: now, transportId: transport.id, depotId: transport.depotId };
      events.push(recordEvent(logistics, event, config));
      continue;
    }
    const deliveredCredits = Math.min(transport.creditLoad, creditRoom(depot.storedCredits, depot.capacity));
    const overflowCredits = roundCredits(transport.creditLoad - deliveredCredits);
    depot.storedCredits = roundCredits(depot.storedCredits + deliveredCredits);
    if (stock) stock.storedCredits = roundCredits(stock.storedCredits + overflowCredits);
    transport.status = 'delivered';
    transport.completedAt = now;
    const event = {
      type: 'credits_arrived_at_export_center', at: now, transportId: transport.id,
      depotId: depot.id, creditLoad: deliveredCredits, overflowCredits,
    };
    events.push(recordEvent(logistics, event, config));
  }

  const stocks = Object.values(logistics.outpostStock)
    .sort((a, b) => {
      const fillDelta = (b.storedCredits / Math.max(1, b.capacity))
        - (a.storedCredits / Math.max(1, a.capacity));
      return Math.abs(fillDelta) > EPSILON ? fillDelta : a.id.localeCompare(b.id);
    });
  for (const stock of stocks) {
    const stockSystem = getSystems(state, stock.galaxyId)[stock.systemId];
    const stockOutpost = stockSystem?.structures?.find((structure) => structure.id === stock.outpostId);
    const stockContext = systemOwnerContext(state, stockSystem);
    if (!stockOutpost || !isOperationalStructure(state, stockOutpost, {
      ...stockContext.effectOpts,
      systemId: stock.systemId,
      galaxyId: stock.galaxyId,
    })) continue;
    const depot = Object.values(logistics.depots)
      .filter((candidate) => candidate.galaxyId === stock.galaxyId && candidate.systemId === stock.systemId)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!depot?.operational) continue;
    if (stock.storedCredits <= EPSILON) continue;
    const { techState, effectOpts } = ownerContext(state, stock.ownerId ?? depot.ownerId ?? 'player');
    const localInterval = config.localDispatchIntervalMs
      * structureDispatchIntervalMultiplier(state, stock.systemId, 'local', {
        ...effectOpts,
        galaxyId: stock.galaxyId,
      })
      * techEffects(techState).logisticsDispatchIntervalMult;
    if (stock.lastLocalDispatchAt !== null
      && now - stock.lastLocalDispatchAt < localInterval) continue;
    if (logistics.localTransports.some(
      (transport) => transport.stockId === stock.id && localTransportActive(transport),
    )) continue;

    const freighterId = availableFreighterId(state, stock.ownerId ?? 'player', config);
    if (!freighterId) {
      queueFreighterBuild(state, stock.ownerId ?? 'player', config);
      continue;
    }
    const creditLoad = roundCredits(Math.min(stock.storedCredits, config.localCreditCapacity));
    if (creditLoad <= EPSILON) continue;
    stock.storedCredits = roundCredits(stock.storedCredits - creditLoad);
    stock.lastLocalDispatchAt = now;
    const pool = ensureFreighterPool(state, stock.ownerId ?? 'player', config);
    pool.backlog = Math.max(0, pool.backlog - 1);
    const transport = {
      id: `local-${logistics.nextLocalTransportId++}`,
      galaxyId: stock.galaxyId,
      systemId: stock.systemId,
      stockId: stock.id,
      ownerId: stock.ownerId ?? depot.ownerId ?? 'player',
      freighterId,
      outpostId: stock.outpostId,
      fromBodyId: stock.bodyId,
      depotId: depot.id,
      creditLoad,
      status: 'inbound',
      departAt: now,
      arriveAt: now + config.localTransitMs,
      completedAt: null,
    };
    logistics.localTransports.push(transport);
    const event = {
      type: 'local_freighter_dispatched', at: now, transportId: transport.id,
      depotId: depot.id, outpostId: stock.outpostId, freighterId, creditLoad,
    };
    events.push(recordEvent(logistics, event, config));
  }
  pruneTerminalLocalTransports(logistics, config.terminalLocalTransportLimit);
  return events;
}

function findConvoy(state, convoyId) {
  return ensureLogisticsState(state).convoys.find((convoy) => convoy.id === convoyId) ?? null;
}

function escortPowerForShip(ship) {
  const stats = HULL_STATS[ship?.hull] ?? {};
  return Math.max(0, Number(stats.dps) || 0) + Math.max(0, Number(ship?.hp ?? stats.hp) || 0) / 20;
}

function convoyReserveShipIds(state) {
  const reservedGroups = new Set(
    (state.battleGroups ?? []).filter((group) => group.convoyReserve).map((group) => group.id),
  );
  const groupShipIds = new Set();
  for (const group of state.battleGroups ?? []) {
    if (!reservedGroups.has(group.id)) continue;
    for (const shipId of group.shipIds ?? []) groupShipIds.add(shipId);
  }
  return new Set((state.playerShips ?? [])
    .filter((ship) => ship.convoyReserve || groupShipIds.has(ship.id))
    .map((ship) => ship.id));
}

function eligibleEscortShips(state, depot) {
  const ownerId = depot.ownerId ?? 'player';
  const candidates = ownerId === 'player'
    ? (state.playerShips ?? []).filter((ship) => convoyReserveShipIds(state).has(ship.id))
    : (state.aiShips ?? []).filter((ship) => (ship.factionId ?? 'ai-0') === ownerId
      && ship.convoyReserve !== false);
  return candidates.filter((ship) => {
    const stats = HULL_STATS[ship.hull] ?? {};
    return ship.hp > 0
      && (stats.dps ?? 0) > 0
      && !['flagship', 'hero_flagship', 'helioclast'].includes(ship.hull)
      && !ship.convoyLeaseId
      && !state.systemBattles?.[ship.systemId]?.active;
  });
}

function routePatrolPower(state, galaxyId, path, ownerId) {
  const routeSystems = new Set(path ?? []);
  const ships = ownerId === 'player' ? state.playerShips ?? [] : state.aiShips ?? [];
  return roundCredits(ships
    .filter((ship) => ship.galaxyId === galaxyId
      && routeSystems.has(ship.systemId)
      && !ship.transit
      && ship.hp > 0
      && (ownerId === 'player' || (ship.factionId ?? 'ai-0') === ownerId))
    .reduce((sum, ship) => sum + escortPowerForShip(ship), 0));
}

export function routeSecuritySummary(state, input, options = {}) {
  const depot = typeof input === 'string' ? findExportDepot(state, input) : input;
  if (!depot) return null;
  const ownerId = depot.ownerId ?? 'player';
  const route = options.path
    ? { path: options.path }
    : bestNexusRoute(state, depot.galaxyId, depot.systemId, {
      destinationSystemId: options.destinationSystemId ?? depot.preferredNexusId,
      ownerId,
    });
  const path = route?.path ?? [];
  const doctrine = convoyDoctrine(state, options.doctrineId ?? depot.doctrineId, ownerId, options);
  const creditLoad = roundCredits(options.creditLoad ?? Math.min(depot.storedCredits, doctrine.capacity));
  const factors = [];
  let threat = 10;
  const valueThreat = Math.min(25, (creditLoad / 200) * doctrine.signature);
  threat += valueThreat;
  if (valueThreat > 0) factors.push({ id: 'value', amount: roundCredits(valueThreat) });

  const pirateSystems = new Set((state.pirates?.fleets ?? [])
    .filter((fleet) => fleet.galaxyId === depot.galaxyId && fleet.systemId)
    .map((fleet) => fleet.systemId));
  const nestSystems = new Set((state.pirates?.nests ?? [])
    .filter((nest) => nest.galaxyId === depot.galaxyId && !nest.destroyed)
    .map((nest) => nest.systemId));
  const pirateExposure = path.reduce((sum, systemId) => (
    sum + (pirateSystems.has(systemId) ? 15 : 0) + (nestSystems.has(systemId) ? 20 : 0)
  ), 0);
  threat += Math.min(35, pirateExposure);
  if (pirateExposure > 0) factors.push({ id: 'pirates', amount: Math.min(35, pirateExposure) });

  const blockadeExposure = path.slice(0, -1).reduce((sum, systemId, index) => (
    sum + (isLaneBlockaded(state, depot.galaxyId, systemId, path[index + 1]) ? 20 : 0)
  ), 0);
  threat += Math.min(25, blockadeExposure);
  if (blockadeExposure > 0) factors.push({ id: 'blockades', amount: Math.min(25, blockadeExposure) });

  const recentCutoff = (state.time ?? 0) - 300000;
  const recentAttacks = ensureLogisticsState(state).events.filter((event) => (
    event.at >= recentCutoff
      && ['convoy_intercepted', 'convoy_credits_stolen'].includes(event.type)
      && event.galaxyId === depot.galaxyId
  )).length;
  const recentThreat = Math.min(20, recentAttacks * 5);
  threat += recentThreat;
  if (recentThreat > 0) factors.push({ id: 'recent_attacks', amount: recentThreat });

  const centerReduction = [0, 0, 5, 15, 25][depot.level ?? 1];
  threat -= centerReduction;
  if (centerReduction > 0) factors.push({ id: 'export_center', amount: -centerReduction });
  const techReduction = Math.max(
    0,
    Number(techEffects(ownerContext(state, ownerId).techState).routeThreatReduction) || 0,
  );
  threat -= techReduction;
  if (techReduction > 0) factors.push({ id: 'technology', amount: -techReduction });
  const patrolPower = routePatrolPower(state, depot.galaxyId, path, ownerId);
  const patrolReduction = Math.min(20, patrolPower / 5);
  threat -= patrolReduction;
  if (patrolReduction > 0) factors.push({ id: 'patrols', amount: -roundCredits(patrolReduction) });

  const escortShipIds = options.escortShipIds ?? [];
  const escortShips = [
    ...(state.playerShips ?? []),
    ...(state.aiShips ?? []),
  ].filter((ship) => escortShipIds.includes(ship.id));
  const escortPower = roundCredits(escortShips.reduce((sum, ship) => sum + escortPowerForShip(ship), 0));
  const escortReduction = Math.min(35, escortPower / 4);
  threat -= escortReduction;
  if (escortReduction > 0) factors.push({ id: 'escorts', amount: -roundCredits(escortReduction) });

  const score = Math.max(0, Math.min(100, Math.round(threat)));
  const band = score < 25 ? 'safe' : score < 50 ? 'watched' : score < 75 ? 'threatened' : 'critical';
  return {
    score,
    band,
    path,
    factors,
    creditLoad,
    doctrineId: doctrine.id,
    recommendedEscortPower: Math.ceil(score * 1.5),
    escortPower,
    patrolPower,
  };
}

function beginEscortRally(state, depot, security, options = {}) {
  const now = state.time ?? 0;
  if (depot.waitingForEscortsSince == null) depot.waitingForEscortsSince = now;
  const selected = new Set(depot.pendingEscortShipIds ?? []);
  let selectedPower = [...selected].reduce((sum, shipId) => {
    const ship = [...(state.playerShips ?? []), ...(state.aiShips ?? [])].find((entry) => entry.id === shipId);
    return sum + escortPowerForShip(ship);
  }, 0);
  const graph = getGraph(state, depot.galaxyId);
  const candidates = eligibleEscortShips(state, depot)
    .filter((ship) => !selected.has(ship.id))
    .map((ship) => {
      const path = ship.systemId
        ? shortestRoute(graph, ship.systemId, depot.systemId, routeBlockades(state, depot.galaxyId))
        : null;
      return { ship, path, distance: path ? routeDistance(graph, path) : Infinity };
    })
    .filter((entry) => entry.path)
    .sort((a, b) => a.distance - b.distance || b.ship.hp - a.ship.hp || a.ship.id.localeCompare(b.ship.id));
  for (const entry of candidates) {
    if (selectedPower >= security.recommendedEscortPower) break;
    const { ship, path } = entry;
    selected.add(ship.id);
    selectedPower += escortPowerForShip(ship);
    ship.convoyRallyDepotId = depot.id;
    if (ship.systemId !== depot.systemId && !ship.transit && path.length > 1) {
      const speed = HULL_STATS[ship.hull]?.laneSpeed ?? 100;
      ship.transit = {
        path,
        legIndex: 0,
        legStartTime: now,
        legDurationMs: convoyLegDurationMs(graph, path[0], path[1], {
          ...options,
          convoySpeed: speed,
        }),
      };
      ship.systemId = null;
    }
  }
  depot.pendingEscortShipIds = [...selected];
  return depot.pendingEscortShipIds;
}

function arrivedEscortIds(state, depot) {
  const allShips = [...(state.playerShips ?? []), ...(state.aiShips ?? [])];
  return (depot.pendingEscortShipIds ?? []).filter((shipId) => {
    const ship = allShips.find((entry) => entry.id === shipId);
    return ship?.hp > 0 && !ship.transit && ship.systemId === depot.systemId;
  });
}

function claimConvoyEscorts(state, depot, convoyId) {
  const arrived = arrivedEscortIds(state, depot);
  const allShips = [...(state.playerShips ?? []), ...(state.aiShips ?? [])];
  for (const shipId of arrived) {
    const ship = allShips.find((entry) => entry.id === shipId);
    ship.convoyLeaseId = convoyId;
    ship.convoyEscortId = convoyId;
    ship.convoyRallyDepotId = null;
    ship.transit = null;
    ship.systemId = null;
  }
  for (const shipId of depot.pendingEscortShipIds ?? []) {
    if (arrived.includes(shipId)) continue;
    const ship = allShips.find((entry) => entry.id === shipId);
    if (ship && ship.convoyRallyDepotId === depot.id) ship.convoyRallyDepotId = null;
  }
  depot.pendingEscortShipIds = [];
  depot.waitingForEscortsSince = null;
  return arrived;
}

export function dispatchDepot(state, depotId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const depot = findExportDepot(state, depotId);
  if (!depot) return { ok: false, reason: 'No such export depot' };
  if (!depot.operational) return { ok: false, reason: 'Export depot is offline' };
  if (depot.routePaused) return { ok: false, reason: `Route paused: ${depot.pauseReason ?? 'manual'}` };
  if (depot.storedCredits <= EPSILON) return { ok: false, reason: 'No stored credits to dispatch' };
  const { techState, effectOpts } = ownerContext(state, depot.ownerId ?? 'player');
  const routeCapacity = Math.max(1, depot.assemblyBays ?? 1)
    + Math.max(0, Math.floor(techEffects(techState).convoyRouteBonus ?? 0))
    + Math.max(0, Math.floor(structureActiveConvoyRouteBonus(state, depot.systemId, {
      ...effectOpts,
      galaxyId: depot.galaxyId,
    })));
  const activeFromDepot = logistics.convoys.filter((convoy) => convoy.depotId === depot.id
    && !['delivered', 'intercepted'].includes(convoy.status)).length;
  if (activeFromDepot >= routeCapacity) {
    return { ok: false, reason: `Active convoy route capacity reached (${routeCapacity})` };
  }

  const destinationSystemId = options.destinationSystemId ?? depot.preferredNexusId;
  const route = bestNexusRoute(state, depot.galaxyId, depot.systemId, {
    destinationSystemId,
    ownerId: depot.ownerId ?? 'player',
  });
  if (!route) {
    const hasNexus = discoverTradeNexuses(state, depot.galaxyId, depot.ownerId ?? 'player')
      .some((nexus) => nexus.available);
    return { ok: false, reason: hasNexus ? 'No unblocked route to a Trade Nexus' : 'No available Trade Nexus' };
  }
  const routeRecord = logistics.routes.find((entry) => entry.depotId === depot.id) ?? {
    id: `route:${depot.id}`,
    depotId: depot.id,
    ownerId: depot.ownerId ?? 'player',
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

  const doctrine = convoyDoctrine(state, options.doctrineId ?? depot.doctrineId, depot.ownerId, config);
  const creditLoad = roundCredits(Math.min(depot.storedCredits, doctrine.capacity));
  depot.storedCredits = roundCredits(depot.storedCredits - creditLoad);
  const now = state.time ?? 0;
  const escortShipIds = claimConvoyEscorts(state, depot, `convoy-${logistics.nextConvoyId}`);
  const security = routeSecuritySummary(state, depot, {
    ...config,
    path: route.path,
    doctrineId: doctrine.id,
    creditLoad,
    escortShipIds,
  });
  const graph = getGraph(state, depot.galaxyId);
  const convoy = {
    id: `convoy-${logistics.nextConvoyId++}`,
    galaxyId: depot.galaxyId,
    depotId: depot.id,
    ownerId: depot.ownerId ?? 'player',
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
    legDurationMs: convoyLegDurationMs(graph, route.path[0], route.path[1], {
      ...config,
      convoySpeed: Math.min(
        doctrine.speed,
        ...escortShipIds.map((shipId) => {
          const ship = [...(state.playerShips ?? []), ...(state.aiShips ?? [])]
            .find((entry) => entry.id === shipId);
          return HULL_STATS[ship?.hull]?.laneSpeed ?? doctrine.speed;
        }),
      ),
    }),
    pausedAt: null,
    resumeStatus: null,
    pauseReason: null,
    doctrineId: doctrine.id,
    creditLoad,
    deliveryValue: creditLoad,
    escortShipIds,
    escortStrength: security?.escortPower ?? 0,
    threat: security?.score ?? 0,
    threatScore: security?.score ?? 0,
    threatBand: security?.band ?? 'safe',
    armor: Math.max(0, Number(options.armor) || doctrine.hp),
    maxArmor: Math.max(0, Number(options.armor) || doctrine.hp),
    convoySpeed: doctrine.speed,
    signature: doctrine.signature,
    deliveredAt: null,
    interceptedAt: null,
  };
  logistics.convoys.push(convoy);
  depot.lastDispatchAt = now;
  depot.readySince = null;
  const freeBay = depot.assemblyBusyUntil.findIndex((time) => time <= now);
  if (freeBay >= 0) depot.assemblyBusyUntil[freeBay] = now;
  logistics.stats.convoysDispatched += 1;
  const event = {
    type: 'convoy_dispatched', at: now, convoyId: convoy.id, depotId: depot.id,
    ownerId: convoy.ownerId, destinationSystemId: convoy.destinationSystemId,
    path: [...convoy.path], creditLoad, doctrineId: doctrine.id, escortShipIds,
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
    if ((depot.ownerId ?? 'player') !== 'player') {
      depot.doctrineId = preferredAiConvoyDoctrine(state, depot.ownerId);
    }
    const freeBay = depot.assemblyBusyUntil.findIndex((time) => time <= now);
    if (freeBay < 0) continue;
    const doctrine = convoyDoctrine(state, depot.doctrineId, depot.ownerId, config);
    const fillRatio = depot.storedCredits / Math.max(1, doctrine.capacity);
    if (fillRatio + EPSILON < config.convoyFillRatio) {
      if (depot.storedCredits > EPSILON && depot.readySince == null) depot.readySince = now;
      const partialReady = depot.readySince != null
        && now - depot.readySince >= config.convoyPartialDispatchMs
        && fillRatio + EPSILON >= config.convoyPartialFillRatio;
      if (!partialReady) continue;
    } else if (depot.readySince == null) {
      depot.readySince = now;
    }
    const security = routeSecuritySummary(state, depot, { ...config, doctrineId: doctrine.id });
    beginEscortRally(state, depot, security, config);
    const arrivedIds = arrivedEscortIds(state, depot);
    const ralliedPower = arrivedIds.reduce((sum, shipId) => {
      const ship = [...(state.playerShips ?? []), ...(state.aiShips ?? [])]
        .find((entry) => entry.id === shipId);
      return sum + escortPowerForShip(ship);
    }, 0);
    const rallyExpired = now - depot.waitingForEscortsSince >= config.escortRallyMs;
    if (ralliedPower + EPSILON < security.recommendedEscortPower && !rallyExpired) continue;
    const { techState, effectOpts } = ownerContext(state, depot.ownerId ?? 'player');
    const interval = config.convoyDispatchIntervalMs
      * structureDispatchIntervalMultiplier(state, depot.systemId, 'convoy', {
        ...effectOpts,
        galaxyId: depot.galaxyId,
      })
      * techEffects(techState).logisticsDispatchIntervalMult;
    if (depot.lastDispatchAt !== null
      && now - depot.lastDispatchAt < interval) continue;
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
  const route = bestNexusRoute(state, convoy.galaxyId, origin.systemId, {
    destinationSystemId,
    ownerId: convoy.ownerId ?? 'player',
  });
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
  convoy.legDurationMs = convoyLegDurationMs(graph, route.path[0], route.path[1], {
    ...config,
    convoySpeed: convoy.convoySpeed ?? config.convoySpeed,
  });
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
  return {
    ok: false,
    reason: 'Abstract escort strength was replaced by real ships in the Convoy Reserve',
    convoy,
  };
}

function convoyEscortShips(state, convoy) {
  const ids = new Set(convoy?.escortShipIds ?? []);
  return [...(state.playerShips ?? []), ...(state.aiShips ?? [])]
    .filter((ship) => ids.has(ship.id) && ship.hp > 0);
}

export function materializeConvoyEscorts(state, convoyId, systemId) {
  const convoy = findConvoy(state, convoyId);
  if (!convoy) return { ok: false, reason: 'No such convoy' };
  for (const ship of convoyEscortShips(state, convoy)) {
    ship.transit = null;
    ship.systemId = systemId;
    ship.convoyEscortId = convoy.id;
  }
  convoy.systemId = systemId;
  convoy.currentNodeId = systemId;
  return { ok: true, convoy, shipIds: [...convoy.escortShipIds] };
}

function sendEscortsHome(state, convoy, fromSystemId) {
  const depot = findExportDepot(state, convoy.depotId);
  const graph = getGraph(state, convoy.galaxyId);
  for (const ship of convoyEscortShips(state, convoy)) {
    ship.convoyEscortId = null;
    ship.convoyReturnDepotId = depot?.id ?? null;
    ship.systemId = fromSystemId;
    ship.transit = null;
    if (!depot || fromSystemId === depot.systemId) {
      ship.convoyLeaseId = null;
      ship.convoyReturnDepotId = null;
      continue;
    }
    const path = shortestRoute(graph, fromSystemId, depot.systemId, routeBlockades(state, convoy.galaxyId));
    if (!path || path.length < 2) {
      ship.convoyLeaseId = null;
      ship.convoyReturnDepotId = null;
      continue;
    }
    ship.transit = {
      path,
      legIndex: 0,
      legStartTime: state.time ?? 0,
      legDurationMs: convoyLegDurationMs(graph, path[0], path[1], {
        convoySpeed: HULL_STATS[ship.hull]?.laneSpeed ?? 100,
      }),
    };
    ship.systemId = null;
  }
}

function tickEscortReturns(state) {
  for (const ship of [...(state.playerShips ?? []), ...(state.aiShips ?? [])]) {
    if (!ship.convoyReturnDepotId || ship.transit) continue;
    const depot = findExportDepot(state, ship.convoyReturnDepotId);
    if (!depot || ship.systemId === depot.systemId) {
      ship.convoyLeaseId = null;
      ship.convoyReturnDepotId = null;
      ship.convoyRallyDepotId = null;
    }
  }
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
  const escortPower = convoyEscortShips(state, convoy)
    .reduce((sum, ship) => sum + escortPowerForShip(ship), 0);
  const defense = escortPower + (convoy.armor ?? 0);
  if (Number.isFinite(threat) && defense >= threat) {
    logistics.stats.interceptionsRepelled += 1;
    const event = { type: 'convoy_interception_repelled', at: now, convoyId, threatStrength: threat, defense };
    recordEvent(logistics, event, config);
    if (options.attackerId && options.attackerId !== (convoy.ownerId ?? 'player')) {
      recordDiplomaticEvent(state, {
        type: 'convoy_intercepted', actor: options.attackerId,
        target: convoy.ownerId ?? 'player', severity: 0.35,
      });
    }
    return { ok: true, destroyed: false, repelled: true, convoy, event };
  }

  const baseLossFraction = options.destroyed === true
    ? 1 : Math.max(0, Math.min(1, options.creditLossFraction ?? options.cargoLossFraction ?? 1));
  const lostCredits = roundCredits(convoy.creditLoad * baseLossFraction);
  convoy.creditLoad = roundCredits(convoy.creditLoad - lostCredits);
  convoy.deliveryValue = convoy.creditLoad;
  logistics.stats.lostCredits = roundCredits(logistics.stats.lostCredits + lostCredits);
  const destroyed = options.destroyed ?? (convoy.creditLoad <= EPSILON);
  if (destroyed) {
    convoy.status = 'intercepted';
    convoy.systemId = null;
    convoy.interceptedAt = now;
    convoy.pauseReason = 'interception';
    logistics.stats.convoysLost += 1;
    sendEscortsHome(state, convoy, options.systemId ?? convoy.currentNodeId ?? convoy.fromSystemId);
  } else {
    pauseConvoyInternal(convoy, now, 'interception');
  }
  if (options.pauseRoute !== false) pauseDepotRoute(state, convoy.depotId, 'interception');
  const event = {
    type: 'convoy_intercepted', at: now, convoyId, destroyed,
    galaxyId: convoy.galaxyId,
    lostCredits,
    remainingCredits: convoy.creditLoad,
  };
  recordEvent(logistics, event, config);
  if (options.attackerId && options.attackerId !== (convoy.ownerId ?? 'player')) {
    recordDiplomaticEvent(state, {
      type: 'convoy_intercepted', actor: options.attackerId,
      target: convoy.ownerId ?? 'player',
      severity: Math.max(0.5, lostCredits / 100),
    });
  }
  const pirateFleet = options.pirateFleetId
    ? state.pirates?.fleets?.find((fleet) => fleet.id === options.pirateFleetId)
    : null;
  if (destroyed && pirateFleet && lostCredits > 0) {
    pirateFleet.stolenCredits = roundCredits((pirateFleet.stolenCredits ?? 0) + lostCredits);
    pirateFleet.stolenFromOwnerId = convoy.ownerId ?? 'player';
    pirateFleet.intent = {
      type: 'return_loot',
      targetSystemId: state.pirates?.nests?.find((nest) => nest.id === pirateFleet.nestId)?.systemId
        ?? pirateFleet.systemId,
    };
    recordEvent(logistics, {
      type: 'convoy_credits_stolen',
      at: now,
      galaxyId: convoy.galaxyId,
      convoyId,
      pirateFleetId: pirateFleet.id,
      credits: lostCredits,
    }, config);
  }
  return { ok: true, destroyed, repelled: false, lostCredits, convoy, event };
}

function nexusStillAvailable(state, convoy) {
  return nexusAcceptsCargo(
    getSystems(state, convoy.galaxyId)[convoy.destinationSystemId],
    convoy.ownerId ?? 'player',
    state,
  );
}

function deliverConvoy(state, convoy, config) {
  const logistics = ensureLogisticsState(state);
  const now = state.time ?? 0;
  const depot = findExportDepot(state, convoy.depotId);
  const systemId = depot?.systemId ?? convoy.fromSystemId;
  const system = getSystems(state, convoy.galaxyId)[systemId];
  const ownerId = convoy.ownerId ?? depot?.ownerId ?? 'player';
  const { techState, effectOpts } = ownerContext(state, ownerId);
  const deliveryMultiplier = Math.max(0, Number(
    (depot?.deliveryMultiplier ?? system?.deliveryMultiplier ?? 1)
      * structureNexusDeliveryMultiplier(state, systemId, {
        ...effectOpts,
        galaxyId: convoy.galaxyId,
      })
      * techEffects(techState).nexusDeliveryValueMult,
  ) || 1);
  const baseCredits = roundCredits(convoy.creditLoad * deliveryMultiplier);
  const destination = getSystems(state, convoy.galaxyId)[convoy.destinationSystemId];
  const destinationActor = destination?.owner === 'player' ? 'player' : destination?.factionId ?? null;
  const diplomaticTrade = destinationActor && destinationActor !== ownerId
    ? settleDiplomaticTradeDelivery(state, { from: ownerId, to: destinationActor, baseValue: baseCredits })
    : null;
  const credits = roundCredits(diplomaticTrade?.ok ? diplomaticTrade.value : baseCredits);
  const wallet = ownerWallet(state, ownerId);
  if (wallet) wallet.set(wallet.get() + credits);
  convoy.status = 'delivered';
  convoy.systemId = convoy.destinationSystemId;
  convoy.currentNodeId = convoy.destinationSystemId;
  convoy.deliveredAt = now;
  convoy.deliveryValue = credits;
  logistics.stats.convoysDelivered += 1;
  logistics.stats.deliveredCredits = roundCredits(logistics.stats.deliveredCredits + credits);
  logistics.stats.deliveredCreditsByOwner[ownerId] = roundCredits(
    (logistics.stats.deliveredCreditsByOwner[ownerId] ?? 0) + credits,
  );
  logistics.stats.lastDeliveryAt = now;
  logistics.stats.recentDeliveries.push({
    at: now, convoyId: convoy.id, ownerId, credits, creditLoad: convoy.creditLoad,
  });
  const cutoff = now - config.recentDeliveryWindowMs * 2;
  logistics.stats.recentDeliveries = logistics.stats.recentDeliveries.filter((delivery) => delivery.at >= cutoff);
  sendEscortsHome(state, convoy, convoy.destinationSystemId);
  return recordEvent(logistics, {
    type: 'convoy_delivered', at: now, convoyId: convoy.id,
    ownerId, destinationSystemId: convoy.destinationSystemId,
    creditLoad: convoy.creditLoad, credits,
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
    if (['blockade', 'no_destination', 'closed_borders'].includes(convoy.pauseReason)) {
      const location = convoyAtRouteNode(convoy, now);
      const system = location.ok ? getSystems(state, convoy.galaxyId)[location.systemId] : null;
      if (location.ok && nexusAcceptsCargo(system, convoy.ownerId ?? 'player', state)) {
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
    if (atLegStart) {
      const destination = getSystems(state, convoy.galaxyId)[toId];
      const legality = canRouteThroughSystem(
        state,
        destination ?? toId,
        convoy.ownerId ?? 'player',
        { galaxyId: convoy.galaxyId, allowHostile: true },
      );
      if (!legality.ok) {
        if (!tryRerouteOrPause(state, convoy, 'closed_borders', config)) return;
        continue;
      }
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
      { ...config, convoySpeed: convoy.convoySpeed ?? config.convoySpeed },
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
  const freighterEvents = tickFreighterBuilds(state, options);
  tickEscortReturns(state);
  const events = [
    ...freighterEvents,
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
    eta += convoyLegDurationMs(graph, convoy.path[i], convoy.path[i + 1], {
      ...options,
      convoySpeed: convoy.convoySpeed,
    });
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
    ownerId: depot.ownerId ?? 'player',
    operational: depot.operational,
    routePaused: depot.routePaused,
    pauseReason: depot.pauseReason,
    preferredNexusId: depot.preferredNexusId,
    level: depot.level,
    doctrineId: depot.doctrineId,
    doctrine: convoyDoctrine(state, depot.doctrineId, depot.ownerId, config),
    storedCredits: roundCredits(depot.storedCredits),
    capacity: depot.capacity,
    assemblyBays: depot.assemblyBays,
    availableAssemblyBays: depot.assemblyBusyUntil.filter((time) => time <= (state.time ?? 0)).length,
    activeConvoys: convoys.filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status)).length,
    lastDispatchAt: depot.lastDispatchAt,
    readySince: depot.readySince,
    security: routeSecuritySummary(state, depot, config),
    availableDoctrines: availableConvoyDoctrines(state, depot.ownerId),
  };
}

export function logisticsSummary(state, galaxyId = state.activeGalaxyId, options = {}) {
  const logistics = ensureLogisticsState(state);
  const config = configFrom(options);
  const ownerId = options.ownerId === undefined ? 'player' : options.ownerId;
  const ownerMatches = (entry) => ownerId == null || (entry.ownerId ?? 'player') === ownerId;
  const depots = Object.values(logistics.depots).filter(
    (depot) => depot.galaxyId === galaxyId && ownerMatches(depot),
  );
  const convoys = logistics.convoys.filter(
    (convoy) => convoy.galaxyId === galaxyId && ownerMatches(convoy),
  );
  const outpostStock = Object.values(logistics.outpostStock).filter(
    (stock) => stock.galaxyId === galaxyId && ownerMatches(stock),
  );
  const creditsAtOutposts = roundCredits(
    outpostStock.reduce((total, stock) => total + stock.storedCredits, 0),
  );
  const creditsAtExportCenters = roundCredits(
    depots.reduce((total, depot) => total + depot.storedCredits, 0),
  );
  const creditsInTransit = roundCredits(convoys
    .filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status))
    .reduce((total, convoy) => total + convoy.creditLoad, 0));
  const cutoff = (state.time ?? 0) - config.recentDeliveryWindowMs;
  const recent = logistics.stats.recentDeliveries.filter(
    (delivery) => delivery.at >= cutoff && ownerMatches(delivery),
  );
  const throughputCreditsPerMinute = roundCredits(recent.reduce((sum, delivery) => sum + delivery.credits, 0)
    * (60000 / config.recentDeliveryWindowMs));
  const grossProductionCreditsPerSecond = roundCredits(outpostStock
    .reduce((sum, stock) => sum + (stock.productionCreditsPerSecond ?? 0), 0));
  const onsiteProcessingShare = ownerId == null
    ? 0
    : Math.max(0, Math.min(1,
      Number(techEffects(ownerContext(state, ownerId).techState).onsiteProcessingShare) || 0));
  const statuses = {};
  for (const convoy of convoys) statuses[convoy.status] = (statuses[convoy.status] ?? 0) + 1;
  return {
    galaxyId,
    ownerId,
    nexusCount: discoverTradeNexuses(state, galaxyId, ownerId ?? 'player').length,
    availableNexusCount: discoverTradeNexuses(state, galaxyId, ownerId ?? 'player').filter((nexus) => nexus.available).length,
    depotCount: depots.length,
    operationalDepotCount: depots.filter((depot) => depot.operational).length,
    pausedRouteCount: depots.filter((depot) => depot.routePaused).length,
    activeConvoyRouteCapacity: depots.reduce((total, depot) => total + depot.assemblyBays, 0),
    convoyCount: convoys.length,
    activeConvoyCount: convoys.filter((convoy) => !['delivered', 'intercepted'].includes(convoy.status)).length,
    convoyStatuses: statuses,
    creditsAtOutposts,
    creditsAtExportCenters,
    creditsInTransit,
    storedCredits: roundCredits(creditsAtOutposts + creditsAtExportCenters),
    freighters: ownerId == null ? null : freighterPoolSummary(state, ownerId, config),
    outposts: outpostStock.map((stock) => ({
      id: stock.id,
      systemId: stock.systemId,
      outpostId: stock.outpostId,
      storedCredits: stock.storedCredits,
      capacity: stock.capacity,
      fillRatio: stock.storedCredits / Math.max(1, stock.capacity),
      productionCreditsPerSecond: stock.productionCreditsPerSecond ?? 0,
      physicalProductionCreditsPerSecond: roundCredits(
        (stock.productionCreditsPerSecond ?? 0) * (1 - onsiteProcessingShare),
      ),
      timeUntilFullMs: (stock.productionCreditsPerSecond ?? 0) > 0
        ? Math.max(0, (stock.capacity - stock.storedCredits)
          / ((stock.productionCreditsPerSecond ?? 0) * (1 - onsiteProcessingShare)) * 1000)
        : null,
    })),
    throughputCreditsPerMinute,
    grossProductionCreditsPerSecond,
    physicalProductionCreditsPerSecond: roundCredits(
      grossProductionCreditsPerSecond * (1 - onsiteProcessingShare),
    ),
    onsiteCreditsPerSecond: roundCredits(
      grossProductionCreditsPerSecond * onsiteProcessingShare,
    ),
    onsiteProcessingShare,
    deliveredCredits: ownerId == null
      ? logistics.stats.deliveredCredits
      : logistics.stats.deliveredCreditsByOwner[ownerId] ?? 0,
    producedCredits: logistics.stats.producedCredits,
    onsiteCredits: logistics.stats.onsiteCredits,
    lostCredits: logistics.stats.lostCredits,
    recoveredCredits: logistics.stats.recoveredCredits,
    laneBlockadeCount: logistics.blockades.lanes.filter((key) => key.startsWith(`${galaxyId}:`)).length,
    systemBlockadeCount: logistics.blockades.systems.filter((key) => key.startsWith(`${galaxyId}:`)).length,
  };
}
