// Required first-command curriculum. Steps advance from authoritative game
// state; presentation is handled by the coach UI.

import { ensureCampaign, startTutorial } from './campaign.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import { hasOutpost, hasShipyard, systemById } from './state.js';
import { hasIntel } from './intel.js';
import {
  TUTORIAL_CURRICULUM_VERSION,
  TUTORIAL_STEP_IDS,
  tutorialStepIndex,
} from './tutorial-access.js';

export const TUTORIAL_STEPS = Object.freeze([
  {
    id: 'command_basics',
    title: 'Take Command',
    objective: 'Open System view, then pause and resume time once.',
    instruction: 'System and Galaxy views show different command layers. Pause whenever you need time to plan.',
    actionLabel: 'Show Stronghold',
    uiTargetId: 'pause-btn',
    placement: 'bottom',
  },
  {
    id: 'build_outpost',
    title: 'Establish an Outpost',
    objective: 'Build an outpost on the highlighted Stronghold world.',
    instruction: 'Outposts generate credits and cargo. Moons improve their output.',
    actionLabel: 'Show build site',
    uiTargetId: 'build-outpost-btn',
    placement: 'left',
  },
  {
    id: 'review_logistics',
    title: 'Review Logistics',
    objective: 'Open Logistics and inspect your first export depot.',
    instruction: 'Cargo moves through depots and convoys to Trade Nexuses for credits.',
    actionLabel: 'Open Logistics',
    uiTargetId: 'tab-logistics',
    placement: 'top',
  },
  {
    id: 'build_shipyard',
    title: 'Build an Orbital Shipyard',
    objective: 'Commission a shipyard beside the outpost.',
    instruction: 'Shipyards fulfill the empire-wide production queue and deliver completed hulls.',
    actionLabel: 'Show shipyard site',
    uiTargetId: 'build-shipyard-btn',
    placement: 'left',
  },
  {
    id: 'launch_scout',
    title: 'Launch a Scout',
    objective: 'Queue a scout and wait for it to launch.',
    instruction: 'Scouts reveal ownership, planets, threats, and capture requirements before your fleet commits.',
    actionLabel: 'Show scout queue',
    uiTargetId: 'queue-scout-btn',
    placement: 'left',
  },
  {
    id: 'scout_frontier',
    title: 'Survey the Frontier',
    objective: 'Send the scout to the cyan-marked neighboring system.',
    instruction: 'Select the scout, then Shift-click the marked system on the Galaxy map.',
    actionLabel: 'Show target',
    uiTargetId: 'tab-galaxy',
    placement: 'bottom',
  },
  {
    id: 'assemble_escort',
    title: 'Assemble an Escort',
    objective: 'Queue a corvette and wait for it to join your fleet.',
    instruction: 'Combat hulls protect the flagship and provide capture force after battle.',
    actionLabel: 'Open Fleet Command',
    uiTargetId: 'queue-corvette-btn',
    placement: 'right',
  },
  {
    id: 'travel_to_battle',
    title: 'Set a Battle Course',
    objective: 'Send the flagship and its escort to the surveyed system.',
    instruction: 'Click the marked system. Training Command will route the home escort alongside the flagship.',
    actionLabel: 'Show destination',
    uiTargetId: 'tab-galaxy',
    placement: 'bottom',
  },
  {
    id: 'win_first_battle',
    title: 'Win the Engagement',
    objective: 'Select your ships, issue an Attack order, resume time, and destroy the training raider.',
    instruction: 'Pause to plan. Advanced Tactics exposes Move, Attack, Hold, formations, and retreat.',
    actionLabel: 'Show battle',
    uiTargetId: 'combat-hud-attack',
    placement: 'right',
  },
  {
    id: 'capture_first_system',
    title: 'Claim the System',
    objective: 'Hold the cleared system for five seconds.',
    instruction: 'Capture progresses only while sufficient friendly force is present and no enemy contests the system.',
    actionLabel: 'Show capture status',
    uiTargetId: 'capture-panel-body',
    placement: 'right',
  },
  {
    id: 'graduation',
    title: 'Sovereign Command Granted',
    objective: 'Your first expansion loop is complete.',
    instruction: 'Choose a victory condition and difficulty. New systems will explain themselves through unlock briefings in the Field Manual.',
    actionLabel: null,
    uiTargetId: 'tab-campaign',
    placement: 'top',
  },
]);

function tutorialState(state) {
  ensureCampaign(state);
  return state.campaign.tutorial;
}

function tutorialTargetSystemId(state) {
  const tutorial = tutorialState(state);
  const saved = tutorial.targetSystemId;
  if (saved && systemById(state, saved)) return saved;

  const graph = getGraph(state);
  const systems = getSystems(state);
  const candidates = [];
  for (const [a, b] of graph?.lanes ?? []) {
    if (a === state.stronghold) candidates.push(b);
    if (b === state.stronghold) candidates.push(a);
  }
  const viable = candidates
    .filter((id) => id !== 'core' && systems[id]?.star?.kind !== 'trade_nexus')
    .sort((a, b) => String(a).localeCompare(String(b)));
  const target = viable.find((id) => systems[id]?.owner === 'neutral')
    ?? viable.find((id) => systems[id]?.owner !== 'ai')
    ?? viable[0]
    ?? null;
  tutorial.targetSystemId = target;
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

function hasCombatShip(state) {
  return (state.playerShips ?? []).some((ship) => ship.hp > 0 && ship.hull && ship.hull !== 'scout');
}

function targetOwnedByPlayer(state, targetId) {
  return systemById(state, targetId)?.owner === 'player';
}

function targetName(state, targetId) {
  return systemById(state, targetId)?.name ?? 'the marked neighboring system';
}

function canAdvance(state, stepId, targetId) {
  const flags = tutorialState(state).flags;
  if (stepId === 'command_basics') return flags.systemViewed && flags.timeToggled;
  if (stepId === 'build_outpost') return hasHomeOutpost(state);
  if (stepId === 'review_logistics') return flags.logisticsOpened;
  if (stepId === 'build_shipyard') return hasHomeShipyard(state);
  if (stepId === 'launch_scout') return hasScout(state);
  if (stepId === 'scout_frontier') return hasIntel(state, targetId);
  if (stepId === 'assemble_escort') return hasCombatShip(state);
  if (stepId === 'travel_to_battle') return flags.battlePrepared;
  if (stepId === 'win_first_battle') return flags.battleCommandIssued && flags.battleWon;
  if (stepId === 'capture_first_system') return targetOwnedByPlayer(state, targetId);
  return false;
}

function statusForStep(state, stepId, targetId) {
  const flags = tutorialState(state).flags;
  const target = targetName(state, targetId);
  if (stepId === 'command_basics') {
    if (!flags.systemViewed) return 'Open System view on your Stronghold.';
    return flags.timeToggled ? 'Command timeline confirmed.' : 'Pause and resume time once.';
  }
  if (stepId === 'build_outpost') return hasHomeOutpost(state) ? 'Outpost online.' : 'Select the highlighted habitable world.';
  if (stepId === 'review_logistics') return flags.logisticsOpened ? 'Logistics reviewed.' : 'Open Logistics to inspect cargo flow.';
  if (stepId === 'build_shipyard') return hasHomeShipyard(state) ? 'Shipyard commissioned.' : 'Build beside the Stronghold outpost.';
  if (stepId === 'launch_scout') return hasScout(state) ? 'Scout ready.' : 'Queue a scout and keep time running.';
  if (stepId === 'scout_frontier') return hasIntel(state, targetId) ? `${target} surveyed.` : `Dispatch the scout to ${target}.`;
  if (stepId === 'assemble_escort') return hasCombatShip(state) ? 'Escort ready.' : 'Queue a corvette and wait for delivery.';
  if (stepId === 'travel_to_battle') return flags.battlePrepared ? `Training contact at ${target}.` : `Send the flagship to ${target}.`;
  if (stepId === 'win_first_battle') {
    if (flags.battleWon) return 'Training raider destroyed.';
    return flags.battleCommandIssued ? 'Attack order accepted — resume time.' : 'Select friendlies and issue an Attack order.';
  }
  if (stepId === 'capture_first_system') return targetOwnedByPlayer(state, targetId) ? `${target} secured.` : 'Hold uncontested for five seconds.';
  return 'Training complete. Choose the shape of your campaign.';
}

function currentStep(state) {
  const tutorial = tutorialState(state);
  const index = Math.max(0, tutorialStepIndex(tutorial.currentStepId));
  const base = TUTORIAL_STEPS[index] ?? null;
  if (!base) return null;
  const targetSystemId = tutorialTargetSystemId(state);
  return {
    ...base,
    index,
    targetSystemId,
    targetName: targetName(state, targetSystemId),
    status: statusForStep(state, base.id, targetSystemId),
    canConfirm: false,
    readyToFinish: base.id === 'graduation',
  };
}

export function getTutorialState(state) {
  const tutorial = tutorialState(state);
  const active = state.campaign.mode === 'tutorial' && tutorial.status === 'active';
  return {
    active,
    status: tutorial.status,
    step: tutorial.currentStepId,
    stepIndex: tutorialStepIndex(tutorial.currentStepId),
    totalSteps: TUTORIAL_STEPS.length,
    targetSystemId: tutorial.targetSystemId,
    current: active ? currentStep(state) : null,
    graduationPending: tutorial.graduationPending,
    completedAt: tutorial.completedAt,
  };
}

export function getTutorialFocus(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.status !== 'active') return null;
  const stepId = tutorial.currentStepId;
  const targetSystemId = tutorialTargetSystemId(state);
  if (['command_basics', 'build_outpost'].includes(stepId)) {
    const body = homeBuildBody(state, (candidate) => !hasOutpost(state, state.stronghold, candidate.id))
      ?? homeOutpostBody(state)
      ?? homeBuildBody(state, () => true);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : { view: 'system', systemId: state.stronghold };
  }
  if (stepId === 'review_logistics') return { view: 'system', systemId: state.stronghold, panel: 'logistics' };
  if (['build_shipyard', 'launch_scout', 'assemble_escort'].includes(stepId)) {
    const body = homeShipyardBody(state) ?? homeOutpostBody(state);
    return body
      ? { view: 'system', systemId: state.stronghold, bodyId: body.id, panel: stepId === 'assemble_escort' ? 'fleet' : null }
      : { view: 'system', systemId: state.stronghold, panel: stepId === 'assemble_escort' ? 'fleet' : null };
  }
  if (['scout_frontier', 'travel_to_battle'].includes(stepId)) {
    return targetSystemId ? { view: 'galaxy', systemId: targetSystemId } : null;
  }
  if (['win_first_battle', 'capture_first_system'].includes(stepId)) {
    return targetSystemId ? { view: 'system', systemId: targetSystemId, showIntel: true } : null;
  }
  return { view: 'system', systemId: state.stronghold, panel: 'campaign' };
}

export function markTutorialSystemViewed(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode === 'tutorial') tutorial.flags.systemViewed = true;
}

export function markTutorialTimeToggled(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode === 'tutorial') tutorial.flags.timeToggled = true;
}

export function markTutorialLogisticsOpened(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode === 'tutorial') tutorial.flags.logisticsOpened = true;
}

export function markTutorialBattlePrepared(state) {
  const tutorial = tutorialState(state);
  tutorial.flags.battlePrepared = true;
  return setTutorialStep(state, 'win_first_battle');
}

export function markTutorialBattleCommand(state) {
  const tutorial = tutorialState(state);
  tutorial.flags.battleCommandIssued = true;
}

export function markTutorialBattleResolved(state, playerWon) {
  const tutorial = tutorialState(state);
  tutorial.flags.battleWon = playerWon === true;
  tutorial.flags.battleFailed = playerWon !== true;
  if (playerWon) return setTutorialStep(state, 'capture_first_system');
  return { ok: true, failed: true };
}

export function tutorialNeedsBattlePreparation(state, systemId) {
  const tutorial = tutorialState(state);
  return state.campaign.mode === 'tutorial'
    && tutorial.status === 'active'
    && tutorial.currentStepId === 'travel_to_battle'
    && tutorial.targetSystemId === systemId
    && !tutorial.flags.battlePrepared;
}

export function setTutorialStep(state, step) {
  const tutorial = tutorialState(state);
  const stepId = Number.isInteger(step) ? TUTORIAL_STEP_IDS[step] : step;
  if (!TUTORIAL_STEP_IDS.includes(stepId)) return { ok: false, reason: 'Invalid tutorial step' };
  tutorial.status = 'active';
  tutorial.currentStepId = stepId;
  tutorial.graduationPending = false;
  state.campaign.mode = 'tutorial';
  tutorialTargetSystemId(state);
  return { ok: true, step: stepId, stepIndex: tutorialStepIndex(stepId) };
}

export function tryAdvanceTutorial(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.status !== 'active') return null;
  const index = tutorialStepIndex(tutorial.currentStepId);
  if (index < 0 || index >= TUTORIAL_STEP_IDS.length - 1) return null;
  const targetSystemId = tutorialTargetSystemId(state);
  if (!canAdvance(state, tutorial.currentStepId, targetSystemId)) return null;
  if (!tutorial.completedStepIds.includes(tutorial.currentStepId)) {
    tutorial.completedStepIds.push(tutorial.currentStepId);
  }
  tutorial.currentStepId = TUTORIAL_STEP_IDS[index + 1];
  return { advanced: true, step: tutorial.currentStepId, stepIndex: index + 1 };
}

export function acknowledgeTutorialStep(state) {
  const advanced = tryAdvanceTutorial(state);
  return advanced ? { ok: true, ...advanced } : { ok: false, reason: 'Complete the current objective first' };
}

export function beginTutorialGraduation(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.currentStepId !== 'graduation') {
    return { ok: false, reason: 'Complete the tutorial first' };
  }
  tutorial.status = 'graduation_pending';
  tutorial.graduationPending = true;
  tutorial.completedAt = state.time;
  return { ok: true, graduationPending: true };
}

export function completeTutorialGraduation(state, { victoryType = 'sandbox', aiDifficulty = 'normal' } = {}) {
  const tutorial = tutorialState(state);
  if (!tutorial.graduationPending) return { ok: false, reason: 'Graduation is not pending' };
  tutorial.status = 'complete';
  tutorial.graduationPending = false;
  tutorial.currentStepId = 'graduation';
  state.campaign.mode = 'sandbox';
  state.campaign.tutorialCompletedAt = tutorial.completedAt;
  state.campaign.victoryType = victoryType;
  state.campaign.defeated = false;
  state.campaign.won = false;
  state.aiDifficulty = aiDifficulty;
  return { ok: true, victoryType, aiDifficulty };
}

export function finishTutorial(state, { skipped = false, allowReplayExit = false } = {}) {
  if (skipped && !allowReplayExit) return { ok: false, reason: 'Tutorial graduation is required' };
  if (skipped) {
    state.campaign.mode = 'sandbox';
    const tutorial = tutorialState(state);
    tutorial.status = 'inactive';
    tutorial.graduationPending = false;
    return { ok: true, skipped: true };
  }
  return beginTutorialGraduation(state);
}

export function initTutorial(state, { replay = false } = {}) {
  const result = startTutorial(state);
  const tutorial = tutorialState(state);
  tutorial.version = TUTORIAL_CURRICULUM_VERSION;
  tutorial.status = 'active';
  tutorial.currentStepId = TUTORIAL_STEP_IDS[0];
  tutorial.completedStepIds = [];
  tutorial.targetSystemId = null;
  tutorial.flags = {
    systemViewed: false,
    timeToggled: false,
    logisticsOpened: false,
    battlePrepared: false,
    battleCommandIssued: false,
    battleWon: false,
    battleFailed: false,
  };
  tutorial.graduationPending = false;
  tutorial.completedAt = null;
  tutorial.replay = replay === true;
  state.credits = Math.max(state.credits ?? 0, 2500);
  tutorialTargetSystemId(state);
  return result;
}
