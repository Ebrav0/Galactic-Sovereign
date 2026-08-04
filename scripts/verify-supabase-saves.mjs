#!/usr/bin/env node
/**
 * Smoke-test Supabase solo-save bridge (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */
import { SupabaseSaveStore } from '../server/supabase-saves.mjs';
import { serialize } from '../src/js/save.js';
import { createNewGame } from '../src/js/state.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const store = new SupabaseSaveStore({ url, serviceRoleKey: key });
const userId = `verify-${Date.now()}`;
const slot = 'autosave';
const envelope = serialize(createNewGame({ seed: 7 }));

await store.deleteSave(userId, slot).catch(() => false);
await store.putSave(userId, slot, envelope, 0);
try {
  await store.putSave(userId, slot, envelope, 0);
  throw new Error('expected conflict');
} catch (error) {
  if (error.code !== 'REVISION_CONFLICT') throw error;
}
const got = await store.getSave(userId, slot);
if (!got?.envelope) throw new Error('missing envelope');
const listed = await store.listSaves(userId);
if (!listed.some((row) => row.slot === 'autosave' && row.revision === 1)) {
  throw new Error('listSaves missing autosave');
}
await store.deleteSave(userId, slot);
console.log('verify:supabase-saves PASS (autosave slot)');
