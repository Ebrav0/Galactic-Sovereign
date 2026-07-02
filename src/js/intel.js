// Scout intel overlay (GDD §9). Intel map is serialized; fog is derived.

import { systemById } from './state.js';

export function hasIntel(state, systemId) {
  if (systemId === state.stronghold) return true;
  return !!state.intel[systemId];
}

export function gatherIntel(state, systemId) {
  if (!systemById(state, systemId)) return false;
  if (hasIntel(state, systemId)) return false;
  state.intel[systemId] = { gatheredAt: state.time };
  return true;
}

export function scoutedCount(state) {
  return Object.keys(state.intel).length;
}

export function unscoutedStarIds(state) {
  return state.galaxy.stars
    .filter((star) => !hasIntel(state, star.id))
    .map((star) => star.id);
}
