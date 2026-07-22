#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createNewGame } from '../src/js/state.js';
import { deserialize, serialize } from '../src/js/save.js';
import { AuthStore } from '../server/auth-store.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-world-migration-'));
const input = path.join(root, 'original.json');
const output = path.join(root, 'migrated.json');
const dataDir = path.join(root, 'data');
const state = createNewGame(4242);
state.credits = 123456;
state.coopMeta = {
  worldId: 'legacy-world',
  identities: { alpha: { displayName: 'Alpha', reconnectToken: 'plaintext-legacy-token', createdAt: 123 } },
};
state.playerFlagships = [{ ...state.flagship, pilotId: 'alpha', callsign: 'Alpha' }];
fs.writeFileSync(input, serialize(state));

const result = spawnSync(process.execPath, ['scripts/migrate-multiplayer-world.mjs', input, output], {
  cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, GS_DATA_DIR: dataDir }, encoding: 'utf8',
});
if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Migration failed');
const migratedRaw = fs.readFileSync(output, 'utf8');
if (migratedRaw.includes('plaintext-legacy-token')) throw new Error('Reconnect token survived migration');
const migrated = deserialize(migratedRaw);
if (!migrated.ok || migrated.state.credits !== 123456) throw new Error('Gameplay state was not preserved');
if (migrated.state.coopMeta.identities.alpha.accountId !== null) throw new Error('Legacy pilot was not unclaimed');
const store = new AuthStore({ dataDir });
const pilots = store.listLegacyPilots();
store.close();
if (pilots.length !== 1 || pilots[0].pilotId !== 'alpha' || pilots[0].claimedUserId) throw new Error('Legacy pilot registry mismatch');
fs.rmSync(root, { recursive: true, force: true });
console.log('[world-migration] PASS: progress preserved, credentials removed, pilot unclaimed');
