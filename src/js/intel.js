// Scout intel overlay (GDD §9). Intel map is serialized per galaxy; fog is derived.

import { systemById } from './state.js';
import { getGalaxyIntel, getGraph } from './galaxy-scope.js';

export function hasIntel(state, systemId) {
  if (systemId === state.stronghold) return true;
  return !!getGalaxyIntel(state)[systemId];
}

export function gatherIntel(state, systemId) {
  if (!systemById(state, systemId)) return false;
  if (hasIntel(state, systemId)) return false;
  getGalaxyIntel(state)[systemId] = { gatheredAt: state.time };
  return true;
}

export function scoutedCount(state) {
  return Object.keys(getGalaxyIntel(state)).length;
}

export function unscoutedStarIds(state) {
  const graph = getGraph(state);
  if (!graph) return [];
  return graph.stars
    .filter((star) => !hasIntel(state, star.id))
    .map((star) => star.id);
}
