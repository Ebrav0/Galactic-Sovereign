// Hull definitions and ship instance helpers (Phase 2).

import {
  CARRIER_WING_HULLS,
  CARRIER_WING_SPECS,
  HULL_STATS,
  FLAGSHIP_HP,
  SCOUT_HULL_COST,
  SHIPYARD_COST,
  WEAPON_PROFILES,
} from './constants.js';
import { techEffects } from './tech-web.js';

export function hullStats(hull) {
  return HULL_STATS[hull] ?? null;
}

export function isCombatHull(hull) {
  const s = hullStats(hull);
  return s && s.captureForce > 0;
}

function hpMultForHull(state, hull) {
  if (!state) return 1;
  const fx = techEffects(state);
  if (hull === 'corvette') return fx.corvetteHpMult;
  if (hull === 'frigate') return fx.frigateHpMult;
  return 1;
}

function dpsMultForHull(state, hull) {
  if (!state) return 1;
  const fx = techEffects(state);
  if (hull === 'destroyer') return fx.destroyerDpsMult;
  if (hull === 'battleship') return fx.battleshipDpsMult;
  if (hull === 'light_carrier' || hull === 'fleet_carrier' || hull === 'super_carrier') {
    return fx.carrierDpsMult;
  }
  return 1;
}

export function isCarrierHull(hull) {
  return !!CARRIER_WING_SPECS[hull];
}

export function defaultWeaponProfileForHull(hull) {
  if (hull === 'healer') return 'repair';
  if (hull === 'corvette' || hull === 'patrol_cutter' || hull === 'interceptor') return 'point_defense';
  if (hull === 'destroyer' || hull === 'battleship' || hull === 'dreadnought' || hull === 'bomber') return 'torpedo';
  if (hull === 'cruiser' || hull === 'command_cruiser' || hull === 'hero_flagship' || hull === 'flagship') return 'beam_lance';
  if (hull === 'sensor_ship' || hull === 'ion_battery') return 'ion';
  return 'kinetic';
}

export function weaponProfile(profileId) {
  return WEAPON_PROFILES[profileId] ?? WEAPON_PROFILES.kinetic;
}

export function maxCarrierWingCount(shipOrHull, state = null) {
  const hull = typeof shipOrHull === 'string' ? shipOrHull : shipOrHull?.hull;
  const spec = CARRIER_WING_SPECS[hull];
  if (!spec) return 0;
  const base = Object.values(spec).reduce((n, count) => n + count, 0);
  const mult = state ? techEffects(state).carrierWingCapacityMult : 1;
  return Math.max(0, Math.round(base * mult));
}

export function carrierWingLoadout(shipOrHull, state = null) {
  const hull = typeof shipOrHull === 'string' ? shipOrHull : shipOrHull?.hull;
  const spec = CARRIER_WING_SPECS[hull];
  if (!spec) return [];
  const mult = state ? techEffects(state).carrierWingCapacityMult : 1;
  const out = [];
  for (const [wingHull, count] of Object.entries(spec)) {
    const adjusted = Math.max(1, Math.round(count * mult));
    for (let i = 0; i < adjusted; i++) out.push(wingHull);
  }
  return out;
}

export function normalizeCarrierWingState(ship, state = null) {
  if (!ship || !isCarrierHull(ship.hull)) return null;
  const max = maxCarrierWingCount(ship, state);
  if (!ship.wingState) {
    ship.wingState = { ready: max, lost: 0, launched: 0 };
  }
  ship.wingState.ready = Math.min(max, Math.max(0, ship.wingState.ready ?? max));
  ship.wingState.lost = Math.max(0, ship.wingState.lost ?? Math.max(0, max - ship.wingState.ready));
  ship.wingState.launched = Math.max(0, ship.wingState.launched ?? 0);
  return ship.wingState;
}

export function createShipInstance(id, hull, state = null) {
  const stats = hullStats(hull);
  if (!stats) return null;
  const hp = Math.round(stats.hp * hpMultForHull(state, hull));
  const ship = {
    id,
    hull,
    hp,
    maxHp: hp,
    weaponProfile: defaultWeaponProfileForHull(hull),
  };
  normalizeCarrierWingState(ship, state);
  return ship;
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

export function effectiveDps(ship, state = null, { heroCombatAura = false } = {}) {
  if (ship.hull === 'flagship') return 25;
  let dps = hullStats(ship.hull)?.dps ?? 0;
  if (state) {
    dps *= dpsMultForHull(state, ship.hull);
    if (heroCombatAura && ship.side !== 'enemy') dps *= 1.1;
  }
  return dps;
}

function targetClass(target) {
  if (!target) return 'capital';
  if (CARRIER_WING_HULLS.includes(target.hull) || target.isWing) return 'fighter';
  if (target.isStructure || target.structureType) return 'structure';
  if (['cruiser', 'battleship', 'dreadnought', 'light_carrier', 'fleet_carrier', 'super_carrier', 'hero_flagship', 'flagship'].includes(target.hull)) {
    return 'capital';
  }
  return 'ship';
}

export function weaponDamageMultiplier(attacker, target, state = null) {
  const profileId = attacker.weaponProfile ?? defaultWeaponProfileForHull(attacker.hull);
  const profile = weaponProfile(profileId);
  const cls = targetClass(target);
  let mult = 1;
  if (cls === 'fighter') mult *= profile.antiFighter ?? 1;
  else if (cls === 'capital') mult *= profile.antiCapital ?? 1;
  else if (cls === 'structure') mult *= profile.structure ?? 1;

  if (state) {
    const fx = techEffects(state);
    if (profileId === 'point_defense') mult *= fx.pointDefenseMult;
    if (profileId === 'kinetic') mult *= fx.kineticDamageMult;
    if (profileId === 'torpedo' && attacker.hull === 'bomber') mult *= fx.bomberDamageMult;
    if (profileId === 'beam_lance') mult *= fx.beamDamageMult;
    if (profileId === 'ion') mult *= fx.ionDamageMult;
  }
  return mult;
}

export function effectiveDamageAgainst(attacker, target, state = null, opts = {}) {
  return effectiveDps(attacker, state, opts) * weaponDamageMultiplier(attacker, target, state);
}

export function healRateForShip(ship, state = null) {
  let rate = hullStats(ship.hull)?.healRate ?? 0;
  if (state && rate > 0) rate *= techEffects(state).healerRepairMult;
  return rate;
}

export function hullQueueCost(state, hull) {
  const stats = hullStats(hull);
  if (!stats) return null;
  const fx = techEffects(state);
  if (hull === 'scout') return Math.ceil(SCOUT_HULL_COST * fx.scoutCostMult);
  return Math.ceil(stats.cost);
}

export function shipyardStructureCost(state) {
  return Math.ceil(SHIPYARD_COST * techEffects(state).shipyardCostMult);
}
