// Central tutorial feature gates and tutorial-only pacing modifiers.
// This module intentionally has no imports so gameplay modules can consult it
// without creating dependency cycles.

export const TUTORIAL_CURRICULUM_VERSION = 2;

export const TUTORIAL_STEP_IDS = Object.freeze([
  'command_basics',
  'build_outpost',
  'review_logistics',
  'build_shipyard',
  'launch_scout',
  'scout_frontier',
  'assemble_escort',
  'travel_to_battle',
  'win_first_battle',
  'capture_first_system',
  'graduation',
]);

export function createTutorialCampaignState() {
  return {
    version: TUTORIAL_CURRICULUM_VERSION,
    status: 'inactive',
    currentStepId: TUTORIAL_STEP_IDS[0],
    completedStepIds: [],
    targetSystemId: null,
    flags: {
      systemViewed: false,
      timeToggled: false,
      logisticsOpened: false,
      battlePrepared: false,
      battleCommandIssued: false,
      battleWon: false,
      battleFailed: false,
    },
    graduationPending: false,
    completedAt: null,
    replay: false,
  };
}

const STEP_INDEX = new Map(TUTORIAL_STEP_IDS.map((id, index) => [id, index]));

export const TUTORIAL_FEATURE_UNLOCK_STEP = Object.freeze({
  system_view: 'command_basics',
  time_controls: 'command_basics',
  save_load: 'command_basics',
  campaign_help: 'command_basics',
  outpost: 'build_outpost',
  logistics: 'review_logistics',
  shipyard: 'build_shipyard',
  scout_queue: 'launch_scout',
  galaxy_view: 'scout_frontier',
  scout_travel: 'scout_frontier',
  fleet: 'assemble_escort',
  combat_ship_queue: 'assemble_escort',
  flagship_travel: 'travel_to_battle',
  tactical_combat: 'win_first_battle',
  capture: 'capture_first_system',
  research: 'graduation',
  dyson: 'graduation',
  diplomacy: 'graduation',
  operations: 'graduation',
  wormholes: 'graduation',
  hero_flagships: 'graduation',
  superweapon: 'graduation',
  missions: 'graduation',
  custom_campaign: 'graduation',
});

let sessionOverrideAll = false;

export function setTutorialSessionOverride(enabled) {
  sessionOverrideAll = enabled === true;
  return sessionOverrideAll;
}

export function tutorialSessionOverrideEnabled() {
  return sessionOverrideAll;
}

export function tutorialStepIndex(stepId) {
  return STEP_INDEX.get(stepId) ?? -1;
}

export function isTutorialActive(state) {
  return state?.campaign?.mode === 'tutorial'
    && state?.campaign?.tutorial?.status === 'active';
}

export function tutorialAccess(state, featureId, { bypass = false } = {}) {
  if (bypass || sessionOverrideAll || !isTutorialActive(state)) {
    return { allowed: true, reason: null, unlockStepId: null };
  }
  const unlockStepId = TUTORIAL_FEATURE_UNLOCK_STEP[featureId];
  if (!unlockStepId) return { allowed: true, reason: null, unlockStepId: null };
  const currentStepId = state.campaign.tutorial.currentStepId ?? TUTORIAL_STEP_IDS[0];
  const allowed = tutorialStepIndex(currentStepId) >= tutorialStepIndex(unlockStepId);
  return {
    allowed,
    unlockStepId,
    reason: allowed ? null : `Locked during training — unlocks at ${unlockStepId.replaceAll('_', ' ')}`,
  };
}

export function requireTutorialAccess(state, featureId, opts = {}) {
  const access = tutorialAccess(state, featureId, opts);
  return access.allowed ? { ok: true } : { ok: false, reason: access.reason, tutorialLocked: true };
}

export function tutorialDurationMs(state, normalMs, kind = 'production') {
  if (!isTutorialActive(state)) return normalMs;
  const minimum = kind === 'construction' ? 1200 : 900;
  const multiplier = kind === 'construction' ? 0.08 : 0.06;
  return Math.max(minimum, Math.round(normalMs * multiplier));
}

export function tutorialCaptureHoldMs(state, normalMs) {
  return isTutorialActive(state) ? 5000 : normalMs;
}
