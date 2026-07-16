// Scripted missions (Phase 6, GDD §14).

import { ensureCampaign } from './campaign.js';
import { requireTutorialAccess } from './tutorial-access.js';

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
    description: 'Build your first hero flagship at the Superweapon cradle.',
    objectives: [{ id: 'build_hero', label: 'Build a hero flagship' }],
  },
  superweapon_sculpt: {
    id: 'superweapon_sculpt',
    name: 'Stellar Sculptor',
    description: 'Use the Superweapon to create a new star system.',
    objectives: [{ id: 'create_star', label: 'Create a star system' }],
  },
  diplomacy_intro: {
    id: 'diplomacy_intro',
    name: 'Diplomatic Contact',
    description: 'Establish a trade treaty with an AI faction.',
    objectives: [{ id: 'trade_treaty', label: 'Sign a trade treaty' }],
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
