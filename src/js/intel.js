// Scout intel overlay (GDD §9). Intel map is serialized per galaxy; fog is derived.

import { neighborsOf } from './galaxy.js';
import { systemById, isPlayerOwned } from './state.js';
import { getGalaxyIntel, getGraph, getSystems } from './galaxy-scope.js';

const listeningCoverageCache = new WeakMap();

export function invalidateIntelCache(state) {
  listeningCoverageCache.delete(state);
}

function listeningPostCoverage(state) {
  const galaxyId = state.activeGalaxyId;
  const cached = listeningCoverageCache.get(state);
  if (cached && cached.galaxyId === galaxyId && cached.time === state.time) return cached.coverage;

  const graph = getGraph(state);
  const coverage = new Set();
  if (graph) {
    for (const system of Object.values(getSystems(state))) {
      if (!isPlayerOwned(state, system.id)) continue;
      if (!system.structures?.some((s) => s.type === 'listening_post')) continue;
      for (const neighborId of neighborsOf(graph, system.id)) coverage.add(neighborId);
    }
  }
  listeningCoverageCache.set(state, { galaxyId, time: state.time, coverage });
  return coverage;
}

export function hasIntel(state, systemId) {
  if (systemId === state.stronghold) return true;
  if (getGalaxyIntel(state)[systemId]) return true;

  const graph = getGraph(state);
  if (!graph) return false;
  return listeningPostCoverage(state).has(systemId);
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
