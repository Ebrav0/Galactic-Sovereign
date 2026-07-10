// Tactical order, fighter-support, damage, and large-battle contracts.
//
// This module deliberately does not own simulation ticks. Callers validate/apply
// player intent here, then let combat.js consume the resulting battle metadata.

import {
  CARRIER_WING_HULLS,
  HULL_STATS,
  WEAPON_PROFILES,
} from './constants.js';

export const FLEET_ORDER_TYPES = Object.freeze([
  'formation',
  'screen',
  'protect',
  'hold',
  'attack_class',
  'bombard',
  'escort_convoy',
  'rally',
  'emergency_retreat',
]);

export const FORMATION_TYPES = Object.freeze([
  'line',
  'wedge',
  'screen',
  'echelon',
  'column',
  'sphere',
]);

export const TARGET_CLASSES = Object.freeze([
  'fighter',
  'escort',
  'capital',
  'carrier',
  'convoy',
  'structure',
]);

const FLEET_ORDER_SET = new Set(FLEET_ORDER_TYPES);
const FORMATION_SET = new Set(FORMATION_TYPES);
const TARGET_CLASS_SET = new Set(TARGET_CLASSES);
const FIGHTER_HULL_SET = new Set(CARRIER_WING_HULLS);
const CARRIER_HULL_SET = new Set(['light_carrier', 'fleet_carrier', 'super_carrier']);
const CAPITAL_HULL_SET = new Set([
  'cruiser', 'battleship', 'dreadnought', 'command_cruiser',
  'hero_flagship', 'flagship',
]);
const CONVOY_HULL_SET = new Set(['light_hauler', 'bulk_freighter', 'armored_convoy']);
const SHIELD_FACINGS = Object.freeze(['front', 'starboard', 'aft', 'port']);

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function wholeNumber(value, fallback = 0) {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function round6(value) {
  return Math.round(finiteNumber(value) * 1e6) / 1e6;
}

function compareIds(a, b) {
  const aa = String(a ?? '');
  const bb = String(b ?? '');
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function isPoint(value) {
  return value != null && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function cleanPoint(value) {
  return isPoint(value) ? { x: round6(value.x), y: round6(value.y) } : null;
}

function orderError(code, field, message) {
  return { code, field, message };
}

function contextUnits(context) {
  return context.units ?? context.battle?.units ?? [];
}

function unitById(context, id) {
  return contextUnits(context).find((unit) => String(unit.id) === String(id)) ?? null;
}

function idAllowed(id, ids) {
  if (ids == null) return true;
  const set = ids instanceof Set ? ids : new Set(ids);
  return set.has(id);
}

/**
 * Convert an external order into the canonical, serializable wire shape.
 * Unknown fields are dropped so saves and advisor proposals remain compact.
 */
export function normalizeFleetOrder(order = {}, context = {}) {
  const subjectIds = [...new Set((order.subjectIds ?? []).map(String))].sort(compareIds);
  const normalized = {
    type: String(order.type ?? ''),
    side: String(order.side ?? context.side ?? 'player'),
    groupId: order.groupId == null ? null : String(order.groupId),
    fleetId: order.fleetId == null ? null : String(order.fleetId),
    subjectIds,
    targetId: order.targetId == null ? null : String(order.targetId),
    targetClass: order.targetClass == null ? null : String(order.targetClass),
    convoyId: order.convoyId == null ? null : String(order.convoyId),
    destinationId: order.destinationId == null ? null : String(order.destinationId),
    formation: order.formation == null ? null : String(order.formation),
    point: cleanPoint(order.point),
    radius: order.radius == null ? null : round6(nonNegative(order.radius)),
    priority: order.priority == null ? 0 : Math.trunc(finiteNumber(order.priority)),
  };
  return normalized;
}

/** Validate an order without changing game or battle state. */
export function validateFleetOrder(order, context = {}) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    const errors = [orderError('ORDER_REQUIRED', 'order', 'Order must be an object')];
    return { ok: false, reason: errors[0].message, errors, order: null };
  }

  const normalized = normalizeFleetOrder(order, context);
  const errors = [];

  if (!FLEET_ORDER_SET.has(normalized.type)) {
    errors.push(orderError(
      'UNKNOWN_ORDER_TYPE',
      'type',
      `Unknown fleet order: ${normalized.type || '(empty)'}`,
    ));
  }
  if (!normalized.side) {
    errors.push(orderError('SIDE_REQUIRED', 'side', 'Order side is required'));
  }
  if (normalized.radius != null && normalized.radius <= 0) {
    errors.push(orderError('INVALID_RADIUS', 'radius', 'Order radius must be greater than zero'));
  }

  if (normalized.subjectIds.length && contextUnits(context).length) {
    for (const id of normalized.subjectIds) {
      const unit = unitById(context, id);
      if (!unit || unit.hp <= 0) {
        errors.push(orderError('INVALID_SUBJECT', 'subjectIds', `Unit ${id} is missing or destroyed`));
      } else if (String(unit.side ?? normalized.side) !== normalized.side) {
        errors.push(orderError('SUBJECT_NOT_OWNED', 'subjectIds', `Unit ${id} is not on order side`));
      }
    }
  }

  if (context.ownedUnitIds != null) {
    for (const id of normalized.subjectIds) {
      if (!idAllowed(id, context.ownedUnitIds)) {
        errors.push(orderError('SUBJECT_NOT_OWNED', 'subjectIds', `Unit ${id} is not controllable`));
      }
    }
  }

  switch (normalized.type) {
    case 'formation':
      if (!FORMATION_SET.has(normalized.formation)) {
        errors.push(orderError('INVALID_FORMATION', 'formation', 'A supported formation is required'));
      }
      break;
    case 'screen':
    case 'protect': {
      if (!normalized.targetId) {
        errors.push(orderError('TARGET_REQUIRED', 'targetId', `${normalized.type} requires a friendly target`));
      }
      const target = normalized.targetId ? unitById(context, normalized.targetId) : null;
      if (target && String(target.side) !== normalized.side) {
        errors.push(orderError('TARGET_NOT_FRIENDLY', 'targetId', `${normalized.type} target must be friendly`));
      }
      break;
    }
    case 'attack_class':
      if (!TARGET_CLASS_SET.has(normalized.targetClass)) {
        errors.push(orderError('INVALID_TARGET_CLASS', 'targetClass', 'A supported target class is required'));
      }
      break;
    case 'bombard': {
      if (!normalized.targetId && !normalized.point) {
        errors.push(orderError('TARGET_REQUIRED', 'targetId', 'Bombard requires a structure target or point'));
      }
      const target = normalized.targetId ? unitById(context, normalized.targetId) : null;
      if (target && classifyCombatTarget(target) !== 'structure') {
        errors.push(orderError('TARGET_NOT_STRUCTURE', 'targetId', 'Bombard target must be a structure'));
      }
      break;
    }
    case 'escort_convoy':
      if (!normalized.convoyId) {
        errors.push(orderError('CONVOY_REQUIRED', 'convoyId', 'Escort requires a convoy'));
      } else if (!idAllowed(normalized.convoyId, context.convoyIds)) {
        errors.push(orderError('INVALID_CONVOY', 'convoyId', 'Convoy is unavailable'));
      }
      break;
    case 'rally':
      if (!normalized.point && !normalized.targetId) {
        errors.push(orderError('RALLY_POINT_REQUIRED', 'point', 'Rally requires a point or friendly anchor'));
      }
      break;
    case 'emergency_retreat':
      if (!normalized.destinationId && !normalized.point) {
        errors.push(orderError(
          'RETREAT_DESTINATION_REQUIRED',
          'destinationId',
          'Emergency retreat requires a destination or extraction point',
        ));
      } else if (normalized.destinationId && !idAllowed(normalized.destinationId, context.destinationIds)) {
        errors.push(orderError('INVALID_DESTINATION', 'destinationId', 'Retreat destination is unavailable'));
      }
      break;
    default:
      // Unknown order already has a precise error above. Hold needs no target.
      break;
  }

  if (normalized.targetId && context.targetIds != null && !idAllowed(normalized.targetId, context.targetIds)) {
    errors.push(orderError('INVALID_TARGET', 'targetId', 'Order target is unavailable'));
  }

  return {
    ok: errors.length === 0,
    reason: errors[0]?.message ?? null,
    errors,
    order: normalized,
  };
}

function orderScope(order) {
  if (order.groupId) return `group:${order.groupId}`;
  if (order.fleetId) return `fleet:${order.fleetId}`;
  if (order.subjectIds.length) return `units:${order.subjectIds.join(',')}`;
  return 'all';
}

/**
 * Validate and record one order on a battle. This is the only order helper that
 * mutates battle state; it records intent but never advances combat.
 */
export function applyFleetOrder(battle, order, context = {}) {
  if (!battle || typeof battle !== 'object' || Array.isArray(battle)) {
    return { ok: false, reason: 'Battle state is required', errors: [
      orderError('BATTLE_REQUIRED', 'battle', 'Battle state is required'),
    ] };
  }

  const result = validateFleetOrder(order, { ...context, battle });
  if (!result.ok) return result;

  const canonical = result.order;
  const sequence = wholeNumber(battle.orderSequence) + 1;
  const scope = orderScope(canonical);
  const slot = canonical.type === 'formation' ? 'formation' : 'directive';
  const key = `${canonical.side}|${scope}|${slot}`;
  const applied = {
    ...canonical,
    scope,
    sequence,
    orderId: `order-${canonical.side}-${sequence}`,
    issuedAt: finiteNumber(context.time, finiteNumber(battle.time, 0)),
  };

  battle.orderSequence = sequence;
  battle.tacticalOrders = battle.tacticalOrders ?? {};
  const previousOrder = battle.tacticalOrders[key] ?? null;
  battle.tacticalOrders[key] = applied;
  return { ok: true, order: applied, orderKey: key, previousOrder, errors: [] };
}

export function activeFleetOrders(battle, side = null) {
  const orders = Object.values(battle?.tacticalOrders ?? {});
  return orders
    .filter((order) => side == null || order.side === side)
    .sort((a, b) => a.sequence - b.sequence || compareIds(a.orderId, b.orderId));
}

/** Canonical class used by orders, weapon scoring, reports, and LOD buckets. */
export function classifyCombatTarget(target) {
  if (!target) return 'escort';
  if (target.isStructure || target.structureType) return 'structure';
  if (target.isConvoy || target.convoyId || CONVOY_HULL_SET.has(target.hull)) return 'convoy';
  if (target.isWing || FIGHTER_HULL_SET.has(target.hull)) return 'fighter';
  if (CARRIER_HULL_SET.has(target.hull)) return 'carrier';
  if (target.isCapital || CAPITAL_HULL_SET.has(target.hull)) return 'capital';
  return 'escort';
}

function weaponMultiplier(attacker, targetClass) {
  const profile = WEAPON_PROFILES[attacker?.weaponProfile] ?? WEAPON_PROFILES.kinetic;
  if (targetClass === 'fighter') return finiteNumber(profile?.antiFighter, 1);
  if (targetClass === 'structure') return finiteNumber(profile?.structure, 1);
  if (targetClass === 'capital' || targetClass === 'carrier' || targetClass === 'convoy') {
    return finiteNumber(profile?.antiCapital, 1);
  }
  return 1;
}

/**
 * Higher scores are better. Every input is state-derived and the final score is
 * rounded, so equal snapshots rank identically across individual and LOD paths.
 */
export function scoreTargetPriority(attacker, target, order = null, context = {}) {
  if (!attacker || !target || target.hp <= 0 || target.side === attacker.side) return -Infinity;

  const cls = classifyCombatTarget(target);
  const profile = WEAPON_PROFILES[attacker.weaponProfile] ?? WEAPON_PROFILES.kinetic ?? {};
  const dx = finiteNumber(target.x) - finiteNumber(attacker.x);
  const dy = finiteNumber(target.y) - finiteNumber(attacker.y);
  const distance = Math.hypot(dx, dy);
  const range = Math.max(1, finiteNumber(context.range, finiteNumber(profile.range, 280)));
  const hp = nonNegative(target.hp);
  const maxHp = Math.max(1, nonNegative(target.maxHp, hp || 1));
  const hpRatio = Math.min(1, hp / maxHp);
  let score = 1000;

  score += weaponMultiplier(attacker, cls) * 900;
  score += distance <= range ? 700 : -Math.min(1200, ((distance - range) / range) * 500);
  score += (1 - hpRatio) * 340;
  score += nonNegative(target.threatLevel) * 40;
  if (target.isObjective) score += 425;

  if (order) {
    if (order.targetId && String(order.targetId) === String(target.id)) score += 10000;
    if (order.type === 'attack_class') {
      score += order.targetClass === cls ? 5000 : -1100;
    }
    if (order.type === 'bombard') score += cls === 'structure' ? 4800 : -5000;
    if ((order.type === 'protect' || order.type === 'screen')
      && target.threatensId != null
      && String(target.threatensId) === String(order.targetId)) score += 4200;
    if (order.type === 'escort_convoy'
      && target.threatensConvoyId != null
      && String(target.threatensConvoyId) === String(order.convoyId)) score += 4600;
    if (order.type === 'emergency_retreat') score -= 100000;
    score += finiteNumber(order.priority) * 10;
  }

  if (attacker.hull === 'interceptor' && cls === 'fighter') score += 1100;
  if (attacker.hull === 'bomber' && (cls === 'capital' || cls === 'carrier' || cls === 'structure')) {
    score += 1250;
  }
  return round6(score);
}

/** Stable score-first ranking, with unit id as the deterministic tie breaker. */
export function rankCombatTargets(attacker, targets, order = null, context = {}) {
  return (targets ?? [])
    .map((target) => ({ target, score: scoreTargetPriority(attacker, target, order, context) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || compareIds(a.target.id, b.target.id));
}

export function selectPriorityTarget(attacker, targets, order = null, context = {}) {
  return rankCombatTargets(attacker, targets, order, context)[0]?.target ?? null;
}

export function createShieldFacings(capacity = 0) {
  const capacities = typeof capacity === 'object' && capacity != null ? capacity : {};
  const fallback = nonNegative(typeof capacity === 'number' ? capacity : capacities.default);
  const facings = {};
  for (const facing of SHIELD_FACINGS) {
    const raw = capacities[facing];
    const max = nonNegative(typeof raw === 'object' ? raw.max : raw, fallback);
    const value = nonNegative(typeof raw === 'object' ? (raw.value ?? raw.current) : raw, max);
    facings[facing] = { value: Math.min(max, value), max };
  }
  return facings;
}

export function normalizeShieldFacings(unit, capacity = null) {
  if (!unit || typeof unit !== 'object') return createShieldFacings(capacity ?? 0);
  const existing = unit.shieldFacings ?? unit.shields;
  const fallback = capacity ?? unit.maxShieldPerFacing ?? unit.maxShield ?? unit.shield ?? 0;
  unit.shieldFacings = createShieldFacings(existing ?? fallback);
  return unit.shieldFacings;
}

function normalizeAngle(angle) {
  let out = finiteNumber(angle);
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}

/** Determine which shield arc faces a source position or incoming world angle. */
export function shieldFacingForHit(target, sourceOrAngle) {
  let incomingAngle;
  if (typeof sourceOrAngle === 'number') {
    incomingAngle = sourceOrAngle;
  } else if (isPoint(sourceOrAngle)) {
    incomingAngle = Math.atan2(sourceOrAngle.y - finiteNumber(target?.y), sourceOrAngle.x - finiteNumber(target?.x));
  } else {
    incomingAngle = finiteNumber(target?.heading);
  }
  const relative = normalizeAngle(incomingAngle - finiteNumber(target?.heading));
  const abs = Math.abs(relative);
  if (abs <= Math.PI / 4) return 'front';
  if (abs >= Math.PI * 3 / 4) return 'aft';
  return relative < 0 ? 'starboard' : 'port';
}

/** Mutate one unit by applying shields first, then hull spillover. */
export function applyFacedDamage(unit, amount, sourceOrFacing = null, options = {}) {
  if (!unit || typeof unit !== 'object') return { ok: false, reason: 'Unit is required' };
  const incoming = nonNegative(amount);
  const facings = normalizeShieldFacings(unit, options.capacity ?? null);
  const facing = SHIELD_FACINGS.includes(sourceOrFacing)
    ? sourceOrFacing
    : (options.facing ?? shieldFacingForHit(unit, sourceOrFacing));
  const shield = facings[facing];
  const shieldAbsorbed = Math.min(shield.value, incoming);
  shield.value = round6(shield.value - shieldAbsorbed);
  const spilloverMultiplier = nonNegative(options.spilloverMultiplier, 1);
  const hullDamage = round6((incoming - shieldAbsorbed) * spilloverMultiplier);
  unit.hp = round6(Math.max(0, nonNegative(unit.hp) - hullDamage));
  unit.damageState = damageStateForUnit(unit);
  return {
    ok: true,
    facing,
    incoming: round6(incoming),
    shieldAbsorbed: round6(shieldAbsorbed),
    hullDamage,
    hp: unit.hp,
    damageState: unit.damageState,
  };
}

export function damageStateForUnit(unit) {
  const hp = nonNegative(unit?.hp);
  const maxHp = Math.max(1, nonNegative(unit?.maxHp, hp || 1));
  if (hp <= 0) return 'destroyed';
  if (unit?.disabled === true || unit?.disabledUntil > finiteNumber(unit?.time, 0)) return 'disabled';
  const ratio = hp / maxHp;
  if (ratio <= 0.2) return 'critical';
  if (ratio <= 0.5) return 'damaged';
  if (ratio < 0.8) return 'scuffed';
  return 'nominal';
}

export function damageStateModifiers(stateOrUnit) {
  const state = typeof stateOrUnit === 'string' ? stateOrUnit : damageStateForUnit(stateOrUnit);
  return {
    nominal: { speed: 1, damage: 1, sensors: 1 },
    scuffed: { speed: 0.96, damage: 0.97, sensors: 0.95 },
    damaged: { speed: 0.78, damage: 0.82, sensors: 0.8 },
    critical: { speed: 0.48, damage: 0.55, sensors: 0.5 },
    disabled: { speed: 0, damage: 0, sensors: 0.2 },
    destroyed: { speed: 0, damage: 0, sensors: 0 },
  }[state] ?? { speed: 1, damage: 1, sensors: 1 };
}

function wingStateFrom(subject) {
  if (!subject || typeof subject !== 'object') return null;
  if ('ready' in subject || 'launched' in subject || 'lost' in subject) return subject;
  return subject.wingState ?? null;
}

/** Extend the existing carrier wingState while preserving ready/lost/launched. */
export function normalizeFighterWingState(subject, options = {}) {
  if (!subject || typeof subject !== 'object') return null;
  let wing = wingStateFrom(subject);
  if (!wing) {
    wing = {};
    subject.wingState = wing;
  }

  const inferredCapacity = wholeNumber(wing.ready)
    + wholeNumber(wing.launched)
    + wholeNumber(wing.lost)
    + wholeNumber(wing.replenishing);
  const capacity = wholeNumber(options.capacity ?? wing.capacity ?? inferredCapacity);
  let ready = Math.min(capacity, wholeNumber(wing.ready, capacity));
  let launched = Math.min(capacity - ready, wholeNumber(wing.launched));
  let replenishing = Math.min(capacity - ready - launched, wholeNumber(wing.replenishing));
  let lost = Math.min(capacity - ready - launched - replenishing, wholeNumber(wing.lost));
  lost += Math.max(0, capacity - ready - launched - replenishing - lost);

  const ammoPerCraft = Math.max(1, nonNegative(options.ammoPerCraft ?? wing.ammoPerCraft, 6));
  const fuelPerCraft = Math.max(1, nonNegative(options.fuelPerCraft ?? wing.fuelPerCraft, 100));
  const liveCraft = ready + launched;
  const maxLiveAmmo = liveCraft * ammoPerCraft;
  const maxLiveFuel = liveCraft * fuelPerCraft;

  wing.capacity = capacity;
  wing.ready = ready;
  wing.launched = launched;
  wing.lost = lost;
  wing.replenishing = replenishing;
  wing.ammoPerCraft = ammoPerCraft;
  wing.fuelPerCraft = fuelPerCraft;
  wing.maxAmmo = capacity * ammoPerCraft;
  wing.maxFuel = capacity * fuelPerCraft;
  wing.ammo = Math.min(maxLiveAmmo, nonNegative(wing.ammo, maxLiveAmmo));
  wing.fuel = Math.min(maxLiveFuel, nonNegative(wing.fuel, maxLiveFuel));
  wing.status = fighterWingStatus(wing);
  return wing;
}

export function createFighterWingState(options = {}) {
  const capacity = wholeNumber(options.capacity);
  return normalizeFighterWingState({
    capacity,
    ready: options.ready ?? capacity,
    launched: options.launched ?? 0,
    lost: options.lost ?? 0,
    replenishing: options.replenishing ?? 0,
    ammo: options.ammo,
    fuel: options.fuel,
    ammoPerCraft: options.ammoPerCraft,
    fuelPerCraft: options.fuelPerCraft,
  }, options);
}

export function fighterWingStatus(subject) {
  const wing = wingStateFrom(subject);
  if (!wing || wholeNumber(wing.capacity) === 0) return 'empty';
  if (wholeNumber(wing.launched) > 0) return 'deployed';
  if (wholeNumber(wing.replenishing) > 0) return 'replenishing';
  if (wholeNumber(wing.ready) === 0) return 'lost';
  if (nonNegative(wing.ammo) < wholeNumber(wing.ready) || nonNegative(wing.fuel) < wholeNumber(wing.ready)) {
    return 'resupply_required';
  }
  if (wholeNumber(wing.lost) > 0) return 'depleted';
  return 'ready';
}

export function fighterWingConservation(subject) {
  const wing = wingStateFrom(subject);
  if (!wing) return { ok: false, capacity: 0, accounted: 0, delta: 0 };
  const capacity = wholeNumber(wing.capacity);
  const accounted = wholeNumber(wing.ready) + wholeNumber(wing.launched)
    + wholeNumber(wing.lost) + wholeNumber(wing.replenishing);
  return { ok: capacity === accounted, capacity, accounted, delta: accounted - capacity };
}

export function launchFighters(subject, requested, options = {}) {
  const wing = normalizeFighterWingState(subject, options);
  if (!wing) return { ok: false, reason: 'Wing state is required', launched: 0 };
  const wanted = wholeNumber(requested);
  const minAmmo = nonNegative(options.minAmmoPerCraft, 1);
  const minFuel = nonNegative(options.minFuelPerCraft, 1);
  const ammoLimited = minAmmo > 0 ? Math.floor(wing.ammo / minAmmo) : wing.ready;
  const fuelLimited = minFuel > 0 ? Math.floor(wing.fuel / minFuel) : wing.ready;
  const launched = Math.min(wanted, wing.ready, ammoLimited, fuelLimited);
  if (launched <= 0) return { ok: false, reason: 'No ready and supplied fighters', launched: 0, wing };
  wing.ready -= launched;
  wing.launched += launched;
  wing.status = fighterWingStatus(wing);
  return { ok: launched === wanted, partial: launched !== wanted, launched, wing };
}

export function consumeFighterSupplies(subject, { ammo = 0, fuel = 0 } = {}) {
  const wing = normalizeFighterWingState(subject);
  if (!wing) return { ok: false, reason: 'Wing state is required' };
  const ammoSpent = Math.min(wing.ammo, nonNegative(ammo));
  const fuelSpent = Math.min(wing.fuel, nonNegative(fuel));
  wing.ammo = round6(wing.ammo - ammoSpent);
  wing.fuel = round6(wing.fuel - fuelSpent);
  wing.status = fighterWingStatus(wing);
  return { ok: ammoSpent === nonNegative(ammo) && fuelSpent === nonNegative(fuel), ammoSpent, fuelSpent, wing };
}

export function recoverFighters(subject, { returned = null, lost = 0 } = {}, options = {}) {
  const wing = normalizeFighterWingState(subject, options);
  if (!wing) return { ok: false, reason: 'Wing state is required' };
  const lossCount = Math.min(wing.launched, wholeNumber(lost));
  const returnCapacity = wing.launched - lossCount;
  const returnCount = Math.min(returnCapacity, returned == null ? returnCapacity : wholeNumber(returned));
  const accounted = returnCount + lossCount;
  if (accounted <= 0) return { ok: false, reason: 'No launched fighters were recovered', returned: 0, lost: 0, wing };
  wing.launched -= accounted;
  wing.ready += returnCount;
  wing.lost += lossCount;
  normalizeFighterWingState(wing, options);
  return { ok: true, returned: returnCount, lost: lossCount, stillLaunched: wing.launched, wing };
}

export function queueFighterReplenishment(subject, requested = Infinity, options = {}) {
  const wing = normalizeFighterWingState(subject, options);
  if (!wing) return { ok: false, reason: 'Wing state is required', queued: 0 };
  const wanted = requested === Infinity ? wing.lost : wholeNumber(requested);
  const queued = Math.min(wing.lost, wanted);
  wing.lost -= queued;
  wing.replenishing += queued;
  wing.status = fighterWingStatus(wing);
  return { ok: queued > 0, queued, wing };
}

export function completeFighterReplenishment(subject, requested = Infinity, options = {}) {
  const wing = normalizeFighterWingState(subject, options);
  if (!wing) return { ok: false, reason: 'Wing state is required', completed: 0 };
  const wanted = requested === Infinity ? wing.replenishing : wholeNumber(requested);
  const completed = Math.min(wing.replenishing, wanted);
  wing.replenishing -= completed;
  wing.ready += completed;
  wing.ammo += completed * wing.ammoPerCraft;
  wing.fuel += completed * wing.fuelPerCraft;
  normalizeFighterWingState(wing, options);
  return { ok: completed > 0, completed, wing };
}

export function replenishFighters(subject, requested = Infinity, options = {}) {
  const queued = queueFighterReplenishment(subject, requested, options);
  if (!queued.queued) return { ok: false, queued: 0, completed: 0, wing: queued.wing };
  const completed = completeFighterReplenishment(subject, queued.queued, options);
  return { ok: completed.ok, queued: queued.queued, completed: completed.completed, wing: completed.wing };
}

export function resupplyFighters(subject, { ammo = Infinity, fuel = Infinity } = {}, options = {}) {
  const wing = normalizeFighterWingState(subject, options);
  if (!wing) return { ok: false, reason: 'Wing state is required' };
  const liveCraft = wing.ready + wing.launched;
  const ammoCapacity = liveCraft * wing.ammoPerCraft;
  const fuelCapacity = liveCraft * wing.fuelPerCraft;
  const ammoAdded = Math.min(Math.max(0, ammoCapacity - wing.ammo), nonNegative(ammo, Infinity));
  const fuelAdded = Math.min(Math.max(0, fuelCapacity - wing.fuel), nonNegative(fuel, Infinity));
  wing.ammo = round6(wing.ammo + ammoAdded);
  wing.fuel = round6(wing.fuel + fuelAdded);
  wing.status = fighterWingStatus(wing);
  return { ok: true, ammoAdded, fuelAdded, wing };
}

function shieldTotal(unit) {
  const facings = unit?.shieldFacings ?? unit?.shields;
  if (!facings || typeof facings !== 'object') return nonNegative(unit?.shield);
  return SHIELD_FACINGS.reduce((sum, facing) => {
    const raw = facings[facing];
    return sum + nonNegative(typeof raw === 'object' ? (raw.value ?? raw.current) : raw);
  }, 0);
}

function unitDps(unit) {
  return nonNegative(unit?.dps, nonNegative(HULL_STATS[unit?.hull]?.dps));
}

function wingResource(unit, field) {
  return nonNegative(unit?.[field], nonNegative(unit?.wingState?.[field]));
}

/** Totals that individual and pooled/LOD combat paths must conserve. */
export function combatConservationTotals(units = []) {
  const totals = {
    unitCount: 0,
    liveCount: 0,
    hp: 0,
    maxHp: 0,
    shield: 0,
    dps: 0,
    ammo: 0,
    fuel: 0,
    wingReady: 0,
    wingLaunched: 0,
    wingLost: 0,
    xMoment: 0,
    yMoment: 0,
  };
  for (const unit of units ?? []) {
    totals.unitCount++;
    if (nonNegative(unit.hp) > 0) totals.liveCount++;
    totals.hp += nonNegative(unit.hp);
    totals.maxHp += nonNegative(unit.maxHp, nonNegative(unit.hp));
    totals.shield += shieldTotal(unit);
    totals.dps += unitDps(unit);
    totals.ammo += wingResource(unit, 'ammo');
    totals.fuel += wingResource(unit, 'fuel');
    totals.wingReady += wholeNumber(unit?.wingState?.ready);
    totals.wingLaunched += wholeNumber(unit?.wingState?.launched);
    totals.wingLost += wholeNumber(unit?.wingState?.lost);
    totals.xMoment += finiteNumber(unit.x);
    totals.yMoment += finiteNumber(unit.y);
  }
  for (const key of Object.keys(totals)) totals[key] = round6(totals[key]);
  return totals;
}

function aggregateBucketKey(unit, options) {
  const parts = [
    String(unit.side ?? 'neutral'),
    classifyCombatTarget(unit),
    String(unit.hull ?? 'unknown'),
    String(unit.weaponProfile ?? 'kinetic'),
  ];
  if (options.preserveDamageState !== false) parts.push(damageStateForUnit(unit));
  if (options.orderForUnit) parts.push(String(options.orderForUnit(unit)?.scope ?? 'none'));
  return parts.join('|');
}

/** Stable aggregation for the existing pooled large-battle simulation path. */
export function aggregateCombatUnits(units = [], options = {}) {
  const bucketsByKey = new Map();
  const ordered = [...(units ?? [])].sort((a, b) => compareIds(a.id, b.id));
  for (const unit of ordered) {
    const key = aggregateBucketKey(unit, options);
    let bucket = bucketsByKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        side: String(unit.side ?? 'neutral'),
        targetClass: classifyCombatTarget(unit),
        hull: String(unit.hull ?? 'unknown'),
        weaponProfile: String(unit.weaponProfile ?? 'kinetic'),
        damageState: damageStateForUnit(unit),
        unitIds: [],
        unitCount: 0,
        liveCount: 0,
        hp: 0,
        maxHp: 0,
        shield: 0,
        dps: 0,
        ammo: 0,
        fuel: 0,
        wingReady: 0,
        wingLaunched: 0,
        wingLost: 0,
        xMoment: 0,
        yMoment: 0,
      };
      bucketsByKey.set(key, bucket);
    }
    const contribution = combatConservationTotals([unit]);
    bucket.unitIds.push(String(unit.id ?? `anonymous-${bucket.unitCount}`));
    for (const field of Object.keys(contribution)) bucket[field] += contribution[field];
  }

  const buckets = [...bucketsByKey.values()]
    .sort((a, b) => compareIds(a.key, b.key))
    .map((bucket) => {
      for (const field of Object.keys(bucket)) {
        if (typeof bucket[field] === 'number') bucket[field] = round6(bucket[field]);
      }
      bucket.centroid = bucket.unitCount > 0
        ? { x: round6(bucket.xMoment / bucket.unitCount), y: round6(bucket.yMoment / bucket.unitCount) }
        : { x: 0, y: 0 };
      return bucket;
    });

  return {
    unitCount: ordered.length,
    bucketCount: buckets.length,
    totals: combatConservationTotals(ordered),
    buckets,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareIds).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createLargeBattleLodParityInputs(units = [], options = {}) {
  const aggregation = aggregateCombatUnits(units, options);
  const orders = [...(options.orders ?? [])]
    .map((order) => normalizeFleetOrder(order))
    .sort((a, b) => compareIds(stableStringify(a), stableStringify(b)));
  const payload = {
    seed: wholeNumber(options.seed),
    tickIndex: wholeNumber(options.tickIndex),
    elapsedMs: nonNegative(options.elapsedMs),
    totals: aggregation.totals,
    buckets: aggregation.buckets,
    orders,
  };
  return { ...payload, signature: fnv1a(stableStringify(payload)) };
}

export function validateLodConservation(units, aggregateOrInputs, epsilon = 1e-6) {
  const expected = combatConservationTotals(units);
  const buckets = aggregateOrInputs?.buckets ?? [];
  const observed = {};
  for (const field of Object.keys(expected)) {
    observed[field] = round6(buckets.reduce((sum, bucket) => sum + finiteNumber(bucket[field]), 0));
  }
  const errors = [];
  for (const field of Object.keys(expected)) {
    if (Math.abs(expected[field] - observed[field]) > epsilon) {
      errors.push({ field, expected: expected[field], observed: observed[field] });
    }
  }
  return { ok: errors.length === 0, expected, observed, errors };
}

function summarizeSide(initialUnits, finalById, side) {
  const deployed = initialUnits.filter((unit) => String(unit.side ?? 'neutral') === side);
  const byClass = {};
  let survived = 0;
  let lost = 0;
  let initialHp = 0;
  let remainingHp = 0;
  let damageTaken = 0;
  let wingLosses = 0;
  for (const unit of deployed) {
    const cls = classifyCombatTarget(unit);
    byClass[cls] = byClass[cls] ?? { deployed: 0, survived: 0, lost: 0 };
    byClass[cls].deployed++;
    const startHp = nonNegative(unit.hp);
    const final = finalById.get(String(unit.id));
    const endHp = nonNegative(final?.hp);
    initialHp += startHp;
    remainingHp += endHp;
    damageTaken += Math.max(0, startHp - endHp);
    if (endHp > 0) {
      survived++;
      byClass[cls].survived++;
    } else {
      lost++;
      byClass[cls].lost++;
      if (unit.isWing || FIGHTER_HULL_SET.has(unit.hull)) wingLosses++;
    }
  }
  return {
    deployed: deployed.length,
    survived,
    lost,
    initialHp: round6(initialHp),
    remainingHp: round6(remainingHp),
    damageTaken: round6(damageTaken),
    wingLosses,
    byClass,
  };
}

/** Create a deterministic, save-safe after-action report from before/after snapshots. */
export function createPostBattleReport(input = {}) {
  const initialUnits = [...(input.initialUnits ?? input.beforeUnits ?? [])].sort((a, b) => compareIds(a.id, b.id));
  const finalUnits = [...(input.finalUnits ?? input.afterUnits ?? [])].sort((a, b) => compareIds(a.id, b.id));
  const finalById = new Map(finalUnits.map((unit) => [String(unit.id), unit]));
  const sides = [...new Set(initialUnits.map((unit) => String(unit.side ?? 'neutral')))].sort(compareIds);
  const sideReports = Object.fromEntries(sides.map((side) => [side, summarizeSide(initialUnits, finalById, side)]));
  const startedAt = finiteNumber(input.startedAt);
  const endedAt = Math.max(startedAt, finiteNumber(input.endedAt, startedAt));
  const cargo = {
    saved: nonNegative(input.cargo?.saved),
    lost: nonNegative(input.cargo?.lost),
    captured: nonNegative(input.cargo?.captured),
  };
  const salvage = {
    credits: nonNegative(input.salvage?.credits),
    materials: nonNegative(input.salvage?.materials),
    fuel: nonNegative(input.salvage?.fuel),
  };
  const objectives = [...(input.objectives ?? [])]
    .map((objective) => ({
      id: String(objective.id ?? ''),
      type: String(objective.type ?? 'unknown'),
      outcome: String(objective.outcome ?? 'unresolved'),
    }))
    .sort((a, b) => compareIds(a.id, b.id));
  const events = [...(input.events ?? [])].slice(0, 100).map((event, index) => ({
    at: nonNegative(event.at),
    type: String(event.type ?? 'event'),
    actorId: event.actorId == null ? null : String(event.actorId),
    targetId: event.targetId == null ? null : String(event.targetId),
    index,
  }));

  return {
    id: String(input.battleId ?? `${input.systemId ?? 'unknown'}:${startedAt}`),
    systemId: input.systemId == null ? null : String(input.systemId),
    winner: input.winner == null ? null : String(input.winner),
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    sides: sideReports,
    objectives,
    cargo,
    salvage,
    events,
  };
}

// Compact aliases for integration call sites that use "order" or "LOD input" wording.
export const validateTacticalOrder = validateFleetOrder;
export const applyTacticalOrder = applyFleetOrder;
export const createLargeBattleLodInput = createLargeBattleLodParityInputs;
