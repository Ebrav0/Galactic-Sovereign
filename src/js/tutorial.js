// Guided new-player tutorial. Each beat is tied to a concrete game action,
// with a stable nearby target so players are never asked to guess what counts.

import { ensureCampaign, startTutorial } from './campaign.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import { hasOutpost, hasShipyard, systemById } from './state.js';
import { hasIntel } from './intel.js';

export const TUTORIAL_STEPS = [
  {
    id: 0,
    title: 'Establish the Supply Chain',
    objective: 'Build an outpost on your homeworld.',
    instruction: 'Outposts produce physical cargo. Local transports feed the export depot, and Trade Nexus delivery pays Credits.',
    actionLabel: 'Show homeworld',
    uiTargetId: 'build-outpost-btn',
  },
  {
    id: 1,
    title: 'Commission a Shipyard',
    objective: 'Build a shipyard beside your first outpost.',
    instruction: 'Shipyards turn Credits into scouts and combat ships.',
    actionLabel: 'Show shipyard site',
    uiTargetId: 'build-shipyard-btn',
  },
  {
    id: 2,
    title: 'Launch a Scout',
    objective: 'Add a scout to the Empire Build Queue.',
    instruction: 'A scout reveals systems before you risk the flagship. Fabrication takes a moment—keep the simulation running.',
    actionLabel: 'Show scout production',
    uiTargetId: 'queue-scout-btn',
  },
  {
    id: 3,
    title: 'Recon the Frontier',
    objective: 'Shift+click the marked neighboring system to dispatch your scout.',
    instruction: 'The cyan tutorial ring marks your first destination. Scouts reveal a system as soon as they arrive.',
    actionLabel: 'Open galaxy map',
    uiTargetId: 'tab-galaxy',
  },
  {
    id: 4,
    title: 'Read the Scout Report',
    objective: 'Wait for the scout to gather intel.',
    instruction: 'Intel reveals planets, ownership, and the capture requirement. Follow the scout route on the galaxy map.',
    actionLabel: 'Track scout',
    uiTargetId: 'tab-galaxy',
  },
  {
    id: 5,
    title: 'Set a Course',
    objective: 'Click the marked, scouted system to send the flagship there.',
    instruction: 'The flagship follows the lane route automatically. Its presence supplies capture force when it arrives.',
    actionLabel: 'Open galaxy map',
    uiTargetId: 'tab-galaxy',
  },
  {
    id: 6,
    title: 'Plan the First Claim',
    objective: 'Arrive at the marked system and review its Capture Requirement.',
    instruction: 'An outpost requires control. System Intel compares your capture force with the requirement—build combat ships before claiming systems the flagship cannot secure alone.',
    actionLabel: 'Open System Intel',
    uiTargetId: 'intel-panel',
  },
  {
    id: 7,
    title: 'You Have Command',
    objective: 'Your first expedition loop is complete.',
    instruction: 'Keep scouting before you travel, protect your cargo routes, and use Trade Nexus deliveries to fund research, fleets, and Dyson projects.',
    actionLabel: null,
    uiTargetId: null,
  },
];

function tutorialTargetSystemId(state) {
  const saved = state.campaign.tutorialTargetSystemId;
  if (saved && systemById(state, saved)) return saved;

  const graph = getGraph(state);
  const systems = getSystems(state);
  const candidates = [];
  for (const [a, b] of graph?.lanes ?? []) {
    if (a === state.stronghold) candidates.push(b);
    if (b === state.stronghold) candidates.push(a);
  }
  const viable = candidates.filter((id) => id !== 'core' && systems[id]?.star?.kind !== 'trade_nexus');
  const target = viable.find((id) => systems[id]?.owner === 'neutral')
    ?? viable.find((id) => systems[id]?.owner !== 'ai')
    ?? viable[0]
    ?? null;
  state.campaign.tutorialTargetSystemId = target;
  return target;
}

function homeBuildBody(state, predicate) {
  const home = systemById(state, state.stronghold);
  return home?.bodies.find((body) => body.type !== 'gas' && body.type !== 'barren' && predicate(body)) ?? null;
}

function homeOutpostBody(state) {
  return homeBuildBody(state, (body) => hasOutpost(state, state.stronghold, body.id));
}

function homeShipyardBody(state) {
  return homeBuildBody(state, (body) => hasShipyard(state, state.stronghold, body.id));
}

function scoutWasSentToTarget(state, targetId) {
  return (state.scouts ?? []).some((scout) => {
    const destination = scout.transit?.path?.[scout.transit.path.length - 1] ?? scout.systemId;
    return destination === targetId && (scout.transit || scout.systemId === targetId);
  });
}

function flagshipIsHeadingToTarget(state, targetId) {
  const destination = state.flagship.transit?.path?.[state.flagship.transit.path.length - 1]
    ?? state.flagship.systemId;
  return destination === targetId && (state.flagship.transit || state.flagship.systemId === targetId);
}

function hasHomeOutpost(state) {
  return !!homeOutpostBody(state);
}

function hasHomeShipyard(state) {
  return !!homeShipyardBody(state);
}

function hasScout(state) {
  return (state.scouts ?? []).length > 0;
}

function targetName(state, targetId) {
  return systemById(state, targetId)?.name ?? 'the marked neighboring system';
}

function statusForStep(state, step, targetId) {
  const target = targetName(state, targetId);
  if (step === 0) return hasHomeOutpost(state)
    ? 'Outpost online.'
    : 'Select a habitable world in your Stronghold.';
  if (step === 1) return hasHomeShipyard(state)
    ? 'Shipyard commissioned.'
    : 'Your home outpost is ready for a shipyard.';
  if (step === 2) return hasScout(state)
    ? 'Scout ready for deployment.'
    : 'Queue a scout, then wait for fabrication to finish.';
  if (step === 3) return scoutWasSentToTarget(state, targetId)
    ? `Scout dispatched to ${target}.`
    : `Dispatch your scout to ${target}.`;
  if (step === 4) return hasIntel(state, targetId)
    ? `${target} has been surveyed.`
    : 'Scout en route—its route is highlighted in cyan.';
  if (step === 5) return flagshipIsHeadingToTarget(state, targetId)
    ? `Flagship has a route to ${target}.`
    : `Send the flagship to ${target}.`;
  if (step === 6) {
    if (state.flagship.transit) return `Flagship en route to ${target}.`;
    if (state.flagship.systemId !== targetId) return `Move the flagship to ${target} to inspect its capture requirement.`;
    return `${target} is surveyed. System Intel now shows the force needed to capture it.`;
  }
  return 'Tutorial complete. You are ready to expand on your own.';
}

function canAdvance(state, step, targetId) {
  if (step === 0) return hasHomeOutpost(state);
  if (step === 1) return hasHomeShipyard(state);
  if (step === 2) return hasScout(state);
  if (step === 3) return scoutWasSentToTarget(state, targetId);
  if (step === 4) return hasIntel(state, targetId);
  if (step === 5) return flagshipIsHeadingToTarget(state, targetId);
  if (step === 6) return false;
  return false;
}

function currentStep(state) {
  const step = state.campaign.tutorialStep ?? 0;
  const base = TUTORIAL_STEPS[step] ?? null;
  if (!base) return null;
  const targetSystemId = tutorialTargetSystemId(state);
  const target = targetName(state, targetSystemId);
  return {
    ...base,
    targetSystemId,
    targetName: target,
    status: statusForStep(state, step, targetSystemId),
    canConfirm: step === 6 && state.flagship.systemId === targetSystemId && !state.flagship.transit,
    readyToFinish: step === TUTORIAL_STEPS.length - 1,
  };
}

export function getTutorialState(state) {
  ensureCampaign(state);
  const active = state.campaign.mode === 'tutorial';
  return {
    active,
    step: state.campaign.tutorialStep,
    totalSteps: TUTORIAL_STEPS.length,
    targetSystemId: active ? tutorialTargetSystemId(state) : null,
    current: active ? currentStep(state) : null,
    completedAt: state.campaign.tutorialCompletedAt ?? null,
  };
}

export function getTutorialFocus(state) {
  ensureCampaign(state);
  if (state.campaign.mode !== 'tutorial') return null;

  const step = state.campaign.tutorialStep ?? 0;
  const targetSystemId = tutorialTargetSystemId(state);
  if (step === 0) {
    const body = homeBuildBody(state, (candidate) => !hasOutpost(state, state.stronghold, candidate.id));
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : null;
  }
  if (step === 1) {
    const body = homeBuildBody(state, (candidate) => hasOutpost(state, state.stronghold, candidate.id)
      && !hasShipyard(state, state.stronghold, candidate.id));
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : null;
  }
  if (step === 2) {
    const body = homeShipyardBody(state);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : null;
  }
  if (step === 3 || step === 4 || step === 5) {
    return targetSystemId ? { view: 'galaxy', systemId: targetSystemId } : null;
  }
  if (step === 6) return targetSystemId ? { view: 'system', systemId: targetSystemId } : null;
  return null;
}

export function setTutorialStep(state, step) {
  ensureCampaign(state);
  if (!Number.isInteger(step) || step < 0 || step >= TUTORIAL_STEPS.length) {
    return { ok: false, reason: 'Invalid tutorial step' };
  }
  state.campaign.mode = 'tutorial';
  state.campaign.tutorialStep = step;
  tutorialTargetSystemId(state);
  return { ok: true, step };
}

export function tryAdvanceTutorial(state) {
  ensureCampaign(state);
  if (state.campaign.mode !== 'tutorial') return null;
  const step = state.campaign.tutorialStep ?? 0;
  const targetSystemId = tutorialTargetSystemId(state);
  if (!canAdvance(state, step, targetSystemId) || step >= TUTORIAL_STEPS.length - 1) return null;

  state.campaign.tutorialStep = step + 1;
  return { advanced: true, step: state.campaign.tutorialStep };
}

export function acknowledgeTutorialStep(state) {
  ensureCampaign(state);
  if (state.campaign.mode !== 'tutorial' || state.campaign.tutorialStep !== 6) {
    return { ok: false, reason: 'There is no tutorial briefing to confirm' };
  }
  const targetSystemId = tutorialTargetSystemId(state);
  if (state.flagship.systemId !== targetSystemId || state.flagship.transit) {
    return { ok: false, reason: 'Reach the marked system before continuing' };
  }
  state.campaign.tutorialStep = 7;
  return { ok: true, step: 7 };
}

export function finishTutorial(state, { skipped = false } = {}) {
  ensureCampaign(state);
  if (state.campaign.mode !== 'tutorial') return { ok: false, reason: 'Tutorial is not active' };
  if (!skipped && state.campaign.tutorialStep !== TUTORIAL_STEPS.length - 1) {
    return { ok: false, reason: 'Complete the current tutorial objective first' };
  }
  state.campaign.mode = 'sandbox';
  state.campaign.tutorialStep = null;
  state.campaign.tutorialCompletedAt = skipped ? null : state.time;
  return { ok: true, skipped };
}

export function initTutorial(state) {
  const result = startTutorial(state);
  tutorialTargetSystemId(state);
  return result;
}
