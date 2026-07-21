// Empire milestone tracking (Phase 6, GDD §18).

import { SHELL_COUNT } from './constants.js';
import { ensureDyson } from './state.js';
import { persistentSystemRecords } from './galaxy-scope.js';

export function ensureMilestones(state) {
  if (!state.milestones) {
    state.milestones = {
      completedDysonSystems: [],
      diplomacyUnlocked: false,
      superweaponUnlocked: false,
    };
  }
}

export function countCompletedDysons(state) {
  const systems = [];
  for (const { galaxyId, systemId, system } of persistentSystemRecords(state)) {
    if ((system.dyson?.completedShells ?? 0) >= SHELL_COUNT) {
      systems.push(`${galaxyId}:${systemId}`);
    }
  }
  return systems;
}

export function refreshMilestones(state) {
  ensureMilestones(state);
  const prevDiplo = state.milestones.diplomacyUnlocked;
  const prevSuper = state.milestones.superweaponUnlocked;
  state.milestones.completedDysonSystems = countCompletedDysons(state);
  state.milestones.diplomacyUnlocked = state.milestones.completedDysonSystems.length >= 1;
  state.milestones.superweaponUnlocked = state.milestones.completedDysonSystems.length >= 3;
  const events = [];
  if (!prevDiplo && state.milestones.diplomacyUnlocked) {
    events.push({ type: 'milestone_unlock', milestone: 'diplomacy' });
  }
  if (!prevSuper && state.milestones.superweaponUnlocked) {
    events.push({ type: 'milestone_unlock', milestone: 'superweapon' });
  }
  return events;
}

export function milestonesSummary(state) {
  ensureMilestones(state);
  refreshMilestones(state);
  return {
    completedDysonCount: state.milestones.completedDysonSystems.length,
    completedDysonSystems: [...state.milestones.completedDysonSystems],
    diplomacyUnlocked: state.milestones.diplomacyUnlocked,
    superweaponUnlocked: state.milestones.superweaponUnlocked,
  };
}

export function unlockMilestonesForTest(state, {
  diplomacy = true,
  superweapon = true,
  solarii = true,
} = {}) {
  ensureMilestones(state);
  if (diplomacy) state.milestones.diplomacyUnlocked = true;
  if (superweapon) state.milestones.superweaponUnlocked = true;
  if (solarii || diplomacy || superweapon) state.solariiUnlocked = true;
  return {
    diplomacyUnlocked: state.milestones.diplomacyUnlocked,
    superweaponUnlocked: state.milestones.superweaponUnlocked,
    solariiUnlocked: state.solariiUnlocked === true,
  };
}

/** Test hook: force N completed dysons on distinct player systems. */
export function setCompletedDysonsForTest(state, count) {
  const systems = Object.values(state.galaxies?.[state.activeGalaxyId]?.systems ?? {});
  let playerSystems = systems.filter((s) => s.owner === 'player' && s.id !== 'core');
  if (playerSystems.length < count) {
    for (const sys of systems) {
      if (sys.id === 'core' || sys.id === state.stronghold) continue;
      if (playerSystems.length >= count) break;
      if (sys.owner !== 'player') {
        sys.owner = 'player';
        playerSystems.push(sys);
      }
    }
  }
  let n = 0;
  for (const sys of playerSystems) {
    if (n >= count) break;
    ensureDyson(sys);
    sys.dyson.completedShells = SHELL_COUNT;
    n++;
  }
  if (n >= 1) state.solariiUnlocked = true;
  return refreshMilestones(state);
}
