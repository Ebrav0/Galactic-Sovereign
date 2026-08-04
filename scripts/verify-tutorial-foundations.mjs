import assert from 'node:assert/strict';

import { createNewGame } from '../src/js/state.js';
import {
  CONTROL_ACTIONS,
  controlActionForCode,
  detectControlPlatform,
  formatControlAction,
  isEditableControlTarget,
} from '../src/js/control-registry.js';
import {
  FOUNDATIONS_COURSE,
  TUTORIAL_STEPS,
  getTutorialState,
  initTutorial,
  tryAdvanceTutorial,
} from '../src/js/tutorial.js';
import { TUTORIAL_STEP_IDS, tutorialAccess } from '../src/js/tutorial-access.js';
import { gatherIntel } from '../src/js/intel.js';
import { systemById } from '../src/js/state.js';
import {
  beginCoopTutorial,
  COOP_FOUNDATIONS_COURSE,
  getCoopTutorialState,
  markCoopTutorialEvent,
  advanceCoopTutorial,
} from '../src/js/coop-tutorial.js';
import {
  foundationsStatus,
  setProfileForTest,
  tutorialGraduated,
  uiPreferences,
  updateUiPreferences,
  waiveFoundations,
} from '../src/js/profile.js';

const requiredCopy = ['module', 'title', 'objective', 'why', 'expected', 'recovery'];

assert.equal(TUTORIAL_STEPS.length, 7, 'Foundations must contain six milestones plus completion');
assert.deepEqual(TUTORIAL_STEPS.map((step) => step.id), [...TUTORIAL_STEP_IDS]);
assert.equal(FOUNDATIONS_COURSE.mode, 'solo');
for (const step of TUTORIAL_STEPS) {
  for (const key of requiredCopy) {
    assert.equal(typeof step[key], 'string', `${step.id}.${key} must be present`);
    assert(step[key].trim().length > 0, `${step.id}.${key} must not be empty`);
  }
  assert(step.input || step.controlActionId, `${step.id} must state an exact input`);
}

assert.equal(controlActionForCode('KeyO'), 'orbit');
assert.equal(controlActionForCode('ArrowLeft'), 'move_left');
assert.equal(detectControlPlatform({ platform: 'MacIntel' }), 'macos');
assert.equal(detectControlPlatform({ platform: 'Win32' }), 'windows');
assert.equal(detectControlPlatform({ platform: 'Linux x86_64' }), 'linux');
assert.match(formatControlAction('drone_dispatch', 'macos'), /Command/);
assert.match(formatControlAction('drone_dispatch', 'windows'), /Ctrl/);
assert.match(formatControlAction('fleet_dispatch', 'macos'), /Option/);
assert(Object.keys(CONTROL_ACTIONS).length >= 18);

// HUD buttons must not block WASD (multiplayer Join leaves focus on the button).
assert.equal(isEditableControlTarget({
  closest: (sel) => (String(sel).includes('button') ? {} : null),
}), false);
assert.equal(isEditableControlTarget({ isContentEditable: true }), true);

const state = createNewGame(80726);
initTutorial(state);
assert.equal(getTutorialState(state).step, 'establish_stronghold');
for (const featureId of ['research', 'diplomacy', 'operations', 'wormholes', 'superweapon', 'missions']) {
  assert.equal(tutorialAccess(state, featureId).allowed, true, `${featureId} must stay available`);
}

const home = systemById(state, state.stronghold);
const body = home.bodies.find((candidate) => candidate.type !== 'gas' && candidate.type !== 'barren');
home.structures.push({ id: 'verify-outpost', type: 'outpost', bodyId: body.id });
tryAdvanceTutorial(state);
assert.equal(getTutorialState(state).step, 'build_reach');

home.structures.push({ id: 'verify-shipyard', type: 'shipyard', bodyId: body.id, builds: [] });
state.scouts.push({
  id: 'verify-scout',
  galaxyId: state.activeGalaxyId,
  systemId: state.stronghold,
  hp: 1,
  maxHp: 1,
});
tryAdvanceTutorial(state);
assert.equal(getTutorialState(state).step, 'survey_frontier');

const targetId = getTutorialState(state).targetSystemId;
gatherIntel(state, targetId);
tryAdvanceTutorial(state);
assert.equal(getTutorialState(state).step, 'muster_escort');

state.playerShips.push({
  id: 'verify-corvette',
  hull: 'corvette',
  hp: 100,
  maxHp: 100,
  galaxyId: state.activeGalaxyId,
  systemId: state.stronghold,
});
tryAdvanceTutorial(state);
assert.equal(getTutorialState(state).step, 'set_course');

state.campaign.tutorial.flags.battlePrepared = true;
tryAdvanceTutorial(state);
assert.equal(getTutorialState(state).step, 'win_and_claim');

state.campaign.tutorial.flags.battleWon = true;
systemById(state, targetId).owner = 'player';
tryAdvanceTutorial(state);
assert.equal(getTutorialState(state).step, 'graduation');
await new Promise((resolve) => setTimeout(resolve, 0));

setProfileForTest({ tutorialGraduatedAt: 1234 });
assert.equal(tutorialGraduated(), true);
assert.equal(foundationsStatus(), 'completed');

setProfileForTest({});
assert.equal(tutorialGraduated(), false);
await waiveFoundations(5678);
assert.equal(tutorialGraduated(), true);
assert.equal(foundationsStatus(), 'waived');

setProfileForTest({});
assert.deepEqual(uiPreferences(), { pinnedMonitor: null, pinnedMonitorCollapsed: false });
await updateUiPreferences({ pinnedMonitor: 'queue', pinnedMonitorCollapsed: true });
assert.deepEqual(uiPreferences(), { pinnedMonitor: 'queue', pinnedMonitorCollapsed: true });
const invalidMonitor = await updateUiPreferences({ pinnedMonitor: 'unknown' });
assert.equal(invalidMonitor.ok, false);

assert.equal(COOP_FOUNDATIONS_COURSE.mode, 'coop');
assert(COOP_FOUNDATIONS_COURSE.steps.length >= 12);
for (const step of COOP_FOUNDATIONS_COURSE.steps) {
  for (const key of requiredCopy) assert(step[key]?.trim(), `coop ${step.id}.${key} must be present`);
  const forbidden = `${step.id} ${step.objective} ${step.action ?? ''}`.toLowerCase();
  assert(!/build outpost|queue hull|order fleet|pause the empire|flagship travel/.test(forbidden),
    `coop step ${step.id} must remain non-destructive`);
}

setProfileForTest({});
beginCoopTutorial({ force: true });
while (getCoopTutorialState().active) {
  const current = getCoopTutorialState().current;
  if (current.requiredEvent) markCoopTutorialEvent(current.requiredEvent);
  const result = advanceCoopTutorial();
  assert.equal(result.ok, true, `coop step ${current.id} should advance`);
}
assert.equal(getCoopTutorialState().complete, true);

console.log('Tutorial Foundations verifier passed', {
  soloSteps: TUTORIAL_STEPS.length,
  coopSteps: COOP_FOUNDATIONS_COURSE.steps.length,
  controls: Object.keys(CONTROL_ACTIONS).length,
});
