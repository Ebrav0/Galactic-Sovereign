#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  ensureAiResearchState,
  factionTechContext,
  fillAiResearchQueue,
  tickAiResearch,
} from '../src/js/ai-tech.js';
import { TECH_NODES } from '../src/js/tech-nodes.js';
import { techEffects } from '../src/js/tech-web.js';

const FIXTURE_SEED = 54;
const SIMULATED_MS = 600_000;
const STEP_MS = 1_000;
const PERSONALITIES = ['expansionist', 'economic', 'megastructure', 'wormhole'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createPortableFixture() {
  return {
    meta: { seed: FIXTURE_SEED, createdAt: 0, playTimeMs: 0 },
    time: 0,
    paused: false,
    aiDifficulty: 'normal',
    factions: {
      list: PERSONALITIES.map((personality, index) => ({
        id: `ai-cache-${index}`,
        name: `Cache Fixture ${index}`,
        personality,
        difficulty: 'normal',
        credits: 10_000_000,
        solarii: 10_000_000,
        solariiUnlocked: true,
        milestones: {
          completedDysonSystems: ['fixture-1', 'fixture-2', 'fixture-3'],
          diplomacyUnlocked: true,
          superweaponUnlocked: true,
        },
        research: {
          activeNodeId: null,
          progress: 0,
          durationMs: null,
          unlocked: ['eco_baseline'],
          queue: [],
          infrastructureSpeedMult: 1,
          queueSlotBonus: 2,
        },
      })),
    },
  };
}

function verifyLegacyMutationHandling() {
  const rootProbe = { id: 'root-probe', research: { unlocked: [], queue: [] } };
  const rootIds = [...ensureAiResearchState(rootProbe).unlocked];
  const validIds = Object.keys(TECH_NODES).filter((id) => !rootIds.includes(id));
  assert.ok(validIds.length >= 6);
  const [
    activeId,
    unlockedId,
    queuedId,
    replacementUnlockedId,
    replacementQueuedId,
  ] = validIds;
  const faction = {
    id: 'legacy-cache-fixture',
    milestones: {},
    research: {
      activeNodeId: activeId,
      progress: 7,
      durationMs: -1,
      unlocked: ['not-a-tech', unlockedId, unlockedId],
      queue: [
        { nodeId: queuedId },
        queuedId,
        { nodeId: unlockedId },
        activeId,
        { nodeId: 'not-a-tech' },
      ],
      infrastructureSpeedMult: 0,
      queueSlotBonus: 2.8,
    },
  };

  const unlockedIdentity = faction.research.unlocked;
  const queueIdentity = faction.research.queue;
  const normalized = ensureAiResearchState(faction);
  assert.equal(normalized.unlocked, unlockedIdentity, 'migration should normalize unlocked in place');
  assert.equal(normalized.queue, queueIdentity, 'migration should normalize queue in place');
  assert.deepEqual(normalized.unlocked, [unlockedId, ...rootIds]);
  assert.deepEqual(normalized.queue, [queuedId]);
  assert.equal(normalized.progress, 1);
  assert.equal(normalized.durationMs, null);
  assert.equal(normalized.infrastructureSpeedMult, 0.1);
  assert.equal(normalized.queueSlotBonus, 2);

  const contextA = factionTechContext(faction);
  const effectsA = techEffects(contextA);
  const contextB = factionTechContext(faction);
  assert.equal(contextB, contextA, 'faction technology context should retain identity');
  assert.equal(techEffects(contextB), effectsA, 'unchanged technology effects should remain cached');

  // Same-length external edits are the case an identity/length-only cache would
  // miss. Both arrays keep their identity and length while their contents
  // change, and object-shaped legacy queue entries still normalize to ids.
  const unlockedLength = normalized.unlocked.length;
  const queueLength = normalized.queue.length;
  normalized.unlocked[0] = replacementUnlockedId;
  normalized.queue[0] = { nodeId: replacementQueuedId };
  ensureAiResearchState(faction);
  assert.equal(normalized.unlocked, unlockedIdentity);
  assert.equal(normalized.queue, queueIdentity);
  assert.equal(normalized.unlocked.length, unlockedLength);
  assert.equal(normalized.queue.length, queueLength);
  assert.deepEqual(normalized.unlocked, [replacementUnlockedId, ...rootIds]);
  assert.deepEqual(normalized.queue, [replacementQueuedId]);

  const contextAfterMutation = factionTechContext(faction);
  assert.equal(contextAfterMutation, contextA, 'context identity should survive same-length edits');
  assert.deepEqual(
    [...contextAfterMutation.research.unlocked],
    normalized.unlocked,
    'context research view must reflect same-length unlocked edits',
  );
  const effectsAfterMutation = techEffects(factionTechContext(faction));
  const directEffects = techEffects({ research: { unlocked: [...normalized.unlocked] } });
  assert.notEqual(
    effectsAfterMutation,
    effectsA,
    'same-length unlocked edits must invalidate the cached effect object',
  );
  assert.deepEqual(
    effectsAfterMutation,
    directEffects,
    'cached context must refresh to the exact effects of mutated research',
  );

  normalized.unlocked[0] = 'not-a-tech';
  normalized.queue[0] = { nodeId: 'not-a-tech' };
  ensureAiResearchState(faction);
  assert.deepEqual(normalized.unlocked, rootIds);
  assert.deepEqual(normalized.queue, []);
}

function benchmarkHotContext(state) {
  const factions = state.factions.list;
  for (const faction of factions) ensureAiResearchState(faction);
  let sink = 0;
  const iterations = 250_000;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const faction = factions[index % factions.length];
    sink += techEffects(factionTechContext(faction)).shipyardSlots;
  }
  const wallMs = performance.now() - startedAt;
  return {
    iterations,
    wallMs: Math.round(wallMs * 1000) / 1000,
    nsPerCall: Math.round((wallMs * 1e6) / iterations),
    sink,
  };
}

function warmTechnologyCaches(state) {
  for (const faction of state.factions.list) {
    ensureAiResearchState(faction);
    for (let iteration = 0; iteration < 20; iteration += 1) {
      techEffects(factionTechContext(faction));
    }
  }
}

function simulateResearch(state) {
  const events = [];
  const ticks = Math.ceil(SIMULATED_MS / STEP_MS);
  for (let tickIndex = 0; tickIndex < ticks; tickIndex += 1) {
    const deltaMs = Math.min(STEP_MS, SIMULATED_MS - state.time);
    state.time += deltaMs;
    state.meta.playTimeMs += deltaMs;
    for (const faction of state.factions.list) {
      fillAiResearchQueue(state, faction, tickIndex);
      events.push(...tickAiResearch(state, faction, deltaMs));
    }
  }
  return events;
}

verifyLegacyMutationHandling();
const fixture = createPortableFixture();
const coldState = structuredClone(fixture);
const warmedState = structuredClone(fixture);
warmTechnologyCaches(warmedState);
const hotContext = benchmarkHotContext(warmedState);

const coldStartedAt = performance.now();
const coldEvents = simulateResearch(coldState);
const coldWallMs = performance.now() - coldStartedAt;
const warmStartedAt = performance.now();
const warmedEvents = simulateResearch(warmedState);
const warmWallMs = performance.now() - warmStartedAt;
const coldJson = JSON.stringify(coldState);
const warmedJson = JSON.stringify(warmedState);
assert.equal(
  warmedJson,
  coldJson,
  'pre-warmed AI technology caches changed deterministic serialized research state',
);
assert.deepEqual(
  warmedEvents,
  coldEvents,
  'pre-warmed AI technology caches changed deterministic research events',
);
assert.ok(coldEvents.length > 0, 'portable fixture should complete research');
for (const faction of coldState.factions.list) {
  assert.ok(
    faction.research.unlocked.length > 1,
    `${faction.id} should complete at least one technology`,
  );
}

console.log(JSON.stringify({
  ok: true,
  legacyAndSameLengthMutationHandling: 'passed',
  portableFixture: {
    seed: FIXTURE_SEED,
    factionCount: coldState.factions.list.length,
    simulatedMs: SIMULATED_MS,
    completedResearchEvents: coldEvents.filter((event) => event.type === 'ai_research_complete').length,
    unlockedByFaction: coldState.factions.list.map((faction) => ({
      factionId: faction.id,
      unlocked: faction.research.unlocked.length,
    })),
    serializedBytes: Buffer.byteLength(coldJson),
    paritySha256: sha256(coldJson),
    coldWallMs: Math.round(coldWallMs * 10) / 10,
    prewarmedWallMs: Math.round(warmWallMs * 10) / 10,
  },
  hotContext,
}, null, 2));
