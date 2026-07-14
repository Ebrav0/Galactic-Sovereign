// Hybrid combat: tactical (flagship present) + auto-resolve (Phase 2.4–2.7).

import {
  TICK_MS,
  TACTICAL_WEAPON_RANGE,
  TACTICAL_WEAPON_COOLDOWN_MS,
  TACTICAL_TARGET_STICK_MS,
  TACTICAL_TARGET_LEASH_MULT,
  TACTICAL_FORMATION_PULL_MIN,
  TACTICAL_APPROACH_BAND,
  TACTICAL_SEPARATION_STRENGTH,
  TACTICAL_BATTLE_LINE_DISCIPLINE_MIN,
  TACTICAL_FORMATION_BASE_SPACING,
  FLEET_STATION_ORBIT_PAD,
  STANCE_MODIFIERS,
  HEALER_AUTO_COEF,
  FLAGSHIP_HP,
  TACTICAL_LARGE_BATTLE_UNITS,
  TACTICAL_SPATIAL_CELL,
  CARRIER_WING_HULLS,
} from './constants.js';
import {
  carrierWingLoadout,
  defaultWeaponProfileForHull,
  effectiveDps,
  effectiveDamageAgainst,
  healRateForShip,
  createFlagshipCombatUnit,
  grantShipExperience,
  hullStats,
  maxCarrierWingCount,
  normalizeCarrierWingState,
  weaponProfile,
} from './hull.js';
import { pirateFleetAtSystem, removePirateShip } from './pirates.js';
import { aiShipsInSystem } from './ai-ships.js';
import { playerCombatShipsAtSystem, stationedShipPose, anchoredCombatShipsAtSystem } from './fleets.js';
import { heroInSystem, heroesInSystem } from './hero-flagships.js';
import { shellRepairBonus } from './dyson.js';
import { supplyCacheRepairMultiplier } from './strategic-structures.js';
import { pruneBattleGroups } from './battle-groups.js';
import { softKeepOut, nudgeUnitKeepOut, buildKeepOutBodyCache } from './ship-motion.js';
import { getSystems } from './galaxy-scope.js';
import { systemById } from './state.js';
import {
  bodyStructureDef,
  bodyStructureDefensePower,
  bodyStructureIonPower,
  isOperationalStructure,
  structureCarrierRecoveryRate,
  structureCarrierWingCapacityMultiplier,
  structureHullSalvageRate,
  structureEnemyRetreatChargeMultiplier,
  structureLevelHpMultiplier,
  structureMaxHp,
  structureWeaponRangeMultiplier,
} from './body-structures.js';
import { techEffects } from './tech-web.js';
import { factionTechContext } from './ai-tech.js';
import { isAtWar } from './diplomacy.js';
import {
  activeFleetOrders,
  applyFleetOrder,
  applyFacedDamage,
  createLargeBattleLodParityInputs,
  createPostBattleReport,
  damageStateModifiers,
  normalizeFighterWingState,
  normalizeShieldFacings,
  recoverFighters,
  selectPriorityTarget,
  validateLodConservation,
} from './combat-orders.js';
import {
  activeConvoys,
  convoyTransitStatus,
  interceptConvoy,
} from './logistics.js';
import { combatFxSummary, emitHealFx, emitShotFx, emitSparseLodFx } from './combat-fx.js';
import {
  analyzeFleetMix,
  normalizeDoctrine,
  recommendFormation,
} from './combat-doctrine.js';
import {
  ensureUnitMotion,
  steerUnit,
  applyShipSeparation,
  resolveStickyTarget,
  motionOptsForUnit,
  blendFacing,
  separationRadiusForUnit,
  hullMotionProfile,
  battleLineMembers,
  pickFleetSlotGoal,
  blendCombatGoal,
  isWingUnit,
} from './combat-steering.js';

const APPROACH_BAND_INNER = TACTICAL_WEAPON_RANGE;
const APPROACH_BAND_OUTER = TACTICAL_WEAPON_RANGE * 2.5;

function techStateForUnit(state, unit) {
  if (unit?.side === 'player') return state;
  if (!unit?.factionId) return unit?.side === 'enemy' || unit?.side === 'ai' ? null : state;
  const faction = state.factions?.list?.find((candidate) => candidate.id === unit.factionId);
  return faction ? factionTechContext(faction) : null;
}

function seededEntryVector(seed, systemId, time) {
  let h = (seed ^ systemId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) >>> 0;
  h = Math.imul(h ^ (time >>> 0), 0x9e3779b9);
  return ((h >>> 0) % 1000) / 1000;
}

function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId && !f.transit && !f.wormholeTransit;
}

function tacticalAnchorInSystem(state, systemId) {
  return flagshipInSystem(state, systemId) || heroInSystem(state, systemId);
}

export function combatEnvironmentModifiers(system) {
  return {
    nebula: { speed: 0.9, range: 0.72, damage: 0.95, label: 'Sensor-obscuring nebula' },
    ion_storm: { speed: 0.92, range: 0.86, damage: 1.08, label: 'Ion storm shield interference' },
    debris_field: { speed: 0.72, range: 0.92, damage: 0.94, label: 'Dense debris field' },
    commerce: { speed: 1, range: 1, damage: 1, label: 'Trade Nexus traffic zone' },
    clear: { speed: 1, range: 1, damage: 1, label: 'Clear space' },
  }[system?.environment ?? 'clear'] ?? { speed: 1, range: 1, damage: 1, label: 'Clear space' };
}

function playerForcesInSystem(state, systemId) {
  const ships = [
    ...playerCombatShipsAtSystem(state, systemId),
    ...anchoredCombatShipsAtSystem(state, systemId),
  ];
  const hasFlagship = flagshipInSystem(state, systemId);
  return { ships, hasFlagship };
}

function shouldBattle(state, systemId) {
  const pirates = pirateFleetAtSystem(state, systemId)
    .filter((fleet) => fleet.ships?.some((ship) => ship.hp > 0));
  const aiShips = aiShipsInSystem(state, systemId)
    .filter((ship) => isAtWar(state, ship.factionId ?? 'ai-0'));
  const system = getSystems(state)[systemId];
  const { ships, hasFlagship } = playerForcesInSystem(state, systemId);
  const playerPresent = ships.length > 0 || hasFlagship || heroInSystem(state, systemId);
  const hostileToPlayer = pirates.length > 0 || aiShips.length > 0;
  if (playerPresent && hostileToPlayer) return true;
  if (system?.owner === 'player' && hostileToPlayer) return true;
  // AI-held systems only auto-resolve when pirates are actually attacking;
  // the faction's own stationed ships are not an opposing force.
  if (system?.owner === 'ai' && pirates.length > 0) return true;
  return false;
}

function collectEnemyShips(state, systemId) {
  const out = [];
  for (const fleet of pirateFleetAtSystem(state, systemId)) {
    for (const ship of fleet.ships) {
      if (ship.hp > 0) out.push({ ...ship, fleetId: fleet.id, side: 'enemy' });
    }
  }
  const system = getSystems(state)[systemId];
  const playerPresent = playerForcesInSystem(state, systemId).ships.length > 0
    || flagshipInSystem(state, systemId) || heroInSystem(state, systemId);
  if (playerPresent) {
    for (const ship of aiShipsInSystem(state, systemId)
      .filter((candidate) => isAtWar(state, candidate.factionId ?? 'ai-0'))) {
      out.push({ ...ship, side: 'enemy' });
    }
    if (system?.owner === 'ai' && isAtWar(state, system.factionId ?? 'ai-0')) {
      out.push(...combatStructureUnits(state, system, 'enemy'));
    }
    for (const convoy of activeConvoys(state)) {
      if ((convoy.ownerId ?? 'player') === 'player' || !convoyAtSystem(state, convoy, systemId)) continue;
      if (!isAtWar(state, convoy.ownerId ?? 'ai-0')) continue;
      out.push(convoyCombatUnit(convoy, 'enemy'));
    }
  }
  return out;
}

const TACTICAL_STRUCTURE_PROFILES = Object.freeze({
  trade_nexus: { hull: 'command_cruiser', hp: 2400, weaponProfile: 'beam' },
  export_depot: { hull: 'bulk_freighter', hp: 520, weaponProfile: 'point_defense' },
  fighter_factory: { hull: 'light_carrier', hp: 520, weaponProfile: 'point_defense' },
  orbital_defense: { hull: 'patrol_cutter', hp: 380, weaponProfile: 'point_defense' },
  ion_battery: { hull: 'sensor_ship', hp: 300, weaponProfile: 'ion' },
  drydock: { hull: 'bulk_freighter', hp: 340, weaponProfile: 'kinetic' },
  shipyard: { hull: 'bulk_freighter', hp: 600, weaponProfile: 'kinetic' },
});

function tacticalStructureProfile(structure) {
  const fixed = TACTICAL_STRUCTURE_PROFILES[structure.type];
  if (fixed) return fixed;
  const def = bodyStructureDef(structure.type);
  if (!def) return null;
  const weaponProfile = def.combat?.weapon ?? (
    ['military', 'control', 'defense'].some((token) => String(def.aiPriority ?? def.combat?.role).includes(token))
      ? 'kinetic' : 'point_defense'
  );
  const hull = weaponProfile === 'torpedo' ? 'destroyer'
    : weaponProfile === 'ion' ? 'sensor_ship'
      : def.combat?.role === 'carrier-command' ? 'light_carrier'
        : 'bulk_freighter';
  return {
    hull,
    hp: Math.round((def.hp ?? 240) * structureLevelHpMultiplier(structure)),
    weaponProfile,
  };
}

function combatStructureUnits(state, system, side) {
  const units = [];
  for (const structure of system?.structures ?? []) {
    const profile = tacticalStructureProfile(structure);
    if (!profile || !isOperationalStructure(state, structure, { systemId: system.id })) continue;
    const effectiveMaxHp = structureMaxHp(state, system.id, structure)
      ?? structure.maxHp
      ?? profile.hp;
    const storedMaxHp = structure.maxHp ?? effectiveMaxHp;
    const hpRatio = storedMaxHp > 0
      ? Math.max(0, Math.min(1, (structure.hp ?? storedMaxHp) / storedMaxHp))
      : 0;
    units.push({
      id: structure.id,
      hull: profile.hull,
      hp: Math.round(effectiveMaxHp * hpRatio),
      maxHp: effectiveMaxHp,
      side,
      isStructure: true,
      isObjective: true,
      structureType: structure.type,
      level: structure.level ?? 1,
      factionId: system.factionId ?? null,
      weaponProfile: profile.weaponProfile,
    });
  }
  return units;
}

function convoyAtSystem(state, convoy, systemId) {
  const status = convoyTransitStatus(state, convoy);
  return (status?.phase === 'jumping' && convoy.fromSystemId === systemId)
    || convoy.currentNodeId === systemId;
}

function convoyCombatUnit(convoy, side) {
  return {
    id: convoy.id,
    hull: 'bulk_freighter',
    hp: convoy.armor ?? 120,
    maxHp: convoy.armor ?? 120,
    side,
    factionId: convoy.ownerId === 'player' ? null : convoy.ownerId,
    isConvoy: true,
    isObjective: true,
    convoyId: convoy.id,
    weaponProfile: 'point_defense',
  };
}

function collectAllyShips(state, systemId) {
  const out = [];
  const system = getSystems(state)[systemId];
  const { ships, hasFlagship } = playerForcesInSystem(state, systemId);
  const playerPresent = ships.length > 0 || hasFlagship || heroInSystem(state, systemId);
  if (system?.owner === 'ai' && !playerPresent) {
    for (const ship of aiShipsInSystem(state, systemId)) {
      out.push({ ...ship, side: 'ai' });
    }
    out.push(...combatStructureUnits(state, system, 'ai'));
    return out;
  }
  for (const ship of ships) {
    out.push({ ...ship, side: 'player' });
  }
  if (playerPresent) {
    for (const ship of aiShipsInSystem(state, systemId)) {
      if (isAtWar(state, ship.factionId ?? 'ai-0')) continue;
      out.push({ ...ship, side: 'ai' });
    }
  }
  if (hasFlagship) {
    const unit = createFlagshipCombatUnit(state);
    out.push({
      ...unit,
      hp: state.flagship?.hp ?? state.systemBattles[systemId]?.flagshipHp ?? unit.hp,
      maxHp: state.flagship?.maxHp ?? FLAGSHIP_HP,
      side: 'player',
    });
  }
  if (system?.owner === 'player' || (system?.star?.kind === 'trade_nexus' && playerPresent)) {
    out.push(...combatStructureUnits(state, system, 'player'));
  } else if (playerPresent && system?.owner === 'ai'
      && !isAtWar(state, system.factionId ?? 'ai-0')) {
    out.push(...combatStructureUnits(state, system, 'ai'));
  }
  for (const convoy of activeConvoys(state)) {
    const ownerId = convoy.ownerId ?? 'player';
    const friendly = playerPresent
      ? ownerId === 'player' || !isAtWar(state, ownerId)
      : ownerId === system?.factionId;
    if (!friendly || !convoyAtSystem(state, convoy, systemId)) continue;
    out.push(convoyCombatUnit(convoy, playerPresent && ownerId === 'player' ? 'player' : 'ai'));
  }
  return out;
}

function launchCarrierWings(state, battle, carrier, side, ordinal) {
  if (!carrier || carrier.hp <= 0) return [];
  const isFlagshipCarrier = carrier.hull === 'flagship' || carrier.id === 'flagship';
  const techState = techStateForUnit(state, { ...carrier, side });
  const localCapacityMultiplier = side === 'player'
    ? structureCarrierWingCapacityMultiplier(state, battle.systemId)
    : structureCarrierWingCapacityMultiplier(state, battle.systemId, {
      owner: 'ai',
      factionId: carrier.factionId,
    });
  if (!carrierWingLoadout(carrier, isFlagshipCarrier ? state : techState, localCapacityMultiplier).length) return [];
  if (!isFlagshipCarrier) {
    if (side === 'player' && !techEffects(state).carrierWings) return [];
    if (carrier.factionId && (!techState || !techEffects(techState).carrierWings)) return [];
  }

  const source = side === 'player' && !isFlagshipCarrier
    ? state.playerShips?.find((s) => s.id === carrier.id)
    : null;
  const legacyWing = isFlagshipCarrier
    ? normalizeCarrierWingState(carrier, state, localCapacityMultiplier)
    : (source
      ? normalizeCarrierWingState(source, state, localCapacityMultiplier)
      : normalizeCarrierWingState(carrier, techState, localCapacityMultiplier));
  const capacity = maxCarrierWingCount(carrier, isFlagshipCarrier ? state : techState, localCapacityMultiplier);
  const wingState = normalizeFighterWingState(legacyWing, {
    capacity,
    ammoPerCraft: 8,
    fuelPerCraft: 100,
  });
  const ready = Math.floor(wingState?.ready ?? capacity);
  if (ready <= 0) return [];

  const loadout = carrierWingLoadout(carrier, isFlagshipCarrier ? state : techState, localCapacityMultiplier).slice(0, ready);
  battle.wingLaunches = battle.wingLaunches ?? {};
  battle.wingLaunches[carrier.id] = (battle.wingLaunches[carrier.id] ?? 0) + loadout.length;
  if (wingState) {
    wingState.ready = Math.max(0, wingState.ready - loadout.length);
    wingState.launched += loadout.length;
    wingState.status = 'deployed';
  }
  if (isFlagshipCarrier && state.flagship?.wing) {
    state.flagship.wing.ready = wingState?.ready ?? Math.max(0, ready - loadout.length);
    state.flagship.wing.launched = (state.flagship.wing.launched ?? 0) + loadout.length;
  }

  return loadout.map((hull, i) => {
    const stats = hullStats(hull);
    const spread = (i / Math.max(1, loadout.length)) * Math.PI * 2 + ordinal * 0.41;
    const ring = 38 + (i % 3) * 13;
    return {
      id: `${carrier.id}-wing-${i}`,
      hull,
      hp: stats.hp,
      maxHp: stats.hp,
      side,
      isWing: true,
      parentCarrierId: carrier.id,
      x: carrier.x + Math.cos(spread) * ring,
      y: carrier.y + Math.sin(spread) * ring,
      heading: spread,
      cooldownMs: i * 35,
      launchOffsetMs: i * 70,
      ammo: hull === 'bomber' ? 4 : 8,
      fuel: 100,
      weaponProfile: hull === 'bomber' ? 'torpedo' : (hull === 'interceptor' ? 'point_defense' : 'kinetic'),
    };
  });
}

function seedBattleLinePositions(state, system, battle, side, facing, battleOrbit) {
  const sideUnits = (battle.units ?? []).filter((unit) => unit.side === side && unit.hp > 0);
  const line = battleLineMembers(sideUnits);
  if (!line.length) return;

  let maxSpacingMult = 1;
  for (const member of line) {
    maxSpacingMult = Math.max(maxSpacingMult, hullMotionProfile(member.hull).formationSpacingMult);
  }
  const spacing = TACTICAL_FORMATION_BASE_SPACING * maxSpacingMult;
  // Stand on the side opposite the threat facing, looking toward it.
  const centerAngle = facing + Math.PI;
  const lineRadius = battleOrbit * 0.72;
  const cx = Math.cos(centerAngle) * lineRadius;
  const cy = Math.sin(centerAngle) * lineRadius;

  for (let ordinal = 0; ordinal < line.length; ordinal++) {
    const unit = line[ordinal];
    const offset = formationOffset('line', ordinal, line.length, spacing);
    const slotX = cx + offset.x * Math.cos(facing) - offset.y * Math.sin(facing);
    const slotY = cy + offset.x * Math.sin(facing) + offset.y * Math.cos(facing);
    const safe = softKeepOut(state, system, slotX, slotY);
    unit.x = safe.x;
    unit.y = safe.y;
    unit.heading = facing;
  }
}

function initTacticalUnits(state, systemId, battle) {
  const system = getSystems(state)[systemId];
  const starR = system?.star?.radius ?? 200;
  const battleOrbit = starR + FLEET_STATION_ORBIT_PAD;
  const entry = battle.entryVector ?? 0.5;
  const entryAngle = entry * Math.PI * 2;
  const ex = Math.cos(entryAngle) * battleOrbit;
  const ey = Math.sin(entryAngle) * battleOrbit;

  battle.units = [];
  const allies = collectAllyShips(state, systemId);
  let combatIdx = 0;
  const combatAllies = allies.filter((s) => s.hull !== 'flagship');

  for (const ship of allies) {
    let unit = null;
    if (ship.hull === 'flagship') {
      const f = state.flagship;
      const safe = softKeepOut(state, system, f.x, f.y);
      unit = {
        ...ship,
        x: safe.x,
        y: safe.y,
        heading: f.heading ?? 0,
        cooldownMs: 0,
        weapons: (ship.weapons ?? createFlagshipCombatUnit(state).weapons).map((w) => ({ ...w })),
        hardpointFireAt: {},
        hideSprite: true, // piloted sprite owns the visual
      };
    } else if (ship.isStructure) {
      const angle = (combatIdx / Math.max(1, combatAllies.length + 2)) * Math.PI * 2;
      const radius = starR + FLEET_STATION_ORBIT_PAD * 0.72;
      unit = {
        ...ship,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        heading: angle + Math.PI / 2,
        cooldownMs: 0,
      };
    } else {
      const pose = stationedShipPose(state, system, ship, combatIdx, combatAllies.length);
      const safe = softKeepOut(state, system, pose.x, pose.y);
      unit = {
        ...ship,
        x: safe.x,
        y: safe.y,
        heading: pose.heading,
        cooldownMs: 0,
      };
      combatIdx++;
    }
    battle.units.push(unit);
    battle.units.push(...launchCarrierWings(state, battle, unit, unit.side, combatIdx));
  }

  const enemies = collectEnemyShips(state, systemId);
  enemies.forEach((ship, i) => {
    const spread = (i / Math.max(1, enemies.length)) * Math.PI * 0.7 - Math.PI * 0.35;
    const heading = entryAngle + Math.PI + spread;
    const rawX = ex + Math.cos(spread) * 120;
    const rawY = ey + Math.sin(spread) * 120;
    const safe = softKeepOut(state, system, rawX, rawY);
    const unit = {
      ...ship,
      x: safe.x,
      y: safe.y,
      heading,
      cooldownMs: 0,
    };
    battle.units.push(unit);
    battle.units.push(...launchCarrierWings(state, battle, unit, 'enemy', i));
  });

  // Seed capital/line/carrier ships into an EaW battle line facing the enemy entry,
  // so heavies do not start strewn around the station ring.
  seedBattleLinePositions(state, system, battle, 'player', entryAngle, battleOrbit);
  seedBattleLinePositions(state, system, battle, 'enemy', entryAngle + Math.PI, battleOrbit);

  for (const unit of battle.units) {
    const capital = ['flagship', 'hero_flagship', 'cruiser', 'battleship', 'dreadnought', 'command_cruiser']
      .includes(unit.hull);
    const shieldPerFacing = Math.round((unit.maxHp ?? unit.hp ?? 0) * (capital ? 0.22 : 0.1));
    normalizeShieldFacings(unit, shieldPerFacing);
    unit.damageState = unit.damageState ?? 'nominal';
    unit.weaponProfile = unit.weaponProfile ?? defaultWeaponProfileForHull(unit.hull);
    if (unit.isWing) {
      unit.ammo = unit.ammo ?? (unit.hull === 'bomber' ? 4 : 8);
      unit.fuel = unit.fuel ?? 100;
    }
    ensureUnitMotion(unit);
    unit.vx = 0;
    unit.vy = 0;
    unit.focusTargetId = null;
    unit.focusTargetUntil = 0;
  }
}

function startBattle(state, systemId) {
  const tactical = tacticalAnchorInSystem(state, systemId);
  const battle = {
    id: `battle-${systemId}-${state.time}`,
    systemId,
    active: true,
    mode: tactical ? 'tactical' : 'auto',
    startedAt: state.time,
    entryVector: seededEntryVector(state.meta.seed, systemId, state.time),
    lastResolve: null,
    flagshipHp: state.systemBattles[systemId]?.flagshipHp ?? FLAGSHIP_HP,
    tacticalOrders: {},
    orderSequence: 0,
    events: [],
    fxEvents: [],
    objectives: [],
    doctrine: normalizeDoctrine(state.combatDoctrine),
    autoFormationApplied: false,
    playerFormationOverride: false,
    openingFormationApplied: false,
    lastDoctrineRecommendation: null,
  };
  if (tactical) {
    initTacticalUnits(state, systemId, battle);
    battle.initialUnits = JSON.parse(JSON.stringify(battle.units));
    battle.objectives = battle.units
      .filter((unit) => unit.isStructure || unit.isConvoy)
      .map((unit) => ({ id: unit.id, type: unit.isConvoy ? 'convoy' : (unit.structureType ?? 'structure'), outcome: 'contested' }));
    const enemyUnits = battle.units.filter((unit) => unit.side === 'enemy' && unit.hp > 0).map((unit) => unit.id);
    if (enemyUnits.length) {
      const targetClass = battle.units.some((unit) => unit.isConvoy && unit.side === 'player') ? 'convoy' : 'capital';
      applyFleetOrder(battle, {
        type: 'attack_class',
        side: 'enemy',
        subjectIds: enemyUnits,
        targetClass,
        priority: 1,
      }, { time: state.time, units: battle.units, ownedUnitIds: enemyUnits });
    }
    const seeded = applyDoctrineFormation(state, battle, { force: true });
    battle.openingFormationApplied = seeded.ok;
  }
  else battle.autoProgressMs = 0;
  state.systemBattles[systemId] = battle;
  return battle;
}

function applyCasualtiesToState(state, systemId, battle) {
  const pirateLosses = battle.casualtiesApplied ? 0 : (battle.lastResolve?.enemyCasualties ?? 0);
  const fleets = pirateFleetAtSystem(state, systemId);
  let removed = 0;
  for (const fleet of fleets) {
    for (const ship of [...fleet.ships]) {
      if (ship.hp <= 0) continue;
      if (removed < pirateLosses) {
        removePirateShip(state, fleet.id, ship.id);
        removed++;
      }
    }
  }

  if (battle.mode === 'tactical' && battle.units) {
    for (const unit of battle.units) {
      if (unit.isConvoy) {
        if (unit.hp <= 0) interceptConvoy(state, unit.convoyId ?? unit.id, { destroyed: true });
        continue;
      }
      if (unit.isStructure) {
        const system = systemById(state, systemId);
        const structure = system?.structures.find((s) => s.id === unit.id);
        if (structure) {
          structure.hp = Math.max(0, unit.hp);
          structure.maxHp = unit.maxHp;
          structure.disabledUntil = structure.hp <= 0 ? state.time + 60000 : (structure.disabledUntil ?? 0);
        }
        continue;
      }
      if (unit.side === 'enemy' && unit.factionId && !unit.isWing) {
        const aiShip = state.aiShips?.find((ship) => ship.id === unit.id);
        if (aiShip) aiShip.hp = Math.max(0, unit.hp);
        continue;
      }
      if (unit.side !== 'player' || unit.hull === 'flagship') continue;
      if (unit.isWing) continue;
      const ship = state.playerShips.find((s) => s.id === unit.id);
      if (ship) ship.hp = Math.max(0, unit.hp);
    }
    const flagshipUnit = battle.units.find((u) => u.hull === 'flagship');
    if (flagshipUnit) {
      battle.flagshipHp = Math.max(0, flagshipUnit.hp);
      state.flagship.hp = battle.flagshipHp;
      state.flagship.maxHp ??= FLAGSHIP_HP;
    }

    for (const [carrierId, launched] of Object.entries(battle.wingLaunches ?? {})) {
      if (carrierId === 'flagship') {
        const wing = state.flagship.wing ?? normalizeCarrierWingState({ hull: 'flagship' }, state);
        if (!wing && state.flagship) {
          // ensure via normalize
        }
        const flagWing = normalizeCarrierWingState({ hull: 'flagship', id: 'flagship' }, state);
        if (!flagWing || !state.flagship?.wing) continue;
        const survivors = battle.units.filter((u) => u.parentCarrierId === 'flagship' && u.hp > 0);
        const surviving = survivors.length;
        const lost = Math.max(0, launched - surviving);
        const recoveryRate = battle.winner === 'player'
          ? structureCarrierRecoveryRate(state, systemId)
          : 0;
        const recoveredCraft = Math.min(lost, Math.round(lost * recoveryRate));
        const returned = surviving + recoveredCraft;
        const permanentLoss = Math.max(0, lost - recoveredCraft);
        state.flagship.wing.ready = Math.min(
          state.flagship.wing.capacity,
          Math.max(0, returned),
        );
        state.flagship.wing.losses = Math.max(0, state.flagship.wing.capacity - state.flagship.wing.ready);
        state.flagship.wing.launched = Math.max(0, (state.flagship.wing.launched ?? 0) - launched);
        if (permanentLoss > 0) {
          state.flagship.wing.rearmUntil = state.time + 90000;
        }
        continue;
      }
      const ship = state.playerShips.find((s) => s.id === carrierId)
        ?? state.aiShips?.find((s) => s.id === carrierId);
      if (!ship) continue;
      const side = state.playerShips.includes(ship) ? 'player' : 'enemy';
      const techState = techStateForUnit(state, { ...ship, side });
      const localCapacityMultiplier = side === 'player'
        ? structureCarrierWingCapacityMultiplier(state, systemId)
        : structureCarrierWingCapacityMultiplier(state, systemId, {
          owner: 'ai',
          factionId: ship.factionId,
        });
      const legacyWing = normalizeCarrierWingState(ship, techState, localCapacityMultiplier);
      const wing = normalizeFighterWingState(legacyWing, {
        capacity: maxCarrierWingCount(ship, techState, localCapacityMultiplier),
        ammoPerCraft: 8,
        fuelPerCraft: 100,
      });
      const survivors = battle.units.filter((u) => u.parentCarrierId === carrierId && u.hp > 0);
      const surviving = survivors.length;
      const lost = Math.max(0, launched - surviving);
      wing.ammo = survivors.reduce((sum, unit) => sum + Math.max(0, unit.ammo ?? 0), 0);
      wing.fuel = survivors.reduce((sum, unit) => sum + Math.max(0, unit.fuel ?? 0), 0);
      const recoveryRate = side === 'player' && battle.winner === 'player'
        ? structureCarrierRecoveryRate(state, systemId)
        : 0;
      const recoveredCraft = Math.min(lost, Math.round(lost * recoveryRate));
      recoverFighters(
        wing,
        { returned: surviving + recoveredCraft, lost: Math.max(0, lost - recoveredCraft) },
        { capacity: maxCarrierWingCount(ship, techState, localCapacityMultiplier) },
      );
    }
  }
}

function endBattle(state, systemId, winner) {
  const battle = state.systemBattles[systemId];
  if (battle) {
    battle.active = false;
    battle.winner = winner;
    if (battle.mode === 'tactical') {
      const objectives = (battle.objectives ?? []).map((objective) => {
        const unit = battle.units?.find((candidate) => candidate.id === objective.id);
        return { ...objective, outcome: unit?.hp > 0 ? 'survived' : 'destroyed' };
      });
      const enemyLosses = (battle.initialUnits ?? []).filter((unit) => unit.side === 'enemy'
        && !(battle.units ?? []).some((final) => final.id === unit.id && final.hp > 0)).length;
      const survivingIds = new Set((battle.units ?? []).filter((unit) => unit.hp > 0).map((unit) => unit.id));
      const destroyedFriendlyHullCost = (battle.initialUnits ?? [])
        .filter((unit) => unit.side === 'player' && !unit.isWing && unit.hull !== 'flagship'
          && state.playerShips?.some((ship) => ship.id === unit.id) && !survivingIds.has(unit.id))
        .reduce((sum, unit) => sum + (hullStats(unit.hull)?.cost ?? 0), 0);
      const hullRecovery = winner === 'player'
        ? Math.round(destroyedFriendlyHullCost * structureHullSalvageRate(state, systemId))
        : 0;
      const report = createPostBattleReport({
        battleId: battle.id,
        systemId,
        winner,
        startedAt: battle.startedAt,
        endedAt: state.time,
        initialUnits: battle.initialUnits ?? battle.units ?? [],
        finalUnits: battle.units ?? [],
        objectives,
        events: battle.events ?? [],
        salvage: {
          credits: enemyLosses * 12 + hullRecovery,
          materials: enemyLosses * 4,
          fuel: enemyLosses * 1.5,
          recoveredHullCredits: hullRecovery,
        },
      });
      state.battleReports = [...(state.battleReports ?? []), report].slice(-50);
      state.credits += report.salvage.credits;
    } else if (winner === 'player') {
      const recoveredHullCredits = Math.round(
        (battle.destroyedFriendlyHullCost ?? 0) * structureHullSalvageRate(state, systemId),
      );
      state.credits += recoveredHullCredits;
      battle.lastResolve = { ...battle.lastResolve, recoveredHullCredits };
    }
    applyCasualtiesToState(state, systemId, battle);
    if (winner === 'player') {
      const participantIds = battle.mode === 'tactical'
        ? (battle.initialUnits ?? []).filter((unit) => unit.side === 'player' && !unit.isWing).map((unit) => unit.id)
        : (battle.playerParticipantIds ?? []);
      const xp = (20 + Math.max(0, battle.lastResolve?.enemyCasualties ?? 0) * 5)
        * techEffects(state).veterancyExperienceMult;
      for (const shipId of participantIds) {
        const ship = state.playerShips?.find((entry) => entry.id === shipId && entry.hp > 0);
        if (ship) grantShipExperience(ship, xp);
      }
    }
  }
  delete state.systemBattles[systemId];
  pruneBattleGroups(state);
}

function totalPower(units, state = null) {
  let dps = 0;
  let hp = 0;
  let heal = 0;
  let antiFighter = 0;
  let bomber = 0;
  for (const u of units) {
    const techState = state ? techStateForUnit(state, u) : null;
    dps += effectiveDps(u, techState);
    hp += u.hp;
    heal += healRateForShip(u, techState);
    if ((u.weaponProfile ?? '') === 'point_defense' || CARRIER_WING_HULLS.includes(u.hull)) {
      antiFighter += effectiveDps(u, techState) * (weaponProfile(u.weaponProfile ?? 'kinetic').antiFighter ?? 1);
    }
    if (u.hull === 'bomber' || (u.weaponProfile ?? '') === 'torpedo') {
      bomber += effectiveDps(u, techState);
    }
  }
  return { dps, hp, heal, antiFighter, bomber };
}

function resolveAutoBattle(state, systemId, battle) {
  const allies = collectAllyShips(state, systemId);
  const enemies = collectEnemyShips(state, systemId);
  battle.playerParticipantIds = allies
    .filter((unit) => state.playerShips?.some((ship) => ship.id === unit.id))
    .map((unit) => unit.id);
  const stance = STANCE_MODIFIERS[state.battleStance ?? 'balanced'] ?? 1;
  const ally = totalPower(allies, state);
  const enemy = totalPower(enemies, state);
  const defense = (bodyStructureDefensePower(state, systemId) + bodyStructureIonPower(state, systemId))
    * techEffects(state).defensePowerMult;

  const alliedCompact = allies.some((unit) => unit.side === 'ai')
    ? techEffects(state).alliedDefenseMult
    : 1;
  const allyScore = ((ally.dps + defense) * stance + ally.heal * HEALER_AUTO_COEF * 100)
    * (1 + ally.hp / 500) * alliedCompact;
  const enemyScore = enemy.dps * (1 + enemy.hp / 500);

  const ratio = allyScore / Math.max(1, enemyScore);
  const playerWins = ratio >= 1;

  const playerCas = playerWins
    ? Math.max(0, Math.floor(enemies.length * (1.1 - ratio) * 0.5))
    : allies.filter((s) => s.hull !== 'flagship').length;
  const enemyCas = playerWins
    ? enemies.length
    : Math.max(1, Math.floor(allies.filter((s) => s.hull !== 'flagship').length * (ratio * 0.6)));

  let healBonus = 0;
  if (ally.heal > 0 && playerWins) {
    healBonus = Math.floor(ally.heal * HEALER_AUTO_COEF);
  }
  const finalPlayerCas = Math.max(0, playerCas - healBonus);

  battle.lastResolve = {
    mode: 'auto',
    playerCasualties: finalPlayerCas,
    enemyCasualties: enemyCas,
    playerWins,
    allyScore: Math.round(allyScore),
    enemyScore: Math.round(enemyScore),
    antiFighterScore: Math.round(ally.antiFighter),
    bomberScore: Math.round(ally.bomber),
    defenseScore: Math.round(defense),
    stance: state.battleStance ?? 'balanced',
  };

  const destroyUnit = (unit) => {
    if (!unit) return;
    if (unit.isConvoy) {
      interceptConvoy(state, unit.convoyId ?? unit.id, { destroyed: true });
      return;
    }
    if (unit.isStructure) {
      const structure = systemById(state, systemId)?.structures?.find((entry) => entry.id === unit.id);
      if (structure) {
        structure.hp = 0;
        structure.disabledUntil = state.time + 60000;
      }
      return;
    }
    const playerShip = state.playerShips?.find((entry) => entry.id === unit.id);
    if (playerShip) {
      battle.destroyedFriendlyHullCost = (battle.destroyedFriendlyHullCost ?? 0)
        + (hullStats(playerShip.hull)?.cost ?? 0);
      playerShip.hp = 0;
      return;
    }
    const aiShip = state.aiShips?.find((entry) => entry.id === unit.id);
    if (aiShip) {
      aiShip.hp = 0;
      return;
    }
    if (unit.fleetId) removePirateShip(state, unit.fleetId, unit.id);
  };

  let pc = finalPlayerCas;
  for (const ship of [...allies].filter((s) => s.hull !== 'flagship')) {
    if (pc <= 0) break;
    destroyUnit(ship);
    pc--;
  }

  let ec = enemyCas;
  for (const ship of enemies) {
    if (ec <= 0) break;
    destroyUnit(ship);
    ec--;
  }

  if (allies.some((unit) => unit.hull === 'flagship')) {
    if (!playerWins) {
      state.flagship.hp = 0;
    } else {
      const damageFraction = Math.min(0.45, enemyScore / Math.max(1, allyScore + enemyScore));
      state.flagship.hp = Math.max(1, (state.flagship.hp ?? FLAGSHIP_HP) - Math.round(FLAGSHIP_HP * damageFraction));
    }
  }
  battle.casualtiesApplied = true;

  endBattle(state, systemId, playerWins ? 'player' : 'enemy');
  return battle.lastResolve;
}

function liveTacticalContext(battle) {
  const live = [];
  const bySide = new Map();
  for (const unit of battle.units ?? []) {
    if (unit.hp <= 0) continue;
    live.push(unit);
    const bucket = bySide.get(unit.side) ?? [];
    bucket.push(unit);
    bySide.set(unit.side, bucket);
  }
  return { live, bySide };
}

function spatialKeyFor(x, y) {
  const cx = Math.floor(x / TACTICAL_SPATIAL_CELL);
  const cy = Math.floor(y / TACTICAL_SPATIAL_CELL);
  return `${cx},${cy}`;
}

function buildSpatialIndex(units) {
  const cells = new Map();
  for (const unit of units) {
    const key = spatialKeyFor(unit.x, unit.y);
    const list = cells.get(key) ?? [];
    list.push(unit);
    cells.set(key, list);
  }
  return cells;
}

function considerTarget(unit, candidate, best, state) {
  if (!candidate || candidate.hp <= 0 || candidate.side === unit.side) return best;
  const dx = candidate.x - unit.x;
  const dy = candidate.y - unit.y;
  const d2 = dx * dx + dy * dy;
  const range = weaponProfile(unit.weaponProfile ?? 'kinetic').range ?? TACTICAL_WEAPON_RANGE;
  const inRangeBias = d2 <= range * range ? 0.45 : 1;
  const techState = techStateForUnit(state, unit);
  const damageBias = Math.max(
    0.2,
    effectiveDamageAgainst(unit, candidate, techState) / Math.max(1, effectiveDps(unit, techState)),
  );
  const score = d2 * inRangeBias / damageBias;
  if (score < best.score) return { target: candidate, d2, score };
  return best;
}

function nearestTarget(unit, live, spatialIndex, state) {
  let best = { target: null, d2: Infinity, score: Infinity };

  if (spatialIndex) {
    const cx = Math.floor(unit.x / TACTICAL_SPATIAL_CELL);
    const cy = Math.floor(unit.y / TACTICAL_SPATIAL_CELL);
    for (let ring = 0; ring <= 2; ring++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          if (ring > 0 && gx > cx - ring && gx < cx + ring && gy > cy - ring && gy < cy + ring) continue;
          const cell = spatialIndex.get(`${gx},${gy}`);
          if (!cell) continue;
          for (const candidate of cell) best = considerTarget(unit, candidate, best, state);
        }
      }
      if (best.target) return best.target;
    }
  }

  for (const candidate of live) best = considerTarget(unit, candidate, best, state);
  return best.target;
}

function activeOrderForUnit(battle, unit) {
  const orders = activeFleetOrders(battle, unit.side).filter((order) => order.type !== 'formation').slice().reverse();
  return orders.find((order) => order.subjectIds.length === 0 || order.subjectIds.includes(String(unit.id))) ?? null;
}

function formationOrderForUnit(battle, unit) {
  const orders = activeFleetOrders(battle, unit.side).filter((order) => order.type === 'formation').slice().reverse();
  return orders.find((order) => order.subjectIds.length === 0 || order.subjectIds.includes(String(unit.id))) ?? null;
}

function formationOffset(type, ordinal, count, spacing = TACTICAL_FORMATION_BASE_SPACING) {
  const centered = ordinal - (count - 1) / 2;
  if (type === 'column') return { x: -ordinal * spacing, y: 0 };
  if (type === 'echelon') return { x: -Math.abs(centered) * spacing * 0.65, y: centered * spacing };
  if (type === 'wedge') return { x: -Math.abs(centered) * spacing, y: centered * spacing * 0.9 };
  if (type === 'screen') {
    const angle = count <= 1 ? 0 : (ordinal / (count - 1) - 0.5) * Math.PI * 0.9;
    return { x: Math.cos(angle) * spacing * 2.4, y: Math.sin(angle) * spacing * 2.4 };
  }
  if (type === 'sphere') {
    const angle = (ordinal / Math.max(1, count)) * Math.PI * 2;
    return { x: Math.cos(angle) * spacing * 1.7, y: Math.sin(angle) * spacing * 1.7 };
  }
  return { x: 0, y: centered * spacing };
}

function priorityTarget(unit, context, spatialIndex, state, battle, environment = { range: 1 }) {
  const order = activeOrderForUnit(battle, unit);
  if (!order) return nearestTarget(unit, context.live, spatialIndex, state);
  return selectPriorityTarget(unit, context.live, order, {
    range: (weaponProfile(unit.weaponProfile ?? 'kinetic').range ?? TACTICAL_WEAPON_RANGE) * environment.range,
  });
}

function healAllies(unit, allies, repairMult, techState = null, battle = null, state = null) {
  if (!allies?.length) return;
  const delta = (healRateForShip(unit, techState) * repairMult * TICK_MS) / 1000;
  if (delta <= 0) return;
  let primary = null;
  let deepest = 0;
  for (const ally of allies) {
    if (ally.id === unit.id || ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
    const missing = ally.maxHp - ally.hp;
    ally.hp = Math.min(ally.maxHp, ally.hp + delta);
    if (missing > deepest) {
      deepest = missing;
      primary = ally;
    }
  }
  if (battle && state && primary) {
    // Throttle heal ribbons so every 50ms tick does not flood the FX buffer.
    const last = unit._lastHealFxAt ?? -Infinity;
    if (state.time - last >= 200) {
      unit._lastHealFxAt = state.time;
      emitHealFx(battle, { state, healer: unit, ally: primary });
    }
  }
}

function sideCentroid(units) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    x += unit.x;
    y += unit.y;
    n++;
  }
  return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

function livePlayerUnits(battle) {
  return (battle?.units ?? []).filter((unit) => unit.side === 'player' && unit.hp > 0);
}

function liveEnemyUnits(battle) {
  return (battle?.units ?? []).filter((unit) => unit.side !== 'player' && unit.hp > 0);
}

function activePlayerFormation(battle) {
  const orders = activeFleetOrders(battle, 'player').filter((order) => order.type === 'formation');
  return orders.length ? orders[orders.length - 1] : null;
}

function activePlayerFocusTargetId(battle) {
  const orders = activeFleetOrders(battle, 'player')
    .filter((order) => order.type === 'focus_fire' && order.targetId)
    .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
  return orders[0]?.targetId ?? null;
}

function fleetsInApproachBand(battle) {
  const friendlies = livePlayerUnits(battle);
  const enemies = liveEnemyUnits(battle);
  if (!friendlies.length || !enemies.length) return false;
  const fc = sideCentroid(friendlies);
  const ec = sideCentroid(enemies);
  const dist = Math.hypot(ec.x - fc.x, ec.y - fc.y);
  return dist >= APPROACH_BAND_INNER && dist <= APPROACH_BAND_OUTER;
}

function applyDoctrineFormation(state, battle, { force = false } = {}) {
  if (!battle?.active || battle.mode !== 'tactical') return { ok: false, reason: 'No tactical battle' };
  if (!force && battle.playerFormationOverride) {
    return { ok: false, reason: 'Player formation override active' };
  }
  const friendlies = livePlayerUnits(battle);
  if (!friendlies.length) return { ok: false, reason: 'No friendly units' };
  const enemies = liveEnemyUnits(battle);
  const doctrine = normalizeDoctrine(battle.doctrine ?? state.combatDoctrine);
  battle.doctrine = doctrine;
  const recommendation = recommendFormation({
    doctrine,
    ownMix: analyzeFleetMix(friendlies),
    enemyMix: analyzeFleetMix(enemies),
  });
  const subjectIds = friendlies.map((unit) => unit.id);
  const formationResult = applyFleetOrder(battle, {
    type: 'formation',
    side: 'player',
    formation: recommendation.formation,
    subjectIds,
  }, {
    time: state.time,
    units: battle.units,
    ownedUnitIds: subjectIds,
  });
  if (recommendation.targetClass && !activePlayerFocusTargetId(battle)) {
    applyFleetOrder(battle, {
      type: 'attack_class',
      side: 'player',
      targetClass: recommendation.targetClass,
      subjectIds,
      priority: 0,
    }, {
      time: state.time,
      units: battle.units,
      ownedUnitIds: subjectIds,
    });
  }
  battle.lastDoctrineRecommendation = recommendation;
  if (formationResult.ok && force) battle.playerFormationOverride = false;
  return {
    ok: formationResult.ok,
    recommendation,
    order: formationResult.order ?? null,
    reason: formationResult.reason ?? null,
  };
}

export function setCombatDoctrine(state, doctrine, systemId = null) {
  const normalized = normalizeDoctrine(doctrine);
  state.combatDoctrine = normalized;
  const battle = systemId
    ? state.systemBattles?.[systemId]
    : Object.values(state.systemBattles ?? {}).find((entry) => entry?.active && entry.mode === 'tactical');
  if (!battle?.active || battle.mode !== 'tactical') {
    return { ok: true, doctrine: normalized, applied: false };
  }
  battle.doctrine = normalized;
  battle.playerFormationOverride = false;
  const result = applyDoctrineFormation(state, battle, { force: true });
  battle.openingFormationApplied = true;
  return { ok: true, doctrine: normalized, applied: result.ok, recommendation: result.recommendation ?? null };
}

function maybeApplyApproachFormation(state, battle) {
  if (!battle?.active || battle.mode !== 'tactical') return;
  if (battle.autoFormationApplied || battle.playerFormationOverride) return;
  if (!fleetsInApproachBand(battle)) return;
  const result = applyDoctrineFormation(state, battle, { force: false });
  if (result.ok) battle.autoFormationApplied = true;
}

function pooledDamage(units, amount) {
  if (amount <= 0) return;
  let liveCount = 0;
  for (const unit of units) if (unit.hp > 0) liveCount++;
  if (!liveCount) return;
  const perUnit = amount / liveCount;
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    unit.hp = Math.max(0, unit.hp - perUnit);
  }
}

function markAttackers(units) {
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    if (unit.cooldownMs <= 0 && effectiveDps(unit) > 0) {
      unit.cooldownMs = TACTICAL_WEAPON_COOLDOWN_MS;
    }
  }
}

function pooledRepair(units, amount) {
  if (amount <= 0) return;
  let wounded = 0;
  for (const unit of units) {
    if (unit.hp > 0 && unit.hp < unit.maxHp) wounded++;
  }
  if (!wounded) return;
  const perUnit = amount / wounded;
  for (const unit of units) {
    if (unit.hp <= 0 || unit.hp >= unit.maxHp) continue;
    unit.hp = Math.min(unit.maxHp, unit.hp + perUnit);
  }
}

function formationDriftThrust(tier, approaching) {
  if (tier === 'capital' || tier === 'carrier') {
    return approaching ? { thrust: 0.35, strafeScale: 0.10 } : { thrust: 0.15, strafeScale: 0.10 };
  }
  if (tier === 'line') {
    return approaching ? { thrust: 0.50, strafeScale: 0.20 } : { thrust: 0.25, strafeScale: 0.20 };
  }
  if (tier === 'wing') {
    return approaching ? { thrust: 0.70, strafeScale: 0.45 } : { thrust: 0.45, strafeScale: 0.45 };
  }
  return approaching ? { thrust: 0.60, strafeScale: 0.35 } : { thrust: 0.35, strafeScale: 0.35 };
}

function formationDrift(units, target, sideOffset, tickIndex) {
  const dt = TICK_MS / 1000;
  const line = battleLineMembers(units);
  const lineCenter = line.length
    ? {
      x: line.reduce((s, u) => s + u.x, 0) / line.length,
      y: line.reduce((s, u) => s + u.y, 0) / line.length,
    }
    : null;
  const facingToTarget = lineCenter
    ? Math.atan2(target.y - lineCenter.y, target.x - lineCenter.x)
    : 0;
  let maxSpacingMult = 1;
  for (const member of line) {
    maxSpacingMult = Math.max(maxSpacingMult, hullMotionProfile(member.hull).formationSpacingMult);
  }
  const spacing = TACTICAL_FORMATION_BASE_SPACING * maxSpacingMult;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.hp <= 0 || unit.isStructure || unit.isConvoy) continue;
    if (unit.hull === 'flagship') continue;
    ensureUnitMotion(unit);
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const desired = TACTICAL_WEAPON_RANGE * 0.78;
    const approachFacing = Math.atan2(dy, dx);
    const strafeFacing = Math.atan2(ny * sideOffset, -nx * sideOffset);
    const strafeMix = Math.sin((tickIndex + i * 13) * 0.17);
    const profile = hullMotionProfile(unit.hull);
    const approaching = dist > desired;
    const drift = formationDriftThrust(profile.tier, approaching);
    let facing = approachFacing;
    let thrust = drift.thrust;
    if (!approaching) {
      facing = blendFacing(approachFacing, strafeFacing + strafeMix * drift.strafeScale, 0.85);
    }

    // Capitals/carriers soft-hold a lateral battle line even in large-battle drift.
    if (lineCenter && (profile.tier === 'capital' || profile.tier === 'carrier' || profile.tier === 'line')) {
      const ordinal = line.findIndex((member) => member.id === unit.id);
      if (ordinal >= 0) {
        const offset = formationOffset('line', ordinal, line.length, spacing);
        const slotX = lineCenter.x + offset.x * Math.cos(facingToTarget) - offset.y * Math.sin(facingToTarget);
        const slotY = lineCenter.y + offset.x * Math.sin(facingToTarget) + offset.y * Math.cos(facingToTarget);
        const slotFacing = Math.atan2(slotY - unit.y, slotX - unit.x);
        const slotDist = Math.hypot(slotX - unit.x, slotY - unit.y);
        const discipline = profile.formationDiscipline;
        facing = blendFacing(facing, slotFacing, discipline);
        if (slotDist > 18) thrust = Math.max(thrust, discipline * 0.35);
      }
    }

    const damageSpeed = damageStateModifiers(unit).speed;
    steerUnit(unit, facing, motionOptsForUnit(unit, { dt, thrust, damageSpeed }));
  }
  applyShipSeparation(units.filter((u) => u.hp > 0), {
    dt,
    strength: TACTICAL_SEPARATION_STRENGTH,
    skipIds: new Set(units.filter((u) => u.hull === 'flagship').map((u) => u.id)),
    getRadius: separationRadiusForUnit,
  });
}

function tickLargeTacticalBattle(state, systemId, battle, context, repairMult) {
  battle.largeTickIndex = (battle.largeTickIndex ?? 0) + 1;
  const lodInputs = createLargeBattleLodParityInputs(context.live, {
    seed: state.meta?.seed ?? state.seed ?? 0,
    tickIndex: battle.largeTickIndex,
    elapsedMs: state.time - battle.startedAt,
    orders: activeFleetOrders(battle),
  });
  battle.lodSignature = lodInputs.signature;
  battle.lodConservation = validateLodConservation(context.live, lodInputs).ok;
  const friendlies = context.live.filter((u) => u.side !== 'enemy');
  const enemies = context.live.filter((u) => u.side === 'enemy');
  if (!friendlies.length || !enemies.length) return;
  const environment = combatEnvironmentModifiers(systemById(state, systemId));

  for (const unit of context.live) {
    unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - TICK_MS);
  }

  const friendlyPower = totalPower(friendlies, state);
  const enemyPower = totalPower(enemies, state);
  const dt = TICK_MS / 1000;
  const friendlyDamage = friendlyPower.dps * environment.damage * dt;
  const enemyDamage = Math.max(0, (enemyPower.dps * environment.damage - friendlyPower.heal * HEALER_AUTO_COEF) * dt);

  markAttackers(friendlies);
  markAttackers(enemies);
  pooledDamage(enemies, friendlyDamage);
  pooledDamage(friendlies, enemyDamage);
  pooledRepair(friendlies, friendlyPower.heal * repairMult * dt);
  emitSparseLodFx(battle, { state, friendlies, enemies });

  const fc = sideCentroid(friendlies);
  const ec = sideCentroid(enemies);
  formationDrift(friendlies, ec, 1, battle.largeTickIndex);
  formationDrift(enemies, fc, -1, battle.largeTickIndex);
}

function tickTacticalBattle(state, systemId, battle) {
  if (!battle.units) initTacticalUnits(state, systemId, battle);
  maybeApplyApproachFormation(state, battle);
  const system = getSystems(state)[systemId];
  const retreatOrder = activeFleetOrders(battle, 'player').find((order) => order.type === 'emergency_retreat');
  if (retreatOrder) {
    const hostileInterdiction = (battle.units ?? []).some(
      (unit) => unit.side !== 'player' && unit.isStructure
        && unit.structureType === 'interdiction_array' && unit.hp > 0,
    );
    if (hostileInterdiction) {
      battle.retreatStartedAt = null;
      battle.retreatBlockedBy = 'interdiction_array';
    } else {
      battle.retreatBlockedBy = null;
      battle.retreatStartedAt ??= state.time;
    }
    const hostileFactionId = (battle.units ?? []).find((unit) => unit.side !== 'player' && unit.factionId)?.factionId;
    const retreatChargeMs = 1500 * (hostileFactionId
      ? structureEnemyRetreatChargeMultiplier(state, systemId, {
        owner: 'ai',
        factionId: hostileFactionId,
      })
      : 1);
    if (!hostileInterdiction && state.time - battle.retreatStartedAt >= retreatChargeMs) {
      battle.lastResolve = { mode: 'tactical', playerWins: false, retreated: true, playerCasualties: 0 };
      endBattle(state, systemId, 'retreated');
      return;
    }
  }
  const context = liveTacticalContext(battle);
  const largeBattle = context.live.length >= TACTICAL_LARGE_BATTLE_UNITS;
  const sys = systemById(state, systemId);
  const environment = combatEnvironmentModifiers(sys);
  const repairMult = (sys ? shellRepairBonus(sys) : 1) * supplyCacheRepairMultiplier(state, systemId);

  if (largeBattle) {
    tickLargeTacticalBattle(state, systemId, battle, context, repairMult);
    const afterLarge = liveTacticalContext(battle);
    const friendlyLarge = (afterLarge.bySide.get('player')?.length ?? 0) + (afterLarge.bySide.get('ai')?.length ?? 0);
    const enemyLarge = afterLarge.bySide.get('enemy')?.length ?? 0;
    if (enemyLarge === 0) {
      battle.lastResolve = { mode: 'tactical', playerWins: true, enemyCasualties: collectEnemyShips(state, systemId).length };
      endBattle(state, systemId, 'player');
    } else if (friendlyLarge === 0) {
      battle.lastResolve = { mode: 'tactical', playerWins: false, playerCasualties: playerCombatShipsAtSystem(state, systemId).length };
      endBattle(state, systemId, 'enemy');
    }
    return;
  }

  const spatialIndex = context.live.length >= Math.floor(TACTICAL_LARGE_BATTLE_UNITS * 0.65)
    ? buildSpatialIndex(context.live)
    : null;
  const bodyCache = buildKeepOutBodyCache(system, state.time);
  const dt = TICK_MS / 1000;
  const flagshipSkipIds = new Set();
  const unitById = new Map(battle.units.map((u) => [u.id, u]));

  const bySideLive = new Map();
  const bySideLine = new Map();
  const hostileBySide = new Map();
  for (const unit of context.live) {
    const side = unit.side ?? 'player';
    if (!bySideLive.has(side)) bySideLive.set(side, []);
    bySideLive.get(side).push(unit);
  }
  for (const [side, units] of bySideLive) {
    bySideLine.set(side, battleLineMembers(units));
    const hostiles = [];
    for (const [otherSide, otherUnits] of bySideLive) {
      if (otherSide === side) continue;
      hostiles.push(...otherUnits);
    }
    hostileBySide.set(side, hostiles);
  }

  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    ensureUnitMotion(unit);
    unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - TICK_MS);
    const order = activeOrderForUnit(battle, unit);
    const formationOrder = formationOrderForUnit(battle, unit);

    // Piloted flagship: sync pose, never AI-steer (still fires below).
    if (unit.hull === 'flagship') {
      flagshipSkipIds.add(unit.id);
      if (state.flagship && !state.flagship.transit && !state.flagship.wormholeTransit) {
        unit.x = state.flagship.x;
        unit.y = state.flagship.y;
        unit.heading = state.flagship.heading ?? unit.heading;
        unit.vx = state.flagship.vx ?? 0;
        unit.vy = state.flagship.vy ?? 0;
      }
    }

    if (unit.isWing) {
      unit.fuel = Math.max(0, (unit.fuel ?? 100) - TICK_MS / 1000);
      if (unit.fuel <= 0 || (unit.ammo ?? 0) <= 0) unit.returning = true;
      if (unit.returning) {
        const carrier = battle.units.find((candidate) => candidate.id === unit.parentCarrierId && candidate.hp > 0);
        if (carrier) {
          const dx = carrier.x - unit.x;
          const dy = carrier.y - unit.y;
          const dist = Math.hypot(dx, dy) || 1;
          steerUnit(unit, Math.atan2(dy, dx), motionOptsForUnit(unit, {
            dt,
            thrust: 1,
            speedMult: 1.35,
          }));
          if (dist < 28) unit.recovered = true;
        }
        nudgeUnitKeepOut(state, system, unit, bodyCache);
        continue;
      }
    }

    const unitTechState = techStateForUnit(state, unit);
    const healRate = healRateForShip(unit, unitTechState);
    if (healRate > 0) {
      healAllies(unit, context.bySide.get(unit.side), repairMult, unitTechState, battle, state);
    } else {
      const profile = weaponProfile(unit.weaponProfile ?? 'kinetic');
      const localRangeMultiplier = unit.side === 'player'
        ? structureWeaponRangeMultiplier(state, systemId) * techEffects(state).weaponRangeMult
        : 1;
      const range = (profile.range ?? TACTICAL_WEAPON_RANGE) * environment.range * localRangeMultiplier;
      const damageMods = damageStateModifiers(unit);

      const target = resolveStickyTarget(
        unit,
        () => priorityTarget(unit, context, spatialIndex, state, battle, environment),
        {
          nowMs: state.time,
          stickMs: TACTICAL_TARGET_STICK_MS,
          leashDist: range * TACTICAL_TARGET_LEASH_MULT,
          findById: (id) => unitById.get(id),
        },
      );

      const canSteer = unit.hull !== 'flagship' && !unit.isStructure && !unit.isConvoy;
      if (canSteer) {
        let desiredFacing = unit.heading;
        let thrust = 0;
        const motionProfile = hullMotionProfile(unit.hull);
        const discipline = motionProfile.formationDiscipline;
        const chase = motionProfile.chaseFreedom;
        const sideLive = bySideLive.get(unit.side) ?? [];
        const sideLine = bySideLine.get(unit.side) ?? [];
        const hostiles = hostileBySide.get(unit.side) ?? [];
        const formationType = formationOrder?.formation ?? 'line';
        const useBattleLine = !!formationOrder || discipline >= TACTICAL_BATTLE_LINE_DISCIPLINE_MIN;

        const faceTarget = target
          ? Math.atan2(target.y - unit.y, target.x - unit.x)
          : unit.heading;
        const dist = target
          ? (Math.hypot(target.x - unit.x, target.y - unit.y) || 1)
          : 0;

        // High-priority orders can fully own facing/thrust.
        let orderOwned = false;
        const rallyPoint = order?.type === 'rally' ? order.point : null;
        if (rallyPoint) {
          const rdx = rallyPoint.x - unit.x;
          const rdy = rallyPoint.y - unit.y;
          const rallyDistance = Math.hypot(rdx, rdy) || 1;
          if (rallyDistance > Math.max(20, order.radius ?? 45)) {
            desiredFacing = Math.atan2(rdy, rdx);
            thrust = 1;
            orderOwned = true;
          }
        } else if (['screen', 'protect', 'escort_convoy'].includes(order?.type)) {
          const anchorId = order.type === 'escort_convoy' ? order.convoyId : order.targetId;
          const anchor = battle.units.find((candidate) => candidate.id === anchorId && candidate.hp > 0);
          if (anchor && anchor.id !== unit.id) {
            const adx = anchor.x - unit.x;
            const ady = anchor.y - unit.y;
            const anchorDistance = Math.hypot(adx, ady) || 1;
            const desiredScreen = order.type === 'screen' ? 95 : 65;
            if (anchorDistance > desiredScreen) {
              desiredFacing = Math.atan2(ady, adx);
              thrust = 1;
              orderOwned = true;
            }
          }
        }

        if (!orderOwned) {
          const forceEscortSlots = !!formationOrder && motionProfile.tier === 'escort';
          const slot = (useBattleLine && !isWingUnit(unit))
            ? pickFleetSlotGoal(unit, sideLive, hostiles, formationType, {
              offsetFn: formationOffset,
              members: forceEscortSlots ? undefined : sideLine,
              forceEscortSlots,
            })
            : null;

          if (slot) {
            const formFacing = Math.atan2(slot.y - unit.y, slot.x - unit.x);
            const blended = blendCombatGoal({
              faceTarget,
              formFacing,
              discipline,
              chase,
              dist,
              range,
              band: TACTICAL_APPROACH_BAND,
              slotDistance: slot.distance,
              holdOrder: order?.type === 'hold',
              hasSlot: true,
            });
            desiredFacing = blended.desiredFacing;
            thrust = blended.thrust;
          } else {
            const blended = blendCombatGoal({
              faceTarget,
              discipline,
              chase,
              dist,
              range,
              band: TACTICAL_APPROACH_BAND,
              holdOrder: order?.type === 'hold',
              hasSlot: false,
            });
            desiredFacing = blended.desiredFacing;
            thrust = blended.thrust;

            // Explicit formation order including escorts: weak pull toward side line if any.
            if (formationOrder && !isWingUnit(unit) && order?.type !== 'hold') {
              const escortSlot = pickFleetSlotGoal(unit, sideLive, hostiles, formationType, {
                offsetFn: formationOffset,
                forceEscortSlots: true,
              });
              if (escortSlot && escortSlot.distance > TACTICAL_FORMATION_PULL_MIN) {
                const formFacing = Math.atan2(escortSlot.y - unit.y, escortSlot.x - unit.x);
                desiredFacing = blendFacing(desiredFacing, formFacing, discipline);
                thrust = Math.max(thrust, discipline * 0.3);
              }
            }
          }
        }

        steerUnit(unit, desiredFacing, motionOptsForUnit(unit, {
          dt,
          thrust,
          envSpeed: environment.speed,
          damageSpeed: damageMods.speed,
        }));
      }

      if (!target) {
        continue;
      }

      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (unit.hull === 'flagship' && Array.isArray(unit.weapons) && unit.weapons.length > 0) {
        unit.hardpointFireAt = unit.hardpointFireAt ?? {};
        let anyFired = false;
        for (const slot of unit.weapons) {
          slot.cooldownMs = Math.max(0, (slot.cooldownMs ?? 0) - TICK_MS);
          if (slot.cooldownMs > 0) continue;
          const slotProfile = weaponProfile(slot.profile);
          const slotRange = (slotProfile.range ?? TACTICAL_WEAPON_RANGE) * environment.range * localRangeMultiplier;
          if (dist > slotRange) continue;
          const share = 1 / Math.max(1, unit.weapons.length);
          const damage = effectiveDamageAgainst(
            { ...unit, weaponProfile: slot.profile },
            target,
            unitTechState,
          ) * environment.damage * damageMods.damage * (TICK_MS / 1000) * share * 3.2;
          const hit = applyFacedDamage(target, damage, unit);
          battle.events = battle.events ?? [];
          if (battle.events.length < 100 && (hit.damageState === 'critical' || hit.damageState === 'destroyed')) {
            battle.events.push({ at: state.time - battle.startedAt, type: hit.damageState, actorId: unit.id, targetId: target.id });
          }
          const muzzle = slot.muzzle ?? { x: 1, y: 0 };
          const cos = Math.cos(unit.heading ?? 0);
          const sin = Math.sin(unit.heading ?? 0);
          const muzzleWorld = {
            x: unit.x + (muzzle.x * cos - muzzle.y * sin) * 12,
            y: unit.y + (muzzle.x * sin + muzzle.y * cos) * 12,
          };
          emitShotFx(battle, {
            state,
            attacker: { ...unit, x: muzzleWorld.x, y: muzzleWorld.y },
            target,
            hit,
            profile: slot.profile,
          });
          slot.cooldownMs = slotProfile.cooldownMs ?? TACTICAL_WEAPON_COOLDOWN_MS;
          slot.lastFiredAt = state.time;
          unit.hardpointFireAt[slot.id] = state.time;
          if (state.flagship?.weapons) {
            const persisted = state.flagship.weapons.find((w) => w.id === slot.id);
            if (persisted) {
              persisted.cooldownMs = slot.cooldownMs;
              persisted.lastFiredAt = state.time;
            }
          }
          anyFired = true;
        }
        if (anyFired) unit.cooldownMs = TACTICAL_WEAPON_COOLDOWN_MS * 0.25;
      } else if (unit.cooldownMs <= 0 && effectiveDps(unit, unitTechState) > 0) {
        const damage = effectiveDamageAgainst(unit, target, unitTechState) * environment.damage
          * damageMods.damage * (TICK_MS / 1000);
        const hit = applyFacedDamage(target, damage, unit);
        battle.events = battle.events ?? [];
        if (battle.events.length < 100 && (hit.damageState === 'critical' || hit.damageState === 'destroyed')) {
          battle.events.push({ at: state.time - battle.startedAt, type: hit.damageState, actorId: unit.id, targetId: target.id });
        }
        emitShotFx(battle, {
          state,
          attacker: unit,
          target,
          hit,
          profile: unit.weaponProfile ?? defaultWeaponProfileForHull(unit.hull),
        });
        if (unit.isWing) unit.ammo = Math.max(0, (unit.ammo ?? 0) - 1);
        unit.cooldownMs = profile.cooldownMs ?? TACTICAL_WEAPON_COOLDOWN_MS;
      }
    }
  }

  const mobiles = context.live.filter((u) => u.hp > 0);
  applyShipSeparation(mobiles, {
    dt,
    strength: TACTICAL_SEPARATION_STRENGTH,
    skipIds: flagshipSkipIds,
    spatialIndex: mobiles.length >= Math.floor(TACTICAL_LARGE_BATTLE_UNITS * 0.65)
      ? buildSpatialIndex(mobiles)
      : spatialIndex,
    getRadius: separationRadiusForUnit,
    maxSpeedFor: (u) => motionOptsForUnit(u, {
      dt,
      envSpeed: environment.speed,
      damageSpeed: damageStateModifiers(u).speed,
    }).maxSpeed,
  });

  // Celestial keep-out after separation (flagship stays piloted).
  for (const unit of mobiles) {
    if (unit.hull === 'flagship') continue;
    nudgeUnitKeepOut(state, system, unit, bodyCache);
  }

  const after = liveTacticalContext(battle);
  const friendlyAlive = (after.bySide.get('player')?.length ?? 0) + (after.bySide.get('ai')?.length ?? 0);
  const enemyAlive = after.bySide.get('enemy')?.length ?? 0;

  if (enemyAlive === 0) {
    battle.lastResolve = { mode: 'tactical', playerWins: true, enemyCasualties: collectEnemyShips(state, systemId).length };
    endBattle(state, systemId, 'player');
  } else if (friendlyAlive === 0) {
    battle.lastResolve = { mode: 'tactical', playerWins: false, playerCasualties: playerCombatShipsAtSystem(state, systemId).length };
    endBattle(state, systemId, 'enemy');
  }
}

function tickAutoBattle(state, systemId, battle) {
  battle.autoProgressMs = (battle.autoProgressMs ?? 0) + TICK_MS;
  if (battle.autoProgressMs >= 3000) {
    resolveAutoBattle(state, systemId, battle);
  }
}

export function checkBattleTrigger(state, systemId) {
  if (!shouldBattle(state, systemId)) {
    if (state.systemBattles[systemId]?.active) {
      delete state.systemBattles[systemId];
    }
    return null;
  }
  if (state.systemBattles[systemId]?.active) return state.systemBattles[systemId];
  return startBattle(state, systemId);
}

function combatCandidateSystemIds(state) {
  const ids = new Set(Object.keys(state.systemBattles ?? {}));

  if (state.flagship?.galaxyId === state.activeGalaxyId && state.flagship.systemId) {
    ids.add(state.flagship.systemId);
  }

  for (const ship of state.playerShips ?? []) {
    if (ship.galaxyId === state.activeGalaxyId && ship.systemId && !ship.transit && ship.hp > 0) {
      ids.add(ship.systemId);
    }
  }

  for (const ship of state.aiShips ?? []) {
    if (ship.galaxyId === state.activeGalaxyId && ship.systemId && !ship.transit && ship.hp > 0) {
      ids.add(ship.systemId);
    }
  }

  for (const fleet of state.pirates?.fleets ?? []) {
    if (fleet.galaxyId === state.activeGalaxyId && fleet.systemId && !fleet.transit) {
      ids.add(fleet.systemId);
    }
  }

  for (const hero of state.heroFlagships ?? []) {
    if (hero.galaxyId === state.activeGalaxyId && hero.systemId && !hero.transit) {
      ids.add(hero.systemId);
    }
  }

  return ids;
}

export function tickCombat(state) {
  const events = [];
  const systemIds = combatCandidateSystemIds(state);

  for (const systemId of systemIds) {
    if (!shouldBattle(state, systemId)) {
      if (state.systemBattles?.[systemId]) delete state.systemBattles[systemId];
      continue;
    }

    let battle = state.systemBattles[systemId];
    if (!battle?.active) battle = startBattle(state, systemId);

    const hadResolve = !!battle.lastResolve;
    if (battle.mode === 'tactical') tickTacticalBattle(state, systemId, battle);
    else tickAutoBattle(state, systemId, battle);

    if (battle.lastResolve && !hadResolve) {
      events.push({ systemId, ...battle.lastResolve });
    }
  }
  return events;
}

export function getBattleState(state, systemId) {
  return state.systemBattles[systemId] ?? null;
}

export function battleSummaryForSystem(state, systemId) {
  const battle = state.systemBattles[systemId];
  if (!battle) return null;
  const allies = collectAllyShips(state, systemId);
  const enemies = collectEnemyShips(state, systemId);
  const formationOrder = activePlayerFormation(battle);
  return {
    active: battle.active,
    mode: battle.mode,
    playerShips: allies.length,
    enemyShips: enemies.length,
    playerHp: allies.reduce((s, u) => s + u.hp, 0),
    enemyHp: enemies.reduce((s, u) => s + u.hp, 0),
    wingState: (battle.units ?? []).filter((u) => u.isWing).reduce((acc, u) => {
      acc.launched++;
      if (u.hp <= 0) acc.lost++;
      else acc.ready++;
      return acc;
    }, { launched: 0, ready: 0, lost: 0 }),
    weaponSummary: battle.active ? {
      antiFighter: Math.round(totalPower(allies, state).antiFighter),
      bomber: Math.round(totalPower(allies, state).bomber),
      defense: bodyStructureDefensePower(state, systemId),
      ion: bodyStructureIonPower(state, systemId),
    } : null,
    fx: combatFxSummary(battle, state.time),
    environment: combatEnvironmentModifiers(systemById(state, systemId)),
    lastResolve: battle.lastResolve,
    doctrine: battle.doctrine ?? state.combatDoctrine ?? null,
    formation: formationOrder?.formation ?? null,
    autoFormationApplied: !!battle.autoFormationApplied,
    playerFormationOverride: !!battle.playerFormationOverride,
    approachBand: battle.active && battle.mode === 'tactical' ? fleetsInApproachBand(battle) : false,
    focusTargetId: activePlayerFocusTargetId(battle),
    selectedCount: Array.isArray(battle.uiSelectionIds) ? battle.uiSelectionIds.length : 0,
  };
}

export function setBattleStance(state, stance) {
  if (!STANCE_MODIFIERS[stance]) return false;
  state.battleStance = stance;
  return true;
}

export function onForcesArrive(state, systemId) {
  return checkBattleTrigger(state, systemId);
}
