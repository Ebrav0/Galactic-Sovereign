// Ambient flagship fighter wing — wander/follow poses (deterministic from time).

import {
  FLAGSHIP_WING_SPEC,
  FLAGSHIP_WING_PATROL_RADIUS,
  FLAGSHIP_WING_WANDER_RADIUS,
  FLAGSHIP_WING_DRAW_SCALE,
  FLAGSHIP_WING_WANDER_SPEED,
  FLAGSHIP_WING_REPLENISH_MS,
  FLAGSHIP_WING_RECALL_MS,
  FLAGSHIP_WING_LAUNCH_MS,
  FLAGSHIP_WING_HULL_CLEARANCE,
  FLAGSHIP_WING_KEEP_SOFT_ZONE,
  FLAGSHIP_RADIUS,
} from './constants.js';
import { systemById } from './state.js';
import { softKeepOut, buildKeepOutBodyCache } from './ship-motion.js';

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
    hangar: 'deployed',
    hangarAnimStartedAt: 0,
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
  if (wing.hangar !== 'deployed' && wing.hangar !== 'recalling'
    && wing.hangar !== 'stowed' && wing.hangar !== 'launching') {
    wing.hangar = 'deployed';
  }
  wing.hangarAnimStartedAt = wing.hangarAnimStartedAt ?? 0;
  return wing;
}

function easeInCubic(t) {
  return t * t * t;
}

function easeOutCubic(t) {
  return 1 - ((1 - t) ** 3);
}

export function tickFlagshipWing(state) {
  const wing = ensureFlagshipWing(state);
  if (!wing) return;

  if (wing.hangar === 'recalling') {
    if (state.time - (wing.hangarAnimStartedAt ?? 0) >= FLAGSHIP_WING_RECALL_MS) {
      wing.hangar = 'stowed';
      wing.hangarAnimStartedAt = 0;
    }
  } else if (wing.hangar === 'launching') {
    if (state.time - (wing.hangarAnimStartedAt ?? 0) >= FLAGSHIP_WING_LAUNCH_MS) {
      wing.hangar = 'deployed';
      wing.hangarAnimStartedAt = 0;
    }
  }

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

/** Recall escort fighters — they fly into the flagship hangar. */
export function recallFlagshipWing(state) {
  const wing = ensureFlagshipWing(state);
  if (!wing) return { ok: false, reason: 'No flagship wing' };
  if (wing.hangar === 'stowed' || wing.hangar === 'recalling') {
    return { ok: true, hangar: wing.hangar, already: true };
  }
  if ((wing.ready ?? 0) <= 0) return { ok: false, reason: 'No escorts ready' };
  wing.hangar = 'recalling';
  wing.hangarAnimStartedAt = state.time;
  return { ok: true, hangar: 'recalling' };
}

/** Launch escort fighters from the hangar back to patrol. */
export function launchFlagshipWing(state) {
  const wing = ensureFlagshipWing(state);
  if (!wing) return { ok: false, reason: 'No flagship wing' };
  if (wing.hangar === 'deployed' || wing.hangar === 'launching') {
    return { ok: true, hangar: wing.hangar, already: true };
  }
  if ((wing.ready ?? 0) <= 0) return { ok: false, reason: 'No escorts ready' };
  wing.hangar = 'launching';
  wing.hangarAnimStartedAt = state.time;
  return { ok: true, hangar: 'launching' };
}

/** Toggle hangar: deployed → recall, stowed → launch. */
export function toggleFlagshipWingHangar(state) {
  const wing = ensureFlagshipWing(state);
  if (!wing) return { ok: false, reason: 'No flagship wing' };
  if (wing.hangar === 'stowed' || wing.hangar === 'recalling') {
    return launchFlagshipWing(state);
  }
  return recallFlagshipWing(state);
}

function hash01(seed) {
  let x = (seed * 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

function flagshipKeepRadii() {
  const coreR = FLAGSHIP_RADIUS + FLAGSHIP_WING_HULL_CLEARANCE * 0.55;
  const outerR = (FLAGSHIP_RADIUS + FLAGSHIP_WING_HULL_CLEARANCE) * FLAGSHIP_WING_KEEP_SOFT_ZONE;
  return { coreR, outerR };
}

/**
 * Gradual flagship keep-out: quadratic falloff + light tangential swirl so escorts
 * curve around the hull instead of bouncing off a hard sphere.
 * Single light pass — multi-pass snaps fought display interpolation and hitching.
 */
function softClearFlagshipHull(pose, x, y, swirlSign = 1) {
  const { coreR, outerR } = flagshipKeepRadii();
  const dx = x - pose.x;
  const dy = y - pose.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= outerR) return { x, y };
  if (dist < 1e-5) return { x: pose.x + coreR, y: pose.y };
  const nx = dx / dist;
  const ny = dy / dist;
  const t = 1 - dist / outerR;
  const falloff = t * t;
  const nearCore = dist < coreR ? (1 - dist / coreR) : 0;
  const radialPush = falloff * (outerR - coreR) * 0.14 + nearCore * nearCore * coreR * 0.28;
  let px = x + nx * radialPush;
  let py = y + ny * radialPush;
  const swirl = falloff * falloff * 2.0;
  px += (-ny * swirlSign) * swirl;
  py += (nx * swirlSign) * swirl;
  return { x: px, y: py };
}

function craftLocalPose(i, n, tSec, outerR) {
  const seed = hash01(i * 97 + 13);
  const seedB = hash01(i * 191 + 41);
  const phase = seed * Math.PI * 2;
  const swirlSign = seed > 0.5 ? 1 : -1;
  const slot = (i / n) * Math.PI * 2 + seed * 1.15 + seedB * 0.4;
  const homeDist = Math.max(
    outerR * 0.72,
    FLAGSHIP_WING_PATROL_RADIUS * (0.28 + seed * 0.62 + seedB * 0.1),
  );
  const homeX = Math.cos(slot) * homeDist;
  const homeY = Math.sin(slot) * homeDist;

  const wander = FLAGSHIP_WING_WANDER_RADIUS * (0.7 + seed * 0.65);
  const wanderSpeed = FLAGSHIP_WING_WANDER_SPEED;
  const fx = (0.42 + seed * 0.5) * wanderSpeed;
  const fy = (0.55 + seedB * 0.55) * wanderSpeed;
  const ox =
    Math.sin(tSec * fx + phase) * wander
    + Math.sin(tSec * (fx * 1.7 + 0.3) + phase * 2.1) * wander * 0.42;
  const oy =
    Math.cos(tSec * fy + phase * 1.3) * wander * 1.35
    + Math.sin(tSec * (fy * 1.4 + 0.2) + phase * 0.7) * wander * 0.55;

  let lx = homeX + ox;
  let ly = homeY + oy;
  const maxR = FLAGSHIP_WING_PATROL_RADIUS + FLAGSHIP_WING_WANDER_RADIUS * 0.85;
  const envelope = Math.hypot(lx, ly);
  if (envelope > maxR) {
    const s = maxR / envelope;
    lx *= s;
    ly *= s;
  }

  const vxRaw = Math.cos(tSec * fx + phase) * wander * fx
    + Math.cos(tSec * (fx * 1.7 + 0.3) + phase * 2.1) * wander * 0.42 * (fx * 1.7 + 0.3);
  const vyRaw = -Math.sin(tSec * fy + phase * 1.3) * wander * 1.35 * fy
    + Math.cos(tSec * (fy * 1.4 + 0.2) + phase * 0.7) * wander * 0.55 * (fy * 1.4 + 0.2);

  return { lx, ly, vxRaw, vyRaw, swirlSign, seed, homeX, homeY };
}

function resolveDeployedWorldPose(state, system, pose, local, time, bodyCache = null) {
  let x = pose.x + local.lx;
  let y = pose.y + local.ly;
  if (system) {
    // One soft pass + shared body cache. Extra passes yanked escorts frame-to-frame.
    const safe = softKeepOut(state, system, x, y, 1, time, bodyCache);
    const pullX = safe.x - x;
    const pullY = safe.y - y;
    const pull = Math.hypot(pullX, pullY);
    // Cap celestial correction so keep-out never teleports a craft mid-wander.
    const maxPull = 6;
    if (pull > maxPull) {
      const s = maxPull / pull;
      x += pullX * s;
      y += pullY * s;
    } else {
      x = safe.x;
      y = safe.y;
    }
  }
  return softClearFlagshipHull(pose, x, y, local.swirlSign);
}

function headingFromDelta(dx, dy, fallback = 0) {
  if (Math.hypot(dx, dy) > 1e-5) return Math.atan2(dy, dx);
  return fallback;
}

/**
 * Deterministic escort poses around the flagship. Hidden during lane/wormhole transit
 * and while fully stowed in the hangar.
 * Nose faces wander + flagship velocity (analytical) so keep-out never doubles work/jitter.
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
  if (wing.hangar === 'stowed') return [];

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
  const time = state.time + accumulatorMs;
  const t = time / 1000;
  const system = f.systemId ? systemById(state, f.systemId) : null;
  const bodyCache = system ? buildKeepOutBodyCache(system, time) : null;
  const { outerR } = flagshipKeepRadii();
  const hangar = wing.hangar ?? 'deployed';
  const animT0 = wing.hangarAnimStartedAt ?? time;
  const flagVx = f.vx ?? 0;
  const flagVy = f.vy ?? 0;

  const n = Math.max(1, loadout.length);
  return loadout.map((hull, i) => {
    const localT = hangar === 'recalling' ? animT0 / 1000 : t;
    const local = craftLocalPose(i, n, localT, outerR);

    if (hangar === 'deployed') {
      const now = resolveDeployedWorldPose(state, system, pose, local, time, bodyCache);
      // Analytical motion heading (wander + flagship cruise) — stable across frames.
      const lookDt = 0.05;
      const lookLocal = craftLocalPose(i, n, localT + lookDt, outerR);
      const heading = headingFromDelta(
        (lookLocal.lx - local.lx) + flagVx * lookDt,
        (lookLocal.ly - local.ly) + flagVy * lookDt,
        headingFromDelta(local.vxRaw + flagVx, local.vyRaw + flagVy, pose.heading),
      );
      return {
        id: `flagship-wing-${i}`,
        hull,
        x: now.x,
        y: now.y,
        heading,
        index: i,
        radius: FLAGSHIP_RADIUS * FLAGSHIP_WING_DRAW_SCALE,
      };
    }

    if (hangar === 'recalling') {
      const u = easeInCubic(Math.min(1, Math.max(0, (time - animT0) / FLAGSHIP_WING_RECALL_MS)));
      const stagger = (i / n) * 0.18;
      const su = Math.min(1, Math.max(0, (u - stagger) / Math.max(0.01, 1 - stagger)));
      const x = pose.x + local.lx * (1 - su);
      const y = pose.y + local.ly * (1 - su);
      const heading = headingFromDelta(pose.x - x, pose.y - y, pose.heading);
      return {
        id: `flagship-wing-${i}`,
        hull,
        x,
        y,
        heading,
        index: i,
        radius: FLAGSHIP_RADIUS * FLAGSHIP_WING_DRAW_SCALE * (1 - su * 0.35),
      };
    }

    // launching — fly out from hangar to patrol pocket
    const u = easeOutCubic(Math.min(1, Math.max(0, (time - animT0) / FLAGSHIP_WING_LAUNCH_MS)));
    const stagger = (i / n) * 0.2;
    const su = Math.min(1, Math.max(0, (u - stagger) / Math.max(0.01, 1 - stagger)));
    const targetX = pose.x + local.homeX;
    const targetY = pose.y + local.homeY;
    const x = pose.x + (targetX - pose.x) * su;
    const y = pose.y + (targetY - pose.y) * su;
    const heading = headingFromDelta(targetX - pose.x, targetY - pose.y, pose.heading);
    return {
      id: `flagship-wing-${i}`,
      hull,
      x,
      y,
      heading,
      index: i,
      radius: FLAGSHIP_RADIUS * FLAGSHIP_WING_DRAW_SCALE * (0.65 + su * 0.35),
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
    hangar: wing.hangar ?? 'deployed',
    poses: flagshipWingPoses(state).length,
  };
}
