// Abstract simulation for inactive galaxies (Phase 4, GDD §15).

import {
  ABSTRACT_TICK_CREDITS_RATE,
  ABSTRACT_TICK_SOLARII_RATE,
  ABSTRACT_TICK_DYSON_RATE,
  ABSTRACT_TICK_FLEET_RATE,
  TICK_MS,
} from './constants.js';
import { createRng, hashSeed } from './state.js';
import { getGalaxy, allWormholeIds, wormholeIdForGalaxy } from './galaxy-scope.js';

export function createDefaultAbstract(rng) {
  return {
    lastTickTime: 0,
    aiCredits: 500 + Math.floor(rng() * 1500),
    aiSolarii: rng() * 5,
    fleetPower: 10 + Math.floor(rng() * 40),
    dysonShellProgress: rng() * 0.3,
    ownedSystemCount: 3 + Math.floor(rng() * 12),
    wormholeAnchor: null,
    systemOverlays: {},
    intel: {},
    capture: {},
  };
}

function abstractRng(metaSeed, galaxyId, tickIndex) {
  return createRng(hashSeed(metaSeed, `abstract:${galaxyId}:${tickIndex}`));
}

export function tickAbstractGalaxies(state) {
  if (state.paused) return [];
  const tickIndex = Math.floor(state.time / TICK_MS);
  const updates = [];

  for (const gal of Object.values(state.galaxies)) {
    if (gal.status !== 'abstract') continue;
    if (!gal.abstract) gal.abstract = createDefaultAbstract(createRng(hashSeed(state.meta.seed, gal.id)));

    const abs = gal.abstract;
    if (abs.lastTickTime === state.time) continue;

    const rng = abstractRng(state.meta.seed, gal.id, tickIndex);
    abs.aiCredits += ABSTRACT_TICK_CREDITS_RATE * (0.8 + rng() * 0.4);
    abs.aiSolarii += ABSTRACT_TICK_SOLARII_RATE * (0.8 + rng() * 0.4);
    abs.fleetPower += ABSTRACT_TICK_FLEET_RATE * (0.8 + rng() * 0.4);
    abs.dysonShellProgress = Math.min(8, abs.dysonShellProgress + ABSTRACT_TICK_DYSON_RATE);
    abs.lastTickTime = state.time;

    maybeStubAiAnchor(state, gal, rng);
    updates.push({ galaxyId: gal.id, abstract: { ...abs } });
  }
  return updates;
}

function maybeStubAiAnchor(state, gal, rng) {
  if (gal.abstract.wormholeAnchor) return;
  if (rng() > 0.0002) return;
  const candidates = Object.values(state.galaxies)
    .filter((g) => g.id !== gal.id && g.discovered)
    .map((g) => g.id);
  if (candidates.length === 0) return;
  const targetGalaxyId = candidates[Math.floor(rng() * candidates.length)];
  const fromWh = `wh-${gal.id}`;
  const toWh = `wh-${targetGalaxyId}`;
  if (!state.wormholes[fromWh] || !state.wormholes[toWh]) return;
  if (state.wormholes[fromWh].anchor || state.wormholes[toWh].anchor) return;
  state.wormholes[fromWh].anchor = toWh;
  state.wormholes[toWh].anchor = fromWh;
  state.wormholes[fromWh].anchorOwner = 'ai';
  state.wormholes[toWh].anchorOwner = 'ai';
  gal.abstract.wormholeAnchor = { pairedGalaxyId: targetGalaxyId, owner: 'ai' };
}

export function abstractGalaxySummaries(state) {
  return Object.values(state.galaxies)
    .filter((g) => g.status === 'abstract' && g.abstract)
    .map((g) => ({
      galaxyId: g.id,
      name: g.name,
      aiCredits: Math.round(g.abstract.aiCredits * 100) / 100,
      aiSolarii: Math.round(g.abstract.aiSolarii * 1000) / 1000,
      fleetPower: Math.round(g.abstract.fleetPower * 100) / 100,
      dysonShellProgress: Math.round(g.abstract.dysonShellProgress * 1000) / 1000,
      ownedSystemCount: g.abstract.ownedSystemCount,
      aiOwnedCount: g.abstract.aiOwnedCount ?? 0,
      aiFleetPower: g.abstract.aiFleetPower ?? 0,
      hasAnchor: !!g.abstract.wormholeAnchor,
    }));
}

export function wormholeSummary(state) {
  const ids = allWormholeIds(state);
  let anchored = 0;
  let discovered = 0;
  for (const id of ids) {
    const wh = state.wormholes[id];
    if (wh.anchor) anchored++;
    if (wh.discovered) discovered++;
  }
  const activeWh = wormholeIdForGalaxy(state.activeGalaxyId);
  return {
    count: ids.length,
    activeId: activeWh,
    anchored,
    discoveredCount: discovered,
  };
}
