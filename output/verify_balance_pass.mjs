// Balance pass contract: progressive income, Solarii drain, sail burn band, capture weights.

import {
  OUTPOST_BASE_INCOME,
  MOON_YIELD_BONUS,
  SAIL_CREDIT_COST,
  FOUNDRY_SAIL_RATE,
  SOLARII_DRAIN_PER_SHELL,
  CAPTURE_STRUCTURE_WEIGHT,
  CAPTURE_DYSON_SHELL_WEIGHT,
  HERO_FLAGSHIP_HP,
  SHELL_BONUS_CREDIT_MULT,
} from '../src/js/constants.js';
import { createNewGame } from '../src/js/state.js';
import { incomePerSecond } from '../src/js/economy.js';
import {
  solariiPerSecond,
  solariiDrainPerSecond,
  solariiNetPerSecond,
  applySolariiTick,
} from '../src/js/dyson.js';
import { captureRequirement } from '../src/js/capture.js';
import { techEffects } from '../src/js/tech-web.js';

let passed = 0;
let failed = 0;
function check(label, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${details ? ` — ${details}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${details ? ` — ${details}` : ''}`);
  }
}
function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

check('sail credit cost in Master Plan band 2.5–5', SAIL_CREDIT_COST >= 2.5 && SAIL_CREDIT_COST <= 5);
const sailBurn = SAIL_CREDIT_COST * FOUNDRY_SAIL_RATE;
check('one foundry burn ≈ 1–2 early outposts', sailBurn >= OUTPOST_BASE_INCOME && sailBurn <= OUTPOST_BASE_INCOME * 2.5,
  `burn=${sailBurn}`);
check('hero flagship HP exceeds dreadnought floor', HERO_FLAGSHIP_HP >= 1200);
check('foundry capture weight softened vs old 6', CAPTURE_STRUCTURE_WEIGHT.sail_foundry <= 4.5);
check('Dyson shell capture weight softened', CAPTURE_DYSON_SHELL_WEIGHT <= 1.75);
check('Solarii drain constant defined', SOLARII_DRAIN_PER_SHELL > 0);

const state = createNewGame(77);
const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
const body = system.bodies.find((b) => b.type === 'habitable');
system.structures.push({
  id: 'bal-outpost', type: 'outpost', bodyId: body.id,
  level: 1, hp: 240, maxHp: 240, operational: true,
});
const moons = body.moons?.length ?? 0;
const baseExpected = OUTPOST_BASE_INCOME * (1 + moons * MOON_YIELD_BONUS);
check('progressive income uses moons', approx(incomePerSecond(state), baseExpected));

system.dyson = system.dyson ?? { completedShells: 0, shellSails: 0, foundryStock: 0, launcherStock: {}, launcherLastFireAt: {} };
system.dyson.completedShells = 4;
const shelled = baseExpected * (SHELL_BONUS_CREDIT_MULT[4] ?? 1);
check('shell credit mult applies to income', approx(incomePerSecond(state), shelled));

state.research.unlocked.push('eco_surveyor');
const fx = techEffects(state);
check('credit income tech sets creditIncomeMult', fx.creditIncomeMult > 1);
check('income rises with credit tech', incomePerSecond(state) > shelled);

system.dyson.completedShells = 3;
state.solariiUnlocked = true;
state.solarii = 10;
const gross = solariiPerSecond(state);
const drain = solariiDrainPerSecond(state);
const net = solariiNetPerSecond(state);
check('Solarii drain scales with shells', approx(drain, 3 * SOLARII_DRAIN_PER_SHELL));
check('Solarii net = income − drain', approx(net, gross - drain));
const before = state.solarii;
state.time += 50;
applySolariiTick(state);
check('Solarii tick applies net rate', approx(state.solarii - before, net * 0.05));

const emptyReq = captureRequirement(state, state.stronghold);
system.structures.push({
  id: 'bal-foundry', type: 'sail_foundry', bodyId: body.id,
  level: 1, hp: 400, maxHp: 400, operational: true,
});
const foundryReq = captureRequirement(state, state.stronghold);
check('foundry raises capture requirement', foundryReq > emptyReq);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
