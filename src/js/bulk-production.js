// Aggregate bulk production manifests backed by the bounded empire queue.
//
// Bulk orders intentionally retain only aggregate counters and currently active
// queue tickets. A request for hundreds of hulls therefore never expands into
// hundreds of pending queue entries; new tickets are admitted as shipyard slots
// become available.

import { EMPIRE_QUEUE_MAX } from './constants.js';
import {
  cancelQueueItem,
  enqueueProduct,
  listPlayerShipyards,
} from './empire-queue.js';
import { isTechUnlocked } from './tech-web.js';
import {
  PRODUCTION_KIND_BUILDER_DRONE,
  builderDroneOwnedAndQueuedCount,
  normalizeProductionProduct,
  productionProductDefinition,
} from './production-products.js';

const PRIORITY_RANK = Object.freeze({
  emergency: 3,
  high: 2,
  normal: 1,
  low: 0,
});

const PRIORITIES = Object.freeze(['emergency', 'high', 'normal', 'low']);
const DELIVERY_STATUSES = new Set([
  'pending',
  'assigned',
  'in_transit',
  'blocked',
  'delivered',
  'cancelled',
]);

function stateTime(state) {
  return Number.isFinite(state?.time) ? state.time : 0;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) result[key] = cloneValue(entry);
  return result;
}

function integerAtLeast(value, minimum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.floor(number));
}

function nonNegative(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

function idNumber(id, prefix) {
  const match = String(id ?? '').match(new RegExp(`^${prefix}(\\d+)$`));
  return match ? Number(match[1]) : 0;
}

function normalizePriority(priority, errors = null) {
  const candidate = priority ?? 'normal';
  if (Object.hasOwn(PRIORITY_RANK, candidate)) return candidate;
  errors?.push({ code: 'invalid_priority', message: `Unknown priority: ${candidate}` });
  return 'normal';
}

function normalizeAllowedShipyardIds(value, errors = null) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    errors?.push({
      code: 'invalid_shipyard_scope',
      message: 'allowedShipyardIds must be an array or null',
    });
    return null;
  }
  const result = [...new Set(value.filter((id) => typeof id === 'string' && id.length > 0))];
  if (result.length !== value.length) {
    errors?.push({
      code: 'invalid_shipyard_scope',
      message: 'Every allowed shipyard must have a non-empty string id',
    });
  }
  if (result.length === 0) {
    errors?.push({
      code: 'empty_shipyard_scope',
      message: 'Select at least one shipyard or use null for empire-wide scheduling',
    });
  }
  return result;
}

function normalizeRally(value, errors = null) {
  if (value == null || value === 'none') return { type: 'none' };
  if (typeof value === 'string') return { type: 'system', systemId: value };
  if (typeof value !== 'object') {
    errors?.push({ code: 'invalid_rally', message: 'Rally target must be an object' });
    return { type: 'none' };
  }

  const type = value.type ?? value.kind ?? 'none';
  if (type === 'none') return { type: 'none' };
  if (type === 'flagship') return { type: 'flagship' };
  if (type === 'system') {
    if (typeof value.systemId !== 'string' || !value.systemId) {
      errors?.push({ code: 'invalid_rally', message: 'A system rally requires systemId' });
      return { type: 'none' };
    }
    return { type: 'system', systemId: value.systemId };
  }
  if (type === 'fleet' || type === 'existing_fleet') {
    const fleetId = value.fleetId ?? value.id;
    if (typeof fleetId !== 'string' || !fleetId) {
      errors?.push({ code: 'invalid_rally', message: 'A fleet rally requires fleetId' });
      return { type: 'none' };
    }
    return { type: 'fleet', fleetId };
  }

  errors?.push({ code: 'invalid_rally', message: `Unknown rally target: ${type}` });
  return { type: 'none' };
}

function normalizePackaging(value, rally, errors = null) {
  if (value == null || value === 'unassigned' || value === 'none') {
    return { mode: 'unassigned', splitSize: null, fleetId: null };
  }
  const source = typeof value === 'string' ? { mode: value } : value;
  if (!source || typeof source !== 'object') {
    errors?.push({ code: 'invalid_packaging', message: 'Packaging must be an object' });
    return { mode: 'unassigned', splitSize: null, fleetId: null };
  }

  const mode = source.mode ?? source.type;
  if (mode === 'single' || mode === 'single_fleet' || mode === 'new_fleet') {
    return { mode: 'single_fleet', splitSize: null, fleetId: null };
  }
  if (mode === 'split' || mode === 'split_fleets' || mode === 'new_fleets') {
    const splitSize = integerAtLeast(source.splitSize ?? source.size, 1, 40);
    return { mode: 'new_fleets', splitSize, fleetId: null };
  }
  if (mode === 'reinforce' || mode === 'existing_fleet') {
    const fleetId = source.fleetId ?? rally?.fleetId;
    if (typeof fleetId !== 'string' || !fleetId) {
      errors?.push({
        code: 'invalid_packaging',
        message: 'Reinforcement packaging requires a fleetId',
      });
      return { mode: 'unassigned', splitSize: null, fleetId: null };
    }
    return { mode: 'reinforce', splitSize: null, fleetId };
  }

  errors?.push({ code: 'invalid_packaging', message: `Unknown packaging mode: ${mode}` });
  return { mode: 'unassigned', splitSize: null, fleetId: null };
}

function normalizeManifest(value, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ code: 'empty_manifest', message: 'Add at least one production item to the manifest' });
    return [];
  }

  const merged = new Map();
  for (const entry of value) {
    const product = normalizeProductionProduct(entry);
    const quantity = Number(entry?.quantity);
    if (!product.productId) {
      errors.push({ code: 'invalid_product', message: 'Every manifest line requires a production item' });
      continue;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push({
        code: 'invalid_quantity',
        message: `${product.productId} quantity must be a positive integer`,
      });
      continue;
    }
    const key = `${product.kind}:${product.productId}`;
    const existing = merged.get(key) ?? { ...product, quantity: 0 };
    existing.quantity += quantity;
    merged.set(key, existing);
  }
  return [...merged.values()];
}

function activeQueueItems(state) {
  return (state.empireQueue ?? []).filter(
    (item) => item.status === 'pending' || item.status === 'building',
  );
}

function normalizeExistingOrder(order, orderIndex) {
  order.id = typeof order.id === 'string' && order.id ? order.id : `bulk-${orderIndex + 1}`;
  order.name = typeof order.name === 'string' && order.name.trim()
    ? order.name.trim()
    : `Bulk Order ${orderIndex + 1}`;
  order.status = ['active', 'paused', 'cancelling', 'cancelled', 'complete'].includes(order.status)
    ? order.status
    : 'active';
  order.priority = normalizePriority(order.priority);
  order.budgetCap = order.budgetCap == null ? null : nonNegative(order.budgetCap, null);
  order.protectedReserve = nonNegative(order.protectedReserve);
  order.allowedShipyardIds = Array.isArray(order.allowedShipyardIds)
    ? [...new Set(order.allowedShipyardIds)]
    : null;
  order.rally = normalizeRally(order.rally);
  order.packaging = normalizePackaging(order.packaging, order.rally);
  order.linkedCampaignId = order.linkedCampaignId ?? null;
  order.createdAt = Number.isFinite(order.createdAt) ? order.createdAt : 0;
  order.updatedAt = Number.isFinite(order.updatedAt) ? order.updatedAt : order.createdAt;
  order.spent = nonNegative(order.spent);
  order.refunded = nonNegative(order.refunded);
  order.sequenceEnqueued = integerAtLeast(order.sequenceEnqueued, 0, 0);
  order.nextLineIndex = integerAtLeast(order.nextLineIndex, 0, 0);
  order.blockers = Array.isArray(order.blockers) ? order.blockers : [];
  order.tickets = Array.isArray(order.tickets) ? order.tickets : [];
  order.manifest = Array.isArray(order.manifest) ? order.manifest : [];

  order.manifest.forEach((line, lineIndex) => {
    const product = normalizeProductionProduct(line);
    line.id = typeof line.id === 'string' && line.id
      ? line.id
      : `${order.id}-line-${lineIndex + 1}`;
    line.kind = product.kind;
    line.productId = product.productId;
    line.hull = product.hull;
    line.quantity = integerAtLeast(line.quantity, 0, 0);
    line.materialized = integerAtLeast(line.materialized, 0, 0);
    line.completed = integerAtLeast(line.completed, 0, 0);
    line.cancelled = integerAtLeast(line.cancelled, 0, 0);
    line.spent = nonNegative(line.spent);
    line.refunded = nonNegative(line.refunded);
  });
}

/**
 * Initialize and lightly migrate aggregate production state.
 *
 * The returned collections are the same mutable collections stored on state.
 */
export function ensureBulkProductionState(state) {
  if (!state || typeof state !== 'object') throw new TypeError('Bulk production requires game state');
  if (!Array.isArray(state.bulkProductionOrders)) state.bulkProductionOrders = [];
  if (!Array.isArray(state.bulkProductionDeliveries)) state.bulkProductionDeliveries = [];
  if (!state.bulkProductionMeta || typeof state.bulkProductionMeta !== 'object') {
    state.bulkProductionMeta = {};
  }

  state.bulkProductionOrders.forEach(normalizeExistingOrder);
  const meta = state.bulkProductionMeta;
  const maxOrderId = state.bulkProductionOrders.reduce(
    (max, order) => Math.max(max, idNumber(order.id, 'bulk-')),
    0,
  );
  const maxDeliveryId = state.bulkProductionDeliveries.reduce(
    (max, delivery) => Math.max(max, idNumber(delivery.id, 'bulk-delivery-')),
    0,
  );
  meta.nextOrderId = Math.max(integerAtLeast(meta.nextOrderId, 1, 1), maxOrderId + 1);
  meta.nextDeliveryId = Math.max(
    integerAtLeast(meta.nextDeliveryId, 1, 1),
    maxDeliveryId + 1,
  );
  if (!meta.schedulerCursor || typeof meta.schedulerCursor !== 'object') meta.schedulerCursor = {};
  for (const priority of PRIORITIES) {
    meta.schedulerCursor[priority] = integerAtLeast(meta.schedulerCursor[priority], 0, 0);
  }

  // Recover active ticket metadata from tagged queue items after a save migration.
  for (const item of activeQueueItems(state)) {
    if (!item.bulkOrderId || !item.bulkLineId) continue;
    const order = state.bulkProductionOrders.find((candidate) => candidate.id === item.bulkOrderId);
    if (!order || order.tickets.some((ticket) => ticket.queueItemId === item.id)) continue;
    order.tickets.push({
      queueItemId: item.id,
      lineId: item.bulkLineId,
      kind: normalizeProductionProduct(item).kind,
      productId: normalizeProductionProduct(item).productId,
      hull: item.hull,
      costPaid: nonNegative(item.costPaid),
      status: item.status,
      delivery: cloneValue(item.delivery ?? null),
      enqueuedAt: item.enqueuedAt ?? stateTime(state),
    });
  }

  return {
    orders: state.bulkProductionOrders,
    deliveries: state.bulkProductionDeliveries,
    meta,
  };
}

function productionCapacity(state, allowedShipyardIds = null) {
  const allYards = listPlayerShipyards(state);
  const allowed = allowedShipyardIds == null ? null : new Set(allowedShipyardIds);
  const eligibleYards = allowed == null
    ? allYards
    : allYards.filter((yard) => allowed.has(yard.shipyardId));
  const queue = activeQueueItems(state);
  const pendingCount = queue.filter((item) => item.status === 'pending').length;
  const freeSlots = eligibleYards.reduce(
    (total, yard) => total + Math.max(0, yard.slots - yard.activeBuilds),
    0,
  );
  const queueCapacity = Math.max(0, EMPIRE_QUEUE_MAX - queue.length);
  const materializationCapacity = Math.max(0, Math.min(
    queueCapacity,
    freeSlots - pendingCount,
  ));
  return {
    allYards,
    eligibleYards,
    activeQueueCount: queue.length,
    pendingCount,
    freeSlots,
    queueCapacity,
    materializationCapacity,
  };
}

/** Return validation, cost, capacity, and affordability without creating an order. */
export function previewBulkProductionOrder(state, input = {}) {
  ensureBulkProductionState(state);
  const errors = [];
  const warnings = [];
  const manifest = normalizeManifest(input.manifest, errors);
  const priority = normalizePriority(input.priority, errors);
  const allowedShipyardIds = normalizeAllowedShipyardIds(input.allowedShipyardIds, errors);
  const rally = normalizeRally(input.rally, errors);
  const packaging = normalizePackaging(input.packaging, rally, errors);

  let budgetCap = null;
  if (input.budgetCap != null && input.budgetCap !== '') {
    const numeric = Number(input.budgetCap);
    if (!Number.isFinite(numeric) || numeric < 0) {
      errors.push({ code: 'invalid_budget', message: 'Budget cap must be zero or greater' });
    } else {
      budgetCap = numeric;
    }
  }
  const reserveNumber = Number(input.protectedReserve ?? 0);
  const protectedReserve = Number.isFinite(reserveNumber) && reserveNumber >= 0
    ? reserveNumber
    : 0;
  if (!Number.isFinite(reserveNumber) || reserveNumber < 0) {
    errors.push({
      code: 'invalid_reserve',
      message: 'Protected reserve must be zero or greater',
    });
  }

  const costedManifest = manifest.map((line) => {
    const definition = productionProductDefinition(state, line);
    const unitCost = definition.cost;
    if (unitCost == null) {
      errors.push({ code: 'unknown_product', message: `Unknown production item: ${line.productId}` });
    } else if (!definition.unlocked) {
      errors.push({ code: 'locked_product', message: `${definition.label} is not unlocked` });
    }
    return {
      ...line,
      unitCost,
      lineCost: unitCost == null ? null : unitCost * line.quantity,
    };
  });

  const totalQuantity = costedManifest.reduce((total, line) => total + line.quantity, 0);
  const droneQuantity = costedManifest
    .filter((line) => line.kind === PRODUCTION_KIND_BUILDER_DRONE)
    .reduce((total, line) => total + line.quantity, 0);
  if (droneQuantity > 0) {
    const droneCount = builderDroneOwnedAndQueuedCount(state);
    if (droneCount.total + droneQuantity > droneCount.capacity) {
      errors.push({
        code: 'builder_drone_cap',
        message: `Construction drone order exceeds the ${droneCount.capacity}-drone cap`,
      });
    }
  }
  const totalCost = costedManifest.reduce(
    (total, line) => total + (line.lineCost ?? 0),
    0,
  );
  if (totalQuantity > 1 && !isTechUnlocked(state, 'mil_parallel_dock')) {
    errors.push({
      code: 'bulk_tech_locked',
      message: 'Parallel Docking is required for quantity-based production',
    });
  }
  const advancedScheduling = costedManifest.length > 1
    || allowedShipyardIds == null
    || rally.type !== 'none'
    || packaging.mode !== 'unassigned';
  if (advancedScheduling && !isTechUnlocked(state, 'eco_industrial_automation')) {
    errors.push({
      code: 'automation_tech_locked',
      message: 'Industrial Automation is required for empire-wide manifests and delivery',
    });
  }

  const capacity = productionCapacity(state, allowedShipyardIds);
  if (capacity.allYards.length === 0) {
    errors.push({ code: 'no_shipyards', message: 'No operational player shipyard is available' });
  }
  if (allowedShipyardIds != null) {
    const existing = new Set(capacity.allYards.map((yard) => yard.shipyardId));
    const missing = allowedShipyardIds.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      errors.push({
        code: 'shipyard_unavailable',
        message: `Unavailable allowed shipyard${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      });
    }
  }

  if (budgetCap != null && budgetCap < totalCost) {
    warnings.push({
      code: 'budget_shortfall',
      message: `Budget covers ${budgetCap} of the projected ${totalCost} credits`,
    });
  }
  if ((state.credits ?? 0) - protectedReserve < totalCost) {
    warnings.push({
      code: 'credit_shortfall',
      message: 'Current spendable credits cannot fund the full manifest',
    });
  }
  if (capacity.materializationCapacity === 0 && capacity.allYards.length > 0) {
    warnings.push({
      code: 'capacity_wait',
      message: 'The order will wait for empire queue or shipyard capacity',
    });
  }

  let materializableNow = 0;
  let creditsAvailable = Math.max(0, (state.credits ?? 0) - protectedReserve);
  let budgetAvailable = budgetCap == null ? Infinity : budgetCap;
  const remaining = costedManifest.map((line) => line.quantity);
  let lineIndex = 0;
  while (materializableNow < capacity.materializationCapacity && remaining.some((count) => count > 0)) {
    let selected = -1;
    for (let offset = 0; offset < remaining.length; offset += 1) {
      const candidate = (lineIndex + offset) % remaining.length;
      const cost = costedManifest[candidate].unitCost;
      if (remaining[candidate] > 0 && cost != null && cost <= creditsAvailable && cost <= budgetAvailable) {
        selected = candidate;
        break;
      }
    }
    if (selected < 0) break;
    const cost = costedManifest[selected].unitCost;
    remaining[selected] -= 1;
    creditsAvailable -= cost;
    budgetAvailable -= cost;
    materializableNow += 1;
    lineIndex = (selected + 1) % remaining.length;
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    config: {
      name: typeof input.name === 'string' && input.name.trim()
        ? input.name.trim()
        : 'Bulk Production Order',
      manifest: costedManifest.map(({ kind, productId, hull, quantity }) => ({
        kind,
        productId,
        hull,
        quantity,
      })),
      priority,
      budgetCap,
      protectedReserve,
      allowedShipyardIds,
      rally,
      packaging,
      linkedCampaignId: input.linkedCampaignId ?? null,
    },
    totalQuantity,
    totalCost,
    materializableNow,
    capacity: {
      operationalShipyards: capacity.allYards.length,
      eligibleShipyards: capacity.eligibleYards.map((yard) => ({ ...yard })),
      activeQueueCount: capacity.activeQueueCount,
      queueMax: EMPIRE_QUEUE_MAX,
      freeShipyardSlots: capacity.freeSlots,
      availableTickets: capacity.materializationCapacity,
    },
  };
}

/** Create one aggregate manifest. No per-hull queue tickets are created here. */
export function createBulkProductionOrder(state, input = {}) {
  const preview = previewBulkProductionOrder(state, input);
  if (!preview.ok) {
    return {
      ok: false,
      reason: preview.errors[0]?.message ?? 'Invalid bulk production order',
      errors: preview.errors,
      preview,
    };
  }

  const { orders, meta } = ensureBulkProductionState(state);
  const id = `bulk-${meta.nextOrderId++}`;
  const createdAt = stateTime(state);
  const config = preview.config;
  const order = {
    id,
    name: config.name,
    status: 'active',
    priority: config.priority,
    budgetCap: config.budgetCap,
    protectedReserve: config.protectedReserve,
    allowedShipyardIds: cloneValue(config.allowedShipyardIds),
    rally: cloneValue(config.rally),
    packaging: cloneValue(config.packaging),
    linkedCampaignId: config.linkedCampaignId,
    createdAt,
    updatedAt: createdAt,
    pausedAt: null,
    cancelledAt: null,
    completedAt: null,
    spent: 0,
    refunded: 0,
    sequenceEnqueued: 0,
    nextLineIndex: 0,
    blockers: [],
    tickets: [],
    manifest: config.manifest.map((line, index) => ({
      id: `${id}-line-${index + 1}`,
      kind: line.kind,
      productId: line.productId,
      hull: line.hull,
      quantity: line.quantity,
      materialized: 0,
      completed: 0,
      cancelled: 0,
      spent: 0,
      refunded: 0,
    })),
  };
  orders.push(order);
  return { ok: true, order, preview, summary: summarizeOrder(state, order) };
}

function addBlocker(order, state, code, message, details = {}) {
  if (order.blockers.some((blocker) => blocker.code === code)) return;
  order.blockers.push({ code, message, at: stateTime(state), ...cloneValue(details) });
}

function ticketsForLine(order, lineId) {
  return order.tickets.filter((ticket) => ticket.lineId === lineId);
}

function remainingForLine(order, line) {
  return Math.max(
    0,
    line.quantity - line.completed - line.cancelled - ticketsForLine(order, line.id).length,
  );
}

function orderRemaining(order) {
  return order.manifest.reduce((total, line) => total + remainingForLine(order, line), 0);
}

function nextLineWithDemand(order) {
  if (order.manifest.length === 0) return null;
  const start = order.nextLineIndex % order.manifest.length;
  for (let offset = 0; offset < order.manifest.length; offset += 1) {
    const index = (start + offset) % order.manifest.length;
    const line = order.manifest[index];
    if (remainingForLine(order, line) > 0) return { line, index };
  }
  return null;
}

function createSchedulerContext(state) {
  const yards = listPlayerShipyards(state);
  const queue = activeQueueItems(state);
  const freeByYard = new Map();
  const pendingPinnedByYard = new Map();
  for (const yard of yards) {
    freeByYard.set(yard.shipyardId, Math.max(0, yard.slots - yard.activeBuilds));
  }
  for (const item of queue) {
    if (item.status !== 'pending' || !item.pinnedShipyardId) continue;
    pendingPinnedByYard.set(
      item.pinnedShipyardId,
      (pendingPinnedByYard.get(item.pinnedShipyardId) ?? 0) + 1,
    );
  }
  const pendingCount = queue.filter((item) => item.status === 'pending').length;
  const freeSlots = [...freeByYard.values()].reduce((total, count) => total + count, 0);
  return {
    yards,
    freeByYard,
    pendingPinnedByYard,
    globalCapacity: Math.max(0, Math.min(
      EMPIRE_QUEUE_MAX - queue.length,
      freeSlots - pendingCount,
    )),
    queueWasFull: queue.length >= EMPIRE_QUEUE_MAX,
  };
}

function chooseAllowedShipyard(order, context) {
  if (order.allowedShipyardIds == null) return { ok: true, shipyardId: null };
  const allowed = new Set(order.allowedShipyardIds);
  const candidates = context.yards
    .filter((yard) => allowed.has(yard.shipyardId))
    .map((yard) => ({
      ...yard,
      reservedFree: (context.freeByYard.get(yard.shipyardId) ?? 0)
        - (context.pendingPinnedByYard.get(yard.shipyardId) ?? 0),
    }))
    .filter((yard) => yard.reservedFree > 0)
    .sort((a, b) => b.reservedFree - a.reservedFree
      || a.activeBuilds - b.activeBuilds
      || a.shipyardId.localeCompare(b.shipyardId));
  if (candidates.length === 0) {
    return { ok: false, reason: 'No selected shipyard has a free production slot' };
  }
  return { ok: true, shipyardId: candidates[0].shipyardId };
}

function deliveryMetadata(order) {
  const sequence = order.sequenceEnqueued + 1;
  const splitSize = order.packaging.mode === 'new_fleets'
    ? Math.max(1, order.packaging.splitSize ?? 40)
    : null;
  return {
    rally: cloneValue(order.rally),
    packaging: cloneValue(order.packaging),
    linkedCampaignId: order.linkedCampaignId,
    sequence,
    groupIndex: splitSize == null ? 0 : Math.floor((sequence - 1) / splitSize),
    status: 'awaiting_completion',
  };
}

function materializeOne(state, order, context) {
  const selected = nextLineWithDemand(order);
  if (!selected) return { ok: false, done: true };
  const { line, index } = selected;
  const definition = productionProductDefinition(state, line);
  if (!definition.unlocked) {
    addBlocker(order, state, 'locked_product', `${definition.label} is no longer unlocked`);
    return { ok: false };
  }
  const cost = definition.cost;
  if (cost == null) {
    addBlocker(order, state, 'unknown_product', `Unknown production item: ${line.productId}`);
    return { ok: false };
  }
  if (order.budgetCap != null && order.spent + cost > order.budgetCap) {
    addBlocker(order, state, 'budget_cap', 'Order budget cap reached', {
      required: cost,
      remaining: Math.max(0, order.budgetCap - order.spent),
    });
    return { ok: false };
  }
  if ((state.credits ?? 0) - cost < order.protectedReserve) {
    addBlocker(order, state, 'protected_reserve', 'Protected credit reserve reached', {
      required: cost,
      credits: state.credits ?? 0,
      protectedReserve: order.protectedReserve,
    });
    return { ok: false };
  }
  const yard = chooseAllowedShipyard(order, context);
  if (!yard.ok) {
    addBlocker(order, state, 'shipyard_capacity', yard.reason);
    return { ok: false };
  }

  const result = enqueueProduct(state, line, { reservedByBulkOrder: order.id });
  if (!result.ok) {
    const reason = result.reason ?? 'Empire queue rejected the hull';
    const code = /queue full/i.test(reason)
      ? 'queue_full'
      : (/credit/i.test(reason) ? 'insufficient_credits' : 'enqueue_failed');
    addBlocker(order, state, code, reason);
    return { ok: false };
  }

  const item = result.item;
  const delivery = deliveryMetadata(order);
  if (yard.shipyardId) item.pinnedShipyardId = yard.shipyardId;
  item.bulkOrderId = order.id;
  item.bulkLineId = line.id;
  item.linkedCampaignId = order.linkedCampaignId;
  item.delivery = cloneValue(delivery);
  order.tickets.push({
    queueItemId: item.id,
    lineId: line.id,
    kind: line.kind,
    productId: line.productId,
    hull: line.hull,
    costPaid: item.costPaid ?? cost,
    status: item.status,
    delivery: cloneValue(delivery),
    enqueuedAt: item.enqueuedAt,
  });
  line.materialized += 1;
  line.spent += item.costPaid ?? cost;
  order.spent += item.costPaid ?? cost;
  order.sequenceEnqueued += 1;
  order.nextLineIndex = (index + 1) % order.manifest.length;
  order.updatedAt = stateTime(state);
  context.globalCapacity -= 1;
  if (yard.shipyardId) {
    context.pendingPinnedByYard.set(
      yard.shipyardId,
      (context.pendingPinnedByYard.get(yard.shipyardId) ?? 0) + 1,
    );
  }
  return {
    ok: true,
    orderId: order.id,
    lineId: line.id,
    queueItemId: item.id,
    kind: line.kind,
    productId: line.productId,
    hull: line.hull,
    cost: item.costPaid ?? cost,
    pinnedShipyardId: yard.shipyardId,
  };
}

/**
 * Admit aggregate demand into currently available empire-queue/shipyard slots.
 * Equal-priority orders and manifest lines are round-robin scheduled.
 */
export function tickBulkProduction(state) {
  const { orders, meta } = ensureBulkProductionState(state);
  const materialized = [];
  if (state.paused) {
    return { materialized, materializedCount: 0, spent: 0, blocked: [], summary: bulkProductionSummary(state) };
  }

  for (const order of orders) {
    if (order.status !== 'active') continue;
    order.blockers = [];
    if (orderRemaining(order) === 0 && order.tickets.length === 0) {
      order.status = 'complete';
      order.completedAt = stateTime(state);
      order.updatedAt = stateTime(state);
    }
  }

  const context = createSchedulerContext(state);
  if (context.globalCapacity > 0) {
    for (const priority of PRIORITIES) {
      const tier = orders
        .filter((order) => order.status === 'active'
          && order.priority === priority
          && orderRemaining(order) > 0)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      if (tier.length === 0) continue;
      let cursor = meta.schedulerCursor[priority] % tier.length;
      let withoutProgress = 0;
      while (context.globalCapacity > 0 && withoutProgress < tier.length) {
        const order = tier[cursor];
        cursor = (cursor + 1) % tier.length;
        const result = materializeOne(state, order, context);
        if (result.ok) {
          materialized.push(result);
          withoutProgress = 0;
        } else {
          withoutProgress += 1;
        }
      }
      meta.schedulerCursor[priority] = cursor;
      if (context.globalCapacity <= 0) break;
    }
  }

  for (const order of orders) {
    if (order.status !== 'active' || orderRemaining(order) === 0 || order.blockers.length > 0) continue;
    if (context.globalCapacity <= 0) {
      addBlocker(
        order,
        state,
        context.queueWasFull ? 'queue_full' : 'capacity_wait',
        context.queueWasFull
          ? `Empire queue full (max ${EMPIRE_QUEUE_MAX})`
          : 'Waiting for shipyard production capacity',
      );
    }
  }

  const blocked = orders
    .filter((order) => order.blockers.length > 0)
    .map((order) => ({ orderId: order.id, blockers: cloneValue(order.blockers) }));
  return {
    materialized,
    materializedCount: materialized.length,
    spent: materialized.reduce((total, entry) => total + entry.cost, 0),
    blocked,
    summary: bulkProductionSummary(state),
  };
}

function findOrder(state, orderId) {
  ensureBulkProductionState(state);
  return state.bulkProductionOrders.find((order) => order.id === orderId) ?? null;
}

export function pauseBulkProductionOrder(state, orderId) {
  const order = findOrder(state, orderId);
  if (!order) return { ok: false, reason: 'No such bulk production order' };
  if (order.status !== 'active') return { ok: false, reason: `Order is ${order.status}` };
  order.status = 'paused';
  order.pausedAt = stateTime(state);
  order.updatedAt = stateTime(state);
  order.blockers = [];
  return { ok: true, orderId, status: order.status };
}

export function resumeBulkProductionOrder(state, orderId) {
  const order = findOrder(state, orderId);
  if (!order) return { ok: false, reason: 'No such bulk production order' };
  if (order.status !== 'paused') return { ok: false, reason: `Order is ${order.status}` };
  order.status = 'active';
  order.pausedAt = null;
  order.updatedAt = stateTime(state);
  order.blockers = [];
  return { ok: true, orderId, status: order.status };
}

/** Cancel unstarted demand and refund linked pending queue tickets. Active builds finish. */
export function cancelBulkProductionOrder(state, orderId) {
  const order = findOrder(state, orderId);
  if (!order) return { ok: false, reason: 'No such bulk production order' };
  if (order.status === 'cancelled' || order.status === 'complete') {
    return { ok: false, reason: `Order is already ${order.status}` };
  }

  let refunded = 0;
  const retainedTickets = [];
  for (const ticket of order.tickets) {
    const queueItem = (state.empireQueue ?? []).find((item) => item.id === ticket.queueItemId);
    if (queueItem?.status === 'pending') {
      const result = cancelQueueItem(state, queueItem.id);
      if (result.ok) {
        const amount = result.refunded ?? ticket.costPaid ?? 0;
        refunded += amount;
        const line = order.manifest.find((candidate) => candidate.id === ticket.lineId);
        if (line) {
          line.refunded += amount;
          line.spent = Math.max(0, line.spent - amount);
        }
        order.refunded += amount;
        order.spent = Math.max(0, order.spent - amount);
        continue;
      }
    }
    ticket.status = queueItem?.status ?? 'awaiting_completion';
    retainedTickets.push(ticket);
  }
  order.tickets = retainedTickets;

  for (const line of order.manifest) {
    const active = ticketsForLine(order, line.id).length;
    line.cancelled = Math.max(0, line.quantity - line.completed - active);
  }
  order.status = retainedTickets.length > 0 ? 'cancelling' : 'cancelled';
  order.cancelledAt = stateTime(state);
  order.updatedAt = stateTime(state);
  order.blockers = [];
  return {
    ok: true,
    orderId,
    status: order.status,
    refunded,
    activeBuilds: retainedTickets.length,
  };
}

function completionSource(state, info) {
  const source = typeof info === 'string' ? { queueItemId: info } : (info ?? {});
  const nested = source.queueItem && typeof source.queueItem === 'object' ? source.queueItem : null;
  const queueItemId = nested?.id
    ?? source.queueItemId
    ?? (source.bulkOrderId ? source.id : null);
  const live = queueItemId
    ? (state.empireQueue ?? []).find((item) => item.id === queueItemId) ?? null
    : null;
  const tagged = nested?.bulkOrderId ? nested : (source.bulkOrderId ? source : live);

  let order = tagged?.bulkOrderId
    ? state.bulkProductionOrders.find((candidate) => candidate.id === tagged.bulkOrderId) ?? null
    : null;
  let ticket = null;
  if (order && queueItemId) {
    ticket = order.tickets.find((candidate) => candidate.queueItemId === queueItemId) ?? null;
  }
  if (!ticket && queueItemId) {
    for (const candidate of state.bulkProductionOrders) {
      const found = candidate.tickets.find((entry) => entry.queueItemId === queueItemId);
      if (!found) continue;
      order = candidate;
      ticket = found;
      break;
    }
  }
  return { source, tagged, queueItemId, order, ticket };
}

/**
 * Convert one completed tagged queue ticket into aggregate progress plus a
 * pending delivery record. The caller remains responsible for actual routing.
 */
export function recordBulkShipCompletion(state, queueItemOrCompletedInfo, ship = null, drone = null) {
  const { deliveries, meta } = ensureBulkProductionState(state);
  const resolved = completionSource(state, queueItemOrCompletedInfo);
  const { source, tagged, queueItemId, order, ticket } = resolved;
  if (!order || !queueItemId) {
    return { ok: false, reason: 'Completion is not linked to a bulk production order' };
  }

  const duplicate = deliveries.find((delivery) => delivery.queueItemId === queueItemId);
  if (duplicate) return { ok: true, duplicate: true, delivery: cloneValue(duplicate) };

  const lineId = tagged?.bulkLineId ?? ticket?.lineId;
  const line = order.manifest.find((candidate) => candidate.id === lineId);
  if (!line) return { ok: false, reason: 'Bulk manifest line not found' };

  order.tickets = order.tickets.filter((candidate) => candidate.queueItemId !== queueItemId);
  line.completed = Math.min(line.quantity, line.completed + 1);
  order.updatedAt = stateTime(state);
  const metadata = cloneValue(tagged?.delivery ?? ticket?.delivery ?? deliveryMetadata(order));
  const product = normalizeProductionProduct(source.productId || source.kind
    ? source
    : (tagged ?? ticket ?? line));
  const delivery = {
    id: `bulk-delivery-${meta.nextDeliveryId++}`,
    bulkOrderId: order.id,
    bulkLineId: line.id,
    queueItemId,
    linkedCampaignId: order.linkedCampaignId,
    kind: product.kind,
    productId: product.productId,
    hull: ship?.hull ?? product.hull,
    shipId: ship?.id ?? source.shipId ?? null,
    scoutId: source.scoutId ?? null,
    droneId: drone?.id ?? source.droneId ?? null,
    rally: cloneValue(metadata.rally ?? order.rally),
    packaging: cloneValue(metadata.packaging ?? order.packaging),
    sequence: metadata.sequence ?? line.completed,
    groupIndex: metadata.groupIndex ?? 0,
    groupKey: `${order.id}-group-${(metadata.groupIndex ?? 0) + 1}`,
    status: 'pending',
    assignedFleetId: null,
    blockedReason: null,
    createdAt: stateTime(state),
    updatedAt: stateTime(state),
    deliveredAt: null,
  };
  deliveries.push(delivery);
  if (ship && typeof ship === 'object') {
    ship.bulkOrderId = order.id;
    ship.bulkDeliveryId = delivery.id;
  }
  if (drone && typeof drone === 'object') {
    drone.bulkOrderId = order.id;
    drone.bulkDeliveryId = delivery.id;
    drone.strategicCampaignId = order.linkedCampaignId ?? drone.strategicCampaignId ?? null;
  }

  const resolvedCount = order.manifest.reduce(
    (total, manifestLine) => total + manifestLine.completed + manifestLine.cancelled,
    0,
  );
  const totalCount = order.manifest.reduce((total, manifestLine) => total + manifestLine.quantity, 0);
  if (order.tickets.length === 0 && resolvedCount >= totalCount) {
    order.status = order.status === 'cancelling' || order.manifest.some((entry) => entry.cancelled > 0)
      ? 'cancelled'
      : 'complete';
    order.completedAt = order.status === 'complete' ? stateTime(state) : null;
  }

  return {
    ok: true,
    orderId: order.id,
    lineId: line.id,
    status: order.status,
    delivery: cloneValue(delivery),
    summary: summarizeOrder(state, order),
  };
}

/** Update delivery/rally progress after the fleet-routing layer acts on it. */
export function setBulkDeliveryStatus(state, deliveryId, status, details = {}) {
  ensureBulkProductionState(state);
  if (!DELIVERY_STATUSES.has(status)) return { ok: false, reason: `Invalid delivery status: ${status}` };
  const delivery = state.bulkProductionDeliveries.find((candidate) => candidate.id === deliveryId);
  if (!delivery) return { ok: false, reason: 'No such bulk delivery' };
  delivery.status = status;
  delivery.updatedAt = stateTime(state);
  if (Object.hasOwn(details, 'assignedFleetId')) delivery.assignedFleetId = details.assignedFleetId;
  if (Object.hasOwn(details, 'systemId')) delivery.systemId = details.systemId;
  if (Object.hasOwn(details, 'blockedReason')) delivery.blockedReason = details.blockedReason;
  if (Object.hasOwn(details, 'reason')) delivery.blockedReason = details.reason;
  if (status !== 'blocked') delivery.blockedReason = null;
  if (status === 'delivered') delivery.deliveredAt = stateTime(state);
  return { ok: true, delivery: cloneValue(delivery) };
}

export function listPendingBulkDeliveries(state, { linkedCampaignId = undefined } = {}) {
  ensureBulkProductionState(state);
  return state.bulkProductionDeliveries
    .filter((delivery) => delivery.status !== 'delivered' && delivery.status !== 'cancelled')
    .filter((delivery) => linkedCampaignId === undefined
      || delivery.linkedCampaignId === linkedCampaignId)
    .map((delivery) => cloneValue(delivery));
}

function summarizeOrder(state, order) {
  const queueById = new Map((state.empireQueue ?? []).map((item) => [item.id, item]));
  const lines = order.manifest.map((line) => {
    const tickets = ticketsForLine(order, line.id);
    const pending = tickets.filter((ticket) => queueById.get(ticket.queueItemId)?.status === 'pending').length;
    const building = tickets.filter((ticket) => queueById.get(ticket.queueItemId)?.status === 'building').length;
    return {
      id: line.id,
      kind: line.kind,
      productId: line.productId,
      hull: line.hull,
      quantity: line.quantity,
      materialized: line.materialized,
      completed: line.completed,
      cancelled: line.cancelled,
      activeTickets: tickets.length,
      pending,
      building,
      remaining: remainingForLine(order, line),
      spent: line.spent,
      refunded: line.refunded,
    };
  });
  const counts = lines.reduce((totals, line) => ({
    ordered: totals.ordered + line.quantity,
    materialized: totals.materialized + line.materialized,
    completed: totals.completed + line.completed,
    cancelled: totals.cancelled + line.cancelled,
    activeTickets: totals.activeTickets + line.activeTickets,
    remaining: totals.remaining + line.remaining,
  }), {
    ordered: 0,
    materialized: 0,
    completed: 0,
    cancelled: 0,
    activeTickets: 0,
    remaining: 0,
  });
  const deliveryCounts = {};
  for (const delivery of state.bulkProductionDeliveries ?? []) {
    if (delivery.bulkOrderId !== order.id) continue;
    deliveryCounts[delivery.status] = (deliveryCounts[delivery.status] ?? 0) + 1;
  }
  return {
    id: order.id,
    name: order.name,
    status: order.status === 'active' && order.blockers.length > 0 ? 'blocked' : order.status,
    storedStatus: order.status,
    priority: order.priority,
    priorityRank: PRIORITY_RANK[order.priority],
    budgetCap: order.budgetCap,
    protectedReserve: order.protectedReserve,
    spent: order.spent,
    refunded: order.refunded,
    counts,
    progress: counts.ordered > 0 ? counts.completed / counts.ordered : 1,
    manifest: lines,
    blockers: cloneValue(order.blockers),
    allowedShipyardIds: cloneValue(order.allowedShipyardIds),
    rally: cloneValue(order.rally),
    packaging: cloneValue(order.packaging),
    linkedCampaignId: order.linkedCampaignId,
    deliveryCounts,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** Return one order summary, or the complete aggregate production read model. */
export function bulkProductionSummary(state, orderId = null) {
  const { orders, deliveries } = ensureBulkProductionState(state);
  if (orderId != null) {
    const order = orders.find((candidate) => candidate.id === orderId);
    return order ? summarizeOrder(state, order) : null;
  }
  const orderSummaries = orders.map((order) => summarizeOrder(state, order));
  const totals = orderSummaries.reduce((result, order) => ({
    orders: result.orders + 1,
    ordered: result.ordered + order.counts.ordered,
    materialized: result.materialized + order.counts.materialized,
    completed: result.completed + order.counts.completed,
    cancelled: result.cancelled + order.counts.cancelled,
    activeTickets: result.activeTickets + order.counts.activeTickets,
    remaining: result.remaining + order.counts.remaining,
    spent: result.spent + order.spent,
    refunded: result.refunded + order.refunded,
  }), {
    orders: 0,
    ordered: 0,
    materialized: 0,
    completed: 0,
    cancelled: 0,
    activeTickets: 0,
    remaining: 0,
    spent: 0,
    refunded: 0,
  });
  return {
    orders: orderSummaries,
    totals,
    pendingDeliveries: deliveries
      .filter((delivery) => delivery.status !== 'delivered' && delivery.status !== 'cancelled')
      .map((delivery) => cloneValue(delivery)),
    deliveryCount: deliveries.length,
  };
}

// Short aliases are kept for command/UI callers that model these as order verbs.
export const pauseBulkProduction = pauseBulkProductionOrder;
export const resumeBulkProduction = resumeBulkProductionOrder;
export const cancelBulkProduction = cancelBulkProductionOrder;
