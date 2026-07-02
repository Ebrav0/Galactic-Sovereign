// Hull metadata helpers — stats live in constants.js (Phase 2).

import {
  HULL_STATS,
  WING_STATS,
  BUILDABLE_HULLS,
  FLAGSHIP_CAPTURE_FORCE,
} from './constants.js';

export function hullStats(hull) {
  return HULL_STATS[hull] ?? WING_STATS[hull] ?? null;
}

export function isBuildableHull(hull) {
  return BUILDABLE_HULLS.includes(hull);
}

export function isCombatHull(hull) {
  const s = hullStats(hull);
  return s ? s.contestsCapture || s.dps > 0 : false;
}

export function contestsCapture(hull) {
  const s = hullStats(hull);
  return s?.contestsCapture ?? false;
}

export function captureForceFor(hull) {
  const s = hullStats(hull);
  return s?.captureForce ?? 0;
}

export function isTransportHull(hull) {
  return hull === 'light_hauler';
}

export function isWingHull(hull) {
  return hull in WING_STATS;
}

export function flagshipCaptureForce(flagship) {
  if (!flagship || flagship.hp <= 0) return 0;
  return FLAGSHIP_CAPTURE_FORCE;
}
