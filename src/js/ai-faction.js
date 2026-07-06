// AI faction seed + economy + expansion (Phase 5, GDD §12).

import {
  AI_STARTING_CREDITS,
  AI_STARTING_SYSTEMS,
  AI_TICK_INTERVAL_TICKS,
  AI_BUILD_OUTPOST_COST,
  AI_PERSONALITY_NAMES,
  AI_FACTION_COUNT,
  SHIPYARD_COST,
  SCOUT_BUILD_MS,
  TICK_MS,
} from './constants.js';
import { neighborsOf, BLACK_HOLE_ID } from './galaxy.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import {
  createRng,
  hashSeed,
  systemById,
} from './state.js';
import { captureRequirement } from './capture.js';
import { spawnAiShip, aiShipsInSystem, aiCombatPresence, orderAiShipTravel, aiFleetPowerInSystem } from './ai-ships.js';
import { normalizeShipyardBuilds } from './empire-queue.js';

function aiShouldContestPlayerLocal(state) {
  const rel = state.diplomacy?.relations?.['ai-0'];
  if (!rel) return true;
  return rel.status === 'war' || rel.status === 'neutral';
}

function isSuperweaponPanicLocal(state) {
  return state.time < (state.diplomacy?.panicUntil ?? 0);
}

function aiRng(state, tickIndex) {
  return createRng(hashSeed(state.meta.seed, `ai-tick:${tickIndex}`));
}

function rimStars(state) {
  const graph = getGraph(state);
  const maxDist = new Map();
  const start = state.stronghold;
  const queue = [start];
  maxDist.set(start, 0);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of neighborsOf(graph, cur)) {
      if (maxDist.has(next)) continue;
      maxDist.set(next, maxDist.get(cur) + 1);
      queue.push(next);
    }
  }
  let bestDist = 0;
  for (const d of maxDist.values()) bestDist = Math.max(bestDist, d);
  const threshold = Math.max(3, bestDist - 2);
  return graph.stars
    .filter((s) => (maxDist.get(s.id) ?? 0) >= threshold && s.id !== state.stronghold)
    .map((s) => s.id);
}

export function listAiFactions(state) {
  ensureFactions(state);
  return state.factions.list ?? [state.factions.ai];
}

export function ensureFactions(state) {
  if (!state.factions) {
    state.factions = { list: [], ai: null };
  }
  if (!state.factions.list || state.factions.list.length === 0) {
    state.factions.list = [{
      id: 'ai-0',
      name: AI_PERSONALITY_NAMES.expansionist,
      personality: 'expansionist',
      homeSystemId: null,
      credits: AI_STARTING_CREDITS,
      lastActionTick: 0,
    }];
  }
  state.factions.ai = state.factions.list[0];
  if (!state.aiShips) state.aiShips = [];
}

const PERSONALITIES = ['expansionist', 'economic', 'megastructure', 'wormhole'];

export function seedExtraAiFactions(state, galaxyId = state.homeGalaxyId) {
  ensureFactions(state);
  if (state.factions.list.length >= AI_FACTION_COUNT) return { ok: true, count: state.factions.list.length };
  const graph = getGraph(state);
  const rng = createRng(hashSeed(state.meta.seed, 'ai-multi-seed'));
  const candidates = rimStars(state).filter((id) => {
    return !state.factions.list.some((f) => f.homeSystemId === id);
  });

  while (state.factions.list.length < AI_FACTION_COUNT && candidates.length > 0) {
    const idx = Math.floor(rng() * candidates.length);
    const homeSystemId = candidates.splice(idx, 1)[0];
    const personality = PERSONALITIES[state.factions.list.length % PERSONALITIES.length];
    const faction = {
      id: `ai-${state.factions.list.length}`,
      name: AI_PERSONALITY_NAMES[personality] ?? `Faction ${state.factions.list.length}`,
      personality,
      homeSystemId,
      credits: AI_STARTING_CREDITS,
      lastActionTick: 0,
    };
    const system = systemById(state, homeSystemId, galaxyId);
    if (system) {
      system.owner = 'ai';
      const planet = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
      if (planet && !system.structures.some((s) => s.type === 'outpost')) {
        system.structures.push({
          id: `ai-outpost-${homeSystemId}-${faction.id}`,
          type: 'outpost',
          bodyId: planet.id,
          builtAtTime: 0,
        });
      }
    }
    state.factions.list.push(faction);
  }
  return { ok: true, count: state.factions.list.length };
}

export function seedAiFaction(state, galaxyId = state.homeGalaxyId) {
  ensureFactions(state);
  if (state.activeGalaxyId !== galaxyId) return { ok: false, reason: 'Home galaxy must be active to seed AI' };

  const graph = getGraph(state);
  const rng = createRng(hashSeed(state.meta.seed, 'ai-seed'));
  const candidates = rimStars(state);
  if (candidates.length === 0) return { ok: false, reason: 'No rim candidates' };

  const homeSystemId = candidates[Math.floor(rng() * candidates.length)];
  const owned = new Set([homeSystemId]);
  const queue = [homeSystemId];

  while (owned.size < AI_STARTING_SYSTEMS && queue.length) {
    const cur = queue.shift();
    for (const next of neighborsOf(graph, cur)) {
      if (next === state.stronghold || next === BLACK_HOLE_ID) continue;
      if (owned.has(next)) continue;
      const sys = systemById(state, next, galaxyId);
      if (!sys || sys.owner === 'player') continue;
      owned.add(next);
      queue.push(next);
      if (owned.size >= AI_STARTING_SYSTEMS) break;
    }
  }

  for (const sysId of owned) {
    const system = systemById(state, sysId, galaxyId);
    if (!system) continue;
    system.owner = 'ai';
  }

  state.factions.ai.homeSystemId = homeSystemId;
  state.factions.ai.credits = AI_STARTING_CREDITS;
  if (state.factions.list?.[0]) {
    state.factions.list[0].homeSystemId = homeSystemId;
    state.factions.list[0].credits = AI_STARTING_CREDITS;
  }
  seedExtraAiFactions(state, galaxyId);

  // Starting outpost + shipyard on home
  const home = systemById(state, homeSystemId, galaxyId);
  const planet = home?.bodies.find((b) => b.type === 'habitable') ?? home?.bodies[0];
  if (home && planet) {
    if (!home.structures.some((s) => s.type === 'outpost' && s.bodyId === planet.id)) {
      home.structures.push({
        id: 'ai-st-outpost',
        type: 'outpost',
        bodyId: planet.id,
        builtAtTime: 0,
      });
    }
    if (!home.structures.some((s) => s.type === 'shipyard')) {
      home.structures.push({
        id: 'ai-st-shipyard',
        type: 'shipyard',
        bodyId: planet.id,
        builtAtTime: 0,
        builds: [],
      });
    }
  }

  return { ok: true, homeSystemId, owned: [...owned] };
}

function aiOwnedSystems(state) {
  return Object.values(getSystems(state)).filter((s) => s.owner === 'ai').map((s) => s.id);
}

function aiIdleShipyard(state) {
  for (const sysId of aiOwnedSystems(state)) {
    const system = systemById(state, sysId);
    for (const s of system.structures) {
      if (s.type !== 'shipyard') continue;
      normalizeShipyardBuilds(s);
      if (s.builds.length === 0) return { shipyard: s, systemId: sysId, planetId: s.bodyId };
    }
  }
  return null;
}

function systemHasOutpost(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.some((s) => s.type === 'outpost') ?? false;
}

function systemHasShipyard(state, systemId) {
  const system = systemById(state, systemId);
  return system?.structures.some((s) => s.type === 'shipyard') ?? false;
}

function aiBuildOutpost(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || system.owner !== 'ai') return false;
  if (systemHasOutpost(state, systemId)) return false;
  if ((state.factions.ai.credits ?? 0) < AI_BUILD_OUTPOST_COST) return false;
  const planet = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
  if (!planet) return false;
  state.factions.ai.credits -= AI_BUILD_OUTPOST_COST;
  system.structures.push({
    id: `ai-outpost-${systemId}`,
    type: 'outpost',
    bodyId: planet.id,
    builtAtTime: state.time,
  });
  return true;
}

function aiBuildShipyard(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || system.owner !== 'ai') return false;
  if (!systemHasOutpost(state, systemId)) return false;
  if (systemHasShipyard(state, systemId)) return false;
  if ((state.factions.ai.credits ?? 0) < SHIPYARD_COST) return false;
  const planet = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
  if (!planet) return false;
  state.factions.ai.credits -= SHIPYARD_COST;
  system.structures.push({
    id: `ai-yard-${systemId}`,
    type: 'shipyard',
    bodyId: planet.id,
    builtAtTime: state.time,
    builds: [],
  });
  return true;
}

function aiQueueCorvette(state) {
  const yard = aiIdleShipyard(state);
  if (!yard) return false;
  normalizeShipyardBuilds(yard.shipyard);
  yard.shipyard.builds.push({
    hull: 'corvette',
    startedAt: state.time,
    durationMs: SCOUT_BUILD_MS + 4000,
    queueItemId: null,
    ai: true,
  });
  return true;
}

function aiTickShipyardBuilds(state) {
  const spawned = [];
  for (const sysId of aiOwnedSystems(state)) {
    const system = systemById(state, sysId);
    for (const s of system.structures) {
      if (s.type !== 'shipyard') continue;
      normalizeShipyardBuilds(s);
      const remaining = [];
      for (const build of s.builds) {
        const end = build.startedAt + build.durationMs;
        if (state.time < end) {
          remaining.push(build);
          continue;
        }
        const ship = spawnAiShip(state, sysId, build.hull, s.bodyId);
        spawned.push(ship);
      }
      s.builds = remaining;
    }
  }
  return spawned;
}

function adjacentNeutral(state, aiSystemId) {
  const graph = getGraph(state);
  const out = [];
  for (const next of neighborsOf(graph, aiSystemId)) {
    const sys = systemById(state, next);
    if (sys?.owner === 'neutral') out.push(next);
  }
  return out;
}

function adjacentPlayer(state, aiSystemId) {
  const graph = getGraph(state);
  const out = [];
  for (const next of neighborsOf(graph, aiSystemId)) {
    const sys = systemById(state, next);
    if (sys?.owner === 'player') out.push(next);
  }
  return out;
}

export function aiCaptureSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || system.owner !== 'neutral') return false;
  const force = aiCombatPresence(state, systemId);
  if (force < captureRequirement(state, systemId)) return false;
  system.owner = 'ai';
  return true;
}

export function forceAiCapture(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || system.owner === 'player' || systemId === state.stronghold) {
    return { ok: false, reason: 'Cannot force capture' };
  }
  system.owner = 'ai';
  return { ok: true, systemId };
}

function aiDispatchToNeutral(state, rng) {
  const owned = aiOwnedSystems(state);
  if (owned.length === 0) return false;
  const fromId = owned[Math.floor(rng() * owned.length)];
  const targets = adjacentNeutral(state, fromId);
  if (targets.length === 0) return false;
  const targetId = targets[Math.floor(rng() * targets.length)];
  const req = captureRequirement(state, targetId);
  const ships = aiShipsInSystem(state, fromId);
  if (ships.length === 0) return false;
  const power = aiFleetPowerInSystem(state, fromId);
  if (power < req * 10) return false; // rough threshold
  orderAiShipTravel(state, ships[0], targetId);
  return true;
}

function aiDispatchToPlayerBorder(state, rng) {
  if (!aiShouldContestPlayerLocal(state) && !isSuperweaponPanicLocal(state)) return false;
  const owned = aiOwnedSystems(state);
  for (const fromId of owned) {
    const borders = adjacentPlayer(state, fromId);
    if (borders.length === 0) continue;
    const ships = aiShipsInSystem(state, fromId);
    if (ships.length === 0) continue;
    const targetId = borders[Math.floor(rng() * borders.length)];
    orderAiShipTravel(state, ships[0], targetId);
    return true;
  }
  return false;
}

export function tickAiFaction(state) {
  if (state.paused) return [];
  ensureFactions(state);
  const events = [];

  events.push(...aiTickShipyardBuilds(state).map((s) => ({ type: 'ai_ship_spawn', shipId: s.id })));

  // Check arrivals for neutral capture
  for (const sysId of Object.values(getSystems(state)).map((s) => s.id)) {
    if (systemById(state, sysId)?.owner === 'neutral' && aiCombatPresence(state, sysId) > 0) {
      if (aiCaptureSystem(state, sysId)) {
        events.push({ type: 'ai_capture', systemId: sysId });
      }
    }
  }

  const tickIndex = Math.floor(state.time / TICK_MS);
  if (tickIndex % AI_TICK_INTERVAL_TICKS !== 0) return events;

  const rng = aiRng(state, tickIndex);
  state.factions.ai.lastActionTick = tickIndex;

  const actions = [
    () => {
      for (const sysId of aiOwnedSystems(state)) {
        if (aiBuildOutpost(state, sysId)) return true;
      }
      return false;
    },
    () => {
      for (const sysId of aiOwnedSystems(state)) {
        if (aiBuildShipyard(state, sysId)) return true;
      }
      return false;
    },
    () => aiQueueCorvette(state),
    () => aiDispatchToNeutral(state, rng),
    () => aiDispatchToPlayerBorder(state, rng),
  ];

  for (const action of actions) {
    if (action()) break;
  }

  return events;
}

export function aiFactionSummary(state) {
  ensureFactions(state);
  const owned = aiOwnedSystems(state);
  const primary = state.factions.ai;
  return {
    id: primary.id,
    name: primary.name,
    personality: primary.personality,
    homeSystemId: primary.homeSystemId,
    credits: Math.round((primary.credits ?? 0) * 100) / 100,
    ownedSystemCount: owned.length,
    ownedSystems: owned.slice(0, 12),
    fleetCount: (state.aiShips ?? []).filter((s) => s.galaxyId === state.activeGalaxyId).length,
    factionCount: listAiFactions(state).length,
    all: listAiFactions(state).map((f) => ({
      id: f.id,
      name: f.name,
      personality: f.personality,
      homeSystemId: f.homeSystemId,
    })),
  };
}

export function aiOwnedSystemIds(state) {
  return aiOwnedSystems(state);
}
