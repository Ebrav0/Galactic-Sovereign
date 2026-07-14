// Shared lane transit math (flagship + scouts).
// Positions are pure functions of state.time + transit record.

import {
  laneLength,
  laneBulge,
  laneControlPoint,
  laneBezierPoint,
  laneBezierAngle,
} from './galaxy.js';

export function legDurationMs(galaxy, idA, idB, speed, minLegMs) {
  return Math.max(minLegMs, Math.round((laneLength(galaxy, idA, idB) / speed) * 1000));
}

export function transitEtaMs(transit, galaxy, time, speed, minLegMs) {
  if (!transit) return 0;
  let eta = Math.max(0, transit.legStartTime + transit.legDurationMs - time);
  for (let i = transit.legIndex + 1; i < transit.path.length - 1; i++) {
    eta += legDurationMs(galaxy, transit.path[i], transit.path[i + 1], speed, minLegMs);
  }
  return eta;
}

export function transitStatus(transit, galaxy, time, speed, minLegMs) {
  if (!transit) return null;
  const fromId = transit.path[transit.legIndex];
  const toId = transit.path[transit.legIndex + 1];
  const from = nodePos(galaxy, fromId);
  const to = nodePos(galaxy, toId);
  const progress = Math.min(1, Math.max(0, (time - transit.legStartTime) / transit.legDurationMs));
  const bulge = laneBulge(galaxy, fromId, toId);
  const ctrl = laneControlPoint(from, to, bulge);
  const pos = laneBezierPoint(from, ctrl, to, progress);
  return {
    fromId,
    toId,
    destId: transit.path[transit.path.length - 1],
    x: pos.x,
    y: pos.y,
    angle: laneBezierAngle(from, ctrl, to, progress),
    progress,
    etaMs: transitEtaMs(transit, galaxy, time, speed, minLegMs),
  };
}

// Advance transit legs deterministically. Calls onArrive(destId, fromId) at final leg.
export function advanceTransit(
  transit,
  galaxy,
  time,
  speed,
  minLegMs,
  onArrive,
  durationFn = null,
  options = {},
) {
  const dur = (a, b) => (durationFn
    ? durationFn(a, b)
    : legDurationMs(galaxy, a, b, speed, minLegMs));
  while (transit) {
    const legEnd = transit.legStartTime + transit.legDurationMs;
    if (time < legEnd) return;
    const fromId = transit.path[transit.legIndex];
    const reachedId = transit.path[transit.legIndex + 1];
    if (options.canEnter && !options.canEnter(reachedId, fromId)) {
      options.onBlocked?.(fromId, reachedId, fromId);
      return;
    }
    if (transit.legIndex + 2 >= transit.path.length) {
      onArrive(transit.path[transit.path.length - 1], fromId);
      return;
    }
    const nextId = transit.path[transit.legIndex + 2];
    if (options.canEnter && !options.canEnter(nextId, reachedId)) {
      options.onBlocked?.(reachedId, nextId, fromId);
      return;
    }
    transit.legIndex += 1;
    transit.legStartTime = legEnd;
    transit.legDurationMs = dur(
      transit.path[transit.legIndex],
      transit.path[transit.legIndex + 1],
    );
  }
}

function nodePos(galaxy, id) {
  if (id === galaxy.blackHole.id) return galaxy.blackHole;
  return galaxy.stars.find((s) => s.id === id);
}
