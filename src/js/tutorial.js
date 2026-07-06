// Tutorial flow — 8 beats (Phase 6, GDD §14).

import { ensureCampaign, startTutorial } from './campaign.js';
import { hasOutpost, hasShipyard, hasFoundry } from './state.js';
import { hasIntel } from './intel.js';
import { isDiplomacyUnlocked } from './diplomacy.js';

export const TUTORIAL_STEPS = [
  { id: 0, title: 'Stronghold', hint: 'Your home system produces credits via outposts.' },
  { id: 1, title: 'Expansion', hint: 'Build an outpost on a habitable planet.' },
  { id: 2, title: 'Shipyard', hint: 'Construct a shipyard to produce scouts.' },
  { id: 3, title: 'Lane travel', hint: 'Order your flagship to travel to a neighboring star.' },
  { id: 4, title: 'Scouting', hint: 'Dispatch a scout and gather intel on an enemy system.' },
  { id: 5, title: 'Capture', hint: 'Hold an uncontested system for 20 seconds with enough force.' },
  { id: 6, title: 'Dyson loop', hint: 'Build a sail foundry and complete Shell #1 for Solarii.' },
  { id: 7, title: 'Wormhole', hint: 'Visit the galactic core wormhole when ready.' },
  { id: 8, title: 'Diplomacy', hint: 'Complete a Dyson sphere to unlock treaties with AI factions.' },
];

export function getTutorialState(state) {
  ensureCampaign(state);
  return {
    active: state.campaign.mode === 'tutorial',
    step: state.campaign.tutorialStep,
    totalSteps: TUTORIAL_STEPS.length,
    current: TUTORIAL_STEPS[state.campaign.tutorialStep ?? 0] ?? null,
  };
}

export function setTutorialStep(state, step) {
  ensureCampaign(state);
  if (step < 0 || step >= TUTORIAL_STEPS.length) {
    return { ok: false, reason: 'Invalid step' };
  }
  state.campaign.mode = 'tutorial';
  state.campaign.tutorialStep = step;
  return { ok: true, step };
}

export function tryAdvanceTutorial(state) {
  ensureCampaign(state);
  if (state.campaign.mode !== 'tutorial') return null;
  const step = state.campaign.tutorialStep ?? 0;
  const sys = state.stronghold;
  let advanced = false;

  if (step === 0 && state.credits > 0) advanced = true;
  if (step === 1) {
    for (const p of state.galaxies[state.activeGalaxyId]?.systems[sys]?.bodies ?? []) {
      if (hasOutpost(state, sys, p.id)) { advanced = true; break; }
    }
  }
  if (step === 2) {
    for (const p of state.galaxies[state.activeGalaxyId]?.systems[sys]?.bodies ?? []) {
      if (hasShipyard(state, sys, p.id)) { advanced = true; break; }
    }
  }
  if (step === 3 && state.flagship.transit) advanced = true;
  if (step === 4 && state.scouts.length > 0) advanced = true;
  if (step === 5) {
    const systems = state.galaxies[state.activeGalaxyId]?.systems ?? {};
    if (Object.values(systems).some((s) => s.owner === 'player' && s.id !== sys)) advanced = true;
  }
  if (step === 6 && hasFoundry(state, sys)) advanced = true;
  if (step === 7 && state.flagship.systemId === 'core') advanced = true;
  if (step === 8 && isDiplomacyUnlocked(state)) advanced = true;

  if (advanced && step < TUTORIAL_STEPS.length - 1) {
    state.campaign.tutorialStep = step + 1;
    return { advanced: true, step: state.campaign.tutorialStep };
  }
  if (advanced && step === TUTORIAL_STEPS.length - 1) {
    state.campaign.tutorialStep = step;
    return { advanced: true, step, complete: true };
  }
  return null;
}

export function initTutorial(state) {
  return startTutorial(state);
}
