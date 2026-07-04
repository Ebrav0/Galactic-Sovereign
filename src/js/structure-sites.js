// Orbital structure anchors: shipyard ring station + sail launcher platforms (visual, deterministic).

import {
  CELESTIAL_VISUAL_SCALE,
  MOON_ORBIT_SPACING,
  SHIPYARD_ORBIT_PAD,
  SHIPYARD_MOON_CLEARANCE,
  LAUNCHER_ORBIT_PAD,
  LAUNCHER_ORBIT_SPREAD,
  LAUNCHER_RAIL_LENGTH,
  LAUNCHER_BURST_MS,
} from './constants.js';
import {
  systemById,
  planetPosition,
  moonPosition,
  findShipyardOnPlanet,
  findBody,
  dysonLaunchers,
  hashSeed,
} from './state.js';
import { shipyardBuildProgress } from './production.js';

const STAR_X = 0;
const STAR_Y = 0;

function fixedSlotAngle(structureId, salt = 0) {
  return ((hashSeed(0x5f3759df + salt, structureId) % 10000) / 10000) * Math.PI * 2;
}

function bodyWorldPos(state, systemId, bodyId, time = state.time) {
  const found = findBody(state, systemId, bodyId);
  if (!found) return null;
  if (found.planet) {
    const moonPos = moonPosition(found.planet, found.body, time);
    return { bodyPos: moonPos, bodyRadius: found.body.radius, hostPlanetId: found.planet.id };
  }
  const planet = found.body;
  return {
    bodyPos: planetPosition(planet, time),
    bodyRadius: planet.radius,
    hostPlanetId: planet.id,
  };
}

function bodyOrbitAnchor(bodyPos, bodyRadius, orbitPad, slotAngle) {
  const orbitR = bodyRadius * CELESTIAL_VISUAL_SCALE + orbitPad;
  return {
    x: bodyPos.x + Math.cos(slotAngle) * orbitR,
    y: bodyPos.y + Math.sin(slotAngle) * orbitR,
    orbitR,
    slotAngle,
  };
}

function starHeading(x, y) {
  return Math.atan2(STAR_Y - y, STAR_X - x);
}

/** Orbit radius: outside moon I, inside moon II (midpoint band). */
export function computeShipyardOrbitRadius(planet) {
  const moons = planet.moons ?? [];
  if (moons.length >= 2) {
    const inner = moons[0].orbitRadius + SHIPYARD_MOON_CLEARANCE;
    const outer = moons[1].orbitRadius - SHIPYARD_MOON_CLEARANCE;
    if (outer > inner) return inner + (outer - inner) * 0.5;
    return inner;
  }
  if (moons.length === 1) {
    const inner = moons[0].orbitRadius + SHIPYARD_MOON_CLEARANCE;
    const outer = moons[0].orbitRadius + MOON_ORBIT_SPACING - SHIPYARD_MOON_CLEARANCE;
    return inner + (outer - inner) * 0.5;
  }
  return planet.radius * CELESTIAL_VISUAL_SCALE + SHIPYARD_ORBIT_PAD;
}

function shipyardSite(state, systemId, planet, time = state.time) {
  const shipyard = findShipyardOnPlanet(state, systemId, planet.id);
  if (!shipyard) return null;

  const bodyPos = planetPosition(planet, time);
  const slotAngle = fixedSlotAngle(shipyard.id, 0x73);
  const orbitR = computeShipyardOrbitRadius(planet);
  const building = !!shipyard.build;

  return {
    kind: 'shipyard',
    planetId: planet.id,
    bodyId: planet.id,
    x: bodyPos.x + Math.cos(slotAngle) * orbitR,
    y: bodyPos.y + Math.sin(slotAngle) * orbitR,
    orbitR,
    slotAngle,
    hubHeading: slotAngle + Math.PI / 2,
    building,
    buildProgress: building ? shipyardBuildProgress(shipyard, state.time) : 0,
    buildHull: shipyard.build?.hull ?? null,
    seed: hashSeed(0x9e3779b9, shipyard.id) % 97,
    shipyardId: shipyard.id,
  };
}

function launcherSitesForBody(state, systemId, bodyId, time = state.time) {
  const world = bodyWorldPos(state, systemId, bodyId, time);
  if (!world) return [];

  const launchers = dysonLaunchers(state, systemId).filter((l) => l.bodyId === bodyId);
  const dyson = systemById(state, systemId)?.dyson;
  const sites = [];

  launchers.forEach((launcher, idx) => {
    const slotAngle = fixedSlotAngle(launcher.id, 0x2c) + idx * LAUNCHER_ORBIT_SPREAD;
    const anchor = bodyOrbitAnchor(world.bodyPos, world.bodyRadius, LAUNCHER_ORBIT_PAD, slotAngle);
    const heading = starHeading(anchor.x, anchor.y);
    const muzzleX = anchor.x + Math.cos(heading) * LAUNCHER_RAIL_LENGTH;
    const muzzleY = anchor.y + Math.sin(heading) * LAUNCHER_RAIL_LENGTH;
    const dockX = anchor.x - Math.cos(heading) * 4;
    const dockY = anchor.y - Math.sin(heading) * 4;
    const lastFire = dyson?.launcherLastFireAt?.[launcher.id] ?? 0;
    const fireAge = time - lastFire;
    const firing = fireAge >= 0 && fireAge < LAUNCHER_BURST_MS;

    sites.push({
      kind: 'launcher',
      planetId: world.hostPlanetId,
      bodyId,
      launcherId: launcher.id,
      ...anchor,
      heading,
      muzzleX,
      muzzleY,
      dockX,
      dockY,
      firing,
      fireAge,
      seed: hashSeed(0xdeadbeef, launcher.id) % 97,
    });
  });

  return sites;
}

/**
 * All orbital shipyard + launcher sites in a system.
 * @returns {Array<object>}
 */
export function structureSites(state, systemId, time = state.time) {
  const system = systemById(state, systemId);
  const sites = [];
  if (!system) return sites;

  for (const planet of system.bodies) {
    const sy = shipyardSite(state, systemId, planet, time);
    if (sy) sites.push(sy);
    sites.push(...launcherSitesForBody(state, systemId, planet.id, time));
    for (const moon of planet.moons) {
      sites.push(...launcherSitesForBody(state, systemId, moon.id, time));
    }
  }

  return sites;
}

/** Sail shuttle dock point for one launcher. */
export function launcherSiteById(state, systemId, launcherId, time = state.time) {
  return structureSites(state, systemId, time).find((s) => s.kind === 'launcher' && s.launcherId === launcherId) ?? null;
}

/** Recent firing launchers for burst rendering. */
export function activeLauncherBursts(state, systemId, time = state.time) {
  return structureSites(state, systemId, time).filter((s) => s.kind === 'launcher' && s.firing);
}
