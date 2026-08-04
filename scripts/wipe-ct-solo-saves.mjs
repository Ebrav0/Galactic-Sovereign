#!/usr/bin/env node
/**
 * Clean-start wipe of CT/local SQLite solo save envelopes.
 * Keeps users and sessions. After Supabase cutover, run this so large JSON
 * no longer lives on the home-server disk.
 *
 *   node scripts/wipe-ct-solo-saves.mjs
 *   GS_DATA_DIR=/var/lib/galactic-sovereign/accounts node scripts/wipe-ct-solo-saves.mjs
 *   node scripts/wipe-ct-solo-saves.mjs --yes
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthStore } from '../server/auth-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(
  process.env.GS_DATA_DIR || path.join(__dirname, '..', 'server', 'data'),
);
const autoYes = process.argv.includes('--yes') || process.env.GS_WIPE_SAVES_YES === '1';

const store = new AuthStore({ dataDir });
const counts = store.adminOverviewCounts();
console.log(`Data dir: ${dataDir}`);
console.log(`Users: ${counts.users.total}; local solo saves: ${counts.soloSaves}`);

if (counts.soloSaves === 0) {
  console.log('Nothing to wipe.');
  store.close();
  process.exit(0);
}

if (!autoYes) {
  console.error('Refusing to wipe without --yes (or GS_WIPE_SAVES_YES=1).');
  store.close();
  process.exit(2);
}

const result = store.wipeAllSaveSlots({ vacuum: true });
console.log(`Wiped ${result.deleted} save_slots row(s) and vacuumed.`);
store.close();
