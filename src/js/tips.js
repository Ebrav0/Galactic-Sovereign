// Contextual pause-friendly tips at milestones (Phase 6.39).

import { isDiplomacyUnlocked } from './diplomacy.js';

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
    maybeShowTip(state, 'superweapon', 'Superweapon unlocked — research the cradle, then build it at your Stronghold.', toastFn);
  }
  if (state.superweapon?.online && !SHOWN.has('superweapon_online')) {
    maybeShowTip(state, 'superweapon_online', 'Superweapon online — use the galaxy panel or Campaign tab for create/destroy/jump.', toastFn);
  }
  if (isDiplomacyUnlocked(state) && (state.manualTradeRoutes?.length ?? 0) === 0 && !SHOWN.has('trade_routes')) {
    maybeShowTip(state, 'trade_routes', 'Ctrl+click two trade-station systems on the galaxy map to draw a manual route.', toastFn);
  }
}
