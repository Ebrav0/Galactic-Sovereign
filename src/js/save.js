// Save/load: envelope + CRC-32 checksum + slots (IMPLEMENTATION_PLAN §5-6).
// Pure serialize/deserialize plus I/O calls; holds no live state references.

import { SAVE_VERSION } from './constants.js';
import { createNewGame } from './state.js';

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
  return e;
}

// v0 (single home system) -> v1 (galaxy + multi-system + flagship).
// Regenerates the galaxy from the saved seed, then installs the player's
// actual v0 system — structures intact — as the Stronghold system.
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
  fresh.systems[strongholdId] = oldSystem;
  // Keep the galaxy-map star label in sync with the migrated system name.
  fresh.galaxy.stars.find((s) => s.id === strongholdId).name = oldSystem.name;

  const stateJson = JSON.stringify(fresh);
  return {
    saveVersion: 1,
    checksum: crc32(stateJson),
    savedAt: envelope.savedAt,
    state: fresh,
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
