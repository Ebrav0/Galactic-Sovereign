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
import { findPath, nodeById, laneLength } from './galaxy.js';
import { systemById } from './state.js';

// Current thrust vector, set by input (or test hooks). Visual-only in the
// sense of never being serialized; ticks read it as the pilot's live order.
const input = { x: 0, y: 0 };

export function setFlagshipInput(x, y) {
  input.x = x;
  input.y = y;
}

export function getFlagshipInput() {
  return { x: input.x, y: input.y };
}

// --- Lane transit ---

export function legDurationMs(galaxy, idA, idB) {
  return Math.max(LANE_MIN_LEG_MS, Math.round((laneLength(galaxy, idA, idB) / LANE_SPEED) * 1000));
}

// Returns {ok, path, etaMs} or {ok:false, reason} — UI shows the reason verbatim.
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
    legDurationMs: legDurationMs(state.galaxy, path[0], path[1]),
  };
  f.systemId = null;
  return { ok: true, path, etaMs: transitEtaMs(state) };
}

// Remaining travel time; pure function of state.time and the transit record.
export function transitEtaMs(state) {
  const t = state.flagship.transit;
  if (!t) return 0;
  let eta = Math.max(0, t.legStartTime + t.legDurationMs - state.time);
  for (let i = t.legIndex + 1; i < t.path.length - 1; i++) {
    eta += legDurationMs(state.galaxy, t.path[i], t.path[i + 1]);
  }
  return eta;
}

// Galaxy-map position of an in-transit flagship, or null when not in transit.
export function transitStatus(state) {
  const t = state.flagship.transit;
  if (!t) return null;
  const fromId = t.path[t.legIndex];
  const toId = t.path[t.legIndex + 1];
  const from = nodeById(state.galaxy, fromId);
  const to = nodeById(state.galaxy, toId);
  const progress = Math.min(1, Math.max(0, (state.time - t.legStartTime) / t.legDurationMs));
  return {
    fromId,
    toId,
    destId: t.path[t.path.length - 1],
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    angle: Math.atan2(to.y - from.y, to.x - from.x),
    progress,
    etaMs: transitEtaMs(state),
  };
}

// --- Per-tick update (called from simulation.js after state.time advances) ---

export function tickFlagship(state) {
  const f = state.flagship;
  if (f.transit) {
    advanceTransit(state);
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

  f.x += f.vx * dt;
  f.y += f.vy * dt;
  if (Math.hypot(f.vx, f.vy) > 8) {
    f.heading = Math.atan2(f.vy, f.vx);
  }
}

// Legs chain off exact leg-end times (not wall clock) so a large advanceTime
// jump completes multiple legs deterministically.
function advanceTransit(state) {
  const f = state.flagship;
  while (f.transit) {
    const t = f.transit;
    const legEnd = t.legStartTime + t.legDurationMs;
    if (state.time < legEnd) return;
    if (t.legIndex + 2 >= t.path.length) {
      arrive(state, t.path[t.path.length - 1], t.path[t.path.length - 2]);
      return;
    }
    t.legIndex += 1;
    t.legStartTime = legEnd;
    t.legDurationMs = legDurationMs(state.galaxy, t.path[t.legIndex], t.path[t.legIndex + 1]);
  }
}

function arrive(state, destId, fromId) {
  const f = state.flagship;
  f.transit = null;
  f.systemId = destId;

  // Enter at the system edge on the side facing the star we came from,
  // pointed at the local star.
  const dest = nodeById(state.galaxy, destId);
  const from = nodeById(state.galaxy, fromId);
  const entryAngle = Math.atan2(from.y - dest.y, from.x - dest.x);
  const entryRadius = systemEntryRadius(state, destId);
  f.x = Math.cos(entryAngle) * entryRadius;
  f.y = Math.sin(entryAngle) * entryRadius;
  f.vx = 0;
  f.vy = 0;
  f.heading = entryAngle + Math.PI;
}

function systemEntryRadius(state, systemId) {
  const system = systemById(state, systemId);
  const maxOrbit = system.bodies.reduce((m, b) => Math.max(m, b.orbitRadius), 0);
  return Math.max(FLAGSHIP_ENTRY_MIN_RADIUS, maxOrbit + FLAGSHIP_ENTRY_MARGIN);
}
