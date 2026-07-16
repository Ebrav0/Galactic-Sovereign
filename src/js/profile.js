import { TUTORIAL_CURRICULUM_VERSION } from './tutorial-access.js';

export const PROFILE_VERSION = 1;
const BROWSER_PROFILE_KEY = 'gs-profile-v1';

function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    tutorialGraduatedAt: null,
    tutorialCurriculumVersion: TUTORIAL_CURRICULUM_VERSION,
    briefingsSeen: [],
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
  const merged = {
    ...defaultProfile(),
    ...(input && typeof input === 'object' ? input : {}),
    version: PROFILE_VERSION,
    briefingsSeen: [...new Set(Array.isArray(input?.briefingsSeen) ? input.briefingsSeen : [])],
  };
  const graduatedAt = merged.tutorialGraduatedAt;
  merged.tutorialGraduatedAt = Number.isFinite(graduatedAt) ? graduatedAt : null;
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
  return profile.tutorialGraduatedAt != null;
}

export async function markTutorialGraduated(at = Date.now()) {
  await loadProfile();
  mutationEpoch += 1;
  profile.tutorialGraduatedAt = Number.isFinite(at) ? at : Date.now();
  profile.tutorialCurriculumVersion = TUTORIAL_CURRICULUM_VERSION;
  loaded = true;
  const result = await persistProfile();
  notifyProfileChanged();
  if (result?.ok === false) {
    return { ok: false, reason: result.error ?? 'Failed to save profile', profile };
  }
  return { ok: true, profile };
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
