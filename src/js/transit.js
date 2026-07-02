// Shared lane transit math (flagship + scouts).
// Positions are pure functions of state.time + transit record.

import { laneLength } from './galaxy.js';

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
  return {
    fromId,
    toId,
    destId: transit.path[transit.path.length - 1],
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    angle: Math.atan2(to.y - from.y, to.x - from.x),
    progress,
    etaMs: transitEtaMs(transit, galaxy, time, speed, minLegMs),
  };
}

// Advance transit legs deterministically. Calls onArrive(destId, fromId) at final leg.
export function advanceTransit(transit, galaxy, time, speed, minLegMs, onArrive) {
  while (transit) {
    const legEnd = transit.legStartTime + transit.legDurationMs;
    if (time < legEnd) return;
    if (transit.legIndex + 2 >= transit.path.length) {
      onArrive(transit.path[transit.path.length - 1], transit.path[transit.path.length - 2]);
      return;
    }
    transit.legIndex += 1;
    transit.legStartTime = legEnd;
    transit.legDurationMs = legDurationMs(
      galaxy,
      transit.path[transit.legIndex],
      transit.path[transit.legIndex + 1],
      speed,
      minLegMs,
    );
  }
}

function nodePos(galaxy, id) {
  if (id === galaxy.blackHole.id) return galaxy.blackHole;
  return galaxy.stars.find((s) => s.id === id);
}
