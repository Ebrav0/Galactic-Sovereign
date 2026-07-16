// Player flagship: direct-piloted free flight in system view and lane
// transit on the galaxy graph (GDD §5, §8). Flight integration happens only
// inside simulation ticks so pause freezes the ship and advanceTime stays
// deterministic. Transit positions are pure functions of state.time.

import {
  TICK_MS,
  FLAGSHIP_ACCEL,
  FLAGSHIP_MAX_SPEED,
  FLAGSHIP_DRAG,
  FLAGSHIP_ENTRY_MARGIN,
  FLAGSHIP_ENTRY_MIN_RADIUS,
  FLAGSHIP_ORBIT_OMEGA,
  FLAGSHIP_ORBIT_PAD_STAR,
  FLAGSHIP_ORBIT_PAD_PLANET,
  FLAGSHIP_ORBIT_PAD_MOON,
  FLAGSHIP_ORBIT_MAX_DISTANCE,
  FLAGSHIP_ORBIT_STAR_MAX_DISTANCE,
  LANE_SPEED,
  LANE_MIN_LEG_MS,
  CELESTIAL_VISUAL_SCALE,
  PLANET_ORBIT_BASE,
  FLAGSHIP_MANUAL_OVERRIDE_MS,
  FLAGSHIP_AUTOPILOT_BLEND_MS,
} from './constants.js';
import { findPath, nodeById } from './galaxy.js';
import { systemById, findBody, bodyAngle, planetPosition, moonPosition } from './state.js';
import { getGraph } from './galaxy-scope.js';
import { effectiveLegDurationMs } from './strategic-structures.js';
import { keepOutRepulsion } from './ship-motion.js';
import { techEffects } from './tech-web.js';
import { canRouteThroughSystem } from './diplomacy.js';
import { flagshipAutopilotPlan } from './combat-autonomy.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  transitEtaMs as transitEtaMsCore,
  advanceTransit,
} from './transit.js';

// Current thrust vector, set by input (or test hooks). Visual-only in the
// sense of never being serialized; ticks read it as the pilot's live order.
const input = { x: 0, y: 0 };
let manualOverrideUntil = 0;
let autopilotBlendUntil = 0;

// Previous-tick pose for render-time extrapolation between 20 Hz physics steps.
const prev = { x: 0, y: 0, heading: 0 };
let prevInit = false;

function syncPrevPose(f) {
  prev.x = f.x;
  prev.y = f.y;
  prev.heading = f.heading;
  prevInit = true;
}

function ensureOrbitField(f) {
  if (f.orbit === undefined) f.orbit = null;
}

function orbitVelocity(center, orbit, omega = FLAGSHIP_ORBIT_OMEGA) {
  const tvx = -Math.sin(orbit.angle) * orbit.radius * omega;
  const tvy = Math.cos(orbit.angle) * orbit.radius * omega;
  return {
    vx: center.vx + tvx,
    vy: center.vy + tvy,
  };
}

function headingFromMotion(f, dx, dy) {
  if (Math.hypot(dx, dy) > 0.05) return Math.atan2(dy, dx);
  if (Math.hypot(f.vx, f.vy) > 0.05) return Math.atan2(f.vy, f.vx);
  return f.heading;
}

// Smooth display pose for rendering; does not affect simulation state.
export function getFlagshipDisplayPose(state, accumulatorMs) {
  const f = state.flagship;
  ensureOrbitField(f);
  if (!prevInit) syncPrevPose(f);
  if (state.paused || f.transit) {
    const heading = f.orbit ? headingFromMotion(f, f.vx, f.vy) : f.heading;
    return { x: f.x, y: f.y, heading };
  }
  const t = Math.min(1, Math.max(0, accumulatorMs / TICK_MS));
  const dx = f.x - prev.x;
  const dy = f.y - prev.y;

  if (f.orbit) {
    return {
      x: prev.x + dx * t,
      y: prev.y + dy * t,
      heading: headingFromMotion(f, dx, dy),
    };
  }

  let dHeading = f.heading - prev.heading;
  while (dHeading > Math.PI) dHeading -= 2 * Math.PI;
  while (dHeading < -Math.PI) dHeading += 2 * Math.PI;
  return {
    x: prev.x + dx * t,
    y: prev.y + dy * t,
    heading: prev.heading + dHeading * t,
  };
}

export function setFlagshipInput(x, y, nowMs = 0) {
  const wasActive = Math.hypot(input.x, input.y) > 1e-6;
  input.x = x;
  input.y = y;
  const active = Math.hypot(input.x, input.y) > 1e-6;
  if (active) {
    manualOverrideUntil = Infinity;
    autopilotBlendUntil = Infinity;
  } else if (wasActive) {
    manualOverrideUntil = Math.max(0, nowMs) + FLAGSHIP_MANUAL_OVERRIDE_MS;
    autopilotBlendUntil = manualOverrideUntil + FLAGSHIP_AUTOPILOT_BLEND_MS;
  }
}

export function getFlagshipInput() {
  return { x: input.x, y: input.y };
}

export function flagshipControlStatus(state) {
  const f = state?.flagship;
  const battle = f?.systemId ? state?.systemBattles?.[f.systemId] : null;
  if (!battle?.active || battle.mode !== 'tactical' || state?.combatSettings?.flagshipAutopilot === false) {
    return { mode: 'manual', overrideRemainingMs: 0, blend: 0, targetId: null };
  }
  const now = state.time ?? 0;
  const held = Math.hypot(input.x, input.y) > 1e-6;
  if (held || now < manualOverrideUntil) {
    return {
      mode: 'manual',
      overrideRemainingMs: held ? FLAGSHIP_MANUAL_OVERRIDE_MS : Math.max(0, manualOverrideUntil - now),
      blend: 0,
      targetId: f.autopilotTargetId ?? null,
    };
  }
  if (now < autopilotBlendUntil) {
    const blend = 1 - Math.max(0, autopilotBlendUntil - now) / FLAGSHIP_AUTOPILOT_BLEND_MS;
    return { mode: 'returning_to_auto', overrideRemainingMs: 0, blend, targetId: f.autopilotTargetId ?? null };
  }
  return { mode: 'auto', overrideRemainingMs: 0, blend: 1, targetId: f.autopilotTargetId ?? null };
}

export function isFlagshipOrbiting(state) {
  ensureOrbitField(state.flagship);
  return state.flagship.orbit !== null;
}

export function orbitTargetLabel(state) {
  const orbit = state.flagship.orbit;
  if (!orbit || !state.flagship.systemId) return null;
  if (orbit.kind === 'star') {
    const system = systemById(state, state.flagship.systemId);
    return system?.star?.name ?? 'star';
  }
  const resolved = findBody(state, state.flagship.systemId, orbit.bodyId);
  return resolved?.body?.name ?? null;
}

function starOrbitMinRadius(system) {
  const star = system.star;
  const baseR = (star?.radius ?? 200) * CELESTIAL_VISUAL_SCALE;
  if (star?.kind === 'blackhole') return baseR * 2.8 + FLAGSHIP_ORBIT_PAD_STAR;
  // Stable orbit sits outside the photosphere, not the entire soft glow halo —
  // using full glowScale made the min radius larger than the engage max.
  return baseR * 1.35 + FLAGSHIP_ORBIT_PAD_STAR;
}

function starOrbitEngageMax(system) {
  const minR = starOrbitMinRadius(system);
  const firstOrbit = system?.bodies?.length
    ? Math.min(...system.bodies.map((b) => b.orbitRadius))
    : PLANET_ORBIT_BASE;
  // Wide band: just outside the photosphere out toward the innermost planet.
  return Math.max(
    FLAGSHIP_ORBIT_STAR_MAX_DISTANCE,
    minR + 320,
    Math.min(firstOrbit * 0.94, minR + 1100),
  );
}

function orbitCenterPose(state, system, orbit, time = state.time) {
  if (orbit.kind === 'star') {
    return { x: 0, y: 0, vx: 0, vy: 0 };
  }

  const resolved = findBody(state, system.id, orbit.bodyId);
  if (!resolved) return null;

  if (orbit.kind === 'planet') {
    const planet = resolved.body;
    const a = bodyAngle(planet, time);
    const omega = (2 * Math.PI / planet.orbitPeriodMs) * 1000;
    return {
      x: Math.cos(a) * planet.orbitRadius,
      y: Math.sin(a) * planet.orbitRadius,
      vx: -Math.sin(a) * planet.orbitRadius * omega,
      vy: Math.cos(a) * planet.orbitRadius * omega,
    };
  }

  const moon = resolved.body;
  const planet = resolved.planet;
  const pp = planetPosition(planet, time);
  const ma = bodyAngle(moon, time);
  const pOmega = (2 * Math.PI / planet.orbitPeriodMs) * 1000;
  const mOmega = (2 * Math.PI / moon.orbitPeriodMs) * 1000;
  const pa = bodyAngle(planet, time);
  return {
    x: pp.x + Math.cos(ma) * moon.orbitRadius,
    y: pp.y + Math.sin(ma) * moon.orbitRadius,
    vx: -Math.sin(pa) * planet.orbitRadius * pOmega - Math.sin(ma) * moon.orbitRadius * mOmega,
    vy: Math.cos(pa) * planet.orbitRadius * pOmega + Math.cos(ma) * moon.orbitRadius * mOmega,
  };
}

function minOrbitRadius(system, kind, body) {
  if (kind === 'star') return starOrbitMinRadius(system);
  if (kind === 'planet') return body.radius + FLAGSHIP_ORBIT_PAD_PLANET;
  return body.radius + FLAGSHIP_ORBIT_PAD_MOON;
}

function orbitTargetCandidates(state, system, fx, fy, preferredBodyId) {
  const candidates = [];

  const starDist = Math.hypot(fx, fy);
  const starMin = starOrbitMinRadius(system);
  const starMax = starOrbitEngageMax(system);
  const preferStar = preferredBodyId === 'star' || preferredBodyId === system?.star?.id;
  if (starDist <= starMax && starDist >= starMin * 0.72) {
    candidates.push({
      kind: 'star',
      bodyId: null,
      dist: starDist,
      minR: starMin,
      preferred: preferStar,
    });
  }

  for (const planet of system.bodies) {
    const pp = planetPosition(planet, state.time);
    const pd = Math.hypot(fx - pp.x, fy - pp.y);
    const pMin = minOrbitRadius(system, 'planet', planet);
    if (pd <= FLAGSHIP_ORBIT_MAX_DISTANCE && pd >= pMin * 0.85) {
      candidates.push({
        kind: 'planet',
        bodyId: planet.id,
        dist: pd,
        minR: pMin,
        preferred: preferredBodyId === planet.id,
      });
    }

    for (const moon of planet.moons) {
      const mp = moonPosition(planet, moon, state.time);
      const md = Math.hypot(fx - mp.x, fy - mp.y);
      const mMin = minOrbitRadius(system, 'moon', moon);
      if (md <= FLAGSHIP_ORBIT_MAX_DISTANCE && md >= mMin * 0.85) {
        candidates.push({
          kind: 'moon',
          bodyId: moon.id,
          dist: md,
          minR: mMin,
          preferred: preferredBodyId === moon.id,
        });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.dist - b.dist;
  });
  return candidates;
}

function clearOrbit(f) {
  f.orbit = null;
}

export function getFlagshipOrbitVisual(state, time = state.time) {
  const f = state.flagship;
  ensureOrbitField(f);
  if (!f.orbit || !f.systemId) return null;
  const system = systemById(state, f.systemId);
  if (!system) return null;
  const center = orbitCenterPose(state, system, f.orbit, time);
  if (!center) return null;
  return { cx: center.x, cy: center.y, radius: f.orbit.radius };
}

export function exitFlagshipOrbit(state) {
  clearOrbit(state.flagship);
  return { ok: true };
}

export function toggleFlagshipOrbit(state, preferredBodyId = null) {
  const f = state.flagship;
  ensureOrbitField(f);
  if (f.transit || !f.systemId) {
    return { ok: false, reason: 'Flagship must be in a system to enter orbit' };
  }

  if (f.orbit) {
    clearOrbit(f);
    return { ok: true, orbiting: false };
  }

  const system = systemById(state, f.systemId);
  if (!system) return { ok: false, reason: 'Unknown system' };

  const candidates = orbitTargetCandidates(state, system, f.x, f.y, preferredBodyId);
  if (!candidates.length) {
    return { ok: false, reason: 'Move closer to a star, planet, or moon to enter orbit' };
  }

  const target = candidates[0];
  const center = orbitCenterPose(state, system, target);
  if (!center) return { ok: false, reason: 'Orbit target not found' };

  const dx = f.x - center.x;
  const dy = f.y - center.y;
  const dist = Math.hypot(dx, dy);
  const radius = Math.max(target.minR, dist);

  f.orbit = {
    kind: target.kind,
    bodyId: target.bodyId,
    radius,
    angle: Math.atan2(dy, dx),
  };

  const { vx, vy } = orbitVelocity(center, f.orbit);
  f.vx = vx;
  f.vy = vy;
  f.heading = Math.atan2(vy, vx);
  syncPrevPose(f);

  return { ok: true, orbiting: true, target: orbitTargetLabel(state) };
}

function tickOrbit(state) {
  const f = state.flagship;
  const system = systemById(state, f.systemId);
  if (!system || !f.orbit) {
    clearOrbit(f);
    return;
  }

  const center = orbitCenterPose(state, system, f.orbit);
  if (!center) {
    clearOrbit(f);
    return;
  }

  const dt = TICK_MS / 1000;
  const omega = FLAGSHIP_ORBIT_OMEGA;
  f.orbit.angle += omega * dt;

  const localX = Math.cos(f.orbit.angle) * f.orbit.radius;
  const localY = Math.sin(f.orbit.angle) * f.orbit.radius;
  f.x = center.x + localX;
  f.y = center.y + localY;

  const { vx, vy } = orbitVelocity(center, f.orbit, omega);
  f.vx = vx;
  f.vy = vy;
  f.heading = Math.atan2(vy, vx);
}

// --- Lane transit ---

export function orderTravel(state, targetId) {
  const f = state.flagship;
  const galaxy = getGraph(state);
  if (f.transit || f.wormholeTransit) return { ok: false, reason: 'Flagship is already in transit' };
  if (f.systemId && state.systemBattles?.[f.systemId]?.active) {
    return { ok: false, reason: 'Flagship is engaged in combat — issue an emergency retreat order' };
  }
  if (!nodeById(galaxy, targetId)) return { ok: false, reason: 'No such star' };
  if (targetId === f.systemId) return { ok: false, reason: 'Flagship is already in that system' };

  const path = findPath(galaxy, f.systemId, targetId, {
    canEnter: (systemId) => canRouteThroughSystem(
      state,
      systemId,
      'player',
      { galaxyId: state.activeGalaxyId, allowHostile: true },
    ).ok,
  });
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  clearOrbit(f);
  const durFn = (a, b) => effectiveLegDurationMs(state, galaxy, a, b, LANE_SPEED, LANE_MIN_LEG_MS);
  f.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: durFn(path[0], path[1]),
  };
  f.systemId = null;
  return { ok: true, path, etaMs: transitEtaMs(state) };
}

export function transitEtaMs(state) {
  return transitEtaMsCore(
    state.flagship.transit,
    getGraph(state),
    state.time,
    LANE_SPEED,
    LANE_MIN_LEG_MS,
  );
}

export function transitStatus(state) {
  return transitStatusCore(
    state.flagship.transit,
    getGraph(state),
    state.time,
    LANE_SPEED,
    LANE_MIN_LEG_MS,
  );
}

function applyFlagshipKeepOut(state) {
  const f = state.flagship;
  // Stable orbit disables the soft keep-out field — position is kinematic each tick.
  if (f.transit || !f.systemId || f.orbit) return;
  const system = systemById(state, f.systemId);
  if (!system) return;
  const dt = TICK_MS / 1000;
  // Velocity-only repulsion — never snap position (that fights display interpolation and stutters).
  const rep = keepOutRepulsion(state, system, f.x, f.y);
  f.vx += rep.ax * dt;
  f.vy += rep.ay * dt;
}

// --- Per-tick update (called from simulation.js after state.time advances) ---

export function tickFlagship(state) {
  const f = state.flagship;
  if (f.wormholeTransit) return;
  ensureOrbitField(f);
  if (!f.transit) syncPrevPose(f);
  if (f.transit) {
    const galaxy = getGraph(state);
    const durFn = (a, b) => effectiveLegDurationMs(state, galaxy, a, b, LANE_SPEED, LANE_MIN_LEG_MS);
    advanceTransit(
      f.transit,
      galaxy,
      state.time,
      LANE_SPEED,
      LANE_MIN_LEG_MS,
      (destId, fromId) => arrive(state, destId, fromId),
      durFn,
      {
        canEnter: (systemId) => canRouteThroughSystem(state, systemId, 'player', {
          galaxyId: state.activeGalaxyId,
          allowHostile: true,
        }).ok,
        onBlocked: (safeSystemId, blockedSystemId) => arrive(state, safeSystemId, blockedSystemId),
      },
    );
    return;
  }

  const control = flagshipControlStatus(state);
  const autopilot = control.mode === 'manual' ? null : flagshipAutopilotPlan(state);
  let driveX = input.x;
  let driveY = input.y;
  if (autopilot) {
    const weight = control.mode === 'returning_to_auto' ? control.blend : 1;
    driveX = autopilot.x * weight;
    driveY = autopilot.y * weight;
    f.autopilotTargetId = autopilot.targetId ?? null;
    f.combatIntent = autopilot.intent;
  } else if (control.mode === 'manual') {
    f.combatIntent = 'manual_override';
  }
  const thrusting = Math.hypot(driveX, driveY) > 1e-6;
  if (f.orbit) {
    if (thrusting) {
      clearOrbit(f);
    } else {
      tickOrbit(state);
      return;
    }
  }

  const dt = TICK_MS / 1000;
  const speedMult = Math.max(0.5, techEffects(state).flagshipSpeedMult ?? 1);
  const accel = FLAGSHIP_ACCEL * speedMult;
  const maxSpeed = FLAGSHIP_MAX_SPEED * speedMult;
  let ax = driveX;
  let ay = driveY;
  const mag = Math.hypot(ax, ay);
  if (mag > 1e-6) {
    if (mag > 1) {
      ax /= mag;
      ay /= mag;
    }
    f.vx += ax * accel * dt;
    f.vy += ay * accel * dt;
    const speed = Math.hypot(f.vx, f.vy);
    if (speed > maxSpeed) {
      f.vx = (f.vx / speed) * maxSpeed;
      f.vy = (f.vy / speed) * maxSpeed;
    }
  } else {
    const damp = Math.max(0, 1 - FLAGSHIP_DRAG * dt);
    f.vx *= damp;
    f.vy *= damp;
    if (Math.hypot(f.vx, f.vy) < 2) {
      f.vx = 0;
      f.vy = 0;
    }
  }

  applyFlagshipKeepOut(state);

  f.x += f.vx * dt;
  f.y += f.vy * dt;
  if (Math.hypot(f.vx, f.vy) > 1) {
    f.heading = Math.atan2(f.vy, f.vx);
  }
}

function arrive(state, destId, fromId) {
  const f = state.flagship;
  f.transit = null;
  f.systemId = destId;
  clearOrbit(f);

  const galaxy = getGraph(state);
  const dest = nodeById(galaxy, destId);
  const from = nodeById(galaxy, fromId);
  const entryAngle = Math.atan2(from.y - dest.y, from.x - dest.x);
  const entryRadius = systemEntryRadius(state, destId);
  f.x = Math.cos(entryAngle) * entryRadius;
  f.y = Math.sin(entryAngle) * entryRadius;
  f.vx = 0;
  f.vy = 0;
  f.heading = entryAngle + Math.PI;
  syncPrevPose(f);
}

function systemEntryRadius(state, systemId) {
  const system = systemById(state, systemId);
  const maxOrbit = system.bodies.reduce((m, b) => Math.max(m, b.orbitRadius), 0);
  return Math.max(FLAGSHIP_ENTRY_MIN_RADIUS, maxOrbit + FLAGSHIP_ENTRY_MARGIN);
}
