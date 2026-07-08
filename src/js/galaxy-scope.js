// Active-galaxy accessors (Phase 4). Centralizes multi-galaxy state reads.

import { GALAXY_COUNT } from './constants.js';
import { BLACK_HOLE_ID } from './galaxy.js';

let galaxyCountOverride = null;

export function getGalaxyCount() {
  return galaxyCountOverride ?? GALAXY_COUNT;
}

export function setGalaxyCountForTests(n) {
  galaxyCountOverride = n;
}

export function wormholeIdForGalaxy(galaxyId) {
  return `wh-${galaxyId}`;
}

export function getGalaxy(state, galaxyId) {
  return state.galaxies?.[galaxyId] ?? null;
}

export function getActiveGalaxy(state) {
  return getGalaxy(state, state.activeGalaxyId);
}

export function getHomeGalaxy(state) {
  return getGalaxy(state, state.homeGalaxyId);
}

export function getGraph(state, galaxyId = state.activeGalaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (gal?.graph) return gal.graph;
  return state.galaxy ?? null;
}

export function getSystems(state, galaxyId = state.activeGalaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (gal?.systems) return gal.systems;
  return state.systems ?? {};
}

export function getStrongholdId(state) {
  return state.stronghold;
}

export function getStrongholdStarId(state, galaxyId = state.homeGalaxyId) {
  return getGalaxy(state, galaxyId)?.strongholdStarId ?? state.stronghold;
}

export function getGalaxyIntel(state, galaxyId = state.activeGalaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (!gal) return {};
  if (!gal.intel) gal.intel = {};
  return gal.intel;
}

export function getGalaxyCapture(state, galaxyId = state.activeGalaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (!gal) return {};
  if (!gal.capture) gal.capture = {};
  return gal.capture;
}

export function isGalaxyActive(state, galaxyId) {
  return getGalaxy(state, galaxyId)?.status === 'active';
}

export function hydratedGalaxyCount(state) {
  return Object.values(state.galaxies).filter((g) => g.status === 'active').length;
}

export function allWormholeIds(state) {
  return Object.keys(state.wormholes ?? {});
}

export function wormholeByGalaxyId(state, galaxyId) {
  const id = wormholeIdForGalaxy(galaxyId);
  return state.wormholes?.[id] ?? null;
}

export function entitiesInActiveGalaxy(state, list) {
  return (list ?? []).filter((e) => e.galaxyId === state.activeGalaxyId);
}

export function galaxyDisplayName(index) {
  const names = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return `Spiral ${names[index] ?? index + 1}`;
}

export { BLACK_HOLE_ID };
