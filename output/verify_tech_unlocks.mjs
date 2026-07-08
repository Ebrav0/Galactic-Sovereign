// Focused tech-tree unlock verification.

import { createNewGame } from '../src/js/state.js';
import { setCompletedDysonsForTest } from '../src/js/milestones.js';
import { canQueueHull, queueHull } from '../src/js/production.js';
import { offerTreaty } from '../src/js/diplomacy.js';
import { empireQueueHulls, techEffects } from '../src/js/tech-web.js';

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

function addShipyard(state, id = 'test-yard') {
  const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
  const planet = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
  system.structures.push({
    id,
    type: 'shipyard',
    bodyId: planet.id,
    builtAtTime: 0,
    builds: [],
  });
  return id;
}

let state = createNewGame(42);
state.credits = 10000;
const shipyardId = addShipyard(state);

let destroyer = canQueueHull(state, shipyardId, state.stronghold, 'destroyer');
check('destroyer direct queue is locked before tech', !destroyer.ok && /unlock/i.test(destroyer.reason), destroyer.reason);

state.research.unlocked.push('mil_parallel_dock', 'mil_destroyer_unlock');
destroyer = queueHull(state, shipyardId, state.stronghold, 'destroyer');
check('destroyer direct queue unlocks after tech', destroyer.ok, destroyer.reason ?? '');

let hauler = canQueueHull(state, shipyardId, state.stronghold, 'light_hauler');
check('light hauler direct queue is locked before tech', !hauler.ok && /unlock/i.test(hauler.reason), hauler.reason);

state.research.unlocked.push('trade_light_hauler');
hauler = canQueueHull(state, shipyardId, state.stronghold, 'light_hauler');
check('light hauler direct queue unlocks after tech', hauler.ok, hauler.reason ?? '');

state = createNewGame(43);
state.credits = 10000;
state.solarii = 100;
state.solariiUnlocked = true;
setCompletedDysonsForTest(state, 1);
const creditsBeforeTruce = state.credits;

let treaty = offerTreaty(state, 'ai-0', 'truce');
check('truce treaty is locked before Truce Protocol', !treaty.ok && treaty.reason.includes('Truce Protocol'), treaty.reason);
check('locked truce does not charge credits', state.credits === creditsBeforeTruce);

state.research.unlocked.push('dip_truce_protocol');
treaty = offerTreaty(state, 'ai-0', 'truce');
check('truce treaty unlocks after Truce Protocol', treaty.ok, treaty.reason ?? '');

treaty = offerTreaty(state, 'ai-0', 'trade');
check('trade treaty is locked before Trade Charter', !treaty.ok && treaty.reason.includes('Trade Charter'), treaty.reason);

state.research.unlocked.push('dip_trade_charter');
treaty = offerTreaty(state, 'ai-0', 'trade');
check('trade treaty unlocks after Trade Charter', treaty.ok, treaty.reason ?? '');

treaty = offerTreaty(state, 'ai-0', 'alliance');
check('alliance treaty is locked before Alliance Pact', !treaty.ok && treaty.reason.includes('Alliance Pact'), treaty.reason);

state.research.unlocked.push('dip_alliance_pact');
treaty = offerTreaty(state, 'ai-0', 'alliance');
check('alliance treaty unlocks after Alliance Pact', treaty.ok, treaty.reason ?? '');

state = createNewGame(44);
state.research.unlocked.push('hero_hull_unlock');
check('hero flagship tech effect flag is set', techEffects(state).unlockHeroFlagship === true);
check('hero flagship stays out of ordinary shipyard queue', !empireQueueHulls(state).includes('hero_flagship'));

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} tech unlock checks failed.`);
  process.exit(1);
}

console.log(`\n${results.length}/${results.length} tech unlock checks passed.`);
