// Backward-compatible shipyard product catalog shared by the empire queue,
// aggregate production, Operations UI, and completion bridge.

import {
  BUILDER_DRONE_CAPACITY,
  BUILDER_DRONE_STARTER_COUNT,
  BUILDER_DRONE_PRODUCT_BUILD_MS,
  BUILDER_DRONE_PRODUCT_COST,
} from './constants.js';
import { hullQueueCost, hullStats } from './hull.js';
import { empireQueueHulls, isTechUnlocked } from './tech-web.js';

export const PRODUCTION_KIND_HULL = 'hull';
export const PRODUCTION_KIND_BUILDER_DRONE = 'builder_drone';
export const BUILDER_DRONE_PRODUCT_ID = 'builder_drone';

export function normalizeProductionProduct(value = {}) {
  if (typeof value === 'string') {
    return { kind: PRODUCTION_KIND_HULL, productId: value, hull: value };
  }
  const legacyHull = typeof value?.hull === 'string' ? value.hull.trim() : '';
  const kind = value?.kind ?? value?.productKind ?? (legacyHull ? PRODUCTION_KIND_HULL : null);
  const productId = String(value?.productId ?? value?.id ?? legacyHull ?? '').trim();
  if (kind === PRODUCTION_KIND_BUILDER_DRONE || productId === BUILDER_DRONE_PRODUCT_ID) {
    return {
      kind: PRODUCTION_KIND_BUILDER_DRONE,
      productId: BUILDER_DRONE_PRODUCT_ID,
      hull: null,
    };
  }
  return {
    kind: PRODUCTION_KIND_HULL,
    productId,
    hull: productId,
  };
}

export function productionProductDefinition(state, value) {
  const product = normalizeProductionProduct(value);
  if (product.kind === PRODUCTION_KIND_BUILDER_DRONE) {
    return {
      ...product,
      label: 'Construction Drone',
      cost: BUILDER_DRONE_PRODUCT_COST,
      buildMs: BUILDER_DRONE_PRODUCT_BUILD_MS,
      unlocked: isTechUnlocked(state, 'eco_construction_drones'),
      capacity: BUILDER_DRONE_CAPACITY,
    };
  }
  const stats = hullStats(product.productId);
  return {
    ...product,
    label: product.productId.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '),
    cost: stats ? hullQueueCost(state, product.productId) : null,
    buildMs: stats?.buildMs ?? null,
    unlocked: !!stats && empireQueueHulls(state).includes(product.productId),
    capacity: null,
  };
}

export function listProductionProducts(state) {
  const hulls = empireQueueHulls(state).map((hull) => productionProductDefinition(state, hull));
  if (isTechUnlocked(state, 'eco_construction_drones')) {
    hulls.push(productionProductDefinition(state, {
      kind: PRODUCTION_KIND_BUILDER_DRONE,
      productId: BUILDER_DRONE_PRODUCT_ID,
    }));
  }
  return hulls;
}

export function builderDroneOwnedAndQueuedCount(state) {
  const owned = (state.builderDrones ?? []).length;
  const starterPending = isTechUnlocked(state, 'eco_construction_drones')
    && state.builderDroneStarterGranted !== true
    ? BUILDER_DRONE_STARTER_COUNT
    : 0;
  const directQueued = (state.empireQueue ?? []).filter((item) => {
    if (!['pending', 'building'].includes(item.status)) return false;
    return !item.bulkOrderId
      && normalizeProductionProduct(item).kind === PRODUCTION_KIND_BUILDER_DRONE;
  }).length;
  const aggregateQueued = (state.bulkProductionOrders ?? []).reduce((total, order) => {
    if (['complete', 'cancelled'].includes(order.status)) return total;
    return total + (order.manifest ?? []).reduce((lineTotal, line) => {
      if (normalizeProductionProduct(line).kind !== PRODUCTION_KIND_BUILDER_DRONE) return lineTotal;
      const remaining = Math.max(0, Number(line.quantity ?? 0)
        - Number(line.completed ?? 0) - Number(line.cancelled ?? 0));
      return lineTotal + remaining;
    }, 0);
  }, 0);
  const queued = directQueued + aggregateQueued;
  return {
    owned,
    queued,
    directQueued,
    aggregateQueued,
    starterPending,
    total: owned + starterPending + queued,
    capacity: BUILDER_DRONE_CAPACITY,
  };
}
