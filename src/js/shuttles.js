// Moon shuttles — purely visual logistics feedback (GDD §6).
// Positions derive from state.time; nothing here is ever serialized.
// System-scoped since save-v1: callers pass the system being viewed.

import {
  SHUTTLE_FLIGHT_MS,
  SHUTTLE_MOON_DWELL_MS,
  SHUTTLE_PLANET_DWELL_MS,
} from './constants.js';
import { systemById, planetPosition, moonPosition, hasOutpost } from './state.js';

const CYCLE_MS =
  SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS + SHUTTLE_FLIGHT_MS + SHUTTLE_PLANET_DWELL_MS;

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

/** Surface launch/landing pad: point on the body edge facing the target. */
function surfacePoint(bodyPos, bodyRadius, towardPos, pad = 2) {
  const dx = towardPos.x - bodyPos.x;
  const dy = towardPos.y - bodyPos.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = (bodyRadius + pad) / d;
  return { x: bodyPos.x + dx * k, y: bodyPos.y + dy * k };
}

/** Quadratic bezier point + tangent heading. */
function bezierPose(from, ctrl, to, t) {
  const u = 1 - t;
  const x = u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x;
  const y = u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y;
  const dx = 2 * u * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x);
  const dy = 2 * u * (ctrl.y - from.y) + 2 * t * (to.y - ctrl.y);
  return { x, y, heading: Math.atan2(dy, dx) };
}

/** Wing spread 0 (folded/landed) → 1 (full flight sweep). */
function wingSpreadForFlight(t) {
  const deploy = Math.min(1, t / 0.18);
  const stow = Math.min(1, (1 - t) / 0.18);
  return easeInOut(Math.min(deploy, stow));
}

function flightPose(from, to, t, bulgeSign) {
  const eased = easeInOut(t);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Gentle arc perpendicular to the route so trips read as flown, not lerped.
  const bulge = Math.min(60, dist * 0.16) * bulgeSign;
  const ctrl = { x: mx - (dy / dist) * bulge, y: my + (dx / dist) * bulge };
  return bezierPose(from, ctrl, to, eased);
}

// One shuttle per moon of each outpost planet, each on a staggered
// planet -> moon (dwell) -> planet (turnaround) loop.
// Returns [{x, y, heading, phase, wingSpread, thrusting, seed}] world entries.
export function shuttlePositions(state, systemId) {
  const system = systemById(state, systemId);
  const result = [];
  if (!system) return result;
  for (const planet of system.bodies) {
    if (planet.moons.length === 0) continue;
    if (!hasOutpost(state, systemId, planet.id)) continue;

    const planetPos = planetPosition(planet, state.time);
    planet.moons.forEach((moon, idx) => {
      const moonPos = moonPosition(planet, moon, state.time);
      const pad = surfacePoint(planetPos, planet.radius, moonPos, 3);
      const moonPad = surfacePoint(moonPos, moon.radius, planetPos, 2);

      // Stagger departures per moon so traffic looks organic.
      const offset = (idx / planet.moons.length) * CYCLE_MS;
      const cycleT = (state.time + offset) % CYCLE_MS;
      const bulgeSign = idx % 2 === 0 ? 1 : -1;
      const seed = (planet.id.length * 31 + idx * 7) % 97;

      let entry;
      if (cycleT < SHUTTLE_FLIGHT_MS) {
        // Outbound: planet surface -> moon surface.
        const t = cycleT / SHUTTLE_FLIGHT_MS;
        const pose = flightPose(pad, moonPad, t, bulgeSign);
        entry = { ...pose, phase: 'outbound', wingSpread: wingSpreadForFlight(t), thrusting: true };
      } else if (cycleT < SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS) {
        // Parked on the moon (tracks the moon as it orbits).
        const toPlanet = Math.atan2(planetPos.y - moonPos.y, planetPos.x - moonPos.x);
        entry = {
          x: moonPad.x,
          y: moonPad.y,
          heading: toPlanet,
          phase: 'dwell-moon',
          wingSpread: 0,
          thrusting: false,
        };
      } else if (cycleT < SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS + SHUTTLE_FLIGHT_MS) {
        // Return: moon surface -> planet surface.
        const t = (cycleT - SHUTTLE_FLIGHT_MS - SHUTTLE_MOON_DWELL_MS) / SHUTTLE_FLIGHT_MS;
        const pose = flightPose(moonPad, pad, t, -bulgeSign);
        entry = { ...pose, phase: 'return', wingSpread: wingSpreadForFlight(t), thrusting: true };
      } else {
        // Turnaround on the planet surface.
        const toMoon = Math.atan2(moonPos.y - planetPos.y, moonPos.x - planetPos.x);
        entry = {
          x: pad.x,
          y: pad.y,
          heading: toMoon,
          phase: 'dwell-planet',
          wingSpread: 0,
          thrusting: false,
        };
      }
      entry.outbound = entry.phase === 'outbound';
      entry.seed = seed;
      result.push(entry);
    });
  }
  return result;
}

export function activeShuttleCount(state, systemId) {
  const system = systemById(state, systemId);
  let count = 0;
  if (!system) return count;
  for (const planet of system.bodies) {
    if (planet.moons.length > 0 && hasOutpost(state, systemId, planet.id)) {
      count += planet.moons.length;
    }
  }
  return count;
}
