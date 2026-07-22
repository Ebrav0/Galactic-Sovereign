#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

import { deserialize } from '../src/js/save.js';

const [originalPath, migratedPath] = process.argv.slice(2);
if (!originalPath || !migratedPath) {
  throw new Error('Usage: verify-live-world-migration.mjs <original-world.json> <migrated-world.json>');
}

function load(file) {
  const result = deserialize(fs.readFileSync(file, 'utf8'));
  if (!result.ok) throw new Error(`${file}: ${result.error}`);
  return result.state;
}

function gameplayState(state) {
  const copy = structuredClone(state);
  delete copy.coopMeta;
  return copy;
}

function credentialKeys(value, location = '$', found = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[-_]/g, '');
    if (/^(?:reconnecttoken|password|accesstoken|sessiontoken)$/i.test(normalized)) found.push(`${location}.${key}`);
    credentialKeys(child, `${location}.${key}`, found, seen);
  }
  return found;
}

const original = load(originalPath);
const migrated = load(migratedPath);
assert.deepEqual(gameplayState(migrated), gameplayState(original), 'Gameplay state changed during migration');
const leakedCredentials = credentialKeys(migrated);
assert.deepEqual(leakedCredentials, [], `Legacy credentials remain: ${leakedCredentials.join(', ')}`);

const identities = Object.entries(migrated.coopMeta?.identities ?? {});
for (const [pilotId, identity] of identities) {
  assert.equal(identity.legacy, true, `${pilotId} is not marked legacy`);
  assert.equal(identity.accountId, null, `${pilotId} was unexpectedly attached to an account`);
}

console.log(JSON.stringify({
  ok: true,
  time: migrated.time,
  credits: migrated.resources?.credits ?? migrated.credits ?? null,
  systems: migrated.galaxy?.systems?.length ?? migrated.systems?.length ?? 0,
  fleets: migrated.fleets?.length ?? 0,
  legacyPilots: identities.length,
}, null, 2));
