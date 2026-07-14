// Campaign victory/defeat tracking (Phase 6, GDD §14).

import {
  VICTORY_DOMINION_THRESHOLD,
  VICTORY_ECONOMIC_CREDITS,
  VICTORY_ECONOMIC_SOLARII,
  VICTORY_SCULPTOR_ACTIONS,
  SHELL_COUNT,
} from './constants.js';
import { getSystems, persistentSystemRecords } from './galaxy-scope.js';
import { superweaponSummary } from './superweapon.js';
import { countCompletedDysons } from './milestones.js';
import { listAiFactionsFromState } from './diplomacy.js';
import { FLAGSHIP_HP } from './constants.js';

export const VICTORY_TYPES = [
  'sandbox', 'dominion', 'megastructure', 'annihilation', 'economic', 'sculptor',
];

export function ensureCampaign(state) {
  if (!state.campaign) {
    state.campaign = {
      mode: 'sandbox',
      victoryType: 'sandbox',
      defeated: false,
      won: false,
      tutorialStep: null,
      activeMissionId: null,
      completedMissions: [],
      missionProgress: {},
      tutorialTargetSystemId: null,
      tutorialCompletedAt: null,
    };
  }
  // Tutorial fields were added after campaign saves already existed. Keep old
  // saves playable without requiring a save-version bump for additive data.
  state.campaign.tutorialTargetSystemId ??= null;
  state.campaign.tutorialCompletedAt ??= null;
}

export function setVictoryType(state, type, mode = 'sandbox') {
  if (!VICTORY_TYPES.includes(type)) {
    return { ok: false, reason: 'Invalid victory type' };
  }
  ensureCampaign(state);
  state.campaign.victoryType = type;
  state.campaign.mode = mode;
  state.campaign.defeated = false;
  state.campaign.won = false;
  return { ok: true, victoryType: type, mode };
}

export function startTutorial(state) {
  ensureCampaign(state);
  state.campaign.mode = 'tutorial';
  state.campaign.victoryType = 'sandbox';
  state.campaign.tutorialStep = 0;
  state.campaign.tutorialTargetSystemId = null;
  state.campaign.tutorialCompletedAt = null;
  state.campaign.tutorialSystemViewed = false;
  state.campaign.tutorialLogisticsOpened = false;
  state.campaign.defeated = false;
  state.campaign.won = false;
  return { ok: true };
}

export function checkDefeat(state) {
  ensureCampaign(state);
  if (state.campaign.defeated || state.campaign.won) return null;

  if ((state.flagship.hp ?? FLAGSHIP_HP) <= 0) {
    state.campaign.defeated = true;
    return { type: 'defeat', reason: 'flagship_destroyed' };
  }

  const stronghold = persistentSystemRecords(state)
    .find((record) => record.galaxyId === state.homeGalaxyId && record.systemId === state.stronghold)?.system;
  if (stronghold && stronghold.owner !== 'player') {
    state.campaign.defeated = true;
    return { type: 'defeat', reason: 'stronghold_lost' };
  }

  const hasStructures = (stronghold?.structures?.length ?? 0) > 0;
  const hasShips = (state.playerShips ?? []).some((s) => s.systemId === state.stronghold);
  const flagshipHome = state.flagship.systemId === state.stronghold && !state.flagship.transit;
  if (stronghold?.owner === 'player' && !hasStructures && !hasShips && !flagshipHome
      && (state.heroFlagships ?? []).every((h) => h.systemId !== state.stronghold)) {
    const allDestroyed = !stronghold.structures.length
      && !(state.playerShips ?? []).some((s) => s.systemId === state.stronghold && s.hp > 0);
    if (allDestroyed && (state.flagship.hp ?? FLAGSHIP_HP) <= 0) {
      state.campaign.defeated = true;
      return { type: 'defeat', reason: 'stronghold_annihilated' };
    }
  }

  return null;
}

export function checkVictory(state) {
  ensureCampaign(state);
  if (state.campaign.defeated || state.campaign.won) {
    return state.campaign.won ? { type: 'victory', victoryType: state.campaign.victoryType } : null;
  }
  const vt = state.campaign.victoryType;
  if (vt === 'sandbox') return null;

  const systems = persistentSystemRecords(state);
  const playerSystems = systems.filter(({ system }) => system.owner === 'player').length;
  const totalStars = Object.values(state.galaxies ?? {})
    .reduce((sum, galaxy) => sum + (galaxy.graph?.stars?.length ?? 0), 0)
    || systems.length;

  if (vt === 'dominion') {
    const threshold = Math.ceil(totalStars * VICTORY_DOMINION_THRESHOLD);
    if (playerSystems >= threshold) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt, playerSystems, threshold };
    }
  }

  if (vt === 'megastructure') {
    const dysons = countCompletedDysons(state).length;
    const sw = superweaponSummary(state);
    if (dysons >= 3 && sw.online) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt, dysons };
    }
  }

  if (vt === 'annihilation') {
    const aiOwned = systems.filter(({ system }) => system.owner === 'ai').length;
    if (aiOwned === 0 && listAiFactionsFromState(state).length > 0) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt };
    }
  }

  if (vt === 'economic') {
    if (state.credits >= VICTORY_ECONOMIC_CREDITS && (state.solarii ?? 0) >= VICTORY_ECONOMIC_SOLARII) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt };
    }
  }

  if (vt === 'sculptor') {
    const actions = state.superweapon?.createCount ?? 0;
    const destroys = (state.superweapon?.lastAction?.type === 'destroy') ? 1 : 0;
    const total = (state.superweapon?.createCount ?? 0)
      + (state.campaign.missionProgress?.destroyCount ?? 0);
    if (total >= VICTORY_SCULPTOR_ACTIONS) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt, actions: total };
    }
  }

  return null;
}

export function tickCampaign(state) {
  const defeat = checkDefeat(state);
  if (defeat) return [defeat];
  const victory = checkVictory(state);
  if (victory) return [victory];
  return [];
}

export function campaignSummary(state) {
  ensureCampaign(state);
  return {
    mode: state.campaign.mode,
    victoryType: state.campaign.victoryType,
    defeated: state.campaign.defeated,
    won: state.campaign.won,
    tutorialStep: state.campaign.tutorialStep,
    tutorialTargetSystemId: state.campaign.tutorialTargetSystemId,
    tutorialCompletedAt: state.campaign.tutorialCompletedAt,
    activeMissionId: state.campaign.activeMissionId,
    completedMissions: [...(state.campaign.completedMissions ?? [])],
    missionProgress: { ...(state.campaign.missionProgress ?? {}) },
  };
}
