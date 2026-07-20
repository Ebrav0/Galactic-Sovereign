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
  TRADE_NEXUS_COUNT_PER_GALAXY,
  FLAGSHIP_HP,
} from './constants.js';
import { generateGalaxy, BLACK_HOLE_ID } from './galaxy.js';
import {
  STAR_TYPES,
  assignGalaxyStellarCatalog,
  canonicalizeStellarClass,
  pickLegacyStarType,
  pickStarType,
  starFieldsFromType,
  STELLAR_GENERATION_PROFILES,
} from './star-types.js';
import {
  applyBodyCatalogIdentity,
  applyGraphCatalogIdentity,
  applySystemCatalogIdentity,
  catalogLabel,
  starCatalogCode,
} from './catalog-names.js';
import {
  getGalaxyCount,
  galaxyDisplayName,
  wormholeIdForGalaxy,
  getSystems,
  getGraph,
  getGalaxyIntel,
} from './galaxy-scope.js';
import { createTutorialCampaignState } from './tutorial-access.js';
import { createDefaultAbstract } from './abstract-galaxy.js';
import { generateGalaxySystems, hydrateGalaxy, ensureHomeStrongholdNamed } from './hydration.js';
import { createDefaultLogisticsState } from './logistics.js';

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

function weightedChoice(rng, values, weights) {
  const roll = rng();
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += weights[i] ?? 0;
    if (roll < acc) return values[i];
  }
  return values[values.length - 1];
}

function catalogEnvironment(rng, profile) {
  return weightedChoice(rng, ['clear', 'nebula', 'ion_storm', 'debris_field'],
    profile?.environmentWeights ?? [0.77, 0.10, 0.06, 0.07]);
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

  const typeProfile = STAR_TYPES[star.stellarClass] ?? pickStarType(rng, { isHome: true, isDead: false });
  const starFields = starFieldsFromType(typeProfile, rng, { isHome: true });
  const catalogId = starCatalogCode(galaxyId, star);
  const alias = renameHome ? HOME_SYSTEM_NAME : (star.alias ?? star.name);
  const bodies = buildPlanetBodies(rng, star, gameSeed, typeSlots);
  applyBodyCatalogIdentity(bodies, catalogId);

  const system = {
    id: star.id,
    name: catalogLabel(catalogId, alias),
    alias,
    catalogId,
    owner: 'player',
    star: {
      ...starFields,
      visualSeed: hashSeed(gameSeed, `${galaxyId}:${star.id}:star`),
    },
    bodies,
    structures: [],
    dyson: createDefaultDyson(),
  };

  if (star.kind !== 'trade_nexus') {
    const environmentalRoll = rng();
    system.environment = environmentalRoll < 0.1
      ? 'nebula'
      : environmentalRoll < 0.16
        ? 'ion_storm'
        : environmentalRoll < 0.23
          ? 'debris_field'
          : 'clear';
  }
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

export function generateSystem(rng, star, { isHome, gameSeed, galaxyId = '', legacyCatalog = false }) {
  const catalogClass = legacyCatalog ? null : star.stellarClass;
  let typeProfile = catalogClass ? STAR_TYPES[catalogClass] : null;
  const generation = typeProfile ? STELLAR_GENERATION_PROFILES[typeProfile.id] : null;
  let planetCount;
  if (isHome) {
    planetCount = rangeInt(rng, [2, 3]);
  } else if (star.kind === 'trade_nexus') {
    planetCount = rangeInt(rng, [2, 4]);
  } else {
    planetCount = rng() < (legacyCatalog ? DEAD_STAR_CHANCE : (generation?.planetlessChance ?? DEAD_STAR_CHANCE))
      ? 0
      : rangeInt(rng, legacyCatalog ? OTHER_PLANET_COUNT_RANGE : (generation?.planetCount ?? OTHER_PLANET_COUNT_RANGE));
  }
  const habitableIndex = isHome ? Math.floor(rng() * planetCount) : -1;

  const bodies = [];
  for (let i = 0; i < planetCount; i++) {
    const isGuaranteedHabitable = i === habitableIndex;
    const type = isGuaranteedHabitable
      ? 'habitable'
      : legacyCatalog
        ? PLANET_TYPES[Math.floor(rng() * PLANET_TYPES.length)]
        : weightedChoice(rng, PLANET_TYPES, generation?.planetWeights ?? [1 / 3, 1 / 3, 1 / 3]);

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
  // Keep one selection roll in the stream so downstream neutral structures do
  // not depend on whether a graph already carried a canonical class.
  if (legacyCatalog) {
    const baseline = pickLegacyStarType(rng, { isHome, isDead });
    typeProfile = STAR_TYPES[star.stellarOverride] ?? baseline;
  } else if (catalogClass) {
    rng();
  } else {
    typeProfile = pickStarType(rng, { isHome, isDead });
  }
  const starFields = star.kind === 'trade_nexus'
    ? {
      radius: 110,
      color: '#76ddff',
      secondaryColor: '#ffce7a',
      coronaColor: '#9e8cff',
      kind: 'trade_nexus',
      type: 'trade_nexus',
    }
    : starFieldsFromType(typeProfile, rng, { isHome });

  const system = {
    id: star.id,
    name: star.name,
    alias: star.alias ?? star.name,
    catalogId: star.catalogId ?? starCatalogCode(galaxyId, star),
    owner: isHome ? 'player' : 'neutral',
    star: {
      ...starFields,
      visualSeed: hashSeed(gameSeed, `${galaxyId}:${star.id}:star`),
    },
    bodies,
    structures: [],
    dyson: createDefaultDyson(),
  };

  if (star.kind === 'trade_nexus') {
    system.name = star.name;
    system.environment = 'commerce';
    system.tradeAccess = 'open';
    system.dyson.disabled = true;
    system.dyson.disabledReason = 'Trade Nexus systems have no star to enclose';
    system.structures.push({
      id: `nexus-${star.id}`,
      type: 'trade_nexus',
      bodyId: null,
      builtAtTime: 0,
      hp: 2400,
      maxHp: 2400,
      openAccess: true,
    });
  }

  if (star.kind !== 'trade_nexus') {
    if (legacyCatalog) {
      const roll = rng();
      system.environment = roll < 0.1 ? 'nebula' : roll < 0.16 ? 'ion_storm' : roll < 0.23 ? 'debris_field' : 'clear';
    } else {
      system.environment = catalogEnvironment(rng, generation);
    }
  }

  applySystemCatalogIdentity(system, star, galaxyId);

  seedNeutralStructures(rng, system, { isHome });
  return system;
}

export function legacyGeneratedStellarClass(metaSeed, galaxyId, star, index) {
  const base = hashSeed(hashSeed(metaSeed, `galaxy:${galaxyId}`), 'systems');
  const rng = createRng((base + (index + 1) * 0x9e3779b9) >>> 0);
  const generated = generateSystem(rng, { ...star }, {
    isHome: false,
    gameSeed: metaSeed,
    galaxyId,
    legacyCatalog: true,
  });
  return canonicalizeStellarClass(generated.star.type);
}

export function createBlackHoleSystem(blackHole, galaxyId = '') {
  const system = {
    id: blackHole.id,
    name: blackHole.name,
    alias: blackHole.alias ?? blackHole.name,
    catalogId: blackHole.catalogId ?? starCatalogCode(galaxyId, blackHole),
    owner: 'neutral',
    star: { radius: 30, color: '#05060c', kind: 'blackhole' },
    bodies: [],
    structures: [],
    dyson: createDefaultDyson(),
  };
  return applySystemCatalogIdentity(system, blackHole, galaxyId);
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
  markTradeNexusStars(graph, strongholdStarId);
  assignGalaxyStellarCatalog(graph, strongholdStarId, gSeed);
  applyGraphCatalogIdentity(graph, galId);

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

/**
 * Mark a small, deterministic set of star nodes as artificial commerce systems.
 * The first Nexus is the closest eligible node to the regional stronghold; the
 * remaining Nexuses use farthest-point sampling so they form useful trade hubs.
 */
export function markTradeNexusStars(graph, strongholdStarId, count = TRADE_NEXUS_COUNT_PER_GALAXY) {
  const stronghold = graph.stars.find((star) => star.id === strongholdStarId);
  const eligible = graph.stars.filter((star) => star.id !== strongholdStarId && !star.protectedFromNexus);
  if (!stronghold || eligible.length === 0) return [];

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const selected = [];
  const nearest = [...eligible].sort((a, b) => distance(a, stronghold) - distance(b, stronghold)
    || a.id.localeCompare(b.id))[0];
  selected.push(nearest);

  while (selected.length < Math.min(count, eligible.length)) {
    const remaining = eligible.filter((star) => !selected.includes(star));
    let best = null;
    let bestScore = -1;
    for (const star of remaining) {
      const score = Math.min(...selected.map((hub) => distance(star, hub)));
      if (score > bestScore || (score === bestScore && (!best || star.id < best.id))) {
        best = star;
        bestScore = score;
      }
    }
    if (!best) break;
    selected.push(best);
  }

  for (let i = 0; i < selected.length; i++) {
    const star = selected[i];
    star.kind = 'trade_nexus';
    star.tradeNexus = true;
    star.originalName = star.originalName ?? star.name;
    star.name = `${star.originalName} Exchange`;
    star.nexusOrdinal = i + 1;
  }
  return selected.map((star) => star.id);
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
    wormholeJumpCounter: 0,
    flagship: {
      galaxyId: homeGalaxyId,
      systemId: strongholdStarId,
      x: 0,
      y: -FLAGSHIP_SPAWN_ORBIT,
      vx: 0,
      vy: 0,
      heading: 0,
      hp: FLAGSHIP_HP,
      maxHp: FLAGSHIP_HP,
      transit: null,
      wormholeTransit: null,
      orbit: null,
      weapons: [],
      wing: null,
    },
    scouts: [],
    builderDrones: [],
    builderDroneStarterGranted: false,
    playerShips: [],
    battleGroups: [],
    pirates: { fleets: [], pendingRespawn: [] },
    systemBattles: {},
    battleStance: 'balanced',
    combatDoctrine: 'assault',
    combatSettings: {
      controlMode: 'command',
      fleetPriority: 'auto',
      flagshipAutopilot: true,
      advancedTactics: true,
      retreatPolicy: 'doctrine',
    },
    solarii: 0,
    solariiUnlocked: false,
    empireQueue: [],
    research: {
      activeNodeId: null,
      progress: 0,
      unlocked: ['eco_baseline'],
      queue: [],
    },
    aiDifficulty: 'normal',
    factions: {
      list: [{
        id: 'ai-0',
        name: 'Dominion of Helix',
        personality: 'expansionist',
        homeSystemId: null,
        credits: 1200,
        solarii: 0,
        research: {
          activeNodeId: null,
          progress: 0,
          unlocked: ['eco_baseline'],
          queue: [],
        },
        productionQueue: [],
        logistics: null,
        lastActionTick: 0,
      }],
      ai: null,
    },
    aiShips: [],
    constructionJobs: [],
    drones: [],
    builderConstructionOrders: [],
    bulkProductionOrders: [],
    bulkProductionDeliveries: [],
    bulkProductionMeta: {
      nextOrderId: 1,
      nextDeliveryId: 1,
      schedulerCursor: { emergency: 0, high: 0, normal: 0, low: 0 },
    },
    strategicOrders: {
      version: 2,
      campaigns: [],
      templates: [],
      nextCampaignId: 1,
      nextTemplateId: 1,
      lastTickAt: null,
      routeRevision: 0,
      diplomacyRevision: 0,
      threatRevision: 0,
    },
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
      tutorialTargetSystemId: null,
      tutorialCompletedAt: null,
      tutorial: createTutorialCampaignState(),
    },
    diplomacy: {
      version: 3,
      schemaVersion: 3,
      relations: {},
      pairRelations: {},
      contacts: {},
      modifiers: {},
      pairModifiers: {},
      profiles: {},
      favors: [],
      grievances: [],
      transmissions: [],
      callsToArms: [],
      proposals: [],
      agreements: [],
      claims: [],
      wars: [],
      occupations: [],
      council: { resolutions: [], sanctions: [], activeResolutionId: null, lastSessionAt: 0 },
      history: [],
      nextIds: {
        proposal: 1,
        agreement: 1,
        claim: 1,
        war: 1,
        occupation: 1,
        modifier: 1,
        resolution: 1,
        sanction: 1,
        history: 1,
        favor: 1,
        grievance: 1,
        transmission: 1,
        call: 1,
      },
      ai: { lastProposalAt: {} },
      lastTickAt: 0,
      lastStrategicTickAt: 0,
      revision: 0,
      panicUntil: 0,
      helioclastCrisis: { stage: 'dormant', level: 0, severity: 0, startedAt: null, lastEscalatedAt: null, incidents: [] },
    },
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
    mapOverlays: { threat: true, sensor: false, blockade: true },
    logistics: createDefaultLogisticsState(),
    tacticalOrders: {},
    battleReports: [],
    solCommander: {
      version: 1,
      settings: {
        enabled: false,
        providerMode: 'offline',
        model: 'gpt-5.6-sol',
        confirmationRequired: true,
        previewData: true,
        requestLimitPerHour: 12,
        spendingCapUsd: 5,
      },
      history: [],
    },
  };

  hydrateGalaxy(state, homeGalaxyId);
  ensureHomeStrongholdNamed(state);
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

export function isStructureActive(structure) {
  return !structure?.construction;
}

export function hasOutpost(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, planetId, galaxyId).some(
    (s) => s.type === 'outpost' && isStructureActive(s),
  );
}

export function hasShipyard(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, planetId, galaxyId).some(
    (s) => s.type === 'shipyard' && isStructureActive(s),
  );
}

export function findShipyardOnPlanet(state, systemId, planetId, galaxyId = state.activeGalaxyId) {
  return structuresOn(state, systemId, planetId, galaxyId).find(
    (s) => s.type === 'shipyard' && isStructureActive(s),
  ) ?? null;
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
  return system?.structures.some((s) => s.type === 'sail_foundry' && isStructureActive(s)) ?? false;
}

export function findFoundry(state, systemId, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  return system?.structures.find(
    (s) => s.type === 'sail_foundry' && isStructureActive(s),
  ) ?? null;
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
  return system?.structures.filter(
    (s) => s.type === 'dyson_launcher' && isStructureActive(s),
  ) ?? [];
}

export function pendingStructureOnBody(state, systemId, bodyId, structureType, galaxyId = state.activeGalaxyId) {
  const system = systemById(state, systemId, galaxyId);
  if (!system) return null;
  return system.structures.find(
    (s) => s.bodyId === bodyId && s.type === structureType && s.construction,
  ) ?? null;
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
