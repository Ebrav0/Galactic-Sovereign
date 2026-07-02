// Hybrid combat: tactical (flagship present) + auto-resolve (GDD §8, Phase 2).

import {
  TICK_MS,
  COMBAT_WEAPON_RANGE,
  COMBAT_HEALER_RANGE,
  COMBAT_HEALER_RATE,
  COMBAT_DAMAGE_PER_TICK,
  COMBAT_SPAWN_RADIUS,
  COMBAT_UNIT_RADIUS,
  FLAGSHIP_MAX_HP,
  FLAGSHIP_DPS,
  FLAGSHIP_COMBAT_SPEED,
  CARRIER_DEFAULT_WINGS,
  REPLAY_DURATION_MS,
} from './constants.js';
import { hullStats } from './hulls.js';
import {
  expandGarrisonToUnits,
  garrisonHasCombatPresence,
  garrisonUnitCount,
  applyGarrisonCasualties,
} from './garrison.js';
import { shipsInSystem, syncShipHpFromBattle, findShip } from './ships.js';
import {
  autoResolvePreview,
  applyAutoResolveOutcome,
  AUTO_RESOLVE_MS,
  wingHullType,
} from './autoResolve.js';
import { createRng } from './state.js';

let nextUnitId = 1;

function unitId() {
  return `u${nextUnitId++}`;
}

export function isFlagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.systemId === systemId && !f.transit && f.hp > 0;
}

export function combatModeFor(state, systemId) {
  return isFlagshipInSystem(state, systemId) ? 'tactical' : 'auto';
}

function entryVectorFor(state, systemId) {
  const rng = createRng((state.meta.seed + systemId.length * 7919 + state.time) >>> 0);
  const angle = rng() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function spawnPlayerUnits(state, systemId, entryVector) {
  const units = [];
  const baseAngle = Math.atan2(entryVector.y, entryVector.x) + Math.PI;
  let idx = 0;

  for (const ship of shipsInSystem(state, systemId)) {
    const stats = hullStats(ship.hull);
    if (!stats) continue;
    const spread = (idx - 2) * 0.12;
    const angle = baseAngle + spread;
    const dist = COMBAT_SPAWN_RADIUS - 40 + (idx % 4) * 15;
    units.push({
      id: unitId(),
      side: 'player',
      refId: ship.id,
      hull: ship.hull,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      hp: ship.hp,
      maxHp: ship.maxHp,
      targetId: null,
    });
    idx += 1;

    if (ship.hull === 'light_carrier' && ship.wings) {
      const wings = ship.wings;
      for (const kind of ['interceptor', 'bomber']) {
        const count = wings[kind] ?? 0;
        const wingHull = wingHullType(kind);
        const wStats = hullStats(wingHull);
        for (let w = 0; w < count; w++) {
          const wAngle = angle + (w - count / 2) * 0.08;
          units.push({
            id: unitId(),
            side: 'player',
            refId: `${ship.id}:${kind}:${w}`,
            hull: wingHull,
            parentRef: ship.id,
            x: Math.cos(wAngle) * (dist - 30),
            y: Math.sin(wAngle) * (dist - 30),
            hp: wStats.hp,
            maxHp: wStats.hp,
            targetId: null,
          });
        }
      }
    }
  }

  const f = state.flagship;
  if (f.systemId === systemId && !f.transit && f.hp > 0) {
    units.push({
      id: unitId(),
      side: 'player',
      refId: 'flagship',
      hull: 'flagship',
      x: f.x,
      y: f.y,
      hp: f.hp,
      maxHp: f.maxHp ?? FLAGSHIP_MAX_HP,
      targetId: null,
    });
  }
  return units;
}

function pickTarget(unit, enemies, allUnits) {
  const stats = hullStats(unit.hull);
  const pref = stats?.targetPreference;
  if (pref === 'capital') {
    const cap = enemies.find((e) => {
      const s = hullStats(e.hull);
      return s?.category === 'capital' || e.hull === 'cruiser' || e.hull === 'destroyer';
    });
    if (cap) return cap.id;
  }
  if (pref === 'bomber_wing') {
    const wing = enemies.find((e) => e.hull === 'bomber_wing');
    if (wing) return wing.id;
  }
  let best = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const dx = e.x - unit.x;
    const dy = e.y - unit.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best?.id ?? null;
}

function unitSpeed(hull) {
  if (hull === 'flagship') return FLAGSHIP_COMBAT_SPEED * (TICK_MS / 1000);
  return (hullStats(hull)?.speed ?? 100) * (TICK_MS / 1000);
}

function unitDps(hull) {
  if (hull === 'flagship') return FLAGSHIP_DPS;
  return hullStats(hull)?.dps ?? 0;
}

function tickTacticalBattle(state, battle, systemId) {
  const units = battle.units.filter((u) => u.hp > 0);
  battle.units = units;

  const f = state.flagship;
  if (isFlagshipInSystem(state, systemId)) {
    const flagshipUnit = units.find((u) => u.refId === 'flagship');
    if (flagshipUnit) {
      flagshipUnit.x = f.x;
      flagshipUnit.y = f.y;
    }
  }

  let repairPerTick = 0;
  const healers = units.filter((u) => u.side === 'player' && u.hull === 'healer');
  for (const healer of healers) {
    const friends = units.filter((u) => u.side === 'player' && u.hp > 0 && u.id !== healer.id);
    friends.sort((a, b) => {
      const pa = hullStats(a.hull)?.priorityHeal ?? (a.hull === 'flagship' ? 3 : 0);
      const pb = hullStats(b.hull)?.priorityHeal ?? (b.hull === 'flagship' ? 3 : 0);
      if (pa !== pb) return pb - pa;
      return a.hp / a.maxHp - b.hp / b.maxHp;
    });
    for (const friend of friends) {
      const dx = friend.x - healer.x;
      const dy = friend.y - healer.y;
      if (dx * dx + dy * dy > COMBAT_HEALER_RANGE * COMBAT_HEALER_RANGE) continue;
      if (friend.hp >= friend.maxHp) continue;
      const heal = Math.min(COMBAT_HEALER_RATE, friend.maxHp - friend.hp);
      friend.hp += heal;
      repairPerTick += heal;
      syncShipHpFromBattle(state, friend.refId, friend.hp);
      break;
    }
  }
  battle.healerActive = healers.length > 0;
  battle.repairPerTick = repairPerTick;

  for (const unit of units) {
    if (unit.hull === 'healer') continue;
    const enemies = units.filter((u) => u.side !== unit.side && u.hp > 0);
    if (enemies.length === 0) continue;

    if (!unit.targetId || !enemies.find((e) => e.id === unit.targetId)) {
      unit.targetId = pickTarget(unit, enemies, units);
    }
    const target = enemies.find((e) => e.id === unit.targetId);
    if (!target) continue;

    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > COMBAT_WEAPON_RANGE) {
      const speed = unitSpeed(unit.hull);
      unit.x += (dx / dist) * speed;
      unit.y += (dy / dist) * speed;
    } else if (unitDps(unit.hull) > 0) {
      const dmg = unitDps(unit.hull) * COMBAT_DAMAGE_PER_TICK;
      target.hp = Math.max(0, target.hp - dmg);
      syncShipHpFromBattle(state, target.refId, target.hp);
    }
  }

  battle.units = units.filter((u) => u.hp > 0);

  const playerAlive = battle.units.some((u) => u.side === 'player');
  const enemyAlive = battle.units.some((u) => u.side === 'enemy');

  if (!playerAlive || !enemyAlive) {
    endBattle(state, systemId, playerAlive ? 'player' : 'enemy');
    return { ended: true, winner: playerAlive ? 'player' : 'enemy' };
  }
  return { ended: false };
}

function syncTacticalCasualties(state, battle) {
  for (const unit of battle.units) {
    if (unit.side !== 'player') continue;
    if (unit.refId.startsWith('garrison:') || unit.refId.startsWith('test:')) continue;
    syncShipHpFromBattle(state, unit.refId.split(':')[0], unit.hp);
  }
  for (const ship of state.ships ?? []) {
    const inBattle = battle.units.some((u) => u.refId === ship.id);
    if (inBattle && !battle.units.some((u) => u.refId === ship.id && u.hp > 0)) {
      ship.hp = 0;
    }
  }
}

function clearGarrisonOnVictory(state, systemId) {
  delete state.garrisons[systemId];
}

export function startBattle(state, systemId, { force = false } = {}) {
  if (state.combat?.[systemId]?.phase === 'active') return state.combat[systemId];

  const hasEnemy = garrisonHasCombatPresence(state, systemId)
    || (state._testEnemyPresence?.[systemId] ?? 0) > 0;
  const hasPlayer = shipsInSystem(state, systemId).some((s) => {
    const st = hullStats(s.hull);
    return st && (st.contestsCapture || st.dps > 0);
  }) || isFlagshipInSystem(state, systemId);

  if (!force && (!hasEnemy || !hasPlayer)) return null;

  const mode = combatModeFor(state, systemId);
  const entryVector = entryVectorFor(state, systemId);
  state.combat = state.combat ?? {};

  if (mode === 'auto') {
    const preview = autoResolvePreview(state, systemId);
    state.combat[systemId] = {
      mode: 'auto',
      startedAt: state.time,
      entryVector,
      phase: 'active',
      units: [],
      resolveAt: state.time + AUTO_RESOLVE_MS,
      resolveInputs: preview,
      predictedOutcome: preview.predictedWinner,
    };
    return state.combat[systemId];
  }

  const playerUnits = spawnPlayerUnits(state, systemId, entryVector);
  const garrison = state.garrisons?.[systemId] ?? [];
  const enemyUnits = expandGarrisonToUnits(garrison, entryVector, nextUnitId);
  nextUnitId += enemyUnits.length + playerUnits.length;

  const testCount = state._testEnemyPresence?.[systemId] ?? 0;
  for (let i = 0; i < testCount; i++) {
    const angle = Math.atan2(entryVector.y, entryVector.x) + i * 0.2;
    enemyUnits.push({
      id: unitId(),
      side: 'enemy',
      refId: `test:${i}`,
      hull: 'corvette',
      x: Math.cos(angle) * COMBAT_SPAWN_RADIUS,
      y: Math.sin(angle) * COMBAT_SPAWN_RADIUS,
      hp: hullStats('corvette').hp,
      maxHp: hullStats('corvette').hp,
      targetId: null,
    });
  }

  state.combat[systemId] = {
    mode: 'tactical',
    startedAt: state.time,
    entryVector,
    phase: 'active',
    units: [...playerUnits, ...enemyUnits],
    healerActive: false,
    repairPerTick: 0,
  };
  return state.combat[systemId];
}

export function endBattle(state, systemId, winner) {
  const battle = state.combat?.[systemId];
  if (!battle) return;

  if (battle.mode === 'tactical') {
    syncTacticalCasualties(state, battle);
    if (winner === 'player') {
      clearGarrisonOnVictory(state, systemId);
    } else {
      const enemyUnits = battle.units.filter((u) => u.side === 'enemy' && u.refId.startsWith('garrison:'));
      const remaining = {};
      for (const u of enemyUnits) {
        const hull = u.hull;
        remaining[hull] = (remaining[hull] ?? 0) + 1;
      }
      if (Object.keys(remaining).length) {
        state.garrisons[systemId] = Object.entries(remaining).map(([hull, count]) => ({ hull, count }));
      }
    }
  }

  if (battle.mode === 'auto') {
    const preview = battle.resolveInputs ?? autoResolvePreview(state, systemId);
    applyAutoResolveOutcome(state, systemId, preview);
    if (preview.predictedWinner === 'player') clearGarrisonOnVictory(state, systemId);
  }

  battle.phase = 'resolved';
  battle.winner = winner;
  battle.replayUntil = state.time + REPLAY_DURATION_MS;

  if (state._testEnemyPresence?.[systemId]) {
    delete state._testEnemyPresence[systemId];
  }
}

export function tryEngageOnArrival(state, systemId) {
  if (!garrisonHasCombatPresence(state, systemId)) return null;
  const attackers = shipsInSystem(state, systemId).filter((s) => {
    const st = hullStats(s.hull);
    return st && st.contestsCapture;
  });
  if (attackers.length === 0 && !isFlagshipInSystem(state, systemId)) return null;
  return startBattle(state, systemId);
}

export function tickCombat(state) {
  const ended = [];
  state.combat = state.combat ?? {};

  for (const systemId of Object.keys(state.combat)) {
    const battle = state.combat[systemId];
    if (!battle) continue;

    if (battle.phase === 'resolved') {
      if (state.time >= (battle.replayUntil ?? 0)) {
        delete state.combat[systemId];
      }
      continue;
    }

    if (battle.mode === 'auto') {
      if (state.time >= battle.resolveAt) {
        const preview = battle.resolveInputs ?? autoResolvePreview(state, systemId);
        applyAutoResolveOutcome(state, systemId, preview);
        battle.phase = 'resolved';
        battle.winner = preview.predictedWinner;
        battle.replayUntil = state.time + REPLAY_DURATION_MS;
        if (preview.predictedWinner === 'player') clearGarrisonOnVictory(state, systemId);
        ended.push({ systemId, winner: preview.predictedWinner, mode: 'auto' });
      }
      continue;
    }

    const result = tickTacticalBattle(state, battle, systemId);
    if (result?.ended) {
      ended.push({ systemId, winner: result.winner, mode: 'tactical' });
    }
  }

  return ended;
}

export function activeBattle(state, systemId) {
  const b = state.combat?.[systemId];
  return b?.phase === 'active' ? b : null;
}

export function combatObservability(state, viewedSystemId) {
  const battle = state.combat?.[viewedSystemId];
  if (!battle) {
    return { active: false, mode: null, systemId: null, phase: null };
  }

  const resolveEtaMs = battle.mode === 'auto' && battle.resolveAt
    ? Math.max(0, battle.resolveAt - state.time)
    : null;

  const friendly = battle.units?.filter((u) => u.side === 'player' && u.hp > 0).length ?? 0;
  const enemy = battle.units?.filter((u) => u.side === 'enemy' && u.hp > 0).length ?? 0;

  return {
    active: battle.phase === 'active',
    mode: battle.mode,
    systemId: viewedSystemId,
    phase: battle.phase,
    entryVector: battle.entryVector,
    friendlyCount: friendly,
    enemyCount: enemy,
    healerActive: battle.healerActive ?? false,
    repairPerTick: battle.repairPerTick ?? 0,
    resolveAt: battle.resolveAt ?? null,
    resolveEtaMs,
    resolveInputs: battle.resolveInputs ?? null,
    predictedOutcome: battle.predictedOutcome ?? battle.resolveInputs?.predictedWinner ?? null,
    winner: battle.winner ?? null,
    replayUntil: battle.replayUntil ?? null,
  };
}

export function liveEnemyCount(state, systemId) {
  const battle = activeBattle(state, systemId);
  if (battle) {
    return battle.units.filter((u) => u.side === 'enemy' && u.hp > 0).length;
  }
  return garrisonUnitCount(state, systemId);
}

export function resetCombatIds() {
  nextUnitId = 1;
}
