// Pure command-first combat policy helpers.
//
// Combat owns state mutation; this module turns doctrine + fleet priority into
// deterministic target, movement, and withdrawal recommendations.

import { activeFleetOrders, classifyCombatTarget } from './combat-orders.js';
import { normalizeDoctrine } from './combat-doctrine.js';

export const COMBAT_PRIORITY_VALUES = Object.freeze([
  'auto',
  'fighter',
  'escort',
  'capital',
  'carrier',
]);

export const DEFAULT_COMBAT_SETTINGS = Object.freeze({
  controlMode: 'command',
  fleetPriority: 'auto',
  flagshipAutopilot: true,
  advancedTactics: true,
  retreatPolicy: 'doctrine',
});

const DOCTRINE_POLICIES = Object.freeze({
  assault: Object.freeze({
    defaultTargetClass: 'capital',
    flagshipRange: 250,
    chaseLeash: 760,
    retreat: Object.freeze({ wing: 0.10, escort: 0.15, line: 0.20, capital: 0.20, carrier: 0.30 }),
  }),
  screen: Object.freeze({
    defaultTargetClass: 'fighter',
    flagshipRange: 315,
    chaseLeash: 480,
    retreat: Object.freeze({ wing: 0.15, escort: 0.20, line: 0.30, capital: 0.30, carrier: 0.40 }),
  }),
  carrier_strike: Object.freeze({
    defaultTargetClass: 'carrier',
    flagshipRange: 370,
    chaseLeash: 620,
    retreat: Object.freeze({ wing: 0.15, escort: 0.20, line: 0.30, capital: 0.30, carrier: 0.45 }),
  }),
  hold_the_line: Object.freeze({
    defaultTargetClass: null,
    flagshipRange: 300,
    chaseLeash: 420,
    retreat: Object.freeze({ wing: 0.20, escort: 0.30, line: 0.40, capital: 0.40, carrier: 0.50 }),
  }),
});

const CARRIER_HULLS = new Set(['light_carrier', 'fleet_carrier', 'super_carrier']);
const CAPITAL_HULLS = new Set([
  'cruiser', 'command_cruiser', 'battleship', 'dreadnought', 'hero_flagship', 'flagship',
]);
const LINE_HULLS = new Set([
  'destroyer', 'healer', 'sensor_ship', 'builder_ship', 'miner',
  'light_hauler', 'bulk_freighter', 'armored_convoy',
]);

export function normalizeCombatSettings(value = {}) {
  const priority = COMBAT_PRIORITY_VALUES.includes(value?.fleetPriority)
    ? value.fleetPriority
    : DEFAULT_COMBAT_SETTINGS.fleetPriority;
  return {
    controlMode: value?.controlMode === 'command' ? 'command' : DEFAULT_COMBAT_SETTINGS.controlMode,
    fleetPriority: priority,
    flagshipAutopilot: value?.flagshipAutopilot !== false,
    advancedTactics: value?.advancedTactics !== false,
    retreatPolicy: value?.retreatPolicy === 'doctrine' ? 'doctrine' : DEFAULT_COMBAT_SETTINGS.retreatPolicy,
  };
}

export function ensureCombatSettings(state) {
  state.combatSettings = normalizeCombatSettings(state?.combatSettings);
  return state.combatSettings;
}

export function setCombatFleetPriority(state, value, systemId = null) {
  const settings = ensureCombatSettings(state);
  if (!COMBAT_PRIORITY_VALUES.includes(value)) {
    return { ok: false, reason: 'Unknown combat priority' };
  }
  settings.fleetPriority = value;
  const battle = systemId
    ? state.systemBattles?.[systemId]
    : Object.values(state.systemBattles ?? {}).find((entry) => entry?.active && entry.mode === 'tactical');
  if (battle?.active) battle.fleetPriority = value;
  return { ok: true, fleetPriority: value, applied: !!battle?.active };
}

export function setAdvancedTactics(state, enabled, systemId = null) {
  const settings = ensureCombatSettings(state);
  settings.advancedTactics = enabled === true;
  const battle = systemId
    ? state.systemBattles?.[systemId]
    : Object.values(state.systemBattles ?? {}).find((entry) => entry?.active && entry.mode === 'tactical');
  if (battle?.active) battle.advancedTactics = settings.advancedTactics;
  return { ok: true, advancedTactics: settings.advancedTactics, applied: !!battle?.active };
}

export function combatRole(unit) {
  if (unit?.isWing || classifyCombatTarget(unit) === 'fighter') return 'wing';
  if (CARRIER_HULLS.has(unit?.hull)) return 'carrier';
  if (CAPITAL_HULLS.has(unit?.hull)) return 'capital';
  if (LINE_HULLS.has(unit?.hull)) return 'line';
  return 'escort';
}

export function doctrinePolicy(doctrine) {
  return DOCTRINE_POLICIES[normalizeDoctrine(doctrine)] ?? DOCTRINE_POLICIES.assault;
}

export function explicitDirectiveForUnit(battle, unit) {
  return activeFleetOrders(battle, unit?.side)
    .filter((order) => order.type !== 'formation')
    .filter((order) => unit?.side !== 'player' || battle?.advancedTactics === true || order.autonomous === true
      || order.type === 'emergency_retreat')
    .filter((order) => !(unit?.side === 'player' && order.source === 'doctrine'
      && order.type === 'attack_class'))
    .slice()
    .reverse()
    .find((order) => order.subjectIds.length === 0 || order.subjectIds.includes(String(unit?.id))) ?? null;
}

function hasTargetClass(hostiles, targetClass) {
  return hostiles.some((target) => target?.hp > 0 && classifyCombatTarget(target) === targetClass);
}

export function autonomousTargetClass(state, battle, unit, hostiles = []) {
  const settings = normalizeCombatSettings(state?.combatSettings);
  const doctrine = normalizeDoctrine(battle?.doctrine ?? state?.combatDoctrine);
  if (settings.fleetPriority !== 'auto' && hasTargetClass(hostiles, settings.fleetPriority)) {
    return settings.fleetPriority;
  }

  // Flagship hangar escorts protect the capital — fighters first, then any nearby ship.
  if (unit?.isWing && String(unit.parentCarrierId ?? '') === 'flagship') {
    if (hasTargetClass(hostiles, 'fighter')) return 'fighter';
    return null;
  }

  // Bombers dive capitals, then carriers — especially under carrier_strike.
  if (unit?.hull === 'bomber') {
    if (hasTargetClass(hostiles, 'capital')) return 'capital';
    if (hasTargetClass(hostiles, 'carrier')) return 'carrier';
    if (doctrine === 'carrier_strike' && hasTargetClass(hostiles, 'carrier')) return 'carrier';
  }

  // Interceptors screen hostile strike craft first (bombers preferred in order pick).
  if (unit?.hull === 'interceptor' && hasTargetClass(hostiles, 'fighter')) return 'fighter';

  // Generic fighters dogfight other wings when any are on the board.
  if ((unit?.hull === 'fighter' || unit?.hull === 'heavy_fighter')
    && hasTargetClass(hostiles, 'fighter')) {
    return 'fighter';
  }

  const preferred = doctrinePolicy(doctrine).defaultTargetClass;
  if (preferred && hasTargetClass(hostiles, preferred)) return preferred;
  if (hasTargetClass(hostiles, 'capital')) return 'capital';
  if (hasTargetClass(hostiles, 'escort')) return 'escort';
  if (hasTargetClass(hostiles, 'carrier')) return 'carrier';
  if (hasTargetClass(hostiles, 'fighter')) return 'fighter';
  return null;
}

export function autonomousTargetOrder(state, battle, unit, hostiles = []) {
  if (explicitDirectiveForUnit(battle, unit)) return null;
  const targetClass = autonomousTargetClass(state, battle, unit, hostiles);
  let candidates = hostiles
    .filter((target) => target?.hp > 0 && !target.escaped && !target.recovered
      && (!targetClass || classifyCombatTarget(target) === targetClass));
  const isFlagshipEscort = unit?.isWing && String(unit.parentCarrierId ?? '') === 'flagship';
  if (isFlagshipEscort) {
    candidates = candidates.slice().sort((a, b) => {
      const aFighter = classifyCombatTarget(a) === 'fighter' ? 0 : 1;
      const bFighter = classifyCombatTarget(b) === 'fighter' ? 0 : 1;
      const aDist = Math.hypot(a.x - unit.x, a.y - unit.y);
      const bDist = Math.hypot(b.x - unit.x, b.y - unit.y);
      return aFighter - bFighter || aDist - bDist || String(a.id).localeCompare(String(b.id));
    });
  } else if (unit?.hull === 'interceptor') {
    candidates = candidates.slice().sort((a, b) => {
      const aBomber = a.hull === 'bomber' ? 0 : 1;
      const bBomber = b.hull === 'bomber' ? 0 : 1;
      const aDist = Math.hypot(a.x - unit.x, a.y - unit.y);
      const bDist = Math.hypot(b.x - unit.x, b.y - unit.y);
      return aBomber - bBomber || aDist - bDist || String(a.id).localeCompare(String(b.id));
    });
  } else if (unit?.hull === 'fighter' || unit?.hull === 'heavy_fighter') {
    candidates = candidates.slice().sort((a, b) => {
      const aDist = Math.hypot(a.x - unit.x, a.y - unit.y);
      const bDist = Math.hypot(b.x - unit.x, b.y - unit.y);
      return aDist - bDist || String(a.id).localeCompare(String(b.id));
    });
  } else if (unit?.hull === 'bomber' && normalizeDoctrine(battle?.doctrine ?? state?.combatDoctrine) === 'carrier_strike') {
    candidates = candidates.slice().sort((a, b) => {
      const rank = (t) => (classifyCombatTarget(t) === 'capital' ? 0
        : classifyCombatTarget(t) === 'carrier' ? 1 : 2);
      return rank(a) - rank(b) || String(a.id).localeCompare(String(b.id));
    });
  } else {
    candidates = candidates.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  const fleetTarget = candidates[0] ?? null;
  return fleetTarget ? {
    type: 'focus_fire',
    side: unit.side,
    subjectIds: [String(unit.id)],
    targetId: String(fleetTarget.id),
    autonomous: true,
    source: 'doctrine',
  } : null;
}

export function retreatThresholdForUnit(unit, doctrine) {
  const role = combatRole(unit);
  return doctrinePolicy(doctrine).retreat[role] ?? 0.20;
}

export function shouldDoctrineDisengage(state, battle, unit) {
  if (!unit || unit.hp <= 0 || unit.isStructure || unit.isConvoy) return false;
  if (unit.side !== 'player') return false;
  if (normalizeCombatSettings(state?.combatSettings).retreatPolicy !== 'doctrine') return false;
  const ratio = unit.hp / Math.max(1, unit.maxHp ?? unit.hp);
  return ratio <= retreatThresholdForUnit(unit, battle?.doctrine ?? state?.combatDoctrine);
}

function nearestTarget(unit, hostiles, targetClass = null) {
  return hostiles
    .filter((target) => target?.hp > 0 && !target.escaped && !target.recovered
      && (!targetClass || classifyCombatTarget(target) === targetClass))
    .sort((a, b) => (
      Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y)
      || String(a.id).localeCompare(String(b.id))
    ))[0] ?? null;
}

function unitIntent(state, battle, unit, hostiles) {
  if (unit.escaped) return 'disengaged';
  if (unit.recovered) return 'rearm';
  if (unit.returning) return 'return';
  if (unit.disengaging) return 'disengage';
  const directive = explicitDirectiveForUnit(battle, unit);
  if (directive && !directive.autonomous) return 'explicit_order';
  if (unit.isWing) return unit.sortiePhase ?? 'attack';
  const doctrine = normalizeDoctrine(battle?.doctrine ?? state?.combatDoctrine);
  if (combatRole(unit) === 'carrier' || (unit.hull === 'flagship' && doctrine === 'carrier_strike')) {
    return 'maintain_range';
  }
  const role = combatRole(unit);
  if (['escort', 'line'].includes(role)) {
    const hasWard = (battle?.units ?? []).some((candidate) => (
      candidate.side === unit.side
      && candidate.hp > 0
      && candidate.id !== unit.id
      && ['capital', 'carrier'].includes(combatRole(candidate))
    ));
    if (doctrine === 'screen' || hasWard) return 'screen';
  }
  if (doctrine === 'hold_the_line') return 'hold';
  return hostiles.length ? 'engage' : 'hold';
}

export function combatIntentForUnit(state, battle, unit, hostiles = []) {
  return unitIntent(state, battle, unit, hostiles);
}

export function flagshipAutopilotPlan(state) {
  const flagship = state?.flagship;
  const battle = flagship?.systemId ? state?.systemBattles?.[flagship.systemId] : null;
  const settings = normalizeCombatSettings(state?.combatSettings);
  if (!settings.flagshipAutopilot || !battle?.active || battle.mode !== 'tactical') return null;
  const unit = battle.units?.find((candidate) => candidate.hull === 'flagship' && candidate.hp > 0);
  if (!unit) return null;
  const hostiles = (battle.units ?? []).filter((candidate) => (
    candidate.hp > 0 && candidate.side !== 'player' && !candidate.escaped && !candidate.recovered
  ));
  if (!hostiles.length) return { x: 0, y: 0, intent: 'hold', targetId: null };

  const directive = explicitDirectiveForUnit(battle, unit);
  if (directive?.type === 'move' && directive.point) {
    const dx = directive.point.x - flagship.x;
    const dy = directive.point.y - flagship.y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag, intent: 'explicit_order', targetId: null };
  }
  if (directive?.type === 'hold') return { x: 0, y: 0, intent: 'explicit_order', targetId: null };

  const priority = autonomousTargetClass(state, battle, unit, hostiles);
  const target = (directive?.targetId
    ? hostiles.find((candidate) => String(candidate.id) === String(directive.targetId))
    : null) ?? nearestTarget(unit, hostiles, priority) ?? nearestTarget(unit, hostiles);
  if (!target) return { x: 0, y: 0, intent: 'hold', targetId: null };

  const policy = doctrinePolicy(battle.doctrine ?? state.combatDoctrine);
  const dx = target.x - flagship.x;
  const dy = target.y - flagship.y;
  const distance = Math.hypot(dx, dy) || 1;
  let radial = 0;
  if (distance > policy.flagshipRange + 45) radial = 1;
  else if (distance < policy.flagshipRange - 45) radial = -1;
  const tangent = distance >= policy.flagshipRange - 65 && distance <= policy.flagshipRange + 65 ? 0.35 : 0;
  const vx = dx / distance * radial + -dy / distance * tangent;
  const vy = dy / distance * radial + dx / distance * tangent;
  const magnitude = Math.hypot(vx, vy);
  return {
    x: magnitude > 1 ? vx / magnitude : vx,
    y: magnitude > 1 ? vy / magnitude : vy,
    intent: 'maintain_range',
    targetId: target.id,
  };
}

export function combatAutonomySummary(state, systemId = null) {
  const settings = normalizeCombatSettings(state?.combatSettings);
  const battle = systemId
    ? state?.systemBattles?.[systemId]
    : Object.values(state?.systemBattles ?? {}).find((entry) => entry?.active && entry.mode === 'tactical');
  const units = (battle?.units ?? []).filter((unit) => unit.hp > 0);
  const intentCounts = {};
  for (const unit of units) {
    const intent = unit.intent ?? 'hold';
    intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
  }
  return {
    active: !!battle?.active,
    battleId: battle?.id ?? null,
    systemId: battle?.systemId ?? systemId,
    doctrine: battle?.doctrine ?? state?.combatDoctrine ?? 'assault',
    fleetPriority: battle?.fleetPriority ?? settings.fleetPriority,
    advancedTactics: battle?.advancedTactics ?? settings.advancedTactics,
    intentCounts,
    disengaging: units.filter((unit) => unit.disengaging && !unit.escaped).length,
    escaped: units.filter((unit) => unit.escaped).length,
    wings: {
      attackRun: units.filter((unit) => unit.isWing && unit.sortiePhase === 'attack_run').length,
      returning: units.filter((unit) => unit.isWing && unit.returning).length,
      rearming: units.filter((unit) => unit.isWing && unit.recovered).length,
    },
  };
}
