// Hull definitions and ship instance helpers (Phase 2).

import { HULL_STATS, FLAGSHIP_HP } from './constants.js';

export function hullStats(hull) {
  return HULL_STATS[hull] ?? null;
}

export function isCombatHull(hull) {
  const s = hullStats(hull);
  return s && s.captureForce > 0;
}

export function createShipInstance(id, hull) {
  const stats = hullStats(hull);
  if (!stats) return null;
  return {
    id,
    hull,
    hp: stats.hp,
    maxHp: stats.hp,
  };
}

export function createFlagshipCombatUnit() {
  return {
    id: 'flagship',
    hull: 'flagship',
    hp: FLAGSHIP_HP,
    maxHp: FLAGSHIP_HP,
  };
}

export function shipLaneSpeed(hull) {
  return hullStats(hull)?.laneSpeed ?? 100;
}

export function captureForceForShip(ship) {
  if (ship.hull === 'flagship') return 2;
  return hullStats(ship.hull)?.captureForce ?? 0;
}

export function effectiveDps(ship) {
  if (ship.hull === 'flagship') return 25;
  return hullStats(ship.hull)?.dps ?? 0;
}

export function healRateForShip(ship) {
  return hullStats(ship.hull)?.healRate ?? 0;
}
