// Diplomacy + treaty state machine (Phase 6, GDD §12).

import {
  DIPLOMACY_TRUCE_COST,
  DIPLOMACY_TRADE_TREATY_COST,
  DIPLOMACY_ALLIANCE_COST,
  DIPLOMACY_ALLIANCE_SOLARII,
  DIPLOMACY_TRADE_INCOME_BONUS,
} from './constants.js';
import { refreshMilestones } from './milestones.js';

export const RELATION_WAR = 'war';
export const RELATION_NEUTRAL = 'neutral';
export const RELATION_TRUCE = 'truce';
export const RELATION_TRADE = 'trade';
export const RELATION_ALLIANCE = 'alliance';

export function ensureDiplomacy(state) {
  if (!state.diplomacy) {
    state.diplomacy = { relations: {} };
  }
  if (!state.diplomacy.relations) state.diplomacy.relations = {};
}

export function defaultRelation() {
  return { status: RELATION_WAR, treaties: [], lastChangedAt: 0 };
}

export function getRelation(state, factionId) {
  ensureDiplomacy(state);
  if (!state.diplomacy.relations[factionId]) {
    state.diplomacy.relations[factionId] = defaultRelation();
  }
  return state.diplomacy.relations[factionId];
}

export function isDiplomacyUnlocked(state) {
  refreshMilestones(state);
  return !!state.milestones?.diplomacyUnlocked;
}

export function setRelation(state, factionId, status) {
  if (!isDiplomacyUnlocked(state) && status !== RELATION_WAR) {
    return { ok: false, reason: 'Diplomacy locked — complete a Dyson sphere first' };
  }
  ensureDiplomacy(state);
  const rel = getRelation(state, factionId);
  rel.status = status;
  rel.lastChangedAt = state.time;
  if (status === RELATION_TRADE && !rel.treaties.includes('trade')) rel.treaties.push('trade');
  if (status === RELATION_ALLIANCE && !rel.treaties.includes('alliance')) rel.treaties.push('alliance');
  return { ok: true, factionId, status };
}

export function listAiFactionsFromState(state) {
  if (state.factions?.list?.length) return state.factions.list;
  if (state.factions?.ai) return [state.factions.ai];
  return [];
}

export function offerTreaty(state, factionId, type) {
  if (!isDiplomacyUnlocked(state)) {
    return { ok: false, reason: 'Diplomacy locked' };
  }
  const faction = listAiFactionsFromState(state).find((f) => f.id === factionId);
  if (!faction) return { ok: false, reason: 'Unknown faction' };

  if (type === 'truce') {
    if (state.credits < DIPLOMACY_TRUCE_COST) {
      return { ok: false, reason: `Need ${DIPLOMACY_TRUCE_COST} credits` };
    }
    state.credits -= DIPLOMACY_TRUCE_COST;
    return setRelation(state, factionId, RELATION_TRUCE);
  }
  if (type === 'trade') {
    if (state.credits < DIPLOMACY_TRADE_TREATY_COST) {
      return { ok: false, reason: `Need ${DIPLOMACY_TRADE_TREATY_COST} credits` };
    }
    state.credits -= DIPLOMACY_TRADE_TREATY_COST;
    return setRelation(state, factionId, RELATION_TRADE);
  }
  if (type === 'alliance') {
    if (state.credits < DIPLOMACY_ALLIANCE_COST) {
      return { ok: false, reason: `Need ${DIPLOMACY_ALLIANCE_COST} credits` };
    }
    if ((state.solarii ?? 0) < DIPLOMACY_ALLIANCE_SOLARII) {
      return { ok: false, reason: `Need ${DIPLOMACY_ALLIANCE_SOLARII} Solarii` };
    }
    state.credits -= DIPLOMACY_ALLIANCE_COST;
    state.solarii -= DIPLOMACY_ALLIANCE_SOLARII;
    return setRelation(state, factionId, RELATION_ALLIANCE);
  }
  return { ok: false, reason: 'Unknown treaty type' };
}

export function isAllied(state, factionId) {
  return getRelation(state, factionId).status === RELATION_ALLIANCE;
}

export function isAtWar(state, factionId) {
  const status = getRelation(state, factionId).status;
  return status === RELATION_WAR || status === RELATION_NEUTRAL;
}

export function aiShouldContestPlayer(state, factionId = 'ai-0') {
  const rel = getRelation(state, factionId);
  return rel.status === RELATION_WAR || rel.status === RELATION_NEUTRAL;
}

export function diplomaticTradeBonus(state) {
  ensureDiplomacy(state);
  let bonus = 0;
  for (const faction of listAiFactionsFromState(state)) {
    const rel = getRelation(state, faction.id);
    if (rel.status === RELATION_TRADE || rel.status === RELATION_ALLIANCE) {
      bonus += DIPLOMACY_TRADE_INCOME_BONUS;
    }
  }
  return 1 + bonus;
}

export function triggerSuperweaponPanic(state) {
  ensureDiplomacy(state);
  state.diplomacy.panicUntil = state.time + 120000;
  for (const faction of listAiFactionsFromState(state)) {
    if (!isAllied(state, faction.id)) {
      setRelation(state, faction.id, RELATION_WAR);
    }
  }
  return { ok: true, panicUntil: state.diplomacy.panicUntil };
}

export function isSuperweaponPanic(state) {
  return state.time < (state.diplomacy?.panicUntil ?? 0);
}

export function diplomacySummary(state) {
  ensureDiplomacy(state);
  refreshMilestones(state);
  const factions = listAiFactionsFromState(state).map((f) => ({
    id: f.id,
    name: f.name,
    personality: f.personality,
    ...getRelation(state, f.id),
  }));
  return {
    unlocked: isDiplomacyUnlocked(state),
    panic: isSuperweaponPanic(state),
    factions,
    tradeBonus: diplomaticTradeBonus(state),
  };
}

export function tickDiplomacy(state) {
  return [];
}
