// Central tutorial feature gates and tutorial-only pacing modifiers.
// This module intentionally has no imports so gameplay modules can consult it
// without creating dependency cycles.

export const TUTORIAL_CURRICULUM_VERSION = 4;

export const TUTORIAL_STEP_IDS = Object.freeze([
  'establish_stronghold',
  'build_reach',
  'survey_frontier',
  'muster_escort',
  'set_course',
  'win_and_claim',
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
    events: {},
    graduationPending: false,
    completedAt: null,
    replay: false,
  };
}

const STEP_INDEX = new Map(TUTORIAL_STEP_IDS.map((id, index) => [id, index]));

export const TUTORIAL_FEATURE_UNLOCK_STEP = Object.freeze({
  system_view: 'establish_stronghold',
  time_controls: 'establish_stronghold',
  save_load: 'establish_stronghold',
  campaign_help: 'establish_stronghold',
  outpost: 'establish_stronghold',
  logistics: 'establish_stronghold',
  shipyard: 'establish_stronghold',
  scout_queue: 'establish_stronghold',
  galaxy_view: 'establish_stronghold',
  scout_travel: 'establish_stronghold',
  fleet: 'establish_stronghold',
  combat_ship_queue: 'establish_stronghold',
  flagship_travel: 'establish_stronghold',
  tactical_combat: 'establish_stronghold',
  capture: 'establish_stronghold',
  research: 'establish_stronghold',
  dyson: 'establish_stronghold',
  diplomacy: 'establish_stronghold',
  operations: 'establish_stronghold',
  wormholes: 'establish_stronghold',
  hero_flagships: 'establish_stronghold',
  superweapon: 'establish_stronghold',
  missions: 'establish_stronghold',
  custom_campaign: 'establish_stronghold',
});

let sessionOverrideAll = false;

export function setTutorialSessionOverride(enabled) {
  sessionOverrideAll = enabled === true;
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('gs-tutorial-override-changed', {
      detail: { enabled: sessionOverrideAll },
    }));
  }
  return sessionOverrideAll;
}

export function tutorialSessionOverrideEnabled() {
  return sessionOverrideAll;
}

/** Title-menu and campaign-mode unlock: graduated profile or active session bypass. */
export function academyUnlocked(graduated = false) {
  void graduated;
  return true;
}

export function tutorialStepIndex(stepId) {
  return STEP_INDEX.get(stepId) ?? -1;
}

export function isTutorialActive(state) {
  return state?.campaign?.mode === 'tutorial'
    && state?.campaign?.tutorial?.status === 'active';
}

export function tutorialAccess(state, featureId, { bypass = false } = {}) {
  void state;
  void featureId;
  void bypass;
  return { allowed: true, reason: null, unlockStepId: null };
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
