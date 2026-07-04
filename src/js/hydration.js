// Galaxy hydration / dehydration (Phase 4, GDD §15).

import {
  HOME_SYSTEM_NAME,
} from './constants.js';
import {
  createRng,
  hashSeed,
  generateSystem,
  generateStrongholdSystem,
  createBlackHoleSystem,
  seedNeutralStructures,
} from './state.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import {
  getGalaxy,
  getHomeGalaxy,
  getStrongholdStarId,
} from './galaxy-scope.js';

function systemsSeed(metaSeed, galaxyId) {
  return hashSeed(hashSeed(metaSeed, `galaxy:${galaxyId}`), 'systems');
}

export function generateGalaxySystems(state, galaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (!gal) return {};
  const metaSeed = state.meta.seed;
  const systems = {};
  const homeGalaxyId = state.homeGalaxyId;
  const strongholdStarId = gal.strongholdStarId;

  for (let i = 0; i < gal.graph.stars.length; i++) {
    const star = gal.graph.stars[i];
    const sysRng = createRng((systemsSeed(metaSeed, galaxyId) + (i + 1) * 0x9e3779b9) >>> 0);
    const isStronghold = star.id === strongholdStarId && galaxyId === homeGalaxyId;
    if (isStronghold) {
      systems[star.id] = generateStrongholdSystem(sysRng, star, {
        gameSeed: metaSeed,
        galaxyId,
        renameHome: true,
      });
    } else {
      systems[star.id] = generateSystem(sysRng, star, {
        isHome: false,
        gameSeed: metaSeed,
        galaxyId,
      });
    }
  }
  systems[gal.graph.blackHole.id] = createBlackHoleSystem(gal.graph.blackHole);
  return systems;
}

function snapshotSystemOverlay(system) {
  return {
    owner: system.owner,
    dyson: JSON.parse(JSON.stringify(system.dyson)),
    structures: JSON.parse(JSON.stringify(system.structures)),
  };
}

export function dehydrateGalaxy(state, galaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (!gal || gal.status !== 'active') return { ok: false, reason: 'Galaxy not active' };

  const overlay = {};
  for (const [sysId, system] of Object.entries(gal.systems)) {
    if (sysId === BLACK_HOLE_ID) continue;
    if (system.owner === 'player' || system.structures.length > 0
        || system.dyson.completedShells > 0 || system.dyson.shellSails > 0) {
      overlay[sysId] = snapshotSystemOverlay(system);
    }
  }

  gal.abstract = {
    ...(gal.abstract ?? {}),
    lastTickTime: state.time,
    systemOverlays: overlay,
    intel: { ...(gal.intel ?? {}) },
    capture: { ...(gal.capture ?? {}) },
    ownedSystemCount: Object.values(gal.systems).filter((s) => s.owner === 'player').length,
  };

  gal.systems = {};
  gal.status = 'abstract';
  return { ok: true };
}

function mergeSystemOverlay(base, overlay) {
  if (!overlay) return base;
  base.owner = overlay.owner ?? base.owner;
  base.dyson = { ...base.dyson, ...overlay.dyson };
  base.structures = overlay.structures ?? base.structures;
  return base;
}

export function hydrateGalaxy(state, galaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (!gal) return { ok: false, reason: 'Unknown galaxy' };

  for (const other of Object.values(state.galaxies)) {
    if (other.id !== galaxyId && other.status === 'active') {
      dehydrateGalaxy(state, other.id);
    }
  }

  const overlays = gal.abstract?.systemOverlays ?? {};
  gal.systems = generateGalaxySystems(state, galaxyId);

  for (const [sysId, overlay] of Object.entries(overlays)) {
    if (gal.systems[sysId]) mergeSystemOverlay(gal.systems[sysId], overlay);
  }

  if (gal.abstract?.intel) gal.intel = { ...gal.abstract.intel };
  if (gal.abstract?.capture) gal.capture = { ...gal.abstract.capture };

  gal.status = 'active';
  gal.discovered = true;
  state.activeGalaxyId = galaxyId;

  const wh = state.wormholes?.[`wh-${galaxyId}`];
  if (wh) wh.discovered = true;

  return { ok: true };
}

export function ensureHomeStrongholdNamed(state) {
  const home = getHomeGalaxy(state);
  if (!home?.systems) return;
  const sid = getStrongholdStarId(state);
  const sys = home.systems[sid];
  if (sys) {
    sys.name = HOME_SYSTEM_NAME;
    sys.owner = 'player';
    const star = home.graph.stars.find((s) => s.id === sid);
    if (star) star.name = HOME_SYSTEM_NAME;
  }
}

export function reseedNeutralStructuresForGalaxy(state, galaxyId) {
  const gal = getGalaxy(state, galaxyId);
  if (!gal?.systems) return;
  const seed = state.meta.seed;
  const strongholdId = gal.strongholdStarId;
  for (let i = 0; i < gal.graph.stars.length; i++) {
    const star = gal.graph.stars[i];
    if (star.id === strongholdId && galaxyId === state.homeGalaxyId) continue;
    const sysRng = createRng((systemsSeed(seed, galaxyId) + (i + 1) * 0x9e3779b9 + 0x6e657574) >>> 0);
    const system = gal.systems[star.id];
    if (!system) continue;
    system.structures = system.structures.filter((s) => !s.id.startsWith('nst'));
    seedNeutralStructures(sysRng, system, { isHome: false });
  }
}
