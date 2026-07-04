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
} from './constants.js';
import {
  effectiveDps,
  healRateForShip,
  createFlagshipCombatUnit,
  hullStats,
} from './hull.js';
import { pirateFleetAtSystem, removePirateShip } from './pirates.js';
import { playerCombatShipsAtSystem, stationedShipPose } from './fleets.js';
import { softKeepOut, nudgeUnitKeepOut } from './ship-motion.js';
import { getSystems, getGraph } from './galaxy-scope.js';

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

function playerForcesInSystem(state, systemId) {
  const ships = playerCombatShipsAtSystem(state, systemId);
  const hasFlagship = flagshipInSystem(state, systemId);
  return { ships, hasFlagship };
}

function shouldBattle(state, systemId) {
  const pirates = pirateFleetAtSystem(state, systemId);
  if (!pirates.length) return false;
  const { ships, hasFlagship } = playerForcesInSystem(state, systemId);
  if (ships.length > 0 || hasFlagship) return true;
  if (getSystems(state)[systemId]?.owner === 'player') return true;
  return false;
}

function collectEnemyShips(state, systemId) {
  const out = [];
  for (const fleet of pirateFleetAtSystem(state, systemId)) {
    for (const ship of fleet.ships) {
      if (ship.hp > 0) out.push({ ...ship, fleetId: fleet.id, side: 'enemy' });
    }
  }
  return out;
}

function collectAllyShips(state, systemId) {
  const out = [];
  const { ships, hasFlagship } = playerForcesInSystem(state, systemId);
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
  return out;
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
    if (ship.hull === 'flagship') {
      const f = state.flagship;
      const safe = softKeepOut(state, system, f.x, f.y);
      battle.units.push({
        ...ship,
        x: safe.x,
        y: safe.y,
        heading: f.heading ?? 0,
        cooldownMs: 0,
      });
      continue;
    }
    const pose = stationedShipPose(state, system, ship, combatIdx, combatAllies.length);
    const safe = softKeepOut(state, system, pose.x, pose.y);
    battle.units.push({
      ...ship,
      x: safe.x,
      y: safe.y,
      heading: pose.heading,
      cooldownMs: 0,
    });
    combatIdx++;
  }

  const enemies = collectEnemyShips(state, systemId);
  enemies.forEach((ship, i) => {
    const spread = (i / Math.max(1, enemies.length)) * Math.PI * 0.7 - Math.PI * 0.35;
    const heading = entryAngle + Math.PI + spread;
    const rawX = ex + Math.cos(spread) * 120;
    const rawY = ey + Math.sin(spread) * 120;
    const safe = softKeepOut(state, system, rawX, rawY);
    battle.units.push({
      ...ship,
      x: safe.x,
      y: safe.y,
      heading,
      cooldownMs: 0,
    });
  });
}

function startBattle(state, systemId) {
  const tactical = flagshipInSystem(state, systemId);
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

function livingUnits(battle, side) {
  return battle.units.filter((u) => u.hp > 0 && u.side === side);
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
      const ship = state.playerShips.find((s) => s.id === unit.id);
      if (ship) ship.hp = Math.max(0, unit.hp);
    }
    const flagshipUnit = battle.units.find((u) => u.hull === 'flagship');
    if (flagshipUnit) battle.flagshipHp = flagshipUnit.hp;
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
}

function totalPower(units) {
  let dps = 0;
  let hp = 0;
  let heal = 0;
  for (const u of units) {
    dps += effectiveDps(u);
    hp += u.hp;
    heal += healRateForShip(u);
  }
  return { dps, hp, heal };
}

function resolveAutoBattle(state, systemId, battle) {
  const allies = collectAllyShips(state, systemId);
  const enemies = collectEnemyShips(state, systemId);
  const stance = STANCE_MODIFIERS[state.battleStance ?? 'balanced'] ?? 1;
  const ally = totalPower(allies);
  const enemy = totalPower(enemies);

  const allyScore = (ally.dps * stance + ally.heal * HEALER_AUTO_COEF * 100) * (1 + ally.hp / 500);
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

function tickTacticalBattle(state, systemId, battle) {
  if (!battle.units) initTacticalUnits(state, systemId, battle);
  const system = getSystems(state)[systemId];

  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - TICK_MS);

    const foes = battle.units.filter((u) => u.hp > 0 && u.side !== unit.side);
    if (!foes.length) continue;

    let target = foes[0];
    let bestDist = Infinity;
    for (const f of foes) {
      const d = Math.hypot(f.x - unit.x, f.y - unit.y);
      if (d < bestDist) { bestDist = d; target = f; }
    }

    const healRate = healRateForShip(unit);
    if (healRate > 0) {
      const allies = battle.units.filter((u) => u.hp > 0 && u.side === unit.side && u.id !== unit.id);
      for (const ally of allies) {
        if (ally.hp < ally.maxHp) {
          ally.hp = Math.min(ally.maxHp, ally.hp + (healRate * TICK_MS) / 1000);
        }
      }
    } else {
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = TACTICAL_SHIP_SPEED * (TICK_MS / 1000);
      if (dist > TACTICAL_WEAPON_RANGE * 0.85) {
        unit.x += (dx / dist) * speed;
        unit.y += (dy / dist) * speed;
        unit.heading = Math.atan2(dy, dx);
      } else if (unit.cooldownMs <= 0 && effectiveDps(unit) > 0) {
        target.hp -= effectiveDps(unit) * (TICK_MS / 1000);
        unit.cooldownMs = TACTICAL_WEAPON_COOLDOWN_MS;
      }
    }

    nudgeUnitKeepOut(state, system, unit);
  }

  const playerAlive = livingUnits(battle, 'player').length;
  const enemyAlive = livingUnits(battle, 'enemy').length;

  if (enemyAlive === 0) {
    battle.lastResolve = { mode: 'tactical', playerWins: true, enemyCasualties: collectEnemyShips(state, systemId).length };
    endBattle(state, systemId, 'player');
  } else if (playerAlive === 0) {
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

export function tickCombat(state) {
  const events = [];
  const systemIds = new Set([
    ...Object.keys(state.systemBattles ?? {}),
    ...getGraph(state).stars.map((s) => s.id).filter((id) => shouldBattle(state, id)),
  ]);

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
