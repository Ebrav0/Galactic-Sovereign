#!/usr/bin/env node

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { seedAiFaction } from '../src/js/ai-faction.js';
import { spawnPirateFleets } from '../src/js/pirates.js';
import { advance } from '../src/js/simulation.js';
import { createNewGame } from '../src/js/state.js';

const SEED = 4242;
const SAMPLE_MS = 5 * 60_000;
const TICKS_PER_SAMPLE = SAMPLE_MS / 50;
const MAX_LATE_MS_PER_TICK = 6;
const MAX_GROWTH_RATIO = 3;

const state = createNewGame(SEED);
seedAiFaction(state, state.homeGalaxyId);
state.pirates = spawnPirateFleets(state);
state.paused = false;

const samples = [];
for (let minute = 5; minute <= 20; minute += 5) {
  const startedAt = performance.now();
  advance(state, SAMPLE_MS);
  const wallMs = performance.now() - startedAt;
  const systems = Object.values(state.galaxies[state.activeGalaxyId].systems);
  const sample = {
    minute,
    wallMs: Math.round(wallMs * 10) / 10,
    msPerTick: Math.round((wallMs / TICKS_PER_SAMPLE) * 1000) / 1000,
    aiShips: state.aiShips.length,
    aiSystems: systems.filter((system) => system.owner === 'ai').length,
    depots: Object.keys(state.logistics?.depots ?? {}).length,
    convoys: state.logistics?.convoys?.length ?? 0,
    activeBattles: Object.values(state.systemBattles ?? {}).filter((battle) => battle?.active).length,
  };
  samples.push(sample);
  console.log(JSON.stringify(sample));
}

const first = samples[0];
const late = samples.at(-1);
const growthRatio = late.msPerTick / Math.max(0.001, first.msPerTick);

assert.equal(state.time, 20 * 60_000, 'simulation should reach the 20-minute boundary');
assert.ok(late.aiShips >= 50, `stress state did not evolve enough (${late.aiShips} AI ships)`);
assert.ok(late.aiSystems >= 15, `stress state did not expand enough (${late.aiSystems} AI systems)`);
assert.ok(late.convoys >= 40, `stress state did not retain enough convoy traffic (${late.convoys})`);
assert.ok(
  late.msPerTick <= MAX_LATE_MS_PER_TICK,
  `late solo tick cost ${late.msPerTick}ms exceeded ${MAX_LATE_MS_PER_TICK}ms`,
);
assert.ok(
  growthRatio <= MAX_GROWTH_RATIO,
  `late solo tick growth ${growthRatio.toFixed(2)}x exceeded ${MAX_GROWTH_RATIO}x`,
);

console.log('Solo long-session performance verification passed', {
  seed: SEED,
  firstMsPerTick: first.msPerTick,
  lateMsPerTick: late.msPerTick,
  growthRatio: Math.round(growthRatio * 100) / 100,
});
