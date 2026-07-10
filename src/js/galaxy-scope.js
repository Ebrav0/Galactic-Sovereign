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

/** Active systems plus durable overlays for every dehydrated galaxy. */
export function persistentSystemRecords(state) {
  if (!state.galaxies) {
    return Object.entries(state.systems ?? {}).map(([systemId, system]) => ({
      galaxyId: state.activeGalaxyId ?? 'gal-0', systemId, system, abstract: false,
    }));
  }
  const records = [];
  for (const [galaxyId, galaxy] of Object.entries(state.galaxies)) {
    const systems = Object.entries(galaxy.systems ?? {});
    if (systems.length > 0) {
      for (const [systemId, system] of systems) records.push({ galaxyId, systemId, system, abstract: false });
      continue;
    }
    for (const [systemId, overlay] of Object.entries(galaxy.abstract?.systemOverlays ?? {})) {
      records.push({
        galaxyId,
        systemId,
        abstract: true,
        system: {
          id: systemId,
          owner: overlay.owner ?? 'neutral',
          factionId: overlay.factionId ?? null,
          structures: overlay.structures ?? [],
          dyson: overlay.dyson ?? {},
          star: overlay.star ?? null,
          bodies: overlay.bodies ?? [],
        },
      });
    }
  }
  return records;
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
