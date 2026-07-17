// Contextual pause-friendly tips at milestones (Phase 6.39).


const SHOWN = new Set();

export function resetContextualTips() {
  SHOWN.clear();
}

export function maybeShowTip(state, id, message, toastFn) {
  if (SHOWN.has(id)) return false;
  SHOWN.add(id);
  toastFn(message, 'info');
  return true;
}

export function tickContextualTips(state, toastFn) {
  if (!state || state.paused) return;
  if (state.milestones?.diplomacyUnlocked && !SHOWN.has('diplomacy')) {
    maybeShowTip(state, 'diplomacy', 'Diplomacy unlocked — open the Diplomacy tab to offer treaties.', toastFn);
  }
  if (state.milestones?.superweaponUnlocked && !SHOWN.has('superweapon')) {
    maybeShowTip(state, 'superweapon', 'Helioclast unlocked — follow the main path through shipyard build, Online, then Create / Destroy / Jump modes.', toastFn);
  }
  if (state.superweapon?.online && !SHOWN.has('superweapon_online')) {
    maybeShowTip(state, 'superweapon_online', 'Helioclast online — finish live-fire calibration, then manage berth assembly and escorts from Fleet → Helioclast. Strategy modes are a separate tech lane.', toastFn);
  }
}
