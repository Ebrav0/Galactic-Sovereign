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
  findBody,
  dysonLaunchers,
  hashSeed,
  structuresOn,
} from './state.js';
import { shipyardBuildProgress } from './production.js';
import { normalizeShipyardBuilds } from './empire-queue.js';
import { jobProgress } from './drones.js';
import { BODY_STRUCTURE_DEFS } from './body-structures.js';

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

function structureConstructionProgress(state, structure) {
  if (!structure?.construction) return 0;
  const job = (state.constructionJobs ?? []).find((j) => j.id === structure.construction.jobId);
  if (job) return jobProgress(job);
  const elapsed = state.time - (structure.construction.startedAt ?? 0);
  return Math.min(1, elapsed / (structure.construction.durationMs || 1));
}

function shipyardSite(state, systemId, planet, time = state.time) {
  const shipyard = structuresOn(state, systemId, planet.id).find((s) => s.type === 'shipyard');
  if (!shipyard) return null;

  normalizeShipyardBuilds(shipyard);
  const bodyPos = planetPosition(planet, time);
  const slotAngle = fixedSlotAngle(shipyard.id, 0x73);
  const orbitR = computeShipyardOrbitRadius(planet);
  const hullBuilding = shipyard.builds.length > 0;
  const underConstruction = !!shipyard.construction;

  return {
    kind: 'shipyard',
    planetId: planet.id,
    bodyId: planet.id,
    x: bodyPos.x + Math.cos(slotAngle) * orbitR,
    y: bodyPos.y + Math.sin(slotAngle) * orbitR,
    orbitR,
    slotAngle,
    hubHeading: slotAngle + Math.PI / 2,
    building: hullBuilding || underConstruction,
    buildProgress: underConstruction
      ? structureConstructionProgress(state, shipyard)
      : (hullBuilding ? shipyardBuildProgress(shipyard, state.time, 0) : 0),
    buildHull: shipyard.builds[0]?.hull ?? null,
    seed: hashSeed(0x9e3779b9, shipyard.id) % 97,
    shipyardId: shipyard.id,
  };
}

const RESEARCH_ORBIT_PAD = 28;
const RESEARCH_ORBIT_SPREAD = 0.42;

function researchStationSites(state, systemId, planet, time = state.time) {
  const system = systemById(state, systemId);
  if (!system) return [];

  const stations = system.structures.filter(
    (s) => s.type === 'research_station' && s.bodyId === planet.id,
  );
  if (stations.length === 0) return [];

  const bodyPos = planetPosition(planet, time);
  const baseOrbit = planet.radius * CELESTIAL_VISUAL_SCALE + RESEARCH_ORBIT_PAD;

  return stations.map((station) => {
    const orbitIndex = station.orbitIndex ?? 0;
    const slotAngle = fixedSlotAngle(station.id, 0x4a) + orbitIndex * RESEARCH_ORBIT_SPREAD;
    const orbitR = baseOrbit + orbitIndex * (RESEARCH_ORBIT_PAD * 0.55);
    const underConstruction = !!station.construction;
    return {
      kind: 'research_station',
      planetId: planet.id,
      bodyId: planet.id,
      stationId: station.id,
      x: bodyPos.x + Math.cos(slotAngle) * orbitR,
      y: bodyPos.y + Math.sin(slotAngle) * orbitR,
      orbitR,
      slotAngle,
      hubHeading: slotAngle + Math.PI / 2,
      orbitIndex,
      building: underConstruction,
      buildProgress: underConstruction ? structureConstructionProgress(state, station) : 0,
      seed: hashSeed(0xcafebabe, station.id) % 97,
    };
  });
}

function launcherSitesForBody(state, systemId, bodyId, time = state.time) {
  const world = bodyWorldPos(state, systemId, bodyId, time);
  if (!world) return [];

  const launchers = (systemById(state, systemId)?.structures ?? [])
    .filter((l) => l.type === 'dyson_launcher' && l.bodyId === bodyId);
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
    const firing = !launcher.construction && fireAge >= 0 && fireAge < LAUNCHER_BURST_MS;
    const underConstruction = !!launcher.construction;

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
      building: underConstruction,
      buildProgress: underConstruction ? structureConstructionProgress(state, launcher) : 0,
      seed: hashSeed(0xdeadbeef, launcher.id) % 97,
    });
  });

  return sites;
}

function orbitalBuildingSitesForBody(state, systemId, bodyId, time = state.time) {
  const system = systemById(state, systemId);
  const world = bodyWorldPos(state, systemId, bodyId, time);
  if (!system || !world) return [];
  return system.structures
    .filter((s) => {
      const def = BODY_STRUCTURE_DEFS[s.type];
      return def?.placement === 'orbital' && s.bodyId === bodyId;
    })
    .map((structure, idx) => {
      const slotAngle = fixedSlotAngle(structure.id, 0x88) + idx * 0.45;
      const pad = structure.type === 'drydock' ? SHIPYARD_ORBIT_PAD * 0.72 : LAUNCHER_ORBIT_PAD * 0.82;
      const anchor = bodyOrbitAnchor(world.bodyPos, world.bodyRadius, pad, slotAngle);
      return {
        kind: structure.type,
        structureType: structure.type,
        structureId: structure.id,
        planetId: world.hostPlanetId,
        bodyId,
        ...anchor,
        heading: starHeading(anchor.x, anchor.y),
        hubHeading: slotAngle + Math.PI / 2,
        active: (structure.hp ?? 1) > 0 && state.time >= (structure.disabledUntil ?? 0),
        seed: hashSeed(0xbeefcafe, structure.id) % 97,
      };
    });
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
    sites.push(...researchStationSites(state, systemId, planet, time));
    sites.push(...orbitalBuildingSitesForBody(state, systemId, planet.id, time));
    sites.push(...launcherSitesForBody(state, systemId, planet.id, time));
    for (const moon of planet.moons) {
      sites.push(...orbitalBuildingSitesForBody(state, systemId, moon.id, time));
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
