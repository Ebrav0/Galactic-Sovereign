// Ambient ship patrol + soft keep-out zones around stars/planets (deterministic from state.time).

import {
  TICK_MS,
  CELESTIAL_VISUAL_SCALE,
  STAR_KEEP_OUT_PAD,
  STAR_KEEP_OUT_ORBIT_FRACTION,
  PLANET_KEEP_OUT_PAD,
  MOON_KEEP_OUT_PAD,
  AMBIENT_PATROL_RADIUS,
  AMBIENT_PATROL_OMEGA,
  FLEET_STATION_ORBIT_PAD,
  PLANET_ORBIT_BASE,
  KEEP_OUT_SOFT_ZONE,
  KEEP_OUT_REPULSION,
  KEEP_OUT_NUDGE_STRENGTH,
} from './constants.js';
import { planetPosition, moonPosition, hashSeed } from './state.js';
import { getStarVisualProfile } from './star-types.js';
import { stationedShipPose } from './fleets.js';

function motionSeed(key) {
  return (hashSeed(0x9a1b2c3d, key) % 10000) / 10000;
}

function patrolOffset(timeMs, seedKey, radiusScale = 1) {
  const seed = motionSeed(seedKey);
  const t = timeMs / 1000;
  const omega = AMBIENT_PATROL_OMEGA * (0.75 + seed * 0.55);
  const radius = AMBIENT_PATROL_RADIUS * radiusScale * (0.8 + seed * 0.45);
  const phase = seed * Math.PI * 2;
  const angle = t * omega + phase;
  const wobble = Math.sin(t * omega * 1.6 + phase * 1.7) * radius * 0.42;
  const cx = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * wobble;
  const cy = Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * wobble;
  const vx = -Math.sin(angle) * radius * omega + Math.cos(angle + Math.PI / 2) * wobble * omega * 1.6;
  const vy = Math.cos(angle) * radius * omega + Math.sin(angle + Math.PI / 2) * wobble * omega * 1.6;
  return { cx, cy, heading: Math.atan2(vy, vx) };
}

function addRepulsion(ax, ay, x, y, ox, oy, keepRadius, strength) {
  let dx = x - ox;
  let dy = y - oy;
  let dist = Math.hypot(dx, dy);
  const outer = keepRadius * KEEP_OUT_SOFT_ZONE;
  if (dist >= outer) return { ax, ay };

  const t = 1 - dist / outer;
  const push = t * t * strength;

  if (dist < 1e-4) {
    return { ax: ax + push, ay };
  }

  return {
    ax: ax + (dx / dist) * push,
    ay: ay + (dy / dist) * push,
  };
}

/** Innermost planetary orbit — fixed outer edge for star repulsion. */
export function starKeepOutOuterRadius(system) {
  const firstOrbit = system?.bodies?.length
    ? Math.min(...system.bodies.map((b) => b.orbitRadius))
    : PLANET_ORBIT_BASE;
  return firstOrbit * STAR_KEEP_OUT_ORBIT_FRACTION;
}

function starVisualCoronaRadius(system) {
  const star = system?.star;
  if (!star) return 320 + STAR_KEEP_OUT_PAD;

  const baseR = (star.radius ?? 200) * CELESTIAL_VISUAL_SCALE;
  if (star.kind === 'blackhole') return baseR * 4.2 + STAR_KEEP_OUT_PAD;

  const profile = getStarVisualProfile(star);
  const glowScale = profile?.glowScale ?? 3;
  return baseR * glowScale + STAR_KEEP_OUT_PAD;
}

function addStarRepulsion(ax, ay, x, y, system, strength) {
  const dist = Math.hypot(x, y);
  const outer = starKeepOutOuterRadius(system);
  if (dist >= outer) return { ax, ay };

  const t = 1 - dist / outer;
  const corona = starVisualCoronaRadius(system);
  const nearStar = dist < corona ? 1 + 0.35 * (1 - dist / corona) : 1;
  const push = t * t * strength * nearStar;

  if (dist < 1e-4) return { ax: ax + push, ay };
  return {
    ax: ax + (x / dist) * push,
    ay: ay + (y / dist) * push,
  };
}

/** Soft radial push away from stars/planets/moons (accel units for physics, or displacement scale for nudge). */
export function keepOutRepulsion(state, system, x, y, strength = KEEP_OUT_REPULSION) {
  let ax = 0;
  let ay = 0;

  ({ ax, ay } = addStarRepulsion(ax, ay, x, y, system, strength));

  for (const planet of system.bodies) {
    const pp = planetPosition(planet, state.time);
    const pKeep = planet.radius + PLANET_KEEP_OUT_PAD;
    ({ ax, ay } = addRepulsion(ax, ay, x, y, pp.x, pp.y, pKeep, strength));

    for (const moon of planet.moons) {
      const mp = moonPosition(planet, moon, state.time);
      const mKeep = moon.radius + MOON_KEEP_OUT_PAD;
      ({ ax, ay } = addRepulsion(ax, ay, x, y, mp.x, mp.y, mKeep, strength));
    }
  }

  return { ax, ay };
}

/** Integrate soft repulsion for render-only / kinematic poses. */
export function softKeepOut(state, system, x, y, passes = 10) {
  let px = x;
  let py = y;
  const step = TICK_MS / 1000;
  for (let i = 0; i < passes; i++) {
    const { ax, ay } = keepOutRepulsion(state, system, px, py, KEEP_OUT_NUDGE_STRENGTH);
    px += ax * step;
    py += ay * step;
  }
  return { x: px, y: py };
}

export function ambientShipPose(state, system, ship, idx, total) {
  const base = stationedShipPose(state, system, ship, idx, total);
  const patrol = patrolOffset(state.time, ship.id, 1);
  const raw = {
    x: base.x + patrol.cx,
    y: base.y + patrol.cy,
    heading: patrol.heading,
  };
  const safe = softKeepOut(state, system, raw.x, raw.y);
  return { x: safe.x, y: safe.y, heading: raw.heading };
}

export function pirateStationPose(state, system, idx, total) {
  const starR = system.star?.radius ?? 200;
  const orbit = starR + FLEET_STATION_ORBIT_PAD + 80;
  const angle = Math.PI + (idx / Math.max(1, total)) * Math.PI * 0.85;
  return {
    x: Math.cos(angle) * orbit,
    y: Math.sin(angle) * orbit,
    heading: angle + Math.PI / 2,
  };
}

export function ambientPiratePose(state, system, ship, fleetId, idx, total) {
  const base = pirateStationPose(state, system, idx, total);
  const patrol = patrolOffset(state.time, `${fleetId}:${ship.id}`, 1.15);
  const raw = {
    x: base.x + patrol.cx,
    y: base.y + patrol.cy,
    heading: patrol.heading,
  };
  const safe = softKeepOut(state, system, raw.x, raw.y);
  return { x: safe.x, y: safe.y, heading: raw.heading };
}

export function nudgeUnitKeepOut(state, system, unit) {
  const rep = keepOutRepulsion(state, system, unit.x, unit.y, KEEP_OUT_NUDGE_STRENGTH);
  const dt = TICK_MS / 1000;
  unit.x += rep.ax * dt;
  unit.y += rep.ay * dt;
}
