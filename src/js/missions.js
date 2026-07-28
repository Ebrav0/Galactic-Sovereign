// Scripted missions (Phase 6, GDD §14).

import { VICTORY_DOMINION_THRESHOLD } from './constants.js';
import { ensureCampaign } from './campaign.js';
import { persistentSystemRecords } from './galaxy-scope.js';
import { requireTutorialAccess } from './tutorial-access.js';

/** Shells required to count as a defendable Dyson project for Dyson Defense. */
export const DYSON_DEFENSE_MIN_SHELLS = 4;

export const MISSIONS = {
  wormhole_race: {
    id: 'wormhole_race',
    name: 'Wormhole Race',
    description: 'Enter an unanchored wormhole before the AI anchors it.',
    objectives: [{ id: 'enter_wormhole', label: 'Complete wormhole transit' }],
  },
  dyson_defense: {
    id: 'dyson_defense',
    name: 'Dyson Defense',
    description: 'Hold a Dyson system against AI assault.',
    objectives: [{ id: 'hold_dyson', label: 'Maintain player ownership of a 4+ shell system' }],
  },
  first_hero: {
    id: 'first_hero',
    name: 'First Hero Flagship',
    description: 'Build your first hero flagship at the Helioclast shipyard.',
    objectives: [{ id: 'build_hero', label: 'Build a hero flagship' }],
  },
  superweapon_sculpt: {
    id: 'superweapon_sculpt',
    name: 'Stellar Sculptor',
    description: 'Use the Helioclast to create a new star system.',
    objectives: [{ id: 'create_star', label: 'Create a star system' }],
  },
  diplomacy_intro: {
    id: 'diplomacy_intro',
    name: 'First Contact',
    description: 'Detect a sovereign power, establish communications, and send a negotiated proposal.',
    objectives: [
      { id: 'detect_faction', label: 'Detect a major faction' },
      { id: 'open_channel', label: 'Open a communications channel' },
      { id: 'send_proposal', label: 'Send a diplomatic proposal' },
    ],
  },
  diplomatic_legitimacy: {
    id: 'diplomatic_legitimacy',
    name: 'Galactic Legitimacy',
    description: 'After completing a Dyson sphere, establish an enforceable trade charter.',
    objectives: [{ id: 'trade_treaty', label: 'Sign a trade treaty after Galactic Legitimacy' }],
  },
  final_dominion: {
    id: 'final_dominion',
    name: 'Galactic Dominion',
    description: 'Control 35% of stars in your home galaxy.',
    objectives: [{ id: 'dominion', label: 'Reach dominion threshold' }],
  },
};

export function listMissions() {
  return Object.values(MISSIONS);
}

export function startMission(state, missionId, opts = {}) {
  const tutorial = requireTutorialAccess(state, 'missions', { bypass: opts.tutorialBypass });
  if (!tutorial.ok) return tutorial;
  if (!MISSIONS[missionId]) return { ok: false, reason: 'Unknown mission' };
  ensureCampaign(state);
  state.campaign.mode = 'mission';
  state.campaign.activeMissionId = missionId;
  state.campaign.missionProgress = state.campaign.missionProgress ?? {};
  state.campaign.missionProgress[missionId] = { startedAt: state.time, complete: false };
  // Immediate completion if the world already satisfies the objective (e.g. mid-save mission pick).
  evaluateActiveMission(state);
  return { ok: true, missionId };
}

export function advanceMissionObjective(state, missionId, objectiveId) {
  if (!MISSIONS[missionId]) return { ok: false, reason: 'Unknown mission' };
  ensureCampaign(state);
  const prog = state.campaign.missionProgress[missionId] ?? {};
  prog[objectiveId] = true;
  prog.complete = MISSIONS[missionId].objectives.every((o) => prog[o.id]);
  state.campaign.missionProgress[missionId] = prog;
  if (prog.complete && !state.campaign.completedMissions.includes(missionId)) {
    state.campaign.completedMissions.push(missionId);
    if (state.campaign.activeMissionId === missionId) {
      state.campaign.activeMissionId = null;
    }
  }
  return { ok: true, missionId, objectiveId, complete: prog.complete };
}

export function completeMissionForTest(state, missionId) {
  const mission = MISSIONS[missionId];
  if (!mission) return { ok: false, reason: 'Unknown mission' };
  for (const obj of mission.objectives) {
    advanceMissionObjective(state, missionId, obj.id);
  }
  return { ok: true, missionId };
}

/** Player-owned systems with enough Dyson shells for Dyson Defense. */
export function playerHeldDysonSystems(state, minShells = DYSON_DEFENSE_MIN_SHELLS) {
  const held = [];
  for (const { galaxyId, systemId, system } of persistentSystemRecords(state)) {
    if (system.owner !== 'player') continue;
    if ((system.dyson?.completedShells ?? 0) < minShells) continue;
    held.push({ galaxyId, systemId, shells: system.dyson.completedShells });
  }
  return held;
}

/** Home-galaxy share for Final Dominion (mission copy is home-galaxy scoped). */
export function homeGalaxyDominionProgress(state) {
  const homeId = state.homeGalaxyId ?? state.activeGalaxyId;
  const galaxy = state.galaxies?.[homeId];
  const systems = Object.values(galaxy?.systems ?? {});
  const totalStars = galaxy?.graph?.stars?.length ?? systems.length;
  const playerSystems = systems.filter((system) => system.owner === 'player').length;
  const systemThreshold = Math.ceil(Math.max(1, totalStars) * VICTORY_DOMINION_THRESHOLD);
  return {
    homeGalaxyId: homeId,
    playerSystems,
    systemThreshold,
    totalStars,
    systemsMet: playerSystems >= systemThreshold,
  };
}

/**
 * Advance tick-driven missions from authoritative sim state.
 * Event-driven missions (wormhole / hero / diplomacy / sculptor) skip this path.
 */
export function evaluateActiveMission(state) {
  ensureCampaign(state);
  const missionId = state.campaign.activeMissionId;
  if (!missionId) return null;
  const prog = state.campaign.missionProgress?.[missionId];
  if (prog?.complete) return null;

  if (missionId === 'dyson_defense') {
    const held = playerHeldDysonSystems(state);
    if (held.length === 0) return null;
    return advanceMissionObjective(state, 'dyson_defense', 'hold_dyson');
  }

  if (missionId === 'final_dominion') {
    const progress = homeGalaxyDominionProgress(state);
    if (!progress.systemsMet) return null;
    return advanceMissionObjective(state, 'final_dominion', 'dominion');
  }

  return null;
}

export function missionsSummary(state) {
  ensureCampaign(state);
  return {
    active: state.campaign.activeMissionId,
    completed: [...(state.campaign.completedMissions ?? [])],
    available: listMissions().map((m) => ({
      id: m.id,
      name: m.name,
      done: (state.campaign.completedMissions ?? []).includes(m.id),
    })),
  };
}
