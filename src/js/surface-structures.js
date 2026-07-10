// Outpost surface sites: landing pads + moon mining rigs (visual, deterministic from state.time).
// Shuttle routes in shuttles.js use the same pad positions.

import {
  SHUTTLE_FLIGHT_MS,
  SHUTTLE_MOON_DWELL_MS,
  SHUTTLE_PLANET_DWELL_MS,
} from './constants.js';
import { systemById, planetPosition, moonPosition, hasOutpost, hashSeed } from './state.js';
import {
  BODY_STRUCTURE_DEFS,
  isOperationalStructure,
  structureLevel,
} from './body-structures.js';

const CYCLE_MS =
  SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS + SHUTTLE_FLIGHT_MS + SHUTTLE_PLANET_DWELL_MS;

/** Point on a body limb facing another world — shuttle touchdown / launch site. */
export function surfacePoint(bodyPos, bodyRadius, towardPos, pad = 2) {
  const dx = towardPos.x - bodyPos.x;
  const dy = towardPos.y - bodyPos.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = (bodyRadius + pad) / d;
  return { x: bodyPos.x + dx * k, y: bodyPos.y + dy * k };
}

function padHeading(from, toward) {
  return Math.atan2(toward.y - from.y, toward.x - from.x);
}

function miningRigSite(moonPos, moonRadius, padPoint, seed) {
  const padAngle = Math.atan2(padPoint.y - moonPos.y, padPoint.x - moonPos.x);
  const offset = (seed % 2 === 0 ? 1 : -1) * (0.55 + (seed % 5) * 0.08);
  const rigAngle = padAngle + offset;
  const r = moonRadius + 1.5;
  return {
    x: moonPos.x + Math.cos(rigAngle) * r,
    y: moonPos.y + Math.sin(rigAngle) * r,
    heading: rigAngle + Math.PI / 2,
  };
}

function shuttleCyclePhase(time, planet, moonIdx) {
  const offset = (moonIdx / planet.moons.length) * CYCLE_MS;
  return (time + offset) % CYCLE_MS;
}

function surfaceBuildingSitesForBody(
  state,
  systemId,
  system,
  bodyId,
  bodyPos,
  bodyRadius,
  planetId,
  moonId = null,
) {
  return system.structures
    .filter((structure) => {
      const def = BODY_STRUCTURE_DEFS[structure.type];
      return def?.placement === 'surface' && structure.bodyId === bodyId;
    })
    .map((structure, idx) => {
      const seed = hashSeed(0x51f15e, structure.id);
      const angle = ((seed % 10000) / 10000) * Math.PI * 2 + idx * 0.31;
      const r = bodyRadius + 2.6 + (idx % 3) * 1.2;
      return {
        kind: `surface-${structure.type}`,
        structureType: structure.type,
        structureId: structure.id,
        placement: 'surface',
        level: structureLevel(structure),
        x: bodyPos.x + Math.cos(angle) * r,
        y: bodyPos.y + Math.sin(angle) * r,
        heading: angle + Math.PI / 2,
        active: isOperationalStructure(state, structure, { systemId }),
        planetId,
        moonId,
        seed: seed % 97,
      };
    });
}

/**
 * Landing pads and mining rigs for outpost worlds.
 * @returns {Array<{kind, x, y, heading, active, planetId, moonId?, seed}>}
 */
export function outpostSurfaceSites(state, systemId, time = state.time) {
  const system = systemById(state, systemId);
  const sites = [];
  if (!system) return sites;

  for (const planet of system.bodies) {
    const planetPos = planetPosition(planet, time);
    sites.push(...surfaceBuildingSitesForBody(
      state, systemId, system, planet.id, planetPos, planet.radius, planet.id,
    ));

    for (const moon of planet.moons) {
      const moonPos = moonPosition(planet, moon, time);
      sites.push(...surfaceBuildingSitesForBody(
        state, systemId, system, moon.id, moonPos, moon.radius, planet.id, moon.id,
      ));
    }

    if (!hasOutpost(state, systemId, planet.id) || planet.moons.length === 0) continue;

    planet.moons.forEach((moon, idx) => {
      const moonPos = moonPosition(planet, moon, time);
      const planetPad = surfacePoint(planetPos, planet.radius, moonPos, 3);
      const moonPad = surfacePoint(moonPos, moon.radius, planetPos, 2);
      const cycleT = shuttleCyclePhase(time, planet, idx);
      const seed = (planet.id.length * 31 + idx * 7) % 97;

      const planetDwell =
        cycleT >= SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS + SHUTTLE_FLIGHT_MS;
      const moonDwell =
        cycleT >= SHUTTLE_FLIGHT_MS && cycleT < SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS;
      const outbound = cycleT < SHUTTLE_FLIGHT_MS;
      const inbound =
        cycleT >= SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS &&
        cycleT < SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS + SHUTTLE_FLIGHT_MS;

      sites.push({
        kind: 'planet-pad',
        x: planetPad.x,
        y: planetPad.y,
        heading: padHeading(planetPad, moonPos),
        active: planetDwell || outbound,
        planetId: planet.id,
        moonId: moon.id,
        seed,
      });

      sites.push({
        kind: 'moon-pad',
        x: moonPad.x,
        y: moonPad.y,
        heading: padHeading(moonPad, planetPos),
        active: moonDwell || inbound,
        planetId: planet.id,
        moonId: moon.id,
        seed,
      });

      const rig = miningRigSite(moonPos, moon.radius, moonPad, seed);
      sites.push({
        kind: 'moon-rig',
        x: rig.x,
        y: rig.y,
        heading: rig.heading,
        active: moonDwell || inbound || outbound,
        planetId: planet.id,
        moonId: moon.id,
        seed,
      });
    });
  }

  return sites;
}
