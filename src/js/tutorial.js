// Guided new-player tutorial. Coach marks hover beside concrete HUD controls;
// each beat advances from real game state (or a short Continue when needed).

import { ensureCampaign, startTutorial } from './campaign.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import { hasOutpost, hasShipyard, systemById } from './state.js';
import { hasIntel } from './intel.js';

export const TUTORIAL_STEPS = [
  {
    id: 0,
    title: 'Enter System View',
    objective: 'Open your Stronghold in System view.',
    instruction: 'Tap System to inspect planets and build surface structures.',
    actionLabel: 'Show homeworld',
    uiTargetId: 'tab-system',
    placement: 'top',
  },
  {
    id: 1,
    title: 'Establish the Supply Chain',
    objective: 'Build an outpost on your homeworld.',
    instruction: 'Outposts produce cargo and a steady credit stipend. Moons boost both.',
    actionLabel: 'Show homeworld',
    uiTargetId: 'build-outpost-btn',
    placement: 'left',
  },
  {
    id: 2,
    title: 'Review Logistics',
    objective: 'Open the Logistics panel.',
    instruction: 'Your first outpost commissions an export depot. Cargo delivers to Trade Nexuses for credits.',
    actionLabel: 'Open Logistics',
    uiTargetId: 'tab-logistics',
    placement: 'top',
  },
  {
    id: 3,
    title: 'Commission a Shipyard',
    objective: 'Build a shipyard beside your first outpost.',
    instruction: 'Shipyards turn credits into scouts and combat ships.',
    actionLabel: 'Show shipyard site',
    uiTargetId: 'build-shipyard-btn',
    placement: 'left',
  },
  {
    id: 4,
    title: 'Launch a Scout',
    objective: 'Add a scout to the Empire Build Queue.',
    instruction: 'Scouts reveal systems before you risk the flagship. Keep time running while it fabricates.',
    actionLabel: 'Show scout production',
    uiTargetId: 'queue-scout-btn',
    placement: 'left',
  },
  {
    id: 5,
    title: 'Recon the Frontier',
    objective: 'Shift+click the marked neighboring system to dispatch your scout.',
    instruction: 'The cyan ring marks your first destination.',
    actionLabel: 'Open galaxy map',
    uiTargetId: 'tab-galaxy',
    placement: 'bottom',
  },
  {
    id: 6,
    title: 'Read the Scout Report',
    objective: 'Wait for the scout to gather intel.',
    instruction: 'Watch the scout chip. Intel reveals planets, ownership, and capture requirement.',
    actionLabel: 'Track scout',
    uiTargetId: 'scout-summary',
    placement: 'bottom',
  },
  {
    id: 7,
    title: 'Assemble an Escort',
    objective: 'Queue a combat ship (corvette or better).',
    instruction: 'Capture needs force. Queue a corvette so the flagship is not alone.',
    actionLabel: 'Show fleet queue',
    uiTargetId: 'queue-corvette-btn',
    placement: 'right',
  },
  {
    id: 8,
    title: 'Set a Course',
    objective: 'Click the marked, scouted system to send the flagship there.',
    instruction: 'The flagship follows the lane route. Its presence supplies capture force on arrival.',
    actionLabel: 'Open galaxy map',
    uiTargetId: 'tab-galaxy',
    placement: 'bottom',
  },
  {
    id: 9,
    title: 'Review Capture Requirement',
    objective: 'Arrive at the marked system and check System Intel.',
    instruction: 'Compare your capture force with the requirement before you hold the claim.',
    actionLabel: 'Open System Intel',
    uiTargetId: 'capture-panel-body',
    placement: 'right',
  },
  {
    id: 10,
    title: 'Claim the System',
    objective: 'Hold the system until capture completes.',
    instruction: 'Keep enough force present and uncontested for the hold timer.',
    actionLabel: 'Show capture panel',
    uiTargetId: 'capture-panel-body',
    placement: 'right',
  },
  {
    id: 11,
    title: 'Dyson Horizon',
    objective: 'Build a Sail Foundry — or finish when ready.',
    instruction: 'Foundries mint Dyson sails. Launchers weave shells that unlock Solarii.',
    actionLabel: 'Show foundry site',
    uiTargetId: 'build-foundry-btn',
    placement: 'left',
  },
  {
    id: 12,
    title: 'You Have Command',
    objective: 'Your first expedition loop is complete.',
    instruction: 'Scout before you travel, protect cargo routes, and grow Dysons when ready.',
    actionLabel: null,
    uiTargetId: 'tab-campaign',
    placement: 'top',
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

function hasHomeOutpost(state) {
  return !!homeOutpostBody(state);
}

function hasHomeShipyard(state) {
  return !!homeShipyardBody(state);
}

function hasScout(state) {
  return (state.scouts ?? []).length > 0;
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

function flagshipArrivedAtTarget(state, targetId) {
  return state.flagship.systemId === targetId && !state.flagship.transit && !state.flagship.wormholeTransit;
}

function hasCombatShipProgress(state) {
  const ships = (state.playerShips ?? []).some((ship) => ship.hull && ship.hull !== 'scout');
  const queued = (state.empireQueue ?? []).some((item) => item.hull && item.hull !== 'scout');
  return ships || queued;
}

function targetOwnedByPlayer(state, targetId) {
  return systemById(state, targetId)?.owner === 'player';
}

function hasHomeFoundry(state) {
  const home = systemById(state, state.stronghold);
  return (home?.structures ?? []).some((s) => s.type === 'sail_foundry' && (s.hp ?? 1) > 0);
}

function targetName(state, targetId) {
  return systemById(state, targetId)?.name ?? 'the marked neighboring system';
}

function statusForStep(state, step, targetId) {
  const target = targetName(state, targetId);
  if (step === 0) return 'Open System view on your Stronghold.';
  if (step === 1) return hasHomeOutpost(state) ? 'Outpost online.' : 'Select a habitable world in your Stronghold.';
  if (step === 2) {
    return state.campaign.tutorialLogisticsOpened
      ? 'Logistics reviewed.'
      : 'Open Logistics to see depots and convoy flow.';
  }
  if (step === 3) return hasHomeShipyard(state) ? 'Shipyard commissioned.' : 'Your home outpost is ready for a shipyard.';
  if (step === 4) return hasScout(state) ? 'Scout ready for deployment.' : 'Queue a scout, then wait for fabrication.';
  if (step === 5) return scoutWasSentToTarget(state, targetId) ? `Scout dispatched to ${target}.` : `Dispatch your scout to ${target}.`;
  if (step === 6) return hasIntel(state, targetId) ? `${target} has been surveyed.` : 'Scout en route — route highlighted in cyan.';
  if (step === 7) return hasCombatShipProgress(state) ? 'Combat hull queued.' : 'Queue a corvette from the Empire Build Queue.';
  if (step === 8) return flagshipIsHeadingToTarget(state, targetId) ? `Flagship has a route to ${target}.` : `Send the flagship to ${target}.`;
  if (step === 9) {
    if (!flagshipArrivedAtTarget(state, targetId)) return `Move the flagship to ${target}.`;
    return `${target} is surveyed. Review the capture requirement.`;
  }
  if (step === 10) {
    if (targetOwnedByPlayer(state, targetId)) return `${target} is yours.`;
    return `Hold ${target} uncontested until capture completes.`;
  }
  if (step === 11) {
    return hasHomeFoundry(state)
      ? 'Sail Foundry online.'
      : 'Build a Sail Foundry when ready, or finish the tutorial.';
  }
  return 'Tutorial complete. You are ready to expand on your own.';
}

function canAdvance(state, step, targetId) {
  if (step === 0) return state.campaign.tutorialSystemViewed === true;
  if (step === 1) return hasHomeOutpost(state);
  if (step === 2) return state.campaign.tutorialLogisticsOpened === true;
  if (step === 3) return hasHomeShipyard(state);
  if (step === 4) return hasScout(state);
  if (step === 5) return scoutWasSentToTarget(state, targetId);
  if (step === 6) return hasIntel(state, targetId);
  if (step === 7) return hasCombatShipProgress(state);
  if (step === 8) return flagshipIsHeadingToTarget(state, targetId);
  if (step === 9) return flagshipArrivedAtTarget(state, targetId) && hasIntel(state, targetId);
  if (step === 10) return targetOwnedByPlayer(state, targetId);
  if (step === 11) return hasHomeFoundry(state);
  return false;
}

function currentStep(state) {
  const step = state.campaign.tutorialStep ?? 0;
  const base = TUTORIAL_STEPS[step] ?? null;
  if (!base) return null;
  const targetSystemId = tutorialTargetSystemId(state);
  const target = targetName(state, targetSystemId);
  const canConfirm = (step === 2 && !state.campaign.tutorialLogisticsOpened)
    || (step === 9 && flagshipArrivedAtTarget(state, targetSystemId))
    || (step === 11 && !hasHomeFoundry(state));
  return {
    ...base,
    targetSystemId,
    targetName: target,
    status: statusForStep(state, step, targetSystemId),
    canConfirm,
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
  if (step === 0 || step === 1) {
    const body = homeBuildBody(state, (candidate) => !hasOutpost(state, state.stronghold, candidate.id))
      ?? homeOutpostBody(state)
      ?? homeBuildBody(state, () => true);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : { view: 'system', systemId: state.stronghold };
  }
  if (step === 2) return { view: 'system', systemId: state.stronghold, panel: 'logistics' };
  if (step === 3) {
    const body = homeBuildBody(state, (candidate) => hasOutpost(state, state.stronghold, candidate.id)
      && !hasShipyard(state, state.stronghold, candidate.id))
      ?? homeOutpostBody(state);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : null;
  }
  if (step === 4 || step === 7) {
    const body = homeShipyardBody(state) ?? homeOutpostBody(state);
    return body
      ? { view: 'system', systemId: state.stronghold, bodyId: body.id, panel: step === 7 ? 'fleet' : null }
      : { view: 'system', systemId: state.stronghold, panel: step === 7 ? 'fleet' : null };
  }
  if (step === 5 || step === 6 || step === 8) {
    return targetSystemId ? { view: 'galaxy', systemId: targetSystemId } : null;
  }
  if (step === 9 || step === 10) {
    return targetSystemId ? { view: 'system', systemId: targetSystemId, showIntel: true } : null;
  }
  if (step === 11) {
    const body = homeOutpostBody(state) ?? homeBuildBody(state, () => true);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : null;
  }
  return { view: 'system', systemId: state.stronghold, panel: 'campaign' };
}

export function markTutorialSystemViewed(state) {
  ensureCampaign(state);
  if (state.campaign.mode === 'tutorial') state.campaign.tutorialSystemViewed = true;
}

export function markTutorialLogisticsOpened(state) {
  ensureCampaign(state);
  if (state.campaign.mode === 'tutorial') state.campaign.tutorialLogisticsOpened = true;
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
  if (state.campaign.mode !== 'tutorial') {
    return { ok: false, reason: 'Tutorial is not active' };
  }
  const step = state.campaign.tutorialStep ?? 0;
  const targetSystemId = tutorialTargetSystemId(state);

  if (step === 2) {
    state.campaign.tutorialLogisticsOpened = true;
    state.campaign.tutorialStep = 3;
    return { ok: true, step: 3 };
  }
  if (step === 9) {
    if (!flagshipArrivedAtTarget(state, targetSystemId)) {
      return { ok: false, reason: 'Reach the marked system before continuing' };
    }
    state.campaign.tutorialStep = 10;
    return { ok: true, step: 10 };
  }
  if (step === 11) {
    state.campaign.tutorialStep = 12;
    return { ok: true, step: 12 };
  }
  return { ok: false, reason: 'There is no tutorial briefing to confirm' };
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
  ensureCampaign(state);
  state.campaign.tutorialSystemViewed = false;
  state.campaign.tutorialLogisticsOpened = false;
  tutorialTargetSystemId(state);
  return result;
}
