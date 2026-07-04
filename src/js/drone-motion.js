// Construction drone motion — positions are pure functions of state.time (never serialized).

import {
  DRONE_CYCLE_MS,
  DRONE_PATROL_RADIUS,
  DRONE_TRIP_MS_MIN,
  DRONE_TRIP_MS_MAX,
  DRONE_TRIP_MS_PER_UNIT,
  DRONE_WORK_DWELL_MS,
  CELESTIAL_VISUAL_SCALE,
  SHIPYARD_ORBIT_PAD,
  LAUNCHER_ORBIT_PAD,
  LAUNCHER_ORBIT_SPREAD,
} from './constants.js';
import {
  systemById,
  planetPosition,
  moonPosition,
  findBody,
  findPlanet,
  hashSeed,
} from './state.js';
import { computeShipyardOrbitRadius } from './structure-sites.js';
import { computeFoundryRingRadius, foundryRingMotion } from './sail-shuttles.js';

const RESEARCH_ORBIT_PAD = 28;
const RESEARCH_ORBIT_SPREAD = 0.42;
const TRADE_ORBIT_PAD = 24;

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

function bezierPose(from, ctrl, to, t) {
  const u = 1 - t;
  const x = u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x;
  const y = u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y;
  const dx = 2 * u * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x);
  const dy = 2 * u * (ctrl.y - from.y) + 2 * t * (to.y - ctrl.y);
  return { x, y, heading: Math.atan2(dy, dx) };
}

function flightPose(from, to, t, bulgeSign) {
  const eased = easeInOut(t);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(80, dist * 0.14) * bulgeSign;
  const ctrl = { x: mx - (dy / dist) * bulge, y: my + (dx / dist) * bulge };
  return bezierPose(from, ctrl, to, eased);
}

function fixedSlotAngle(structureId, salt = 0) {
  return ((hashSeed(0x5f3759df + salt, structureId) % 10000) / 10000) * Math.PI * 2;
}

function flagshipHome(state) {
  const f = state.flagship;
  return { x: f.x, y: f.y };
}

function tripDurationMs(from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(
    DRONE_TRIP_MS_MAX,
    Math.max(DRONE_TRIP_MS_MIN, DRONE_TRIP_MS_MIN + dist * DRONE_TRIP_MS_PER_UNIT),
  );
}

/** World anchor for a construction job's build site. */
export function constructionSiteAnchor(state, job, time = state.time) {
  const system = systemById(state, job.systemId, job.galaxyId);
  if (!system) return { x: 0, y: 0 };

  const structureId = job.structureId;
  const bodyId = job.bodyId;
  const type = job.structureType;

  if (type === 'research_station') {
    const planet = findPlanet(state, job.systemId, bodyId, job.galaxyId)
      ?? system.bodies.find((b) => b.type === 'habitable')
      ?? system.bodies[0];
    if (!planet) return { x: 0, y: 0 };
    const bodyPos = planetPosition(planet, time);
    const orbitIndex = job.orbitIndex ?? 0;
    const slotAngle = fixedSlotAngle(structureId, 0x4a) + orbitIndex * RESEARCH_ORBIT_SPREAD;
    const orbitR = planet.radius * CELESTIAL_VISUAL_SCALE + RESEARCH_ORBIT_PAD
      + orbitIndex * (RESEARCH_ORBIT_PAD * 0.55);
    return {
      x: bodyPos.x + Math.cos(slotAngle) * orbitR,
      y: bodyPos.y + Math.sin(slotAngle) * orbitR,
    };
  }

  const found = findBody(state, job.systemId, bodyId, job.galaxyId);
  if (!found) return { x: 0, y: 0 };

  if (found.planet) {
    const moonPos = moonPosition(found.planet, found.body, time);
    if (type === 'dyson_launcher') {
      const idx = job.launcherIndex ?? 0;
      const slotAngle = fixedSlotAngle(structureId, 0x2c) + idx * LAUNCHER_ORBIT_SPREAD;
      const orbitR = found.body.radius * CELESTIAL_VISUAL_SCALE + LAUNCHER_ORBIT_PAD;
      return {
        x: moonPos.x + Math.cos(slotAngle) * orbitR,
        y: moonPos.y + Math.sin(slotAngle) * orbitR,
      };
    }
    return moonPos;
  }

  const planet = found.body;
  const bodyPos = planetPosition(planet, time);

  if (type === 'shipyard') {
    const slotAngle = fixedSlotAngle(structureId, 0x73);
    const orbitR = computeShipyardOrbitRadius(planet);
    return {
      x: bodyPos.x + Math.cos(slotAngle) * orbitR,
      y: bodyPos.y + Math.sin(slotAngle) * orbitR,
    };
  }

  if (type === 'sail_foundry') {
    const ringR = computeFoundryRingRadius(planet);
    const { dockAngle } = foundryRingMotion(structureId, time);
    return {
      x: bodyPos.x + Math.cos(dockAngle) * ringR,
      y: bodyPos.y + Math.sin(dockAngle) * ringR,
    };
  }

  if (type === 'trade_station') {
    const slotAngle = fixedSlotAngle(structureId, 0x19);
    const orbitR = planet.radius * CELESTIAL_VISUAL_SCALE + TRADE_ORBIT_PAD;
    return {
      x: bodyPos.x + Math.cos(slotAngle) * orbitR,
      y: bodyPos.y + Math.sin(slotAngle) * orbitR,
    };
  }

  // outpost — surface-adjacent orbit
  const slotAngle = fixedSlotAngle(structureId, 0x11);
  const orbitR = planet.radius * CELESTIAL_VISUAL_SCALE + 18;
  return {
    x: bodyPos.x + Math.cos(slotAngle) * orbitR,
    y: bodyPos.y + Math.sin(slotAngle) * orbitR,
  };
}

function idlePatrolPose(state, drone, time) {
  const home = flagshipHome(state);
  const seed = (hashSeed(0xd20e0000, drone.id) % 10000) / 10000;
  const t = time / 1000;
  const omega = 0.55 + seed * 0.35;
  const radius = DRONE_PATROL_RADIUS * (0.75 + seed * 0.4);
  const phase = seed * Math.PI * 2 + drone.slotIndex * 1.4;
  const angle = t * omega + phase;
  const wobble = Math.sin(t * omega * 2.1 + phase) * radius * 0.35;
  const cx = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * wobble;
  const cy = Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * wobble;
  const x = home.x + cx;
  const y = home.y + cy;
  const heading = Math.atan2(
    Math.cos(angle + Math.PI / 2) * wobble * omega * 2.1 + Math.cos(angle) * radius * omega,
    -Math.sin(angle + Math.PI / 2) * wobble * omega * 2.1 - Math.sin(angle) * radius * omega,
  );
  return { x, y, heading, phase: 'idle', working: false };
}

/**
 * Deterministic drone pose for render + observability.
 * @returns {{ x, y, heading, phase, working }}
 */
export function dronePose(state, drone, job, time = state.time) {
  if (!job || job.status === 'paused' || job.status === 'complete') {
    return idlePatrolPose(state, drone, time);
  }

  const home = flagshipHome(state);
  const site = constructionSiteAnchor(state, job, time);
  const tripMs = tripDurationMs(home, site);
  const cycleMs = tripMs * 2 + DRONE_WORK_DWELL_MS;
  const offset = (hashSeed(0xabc123, drone.id) % 1000) / 1000 * cycleMs;
  const cycleT = (time + offset) % cycleMs;

  const bulgeSign = drone.slotIndex % 2 === 0 ? 1 : -1;

  if (cycleT < tripMs) {
    const t = cycleT / tripMs;
    const pose = flightPose(home, site, t, bulgeSign);
    return { ...pose, phase: 'outbound', working: false };
  }
  if (cycleT < tripMs + DRONE_WORK_DWELL_MS) {
    return { x: site.x, y: site.y, heading: 0, phase: 'working', working: true };
  }
  const t = (cycleT - tripMs - DRONE_WORK_DWELL_MS) / tripMs;
  const pose = flightPose(site, home, t, -bulgeSign);
  return { ...pose, phase: 'returning', working: false };
}

export function dronePoses(state, systemId, time = state.time) {
  const drones = (state.drones ?? []).filter(
    (d) => d.galaxyId === state.activeGalaxyId && d.systemId === systemId,
  );
  const jobsById = new Map(
    (state.constructionJobs ?? [])
      .filter((j) => j.systemId === systemId && j.galaxyId === state.activeGalaxyId)
      .map((j) => [j.id, j]),
  );
  return drones.map((drone) => {
    const job = drone.jobId ? jobsById.get(drone.jobId) ?? null : null;
    const pose = dronePose(state, drone, job, time);
    return { drone, jobId: drone.jobId, ...pose };
  });
}

export function isDroneWorkingPhase(state, drone, job, time = state.time) {
  if (!job || job.status !== 'active') return false;
  return dronePose(state, drone, job, time).working;
}
