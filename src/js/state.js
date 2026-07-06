// Authoritative, serializable game state (IMPLEMENTATION_PLAN §5, save-v6).
// Everything here must survive JSON.stringify/parse round trips.

import {
  STARTING_CREDITS,
  HOME_SYSTEM_NAME,
  PLANET_ORBIT_BASE,
  PLANET_ORBIT_SPACING,
  PLANET_RADIUS_RANGE,
  PLANET_ORBIT_PERIOD_RANGE,
  MOON_ORBIT_BASE,
  MOON_ORBIT_SPACING,
  MOON_RADIUS_RANGE,
  MOON_ORBIT_PERIOD_RANGE,
  DEAD_STAR_CHANCE,
  OTHER_PLANET_COUNT_RANGE,
  FLAGSHIP_SPAWN_ORBIT,
  STRONGHOLD_HABITABLE_COUNT,
  STRONGHOLD_BARREN_COUNT,
  STRONGHOLD_GAS_COUNT,
  STRONGHOLD_MOON_COUNT_RANGE,
  STRONGHOLD_SECONDARY_MOON_COUNT_RANGE,
} from './constants.js';
import { generateGalaxy, BLACK_HOLE_ID } from './galaxy.js';
import { pickStarType, starFieldsFromType } from './star-types.js';
import {
  getGalaxyCount,
  galaxyDisplayName,
  wormholeIdForGalaxy,
  getSystems,
  getGraph,
  getGalaxyIntel,
} from './galaxy-scope.js';
import { createDefaultAbstract } from './abstract-galaxy.js';
import { generateGalaxySystems, hydrateGalaxy } from './hydration.js';

export { BLACK_HOLE_ID };

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

export function hashSeed(baseSeed, key) {
  let h = (baseSeed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createDefaultDyson() {
  return {
    completedShells: 0,
    shellSails: 0,
    foundryStock: 0,
    launcherStock: {},
    lastShellCompletedAt: null,
    launcherLastFireAt: {},
  };
}

const PLANET_NAMES = ['Aurelia', 'Boreas', 'Cinder', 'Dagon', 'Erebus', 'Ferrum', 'Gaia', 'Helios'];
const MOON_SUFFIXES = ['I', 'II', 'III', 'IV', 'V'];
const PLANET_TYPES = ['habitable', 'barren', 'gas'];

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildPlanetBodies(rng, star, gameSeed, typeSlots) {
  const bodies = [];
  for (let i = 0; i < typeSlots.length; i++) {
    const type = typeSlots[i];
    const moonRange = type === 'habitable'
      ? STRONGHOLD_MOON_COUNT_RANGE
      : STRONGHOLD_SECONDARY_MOON_COUNT_RANGE;
    const moonCount = rangeInt(rng, moonRange);
    const moons = [];
    for (let m = 0; m < moonCount; m++) {
      moons.push({
        id: `p${i + 1}m${m + 1}`,
        kind: 'moon',
        name: `${PLANET_NAMES[i % PLANET_NAMES.length]} ${MOON_SUFFIXES[m]}`,
        orbitRadius: MOON_ORBIT_BASE + m * MOON_ORBIT_SPACING,
        orbitPeriodMs: Math.round(range(rng, MOON_ORBIT_PERIOD_RANGE)),
        orbitPhase: rng(),
        radius: range(rng, MOON_RADIUS_RANGE),
        surface: rng() < 0.5 ? 'rocky' : 'ice',
        visualSeed: hashSeed(gameSeed, `${star.id}:p${i + 1}m${m + 1}`),
      });
    }
    bodies.push({
      id: `p${i + 1}`,
      kind: 'planet',
      type,
      name: PLANET_NAMES[i % PLANET_NAMES.length],
      orbitRadius: PLANET_ORBIT_BASE + i * PLANET_ORBIT_SPACING,
      orbitPeriodMs: Math.round(range(rng, PLANET_ORBIT_PERIOD_RANGE)),
      orbitPhase: rng(),
      radius: range(rng, PLANET_RADIUS_RANGE),
      visualSeed: hashSeed(gameSeed, `${star.id}:p${i + 1}`),
      moons,
    });
  }
  return bodies;
}

export function generateStrongholdSystem(rng, star, { gameSeed, galaxyId, renameHome = false }) {
  const typeSlots = [
    ...Array(STRONGHOLD_HABITABLE_COUNT).fill('habitable'),
    ...Array(STRONGHOLD_BARREN_COUNT).fill('barren'),
    ...Array(STRONGHOLD_GAS_COUNT).fill('gas'),
  ];
  shuffleInPlace(typeSlots, rng);

  const typeProfile = pickStarType(rng, { isHome: true, isDead: false });
  const starFields = starFieldsFromType(typeProfile, rng, { isHome: true });

  const system = {
    id: star.id,
    name: renameHome ? HOME_SYSTEM_NAME : star.name,
    owner: 'player',
    star: {
      ...starFields,
      visualSeed: hashSeed(gameSeed, `${galaxyId}:${star.id}:star`),
    },
    bodies: buildPlanetBodies(rng, star, gameSeed, typeSlots),
    structures: [],
    dyson: createDefaultDyson(),
  };
  return system;
}

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

export function generateSystem(rng, star, { isHome, gameSeed, galaxyId = '' }) {
  let planetCount;
  if (isHome) {
    planetCount = rangeInt(rng, [2, 3]);
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
      ? rangeInt(rng, [1, 3])
      : Math.floor(rng() * 3);

    const moons = [];
    for (let m = 0; m < moonCount; m++) {
      moons.push({
        id: `p${i + 1}m${m + 1}`,
        kind: 'moon',
        name: `${PLANET_NAMES[i]} ${MOON_SUFFIXES[m]}`,
        orbitRadius: MOON_ORBIT_BASE + m * MOON_ORBIT_SPACING,
        orbitPeriodMs: Math.round(range(rng, MOON_ORBIT_PERIOD_RANGE)),
        orbitPhase: rng(),
        radius: range(rng, MOON_RADIUS_RANGE),
        surface: rng() < 0.5 ? 'rocky' : 'ice',
        visualSeed: hashSeed(gameSeed, `${galaxyId}:${star.id}:p${i + 1}m${m + 1}`),
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
      visualSeed: hashSeed(gameSeed, `${galaxyId}:${star.id}:p${i + 1}`),
      moons,
    });
  }

  const isDead = planetCount === 0;
  const typeProfile = pickStarType(rng, { isHome, isDead });
  const starFields = starFieldsFromType(typeProfile, rng, { isHome });

  const system = {
    id: star.id,
    name: star.name,
    owner: isHome ? 'player' : 'neutral',
    star: {
      ...starFields,
      visualSeed: hashSeed(gameSeed, `${galaxyId}:${star.id}:star`),
    },
    bodies,
    structures: [],
    dyson: createDefaultDyson(),
  };

  seedNeutralStructures(rng, system, { isHome });
  return system;
}

export function createBlackHoleSystem(blackHole) {
  return {
    id: blackHole.id,
    name: blackHole.name,
    owner: 'neutral',
    star: { radius: 30, color: '#05060c', kind: 'blackhole' },
    bodies: [],
    structures: [],
    dyson: createDefaultDyson(),
  };
}

export function seedNeutralStructuresForGalaxy(state, galaxyId = state.activeGalaxyId) {
  const gal = state.galaxies[galaxyId];
  if (!gal?.systems) return;
  const seed = state.meta.seed;
  for (let i = 0; i < gal.graph.stars.length; i++) {
    const star = gal.graph.stars[i];
    if (star.id === gal.strongholdStarId && galaxyId === state.homeGalaxyId) continue;
    const sysRng = createRng((hashSeed(hashSeed(seed, `galaxy:${galaxyId}`), 'systems')
      + (i + 1) * 0x9e3779b9 + 0x6e657574) >>> 0);
    const system = gal.systems[star.id];
    if (!system) continue;
    system.structures = system.structures.filter((s) => !s.id.startsWith('nst'));
    seedNeutralStructures(sysRng, system, { isHome: false });
  }
}

function buildGalaxyRecord(metaSeed, index) {
  const galId = `gal-${index}`;
  const gSeed = hashSeed(metaSeed, `galaxy:${galId}`);
  const graphRng = createRng(hashSeed(gSeed, 'graph'));
  const pickRng = createRng(hashSeed(gSeed, 'stronghold'));
  const abstractRng = createRng(hashSeed(gSeed, 'abstract-init'));
  const graph = generateGalaxy(graphRng);
  const strongholdStarId = graph.stars[Math.floor(pickRng() * graph.stars.length)].id;

  return {
    id: galId,
    name: galaxyDisplayName(index),
    status: 'abstract',
    graph,
    systems: {},
    intel: {},
    capture: {},
    abstract: index === 0 ? null : createDefaultAbstract(abstractRng),
    strongholdStarId,
    discovered: index === 0,
  };
}

export function createNewGame(seed) {
  const galaxyCount = getGalaxyCount();
  const galaxies = {};
  const wormholes = {};

  for (let g = 0; g < galaxyCount; g++) {
    const galId = `gal-${g}`;
    galaxies[galId] = buildGalaxyRecord(seed, g);
    wormholes[wormholeIdForGalaxy(galId)] = {
      galaxyId: galId,
      anchor: null,
      anchorOwner: null,
      discovered: g === 0,
    };
  }

  const homeGalaxyId = 'gal-0';
  const strongholdStarId = galaxies[homeGalaxyId].strongholdStarId;

  const state = {
    meta: { seed, createdAt: Date.now(), playTimeMs: 0 },
    time: 0,
    credits: STARTING_CREDITS,
    paused: false,
    activeGalaxyId: homeGalaxyId,
    homeGalaxyId,
    stronghold: strongholdStarId,
    galaxies,
    wormholes,
    flagship: {
      galaxyId: homeGalaxyId,
      systemId: strongholdStarId,
      x: 0,
      y: -FLAGSHIP_SPAWN_ORBIT,
      vx: 0,
      vy: 0,
      heading: 0,
      transit: null,
      wormholeTransit: null,
      orbit: null,
    },
    scouts: [],
    playerShips: [],
    battleGroups: [],
    pirates: { fleets: [], pendingRespawn: [] },
    systemBattles: {},
    battleStance: 'balanced',
    solarii: 0,
    solariiUnlocked: false,
    empireQueue: [],
    research: {
      activeNodeId: null,
      progress: 0,
      unlocked: ['eco_baseline'],
      queue: [],
    },
    factions: {
      list: [{
        id: 'ai-0',
        name: 'Dominion of Helix',
        personality: 'expansionist',
        homeSystemId: null,
        credits: 1200,
        lastActionTick: 0,
      }],
      ai: null,
    },
    aiShips: [],
    milestones: {
      completedDysonSystems: [],
      diplomacyUnlocked: false,
      superweaponUnlocked: false,
    },
    campaign: {
      mode: 'sandbox',
      victoryType: 'sandbox',
      defeated: false,
      won: false,
      tutorialStep: null,
      activeMissionId: null,
      completedMissions: [],
      missionProgress: {},
    },
    diplomacy: { relations: {} },
    superweapon: {
      cradleSystemId: null,
      online: false,
      cooldownUntil: 0,
      jumpCooldownUntil: 0,
      lastAction: null,
      shieldCooldowns: {},
      createCount: 0,
    },
    heroFlagships: [],
    manualTradeRoutes: [],
  };

  hydrateGalaxy(state, homeGalaxyId);
  const intel = getGalaxyIntel(state, homeGalaxyId);
  intel[strongholdStarId] = { gatheredAt: 0 };

  return state;
}

/** Sub-tick time for smooth rendering between fixed simulation steps. */
export function displayTime(state, accumulatorMs = 0) {
  return state.time + accumulatorMs;
}

export function bodyAngle(body, time) {
  return 2 * Math.PI * (body.orbitPhase + time / body.orbitPeriodMs);
}

export function planetPosition(planet, time) {
  const a = bodyAngle(planet, time);
  return { x: Math.cos(a) * planet.orbitRadius, y: Math.sin(a) * planet.orbitRadius };
}

export function moonPosition(planet, moon, time) {
  const p = planetPosition(planet, time);
  const a = bodyAngle(moon, time);
  return {
    x: p.x + Math.cos(a) * moon.orbitRadius,
    y: p.y + Math.sin(a) * moon.orbitRadius,
  };
}

export function systemById(state, systemId, galaxyId = state.activeGalaxyId) {
  return getSystems(state, galaxyId)[systemId] ?? null;
}

export function findPlanet(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.bodies.find((b) => b.id === planetId) ?? null;
}

export function findBody(state, systemId, bodyId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  if (!system) return null;
  for (const planet of system.bodies) {
    if (planet.id === bodyId) return { body: planet, planet: null };
    const moon = planet.moons.find((m) => m.id === bodyId);
    if (moon) return { body: moon, planet };
  }
  return null;
}

export function ensureDyson(system) {
  if (!system.dyson) system.dyson = createDefaultDyson();
  if (!system.dyson.launcherStock) system.dyson.launcherStock = {};
  if (!system.dyson.launcherLastFireAt) system.dyson.launcherLastFireAt = {};
  return system.dyson;
}

export function structuresOn(state, systemId, bodyId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system ? system.structures.filter((s) => s.bodyId === bodyId) : [];
}

export function hasOutpost(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, planetId, galaxyId).some((s) => s.type === 'outpost');
}

export function hasShipyard(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, planetId, galaxyId).some((s) => s.type === 'shipyard');
}

export function findShipyardOnPlanet(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, planetId, galaxyId).find((s) => s.type === 'shipyard') ?? null;
}

export function findStructure(state, systemId, structureId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.structures.find((s) => s.id === structureId) ?? null;
}

export function isPlayerOwned(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.owner === 'player';
}

export function isAiOwned(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.owner === 'ai';
}

export function isHostileOwner(owner) {
  return owner === 'ai';
}

export function ownerFaction(owner) {
  if (owner === 'player') return 'player';
  if (owner === 'ai') return 'ai';
  return 'neutral';
}

export function isCapturableTarget(state, systemId, galaxyId = state.activeGalaxyId) {
  if (systemId === BLACK_HOLE_ID) return false;
  return !isPlayerOwned(state, systemId, galaxyId);
}

export function hasFoundry(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.structures.some((s) => s.type === 'sail_foundry') ?? false;
}

export function findFoundry(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.structures.find((s) => s.type === 'sail_foundry') ?? null;
}

/** Planet the sail foundry ring orbits (legacy saves without bodyId use the first habitable world). */
export function foundryHostPlanet(state, systemId, galaxyId = state.activeGalaxyId) {
  const foundry = findFoundry(state, systemId, galaxyId);
  const system = systemById(state, systemId, galaxyId);
  if (!foundry || !system) return null;
  if (foundry.bodyId) {
    return findPlanet(state, systemId, foundry.bodyId, galaxyId);
  }
  return system.bodies.find((p) => p.type === 'habitable') ?? system.bodies[0] ?? null;
}

export function launcherCountOnBody(state, systemId, bodyId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, bodyId, galaxyId).filter((s) => s.type === 'dyson_launcher').length;
}

export function dysonLaunchers(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.structures.filter((s) => s.type === 'dyson_launcher') ?? [];
}

export function dysonSummary(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  if (!system) return null;
  const dyson = ensureDyson(system);
  const launchers = dysonLaunchers(state, systemId, galaxyId);
  return {
    hasFoundry: hasFoundry(state, systemId, galaxyId),
    launcherCount: launchers.length,
    completedShells: dyson.completedShells,
    shellSails: dyson.shellSails,
    foundryStock: dyson.foundryStock,
    launcherStockTotal: launchers.reduce((n, l) => n + (dyson.launcherStock[l.id] ?? 0), 0),
  };
}

export function getActiveGraph(state) {
  return getGraph(state);
}

export { seedNeutralStructures };
