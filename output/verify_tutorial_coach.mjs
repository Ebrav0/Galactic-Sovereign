// Tutorial step machine + coach-mark contract (no browser).

import { createNewGame } from '../src/js/state.js';
import {
  TUTORIAL_STEPS,
  initTutorial,
  getTutorialState,
  getTutorialFocus,
  tryAdvanceTutorial,
  acknowledgeTutorialStep,
  markTutorialSystemViewed,
  markTutorialLogisticsOpened,
  setTutorialStep,
  finishTutorial,
} from '../src/js/tutorial.js';
import { buildOutpost } from '../src/js/economy.js';
import { buildShipyard } from '../src/js/production.js';
import { gatherIntel } from '../src/js/intel.js';
import { enqueueHull } from '../src/js/empire-queue.js';

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

check('tutorial has full early-game loop steps', TUTORIAL_STEPS.length >= 12);
check('every step has uiTargetId for coach anchoring', TUTORIAL_STEPS.every((s) => s.uiTargetId));
check('no full-panel copy fields required', TUTORIAL_STEPS.every((s) => s.objective && s.placement));

const state = createNewGame(42);
initTutorial(state);
check('tutorial starts at step 0', getTutorialState(state).step === 0);
check('coach target is system tab', getTutorialState(state).current.uiTargetId === 'tab-system');

markTutorialSystemViewed(state);
tryAdvanceTutorial(state);
check('system view advances to outpost beat', getTutorialState(state).step === 1);

const home = state.stronghold;
const body = state.galaxies[state.activeGalaxyId].systems[home].bodies.find((b) => b.type === 'habitable');
buildOutpost(state, home, body.id, { remote: true, alreadyPaid: true, ignoreCredits: true });
tryAdvanceTutorial(state);
check('outpost advances to logistics', getTutorialState(state).step === 2);

markTutorialLogisticsOpened(state);
tryAdvanceTutorial(state);
check('logistics advances to shipyard', getTutorialState(state).step === 3);

buildShipyard(state, home, body.id, { remote: true, alreadyPaid: true, ignoreCredits: true });
tryAdvanceTutorial(state);
check('shipyard advances to scout', getTutorialState(state).step === 4);

state.scouts = [{ id: 'scout-1', systemId: home, transit: null }];
tryAdvanceTutorial(state);
check('scout advances to recon', getTutorialState(state).step === 5);

const targetId = state.campaign.tutorialTargetSystemId;
state.scouts[0].transit = { path: [home, targetId], progress: 0 };
tryAdvanceTutorial(state);
check('scout dispatch advances', getTutorialState(state).step === 6);

gatherIntel(state, targetId);
tryAdvanceTutorial(state);
check('intel advances to combat escort', getTutorialState(state).step === 7);

enqueueHull(state, 'corvette');
tryAdvanceTutorial(state);
check('combat queue advances to flagship course', getTutorialState(state).step === 8);

state.flagship.transit = { path: [home, targetId], progress: 0 };
tryAdvanceTutorial(state);
check('flagship course advances to capture review', getTutorialState(state).step === 9);

state.flagship.transit = null;
state.flagship.systemId = targetId;
tryAdvanceTutorial(state);
check('arrival advances to hold capture', getTutorialState(state).step === 10);

state.galaxies[state.activeGalaxyId].systems[targetId].owner = 'player';
tryAdvanceTutorial(state);
check('capture advances to foundry teaser', getTutorialState(state).step === 11);

const skipFoundry = acknowledgeTutorialStep(state);
check('foundry can be skipped via Continue', skipFoundry.ok && getTutorialState(state).step === 12);
check('final step ready to finish', getTutorialState(state).current.readyToFinish);

const finished = finishTutorial(state);
check('finish returns to sandbox', finished.ok && state.campaign.mode === 'sandbox');

const replay = createNewGame(99);
initTutorial(replay);
setTutorialStep(replay, 7);
const focus = getTutorialFocus(replay);
check('combat step focus opens fleet or system', focus?.view === 'system');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
