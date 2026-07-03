// Sail shuttles — visual foundry ↔ launcher logistics (Phase 3, GDD §6).
// Positions derive from state.time; never serialized.

import { SAIL_SHUTTLE_TRIP_MS, FOUNDRY_ORBIT_OFFSET } from './constants.js';
import {
  systemById,
  planetPosition,
  moonPosition,
  hasFoundry,
  dysonLaunchers,
  findBody,
} from './state.js';

export function foundryAnchor(system) {
  const r = system.star?.radius ?? 40;
  return { x: 0, y: -(r + FOUNDRY_ORBIT_OFFSET) };
}

function launcherPosition(state, systemId, bodyId) {
  const found = findBody(state, systemId, bodyId);
  if (!found) return null;
  const system = systemById(state, systemId);
  if (found.planet) {
    const planet = system.bodies.find((p) => p.moons.some((m) => m.id === bodyId));
    const moon = planet.moons.find((m) => m.id === bodyId);
    return moonPosition(planet, moon, state.time);
  }
  const planet = found.body;
  return planetPosition(planet, state.time);
}

/** One shuttle sprite per active launcher route. */
export function sailShuttlePositions(state, systemId) {
  const result = [];
  const system = systemById(state, systemId);
  if (!system || !hasFoundry(state, systemId)) return result;

  const from = foundryAnchor(system);
  const launchers = dysonLaunchers(state, systemId);
  launchers.forEach((launcher, idx) => {
    const to = launcherPosition(state, systemId, launcher.bodyId);
    if (!to) return;
    const phase = ((state.time / SAIL_SHUTTLE_TRIP_MS) + idx / Math.max(1, launchers.length)) % 1;
    const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    result.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      outbound: phase < 0.5,
      launcherId: launcher.id,
    });
  });
  return result;
}

export function activeSailShuttleCount(state, systemId) {
  if (!hasFoundry(state, systemId)) return 0;
  return dysonLaunchers(state, systemId).length;
}

/** Recent launch burst origins for render flashes (time-modulo, no state). */
export function launchBurstOrigins(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return [];
  const dyson = system.dyson;
  if (!dyson?.launcherLastFireAt) return [];

  const bursts = [];
  for (const [launcherId, lastFire] of Object.entries(dyson.launcherLastFireAt)) {
    const age = state.time - lastFire;
    if (age < 0 || age > 600) continue;
    const launcher = system.structures.find((s) => s.id === launcherId);
    if (!launcher) continue;
    const pos = launcherPosition(state, systemId, launcher.bodyId);
    if (!pos) continue;
    bursts.push({ x: pos.x, y: pos.y, age, launcherId });
  }
  return bursts;
}
