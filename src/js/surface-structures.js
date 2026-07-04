// Surface pad/rig positions for outpost shuttle routes (never serialized).

import {
  SHUTTLE_FLIGHT_MS,
  SHUTTLE_MOON_DWELL_MS,
  SHUTTLE_PLANET_DWELL_MS,
} from './constants.js';
import { systemById, planetPosition, moonPosition, hasOutpost } from './state.js';

const CYCLE_MS =
  SHUTTLE_FLIGHT_MS + SHUTTLE_MOON_DWELL_MS + SHUTTLE_FLIGHT_MS + SHUTTLE_PLANET_DWELL_MS;

export function surfacePoint(bodyPos, bodyRadius, towardPos, pad = 2) {
  const dx = towardPos.x - bodyPos.x;
  const dy = towardPos.y - bodyPos.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = (bodyRadius + pad) / d;
  return { x: bodyPos.x + dx * k, y: bodyPos.y + dy * k };
}

function shuttlePhase(state, idx, moonCount) {
  const offset = (idx / moonCount) * CYCLE_MS;
  const cycleT = (state.time + offset) % CYCLE_MS;
  const outboundEnd = SHUTTLE_PLANET_DWELL_MS + SHUTTLE_FLIGHT_MS;
  const moonEnd = outboundEnd + SHUTTLE_MOON_DWELL_MS;
  if (cycleT < SHUTTLE_PLANET_DWELL_MS) return 'planet-dwell';
  if (cycleT < outboundEnd) return 'outbound';
  if (cycleT < moonEnd) return 'moon-dwell';
  return 'inbound';
}

export function outpostSurfaceSites(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return [];
  const sites = [];
  for (const planet of system.bodies) {
    if (!planet.moons.length || !hasOutpost(state, systemId, planet.id)) continue;
    const planetPos = planetPosition(planet, state.time);
    planet.moons.forEach((moon, idx) => {
      const moonPos = moonPosition(planet, moon, state.time);
      const phase = shuttlePhase(state, idx, planet.moons.length);
      const planetPad = surfacePoint(planetPos, planet.radius, moonPos, 3);
      const moonPad = surfacePoint(moonPos, moon.radius, planetPos, 2);
      const rigOffset = surfacePoint(moonPos, moon.radius + 8, planetPos, 4);

      sites.push({
        kind: 'planet-pad',
        planetId: planet.id,
        moonId: null,
        x: planetPad.x,
        y: planetPad.y,
        heading: Math.atan2(moonPos.y - planetPos.y, moonPos.x - planetPos.x),
        active: phase === 'planet-dwell' || phase === 'outbound',
      });
      sites.push({
        kind: 'moon-pad',
        planetId: planet.id,
        moonId: moon.id,
        x: moonPad.x,
        y: moonPad.y,
        heading: Math.atan2(planetPos.y - moonPos.y, planetPos.x - moonPos.x),
        active: phase === 'moon-dwell' || phase === 'inbound',
      });
      sites.push({
        kind: 'moon-rig',
        planetId: planet.id,
        moonId: moon.id,
        x: rigOffset.x,
        y: rigOffset.y,
        heading: Math.atan2(planetPos.y - moonPos.y, planetPos.x - moonPos.x),
        active: phase !== 'planet-dwell',
        seed: (planet.id.length * 17 + idx * 5) % 97,
      });
    });
  }
  return sites;
}
