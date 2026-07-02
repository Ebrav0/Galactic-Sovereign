// Auto-resolve combat formula (GDD §8, Phase 2).

import {
  AUTO_RESOLVE_MS,
  AUTO_RESOLVE_HEALER_BONUS,
  AUTO_RESOLVE_RPS,
  FLAGSHIP_MAX_HP,
  FLAGSHIP_DPS,
  HULL_STATS,
  CARRIER_DEFAULT_WINGS,
} from './constants.js';
import { hullStats } from './hulls.js';
import { applyGarrisonCasualties } from './garrison.js';

function unitPower(hull, count = 1) {
  const stats = hull === 'flagship'
    ? { hp: FLAGSHIP_MAX_HP, dps: FLAGSHIP_DPS }
    : hullStats(hull);
  if (!stats) return 0;
  return count * stats.hp * (1 + (stats.dps ?? 0) * 0.02);
}

function rpsMultiplier(attackerHull, defenderHull) {
  const rps = AUTO_RESOLVE_RPS[attackerHull];
  if (!rps) return 1;
  const defStats = hullStats(defenderHull);
  const defCat = defStats?.category ?? (defenderHull.includes('wing') ? 'wing' : defenderHull);
  if (rps.strongVs.includes(defenderHull)) return 1.35;
  if (defCat === 'capital' && rps.strongVs.includes('cruiser')) return 1.25;
  if (rps.weakVs.includes(defenderHull)) return 0.75;
  return 1;
}

function compositionMap(entries) {
  const map = {};
  for (const e of entries) {
    map[e.hull] = (map[e.hull] ?? 0) + (e.count ?? 1);
  }
  return map;
}

function scoreSide(comp) {
  let score = 0;
  for (const [hull, count] of Object.entries(comp)) {
    let p = unitPower(hull, count);
    if (hull === 'healer') p *= 1 + AUTO_RESOLVE_HEALER_BONUS * count;
    if (hull === 'light_carrier') {
      const wings = HULL_STATS.light_carrier.wings ?? CARRIER_DEFAULT_WINGS;
      p += unitPower('interceptor_wing', wings.interceptor ?? 0);
      p += unitPower('bomber_wing', wings.bomber ?? 0);
    }
    score += p;
  }
  return score;
}

function crossRps(attacker, defender) {
  let total = 0;
  for (const [aHull, aCount] of Object.entries(attacker)) {
    for (const [dHull, dCount] of Object.entries(defender)) {
      total += unitPower(aHull, aCount) * rpsMultiplier(aHull, dHull) * dCount * 0.1;
    }
  }
  return total;
}

export function buildSideComposition(state, systemId, side) {
  const entries = [];
  if (side === 'player') {
    for (const ship of state.ships ?? []) {
      if (ship.systemId !== systemId || ship.transit || ship.hp <= 0) continue;
      entries.push({ hull: ship.hull, count: 1, refId: ship.id });
    }
    const f = state.flagship;
    if (f.systemId === systemId && !f.transit && f.hp > 0) {
      entries.push({ hull: 'flagship', count: 1, refId: 'flagship' });
    }
  } else {
    for (const g of state.garrisons?.[systemId] ?? []) {
      entries.push({ hull: g.hull, count: g.count });
    }
  }
  return entries;
}

export function autoResolvePreview(state, systemId) {
  const playerEntries = buildSideComposition(state, systemId, 'player');
  const enemyEntries = buildSideComposition(state, systemId, 'enemy');
  const player = compositionMap(playerEntries);
  const enemy = compositionMap(enemyEntries);

  if (Object.keys(enemy).length === 0) {
    return {
      playerScore: scoreSide(player),
      enemyScore: 0,
      predictedWinner: 'player',
      factors: ['No defenders'],
      player,
      enemy,
    };
  }
  if (Object.keys(player).length === 0) {
    return {
      playerScore: 0,
      enemyScore: scoreSide(enemy),
      predictedWinner: 'enemy',
      factors: ['No attackers'],
      player,
      enemy,
    };
  }

  let playerScore = scoreSide(player) + crossRps(player, enemy);
  let enemyScore = scoreSide(enemy) + crossRps(enemy, player);

  const playerHealers = player.healer ?? 0;
  if (playerHealers > 0) {
    playerScore *= 1 + AUTO_RESOLVE_HEALER_BONUS * playerHealers;
  }
  const enemyHealers = enemy.healer ?? 0;
  if (enemyHealers > 0) {
    enemyScore *= 1 + AUTO_RESOLVE_HEALER_BONUS * enemyHealers;
  }

  const factors = [];
  if (playerHealers > 0) factors.push(`Healers +${Math.round(AUTO_RESOLVE_HEALER_BONUS * 100 * playerHealers)}%`);
  if (player.flagship) factors.push('Flagship present');
  if (enemy.cruiser) factors.push('Enemy capitals');

  return {
    playerScore: Math.round(playerScore),
    enemyScore: Math.round(enemyScore),
    predictedWinner: playerScore >= enemyScore ? 'player' : 'enemy',
    factors,
    player,
    enemy,
  };
}

export function applyAutoResolveOutcome(state, systemId, preview) {
  const winner = preview.predictedWinner;
  const playerLossFrac = winner === 'player' ? 0.15 : 0.55;
  const enemyLossFrac = winner === 'player' ? 0.85 : 0.2;

  let idx = 0;
  for (const ship of state.ships ?? []) {
    if (ship.systemId !== systemId || ship.transit || ship.hp <= 0) continue;
    idx += 1;
    if (winner !== 'player' && idx % 2 === 0) {
      ship.hp = 0;
    } else {
      ship.hp = Math.max(1, Math.round(ship.hp * (1 - playerLossFrac * 0.5)));
    }
  }

  const f = state.flagship;
  if (f.systemId === systemId && !f.transit && f.hp > 0) {
    f.hp = winner === 'player'
      ? Math.max(1, Math.round(f.hp * 0.85))
      : Math.max(1, Math.round(f.hp * 0.4));
  }

  const casualties = {};
  for (const g of state.garrisons?.[systemId] ?? []) {
    casualties[g.hull] = Math.ceil(g.count * enemyLossFrac);
  }
  if (winner === 'player') {
    applyGarrisonCasualties(state, systemId, casualties);
  }
  return { winner, casualties };
}

export { AUTO_RESOLVE_MS };

export function wingHullType(kind) {
  return kind === 'interceptor' ? 'interceptor_wing' : 'bomber_wing';
}
