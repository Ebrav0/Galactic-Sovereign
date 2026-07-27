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
  recordTutorialEvent,
} from '../src/js/tutorial.js';
import { TUTORIAL_STEP_IDS } from '../src/js/tutorial-access.js';
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
  waiveFoundations,
} from '../src/js/profile.js';

const requiredCopy = ['module', 'title', 'objective', 'why', 'expected', 'recovery'];

assert.equal(TUTORIAL_STEPS.length, 25, 'Foundations must remain a 25-step novice course');
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
assert.equal(getTutorialState(state).step, 'command_overview');

recordTutorialEvent(state, 'movement');
assert.equal(getTutorialState(state).step, 'command_overview', 'out-of-order events must not skip lessons');

const fundamentals = [
  ['notification_opened', 'time_controls'],
  ['pause_toggled', 'time_controls'],
  ['pause_toggled', 'movement'],
  ['movement', 'select_orbit_body'],
  ['body_selected', 'enter_orbit'],
  ['orbit_entered', 'exit_orbit'],
  ['orbit_exited', 'camera_pan'],
  ['camera_panned', 'camera_zoom'],
  ['camera_zoomed', 'camera_follow'],
  ['camera_followed', 'galaxy_view'],
  ['galaxy_viewed', 'inspect_star'],
  ['star_inspected', 'map_ping'],
  ['map_pinged', 'system_return'],
  ['stronghold_returned', 'resources_costs'],
  ['resources_inspected', 'build_outpost'],
];
for (const [eventId, expectedStep] of fundamentals) {
  recordTutorialEvent(state, eventId);
  assert.equal(getTutorialState(state).step, expectedStep, `${eventId} should advance to ${expectedStep}`);
}

{
  const returnStep = TUTORIAL_STEPS.find((step) => step.id === 'system_return');
  assert.ok(returnStep, 'system_return step missing');
  assert.equal(returnStep.controlActionId, undefined, 'system_return must not imply M alone completes the lesson');
  assert.match(returnStep.objective, /Stronghold/i);
  assert.match(returnStep.input, /Return home|double-click/i);
  assert.match(returnStep.why, /M alone/i);
}
await new Promise((resolve) => setTimeout(resolve, 0));

setProfileForTest({ tutorialGraduatedAt: 1234 });
assert.equal(tutorialGraduated(), true);
assert.equal(foundationsStatus(), 'completed');

setProfileForTest({});
assert.equal(tutorialGraduated(), false);
await waiveFoundations(5678);
assert.equal(tutorialGraduated(), true);
assert.equal(foundationsStatus(), 'waived');

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
