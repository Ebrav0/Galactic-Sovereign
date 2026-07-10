// Hero flagships — mini-flagship fleet anchors (Phase 6, GDD §11).

import {
  HERO_FLAGSHIP_COST_CREDITS,
  HERO_FLAGSHIP_COST_SOLARII,
  HERO_FLAGSHIP_HP,
  HERO_FLAGSHIP_BUILD_MS,
} from './constants.js';
import { hasSuperweaponCradle, ensureSuperweapon } from './superweapon.js';
import { isTechUnlocked } from './tech-web.js';
import { hullStats } from './hull.js';
import { neighborsOf } from './galaxy.js';
import { getGraph } from './galaxy-scope.js';
import { systemById } from './state.js';
import { effectiveLegDurationMs } from './strategic-structures.js';

let nextHeroId = 1;

export function resetHeroFlagshipIds(state) {
  let max = 0;
  for (const h of state.heroFlagships ?? []) {
    const n = parseInt(String(h.id).replace('hero-', ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextHeroId = max + 1;
}

export function ensureHeroFlagships(state) {
  if (!state.heroFlagships) state.heroFlagships = [];
}

export function findHeroFlagship(state, heroId) {
  return (state.heroFlagships ?? []).find((h) => h.id === heroId) ?? null;
}

export function heroesInSystem(state, systemId) {
  return (state.heroFlagships ?? []).filter(
    (h) => h.galaxyId === state.activeGalaxyId && h.systemId === systemId && !h.transit,
  );
}

export function heroInSystem(state, systemId) {
  return heroesInSystem(state, systemId).length > 0;
}

export function canBuildHeroFlagship(state) {
  ensureSuperweapon(state);
  if (!state.superweapon?.online) {
    return { ok: false, reason: 'Superweapon cradle must be online' };
  }
  if (!isTechUnlocked(state, 'hero_hull_unlock')) {
    return { ok: false, reason: 'Research Hero Flagship Protocol first' };
  }
  const cradleId = state.superweapon.cradleSystemId;
  if (!cradleId || !hasSuperweaponCradle(state, cradleId)) {
    return { ok: false, reason: 'No superweapon cradle' };
  }
  if (state.credits < HERO_FLAGSHIP_COST_CREDITS) {
    return { ok: false, reason: `Need ${HERO_FLAGSHIP_COST_CREDITS} credits` };
  }
  if ((state.solarii ?? 0) < HERO_FLAGSHIP_COST_SOLARII) {
    return { ok: false, reason: `Need ${HERO_FLAGSHIP_COST_SOLARII} Solarii` };
  }
  return { ok: true, cradleSystemId: cradleId };
}

export function buildHeroFlagship(state, rallyStarId = null) {
  const check = canBuildHeroFlagship(state);
  if (!check.ok) return check;

  state.credits -= HERO_FLAGSHIP_COST_CREDITS;
  state.solarii -= HERO_FLAGSHIP_COST_SOLARII;
  ensureHeroFlagships(state);

  const hero = {
    id: `hero-${nextHeroId++}`,
    galaxyId: state.activeGalaxyId,
    systemId: check.cradleSystemId,
    x: 120,
    y: -80,
    vx: 0,
    vy: 0,
    heading: 0,
    hp: HERO_FLAGSHIP_HP,
    maxHp: HERO_FLAGSHIP_HP,
    transit: null,
    rallyStarId: rallyStarId ?? state.stronghold,
    buildCompleteAt: state.time + HERO_FLAGSHIP_BUILD_MS,
  };
  state.heroFlagships.push(hero);
  return { ok: true, heroId: hero.id, systemId: hero.systemId };
}

export function spawnHeroFlagshipForTest(state, systemId) {
  ensureHeroFlagships(state);
  const hero = {
    id: `hero-${nextHeroId++}`,
    galaxyId: state.activeGalaxyId,
    systemId,
    x: 100,
    y: -60,
    vx: 0,
    vy: 0,
    heading: 0,
    hp: HERO_FLAGSHIP_HP,
    maxHp: HERO_FLAGSHIP_HP,
    transit: null,
    rallyStarId: state.stronghold,
    buildCompleteAt: state.time,
  };
  state.heroFlagships.push(hero);
  return { ok: true, heroId: hero.id };
}

export function setHeroRally(state, heroId, starId) {
  const hero = findHeroFlagship(state, heroId);
  if (!hero) return { ok: false, reason: 'No such hero flagship' };
  const graph = getGraph(state);
  if (!graph.stars.some((s) => s.id === starId) && starId !== graph.blackHole?.id) {
    return { ok: false, reason: 'Invalid rally star' };
  }
  hero.rallyStarId = starId;
  return { ok: true, heroId, rallyStarId: starId };
}

export function orderHeroTravel(state, heroId, targetStarId) {
  const hero = findHeroFlagship(state, heroId);
  if (!hero || hero.transit) return { ok: false, reason: 'Hero unavailable' };
  if (hero.systemId && state.systemBattles?.[hero.systemId]?.active) {
    return { ok: false, reason: 'Hero flagship is engaged in combat' };
  }
  const graph = getGraph(state);
  const from = hero.systemId;
  if (from === targetStarId) return { ok: false, reason: 'Already there' };
  if (!neighborsOf(graph, from).includes(targetStarId)) {
    return { ok: false, reason: 'Target not adjacent' };
  }
  const stats = hullStats('hero_flagship');
  const legMs = effectiveLegDurationMs(state, graph, from, targetStarId, stats.laneSpeed, 2000);
  hero.transit = {
    fromId: from,
    destId: targetStarId,
    startedAt: state.time,
    legMs,
    path: [from, targetStarId],
    legIndex: 0,
  };
  return { ok: true, etaMs: legMs };
}

export function tickHeroFlagships(state) {
  ensureHeroFlagships(state);
  const arrivals = [];
  for (const hero of state.heroFlagships) {
    if (!hero.transit) continue;
    const t = hero.transit;
    const elapsed = state.time - t.startedAt;
    if (elapsed < t.legMs) continue;
    hero.systemId = t.destId;
    hero.transit = null;
    hero.x = 80;
    hero.y = -100;
    arrivals.push({ heroId: hero.id, systemId: hero.systemId });
  }
  return arrivals;
}

export function heroFlagshipsSummary(state) {
  ensureHeroFlagships(state);
  return (state.heroFlagships ?? [])
    .filter((h) => h.galaxyId === state.activeGalaxyId)
    .map((h) => ({
      id: h.id,
      systemId: h.systemId,
      hp: h.hp,
      maxHp: h.maxHp,
      inTransit: !!h.transit,
      rallyStarId: h.rallyStarId,
      ready: state.time >= (h.buildCompleteAt ?? 0),
    }));
}
