// Save/load: envelope + CRC-32 checksum + slots (IMPLEMENTATION_PLAN §5-6).
// Pure serialize/deserialize plus I/O calls; holds no live state references.

import { SAVE_VERSION, FLAGSHIP_HP } from './constants.js';
import { TECH_NODES, TECH_ID_MIGRATION } from './tech-nodes.js';
import { refreshFlagshipHullFromTech } from './hull.js';
import { ensureSuperweapon } from './superweapon.js';
import {
  createNewGame,
  seedNeutralStructuresForGalaxy,
  createDefaultDyson,
  hashSeed,
  createRng,
  markTradeNexusStars,
  legacyGeneratedStellarClass,
} from './state.js';
import {
  applyStellarCatalog,
  assignGalaxyCatalogNumbers,
  assignGalaxyStellarCatalog,
  assignGalaxyStellarOverrides,
  backfillStarTypes,
  canonicalizeStellarClass,
} from './star-types.js';
import { applyStateCatalogIdentities } from './catalog-names.js';
import { spawnPirateFleets } from './pirates.js';
import { generateGalaxy } from './galaxy.js';
import { createDefaultAbstract } from './abstract-galaxy.js';
import {
  galaxyDisplayName,
  wormholeIdForGalaxy,
  getGalaxyCount,
} from './galaxy-scope.js';
import { generateGalaxySystems } from './hydration.js';
import { seedAiFaction } from './ai-faction.js';
import { ensureStructureCombatFields } from './body-structures.js';
import { defaultWeaponProfileForHull, normalizeCarrierWingState } from './hull.js';
import { initBuilderDrones } from './builder-drones.js';
import { ensureLogisticsState, resetLogisticsIds } from './logistics.js';
import { createSolCommanderState } from './sol-commander.js';
import { allTechNodes } from './tech-web.js';
import { ensureBulkProductionState } from './bulk-production.js';
import { ensureStrategicOrdersState } from './strategic-operations.js';
import { ensureDiplomacy, previewProposal } from './diplomacy.js';
import { ensureCombatSettings } from './combat-autonomy.js';
import { createTutorialCampaignState } from './tutorial-access.js';

export const SLOTS = ['autosave', 'slot-1', 'slot-2', 'slot-3', 'exit-save'];

const CREDENTIAL_FIELD_RE = /^(?:apiKey|openaiKey|encryptedKey|authorization|accessToken|secret|password)$/i;
const CREDENTIAL_VALUE_RE = /\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi;

function persistenceReplacer(key, value) {
  if (CREDENTIAL_FIELD_RE.test(key)) return undefined;
  // Tactical particles and camera cues are session-local presentation state.
  if (key === 'fxEvents') return undefined;
  if (typeof value === 'string') return value.replace(CREDENTIAL_VALUE_RE, '[REDACTED CREDENTIAL]');
  return value;
}

// --- CRC-32 (shared by write and verify) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

// --- Envelope ---

export function serialize(state) {
  // Defensive last boundary: credentials are main-process-only, but a save can
  // never retain one even if an imported mod or console mutation added it.
  const stateJson = JSON.stringify(state, persistenceReplacer);
  return JSON.stringify({
    saveVersion: SAVE_VERSION,
    checksum: crc32(stateJson),
    savedAt: Date.now(),
    state: JSON.parse(stateJson), // deep copy — no live references retained
  });
}

// Version migration chain. Each case upgrades n-1 -> n (IMPLEMENTATION_PLAN §5).
// Runs after checksum verification — the checksum always covers the file as written.
function migrateSave(envelope) {
  let e = envelope;
  if (e.saveVersion === 0) e = migrateV0toV1(e);
  if (e.saveVersion === 1) e = migrateV1toV2(e);
  if (e.saveVersion === 2) e = migrateV2toV3(e);
  if (e.saveVersion === 3) e = migrateV3toV4(e);
  if (e.saveVersion === 4) e = migrateV4toV5(e);
  if (e.saveVersion === 5) e = migrateV5toV6(e);
  if (e.saveVersion === 6) e = migrateV6toV7(e);
  if (e.saveVersion === 7) e = migrateV7toV8(e);
  if (e.saveVersion === 8) e = migrateV8toV9(e);
  if (e.saveVersion === 9) e = migrateV9toV10(e);
  if (e.saveVersion === 10) e = migrateV10toV11(e);
  if (e.saveVersion === 11) e = migrateV11toV12(e);
  if (e.saveVersion === 12) e = migrateV12toV13(e);
  if (e.saveVersion === 13) e = migrateV13toV14(e);
  if (e.saveVersion === 14) e = migrateV14toV15(e);
  if (e.saveVersion === 15) e = migrateV15toV16(e);
  if (e.saveVersion === 16) e = migrateV16toV17(e);
  if (e.saveVersion === 17) e = migrateV17toV18(e);
  if (e.saveVersion === 18) e = migrateV18toV19(e);
  if (e.saveVersion === 19) e = migrateV19toV20(e);
  if (e.saveVersion === 20) e = migrateV20toV21(e);
  if (e.saveVersion === 21) e = migrateV21toV22(e);
  if (e.saveVersion === 22) e = migrateV22toV23(e);
  if (e.saveVersion === 23) e = migrateV23toV24(e);
  if (e.saveVersion === 24) e = migrateV24toV25(e);
  return e;
}

// --- Legacy save helpers (v1–v5 flat layout vs v6 galaxies) ---

function legacyGraph(state) {
  return state.galaxies?.['gal-0']?.graph ?? state.galaxy;
}

function legacySystems(state) {
  return state.galaxies?.['gal-0']?.systems ?? state.systems;
}

function legacyIntel(state) {
  if (state.galaxies?.['gal-0']) {
    if (!state.galaxies['gal-0'].intel) state.galaxies['gal-0'].intel = {};
    return state.galaxies['gal-0'].intel;
  }
  if (!state.intel) state.intel = {};
  return state.intel;
}

function legacyCapture(state) {
  if (state.galaxies?.['gal-0']) {
    if (!state.galaxies['gal-0'].capture) state.galaxies['gal-0'].capture = {};
    return state.galaxies['gal-0'].capture;
  }
  if (!state.capture) state.capture = {};
  return state.capture;
}

// v0 (single home system) -> v1 (galaxy + multi-system + flagship).
function migrateV0toV1(envelope) {
  const old = envelope.state;
  const fresh = createNewGame(old.meta.seed);

  fresh.meta = old.meta;
  fresh.time = old.time;
  fresh.credits = old.credits;
  fresh.paused = old.paused;

  const strongholdId = fresh.stronghold;
  const oldSystem = old.system;
  oldSystem.id = strongholdId;
  oldSystem.owner = 'player';
  fresh.galaxies['gal-0'].systems[strongholdId] = oldSystem;
  fresh.galaxies['gal-0'].graph.stars.find((s) => s.id === strongholdId).name = oldSystem.name;
  fresh.galaxies['gal-0'].intel = { [strongholdId]: { gatheredAt: 0 } };

  fresh.scouts = [];
  fresh.galaxies['gal-0'].capture = {};

  const stateJson = JSON.stringify(fresh);
  return {
    saveVersion: 1,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state: fresh,
  };
}

// v1 -> v2 (ownership, scouts, intel, capture, neutral seeding, shipyard build slots).
function migrateV1toV2(envelope) {
  const state = envelope.state;
  const graph = legacyGraph(state);
  const systems = legacySystems(state);
  const intel = legacyIntel(state);
  const capture = legacyCapture(state);

  for (const star of graph.stars) {
    const system = systems[star.id];
    if (!system) continue;
    system.owner = star.id === state.stronghold ? 'player' : 'neutral';
    for (const s of system.structures) {
      if (s.type === 'shipyard' && s.build === undefined) s.build = null;
    }
  }
  const core = systems[graph.blackHole.id];
  if (core) core.owner = 'neutral';

  state.scouts = state.scouts ?? [];
  if (!intel[state.stronghold]) intel[state.stronghold] = { gatheredAt: 0 };
  if (!capture) { /* capture initialized by legacyCapture */ }

  seedNeutralStructuresForGalaxy(state, state.galaxies ? 'gal-0' : state.activeGalaxyId ?? 'gal-0');

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 2,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v2 -> v3 (star.type backfill for cinematic multi-type stars).
function migrateV2toV3(envelope) {
  const state = envelope.state;
  backfillStarTypes(state);

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 3,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v3 -> v4 (combat: playerShips, pirates, systemBattles, battleStance).
function migrateV3toV4(envelope) {
  const state = envelope.state;

  state.playerShips = state.playerShips ?? [];
  state.systemBattles = state.systemBattles ?? {};
  state.battleStance = state.battleStance ?? 'balanced';

  if (!state.pirates?.fleets?.length) {
    state.pirates = spawnPirateFleets(state);
  } else {
    state.pirates.pendingRespawn = state.pirates.pendingRespawn ?? [];
  }

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 4,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v4 -> v5 (Dyson loop: solarii, per-system dyson state).
function migrateV4toV5(envelope) {
  const state = envelope.state;

  state.solarii = state.solarii ?? 0;
  state.solariiUnlocked = state.solariiUnlocked ?? false;

  for (const system of Object.values(legacySystems(state))) {
    if (!system.dyson) system.dyson = createDefaultDyson();
    else {
      system.dyson.launcherStock = system.dyson.launcherStock ?? {};
      system.dyson.launcherLastFireAt = system.dyson.launcherLastFireAt ?? {};
      system.dyson.completedShells = system.dyson.completedShells ?? 0;
      system.dyson.shellSails = system.dyson.shellSails ?? 0;
      system.dyson.foundryStock = system.dyson.foundryStock ?? 0;
      system.dyson.lastShellCompletedAt = system.dyson.lastShellCompletedAt ?? null;
    }
  }

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 5,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v5 -> v6 (multi-galaxy, wormholes, abstract galaxies).
function migrateV5toV6(envelope) {
  const state = envelope.state;
  if (state.galaxies && state.wormholes && state.activeGalaxyId) {
    const stateJson = JSON.stringify(state);
    return {
      saveVersion: 6,
      checksum: crc32(stateJson),
      savedAt: envelope.savedAt,
      state,
    };
  }

  const metaSeed = state.meta.seed;
  const galaxyCount = getGalaxyCount();
  const galaxies = {};
  const wormholes = {};

  galaxies['gal-0'] = {
    id: 'gal-0',
    name: galaxyDisplayName(0),
    status: 'active',
    graph: state.galaxy,
    systems: state.systems,
    intel: state.intel ?? { [state.stronghold]: { gatheredAt: 0 } },
    capture: state.capture ?? {},
    abstract: null,
    strongholdStarId: state.stronghold,
    discovered: true,
  };

  for (let g = 1; g < galaxyCount; g++) {
    const galId = `gal-${g}`;
    const gSeed = hashSeed(metaSeed, `galaxy:${galId}`);
    const graphRng = createRng(hashSeed(gSeed, 'graph'));
    const pickRng = createRng(hashSeed(gSeed, 'stronghold'));
    const abstractRng = createRng(hashSeed(gSeed, 'abstract-init'));
    const graph = generateGalaxy(graphRng);
    galaxies[galId] = {
      id: galId,
      name: galaxyDisplayName(g),
      status: 'abstract',
      graph,
      systems: {},
      intel: {},
      capture: {},
      abstract: createDefaultAbstract(abstractRng),
      strongholdStarId: graph.stars[Math.floor(pickRng() * graph.stars.length)].id,
      discovered: false,
    };
  }

  for (let g = 0; g < galaxyCount; g++) {
    const galId = `gal-${g}`;
    wormholes[wormholeIdForGalaxy(galId)] = {
      galaxyId: galId,
      anchor: null,
      anchorOwner: null,
      discovered: g === 0,
    };
  }

  state.activeGalaxyId = 'gal-0';
  state.homeGalaxyId = 'gal-0';
  state.galaxies = galaxies;
  state.wormholes = wormholes;
  delete state.galaxy;
  delete state.systems;
  delete state.intel;
  delete state.capture;

  state.flagship.galaxyId = state.flagship.galaxyId ?? 'gal-0';
  state.flagship.wormholeTransit = state.flagship.wormholeTransit ?? null;

  for (const scout of state.scouts ?? []) {
    scout.galaxyId = scout.galaxyId ?? 'gal-0';
  }
  for (const ship of state.playerShips ?? []) {
    ship.galaxyId = ship.galaxyId ?? 'gal-0';
  }
  for (const fleet of state.pirates?.fleets ?? []) {
    fleet.galaxyId = fleet.galaxyId ?? 'gal-0';
  }

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 6,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

function initPhase5State(state) {
  state.empireQueue = state.empireQueue ?? [];
  state.research = state.research ?? {
    activeNodeId: null,
    progress: 0,
    unlocked: ['eco_baseline'],
    queue: [],
  };
  if (!state.research.unlocked?.includes('eco_baseline')) {
    state.research.unlocked = ['eco_baseline', ...(state.research.unlocked ?? [])];
  }
  state.factions = state.factions ?? {
    ai: {
      id: 'ai-0',
      name: 'Dominion of Helix',
      personality: 'expansionist',
      homeSystemId: null,
      credits: 1200,
      lastActionTick: 0,
    },
  };
  state.aiShips = state.aiShips ?? [];
}

function migrateShipyardsOnLoad(state) {
  for (const gal of Object.values(state.galaxies ?? {})) {
    for (const system of Object.values(gal.systems ?? {})) {
      for (const s of system.structures ?? []) {
        if (s.type === 'shipyard' && s.build && !s.builds) {
          s.builds = [s.build];
          delete s.build;
        }
        if (s.type === 'shipyard' && !s.builds) s.builds = [];
      }
    }
  }
}

// v6 -> v7 (Phase 5 empire layer).
function migrateV6toV7(envelope) {
  const state = envelope.state;
  initPhase5State(state);
  migrateShipyardsOnLoad(state);

  const homeGal = state.galaxies?.[state.homeGalaxyId ?? 'gal-0'];
  const hasAi = homeGal?.systems && Object.values(homeGal.systems).some((s) => s.owner === 'ai');
  if (!hasAi && homeGal?.status === 'active' && homeGal.systems) {
    seedAiFaction(state, state.homeGalaxyId ?? 'gal-0');
  }

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 7,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v7 -> v8 (player battle groups).
function migrateV7toV8(envelope) {
  const state = envelope.state;
  state.battleGroups = state.battleGroups ?? [];
  initConstructionDroneState(state);

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 8,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

function initConstructionDroneState(state) {
  state.constructionJobs = state.constructionJobs ?? [];
  state.drones = state.drones ?? [];
  migrateShipyardsOnLoad(state);
}

function initPhase6State(state) {
  initConstructionDroneState(state);
  state.milestones = state.milestones ?? {
    completedDysonSystems: [],
    diplomacyUnlocked: false,
    superweaponUnlocked: false,
  };
  state.campaign = state.campaign ?? {
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
  };
  state.campaign.tutorialTargetSystemId ??= null;
  state.campaign.tutorialCompletedAt ??= null;
  state.campaign.tutorial ??= createTutorialCampaignState();
  state.diplomacy = state.diplomacy ?? { relations: {} };
  state.superweapon = state.superweapon ?? {
    cradleSystemId: null,
    online: false,
    cooldownUntil: 0,
    jumpCooldownUntil: 0,
    lastAction: null,
    shieldCooldowns: {},
    createCount: 0,
  };
  state.heroFlagships = state.heroFlagships ?? [];
  if (!state.factions?.list) {
    state.factions = state.factions ?? {};
    if (state.factions.ai) {
      state.factions.list = [state.factions.ai];
    } else {
      state.factions.list = [{
        id: 'ai-0',
        name: 'Dominion of Helix',
        personality: 'expansionist',
        homeSystemId: null,
        credits: 1200,
        lastActionTick: 0,
      }];
    }
    state.factions.ai = state.factions.list[0];
  }
}

// v8 -> v9 (Phase 6 late game).
function migrateV8toV9(envelope) {
  const state = envelope.state;
  initPhase6State(state);

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 9,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

function initPostPhase6BuildingsAndCombat(state) {
  for (const gal of Object.values(state.galaxies ?? {})) {
    for (const system of Object.values(gal.systems ?? {})) {
      system.environment = system.environment ?? (system.star?.kind === 'trade_nexus' ? 'commerce' : 'clear');
      for (const structure of system.structures ?? []) {
        ensureStructureCombatFields(state, system.id, structure);
      }
    }
  }

  for (const ship of state.playerShips ?? []) {
    ship.weaponProfile = ship.weaponProfile ?? defaultWeaponProfileForHull(ship.hull);
    normalizeCarrierWingState(ship, state);
  }
  for (const ship of state.aiShips ?? []) {
    ship.weaponProfile = ship.weaponProfile ?? defaultWeaponProfileForHull(ship.hull);
    normalizeCarrierWingState(ship, state);
  }
  for (const fleet of state.pirates?.fleets ?? []) {
    for (const ship of fleet.ships ?? []) {
      ship.weaponProfile = ship.weaponProfile ?? defaultWeaponProfileForHull(ship.hull);
      normalizeCarrierWingState(ship, state);
    }
  }
}

// v9 -> v10 (post-Phase-6 buildings, carrier wings, weapon profiles).
function migrateV9toV10(envelope) {
  const state = envelope.state;
  initPhase6State(state);
  initPostPhase6BuildingsAndCombat(state);

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 10,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v10 -> v11 (galaxy performance hooks, map fleet selection, builder drones).
function migrateV10toV11(envelope) {
  const state = envelope.state;
  initPhase6State(state);
  initPostPhase6BuildingsAndCombat(state);
  initBuilderDrones(state);

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 11,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

function nexusStarFields(system, seed, galaxyId) {
  return {
    radius: 110,
    color: '#76ddff',
    secondaryColor: '#ffce7a',
    coronaColor: '#9e8cff',
    kind: 'trade_nexus',
    type: 'trade_nexus',
    visualSeed: system.star?.visualSeed ?? hashSeed(seed, `${galaxyId}:${system.id}:trade-nexus`),
  };
}

function prepareV12Galaxy(state, galaxy) {
  const activeSystems = galaxy.systems ?? {};
  const overlays = galaxy.abstract?.systemOverlays ?? {};
  for (const star of galaxy.graph?.stars ?? []) {
    const system = activeSystems[star.id];
    const overlay = overlays[star.id];
    const dyson = system?.dyson ?? overlay?.dyson;
    const structures = system?.structures ?? overlay?.structures ?? [];
    if ((dyson?.completedShells ?? 0) > 0 || (dyson?.shellSails ?? 0) > 0
        || structures.some((structure) => ['sail_foundry', 'dyson_launcher', 'helioclast_shipyard', 'superweapon_cradle'].includes(structure.type))) {
      star.protectedFromNexus = true;
    }
  }
  markTradeNexusStars(galaxy.graph, galaxy.strongholdStarId);

  for (const star of galaxy.graph?.stars ?? []) {
    delete star.protectedFromNexus;
    const system = activeSystems[star.id];
    const overlay = overlays[star.id];
    if (!system && overlay) {
      overlay.structures = Array.isArray(overlay.structures) ? overlay.structures : [];
      for (const structure of overlay.structures) {
        if (structure.type === 'trade_station') {
          structure.type = 'export_depot';
          structure.bodyId = null;
          structure.hp = structure.hp ?? 520;
          structure.maxHp = structure.maxHp ?? 520;
          structure.operational = structure.operational !== false;
        }
      }
      if (star.kind === 'trade_nexus') {
        overlay.dyson = { ...createDefaultDyson(), disabled: true, disabledReason: 'Trade Nexus systems have no star to enclose' };
        if (!overlay.structures.some((structure) => structure.type === 'trade_nexus')) {
          overlay.structures.push({
            id: `nexus-${star.id}`,
            type: 'trade_nexus',
            bodyId: null,
            builtAtTime: 0,
            hp: 2400,
            maxHp: 2400,
            openAccess: true,
          });
        }
      } else if (overlay.owner === 'player'
        && overlay.structures.some((structure) => structure.type === 'outpost')
        && !overlay.structures.some((structure) => structure.type === 'export_depot')) {
        overlay.structures.push({
          id: `depot-v12-${galaxy.id}-${star.id}`,
          type: 'export_depot',
          bodyId: null,
          builtAtTime: state.time,
          hp: 520,
          maxHp: 520,
          operational: true,
        });
      }
      continue;
    }
    if (!system) continue;
    if (star.kind === 'trade_nexus') {
      system.name = star.name;
      system.star = nexusStarFields(system, state.meta.seed, galaxy.id);
      system.environment = 'commerce';
      system.tradeAccess = 'open';
      system.dyson = { ...createDefaultDyson(), disabled: true, disabledReason: 'Trade Nexus systems have no star to enclose' };
      if (!system.structures.some((structure) => structure.type === 'trade_nexus')) {
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
    }

    for (const structure of system.structures ?? []) {
      if (structure.type === 'trade_station') {
        structure.type = 'export_depot';
        structure.bodyId = null;
        structure.hp = structure.hp ?? 520;
        structure.maxHp = structure.maxHp ?? 520;
        structure.operational = structure.operational !== false;
      }
    }
    const developed = system.owner === 'player'
      && system.star?.kind !== 'trade_nexus'
      && system.structures.some((structure) => structure.type === 'outpost');
    if (developed && !system.structures.some((structure) => structure.type === 'export_depot')) {
      system.structures.push({
        id: `depot-v12-${galaxy.id}-${system.id}`,
        type: 'export_depot',
        bodyId: null,
        builtAtTime: state.time,
        hp: 520,
        maxHp: 520,
        operational: true,
      });
    }
  }
}

// v11 -> v12 (physical logistics, tactical orders/reports, Sol preferences).
function migrateV11toV12(envelope) {
  const state = envelope.state;
  initPhase6State(state);
  initPostPhase6BuildingsAndCombat(state);
  initBuilderDrones(state);
  for (const galaxy of Object.values(state.galaxies ?? {})) prepareV12Galaxy(state, galaxy);
  ensureLogisticsState(state);
  resetLogisticsIds(state);
  state.tacticalOrders = state.tacticalOrders ?? {};
  state.battleReports = Array.isArray(state.battleReports) ? state.battleReports : [];
  state.mapOverlays = { threat: true, sensor: false, blockade: true, ...(state.mapOverlays ?? {}) };
  state.solCommander = state.solCommander?.settings && Array.isArray(state.solCommander.history)
    ? state.solCommander
    : createSolCommanderState();
  if (state.flagship) {
    state.flagship.hp = state.flagship.hp ?? FLAGSHIP_HP;
    state.flagship.maxHp = state.flagship.maxHp ?? FLAGSHIP_HP;
  }

  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 12,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

const V13_PERSONALITY_CLUSTER_ORDER = {
  expansionist: ['military', 'economy', 'wormhole', 'research', 'trade', 'megastructure', 'flagship', 'diplomacy', 'superweapon'],
  economic: ['economy', 'trade', 'research', 'megastructure', 'diplomacy', 'military', 'wormhole', 'flagship', 'superweapon'],
  megastructure: ['megastructure', 'research', 'economy', 'trade', 'military', 'wormhole', 'diplomacy', 'flagship', 'superweapon'],
  wormhole: ['wormhole', 'military', 'research', 'trade', 'economy', 'megastructure', 'flagship', 'diplomacy', 'superweapon'],
};

function v13FactionResearchState(faction) {
  faction.solarii = Number.isFinite(faction.solarii) ? faction.solarii : 0;
  faction.research = faction.research ?? {
    activeNodeId: null,
    progress: 0,
    unlocked: ['eco_baseline'],
    queue: [],
  };
  faction.research.activeNodeId ??= null;
  faction.research.progress = Number.isFinite(faction.research.progress) ? faction.research.progress : 0;
  faction.research.unlocked = Array.isArray(faction.research.unlocked)
    ? [...new Set(['eco_baseline', ...faction.research.unlocked])]
    : ['eco_baseline'];
  faction.research.queue = Array.isArray(faction.research.queue) ? faction.research.queue : [];
  faction.productionQueue = Array.isArray(faction.productionQueue) ? faction.productionQueue : [];
  faction.logistics = faction.logistics ?? null;
  return faction.research;
}

function backfillFactionResearch(state, faction, budget) {
  const research = v13FactionResearchState(faction);
  const unlocked = new Set(research.unlocked);
  const clusterOrder = V13_PERSONALITY_CLUSTER_ORDER[faction.personality]
    ?? V13_PERSONALITY_CLUSTER_ORDER.expansionist;
  const clusterRank = new Map(clusterOrder.map((cluster, index) => [cluster, index]));
  const nodes = allTechNodes();
  let remaining = Math.max(0, budget - Math.max(0, unlocked.size - 1));
  while (remaining > 0) {
    const candidates = nodes.filter((node) => {
      if (unlocked.has(node.id) || node.id === 'eco_baseline') return false;
      if (node.requiresDiplomacy && !state.milestones?.diplomacyUnlocked) return false;
      if (node.requiresSuperweapon && !state.milestones?.superweaponUnlocked) return false;
      return (node.prereqs ?? []).every((id) => unlocked.has(id));
    });
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      const clusterDelta = (clusterRank.get(a.cluster) ?? 99) - (clusterRank.get(b.cluster) ?? 99);
      if (clusterDelta !== 0) return clusterDelta;
      const costDelta = (a.creditCost ?? 0) - (b.creditCost ?? 0);
      return costDelta !== 0 ? costDelta : a.id.localeCompare(b.id);
    });
    unlocked.add(candidates[0].id);
    remaining -= 1;
  }
  research.unlocked = [...unlocked];
}

function graphDistances(graph, sourceId) {
  const adjacency = new Map();
  for (const star of graph?.stars ?? []) adjacency.set(star.id, []);
  for (const lane of graph?.lanes ?? []) {
    const a = lane.a ?? lane[0];
    const b = lane.b ?? lane[1];
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  const distance = new Map([[sourceId, 0]]);
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, distance.get(current) + 1);
      queue.push(next);
    }
  }
  return distance;
}

function assignV13FactionIds(state) {
  const factions = state.factions?.list ?? [];
  if (!factions.length) return;
  for (const galaxy of Object.values(state.galaxies ?? {})) {
    const homes = factions
      .filter((faction) => galaxy.graph?.stars?.some((star) => star.id === faction.homeSystemId))
      .map((faction) => ({ faction, distances: graphDistances(galaxy.graph, faction.homeSystemId) }));
    const assignSystem = (system, systemId = system.id) => {
      if (system.owner !== 'ai') return;
      if (!system.factionId) {
        const ranked = (homes.length ? homes : factions.map((faction) => ({ faction, distances: new Map() })))
          .map((entry) => ({
            id: entry.faction.id,
            distance: entry.distances.get(systemId) ?? Number.MAX_SAFE_INTEGER,
          }))
          .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
        system.factionId = ranked[0]?.id ?? factions[0].id;
      }
      for (const structure of system.structures ?? []) {
        structure.level = Math.max(1, Math.min(3, Math.round(structure.level ?? 1)));
        structure.factionId = structure.factionId ?? system.factionId;
        if (structure.operational == null) structure.operational = (structure.hp ?? 1) > 0;
      }
    };
    for (const system of Object.values(galaxy.systems ?? {})) {
      assignSystem(system, system.id);
    }
    for (const [systemId, overlay] of Object.entries(galaxy.abstract?.systemOverlays ?? {})) {
      assignSystem(overlay, systemId);
    }
  }
  for (const ship of state.aiShips ?? []) {
    if (!ship.factionId) {
      const system = state.galaxies?.[ship.galaxyId ?? state.activeGalaxyId]?.systems?.[ship.systemId];
      ship.factionId = system?.factionId ?? factions[0].id;
    }
    ship.owner = 'ai';
    ship.veterancy = Math.max(0, Math.min(3, Math.round(ship.veterancy ?? 0)));
    ship.experience = Math.max(0, Number(ship.experience ?? 0));
  }
  for (const ship of state.playerShips ?? []) {
    ship.veterancy = Math.max(0, Math.min(3, Math.round(ship.veterancy ?? 0)));
    ship.experience = Math.max(0, Number(ship.experience ?? 0));
  }
}

export function initV13State(state, { backfillResearch = false } = {}) {
  state.wormholeJumpCounter = Math.max(0, Math.floor(state.wormholeJumpCounter ?? 0));
  state.aiDifficulty = ['easy', 'normal', 'hard', 'sovereign'].includes(state.aiDifficulty)
    ? state.aiDifficulty
    : 'normal';
  initPhase5State(state);
  initPhase6State(state);
  const factions = state.factions?.list ?? [];
  const aiSystemCount = Object.values(state.galaxies ?? {}).reduce(
    (total, galaxy) => total + Object.values(galaxy.systems ?? {}).filter((system) => system.owner === 'ai').length,
    0,
  );
  const budget = Math.min(60, Math.floor(Math.max(0, state.time ?? 0) / 90000) + Math.ceil(aiSystemCount / Math.max(1, factions.length)));
  for (const faction of factions) {
    v13FactionResearchState(faction);
    if (backfillResearch) backfillFactionResearch(state, faction, budget);
  }
  if (state.factions) state.factions.ai = factions[0] ?? state.factions.ai ?? null;
  assignV13FactionIds(state);
  for (const galaxy of Object.values(state.galaxies ?? {})) {
    const systemRecords = [
      ...Object.values(galaxy.systems ?? {}),
      ...Object.values(galaxy.abstract?.systemOverlays ?? {}),
    ];
    for (const system of systemRecords) {
      for (const structure of system.structures ?? []) {
        structure.level = Math.max(1, Math.min(3, Math.round(structure.level ?? 1)));
        if (structure.operational == null) structure.operational = (structure.hp ?? 1) > 0;
      }
    }
  }
  return state;
}

// v12 -> v13 (expanded technology web, tiered infrastructure, faction AI parity).
function migrateV12toV13(envelope) {
  const state = envelope.state;
  initV13State(state, { backfillResearch: true });
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 13,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v13 -> v14 (construction-drone planner; manual routes retired).
function migrateV13toV14(envelope) {
  const state = envelope.state;
  delete state.manualTradeRoutes;
  state.builderConstructionOrders = state.builderConstructionOrders ?? [];
  for (const drone of state.builderDrones ?? []) {
    drone.awaitingOrders = drone.awaitingOrders ?? false;
    drone.originSystemId = drone.originSystemId ?? drone.systemId ?? state.stronghold;
  }
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 14,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v14 -> v15 (flagship arsenal + wing + Novacula fireSequence).
function migrateV14toV15(envelope) {
  const state = envelope.state;
  if (state.flagship) {
    state.flagship.weapons = Array.isArray(state.flagship.weapons) ? state.flagship.weapons : [];
    state.flagship.wing = state.flagship.wing ?? null;
  }
  state.superweapon = state.superweapon ?? {};
  state.superweapon.fireSequence = state.superweapon.fireSequence ?? null;
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 15,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

export function initV16State(state) {
  state.diplomacy = state.diplomacy && typeof state.diplomacy === 'object'
    ? state.diplomacy
    : { relations: {} };
  state.diplomacy.version = Math.max(2, Number(state.diplomacy.version ?? 2));
  state.diplomacy.schemaVersion = Math.max(2, Number(state.diplomacy.schemaVersion ?? state.diplomacy.version));
  state.diplomacy.relations ??= {};
  state.diplomacy.contacts ??= {};
  state.diplomacy.proposals = Array.isArray(state.diplomacy.proposals) ? state.diplomacy.proposals : [];
  state.diplomacy.agreements = Array.isArray(state.diplomacy.agreements) ? state.diplomacy.agreements : [];
  state.diplomacy.claims = Array.isArray(state.diplomacy.claims) ? state.diplomacy.claims : [];
  state.diplomacy.wars = Array.isArray(state.diplomacy.wars) ? state.diplomacy.wars : [];
  state.diplomacy.occupations = Array.isArray(state.diplomacy.occupations) ? state.diplomacy.occupations : [];
  state.diplomacy.sanctions = Array.isArray(state.diplomacy.sanctions) ? state.diplomacy.sanctions : [];
  state.diplomacy.history = Array.isArray(state.diplomacy.history) ? state.diplomacy.history : [];
  state.diplomacy.council = state.diplomacy.council && typeof state.diplomacy.council === 'object'
    ? state.diplomacy.council
    : { resolutions: [], activeResolutionId: null, lastSessionAt: 0 };
  state.diplomacy.council.resolutions = Array.isArray(state.diplomacy.council.resolutions)
    ? state.diplomacy.council.resolutions
    : [];
  state.diplomacy.nextIds = {
    proposal: Math.max(1, Math.floor(state.diplomacy.nextIds?.proposal ?? 1)),
    agreement: Math.max(1, Math.floor(state.diplomacy.nextIds?.agreement ?? 1)),
    claim: Math.max(1, Math.floor(state.diplomacy.nextIds?.claim ?? 1)),
    war: Math.max(1, Math.floor(state.diplomacy.nextIds?.war ?? 1)),
    resolution: Math.max(1, Math.floor(state.diplomacy.nextIds?.resolution ?? 1)),
  };
  state.diplomacy.revision = Math.max(0, Math.floor(state.diplomacy.revision ?? 0));
  state.diplomacy.panicUntil = Math.max(0, Number(state.diplomacy.panicUntil ?? 0));
  ensureDiplomacy(state);

  // Migrate the short-lived pre-release v16 draft shape as well as v15 saves.
  if (!Array.isArray(state.bulkProductionDeliveries)) {
    state.bulkProductionDeliveries = Array.isArray(state.bulkProduction?.pendingDeliveries)
      ? state.bulkProduction.pendingDeliveries
      : [];
  }
  if (!state.bulkProductionMeta || typeof state.bulkProductionMeta !== 'object') {
    state.bulkProductionMeta = {
      nextOrderId: state.bulkProduction?.nextOrderId ?? 1,
      nextDeliveryId: 1,
    };
  }
  delete state.bulkProduction;
  ensureBulkProductionState(state);
  ensureStrategicOrdersState(state);
  return state;
}

// v15 -> v16 (grand-strategy diplomacy, strategic operations, bulk production).
function migrateV15toV16(envelope) {
  const state = initV16State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 16,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

export function initV17State(state) {
  const settings = ensureCombatSettings(state);
  if (state.flagship) {
    state.flagship.autopilotTargetId ??= null;
    state.flagship.combatIntent ??= null;
  }
  for (const battle of Object.values(state.systemBattles ?? {})) {
    if (!battle || typeof battle !== 'object') continue;
    battle.fleetPriority = battle.fleetPriority ?? settings.fleetPriority;
    battle.advancedTactics = battle.advancedTactics ?? settings.advancedTactics;
    battle.alertAcknowledged = battle.alertAcknowledged ?? !battle.active;
    battle.startEventEmitted = battle.startEventEmitted ?? !battle.active;
    battle.autoRetreatIssued = battle.autoRetreatIssued ?? false;
    for (const unit of battle.units ?? []) {
      unit.intent ??= 'hold';
      unit.disengaging = unit.disengaging === true;
      unit.escaped = unit.escaped === true;
      if (!unit.isWing) continue;
      unit.maxAmmo = Math.max(1, unit.maxAmmo ?? (unit.hull === 'bomber' ? 4 : 8));
      unit.maxFuel = Math.max(1, unit.maxFuel ?? 100);
      unit.sortiePhase = unit.sortiePhase
        ?? (unit.recovered ? 'rearm' : (unit.returning ? 'return' : 'attack'));
      unit.sortieNumber = Math.max(1, Math.floor(unit.sortieNumber ?? 1));
      unit.sortieLaunchedAt = Number.isFinite(unit.sortieLaunchedAt)
        ? unit.sortieLaunchedAt
        : (battle.startedAt ?? state.time ?? 0);
      unit.rearmUntil = Number.isFinite(unit.rearmUntil) ? unit.rearmUntil : null;
      unit.recovered = unit.recovered === true;
    }
  }
  return state;
}

// v16 -> v17 (command-first combat autonomy and repeated carrier sorties).
function migrateV16toV17(envelope) {
  const state = initV17State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 17,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

export function initV18State(state) {
  state.builderDrones = Array.isArray(state.builderDrones) ? state.builderDrones : [];
  state.builderConstructionOrders = Array.isArray(state.builderConstructionOrders)
    ? state.builderConstructionOrders
    : [];
  if (state.builderDroneStarterGranted == null) {
    state.builderDroneStarterGranted = state.builderDrones.length > 0;
  }
  for (const drone of state.builderDrones) {
    drone.homeSystemId ??= drone.originSystemId ?? drone.systemId ?? state.stronghold ?? null;
    drone.strategicCampaignId ??= null;
    drone.strategicTargetId ??= null;
    drone.assignedFleetId ??= null;
    drone.returnHomeSystemId ??= null;
  }
  for (const order of state.builderConstructionOrders) {
    order.strategicCampaignId ??= null;
    order.strategicTargetId ??= null;
  }
  ensureBulkProductionState(state);
  ensureStrategicOrdersState(state);
  return state;
}

// v17 -> v18 (operation doctrines and manufacturable embarked construction drones).
function migrateV17toV18(envelope) {
  const state = envelope.state;
  for (const campaign of state.strategicOrders?.campaigns ?? []) {
    campaign.reserveDroneIds ??= [];
    campaign.reserveDroneRequested ??= false;
    for (const target of campaign.targets ?? []) {
      target.executionVersion = ['traveling', 'fighting', 'capturing', 'constructing', 'securing']
        .includes(target.phase) ? 1 : 2;
    }
  }
  initV18State(state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 18,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

export function initV19State(state) {
  const metaSeed = state.meta?.seed ?? 0;
  for (const galaxy of Object.values(state.galaxies ?? {})) {
    const galaxySeed = hashSeed(metaSeed, `galaxy:${galaxy.id}`);
    assignGalaxyStellarOverrides(galaxy.graph, galaxy.strongholdStarId, galaxySeed);
  }
  applyStellarCatalog(state);
  return state;
}

// v18 -> v19 (deterministic visual-only exotic stellar catalog).
function migrateV18toV19(envelope) {
  const state = initV19State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 19,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

export function initV20State(state, { migrateLegacyCatalog = false } = {}) {
  const metaSeed = state.meta?.seed ?? 0;
  for (const galaxy of Object.values(state.galaxies ?? {})) {
    const galaxySeed = hashSeed(metaSeed, `galaxy:${galaxy.id}`);
    assignGalaxyCatalogNumbers(galaxy.graph, galaxySeed);
    const overlays = galaxy.abstract?.systemOverlays ?? {};
    for (let index = 0; index < (galaxy.graph?.stars?.length ?? 0); index++) {
      const node = galaxy.graph.stars[index];
      if (node.kind === 'trade_nexus') {
        delete node.stellarClass;
        delete node.stellarOverride;
        continue;
      }
      if (node.id === galaxy.strongholdStarId && galaxy.id === state.homeGalaxyId) {
        node.stellarClass = 'yellow_dwarf';
      } else if (!node.stellarClass || migrateLegacyCatalog) {
        const storedType = galaxy.systems?.[node.id]?.star?.type
          ?? overlays[node.id]?.star?.type
          ?? node.stellarOverride;
        node.stellarClass = storedType
          ? canonicalizeStellarClass(storedType)
          : legacyGeneratedStellarClass(metaSeed, galaxy.id, node, index);
      } else {
        node.stellarClass = canonicalizeStellarClass(node.stellarClass);
      }
    }
    assignGalaxyStellarCatalog(galaxy.graph, galaxy.strongholdStarId, galaxySeed, { preserveExisting: true });
  }
  applyStellarCatalog(state);
  applyStateCatalogIdentities(state);
  return state;
}

// v19 -> v20 (canonical stellar classes and coordinate catalog names).
function migrateV19toV20(envelope) {
  const state = initV20State(envelope.state, { migrateLegacyCatalog: true });
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 20,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

function initV21State(state, { migrateLegacyTutorial = false } = {}) {
  state.campaign ??= {
    mode: 'sandbox',
    victoryType: 'sandbox',
    defeated: false,
    won: false,
    activeMissionId: null,
    completedMissions: [],
    missionProgress: {},
  };
  const defaults = createTutorialCampaignState();
  const existing = state.campaign.tutorial;
  state.campaign.tutorial = {
    ...defaults,
    ...(existing && typeof existing === 'object' ? existing : {}),
    flags: { ...defaults.flags, ...(existing?.flags ?? {}) },
    completedStepIds: Array.isArray(existing?.completedStepIds) ? existing.completedStepIds : [],
  };
  if (migrateLegacyTutorial && state.campaign.mode === 'tutorial') {
    state.campaign.tutorial = createTutorialCampaignState();
    state.campaign.tutorial.status = 'active';
  }
  return state;
}

// v20 -> v21 (stable tutorial curriculum state and profile-backed graduation).
function migrateV20toV21(envelope) {
  const state = initV21State(envelope.state, { migrateLegacyTutorial: true });
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 21,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

function remapTechId(id) {
  if (TECH_NODES[id]) return id;
  const mapped = TECH_ID_MIGRATION[id];
  if (mapped && TECH_NODES[mapped]) return mapped;
  return null;
}

function migrateResearchTechIds(research) {
  if (!research || typeof research !== 'object') return;
  const mapList = (list) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    for (const id of list) {
      const next = remapTechId(id);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      out.push(next);
    }
    return out;
  };
  research.unlocked = mapList(research.unlocked);
  research.queue = mapList(research.queue);
  if (research.activeNodeId) {
    research.activeNodeId = remapTechId(research.activeNodeId);
  }
  if (!TECH_NODES[research.activeNodeId]) research.activeNodeId = null;
}

function initV22State(state) {
  initV21State(state);
  ensureSuperweapon(state);
  migrateResearchTechIds(state.research);
  if (Array.isArray(state.unlockedTech)) {
    state.unlockedTech = state.unlockedTech
      .map(remapTechId)
      .filter(Boolean);
  }
  for (const faction of state.factions?.list ?? []) {
    migrateResearchTechIds(faction.research);
  }
  // Legacy cradles that were instantly online become frame-only skeletons.
  if (state.superweapon?.cradleSystemId && !state.superweapon.installedParts?.frame) {
    state.superweapon.installedParts = {
      frame: { installedAt: state.time ?? 0, label: 'Cradle Frame' },
      ...(state.superweapon.online
        ? {
          power: { installedAt: state.time ?? 0, label: 'Power Core' },
          focus: { installedAt: state.time ?? 0, label: 'Focus Array' },
          create: { installedAt: state.time ?? 0, label: 'Genesis Skeleton' },
          destroy: { installedAt: state.time ?? 0, label: 'Annihilation Skeleton' },
          jump: { installedAt: state.time ?? 0, label: 'Jump Skeleton' },
        }
        : {}),
    };
  }
  return state;
}

// v22 -> v23 (Helioclast siege ship stages + live-fire gate).
function initV23State(state) {
  const prior = state.superweapon;
  const missingLiveFire = !prior || prior.liveFireComplete == null;
  const legacyCalibrated = !!(
    prior?.online
    && prior?.installedParts?.create
    && prior?.installedParts?.destroy
  );
  initV22State(state);
  ensureSuperweapon(state);
  if (missingLiveFire) {
    // Legacy fully-online cradles count as calibrated.
    state.superweapon.liveFireComplete = legacyCalibrated;
  }
  return state;
}

function migrateV22toV23(envelope) {
  const state = initV23State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 23,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v23 -> v24 (Helioclast shipyard + timed berth jobs).
function initV24State(state) {
  initV23State(state);
  ensureSuperweapon(state);
  if (state.superweapon.buildJob === undefined) state.superweapon.buildJob = null;

  const renameYard = (system) => {
    for (const structure of system?.structures ?? []) {
      if (structure.type === 'superweapon_cradle') {
        structure.type = 'helioclast_shipyard';
      }
    }
  };

  const galaxies = state.galaxies;
  if (Array.isArray(galaxies)) {
    for (const galaxy of galaxies) {
      for (const system of Object.values(galaxy.systems ?? {})) renameYard(system);
    }
  } else if (galaxies && typeof galaxies === 'object') {
    for (const galaxy of Object.values(galaxies)) {
      for (const system of Object.values(galaxy?.systems ?? {})) renameYard(system);
    }
  }
  for (const system of Object.values(state.systems ?? {})) renameYard(system);
  return state;
}

function migrateV23toV24(envelope) {
  const state = initV24State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 24,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

export function initV25State(state) {
  const legacySchemaVersion = Number(state.diplomacy?.schemaVersion ?? state.diplomacy?.version ?? 0);
  const legacyProfileIds = new Set(Object.keys(state.diplomacy?.profiles ?? {}));
  const diplomacy = ensureDiplomacy(state);
  const actors = new Set(['player', ...(state.factions?.list ?? []).map((faction) => faction.id)]);
  const validTerms = new Set([
    'resource', 'agreement', 'system_transfer', 'tribute', 'reparations', 'claim', 'end_war', 'join_war',
    'sanction', 'lift_sanction', 'favor', 'helioclast_commitment', 'credits', 'solarii', 'treaty',
  ]);
  for (const proposal of diplomacy.proposals) {
    if (proposal.status !== 'pending') continue;
    const malformed = !actors.has(proposal.from) || !actors.has(proposal.to)
      || !Array.isArray(proposal.terms) || !proposal.terms.length
      || proposal.terms.some((term) => !term || !validTerms.has(term.type));
    const invalid = malformed || !previewProposal(state, proposal, { omniscient: true }).ok;
    if (invalid) {
      proposal.status = 'expired';
      proposal.resolvedAt = state.time ?? 0;
      proposal.reason = 'migration_invalid_legacy_terms';
      proposal.migrationReason = 'The legacy proposal contained actors or terms that diplomacy v3 cannot enforce atomically.';
    }
  }
  for (const agreement of diplomacy.agreements) {
    if (agreement.status !== 'active' || agreement.expiresAt != null) continue;
    if (agreement.type === 'ceasefire') agreement.expiresAt = agreement.startedAt + 60000;
    if (agreement.type === 'truce') agreement.expiresAt = agreement.startedAt + 180000;
    agreement.v3Enforceable = true;
  }
  for (const war of diplomacy.wars) {
    war.escalation ??= 'limited';
    war.escalationAt ??= war.startedAt ?? state.time ?? 0;
    war.legitimacy ??= 50;
  }
  if (legacySchemaVersion < 3) {
    const systems = Object.entries(state.galaxies ?? {}).flatMap(([galaxyId, galaxy]) => (
      Object.values(galaxy.systems ?? {}).map((system) => ({ galaxyId, system }))
    ));
    const knownSystemIds = new Set(Object.values(state.galaxies ?? {}).flatMap((galaxy) => (
      Object.keys(galaxy.intel ?? {})
    )));
    const actors = ['player', ...(state.factions?.list ?? []).map((faction) => faction.id)];
    for (const actorId of actors) {
      const controlled = systems.filter(({ system }) => (
        actorId === 'player'
          ? system.owner === 'player'
          : system.owner === 'ai' && system.factionId === actorId
      ));
      const dysons = controlled.filter(({ system }) => (
        system.dyson?.complete || Number(system.dyson?.completedShells ?? 0) >= 8
      )).length;
      const embassies = controlled.reduce((count, { system }) => count + (system.structures ?? [])
        .filter((structure) => structure.type === 'embassy_complex' && !structure.construction).length, 0);
      const personality = actorId === 'player' ? 'player'
        : state.factions?.list?.find((faction) => faction.id === actorId)?.personality;
      const personalityBase = { player: 0, expansionist: -5, economic: 5, megastructure: 8, wormhole: 2 }[personality] ?? 0;
      if (!legacyProfileIds.has(actorId)) {
        diplomacy.profiles[actorId].reputation = Math.max(-100, Math.min(100,
          personalityBase + Math.min(10, Math.floor(controlled.length / 5)) + dysons * 5 + Math.min(6, embassies * 2),
        ));
      }
      if (actorId !== 'player') {
        const owned = controlled.length;
        const known = controlled.filter(({ system }) => knownSystemIds.has(system.id)).length;
        const contact = diplomacy.contacts[actorId];
        const stageBase = { unknown: 0, detected: 20, contacted: 30, established: 50 }[contact?.stage] ?? 0;
        if (contact) contact.intelligence = Math.max(contact.intelligence ?? 0,
          Math.min(100, stageBase + (owned ? Math.round(known / owned * 35) : 0) + Math.min(15, embassies * 5)));
      }
    }
    diplomacy.migrationV25Derived = true;
  }
  diplomacy.version = 3;
  diplomacy.schemaVersion = 3;
  return state;
}

function migrateV24toV25(envelope) {
  const state = initV25State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 25,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// v21 -> v22 (Dyson→Novacula spine tech tree + superweapon skeleton parts).
function migrateV21toV22(envelope) {
  const state = initV22State(envelope.state);
  const stateJson = JSON.stringify(state);
  return {
    saveVersion: 22,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state,
  };
}

// Returns {ok, state} or {ok:false, error}. Refuses corrupt files; never repairs.
export function deserialize(envelopeJson) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    return { ok: false, error: 'Save file is not valid JSON' };
  }

  if (typeof envelope.saveVersion !== 'number' || envelope.saveVersion > SAVE_VERSION) {
    return { ok: false, error: `Unknown save version: ${envelope.saveVersion}` };
  }

  const stateJson = JSON.stringify(envelope.state);
  if (crc32(stateJson) !== envelope.checksum) {
    return { ok: false, error: 'Save file failed checksum — refusing to load' };
  }

  if (envelope.saveVersion < SAVE_VERSION) {
    envelope = migrateSave(envelope);
  }
  initV16State(envelope.state);
  initV17State(envelope.state);
  initV18State(envelope.state);
  initV19State(envelope.state);
  initV20State(envelope.state);
  initV21State(envelope.state);
  initV22State(envelope.state);
  initV23State(envelope.state);
  initV24State(envelope.state);
  initV25State(envelope.state);

  if (envelope.state?.flagship) {
    envelope.state.flagship.orbit = envelope.state.flagship.orbit ?? null;
    envelope.state.flagship.weapons = Array.isArray(envelope.state.flagship.weapons)
      ? envelope.state.flagship.weapons
      : [];
    envelope.state.flagship.wing = envelope.state.flagship.wing ?? null;
  }
  if (envelope.state?.superweapon) {
    envelope.state.superweapon.fireSequence = envelope.state.superweapon.fireSequence ?? null;
  }

  for (const system of Object.values(envelope.state?.systems ?? {})) {
    for (const structure of system.structures ?? []) {
      if (structure.type === 'sail_foundry' && !structure.bodyId && system.bodies?.length) {
        structure.bodyId = system.bodies.find((p) => p.type === 'habitable')?.id ?? system.bodies[0].id;
      }
    }
  }

  initPhase5State(envelope.state);
  initConstructionDroneState(envelope.state);
  initPhase6State(envelope.state);
  initPostPhase6BuildingsAndCombat(envelope.state);
  initBuilderDrones(envelope.state);
  ensureLogisticsState(envelope.state);
  resetLogisticsIds(envelope.state);
  envelope.state.tacticalOrders = envelope.state.tacticalOrders ?? {};
  envelope.state.battleReports = Array.isArray(envelope.state.battleReports) ? envelope.state.battleReports : [];
  envelope.state.combatDoctrine = envelope.state.combatDoctrine ?? 'assault';
  envelope.state.mapOverlays = { threat: true, sensor: false, blockade: true, ...(envelope.state.mapOverlays ?? {}) };
  envelope.state.solCommander = envelope.state.solCommander?.settings && Array.isArray(envelope.state.solCommander.history)
    ? envelope.state.solCommander
    : createSolCommanderState();
  if (envelope.state.flagship) {
    envelope.state.flagship.hp = envelope.state.flagship.hp ?? FLAGSHIP_HP;
    envelope.state.flagship.maxHp = envelope.state.flagship.maxHp ?? FLAGSHIP_HP;
    refreshFlagshipHullFromTech(envelope.state);
  }
  initV13State(envelope.state);
  migrateShipyardsOnLoad(envelope.state);
  envelope.state.constructionJobs = envelope.state.constructionJobs ?? [];
  envelope.state.drones = envelope.state.drones ?? [];

  return { ok: true, state: envelope.state };
}

// --- Storage backend: Electron IPC when available, localStorage otherwise ---

const isElectron = () => typeof window !== 'undefined' && !!window.gameSave;
const lsKey = (slot) => `gs-save-${slot}`;
const TUTORIAL_CHECKPOINT_KEY = 'tutorial-checkpoint';

export async function writeSlot(slot, state) {
  if (!SLOTS.includes(slot)) return { ok: false, error: `Invalid slot: ${slot}` };
  const envelopeJson = serialize(state);
  if (isElectron()) {
    return window.gameSave.write(slot, envelopeJson);
  }
  try {
    localStorage.setItem(lsKey(slot), envelopeJson);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

export async function readSlot(slot) {
  if (!SLOTS.includes(slot)) return { ok: false, error: `Invalid slot: ${slot}` };
  let raw;
  if (isElectron()) {
    const res = await window.gameSave.read(slot);
    if (!res.ok) return res;
    raw = res.data;
  } else {
    raw = localStorage.getItem(lsKey(slot));
    if (raw === null) return { ok: false, error: 'No save in this slot' };
  }
  return deserialize(raw);
}

export async function listSlots() {
  if (isElectron()) {
    return window.gameSave.list();
  }
  const saves = [];
  for (const slot of SLOTS) {
    const raw = localStorage.getItem(lsKey(slot));
    if (raw === null) continue;
    let savedAt = null;
    let saveVersion = null;
    try {
      const parsed = JSON.parse(raw);
      savedAt = parsed.savedAt ?? null;
      saveVersion = parsed.saveVersion ?? null;
    } catch { /* still listed */ }
    saves.push({ slot, savedAt, saveVersion, sizeBytes: raw.length });
  }
  return { ok: true, saves };
}

export async function writeTutorialCheckpoint(state) {
  const envelopeJson = serialize(state);
  if (isElectron() && window.gameSave.writeInternal) {
    return window.gameSave.writeInternal(TUTORIAL_CHECKPOINT_KEY, envelopeJson);
  }
  try {
    localStorage.setItem(`gs-internal-${TUTORIAL_CHECKPOINT_KEY}`, envelopeJson);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

export async function readTutorialCheckpoint() {
  let raw = null;
  if (isElectron() && window.gameSave.readInternal) {
    const result = await window.gameSave.readInternal(TUTORIAL_CHECKPOINT_KEY);
    if (!result?.ok) return result;
    raw = result.data;
  } else {
    raw = localStorage.getItem(`gs-internal-${TUTORIAL_CHECKPOINT_KEY}`);
  }
  if (!raw) return { ok: false, error: 'No tutorial checkpoint' };
  return deserialize(raw);
}

export async function clearTutorialCheckpoint() {
  if (isElectron() && window.gameSave.deleteInternal) {
    return window.gameSave.deleteInternal(TUTORIAL_CHECKPOINT_KEY);
  }
  localStorage.removeItem(`gs-internal-${TUTORIAL_CHECKPOINT_KEY}`);
  return { ok: true };
}

// --- Browser-only export/import (JSON file download / file picker) ---

export function exportSaveFile(state) {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'galactic-sovereign-save.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function importSaveFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(deserialize(String(reader.result)));
    reader.onerror = () => resolve({ ok: false, error: 'Could not read file' });
    reader.readAsText(file);
  });
}
