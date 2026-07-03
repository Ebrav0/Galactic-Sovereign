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
  LANE_SPEED,
  LANE_MIN_LEG_MS,
} from './constants.js';
import { findPath, nodeById } from './galaxy.js';
import { systemById } from './state.js';
import { keepOutRepulsion } from './ship-motion.js';
import {
  legDurationMs,
  transitStatus as transitStatusCore,
  transitEtaMs as transitEtaMsCore,
  advanceTransit,
} from './transit.js';

// Current thrust vector, set by input (or test hooks). Visual-only in the
// sense of never being serialized; ticks read it as the pilot's live order.
const input = { x: 0, y: 0 };

// Previous-tick pose for render-time extrapolation between 20 Hz physics steps.
const prev = { x: 0, y: 0, heading: 0 };
let prevInit = false;

function syncPrevPose(f) {
  prev.x = f.x;
  prev.y = f.y;
  prev.heading = f.heading;
  prevInit = true;
}

// Smooth display pose for rendering; does not affect simulation state.
export function getFlagshipDisplayPose(state, accumulatorMs) {
  const f = state.flagship;
  if (!prevInit) syncPrevPose(f);
  if (state.paused || f.transit || !accumulatorMs) {
    return { x: f.x, y: f.y, heading: f.heading };
  }
  const t = Math.min(1, Math.max(0, accumulatorMs / TICK_MS));
  if (t === 0) return { x: f.x, y: f.y, heading: f.heading };
  const dx = f.x - prev.x;
  const dy = f.y - prev.y;
  let dHeading = f.heading - prev.heading;
  while (dHeading > Math.PI) dHeading -= 2 * Math.PI;
  while (dHeading < -Math.PI) dHeading += 2 * Math.PI;
  return {
    x: f.x + dx * t,
    y: f.y + dy * t,
    heading: f.heading + dHeading * t,
  };
}

export function setFlagshipInput(x, y) {
  input.x = x;
  input.y = y;
}

export function getFlagshipInput() {
  return { x: input.x, y: input.y };
}

// --- Lane transit ---

export function orderTravel(state, targetId) {
  const f = state.flagship;
  if (f.transit) return { ok: false, reason: 'Flagship is already in transit' };
  if (!nodeById(state.galaxy, targetId)) return { ok: false, reason: 'No such star' };
  if (targetId === f.systemId) return { ok: false, reason: 'Flagship is already in that system' };

  const path = findPath(state.galaxy, f.systemId, targetId);
  if (!path || path.length < 2) return { ok: false, reason: 'No lane route to that star' };

  f.transit = {
    path,
    legIndex: 0,
    legStartTime: state.time,
    legDurationMs: legDurationMs(state.galaxy, path[0], path[1], LANE_SPEED, LANE_MIN_LEG_MS),
  };
  f.systemId = null;
  return { ok: true, path, etaMs: transitEtaMs(state) };
}

export function transitEtaMs(state) {
  return transitEtaMsCore(
    state.flagship.transit,
    state.galaxy,
    state.time,
    LANE_SPEED,
    LANE_MIN_LEG_MS,
  );
}

export function transitStatus(state) {
  return transitStatusCore(
    state.flagship.transit,
    state.galaxy,
    state.time,
    LANE_SPEED,
    LANE_MIN_LEG_MS,
  );
}

function applyFlagshipKeepOut(state) {
  const f = state.flagship;
  if (f.transit || !f.systemId) return;
  const system = systemById(state, f.systemId);
  if (!system) return;
  const dt = TICK_MS / 1000;
  const rep = keepOutRepulsion(state, system, f.x, f.y);
  f.vx += rep.ax * dt;
  f.vy += rep.ay * dt;
}

// --- Per-tick update (called from simulation.js after state.time advances) ---

export function tickFlagship(state) {
  const f = state.flagship;
  if (!f.transit) syncPrevPose(f);
  if (f.transit) {
    advanceTransit(
      f.transit,
      state.galaxy,
      state.time,
      LANE_SPEED,
      LANE_MIN_LEG_MS,
      (destId, fromId) => arrive(state, destId, fromId),
    );
    return;
  }

  const dt = TICK_MS / 1000;
  let ax = input.x;
  let ay = input.y;
  const mag = Math.hypot(ax, ay);
  if (mag > 1e-6) {
    if (mag > 1) {
      ax /= mag;
      ay /= mag;
    }
    f.vx += ax * FLAGSHIP_ACCEL * dt;
    f.vy += ay * FLAGSHIP_ACCEL * dt;
    const speed = Math.hypot(f.vx, f.vy);
    if (speed > FLAGSHIP_MAX_SPEED) {
      f.vx = (f.vx / speed) * FLAGSHIP_MAX_SPEED;
      f.vy = (f.vy / speed) * FLAGSHIP_MAX_SPEED;
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
  if (Math.hypot(f.vx, f.vy) > 8) {
    f.heading = Math.atan2(f.vy, f.vx);
  }
}

function arrive(state, destId, fromId) {
  const f = state.flagship;
  f.transit = null;
  f.systemId = destId;

  const dest = nodeById(state.galaxy, destId);
  const from = nodeById(state.galaxy, fromId);
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
