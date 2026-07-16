// Wormhole network travel (Phase 4, GDD §5).

import {
  WORMHOLE_TRANSIT_MS,
  WORMHOLE_HAZARD_CREDIT_COST,
  WORMHOLE_ANCHOR_COST,
} from './constants.js';
import { hashSeed } from './state.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import {
  getActiveGalaxy,
  getGraph,
  getSystems,
  wormholeIdForGalaxy,
  allWormholeIds,
  entitiesInActiveGalaxy,
} from './galaxy-scope.js';
import { dehydrateGalaxy, hydrateGalaxy } from './hydration.js';
import { techEffects } from './tech-web.js';
import { empireStructureEffectValue } from './body-structures.js';

let wormholeJumpCounter = 0;
let wormholeArrivalFx = null;

export const WORMHOLE_ARRIVAL_FX_MS = 1400;

export function wormholePhaseForProgress(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  if (p < 0.2) return 'charging';
  if (p < 0.35) return 'opening';
  if (p < 0.8) return 'transit';
  return 'collapse';
}

export function triggerWormholeArrivalFx(state, arrival) {
  if (!state || !arrival?.toGalaxyId) return null;
  wormholeArrivalFx = {
    galaxyId: arrival.toGalaxyId,
    startedAt: state.time,
    durationMs: WORMHOLE_ARRIVAL_FX_MS,
  };
  return { ...wormholeArrivalFx };
}

export function wormholeVisualState(state, galaxyId = state?.activeGalaxyId) {
  const whId = galaxyId ? wormholeIdForGalaxy(galaxyId) : null;
  const transit = state?.flagship?.wormholeTransit;
  if (transit && transit.fromWh === whId) {
    const status = wormholeTransitStatus(state);
    return {
      phase: status.phase,
      progress: status.progress,
      intensity: status.phase === 'charging' ? 0.25 + status.progress
        : status.phase === 'collapse' ? Math.max(0.15, 1 - status.progress) : 1,
      anchored: !!state.wormholes?.[whId]?.anchor,
    };
  }
  if (wormholeArrivalFx?.galaxyId === galaxyId) {
    const progress = Math.max(0, Math.min(1,
      (state.time - wormholeArrivalFx.startedAt) / wormholeArrivalFx.durationMs));
    if (progress < 1) return { phase: 'arrival', progress, intensity: 1 - progress, anchored: !!state.wormholes?.[whId]?.anchor };
    wormholeArrivalFx = null;
  }
  const anchored = !!state?.wormholes?.[whId]?.anchor;
  return { phase: anchored ? 'anchored' : 'dormant', progress: 0, intensity: anchored ? 0.45 : 0.2, anchored };
}

export function resetWormholeJumpCounter(n = 0, state = null) {
  wormholeJumpCounter = n;
  if (state) state.wormholeJumpCounter = n;
  if (n === 0) wormholeArrivalFx = null;
}

export function canEnterWormhole(state) {
  const f = state.flagship;
  if (!f || f.transit || f.wormholeTransit) return { ok: false, reason: 'Flagship busy' };
  if (f.systemId !== BLACK_HOLE_ID) return { ok: false, reason: 'Must be at galactic core' };
  if (state.systemBattles?.[BLACK_HOLE_ID]?.active) return { ok: false, reason: 'Cannot enter a wormhole during combat' };
  if (f.galaxyId !== state.activeGalaxyId) return { ok: false, reason: 'Wrong galaxy' };
  return { ok: true };
}

export function pickUnanchoredExit(state, fromWhId) {
  const ids = allWormholeIds(state).filter((id) => id !== fromWhId);
  if (ids.length === 0) return fromWhId;
  const counter = Number.isInteger(state.wormholeJumpCounter)
    ? state.wormholeJumpCounter
    : wormholeJumpCounter;
  const idx = hashSeed(state.meta.seed, `wh-jump:${counter}`) % ids.length;
  return ids[idx];
}

export function resolveExitWormhole(state, fromWhId) {
  const wh = state.wormholes[fromWhId];
  if (wh?.anchor) return wh.anchor;
  return pickUnanchoredExit(state, fromWhId);
}

export function wormholeTransitStatus(state) {
  const wt = state.flagship?.wormholeTransit;
  if (!wt) return null;
  const elapsed = state.time - wt.startTime;
  const progress = Math.min(1, elapsed / wt.durationMs);
  return {
    fromWh: wt.fromWh,
    toWh: wt.toWh,
    progress,
    phase: wormholePhaseForProgress(progress),
    etaMs: Math.max(0, wt.durationMs - elapsed),
    complete: elapsed >= wt.durationMs,
  };
}

export function orderWormholeTravel(state, { targetGalaxyId = null, forceAnchored = false } = {}) {
  const check = canEnterWormhole(state);
  if (!check.ok) return check;

  const fromWh = wormholeIdForGalaxy(state.activeGalaxyId);
  let toWh;
  if (targetGalaxyId) {
    toWh = wormholeIdForGalaxy(targetGalaxyId);
    if (!state.wormholes[toWh]) return { ok: false, reason: 'Unknown target galaxy' };
  } else if (forceAnchored && state.wormholes[fromWh]?.anchor) {
    toWh = state.wormholes[fromWh].anchor;
  } else {
    toWh = resolveExitWormhole(state, fromWh);
  }

  if (toWh === fromWh) return { ok: false, reason: 'No valid exit wormhole' };

  const counter = Number.isInteger(state.wormholeJumpCounter)
    ? state.wormholeJumpCounter
    : wormholeJumpCounter;
  wormholeJumpCounter = counter + 1;
  state.wormholeJumpCounter = counter + 1;
  const chargeRate = techEffects(state).wormholeChargeRateMult
    * empireStructureEffectValue(state, 'wormholeChargeRateMult', { base: 1, op: 'mult' });
  const durationMs = Math.max(1000, Math.round(
    WORMHOLE_TRANSIT_MS / Math.max(
      0.1,
      chargeRate * techEffects(state).wormholeTransitMult * techEffects(state).flagshipJumpChargeMult,
    ),
  ));
  state.flagship.wormholeTransit = {
    fromWh,
    toWh,
    startTime: state.time,
    durationMs,
  };
  state.credits = Math.max(0, state.credits - WORMHOLE_HAZARD_CREDIT_COST);

  const targetGal = state.wormholes[toWh]?.galaxyId;
  return { ok: true, fromWh, toWh, targetGalaxyId: targetGal, etaMs: durationMs };
}

export function tickWormholeTransit(state) {
  const wt = state.flagship?.wormholeTransit;
  if (!wt) return null;
  const status = wormholeTransitStatus(state);
  if (!status.complete) return null;

  const toWh = state.wormholes[wt.toWh];
  if (!toWh) {
    state.flagship.wormholeTransit = null;
    return null;
  }

  const fromGalaxyId = state.activeGalaxyId;
  const toGalaxyId = toWh.galaxyId;

  dehydrateGalaxy(state, fromGalaxyId);
  hydrateGalaxy(state, toGalaxyId);

  state.wormholes[wt.fromWh].discovered = true;
  state.wormholes[wt.toWh].discovered = true;

  state.flagship.galaxyId = toGalaxyId;
  state.flagship.systemId = BLACK_HOLE_ID;
  state.flagship.x = 0;
  state.flagship.y = 0;
  state.flagship.vx = 0;
  state.flagship.vy = 0;
  state.flagship.transit = null;
  state.flagship.wormholeTransit = null;

  return {
    fromGalaxyId,
    toGalaxyId,
    fromWh: wt.fromWh,
    toWh: wt.toWh,
  };
}

export function canBuildWormholeAnchor(state) {
  const f = state.flagship;
  if (!f || f.transit || f.wormholeTransit) return { ok: false, reason: 'Flagship busy' };
  if (f.systemId !== BLACK_HOLE_ID) return { ok: false, reason: 'Must be at galactic core' };
  const core = getSystems(state)[BLACK_HOLE_ID];
  if (core?.structures.some((s) => s.type === 'wormhole_anchor')) {
    return { ok: false, reason: 'Anchor already built' };
  }
  const cost = Math.ceil(WORMHOLE_ANCHOR_COST * techEffects(state).anchorCostMult);
  if (state.credits < cost) return { ok: false, reason: `Need ${cost} credits` };
  return { ok: true, cost };
}

export function buildWormholeAnchor(state, targetGalaxyId) {
  const check = canBuildWormholeAnchor(state);
  if (!check.ok) return check;
  if (!targetGalaxyId || !state.galaxies[targetGalaxyId]) {
    return { ok: false, reason: 'Invalid target galaxy' };
  }
  if (targetGalaxyId === state.activeGalaxyId) {
    return { ok: false, reason: 'Cannot anchor to same galaxy' };
  }

  const fromWh = wormholeIdForGalaxy(state.activeGalaxyId);
  const toWh = wormholeIdForGalaxy(targetGalaxyId);
  if (state.wormholes[fromWh]?.anchor) return { ok: false, reason: 'Already anchored' };
  if (state.wormholes[toWh]?.anchor) return { ok: false, reason: 'Target wormhole already anchored' };

  state.credits -= check.cost;
  const core = getSystems(state)[BLACK_HOLE_ID];
  core.structures.push({
    id: `wha-${state.time}`,
    type: 'wormhole_anchor',
    bodyId: null,
    builtAtTime: state.time,
    targetGalaxyId,
  });

  state.wormholes[fromWh].anchor = toWh;
  state.wormholes[toWh].anchor = fromWh;
  state.wormholes[fromWh].anchorOwner = 'player';
  state.wormholes[toWh].anchorOwner = 'player';

  return { ok: true, fromWh, toWh, targetGalaxyId };
}

export function strongholdComposition(state) {
  const home = state.galaxies[state.homeGalaxyId];
  if (!home) return null;
  const sid = home.strongholdStarId;
  const sys = home.systems?.[sid];
  if (!sys) return { galaxyId: home.id, starId: sid, planetCounts: null, moonCounts: [] };

  const counts = { habitable: 0, barren: 0, gas: 0, total: sys.bodies.length };
  const moonCounts = sys.bodies.map((b) => {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
    return b.moons.length;
  });
  return { galaxyId: home.id, starId: sid, planetCounts: counts, moonCounts };
}

export function freezeNonActiveGalaxyEntities(state) {
  const gid = state.activeGalaxyId;
  for (const scout of state.scouts) {
    if (scout.galaxyId !== gid) scout._frozen = true;
  }
  for (const ship of state.playerShips ?? []) {
    if (ship.galaxyId !== gid) ship._frozen = true;
  }
}

export function activeGalaxyScouts(state) {
  return entitiesInActiveGalaxy(state, state.scouts).filter((s) => !s._frozen);
}

export function activeGalaxyShips(state) {
  return entitiesInActiveGalaxy(state, state.playerShips ?? []).filter((s) => !s._frozen);
}

export function activeGalaxyPirates(state) {
  if (!state.pirates?.fleets) return [];
  return state.pirates.fleets.filter((f) => f.galaxyId === state.activeGalaxyId);
}
