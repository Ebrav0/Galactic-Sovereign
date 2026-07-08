// Hybrid combat: tactical (flagship present) + auto-resolve (Phase 2.4–2.7).

import {
  TICK_MS,
  TACTICAL_WEAPON_RANGE,
  TACTICAL_WEAPON_COOLDOWN_MS,
  TACTICAL_SHIP_SPEED,
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
  effectiveDps,
  effectiveDamageAgainst,
  healRateForShip,
  createFlagshipCombatUnit,
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
  bodyStructureDefensePower,
  bodyStructureIonPower,
} from './body-structures.js';
import { techEffects } from './tech-web.js';

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

function playerForcesInSystem(state, systemId) {
  const ships = [
    ...playerCombatShipsAtSystem(state, systemId),
    ...anchoredCombatShipsAtSystem(state, systemId),
  ];
  const hasFlagship = flagshipInSystem(state, systemId);
  return { ships, hasFlagship };
}

function shouldBattle(state, systemId) {
  const pirates = pirateFleetAtSystem(state, systemId);
  const aiShips = aiShipsInSystem(state, systemId);
  const system = getSystems(state)[systemId];
  if (!pirates.length && !aiShips.length) return false;
  const { ships, hasFlagship } = playerForcesInSystem(state, systemId);
  if (ships.length > 0 || hasFlagship || heroInSystem(state, systemId)) return true;
  if (system?.owner === 'player' || system?.owner === 'ai') return true;
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
  if (system?.owner === 'player') {
    for (const ship of aiShipsInSystem(state, systemId)) {
      out.push({ ...ship, side: 'enemy' });
    }
  }
  return out;
}

function collectAllyShips(state, systemId) {
  const out = [];
  const system = getSystems(state)[systemId];
  const { ships, hasFlagship } = playerForcesInSystem(state, systemId);
  if (system?.owner === 'ai') {
    for (const ship of aiShipsInSystem(state, systemId)) {
      out.push({ ...ship, side: 'ai' });
    }
    return out;
  }
  for (const ship of ships) {
    out.push({ ...ship, side: 'player' });
  }
  if (hasFlagship) {
    const existing = state.systemBattles[systemId]?.flagshipHp ?? FLAGSHIP_HP;
    out.push({
      ...createFlagshipCombatUnit(),
      hp: existing,
      maxHp: FLAGSHIP_HP,
      side: 'player',
    });
  }
  if (system?.owner === 'player') {
    for (const structure of system.structures ?? []) {
      if (structure.hp != null && structure.hp <= 0) continue;
      if (structure.type === 'orbital_defense') {
        out.push({
          id: structure.id,
          hull: 'patrol_cutter',
          hp: structure.hp ?? 260,
          maxHp: structure.maxHp ?? 260,
          side: 'player',
          isStructure: true,
          structureType: structure.type,
          weaponProfile: 'point_defense',
        });
      } else if (structure.type === 'ion_battery') {
        out.push({
          id: structure.id,
          hull: 'sensor_ship',
          hp: structure.hp ?? 220,
          maxHp: structure.maxHp ?? 220,
          side: 'player',
          isStructure: true,
          structureType: structure.type,
          weaponProfile: 'ion',
        });
      }
    }
  }
  return out;
}

function launchCarrierWings(state, battle, carrier, side, ordinal) {
  if (!carrier || carrier.hp <= 0) return [];
  if (!carrierWingLoadout(carrier, state).length) return [];
  if (side !== 'enemy' && !techEffects(state).carrierWings) return [];

  const source = side === 'player'
    ? state.playerShips?.find((s) => s.id === carrier.id)
    : null;
  const wingState = source ? normalizeCarrierWingState(source, state) : normalizeCarrierWingState(carrier, state);
  const ready = Math.floor(wingState?.ready ?? maxCarrierWingCount(carrier, state));
  if (ready <= 0) return [];

  const loadout = carrierWingLoadout(carrier, state).slice(0, ready);
  battle.wingLaunches = battle.wingLaunches ?? {};
  battle.wingLaunches[carrier.id] = (battle.wingLaunches[carrier.id] ?? 0) + loadout.length;
  if (wingState) wingState.launched = loadout.length;

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
      weaponProfile: hull === 'bomber' ? 'torpedo' : (hull === 'interceptor' ? 'point_defense' : 'kinetic'),
    };
  });
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
}

function startBattle(state, systemId) {
  const tactical = tacticalAnchorInSystem(state, systemId);
  const battle = {
    active: true,
    mode: tactical ? 'tactical' : 'auto',
    startedAt: state.time,
    entryVector: seededEntryVector(state.meta.seed, systemId, state.time),
    lastResolve: null,
    flagshipHp: state.systemBattles[systemId]?.flagshipHp ?? FLAGSHIP_HP,
  };
  if (tactical) initTacticalUnits(state, systemId, battle);
  else battle.autoProgressMs = 0;
  state.systemBattles[systemId] = battle;
  return battle;
}

function applyCasualtiesToState(state, systemId, battle) {
  const pirateLosses = battle.lastResolve?.enemyCasualties ?? 0;
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
      if (unit.side !== 'player' || unit.hull === 'flagship') continue;
      if (unit.isStructure) {
        const system = systemById(state, systemId);
        const structure = system?.structures.find((s) => s.id === unit.id);
        if (structure) {
          structure.hp = Math.max(0, unit.hp);
          structure.disabledUntil = structure.hp <= 0 ? state.time + 60000 : (structure.disabledUntil ?? 0);
        }
        continue;
      }
      if (unit.isWing) continue;
      const ship = state.playerShips.find((s) => s.id === unit.id);
      if (ship) ship.hp = Math.max(0, unit.hp);
    }
    const flagshipUnit = battle.units.find((u) => u.hull === 'flagship');
    if (flagshipUnit) battle.flagshipHp = flagshipUnit.hp;

    for (const [carrierId, launched] of Object.entries(battle.wingLaunches ?? {})) {
      const ship = state.playerShips.find((s) => s.id === carrierId);
      if (!ship) continue;
      const wing = normalizeCarrierWingState(ship, state);
      const surviving = battle.units.filter((u) => u.parentCarrierId === carrierId && u.hp > 0).length;
      const lost = Math.max(0, launched - surviving);
      wing.lost = Math.min(maxCarrierWingCount(ship, state), (wing.lost ?? 0) + lost);
      wing.ready = Math.max(0, maxCarrierWingCount(ship, state) - wing.lost);
      wing.launched = 0;
    }
  }
}

function endBattle(state, systemId, winner) {
  const battle = state.systemBattles[systemId];
  if (battle) {
    battle.active = false;
    battle.winner = winner;
    applyCasualtiesToState(state, systemId, battle);
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
    dps += effectiveDps(u, state);
    hp += u.hp;
    heal += healRateForShip(u, state);
    if ((u.weaponProfile ?? '') === 'point_defense' || CARRIER_WING_HULLS.includes(u.hull)) {
      antiFighter += effectiveDps(u, state) * (weaponProfile(u.weaponProfile ?? 'kinetic').antiFighter ?? 1);
    }
    if (u.hull === 'bomber' || (u.weaponProfile ?? '') === 'torpedo') {
      bomber += effectiveDps(u, state);
    }
  }
  return { dps, hp, heal, antiFighter, bomber };
}

function resolveAutoBattle(state, systemId, battle) {
  const allies = collectAllyShips(state, systemId);
  const enemies = collectEnemyShips(state, systemId);
  const stance = STANCE_MODIFIERS[state.battleStance ?? 'balanced'] ?? 1;
  const ally = totalPower(allies, state);
  const enemy = totalPower(enemies, state);
  const defense = bodyStructureDefensePower(state, systemId) + bodyStructureIonPower(state, systemId);

  const allyScore = ((ally.dps + defense) * stance + ally.heal * HEALER_AUTO_COEF * 100) * (1 + ally.hp / 500);
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

  let pc = finalPlayerCas;
  for (const ship of [...allies].filter((s) => s.hull !== 'flagship')) {
    if (pc <= 0) break;
    const ps = state.playerShips.find((s) => s.id === ship.id);
    if (ps) { ps.hp = 0; pc--; }
  }

  let ec = enemyCas;
  for (const ship of enemies) {
    if (ec <= 0) break;
    removePirateShip(state, ship.fleetId, ship.id);
    ec--;
  }

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
  const damageBias = Math.max(0.2, effectiveDamageAgainst(unit, candidate, state) / Math.max(1, effectiveDps(unit, state)));
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

function healAllies(unit, allies, repairMult) {
  if (!allies?.length) return;
  const delta = (healRateForShip(unit) * repairMult * TICK_MS) / 1000;
  if (delta <= 0) return;
  for (const ally of allies) {
    if (ally.id === unit.id || ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
    ally.hp = Math.min(ally.maxHp, ally.hp + delta);
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

function formationDrift(units, target, sideOffset, tickIndex) {
  const dt = TICK_MS / 1000;
  const speed = TACTICAL_SHIP_SPEED * 0.38 * dt;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.hp <= 0) continue;
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const desired = TACTICAL_WEAPON_RANGE * 0.78;
    const strafe = Math.sin((tickIndex + i * 13) * 0.17) * speed * 0.7;
    if (dist > desired) {
      unit.x += nx * speed;
      unit.y += ny * speed;
    } else {
      unit.x += -ny * strafe * sideOffset;
      unit.y += nx * strafe * sideOffset;
    }
    unit.heading = Math.atan2(dy, dx);
  }
}

function tickLargeTacticalBattle(state, systemId, battle, context, repairMult) {
  battle.largeTickIndex = (battle.largeTickIndex ?? 0) + 1;
  const friendlies = context.live.filter((u) => u.side !== 'enemy');
  const enemies = context.live.filter((u) => u.side === 'enemy');
  if (!friendlies.length || !enemies.length) return;

  for (const unit of context.live) {
    unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - TICK_MS);
  }

  const friendlyPower = totalPower(friendlies, state);
  const enemyPower = totalPower(enemies, state);
  const dt = TICK_MS / 1000;
  const friendlyDamage = friendlyPower.dps * dt;
  const enemyDamage = Math.max(0, (enemyPower.dps - friendlyPower.heal * HEALER_AUTO_COEF) * dt);

  markAttackers(friendlies);
  markAttackers(enemies);
  pooledDamage(enemies, friendlyDamage);
  pooledDamage(friendlies, enemyDamage);
  pooledRepair(friendlies, friendlyPower.heal * repairMult * dt);

  const fc = sideCentroid(friendlies);
  const ec = sideCentroid(enemies);
  formationDrift(friendlies, ec, 1, battle.largeTickIndex);
  formationDrift(enemies, fc, -1, battle.largeTickIndex);
}

function tickTacticalBattle(state, systemId, battle) {
  if (!battle.units) initTacticalUnits(state, systemId, battle);
  const system = getSystems(state)[systemId];
  const context = liveTacticalContext(battle);
  const largeBattle = context.live.length >= TACTICAL_LARGE_BATTLE_UNITS;
  const sys = systemById(state, systemId);
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

  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - TICK_MS);

    const healRate = healRateForShip(unit);
    if (healRate > 0) {
      healAllies(unit, context.bySide.get(unit.side), repairMult);
    } else {
      const target = nearestTarget(unit, context.live, spatialIndex, state);
      if (!target) continue;
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = TACTICAL_SHIP_SPEED * (TICK_MS / 1000);
      const profile = weaponProfile(unit.weaponProfile ?? 'kinetic');
      const range = profile.range ?? TACTICAL_WEAPON_RANGE;
      if (dist > range * 0.85) {
        unit.x += (dx / dist) * speed;
        unit.y += (dy / dist) * speed;
        unit.heading = Math.atan2(dy, dx);
      } else if (unit.cooldownMs <= 0 && effectiveDps(unit, state) > 0) {
        target.hp -= effectiveDamageAgainst(unit, target, state) * (TICK_MS / 1000);
        unit.cooldownMs = profile.cooldownMs ?? TACTICAL_WEAPON_COOLDOWN_MS;
      }
    }

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
    lastResolve: battle.lastResolve,
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
