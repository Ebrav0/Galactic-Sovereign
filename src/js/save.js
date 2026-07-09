// Save/load: envelope + CRC-32 checksum + slots (IMPLEMENTATION_PLAN §5-6).
// Pure serialize/deserialize plus I/O calls; holds no live state references.

import { SAVE_VERSION } from './constants.js';
import { createNewGame, seedNeutralStructuresForGalaxy, createDefaultDyson, hashSeed, createRng } from './state.js';
import { backfillStarTypes } from './star-types.js';
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

export const SLOTS = ['autosave', 'slot-1', 'slot-2', 'slot-3', 'exit-save'];

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
  const stateJson = JSON.stringify(state);
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
  };
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
  state.manualTradeRoutes = state.manualTradeRoutes ?? [];
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

  if (envelope.state?.flagship) {
    envelope.state.flagship.orbit = envelope.state.flagship.orbit ?? null;
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
  migrateShipyardsOnLoad(envelope.state);
  envelope.state.constructionJobs = envelope.state.constructionJobs ?? [];
  envelope.state.drones = envelope.state.drones ?? [];

  return { ok: true, state: envelope.state };
}

// --- Storage backend: Electron IPC when available, localStorage otherwise ---

const isElectron = () => typeof window !== 'undefined' && !!window.gameSave;
const lsKey = (slot) => `gs-save-${slot}`;

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
