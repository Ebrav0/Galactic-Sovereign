#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { AuthStore } from '../server/auth-store.mjs';
import { deserialize, serialize } from '../src/js/save.js';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error('Usage: node scripts/migrate-multiplayer-world.mjs <copied-input-world.json> <new-output-world.json>');
}
const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
if (inputPath === outputPath) throw new Error('Input and output must differ; the original world is immutable');
if (!fs.existsSync(inputPath)) throw new Error(`Input world not found: ${inputPath}`);
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite existing output: ${outputPath}`);

const parsed = deserialize(fs.readFileSync(inputPath, 'utf8'));
if (!parsed.ok) throw new Error(`Invalid input world: ${parsed.error}`);
const state = parsed.state;
state.coopMeta = state.coopMeta && typeof state.coopMeta === 'object' ? state.coopMeta : {};
const priorIdentities = state.coopMeta.identities && typeof state.coopMeta.identities === 'object'
  ? state.coopMeta.identities
  : {};
const pilotsById = new Map();

for (const flagship of state.playerFlagships ?? []) {
  const pilotId = String(flagship?.pilotId ?? '').slice(0, 80);
  if (!pilotId) continue;
  const prior = priorIdentities[pilotId] ?? {};
  pilotsById.set(pilotId, {
    pilotId,
    displayName: String(prior.displayName ?? flagship.callsign ?? pilotId).trim().slice(0, 32) || pilotId,
    createdAt: Number(prior.createdAt) || Date.now(),
  });
}
for (const [rawPilotId, prior] of Object.entries(priorIdentities)) {
  const pilotId = String(rawPilotId).slice(0, 80);
  if (!pilotId || pilotsById.has(pilotId)) continue;
  pilotsById.set(pilotId, {
    pilotId,
    displayName: String(prior?.displayName ?? pilotId).trim().slice(0, 32) || pilotId,
    createdAt: Number(prior?.createdAt) || Date.now(),
  });
}

state.coopMeta.identities = Object.fromEntries([...pilotsById.values()].map((pilot) => [pilot.pilotId, {
  displayName: pilot.displayName,
  legacy: true,
  accountId: null,
  createdAt: pilot.createdAt,
}]));

function removeLegacyCredentials(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    const credentialKey = key.replace(/[-_]/g, '');
    if (/^(?:reconnecttoken|password|accesstoken|sessiontoken)$/i.test(credentialKey)) delete value[key];
    else removeLegacyCredentials(value[key], seen);
  }
}
removeLegacyCredentials(state);

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, serialize(state), { mode: 0o600, flag: 'wx' });
fs.chmodSync(outputPath, 0o600);

let registered = 0;
if (process.env.GS_DATA_DIR) {
  const store = new AuthStore({ dataDir: process.env.GS_DATA_DIR });
  try { registered = store.importLegacyPilots([...pilotsById.values()]); } finally { store.close(); }
}

const inputHash = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'));
const outputHash = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex'));
console.log(JSON.stringify({ ok: true, pilots: pilotsById.size, registered, inputHash, outputHash }, null, 2));
