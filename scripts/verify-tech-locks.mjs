#!/usr/bin/env node
// Focused, repository-tracked technology unlock contract.

import { BODY_STRUCTURE_DEFS } from '../src/js/body-structures.js';
import { SHIP_HULL_CATEGORIES } from '../src/js/constants.js';
import { enqueueHull } from '../src/js/empire-queue.js';
import { createNewGame } from '../src/js/state.js';
import { STRUCTURE_DEFS } from '../src/js/strategic-structures.js';
import {
  empireHullUnlockTech,
  empireQueueHulls,
  isTechUnlocked,
  techNode,
} from '../src/js/tech-web.js';

const results = [];
function check(name, condition, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

function addShipyard(state) {
  const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
  const planet = system.bodies.find((body) => body.type === 'habitable') ?? system.bodies[0];
  system.structures.push({
    id: 'tech-lock-yard',
    type: 'shipyard',
    bodyId: planet.id,
    builtAtTime: 0,
    builds: [],
  });
}

const baseHulls = new Set(['scout', 'corvette', 'healer']);
const productionHulls = Object.values(SHIP_HULL_CATEGORIES).flatMap((category) => category.hulls);
for (const hull of productionHulls) {
  const state = createNewGame(4500 + results.length);
  state.credits = 100_000;
  addShipyard(state);
  const techId = empireHullUnlockTech(hull);
  if (baseHulls.has(hull)) {
    check(`${hull} is an intentional baseline hull`,
      techId == null && empireQueueHulls(state).includes(hull));
    continue;
  }

  check(`${hull} has a real technology gate`, !!techId && !!techNode(techId), techId ?? 'missing');
  check(`${hull} stays out of production before research`, !empireQueueHulls(state).includes(hull));
  const lockedAttempt = enqueueHull(state, hull);
  check(`${hull} command is rejected before research`,
    !lockedAttempt.ok && /not unlocked/i.test(lockedAttempt.reason), lockedAttempt.reason);

  state.research.unlocked.push(techId);
  check(`${hull} enters production after ${techId}`,
    isTechUnlocked(state, techId) && empireQueueHulls(state).includes(hull));
  const unlockedAttempt = enqueueHull(state, hull);
  check(`${hull} command succeeds after research`, unlockedAttempt.ok, unlockedAttempt.reason ?? '');
}

for (const [type, def] of Object.entries(BODY_STRUCTURE_DEFS)) {
  check(`${type} declares a real technology gate`, !!def.tech && !!techNode(def.tech), def.tech ?? 'missing');
}
for (const [type, def] of Object.entries(STRUCTURE_DEFS)) {
  check(`${type} declares a real technology gate`, !!def.tech && !!techNode(def.tech), def.tech ?? 'missing');
}

const failures = results.filter((result) => !result.pass);
if (failures.length > 0) {
  console.error(`\n${failures.length}/${results.length} technology lock checks failed.`);
  process.exit(1);
}
console.log(`\n${results.length}/${results.length} technology lock checks passed.`);
