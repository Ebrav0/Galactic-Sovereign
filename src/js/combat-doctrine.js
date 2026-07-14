// Named combat doctrines → formation + target-class recommendations.
// Pure helpers; combat.js / UI apply the resulting orders.

import { FORMATION_TYPES, TARGET_CLASSES, classifyCombatTarget } from './combat-orders.js';

export const COMBAT_DOCTRINES = Object.freeze([
  'assault',
  'screen',
  'carrier_strike',
  'hold_the_line',
]);

export const DOCTRINE_LABELS = Object.freeze({
  assault: 'Assault',
  screen: 'Screen',
  carrier_strike: 'Carrier Strike',
  hold_the_line: 'Hold the Line',
});

const DOCTRINE_SET = new Set(COMBAT_DOCTRINES);
const FORMATION_SET = new Set(FORMATION_TYPES);
const TARGET_CLASS_SET = new Set(TARGET_CLASSES);

function ratio(part, total) {
  return total > 0 ? part / total : 0;
}

/** Normalize unknown values to assault. */
export function normalizeDoctrine(value) {
  const id = String(value ?? '');
  return DOCTRINE_SET.has(id) ? id : 'assault';
}

/**
 * Classify a live unit roster into fighter / escort / capital / carrier buckets.
 * Uses classifyCombatTarget so wing/carrier/capital rules stay consistent with orders.
 */
export function analyzeFleetMix(units = []) {
  let fighter = 0;
  let escort = 0;
  let capital = 0;
  let carrier = 0;
  for (const unit of units) {
    if (!unit || unit.hp <= 0) continue;
    const cls = classifyCombatTarget(unit);
    if (cls === 'fighter') fighter += 1;
    else if (cls === 'carrier') carrier += 1;
    else if (cls === 'capital') capital += 1;
    else if (cls === 'structure' || cls === 'convoy') escort += 1;
    else escort += 1;
  }
  const total = fighter + escort + capital + carrier;
  const fighterRatio = ratio(fighter, total);
  const escortRatio = ratio(escort, total);
  const capitalRatio = ratio(capital, total);
  const carrierRatio = ratio(carrier, total);

  let dominant = 'mixed';
  if (total > 0) {
    const ranked = [
      ['fighter', fighterRatio],
      ['escort', escortRatio],
      ['capital', capitalRatio],
      ['carrier', carrierRatio],
    ].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    if (ranked[0][1] >= 0.45) dominant = ranked[0][0];
  }

  return {
    total,
    fighter,
    escort,
    capital,
    carrier,
    fighterRatio,
    escortRatio,
    capitalRatio,
    carrierRatio,
    dominant,
  };
}

function enemyCapitalHeavy(enemyMix) {
  return (enemyMix?.capitalRatio ?? 0) + (enemyMix?.carrierRatio ?? 0) >= 0.4;
}

function enemyFighterHeavy(enemyMix) {
  return (enemyMix?.fighterRatio ?? 0) >= 0.35;
}

function pickFormation(preferred, fallback) {
  if (FORMATION_SET.has(preferred)) return preferred;
  if (FORMATION_SET.has(fallback)) return fallback;
  return 'line';
}

function pickTargetClass(value) {
  if (value == null) return null;
  return TARGET_CLASS_SET.has(value) ? value : null;
}

/**
 * Deterministic doctrine × mix → formation + optional attack_class seed.
 * Same inputs always yield the same recommendation.
 */
export function recommendFormation({ doctrine, ownMix, enemyMix } = {}) {
  const id = normalizeDoctrine(doctrine);
  const own = ownMix ?? analyzeFleetMix([]);
  const enemy = enemyMix ?? analyzeFleetMix([]);
  const capitalHeavy = enemyCapitalHeavy(enemy);
  const fighterHeavy = enemyFighterHeavy(enemy);

  if (id === 'screen') {
    return {
      formation: pickFormation(fighterHeavy ? 'screen' : 'echelon', 'screen'),
      targetClass: pickTargetClass(fighterHeavy ? 'fighter' : 'escort'),
      reason: fighterHeavy ? 'screen-vs-fighters' : 'screen-vs-escorts',
    };
  }

  if (id === 'carrier_strike') {
    const carrierBias = (own.carrierRatio ?? 0) >= 0.15 || own.dominant === 'carrier';
    return {
      formation: pickFormation(capitalHeavy ? 'column' : 'sphere', 'sphere'),
      targetClass: pickTargetClass(
        (enemy.carrierRatio ?? 0) >= 0.2 ? 'carrier' : 'capital',
      ),
      reason: carrierBias
        ? (capitalHeavy ? 'carrier-column-vs-capitals' : 'carrier-sphere')
        : (capitalHeavy ? 'strike-column' : 'strike-sphere'),
    };
  }

  if (id === 'hold_the_line') {
    return {
      formation: pickFormation(fighterHeavy ? 'sphere' : 'line', 'line'),
      targetClass: null,
      reason: fighterHeavy ? 'hold-sphere' : 'hold-line',
    };
  }

  // assault (default)
  return {
    formation: pickFormation(capitalHeavy ? 'line' : 'wedge', 'wedge'),
    targetClass: pickTargetClass(capitalHeavy || (enemy.capitalRatio ?? 0) > 0 ? 'capital' : 'escort'),
    reason: capitalHeavy ? 'assault-line-vs-capitals' : 'assault-wedge',
  };
}
