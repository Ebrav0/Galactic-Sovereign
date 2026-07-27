// Campaign victory/defeat tracking (Phase 6, GDD §14).

import {
  VICTORY_DOMINION_THRESHOLD,
  VICTORY_ECONOMIC_CREDITS,
  VICTORY_ECONOMIC_SOLARII,
  VICTORY_ECONOMIC_DEPOTS,
  VICTORY_SCULPTOR_ACTIONS,
  FLAGSHIP_HP,
} from './constants.js';
import { persistentSystemRecords } from './galaxy-scope.js';
import { superweaponSummary } from './superweapon.js';
import { countCompletedDysons } from './milestones.js';
import { listAiFactionsFromState } from './diplomacy.js';
import { logisticsSummary } from './logistics.js';
import { createTutorialCampaignState, TUTORIAL_STEP_IDS } from './tutorial-access.js';

export const VICTORY_TYPES = [
  'sandbox', 'dominion', 'megastructure', 'annihilation', 'economic', 'sculptor',
];

export { createTutorialCampaignState } from './tutorial-access.js';

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
      tutorial: createTutorialCampaignState(),
    };
  }
  // Tutorial fields were added after campaign saves already existed. Keep old
  // saves playable without requiring a save-version bump for additive data.
  state.campaign.tutorialTargetSystemId ??= null;
  state.campaign.tutorialCompletedAt ??= null;
  if (!state.campaign.tutorial || typeof state.campaign.tutorial !== 'object') {
    state.campaign.tutorial = createTutorialCampaignState();
  } else {
    const defaults = createTutorialCampaignState();
    for (const [key, value] of Object.entries(defaults)) {
      if (state.campaign.tutorial[key] == null) state.campaign.tutorial[key] = value;
    }
    state.campaign.tutorial.flags ??= {};
    for (const [key, value] of Object.entries(defaults.flags)) {
      if (state.campaign.tutorial.flags[key] == null) state.campaign.tutorial.flags[key] = value;
    }
    if (!Array.isArray(state.campaign.tutorial.completedStepIds)) {
      state.campaign.tutorial.completedStepIds = [];
    }
    if (!state.campaign.tutorial.events || typeof state.campaign.tutorial.events !== 'object') {
      state.campaign.tutorial.events = {};
    }
    if (!TUTORIAL_STEP_IDS.includes(state.campaign.tutorial.currentStepId)) {
      state.campaign.tutorial.currentStepId = TUTORIAL_STEP_IDS[0];
      state.campaign.tutorial.completedStepIds = [];
      state.campaign.tutorial.events = {};
    }
  }
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
  state.campaign.tutorial = createTutorialCampaignState();
  state.campaign.tutorial.status = 'active';
  state.campaign.defeated = false;
  state.campaign.won = false;
  return { ok: true };
}

/** Anchored wormhole endpoints (each paired link contributes two endpoints). */
export function countAnchoredWormholeEndpoints(state) {
  let totalAnchors = 0;
  let playerAnchors = 0;
  for (const wh of Object.values(state.wormholes ?? {})) {
    if (!wh?.anchor) continue;
    totalAnchors += 1;
    if (wh.anchorOwner === 'player') playerAnchors += 1;
  }
  return { totalAnchors, playerAnchors };
}

export function dominionProgress(state) {
  const systems = persistentSystemRecords(state);
  const playerSystems = systems.filter(({ system }) => system.owner === 'player').length;
  const totalStars = Object.values(state.galaxies ?? {})
    .reduce((sum, galaxy) => sum + (galaxy.graph?.stars?.length ?? 0), 0)
    || systems.length;
  const systemThreshold = Math.ceil(totalStars * VICTORY_DOMINION_THRESHOLD);
  const { totalAnchors, playerAnchors } = countAnchoredWormholeEndpoints(state);
  const anchorThreshold = totalAnchors > 0
    ? Math.ceil(totalAnchors * VICTORY_DOMINION_THRESHOLD)
    : 0;
  return {
    playerSystems,
    systemThreshold,
    totalStars,
    playerAnchors,
    anchorThreshold,
    totalAnchors,
    systemsMet: playerSystems >= systemThreshold,
    anchorsMet: totalAnchors > 0 && playerAnchors >= anchorThreshold,
  };
}

export function economicProgress(state) {
  const credits = Math.floor(state.credits ?? 0);
  const solarii = state.solarii ?? 0;
  const depots = logisticsSummary(state).depotCount ?? 0;
  return {
    credits,
    creditsNeed: VICTORY_ECONOMIC_CREDITS,
    solarii,
    solariiNeed: VICTORY_ECONOMIC_SOLARII,
    depots,
    depotsNeed: VICTORY_ECONOMIC_DEPOTS,
    creditsMet: credits >= VICTORY_ECONOMIC_CREDITS,
    solariiMet: solarii >= VICTORY_ECONOMIC_SOLARII,
    depotsMet: depots >= VICTORY_ECONOMIC_DEPOTS,
  };
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

  if (vt === 'dominion') {
    const progress = dominionProgress(state);
    if (progress.systemsMet || progress.anchorsMet) {
      state.campaign.won = true;
      return {
        type: 'victory',
        victoryType: vt,
        path: progress.systemsMet ? 'systems' : 'anchors',
        playerSystems: progress.playerSystems,
        threshold: progress.systemThreshold,
        playerAnchors: progress.playerAnchors,
        anchorThreshold: progress.anchorThreshold,
      };
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
    const systems = persistentSystemRecords(state);
    const aiOwned = systems.filter(({ system }) => system.owner === 'ai').length;
    if (aiOwned === 0 && listAiFactionsFromState(state).length > 0) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt };
    }
  }

  if (vt === 'economic') {
    const progress = economicProgress(state);
    if (progress.creditsMet && progress.solariiMet && progress.depotsMet) {
      state.campaign.won = true;
      return { type: 'victory', victoryType: vt, ...progress };
    }
  }

  if (vt === 'sculptor') {
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
    tutorial: {
      ...state.campaign.tutorial,
      completedStepIds: [...state.campaign.tutorial.completedStepIds],
      flags: { ...state.campaign.tutorial.flags },
      events: { ...state.campaign.tutorial.events },
    },
    activeMissionId: state.campaign.activeMissionId,
    completedMissions: [...(state.campaign.completedMissions ?? [])],
    missionProgress: { ...(state.campaign.missionProgress ?? {}) },
    dominionProgress: dominionProgress(state),
    economicProgress: economicProgress(state),
  };
}
