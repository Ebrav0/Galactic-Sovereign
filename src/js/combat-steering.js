// Pure tactical steering: turn-then-thrust, soft separation, sticky targeting,
// Empire-at-War formation helpers.

import {
  TICK_MS,
  TACTICAL_SHIP_SPEED,
  TACTICAL_SHIP_ACCEL,
  TACTICAL_SHIP_DRAG,
  TACTICAL_TURN_RATE,
  TACTICAL_SEPARATION_RADIUS,
  TACTICAL_SEPARATION_STRENGTH,
  TACTICAL_TARGET_STICK_MS,
  TACTICAL_MOTION_TIERS,
  TACTICAL_MOTION_HULL_TIER,
  TACTICAL_FORMATION_BASE_SPACING,
  TACTICAL_APPROACH_BAND,
  TACTICAL_CAPITAL_SLOT_HOLD_DIST,
  TACTICAL_CAPITAL_LINE_ADVANCE,
  CARRIER_WING_HULLS,
  FLAGSHIP_WING_COMBAT_SPEED_MULT,
  TACTICAL_WING_DRAG,
  WING_PASS_CRUISE_THRUST,
  WING_PASS_MIN_SPEED_FRAC,
  WING_PASS_BREAK_OFFSET,
  WING_PASS_STRAFE_MS,
  WING_PASS_REENGAGE_RANGE_MULT,
  FLAGSHIP_WING_SCREEN_RADIUS,
  FLAGSHIP_WING_PROTECT_LEASH,
  FLAGSHIP_WING_INTERCEPT_RADIUS,
  FLAGSHIP_WING_FIGHTER_INTERCEPT_RADIUS,
} from './constants.js';

const DEFAULT_TIER = TACTICAL_MOTION_TIERS.escort;
const BATTLE_LINE_TIERS = new Set(['capital', 'carrier', 'line']);
const WING_HULL_SET = new Set(CARRIER_WING_HULLS);

const DISPLAY_PREV_POSE = Symbol('combatDisplayPrevPose');

/** Capture the fixed-tick pose before simulation mutates a tactical unit. */
export function captureCombatDisplayPose(unit) {
  if (!unit || typeof unit !== 'object') return;
  if (!unit[DISPLAY_PREV_POSE]) {
    Object.defineProperty(unit, DISPLAY_PREV_POSE, {
      value: { x: 0, y: 0, heading: 0 },
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  unit[DISPLAY_PREV_POSE].x = Number.isFinite(unit.x) ? unit.x : 0;
  unit[DISPLAY_PREV_POSE].y = Number.isFinite(unit.y) ? unit.y : 0;
  unit[DISPLAY_PREV_POSE].heading = Number.isFinite(unit.heading) ? unit.heading : 0;
}

/** Smooth render-only pose between fixed combat ticks; never mutates simulation state. */
export function combatDisplayPose(unit, accumulatorMs = 0, paused = false) {
  const current = {
    x: Number.isFinite(unit?.x) ? unit.x : 0,
    y: Number.isFinite(unit?.y) ? unit.y : 0,
    heading: Number.isFinite(unit?.heading) ? unit.heading : 0,
  };
  const previous = unit?.[DISPLAY_PREV_POSE];
  if (!previous || paused) return current;
  const alpha = Math.min(1, Math.max(0, accumulatorMs / TICK_MS));
  return {
    x: previous.x + (current.x - previous.x) * alpha,
    y: previous.y + (current.y - previous.y) * alpha,
    heading: previous.heading + shortestAngleDelta(previous.heading, current.heading) * alpha,
  };
}

export function hullMotionProfile(hull) {
  const tierId = TACTICAL_MOTION_HULL_TIER[hull] ?? 'escort';
  const tier = TACTICAL_MOTION_TIERS[tierId] ?? DEFAULT_TIER;
  return {
    tier: tierId,
    maxSpeedMult: tier.maxSpeed,
    accelMult: tier.accel,
    turnRateMult: tier.turnRate,
    separationMult: tier.separation,
    formationDiscipline: tier.formationDiscipline ?? 0.2,
    chaseFreedom: tier.chaseFreedom ?? 0.85,
    formationSpacingMult: tier.formationSpacingMult ?? 1.0,
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

export function isWingUnit(unit) {
  if (!unit) return false;
  if (unit.isWing) return true;
  return WING_HULL_SET.has(unit.hull);
}

export function isBattleLineUnit(unit) {
  if (!unit || unit.hp <= 0) return false;
  if (unit.isStructure || unit.isConvoy) return false;
  if (isWingUnit(unit)) return false;
  if (unit.hull === 'flagship' || unit.id === 'flagship') return false;
  const tier = hullMotionProfile(unit.hull).tier;
  return BATTLE_LINE_TIERS.has(tier);
}

export function battleLineMembers(sideUnits = []) {
  return sideUnits
    .filter((unit) => isBattleLineUnit(unit))
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function screenMembers(sideUnits = []) {
  return sideUnits
    .filter((unit) => {
      if (!unit || unit.hp <= 0 || unit.isStructure || unit.isConvoy) return false;
      if (isWingUnit(unit)) return false;
      return hullMotionProfile(unit.hull).tier === 'escort';
    })
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function centroid(units) {
  if (!units?.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const unit of units) {
    x += unit.x ?? 0;
    y += unit.y ?? 0;
  }
  return { x: x / units.length, y: y / units.length };
}

/**
 * Battle-line / formation slot for a unit.
 * @param {object} opts.offsetFn - (type, ordinal, count, spacing) => {x,y}
 * @param {boolean} opts.forceEscortSlots - include escorts when explicit formation orders them
 * @param {object[]} opts.members - precomputed battle-line members (optional)
 */
export function pickFleetSlotGoal(unit, sideUnits, hostileUnits, formationType = 'line', opts = {}) {
  if (!unit || isWingUnit(unit)) return null;

  const forceEscortSlots = !!opts.forceEscortSlots;
  const profile = hullMotionProfile(unit.hull);
  const isLine = BATTLE_LINE_TIERS.has(profile.tier);
  if (!isLine && !forceEscortSlots) return null;

  let members = opts.members;
  if (!members) {
    members = forceEscortSlots && !isLine
      ? screenMembers(sideUnits)
      : battleLineMembers(sideUnits);
  }
  if (!members.length) {
    if (isLine) members = [unit];
    else return null;
  }

  const ordinal = members.findIndex((candidate) => candidate.id === unit.id);
  if (ordinal < 0) return null;

  const ownCenter = centroid(members);
  const hostiles = (hostileUnits ?? []).filter((h) => h && h.hp > 0);
  const hostileCenter = hostiles.length ? centroid(hostiles) : {
    x: ownCenter.x + Math.cos(unit.heading ?? 0) * 200,
    y: ownCenter.y + Math.sin(unit.heading ?? 0) * 200,
  };
  const facing = Math.atan2(hostileCenter.y - ownCenter.y, hostileCenter.x - ownCenter.x);

  let maxSpacingMult = profile.formationSpacingMult;
  for (const member of members) {
    maxSpacingMult = Math.max(maxSpacingMult, hullMotionProfile(member.hull).formationSpacingMult);
  }
  const spacing = (opts.baseSpacing ?? TACTICAL_FORMATION_BASE_SPACING) * maxSpacingMult;

  const offsetFn = opts.offsetFn;
  const offset = typeof offsetFn === 'function'
    ? offsetFn(formationType, ordinal, members.length, spacing)
    : { x: 0, y: (ordinal - (members.length - 1) / 2) * spacing };

  const slotX = ownCenter.x + offset.x * Math.cos(facing) - offset.y * Math.sin(facing);
  const slotY = ownCenter.y + offset.x * Math.sin(facing) + offset.y * Math.cos(facing);
  const distance = Math.hypot(slotX - (unit.x ?? 0), slotY - (unit.y ?? 0));

  return {
    x: slotX,
    y: slotY,
    facing,
    distance,
    ordinal,
    spacing,
    memberCount: members.length,
  };
}

/**
 * EaW-weighted facing/thrust from formation discipline + chase freedom.
 */
export function blendCombatGoal({
  faceTarget,
  formFacing = null,
  discipline = 0,
  chase = 1,
  dist = 0,
  range = 280,
  band = TACTICAL_APPROACH_BAND,
  slotDistance = 0,
  holdDist = TACTICAL_CAPITAL_SLOT_HOLD_DIST,
  lineAdvance = TACTICAL_CAPITAL_LINE_ADVANCE,
  holdOrder = false,
  hasSlot = false,
} = {}) {
  let desiredFacing = Number.isFinite(faceTarget) ? faceTarget : 0;
  let thrust = 0;

  if (holdOrder) {
    return { desiredFacing, thrust: 0 };
  }

  if (hasSlot && formFacing != null && Number.isFinite(formFacing)) {
    desiredFacing = blendFacing(faceTarget, formFacing, discipline);

    if (slotDistance > holdDist) {
      thrust = Math.max(thrust, discipline * lineAdvance + (1 - discipline) * 0.25);
    } else {
      thrust = Math.max(thrust, discipline * 0.15);
    }

    if (discipline >= 0.5 && dist > range * band) {
      desiredFacing = blendFacing(desiredFacing, faceTarget, chase);
      thrust = Math.max(thrust, chase * 0.85);
    } else if (discipline >= 0.5) {
      desiredFacing = blendFacing(desiredFacing, faceTarget, 0.35);
    }
    return { desiredFacing, thrust: clamp(thrust, 0, 1) };
  }

  // Escorts / wings / low-discipline chase-first.
  desiredFacing = faceTarget;
  if (dist > range * band) thrust = chase;
  return { desiredFacing, thrust: clamp(thrust, 0, 1) };
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
  const cruiseSpeed = Math.max(0, opts.cruiseSpeed ?? 0);

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

  let speed = Math.hypot(unit.vx, unit.vy);
  // Strike craft keep a floor cruise during attack passes so they don't crawl.
  if (cruiseSpeed > 0 && (thrust > 0 || opts.maintainCruise) && speed < cruiseSpeed) {
    if (speed < 1e-4) {
      unit.vx = Math.cos(unit.heading) * cruiseSpeed;
      unit.vy = Math.sin(unit.heading) * cruiseSpeed;
    } else {
      const boost = Math.min(1, (cruiseSpeed - speed) / Math.max(cruiseSpeed, 1));
      unit.vx += Math.cos(unit.heading) * accel * 0.55 * boost * dt;
      unit.vy += Math.sin(unit.heading) * accel * 0.55 * boost * dt;
    }
    speed = Math.hypot(unit.vx, unit.vy);
  }

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

/** Soft velocity-only separation: no positional snapping or contact barrier. */
export function applyShipSeparation(liveUnits, { dt = 0.05, strength = TACTICAL_SEPARATION_STRENGTH } = {}) {
  const mobile = (liveUnits ?? []).filter((unit) => (
    unit?.hp > 0 && !unit.isStructure && !unit.escaped && !unit.recovered
  ));
  for (let i = 0; i < mobile.length; i++) {
    const a = mobile[i];
    ensureUnitMotion(a);
    for (let j = i + 1; j < mobile.length; j++) {
      const b = mobile[j];
      if (a.side != null && b.side != null && a.side !== b.side) continue;
      ensureUnitMotion(b);
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const desired = separationRadiusForUnit(a) + separationRadiusForUnit(b);
      if (dist >= desired) continue;
      if (dist < 0.001) {
        const sign = String(a.id).localeCompare(String(b.id)) <= 0 ? 1 : -1;
        dx = sign;
        dy = 0;
        dist = 1;
      }
      const overlap = Math.max(0, (desired - dist) / Math.max(1, desired));
      const impulse = strength * overlap * Math.max(0, dt);
      const nx = dx / dist;
      const ny = dy / dist;
      a.vx -= nx * impulse;
      a.vy -= ny * impulse;
      b.vx += nx * impulse;
      b.vy += ny * impulse;
    }
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
  wingPass = false,
} = {}) {
  const profile = hullMotionProfile(unit?.hull);
  const flagshipWingBoost = (isWingUnit(unit) && unit.parentCarrierId === 'flagship')
    ? FLAGSHIP_WING_COMBAT_SPEED_MULT
    : 1;
  const speedScale = envSpeed * damageSpeed * speedMult * flagshipWingBoost;
  const maxSpeed = TACTICAL_SHIP_SPEED * profile.maxSpeedMult * speedScale;
  const activePass = wingPass || (isWingUnit(unit) && unit.passPhase
    && ['approach', 'strafe', 'break', 'reengage', 'attack'].includes(unit.passPhase));
  return {
    dt,
    thrust,
    maxSpeed,
    turnRate: TACTICAL_TURN_RATE * profile.turnRateMult,
    accel: TACTICAL_SHIP_ACCEL * profile.accelMult * damageSpeed
      * Math.min(1.35, flagshipWingBoost)
      * (isWingUnit(unit) ? Math.min(2.6, Math.max(1, speedMult)) : 1),
    drag: activePass ? TACTICAL_WING_DRAG : drag,
    cruiseSpeed: activePass ? maxSpeed * WING_PASS_MIN_SPEED_FRAC : 0,
    maintainCruise: activePass,
  };
}

/**
 * Star Wars attack-run controller for strike craft.
 * approach → strafe → break → reengage → approach.
 */
export function wingAttackPassGoal(unit, target, {
  range = 280,
  nowMs = 0,
  band = TACTICAL_APPROACH_BAND,
} = {}) {
  if (!unit || !target) {
    return { desiredFacing: unit?.heading ?? 0, thrust: WING_PASS_CRUISE_THRUST, phase: 'approach' };
  }

  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const dist = Math.hypot(dx, dy) || 1;
  const faceTarget = Math.atan2(dy, dx);
  const hx = Math.cos(unit.heading ?? 0);
  const hy = Math.sin(unit.heading ?? 0);
  const forwardDot = (hx * dx + hy * dy) / dist;
  const aligned = Math.abs(shortestAngleDelta(unit.heading ?? 0, faceTarget)) < 0.55;

  if (!unit.passPhase || unit.passTargetId !== target.id) {
    unit.passPhase = 'approach';
    unit.passPhaseAt = nowMs;
    unit.passTargetId = target.id;
    unit.passClosestDist = dist;
    unit.passBreakSign = (String(unit.id).length + (unit.sortieNumber ?? 0)) % 2 === 0 ? 1 : -1;
  }

  unit.passClosestDist = Math.min(unit.passClosestDist ?? dist, dist);
  let phase = unit.passPhase;

  if (phase === 'approach') {
    if (dist <= range * Math.max(band, 1.05) && (aligned || forwardDot > 0.55)) {
      phase = 'strafe';
      unit.passPhaseAt = nowMs;
      unit.passClosestDist = dist;
    }
  } else if (phase === 'strafe') {
    const pastTarget = forwardDot < -0.05 && dist > (unit.passClosestDist ?? dist) + 8;
    const timedOut = nowMs - (unit.passPhaseAt ?? nowMs) >= WING_PASS_STRAFE_MS;
    const opening = dist > (unit.passClosestDist ?? dist) + 18 && dist < range * 0.85;
    if (pastTarget || timedOut || opening) {
      phase = 'break';
      unit.passPhaseAt = nowMs;
      unit.passBreakSign = unit.passBreakSign || 1;
    }
  } else if (phase === 'break') {
    const breakFacing = Math.atan2(
      (unit.y + hy * 160 + (-hx) * unit.passBreakSign * WING_PASS_BREAK_OFFSET) - unit.y,
      (unit.x + hx * 160 + (-hy) * unit.passBreakSign * WING_PASS_BREAK_OFFSET) - unit.x,
    );
    const facingBreak = Math.abs(shortestAngleDelta(unit.heading ?? 0, breakFacing)) < 0.7;
    if (facingBreak && dist > range * 0.55) {
      phase = 'reengage';
      unit.passPhaseAt = nowMs;
    } else if (nowMs - (unit.passPhaseAt ?? nowMs) > 2200) {
      phase = 'reengage';
      unit.passPhaseAt = nowMs;
    }
  } else if (phase === 'reengage') {
    if (dist > range * WING_PASS_REENGAGE_RANGE_MULT || forwardDot < 0.2) {
      phase = 'approach';
      unit.passPhaseAt = nowMs;
      unit.passClosestDist = dist;
      unit.passBreakSign = -(unit.passBreakSign || 1);
    }
  } else {
    phase = 'approach';
    unit.passPhaseAt = nowMs;
  }

  unit.passPhase = phase;
  unit.sortiePhase = phase === 'strafe' ? 'attack' : phase;

  if (phase === 'approach') {
    const lead = Math.min(90, dist * 0.18);
    const lx = target.x + (target.vx ?? 0) * 0.35 + Math.cos(faceTarget) * lead * 0.15;
    const ly = target.y + (target.vy ?? 0) * 0.35 + Math.sin(faceTarget) * lead * 0.15;
    return {
      desiredFacing: Math.atan2(ly - unit.y, lx - unit.x),
      thrust: 1,
      phase,
      afterburner: dist > range * 1.55 && aligned,
    };
  }

  if (phase === 'strafe') {
    return {
      desiredFacing: faceTarget,
      thrust: WING_PASS_CRUISE_THRUST,
      phase,
      afterburner: false,
    };
  }

  if (phase === 'break') {
    const side = unit.passBreakSign || 1;
    const bx = unit.x + hx * 200 + (-hy) * side * WING_PASS_BREAK_OFFSET;
    const by = unit.y + hy * 200 + hx * side * WING_PASS_BREAK_OFFSET;
    return {
      desiredFacing: Math.atan2(by - unit.y, bx - unit.x),
      thrust: WING_PASS_CRUISE_THRUST,
      phase,
      afterburner: false,
    };
  }

  // reengage — sweep back toward a long approach corridor
  const corridor = range * 1.4;
  const cx = target.x - Math.cos(faceTarget) * corridor;
  const cy = target.y - Math.sin(faceTarget) * corridor;
  return {
    desiredFacing: Math.atan2(cy - unit.y, cx - unit.x),
    thrust: 1,
    phase,
    afterburner: dist > range,
  };
}

export function isFlagshipEscortWing(unit) {
  return !!(unit?.isWing && String(unit.parentCarrierId ?? '') === 'flagship');
}

function isFighterThreat(target) {
  return !!(target?.isWing || WING_HULL_SET.has(target?.hull) || target?.hull === 'bomber');
}

/**
 * Flagship escort CAP: keep flying a protective orbit, peel off for nearby threats
 * (fighters first), and snap back if a chase leaves the capital uncovered.
 */
export function flagshipEscortProtectGoal(unit, ward, target, {
  range = 280,
  nowMs = 0,
  screenRadius = FLAGSHIP_WING_SCREEN_RADIUS,
  leash = FLAGSHIP_WING_PROTECT_LEASH,
  interceptRadius = FLAGSHIP_WING_INTERCEPT_RADIUS,
  fighterInterceptRadius = FLAGSHIP_WING_FIGHTER_INTERCEPT_RADIUS,
} = {}) {
  if (!unit || !ward) {
    return { desiredFacing: unit?.heading ?? 0, thrust: 0.55, phase: 'screen', afterburner: false, engage: false };
  }

  const toWardX = ward.x - unit.x;
  const toWardY = ward.y - unit.y;
  const wardDist = Math.hypot(toWardX, toWardY) || 1;

  let hash = 0;
  for (let i = 0; i < String(unit.id).length; i++) hash = (hash * 31 + String(unit.id).charCodeAt(i)) >>> 0;
  const orbitDir = (hash % 2) === 0 ? 1 : -1;
  const orbitSpeed = 0.85 + (hash % 40) / 100;
  const orbitAngle = ((hash % 360) / 360) * Math.PI * 2
    + (nowMs / 1000) * orbitSpeed * orbitDir;
  const slotR = screenRadius * (0.88 + (hash % 30) / 200);
  const slotX = ward.x + Math.cos(orbitAngle) * slotR;
  const slotY = ward.y + Math.sin(orbitAngle) * slotR;
  const toSlotX = slotX - unit.x;
  const toSlotY = slotY - unit.y;
  const slotDist = Math.hypot(toSlotX, toSlotY) || 1;
  // Tangent so CAP keeps flying rather than parking on the ring.
  const tangentFacing = orbitAngle + orbitDir * (Math.PI / 2);

  const targetAlive = target && target.hp > 0;
  const targetDistToWard = targetAlive
    ? Math.hypot(target.x - ward.x, target.y - ward.y)
    : Infinity;
  const fighterThreat = targetAlive && isFighterThreat(target);
  const threatNearWard = targetAlive && (
    fighterThreat
      ? targetDistToWard <= fighterInterceptRadius
      : targetDistToWard <= interceptRadius
  );

  if (wardDist > leash) {
    const outwardSpeed = ((unit.vx ?? 0) * -toWardX + (unit.vy ?? 0) * -toWardY) / wardDist;
    if (outwardSpeed > 0) {
      // CAP craft acknowledge the leash immediately instead of coasting deeper
      // into a chase while their nose turns back toward the protected ship.
      const retain = Math.max(0.18, 1 - Math.min(0.82, outwardSpeed / 180));
      unit.vx *= retain;
      unit.vy *= retain;
    }
    unit.passPhase = null;
    unit.passTargetId = null;
    unit.sortiePhase = 'return_to_cap';
    return {
      desiredFacing: Math.atan2(toWardY, toWardX),
      thrust: 1,
      phase: 'return',
      afterburner: true,
      engage: false,
    };
  }

  if (threatNearWard) {
    // Fighters: dogfight within the CAP bubble. Other ships: short intercept, then CAP.
    if (fighterThreat) {
      const pass = wingAttackPassGoal(unit, target, { range, nowMs });
      const nextX = unit.x + Math.cos(pass.desiredFacing) * 36;
      const nextY = unit.y + Math.sin(pass.desiredFacing) * 36;
      const nextWardDist = Math.hypot(nextX - ward.x, nextY - ward.y);
      if (nextWardDist > leash * 0.95) {
        return {
          desiredFacing: Math.atan2(toWardY, toWardX),
          thrust: 1,
          phase: 'return',
          afterburner: true,
          engage: true,
        };
      }
      return { ...pass, engage: true };
    }

    // Non-fighter close to the flagship — cut them off, don't chase into a deep attack run.
    const toThreatX = target.x - unit.x;
    const toThreatY = target.y - unit.y;
    const threatDist = Math.hypot(toThreatX, toThreatY) || 1;
    const interceptX = target.x + (ward.x - target.x) * 0.15;
    const interceptY = target.y + (ward.y - target.y) * 0.15;
    const cutX = interceptX - unit.x;
    const cutY = interceptY - unit.y;
    unit.passPhase = null;
    unit.passTargetId = null;
    return {
      desiredFacing: Math.atan2(cutY, cutX),
      thrust: threatDist > range * 0.85 ? 1 : 0.7,
      phase: 'intercept',
      afterburner: threatDist > range,
      engage: true,
    };
  }

  // No nearby threat — keep flying the CAP orbit around the flagship.
  unit.passPhase = null;
  unit.passTargetId = null;
  unit.sortiePhase = 'screen';
  if (slotDist > 28) {
    return {
      desiredFacing: Math.atan2(toSlotY, toSlotX),
      thrust: Math.min(1, 0.55 + slotDist / 90),
      phase: 'screen',
      afterburner: wardDist > screenRadius * 1.25,
      engage: false,
    };
  }
  return {
    desiredFacing: tangentFacing,
    thrust: 0.72,
    phase: 'screen',
    afterburner: false,
    engage: false,
  };
}

/** Blend two headings by weight toward `toward` (0..1). */
export function blendFacing(from, toward, weight) {
  const w = clamp(weight, 0, 1);
  if (w <= 0) return from;
  if (w >= 1) return toward;
  return from + shortestAngleDelta(from, toward) * w;
}
