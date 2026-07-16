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
  AMBIENT_KEEP_OUT_PASSES,
  FLEET_STATION_ORBIT_PAD,
  PLANET_ORBIT_BASE,
  KEEP_OUT_SOFT_ZONE,
  KEEP_OUT_REPULSION,
  KEEP_OUT_NUDGE_STRENGTH,
  FLEET_FOLLOW_PATROL_RADIUS,
  FLEET_FOLLOW_WANDER_RADIUS,
  FLEET_FOLLOW_WANDER_SPEED,
  FLEET_FOLLOW_MIN_HOME,
  FLEET_FOLLOW_KEEP_CAP,
} from './constants.js';
import { planetPosition, moonPosition, hashSeed } from './state.js';
import { getStarVisualProfile } from './star-types.js';
import { postBattleReturnPose, stationedShipPose } from './fleets.js';
import {
  fleetFollowHome,
} from './battle-groups.js';

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

/** Precomputed planet/moon positions for batch keep-out (one build per frame). */
export function buildKeepOutBodyCache(system, time) {
  const bodies = [];
  for (const planet of system.bodies) {
    const pp = planetPosition(planet, time);
    bodies.push({
      x: pp.x,
      y: pp.y,
      keep: planet.radius + PLANET_KEEP_OUT_PAD,
    });
    for (const moon of planet.moons) {
      const mp = moonPosition(planet, moon, time);
      bodies.push({
        x: mp.x,
        y: mp.y,
        keep: moon.radius + MOON_KEEP_OUT_PAD,
      });
    }
  }
  return bodies;
}

function keepOutRepulsionFromCache(state, system, x, y, strength, bodyCache) {
  let ax = 0;
  let ay = 0;
  ({ ax, ay } = addStarRepulsion(ax, ay, x, y, system, strength));
  for (const body of bodyCache) {
    ({ ax, ay } = addRepulsion(ax, ay, x, y, body.x, body.y, body.keep, strength));
  }
  return { ax, ay };
}

/** Soft radial push away from stars/planets/moons (accel units for physics, or displacement scale for nudge). */
export function keepOutRepulsion(state, system, x, y, strength = KEEP_OUT_REPULSION, time = state.time, bodyCache = null) {
  if (bodyCache) return keepOutRepulsionFromCache(state, system, x, y, strength, bodyCache);

  let ax = 0;
  let ay = 0;

  ({ ax, ay } = addStarRepulsion(ax, ay, x, y, system, strength));

  for (const planet of system.bodies) {
    const pp = planetPosition(planet, time);
    const pKeep = planet.radius + PLANET_KEEP_OUT_PAD;
    ({ ax, ay } = addRepulsion(ax, ay, x, y, pp.x, pp.y, pKeep, strength));

    for (const moon of planet.moons) {
      const mp = moonPosition(planet, moon, time);
      const mKeep = moon.radius + MOON_KEEP_OUT_PAD;
      ({ ax, ay } = addRepulsion(ax, ay, x, y, mp.x, mp.y, mKeep, strength));
    }
  }

  return { ax, ay };
}

/** Integrate soft repulsion for render-only / kinematic poses. */
export function softKeepOut(state, system, x, y, passes = 10, time = state.time, bodyCache = null) {
  let px = x;
  let py = y;
  const step = TICK_MS / 1000;
  for (let i = 0; i < passes; i++) {
    const { ax, ay } = keepOutRepulsion(state, system, px, py, KEEP_OUT_NUDGE_STRENGTH, time, bodyCache);
    px += ax * step;
    py += ay * step;
  }
  return { x: px, y: py };
}

/**
 * World-space escort pocket around a follow home (flagship / hero).
 * Slots are not rotated by home heading — that caused snap/stutter when turning.
 * Wander matches the starfighter Lissajous style, on a much larger sphere.
 */
function fleetFollowLocalPose(shipId, tSec) {
  const seed = motionSeed(String(shipId));
  const seedB = motionSeed(`${shipId}:b`);
  const phase = seed * Math.PI * 2;
  const slot = seed * Math.PI * 2 + seedB * 1.7;
  const homeDist = Math.max(
    FLEET_FOLLOW_MIN_HOME,
    FLEET_FOLLOW_PATROL_RADIUS * (0.32 + seed * 0.58 + seedB * 0.12),
  );
  const homeX = Math.cos(slot) * homeDist;
  const homeY = Math.sin(slot) * homeDist;

  const wander = FLEET_FOLLOW_WANDER_RADIUS * (0.75 + seed * 0.55);
  const wanderSpeed = FLEET_FOLLOW_WANDER_SPEED;
  const fx = (0.38 + seed * 0.45) * wanderSpeed;
  const fy = (0.48 + seedB * 0.5) * wanderSpeed;
  const ox =
    Math.sin(tSec * fx + phase) * wander
    + Math.sin(tSec * (fx * 1.65 + 0.25) + phase * 2.05) * wander * 0.4;
  const oy =
    Math.cos(tSec * fy + phase * 1.25) * wander * 1.25
    + Math.sin(tSec * (fy * 1.35 + 0.18) + phase * 0.65) * wander * 0.5;

  let lx = homeX + ox;
  let ly = homeY + oy;
  const maxR = FLEET_FOLLOW_PATROL_RADIUS + FLEET_FOLLOW_WANDER_RADIUS * 0.9;
  const envelope = Math.hypot(lx, ly);
  if (envelope > maxR) {
    const s = maxR / envelope;
    lx *= s;
    ly *= s;
  }

  const vxRaw = Math.cos(tSec * fx + phase) * wander * fx
    + Math.cos(tSec * (fx * 1.65 + 0.25) + phase * 2.05) * wander * 0.4 * (fx * 1.65 + 0.25);
  const vyRaw = -Math.sin(tSec * fy + phase * 1.25) * wander * 1.25 * fy
    + Math.cos(tSec * (fy * 1.35 + 0.18) + phase * 0.65) * wander * 0.5 * (fy * 1.35 + 0.18);

  return { lx, ly, vxRaw, vyRaw };
}

function softFollowKeepOut(state, system, x, y, time, bodyCache) {
  if (!system) return { x, y };
  // One soft pass + capped pull — multi-pass keep-out fought display interpolation.
  const safe = softKeepOut(state, system, x, y, 1, time, bodyCache);
  const pullX = safe.x - x;
  const pullY = safe.y - y;
  const pull = Math.hypot(pullX, pullY);
  if (pull <= FLEET_FOLLOW_KEEP_CAP || pull < 1e-6) return safe;
  const s = FLEET_FOLLOW_KEEP_CAP / pull;
  return { x: x + pullX * s, y: y + pullY * s };
}

/**
 * World pose for a stationed player ship: follow flagship/hero when co-located,
 * otherwise classic star/planet station orbit.
 * @param {object} [opts.homeOverride] optional display-smoothed home {x,y,heading,vx,vy,kind,homeId}
 */
export function playerShipWorldPose(
  state,
  system,
  ship,
  idx,
  total,
  time = state.time,
  bodyCache = null,
  { patrolScale = 1, homeOverride = null } = {},
) {
  const systemId = system?.id ?? ship?.systemId;
  const home = homeOverride ?? fleetFollowHome(state, ship, systemId);
  if (home) {
    const tSec = time / 1000;
    const local = fleetFollowLocalPose(ship.id, tSec);
    const rawTarget = {
      x: home.x + local.lx,
      y: home.y + local.ly,
      heading: home.heading,
    };
    const base = postBattleReturnPose(ship, rawTarget, time);
    const safe = softFollowKeepOut(state, system, base.x, base.y, time, bodyCache);

    // Nose faces wander + home travel (analytical), matching starfighter escorts.
    const lookDt = 0.08;
    const look = fleetFollowLocalPose(ship.id, tSec + lookDt);
    const homeVx = Number(home.vx) || 0;
    const homeVy = Number(home.vy) || 0;
    const dx = (look.lx - local.lx) + homeVx * lookDt;
    const dy = (look.ly - local.ly) + homeVy * lookDt;
    const travel = Math.hypot(dx, dy);
    const heading = travel > 1e-4
      ? Math.atan2(dy, dx)
      : (Math.hypot(local.vxRaw + homeVx, local.vyRaw + homeVy) > 1e-4
        ? Math.atan2(local.vyRaw + homeVy, local.vxRaw + homeVx)
        : (Number.isFinite(home.heading) ? home.heading : 0));

    return {
      x: safe.x,
      y: safe.y,
      heading,
      following: home.kind ?? 'flagship',
    };
  }

  const base = stationedShipPose(state, system, ship, idx, total, time);
  const patrol = patrolScale > 0 ? patrolOffset(time, ship.id, patrolScale) : { cx: 0, cy: 0, heading: base.heading };
  const raw = {
    x: base.x + (patrol.cx ?? 0),
    y: base.y + (patrol.cy ?? 0),
    heading: patrol.heading ?? base.heading,
  };
  const safe = softKeepOut(state, system, raw.x, raw.y, AMBIENT_KEEP_OUT_PASSES, time, bodyCache);
  return { x: safe.x, y: safe.y, heading: raw.heading };
}

export function ambientShipPose(
  state,
  system,
  ship,
  idx,
  total,
  time = state.time,
  bodyCache = null,
  opts = {},
) {
  return playerShipWorldPose(state, system, ship, idx, total, time, bodyCache, {
    patrolScale: 1,
    ...opts,
  });
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

export function ambientPiratePose(state, system, ship, fleetId, idx, total, time = state.time, bodyCache = null) {
  const base = pirateStationPose(state, system, idx, total);
  const patrol = patrolOffset(time, `${fleetId}:${ship.id}`, 1.15);
  const rawTarget = {
    x: base.x + patrol.cx,
    y: base.y + patrol.cy,
    heading: patrol.heading,
  };
  const raw = postBattleReturnPose(ship, rawTarget, time);
  const safe = softKeepOut(state, system, raw.x, raw.y, AMBIENT_KEEP_OUT_PASSES, time, bodyCache);
  return { x: safe.x, y: safe.y, heading: raw.heading };
}

export function nudgeUnitKeepOut(state, system, unit, bodyCache = null) {
  const rep = keepOutRepulsion(state, system, unit.x, unit.y, KEEP_OUT_NUDGE_STRENGTH, state.time, bodyCache);
  const dt = TICK_MS / 1000;
  unit.x += rep.ax * dt;
  unit.y += rep.ay * dt;
}
