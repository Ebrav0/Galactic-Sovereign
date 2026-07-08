import { effectiveDps, healRateForShip } from './hull.js';

export function shipPower(ship, state = null) {
  if (!ship || ship.hp <= 0) return 0;
  const dps = effectiveDps(ship, state);
  const heal = healRateForShip(ship, state);
  const durability = Math.max(0, ship.hp) / 40;
  return dps + heal * 0.35 + durability;
}

export function fleetPower(ships, state = null) {
  return Math.round((ships ?? []).reduce((n, ship) => n + shipPower(ship, state), 0));
}
