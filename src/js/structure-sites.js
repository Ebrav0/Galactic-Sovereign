// Orbital structure site positions — fixed slots from structure id (never serialized).

import {
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
  findStructure,
  dysonLaunchers,
} from './state.js';
import { shipyardBuildProgress } from './production.js';

function slotAngleFromId(id, salt = 0) {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}

function orbitRadiusForPlanet(planet) {
  if (planet.moons.length > 0) {
    const outer = Math.max(...planet.moons.map((m) => m.orbitRadius));
    return outer + planet.radius + SHIPYARD_MOON_CLEARANCE;
  }
  return planet.orbitRadius + planet.radius + SHIPYARD_ORBIT_PAD;
}

function bodyWorldPos(state, systemId, bodyId) {
  const found = findBody(state, systemId, bodyId);
  if (!found) return null;
  if (found.planet) {
    const pp = planetPosition(found.planet, state.time);
    return moonPosition(found.planet, found.body, state.time);
  }
  return planetPosition(found.body, state.time);
}

function shipyardSite(state, systemId, structure, planet) {
  const orbitR = orbitRadiusForPlanet(planet);
  const slotAngle = slotAngleFromId(structure.id, 1);
  const pp = planetPosition(planet, state.time);
  const x = pp.x + Math.cos(slotAngle) * orbitR;
  const y = pp.y + Math.sin(slotAngle) * orbitR;
  const building = structure.type === 'shipyard' && !!structure.build;
  const buildProgress = building ? shipyardBuildProgress(structure, state.time) : 0;
  return {
    kind: 'shipyard',
    planetId: planet.id,
    bodyId: planet.id,
    x,
    y,
    orbitR,
    slotAngle,
    hubHeading: slotAngle + Math.PI / 2,
    seed: slotAngleFromId(structure.id, 7) * 100,
    building,
    buildProgress,
  };
}

function launcherSite(state, systemId, structure) {
  const found = findBody(state, systemId, structure.bodyId);
  if (!found) return null;
  const host = found.body;
  const planet = found.planet ?? found.body;
  const hostPos = found.planet
    ? moonPosition(found.planet, found.body, state.time)
    : planetPosition(found.body, state.time);

  const launchersOnBody = dysonLaunchers(state, systemId).filter((l) => l.bodyId === structure.bodyId);
  const idx = launchersOnBody.findIndex((l) => l.id === structure.id);
  const baseAngle = slotAngleFromId(structure.bodyId, 3);
  const slotAngle = baseAngle + idx * LAUNCHER_ORBIT_SPREAD;
  const orbitR = (found.planet ? found.planet.orbitRadius : 0) + host.radius + LAUNCHER_ORBIT_PAD;
  const x = hostPos.x + Math.cos(slotAngle) * orbitR;
  const y = hostPos.y + Math.sin(slotAngle) * orbitR;
  const heading = Math.atan2(-y, -x);
  const muzzleX = x + Math.cos(heading) * LAUNCHER_RAIL_LENGTH;
  const muzzleY = y + Math.sin(heading) * LAUNCHER_RAIL_LENGTH;
  const dyson = systemById(state, systemId)?.dyson;
  const lastFire = dyson?.launcherLastFireAt?.[structure.id] ?? -1e9;
  const fireAge = state.time - lastFire;
  const firing = fireAge >= 0 && fireAge < LAUNCHER_BURST_MS;

  return {
    kind: 'launcher',
    bodyId: structure.bodyId,
    planetId: planet.id,
    x,
    y,
    heading,
    slotAngle,
    dockX: x,
    dockY: y,
    muzzleX,
    muzzleY,
    seed: slotAngleFromId(structure.id, 11) * 100,
    firing,
    fireAge: firing ? fireAge : null,
  };
}

export function structureSites(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return [];
  const sites = [];
  for (const structure of system.structures) {
    if (structure.type === 'shipyard') {
      const planet = system.bodies.find((b) => b.id === structure.bodyId);
      if (planet) sites.push(shipyardSite(state, systemId, structure, planet));
    } else if (structure.type === 'dyson_launcher') {
      const site = launcherSite(state, systemId, structure);
      if (site) sites.push(site);
    }
  }
  return sites;
}

export function launcherSiteById(state, systemId, launcherId) {
  const structure = findStructure(state, systemId, launcherId);
  if (!structure || structure.type !== 'dyson_launcher') return null;
  return launcherSite(state, systemId, structure);
}
