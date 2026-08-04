import { TUTORIAL_CURRICULUM_VERSION } from './tutorial-access.js';

export const PROFILE_VERSION = 3;
const BROWSER_PROFILE_KEY = 'gs-profile-v1';

function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    tutorialGraduatedAt: null,
    tutorialCurriculumVersion: TUTORIAL_CURRICULUM_VERSION,
    briefingsSeen: [],
    uiPreferences: {
      pinnedMonitor: null,
      pinnedMonitorCollapsed: false,
    },
    tutorialProgress: {
      foundations: {
        status: 'not_started',
        currentStepId: null,
        completedStepIds: [],
        updatedAt: null,
      },
      coop: {
        status: 'not_started',
        currentStepId: null,
        completedStepIds: [],
        updatedAt: null,
      },
      chapters: {},
    },
  };
}

let profile = defaultProfile();
let loaded = false;
let loadPromise = null;
/** Bumped on every local profile mutation so in-flight reads cannot clobber writes. */
let mutationEpoch = 0;

function notifyProfileChanged() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('gs-profile-changed'));
}

function normalizeProfile(input) {
  const defaults = defaultProfile();
  const incomingProgress = input?.tutorialProgress && typeof input.tutorialProgress === 'object'
    ? input.tutorialProgress
    : {};
  const normalizeCourse = (value, fallback) => {
    const allowed = new Set(['not_started', 'in_progress', 'completed', 'waived']);
    return {
      ...fallback,
      ...(value && typeof value === 'object' ? value : {}),
      status: allowed.has(value?.status) ? value.status : fallback.status,
      completedStepIds: [...new Set(Array.isArray(value?.completedStepIds) ? value.completedStepIds : [])],
      currentStepId: typeof value?.currentStepId === 'string' ? value.currentStepId : null,
      updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
    };
  };
  const merged = {
    ...defaults,
    ...(input && typeof input === 'object' ? input : {}),
    version: PROFILE_VERSION,
    briefingsSeen: [...new Set(Array.isArray(input?.briefingsSeen) ? input.briefingsSeen : [])],
    uiPreferences: {
      pinnedMonitor: ['queue', 'fleet', 'comms'].includes(input?.uiPreferences?.pinnedMonitor)
        ? input.uiPreferences.pinnedMonitor
        : null,
      pinnedMonitorCollapsed: input?.uiPreferences?.pinnedMonitorCollapsed === true,
    },
    tutorialProgress: {
      foundations: normalizeCourse(incomingProgress.foundations, defaults.tutorialProgress.foundations),
      coop: normalizeCourse(incomingProgress.coop, defaults.tutorialProgress.coop),
      chapters: incomingProgress.chapters && typeof incomingProgress.chapters === 'object'
        ? { ...incomingProgress.chapters }
        : {},
    },
  };
  const graduatedAt = merged.tutorialGraduatedAt;
  merged.tutorialGraduatedAt = Number.isFinite(graduatedAt) ? graduatedAt : null;
  if (merged.tutorialGraduatedAt != null
      && !['completed', 'waived'].includes(merged.tutorialProgress.foundations.status)) {
    merged.tutorialProgress.foundations.status = 'completed';
    merged.tutorialProgress.foundations.updatedAt = merged.tutorialGraduatedAt;
  }
  for (const id of merged.briefingsSeen) {
    if (!merged.tutorialProgress.chapters[id]) {
      merged.tutorialProgress.chapters[id] = {
        status: 'completed',
        updatedAt: merged.tutorialGraduatedAt,
      };
    }
  }
  return merged;
}

async function readRawProfile() {
  if (typeof window === 'undefined') return null;
  if (window.gameSave?.readProfile) {
    const result = await window.gameSave.readProfile();
    return result?.ok ? result.profile : null;
  }
  try {
    const raw = localStorage.getItem(BROWSER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function persistProfile() {
  if (typeof window === 'undefined') return { ok: true };
  if (window.gameSave?.writeProfile) return window.gameSave.writeProfile(profile);
  try {
    localStorage.setItem(BROWSER_PROFILE_KEY, JSON.stringify(profile));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

export async function loadProfile({ force = false } = {}) {
  if (loaded && !force) return profile;
  if (loadPromise && !force) return loadPromise;
  const epochAtStart = mutationEpoch;
  loadPromise = readRawProfile().then((raw) => {
    // A graduate/clear landed while this read was in flight — keep the newer memory state.
    if (mutationEpoch !== epochAtStart) {
      loaded = true;
      loadPromise = null;
      return profile;
    }
    profile = normalizeProfile(raw);
    loaded = true;
    loadPromise = null;
    return profile;
  });
  return loadPromise;
}

export function currentProfile() {
  return profile;
}

export function tutorialGraduated() {
  return profile.tutorialGraduatedAt != null
    || ['completed', 'waived'].includes(profile.tutorialProgress?.foundations?.status);
}

export function foundationsStatus() {
  return profile.tutorialProgress?.foundations?.status ?? 'not_started';
}

export function uiPreferences() {
  return {
    pinnedMonitor: profile.uiPreferences?.pinnedMonitor ?? null,
    pinnedMonitorCollapsed: profile.uiPreferences?.pinnedMonitorCollapsed === true,
  };
}

export async function updateUiPreferences(patch = {}) {
  await loadProfile();
  const prior = uiPreferences();
  const requestedMonitor = Object.prototype.hasOwnProperty.call(patch, 'pinnedMonitor')
    ? patch.pinnedMonitor
    : prior.pinnedMonitor;
  if (requestedMonitor != null && !['queue', 'fleet', 'comms'].includes(requestedMonitor)) {
    return { ok: false, reason: 'Invalid pinned monitor', profile };
  }
  mutationEpoch += 1;
  profile.uiPreferences = {
    pinnedMonitor: requestedMonitor ?? null,
    pinnedMonitorCollapsed: Object.prototype.hasOwnProperty.call(patch, 'pinnedMonitorCollapsed')
      ? patch.pinnedMonitorCollapsed === true
      : prior.pinnedMonitorCollapsed,
  };
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  return result?.ok === false ? { ok: false, reason: result.error, profile } : { ok: true, profile };
}

export async function markTutorialGraduated(at = Date.now()) {
  await loadProfile();
  mutationEpoch += 1;
  profile.tutorialGraduatedAt = Number.isFinite(at) ? at : Date.now();
  profile.tutorialCurriculumVersion = TUTORIAL_CURRICULUM_VERSION;
  profile.tutorialProgress.foundations = {
    ...profile.tutorialProgress.foundations,
    status: 'completed',
    currentStepId: null,
    updatedAt: profile.tutorialGraduatedAt,
  };
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  if (result?.ok === false) {
    return { ok: false, reason: result.error ?? 'Failed to save profile', profile };
  }
  return { ok: true, profile };
}

export async function updateTutorialCourseProgress(courseId, {
  status = 'in_progress',
  currentStepId = null,
  completedStepIds = [],
} = {}) {
  await loadProfile();
  if (!['foundations', 'coop'].includes(courseId)) {
    return { ok: false, reason: 'Unknown tutorial course', profile };
  }
  mutationEpoch += 1;
  const prior = profile.tutorialProgress[courseId] ?? {};
  profile.tutorialProgress[courseId] = {
    ...prior,
    status,
    currentStepId,
    completedStepIds: [...new Set(completedStepIds)],
    updatedAt: Date.now(),
  };
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  return result?.ok === false ? { ok: false, reason: result.error, profile } : { ok: true, profile };
}

export async function waiveFoundations(at = Date.now()) {
  await loadProfile();
  mutationEpoch += 1;
  profile.tutorialGraduatedAt = null;
  profile.tutorialCurriculumVersion = TUTORIAL_CURRICULUM_VERSION;
  profile.tutorialProgress.foundations = {
    ...profile.tutorialProgress.foundations,
    status: 'waived',
    currentStepId: null,
    updatedAt: Number.isFinite(at) ? at : Date.now(),
  };
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  return result?.ok === false ? { ok: false, reason: result.error, profile } : { ok: true, profile };
}

export function tutorialChapterStatus(id) {
  return profile.tutorialProgress?.chapters?.[id]?.status ?? 'unseen';
}

export async function setTutorialChapterStatus(id, status) {
  await loadProfile();
  if (!id || !['unseen', 'prompted', 'deferred', 'in_progress', 'completed'].includes(status)) {
    return { ok: false, reason: 'Invalid chapter status', profile };
  }
  mutationEpoch += 1;
  profile.tutorialProgress.chapters[id] = { status, updatedAt: Date.now() };
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  return result?.ok === false ? { ok: false, reason: result.error, profile } : { ok: true, profile };
}

export function hasSeenBriefing(id) {
  return profile.briefingsSeen.includes(id);
}

export async function markBriefingSeen(id) {
  await loadProfile();
  mutationEpoch += 1;
  if (!profile.briefingsSeen.includes(id)) profile.briefingsSeen.push(id);
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  return result?.ok === false ? { ok: false, reason: result.error, profile } : { ok: true, profile };
}

export async function clearTutorialProfile() {
  await loadProfile();
  mutationEpoch += 1;
  profile = defaultProfile();
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  if (result?.ok === false) {
    return { ok: false, reason: result.error ?? 'Failed to clear profile', profile };
  }
  return { ok: true, profile };
}

export function setProfileForTest(next) {
  mutationEpoch += 1;
  profile = normalizeProfile(next);
  loaded = true;
  loadPromise = null;
  return profile;
}
