// Sail shuttles — visual foundry ↔ launcher logistics (Phase 3, GDD §6).
// Positions derive from state.time; never serialized.

import {
  SAIL_SHUTTLE_TRIP_MS,
  CELESTIAL_VISUAL_SCALE,
  MOON_ORBIT_BASE,
  FOUNDRY_PLANET_PAD,
  FOUNDRY_RING_BAND_HALF,
  FOUNDRY_MOON_ORBIT_FRACTION,
  FOUNDRY_CAGE_SPIN_OMEGA,
  FOUNDRY_RING_SPIN_OMEGA,
} from './constants.js';
import {
  systemById,
  planetPosition,
  moonPosition,
  hasFoundry,
  findFoundry,
  foundryHostPlanet,
  dysonLaunchers,
  findBody,
  hashSeed,
} from './state.js';

/** Ring center radius: inside innermost moon orbit, outside planet + band thickness. */
export function computeFoundryRingRadius(planet) {
  const surfaceR = planet.radius * CELESTIAL_VISUAL_SCALE;
  const minCenter = surfaceR + FOUNDRY_PLANET_PAD + FOUNDRY_RING_BAND_HALF;
  const firstMoonOrbit = planet.moons?.[0]?.orbitRadius ?? MOON_ORBIT_BASE;
  const maxCenter = firstMoonOrbit * FOUNDRY_MOON_ORBIT_FRACTION - FOUNDRY_RING_BAND_HALF;
  if (maxCenter <= minCenter) return minCenter;
  return minCenter + (maxCenter - minCenter) * 0.5;
}

/** Deterministic spin phases for the three-ring cage (render + shuttle dock). */
export function foundryRingMotion(foundryId, time) {
  const seed = (hashSeed(0xf047d000, foundryId) % 10000) / 10000;
  const dir = seed > 0.5 ? 1 : -1;
  const t = time / 1000;
  const cageSpin = t * FOUNDRY_CAGE_SPIN_OMEGA * dir + seed * Math.PI * 2;
  const ringOffsets = [
    t * FOUNDRY_RING_SPIN_OMEGA * dir,
    t * FOUNDRY_RING_SPIN_OMEGA * -dir * 1.12,
    0,
  ];
  return {
    cageSpin,
    ringOffsets,
    dockAngle: cageSpin + Math.PI * 0.28,
  };
}

/** Sail foundry — animated orbital ring station around its host planet. */
export function foundryAnchor(state, systemId) {
  const system = systemById(state, systemId);
  const foundry = findFoundry(state, systemId);
  const planet = foundryHostPlanet(state, systemId);
  if (!system || !foundry || !planet) {
    return { x: 0, y: 0, ringR: 0, planetId: null, planetX: 0, planetY: 0, foundryId: null };
  }

  const pp = planetPosition(planet, state.time);
  const ringR = computeFoundryRingRadius(planet);
  const { dockAngle } = foundryRingMotion(foundry.id, state.time);
  return {
    x: pp.x + Math.cos(dockAngle) * ringR,
    y: pp.y + Math.sin(dockAngle) * ringR,
    ringR,
    planetId: planet.id,
    planetX: pp.x,
    planetY: pp.y,
    foundryId: foundry.id,
    dockAngle,
  };
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

  const from = foundryAnchor(state, systemId);
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
