// Scout intel overlay (GDD §9). Intel map is serialized per galaxy; fog is derived.

import { neighborsOf } from './galaxy.js';
import { systemById, isPlayerOwned } from './state.js';
import { getGalaxyIntel, getGraph, getSystems } from './galaxy-scope.js';
import { listeningPostCount } from './strategic-structures.js';

export function hasIntel(state, systemId) {
  if (systemId === state.stronghold) return true;
  if (getGalaxyIntel(state)[systemId]) return true;

  const graph = getGraph(state);
  if (!graph) return false;

  for (const system of Object.values(getSystems(state))) {
    if (!isPlayerOwned(state, system.id)) continue;
    if (listeningPostCount(state, system.id) <= 0) continue;
    if (neighborsOf(graph, system.id).includes(systemId)) return true;
  }
  return false;
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
