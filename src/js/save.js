// Save/load: envelope + CRC-32 checksum + slots (IMPLEMENTATION_PLAN §5-6).
// Pure serialize/deserialize plus I/O calls; holds no live state references.

import { SAVE_VERSION } from './constants.js';
import { createNewGame, seedNeutralStructuresForGalaxy } from './state.js';
import { backfillStarTypes } from './star-types.js';

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
  return e;
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
  fresh.systems[strongholdId] = oldSystem;
  fresh.galaxy.stars.find((s) => s.id === strongholdId).name = oldSystem.name;

  fresh.intel = { [strongholdId]: { gatheredAt: 0 } };
  fresh.scouts = [];
  fresh.capture = {};

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

  for (const star of state.galaxy.stars) {
    const system = state.systems[star.id];
    if (!system) continue;
    system.owner = star.id === state.stronghold ? 'player' : 'neutral';
    for (const s of system.structures) {
      if (s.type === 'shipyard' && s.build === undefined) s.build = null;
    }
  }
  const core = state.systems[state.galaxy.blackHole.id];
  if (core) core.owner = 'neutral';

  state.scouts = state.scouts ?? [];
  state.intel = state.intel ?? { [state.stronghold]: { gatheredAt: 0 } };
  if (!state.intel[state.stronghold]) {
    state.intel[state.stronghold] = { gatheredAt: 0 };
  }
  state.capture = state.capture ?? {};

  seedNeutralStructuresForGalaxy(state);

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
