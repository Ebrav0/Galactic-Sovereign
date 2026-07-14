// Pure tactical steering: turn-then-thrust, soft separation, sticky targeting.

import {
  TACTICAL_SHIP_SPEED,
  TACTICAL_SHIP_ACCEL,
  TACTICAL_SHIP_DRAG,
  TACTICAL_TURN_RATE,
  TACTICAL_SEPARATION_RADIUS,
  TACTICAL_SEPARATION_STRENGTH,
  TACTICAL_TARGET_STICK_MS,
  TACTICAL_MOTION_TIERS,
  TACTICAL_MOTION_HULL_TIER,
  TACTICAL_SPATIAL_CELL,
} from './constants.js';

const DEFAULT_TIER = TACTICAL_MOTION_TIERS.escort;

export function hullMotionProfile(hull) {
  const tierId = TACTICAL_MOTION_HULL_TIER[hull] ?? 'escort';
  const tier = TACTICAL_MOTION_TIERS[tierId] ?? DEFAULT_TIER;
  return {
    tier: tierId,
    maxSpeedMult: tier.maxSpeed,
    accelMult: tier.accel,
    turnRateMult: tier.turnRate,
    separationMult: tier.separation,
  };
}

export function ensureUnitMotion(unit) {
  if (!unit || typeof unit !== 'object') return unit;
  if (!Number.isFinite(unit.vx)) unit.vx = 0;
  if (!Number.isFinite(unit.vy)) unit.vy = 0;
  if (!Number.isFinite(unit.heading)) unit.heading = 0;
  if (unit.focusTargetId === undefined) unit.focusTargetId = null;
  if (!Number.isFinite(unit.focusTargetUntil)) unit.focusTargetUntil = 0;
  return unit;
}

/** Shortest signed angle delta in (-π, π]. */
export function shortestAngleDelta(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Turn toward desiredFacing, accelerate along current heading, integrate position.
 * Does not snap heading instantly.
 */
export function steerUnit(unit, desiredFacing, opts = {}) {
  ensureUnitMotion(unit);
  const dt = Math.max(0, opts.dt ?? 0);
  if (dt <= 0) return unit;

  const thrust = clamp(opts.thrust ?? 0, 0, 1);
  const maxSpeed = Math.max(0, opts.maxSpeed ?? TACTICAL_SHIP_SPEED);
  const turnRate = Math.max(0, opts.turnRate ?? TACTICAL_TURN_RATE);
  const accel = Math.max(0, opts.accel ?? TACTICAL_SHIP_ACCEL);
  const drag = Math.max(0, opts.drag ?? TACTICAL_SHIP_DRAG);

  const facing = Number.isFinite(desiredFacing) ? desiredFacing : unit.heading;
  const delta = shortestAngleDelta(unit.heading, facing);
  const maxStep = turnRate * dt;
  unit.heading += clamp(delta, -maxStep, maxStep);

  if (thrust > 0) {
    unit.vx += Math.cos(unit.heading) * accel * thrust * dt;
    unit.vy += Math.sin(unit.heading) * accel * thrust * dt;
  } else if (drag > 0) {
    const damp = Math.exp(-drag * dt);
    unit.vx *= damp;
    unit.vy *= damp;
  }

  const speed = Math.hypot(unit.vx, unit.vy);
  if (speed > maxSpeed && speed > 1e-8) {
    const scale = maxSpeed / speed;
    unit.vx *= scale;
    unit.vy *= scale;
  }

  unit.x += unit.vx * dt;
  unit.y += unit.vy * dt;
  return unit;
}

export function separationRadiusForUnit(unit) {
  const profile = hullMotionProfile(unit?.hull);
  return TACTICAL_SEPARATION_RADIUS * profile.separationMult;
}

function spatialKey(x, y) {
  return `${Math.floor(x / TACTICAL_SPATIAL_CELL)},${Math.floor(y / TACTICAL_SPATIAL_CELL)}`;
}

function neighborsForSeparation(unit, liveUnits, spatialIndex) {
  if (!spatialIndex) return liveUnits;
  const cx = Math.floor(unit.x / TACTICAL_SPATIAL_CELL);
  const cy = Math.floor(unit.y / TACTICAL_SPATIAL_CELL);
  const out = [];
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const cell = spatialIndex.get(`${gx},${gy}`);
      if (cell) out.push(...cell);
    }
  }
  return out;
}

/**
 * Soft ship–ship separation. Structures act as static obstacles.
 * Flagship combat units (skipIds) are not pushed but still repel others.
 */
export function applyShipSeparation(liveUnits, opts = {}) {
  const dt = Math.max(0, opts.dt ?? 0);
  if (dt <= 0 || !liveUnits?.length) return;
  const strength = opts.strength ?? TACTICAL_SEPARATION_STRENGTH;
  const skipIds = opts.skipIds instanceof Set ? opts.skipIds : new Set(opts.skipIds ?? []);
  const getRadius = opts.getRadius ?? separationRadiusForUnit;
  const spatialIndex = opts.spatialIndex ?? null;
  const useIndex = spatialIndex || liveUnits.length >= 40;

  let index = spatialIndex;
  if (useIndex && !index) {
    index = new Map();
    for (const unit of liveUnits) {
      if (!unit || unit.hp <= 0) continue;
      const key = spatialKey(unit.x, unit.y);
      const list = index.get(key) ?? [];
      list.push(unit);
      index.set(key, list);
    }
  }

  for (const unit of liveUnits) {
    if (!unit || unit.hp <= 0) continue;
    if (unit.isStructure || unit.isConvoy) continue;
    if (skipIds.has(unit.id)) continue;
    ensureUnitMotion(unit);

    const ri = getRadius(unit);
    let ax = 0;
    let ay = 0;
    const neighbors = useIndex ? neighborsForSeparation(unit, liveUnits, index) : liveUnits;
    for (const other of neighbors) {
      if (!other || other === unit || other.hp <= 0) continue;
      const rj = getRadius(other);
      const R = ri + rj;
      if (R <= 0) continue;
      let dx = unit.x - other.x;
      let dy = unit.y - other.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= R) continue;
      if (dist < 1e-4) {
        dx = 1;
        dy = 0;
        dist = 1e-4;
      }
      const overlap = 1 - dist / R;
      const push = overlap * overlap * strength;
      ax += (dx / dist) * push;
      ay += (dy / dist) * push;
    }

    if (ax === 0 && ay === 0) continue;
    const dvx = ax * dt;
    const dvy = ay * dt;
    unit.vx += dvx;
    unit.vy += dvy;

    const profile = hullMotionProfile(unit.hull);
    const maxSpeed = (opts.maxSpeedFor?.(unit) ?? (TACTICAL_SHIP_SPEED * profile.maxSpeedMult));
    const speed = Math.hypot(unit.vx, unit.vy);
    if (speed > maxSpeed * 1.15 && speed > 1e-8) {
      const scale = (maxSpeed * 1.15) / speed;
      unit.vx *= scale;
      unit.vy *= scale;
    }
    // Same-frame displacement (impulse applied after steer integrate).
    unit.x += dvx;
    unit.y += dvy;
  }
}

/**
 * Keep focusTargetId sticky until stick window expires, target dies, or leash breaks.
 */
export function resolveStickyTarget(unit, pickTargetFn, opts = {}) {
  ensureUnitMotion(unit);
  const nowMs = opts.nowMs ?? 0;
  const stickMs = opts.stickMs ?? TACTICAL_TARGET_STICK_MS;
  const leashDist = opts.leashDist ?? Infinity;
  const isAlive = opts.isAlive ?? ((t) => t && t.hp > 0);
  const findById = opts.findById;

  if (unit.focusTargetId && findById) {
    const sticky = findById(unit.focusTargetId);
    if (isAlive(sticky)) {
      const dist = Math.hypot((sticky.x ?? 0) - unit.x, (sticky.y ?? 0) - unit.y);
      if (dist <= leashDist && nowMs < (unit.focusTargetUntil ?? 0)) {
        return sticky;
      }
    }
  }

  const next = pickTargetFn?.() ?? null;
  if (next && isAlive(next)) {
    unit.focusTargetId = next.id;
    unit.focusTargetUntil = nowMs + stickMs;
    return next;
  }
  unit.focusTargetId = null;
  unit.focusTargetUntil = 0;
  return null;
}

/** Build steer opts from hull profile + environment / damage multipliers. */
export function motionOptsForUnit(unit, {
  dt,
  envSpeed = 1,
  damageSpeed = 1,
  thrust = 0,
  drag = TACTICAL_SHIP_DRAG,
  speedMult = 1,
} = {}) {
  const profile = hullMotionProfile(unit?.hull);
  const speedScale = envSpeed * damageSpeed * speedMult;
  return {
    dt,
    thrust,
    maxSpeed: TACTICAL_SHIP_SPEED * profile.maxSpeedMult * speedScale,
    turnRate: TACTICAL_TURN_RATE * profile.turnRateMult,
    accel: TACTICAL_SHIP_ACCEL * profile.accelMult * damageSpeed,
    drag,
  };
}

/** Blend two headings by weight toward `toward` (0..1). */
export function blendFacing(from, toward, weight) {
  const w = clamp(weight, 0, 1);
  if (w <= 0) return from;
  if (w >= 1) return toward;
  return from + shortestAngleDelta(from, toward) * w;
}
