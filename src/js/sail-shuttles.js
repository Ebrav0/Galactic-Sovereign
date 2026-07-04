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
  hasFoundry,
  findFoundry,
  foundryHostPlanet,
  dysonLaunchers,
  hashSeed,
} from './state.js';
import { launcherSiteById } from './structure-sites.js';
import { foundryRingClosestPoint } from './dyson-visuals.js';

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

function launcherDock(state, systemId, launcherId) {
  const site = launcherSiteById(state, systemId, launcherId);
  if (!site) return null;
  return { x: site.dockX, y: site.dockY };
}

/** One shuttle sprite per active launcher route. */
export function sailShuttlePositions(state, systemId) {
  const result = [];
  const system = systemById(state, systemId);
  if (!system || !hasFoundry(state, systemId)) return result;

  const from = foundryAnchor(state, systemId);
  const launchers = dysonLaunchers(state, systemId);
  launchers.forEach((launcher, idx) => {
    const to = launcherDock(state, systemId, launcher.id);
    if (!to || !from.foundryId) return;
    const ringFrom = foundryRingClosestPoint(from.planetX, from.planetY, from.ringR, to.x, to.y);
    const phase = ((state.time / SAIL_SHUTTLE_TRIP_MS) + idx / Math.max(1, launchers.length)) % 1;
    const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    result.push({
      x: ringFrom.x + (to.x - ringFrom.x) * t,
      y: ringFrom.y + (to.y - ringFrom.y) * t,
      outbound: phase < 0.5,
      launcherId: launcher.id,
      fromX: ringFrom.x,
      fromY: ringFrom.y,
      toX: to.x,
      toY: to.y,
    });
  });
  return result;
}

export function activeSailShuttleCount(state, systemId) {
  if (!hasFoundry(state, systemId)) return 0;
  return dysonLaunchers(state, systemId).length;
}
