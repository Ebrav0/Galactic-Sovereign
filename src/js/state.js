// Authoritative, serializable game state (IMPLEMENTATION_PLAN §5, save-v2).
// Everything here must survive JSON.stringify/parse round trips.
// Visual-only data (camera, shuttle sprites) must never enter these shapes.

import {
  STARTING_CREDITS,
  HOME_SYSTEM_NAME,
  STAR_RADIUS,
  PLANET_COUNT_RANGE,
  PLANET_ORBIT_BASE,
  PLANET_ORBIT_SPACING,
  PLANET_RADIUS_RANGE,
  PLANET_ORBIT_PERIOD_RANGE,
  MOON_COUNT_RANGE,
  MOON_ORBIT_BASE,
  MOON_ORBIT_SPACING,
  MOON_RADIUS,
  MOON_ORBIT_PERIOD_RANGE,
  DEAD_STAR_CHANCE,
  OTHER_PLANET_COUNT_RANGE,
  FLAGSHIP_SPAWN_ORBIT,
} from './constants.js';
import { generateGalaxy, BLACK_HOLE_ID } from './galaxy.js';

// Mulberry32 — small deterministic PRNG so the same seed always
// generates the same galaxy (GDD §15 determinism requirement).
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rangeInt(rng, [min, max]) {
  return min + Math.floor(rng() * (max - min + 1));
}

function range(rng, [min, max]) {
  return min + rng() * (max - min);
}

const PLANET_NAMES = ['Aurelia', 'Boreas', 'Cinder', 'Dagon', 'Erebus', 'Ferrum'];
const MOON_SUFFIXES = ['I', 'II', 'III', 'IV'];
const PLANET_TYPES = ['habitable', 'barren', 'gas'];
const STAR_COLORS = ['#ffd27a', '#ffb46b', '#ffe9a8', '#9fc7ff', '#ff9d7a', '#cfe3ff'];

// Seed neutral outposts/shipyards on non-home stars for varied capture targets.
function seedNeutralStructures(rng, system, { isHome }) {
  if (isHome) return;
  let nextId = 1;
  for (const planet of system.bodies) {
    if (planet.type !== 'habitable') continue;
    if (rng() < 0.3) {
      system.structures.push({
        id: `nst${nextId++}`,
        type: 'outpost',
        bodyId: planet.id,
        builtAtTime: 0,
      });
      if (rng() < 0.1) {
        system.structures.push({
          id: `nst${nextId++}`,
          type: 'shipyard',
          bodyId: planet.id,
          builtAtTime: 0,
          build: null,
        });
      }
    }
  }
}

// One star system's bodies. The home system guarantees a habitable planet
// with moons so a new game is always playable; other stars roll freely and
// may be dead (0 planets — forward-base material, GDD §4).
function generateSystem(rng, star, { isHome }) {
  let planetCount;
  if (isHome) {
    planetCount = rangeInt(rng, PLANET_COUNT_RANGE);
  } else {
    planetCount = rng() < DEAD_STAR_CHANCE ? 0 : rangeInt(rng, OTHER_PLANET_COUNT_RANGE);
  }
  const habitableIndex = isHome ? Math.floor(rng() * planetCount) : -1;

  const bodies = [];
  for (let i = 0; i < planetCount; i++) {
    const isGuaranteedHabitable = i === habitableIndex;
    const type = isGuaranteedHabitable
      ? 'habitable'
      : PLANET_TYPES[Math.floor(rng() * PLANET_TYPES.length)];

    const moonCount = isGuaranteedHabitable
      ? rangeInt(rng, MOON_COUNT_RANGE)
      : Math.floor(rng() * 3); // 0-2 moons elsewhere

    const moons = [];
    for (let m = 0; m < moonCount; m++) {
      moons.push({
        id: `p${i + 1}m${m + 1}`,
        kind: 'moon',
        name: `${PLANET_NAMES[i]} ${MOON_SUFFIXES[m]}`,
        orbitRadius: MOON_ORBIT_BASE + m * MOON_ORBIT_SPACING,
        orbitPeriodMs: Math.round(range(rng, MOON_ORBIT_PERIOD_RANGE)),
        orbitPhase: rng(),
        radius: MOON_RADIUS,
      });
    }

    bodies.push({
      id: `p${i + 1}`,
      kind: 'planet',
      type,
      name: PLANET_NAMES[i],
      orbitRadius: PLANET_ORBIT_BASE + i * PLANET_ORBIT_SPACING,
      orbitPeriodMs: Math.round(range(rng, PLANET_ORBIT_PERIOD_RANGE)),
      orbitPhase: rng(),
      radius: range(rng, PLANET_RADIUS_RANGE),
      moons,
    });
  }

  const system = {
    id: star.id,
    name: star.name,
    owner: isHome ? 'player' : 'neutral',
    star: {
      radius: isHome ? STAR_RADIUS : Math.round(range(rng, [28, 52])),
      color: isHome ? '#ffd27a' : STAR_COLORS[Math.floor(rng() * STAR_COLORS.length)],
    },
    bodies,
    structures: [],
  };

  seedNeutralStructures(rng, system, { isHome });
  return system;
}

// The galactic core is enterable but hosts no buildable bodies — just the
// black hole and its dormant wormhole (functional wormholes are Phase 4).
function createBlackHoleSystem(blackHole) {
  return {
    id: blackHole.id,
    name: blackHole.name,
    owner: 'neutral',
    star: { radius: 30, color: '#05060c', kind: 'blackhole' },
    bodies: [],
    structures: [],
  };
}

// Re-seed neutral structures on all non-home stars (used by v1→v2 migration).
export function seedNeutralStructuresForGalaxy(state) {
  const seed = state.meta.seed;
  for (let i = 0; i < state.galaxy.stars.length; i++) {
    const star = state.galaxy.stars[i];
    if (star.id === state.stronghold) continue;
    const sysRng = createRng((seed + (i + 1) * 0x9e3779b9 + 0x6e657574) >>> 0);
    const system = state.systems[star.id];
    // Strip prior neutral-seeded structures (keep player-built ones from migration).
    system.structures = system.structures.filter((s) => !s.id.startsWith('nst'));
    seedNeutralStructures(sysRng, system, { isHome: false });
  }
}

export function createNewGame(seed) {
  const rng = createRng(seed);
  const galaxy = generateGalaxy(rng);

  // The Stronghold is a seeded pick; its star adopts the home-system name.
  const strongholdId = galaxy.stars[Math.floor(rng() * galaxy.stars.length)].id;
  const homeStar = galaxy.stars.find((s) => s.id === strongholdId);
  homeStar.name = HOME_SYSTEM_NAME;

  const systems = {};
  for (let i = 0; i < galaxy.stars.length; i++) {
    const star = galaxy.stars[i];
    // Per-star derived seed keeps each system independent of generation order.
    const sysRng = createRng((seed + (i + 1) * 0x9e3779b9) >>> 0);
    systems[star.id] = generateSystem(sysRng, star, { isHome: star.id === strongholdId });
  }
  systems[galaxy.blackHole.id] = createBlackHoleSystem(galaxy.blackHole);

  return {
    meta: {
      seed,
      createdAt: Date.now(),
      playTimeMs: 0,
    },
    time: 0,
    credits: STARTING_CREDITS,
    paused: false,
    stronghold: strongholdId,
    galaxy,
    systems,
    flagship: {
      systemId: strongholdId,
      x: 0,
      y: -FLAGSHIP_SPAWN_ORBIT,
      vx: 0,
      vy: 0,
      heading: 0,
      transit: null,
    },
    scouts: [],
    intel: { [strongholdId]: { gatheredAt: 0 } },
    capture: {},
  };
}

// --- Derived-position helpers (determinism: pure functions of state.time) ---

export function bodyAngle(body, time) {
  return 2 * Math.PI * (body.orbitPhase + time / body.orbitPeriodMs);
}

export function planetPosition(planet, time) {
  const a = bodyAngle(planet, time);
  return {
    x: Math.cos(a) * planet.orbitRadius,
    y: Math.sin(a) * planet.orbitRadius,
  };
}

export function moonPosition(planet, moon, time) {
  const p = planetPosition(planet, time);
  const a = bodyAngle(moon, time);
  return {
    x: p.x + Math.cos(a) * moon.orbitRadius,
    y: p.y + Math.sin(a) * moon.orbitRadius,
  };
}

// --- Lookups (all system-scoped since save-v1) ---

export function systemById(state, systemId) {
  return state.systems[systemId] ?? null;
}

export function findPlanet(state, systemId, planetId) {
  const system = systemById(state, systemId);
  return system?.bodies.find((b) => b.id === planetId) ?? null;
}

export function structuresOn(state, systemId, bodyId) {
  const system = systemById(state, systemId);
  return system ? system.structures.filter((s) => s.bodyId === bodyId) : [];
}

export function hasOutpost(state, systemId, planetId) {
  return structuresOn(state, systemId, planetId).some((s) => s.type === 'outpost');
}

export function hasShipyard(state, systemId, planetId) {
  return structuresOn(state, systemId, planetId).some((s) => s.type === 'shipyard');
}

export function findShipyardOnPlanet(state, systemId, planetId) {
  return structuresOn(state, systemId, planetId).find((s) => s.type === 'shipyard') ?? null;
}

export function findStructure(state, systemId, structureId) {
  const system = systemById(state, systemId);
  return system?.structures.find((s) => s.id === structureId) ?? null;
}

export function isPlayerOwned(state, systemId) {
  const system = systemById(state, systemId);
  return system?.owner === 'player';
}

export function isCapturableTarget(state, systemId) {
  if (systemId === BLACK_HOLE_ID) return false;
  return !isPlayerOwned(state, systemId);
}
