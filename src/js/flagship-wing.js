// Ambient flagship fighter wing — wander/follow poses (deterministic from time).

import {
  FLAGSHIP_WING_SPEC,
  FLAGSHIP_WING_PATROL_RADIUS,
  FLAGSHIP_WING_WANDER_RADIUS,
  FLAGSHIP_WING_DRAW_SCALE,
  FLAGSHIP_WING_REPLENISH_MS,
  FLAGSHIP_RADIUS,
} from './constants.js';

export function flagshipWingCapacity(spec = FLAGSHIP_WING_SPEC) {
  return Object.values(spec).reduce((n, count) => n + count, 0);
}

export function flagshipWingLoadout(spec = FLAGSHIP_WING_SPEC) {
  const out = [];
  for (const [hull, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) out.push(hull);
  }
  return out;
}

export function createDefaultFlagshipWing(spec = FLAGSHIP_WING_SPEC) {
  const capacity = flagshipWingCapacity(spec);
  return {
    capacity,
    ready: capacity,
    losses: 0,
    launched: 0,
    rearmUntil: 0,
    complement: { ...spec },
  };
}

export function ensureFlagshipWing(state) {
  if (!state?.flagship) return null;
  if (!state.flagship.wing) {
    state.flagship.wing = createDefaultFlagshipWing();
  }
  const wing = state.flagship.wing;
  const capacity = flagshipWingCapacity(wing.complement ?? FLAGSHIP_WING_SPEC);
  wing.capacity = capacity;
  wing.ready = Math.min(capacity, Math.max(0, Math.floor(wing.ready ?? capacity)));
  wing.losses = Math.max(0, Math.floor(wing.losses ?? Math.max(0, capacity - wing.ready)));
  wing.launched = Math.max(0, Math.floor(wing.launched ?? 0));
  wing.rearmUntil = wing.rearmUntil ?? 0;
  return wing;
}

export function tickFlagshipWing(state) {
  const wing = ensureFlagshipWing(state);
  if (!wing) return;
  if (wing.ready >= wing.capacity) return;
  if (state.time < (wing.rearmUntil ?? 0)) return;
  const atStronghold = state.flagship?.systemId === state.stronghold
    && !state.flagship?.transit
    && !state.flagship?.wormholeTransit;
  if (!atStronghold) return;
  wing.ready = Math.min(wing.capacity, wing.ready + 1);
  wing.losses = Math.max(0, wing.capacity - wing.ready);
  if (wing.ready < wing.capacity) {
    wing.rearmUntil = state.time + FLAGSHIP_WING_REPLENISH_MS;
  }
}

function hash01(seed) {
  let x = (seed * 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/**
 * Deterministic escort poses around the flagship. Hidden during lane/wormhole transit.
 * Pass homeOverride when the display pose is already known (system view).
 * @returns {Array<{ id, hull, x, y, heading, index }>}
 */
export function flagshipWingPoses(state, accumulatorMs = 0, homeOverride = null) {
  const f = state?.flagship;
  if (!f) return [];
  if (f.transit || f.wormholeTransit) return [];
  if (f.galaxyId !== state.activeGalaxyId) return [];

  const wing = ensureFlagshipWing(state);
  const ready = Math.floor(wing?.ready ?? 0);
  if (ready <= 0) return [];

  const battle = state.systemBattles?.[f.systemId];
  if (battle?.active && battle.mode === 'tactical') {
    const liveWings = (battle.units ?? []).some((u) => u.isWing && u.parentCarrierId === 'flagship' && u.hp > 0);
    if (liveWings) return [];
  }

  const pose = homeOverride ?? {
    x: f.x,
    y: f.y,
    heading: f.heading ?? 0,
  };
  const loadout = flagshipWingLoadout(wing.complement ?? FLAGSHIP_WING_SPEC).slice(0, ready);
  const t = (state.time + accumulatorMs) / 1000;
  const speed = Math.hypot(f.vx ?? 0, f.vy ?? 0);
  const thrusting = speed > 40;

  const n = Math.max(1, loadout.length);
  return loadout.map((hull, i) => {
    const seed = hash01(i * 97 + 13);
    const seedB = hash01(i * 191 + 41);
    const phase = seed * Math.PI * 2;
    // Irregular home pockets — varied range + angular jitter so it isn't a ring.
    const slot = (i / n) * Math.PI * 2 + seed * 1.15 + seedB * 0.4;
    const homeDist = FLAGSHIP_WING_PATROL_RADIUS * (0.22 + seed * 0.68 + seedB * 0.1);
    const homeX = Math.cos(slot) * homeDist;
    const homeY = Math.sin(slot) * homeDist;

    // Contained Lissajous wander inside each pocket (no sweeping orbit).
    // Extra vertical amplitude so the cloud reads taller / higher.
    const wander = FLAGSHIP_WING_WANDER_RADIUS * (0.7 + seed * 0.65);
    const fx = 0.42 + seed * 0.5;
    const fy = 0.55 + seedB * 0.55;
    const ox =
      Math.sin(t * fx + phase) * wander
      + Math.sin(t * (fx * 1.7 + 0.3) + phase * 2.1) * wander * 0.42;
    const oy =
      Math.cos(t * fy + phase * 1.3) * wander * 1.35
      + Math.sin(t * (fy * 1.4 + 0.2) + phase * 0.7) * wander * 0.55;

    // Soft clamp to the wander envelope; follow flagship pose with no trail lag.
    let lx = homeX + ox;
    let ly = homeY + oy;
    const maxR = FLAGSHIP_WING_PATROL_RADIUS + FLAGSHIP_WING_WANDER_RADIUS * 0.85;
    const dist = Math.hypot(lx, ly);
    if (dist > maxR) {
      const s = maxR / dist;
      lx *= s;
      ly *= s;
    }

    const x = pose.x + lx;
    const y = pose.y + ly;

    // Face local wander velocity (or flagship heading while thrusting).
    const vx = Math.cos(t * fx + phase) * wander * fx
      + Math.cos(t * (fx * 1.7 + 0.3) + phase * 2.1) * wander * 0.42 * (fx * 1.7 + 0.3);
    const vy = -Math.sin(t * fy + phase * 1.3) * wander * 1.35 * fy
      + Math.cos(t * (fy * 1.4 + 0.2) + phase * 0.7) * wander * 0.55 * (fy * 1.4 + 0.2);
    const wanderHeading = Math.atan2(vy, vx);
    const heading = thrusting ? pose.heading + (seed - 0.5) * 0.35 : wanderHeading;
    return {
      id: `flagship-wing-${i}`,
      hull,
      x,
      y,
      heading,
      index: i,
      radius: FLAGSHIP_RADIUS * FLAGSHIP_WING_DRAW_SCALE,
    };
  });
}

export function flagshipWingSummary(state) {
  const wing = ensureFlagshipWing(state);
  if (!wing) return null;
  return {
    capacity: wing.capacity,
    ready: wing.ready,
    losses: wing.losses,
    launched: wing.launched,
    rearmUntil: wing.rearmUntil,
    poses: flagshipWingPoses(state).length,
  };
}
