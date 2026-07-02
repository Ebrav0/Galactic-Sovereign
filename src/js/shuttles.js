// Moon shuttles — purely visual logistics feedback (GDD §6).
// Positions derive from state.time; nothing here is ever serialized.
// System-scoped since save-v1: callers pass the system being viewed.

import { SHUTTLE_TRIP_MS } from './constants.js';
import { systemById, planetPosition, moonPosition, hasOutpost } from './state.js';

// One shuttle per moon of each outpost planet, each on a staggered
// planet -> moon -> planet loop. Returns [{x, y, outbound}] world positions.
export function shuttlePositions(state, systemId) {
  const system = systemById(state, systemId);
  const result = [];
  if (!system) return result;
  for (const planet of system.bodies) {
    if (planet.moons.length === 0) continue;
    if (!hasOutpost(state, systemId, planet.id)) continue;

    const from = planetPosition(planet, state.time);
    planet.moons.forEach((moon, idx) => {
      const to = moonPosition(planet, moon, state.time);
      // Stagger departures per moon so traffic looks organic.
      const phase = ((state.time / SHUTTLE_TRIP_MS) + idx / planet.moons.length) % 1;
      // 0..0.5 = outbound, 0.5..1 = return leg.
      const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      result.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        outbound: phase < 0.5,
      });
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
