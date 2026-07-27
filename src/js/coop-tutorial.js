// First-join multiplayer orientation. This state is presentation-only and is
// deliberately kept out of the shared world so one pilot's tutorial can never
// pause, gate, or mutate another pilot's session.

import { formatControlAction } from './control-registry.js';
import { defineTutorialCourse } from './tutorial-course.js';
import {
  currentProfile,
  updateTutorialCourseProgress,
} from './profile.js';

export const COOP_TUTORIAL_VERSION = 2;
export const COOP_TUTORIAL_STORAGE_KEY = `gs.coop.tutorial.v${COOP_TUTORIAL_VERSION}`;

export const COOP_TUTORIAL_STEPS = Object.freeze([
  {
    id: 'welcome',
    module: '1 · Shared universe',
    title: 'Welcome to a persistent crew',
    objective: 'Read how this multiplayer universe differs from singleplayer.',
    input: 'No shared action required',
    why: 'The empire, resources, clock, construction, and battles are shared by every connected pilot.',
    expected: 'You know that menus do not stop the universe and that major spending affects the crew.',
    recovery: 'This explanation is always available from Controls & Tutorials.',
    statusPending: 'Nothing is being changed. Continue when you understand the shared-world rule.',
    uiTargetId: 'coop-banner',
    placement: 'bottom',
    requiredEvent: null,
  },
  {
    id: 'identify_self',
    module: '1 · Shared universe',
    title: 'Find yourself',
    objective: 'Open the CO-OP badge and locate your callsign and current system.',
    input: 'Click the CO-OP badge',
    why: 'Every pilot owns a personal flagship; the roster tells you who is online and where they are.',
    expected: 'The roster opens with your pilot marked as you.',
    recovery: 'Click the highlighted badge in the upper-left.',
    statusPending: 'Open the roster once.',
    uiTargetId: 'coop-banner',
    placement: 'right',
    actionLabel: 'Open roster',
    action: 'roster',
    requiredEvent: 'roster_opened',
  },
  {
    id: 'movement',
    module: '2 · Personal flight',
    title: 'Fly only your flagship',
    objective: 'Press W/A/S/D or the arrow keys to move your flagship.',
    controlActionId: 'move_up',
    why: 'Manual movement is personal: it does not steer another pilot or spend shared resources.',
    expected: 'Your flagship moves while the rest of the shared empire remains unchanged.',
    recovery: 'Return to System view, click the map, and hold an arrow key.',
    statusPending: 'Apply thrust in any direction.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
    requiredEvent: 'thrust',
  },
  {
    id: 'select_orbit_body',
    module: '2 · Personal flight',
    title: 'Select an orbit target',
    objective: 'Left-click a nearby planet or moon.',
    controlActionId: 'select',
    why: 'Orbit uses your current selection as its target.',
    expected: 'A selection ring and object details appear.',
    recovery: 'If no body is safely available, use “Cannot practice now” and revisit the lesson later.',
    statusPending: 'Select one nearby body.',
    uiTargetId: 'game-canvas',
    placement: 'right',
    requiredEvent: 'body_selected',
    allowUnavailable: true,
  },
  {
    id: 'enter_orbit',
    module: '2 · Personal flight',
    title: 'Enter orbit',
    objective: 'Press O with the nearby body selected.',
    controlActionId: 'orbit',
    why: 'Orbit is personal flagship movement and is safe to practice in the live universe.',
    expected: 'Your location reads “orbiting” and the ship follows the body.',
    recovery: 'Move closer to the selected body, or defer this action if you are in transit or combat.',
    statusPending: 'Enter orbit once.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
    requiredEvent: 'orbit_entered',
    allowUnavailable: true,
  },
  {
    id: 'exit_orbit',
    module: '2 · Personal flight',
    title: 'Leave orbit',
    objective: 'Press O again to return to manual flight.',
    controlActionId: 'orbit',
    why: 'Disengage before manually flying elsewhere.',
    expected: 'The orbit label clears.',
    recovery: 'If orbit practice was unavailable, continue safely and replay it later.',
    statusPending: 'Leave orbit once.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
    requiredEvent: 'orbit_exited',
    allowUnavailable: true,
  },
  {
    id: 'camera_pan',
    module: '2 · Personal flight',
    title: 'Look around without moving',
    objective: 'Drag empty map space or middle-drag.',
    controlActionId: 'pan',
    why: 'Camera movement never issues a ship order.',
    expected: 'The view moves independently from your flagship.',
    recovery: 'Drag on the map rather than a panel.',
    statusPending: 'Pan the camera once.',
    uiTargetId: 'game-canvas',
    placement: 'right',
    requiredEvent: 'camera_panned',
  },
  {
    id: 'camera_zoom',
    module: '2 · Personal flight',
    title: 'Change map scale',
    objective: 'Use the mouse wheel over the map.',
    controlActionId: 'zoom',
    why: 'Zoom helps with precise selection and broad awareness.',
    expected: 'The map changes scale around the cursor.',
    recovery: 'Move the pointer over the canvas first.',
    statusPending: 'Zoom once.',
    uiTargetId: 'game-canvas',
    placement: 'right',
    requiredEvent: 'camera_zoomed',
  },
  {
    id: 'camera_follow',
    module: '2 · Personal flight',
    title: 'Return to your ship',
    objective: 'Press F to recenter on your flagship.',
    controlActionId: 'follow',
    why: 'Follow is a safe recovery when you lose your position.',
    expected: 'The camera snaps back to your flagship.',
    recovery: 'Press F in System view.',
    statusPending: 'Recenter once.',
    uiTargetId: 'flagship-loc',
    placement: 'bottom',
    requiredEvent: 'camera_followed',
  },
  {
    id: 'galaxy_map',
    module: '3 · Crew navigation',
    title: 'Read the strategic map',
    objective: 'Press M to open the Galaxy map, then press M again to return.',
    controlActionId: 'toggle_view',
    why: 'Viewing is harmless, but an ordinary star click can order your personal flagship to travel.',
    expected: 'You see star lanes, then return to local System view.',
    recovery: 'Use the visible System/Galaxy button.',
    statusPending: 'Open Galaxy view once.',
    uiTargetId: 'tab-galaxy',
    placement: 'top',
    actionLabel: 'Open Galaxy',
    action: 'galaxy',
    requiredEvent: 'galaxy_view',
  },
  {
    id: 'team_ping',
    module: '3 · Crew navigation',
    title: 'Send one harmless ping',
    objective: 'Press P to ping your current location for the other pilots.',
    controlActionId: 'ping',
    why: 'Pings communicate intent without moving ships or spending resources.',
    expected: 'The crew receives a visible location marker.',
    recovery: 'Press P in System view; right-click provides a precise alternative.',
    statusPending: 'Send one harmless team ping.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
    actionLabel: 'Send ping',
    action: 'ping',
    requiredEvent: 'map_ping',
  },
  {
    id: 'roster',
    module: '3 · Crew navigation',
    title: 'Follow an ally safely',
    objective: 'Open the roster and use Follow if another pilot is online.',
    input: 'CO-OP badge → Follow',
    why: 'Following changes only your camera; it never takes control of another ship.',
    expected: 'The camera tracks the ally, and F returns it to your flagship.',
    recovery: 'If you are the only pilot online, continue and replay this lesson when a friend joins.',
    statusPending: 'Review the roster. Following is optional when no ally is online.',
    uiTargetId: 'coop-banner',
    placement: 'right',
    actionLabel: 'Open roster',
    action: 'roster',
    requiredEvent: null,
  },
  {
    id: 'shared_control',
    module: '4 · Shared command safety',
    title: 'Respect command ownership',
    objective: 'Open Fleet Command. Shared ships and groups show an Owner line.',
    input: 'Fleet tab; no order is required',
    why: 'Request, grant, revoke, and transfer control make responsibility explicit without disconnecting anyone.',
    expected: 'You can identify the Owner line and unavailable-action explanation.',
    recovery: 'Use “Open Fleet”; do not issue an order during this lesson.',
    statusPending: 'Open Fleet Command once.',
    uiTargetId: 'fleet-panel',
    placement: 'right',
    actionLabel: 'Open Fleet',
    action: 'fleet',
    requiredEvent: 'fleet_opened',
  },
  {
    id: 'shared_clock',
    module: '4 · Shared command safety',
    title: 'Shared clock and resources',
    objective: 'Read the pause owner and resource chips without changing either.',
    input: 'Observation only',
    why: 'Pause affects the whole empire, and construction spends shared credits. Ask before major changes.',
    expected: 'You know where to see who paused and how many credits the crew has.',
    recovery: 'Replay “Shared command safety” from Controls & Tutorials.',
    statusPending: 'No pause or spending action is required.',
    uiTargetId: 'pause-btn',
    placement: 'bottom',
    requiredEvent: null,
  },
  {
    id: 'ready',
    module: '4 · Shared command safety',
    title: 'Crew certification complete',
    objective: 'You can now fly, navigate, ping, find allies, and coordinate shared command.',
    input: 'Finish tour',
    why: 'The universe keeps running during menus, and every accepted shared order is visible to the crew.',
    expected: 'The tour closes and remains replayable from the CO-OP roster and Controls & Tutorials.',
    recovery: 'Reconnect normally; tutorial progress is per account and never stored in the shared world.',
    statusPending: 'Finish the tour. You can replay it from the CO-OP roster.',
    uiTargetId: 'coop-banner',
    placement: 'bottom',
    requiredEvent: null,
    readyToFinish: true,
  },
]);

export const COOP_FOUNDATIONS_COURSE = defineTutorialCourse({
  id: 'coop',
  version: COOP_TUTORIAL_VERSION,
  mode: 'coop',
  title: 'Crew Foundations',
  steps: COOP_TUTORIAL_STEPS,
});

let tutorial = {
  active: false,
  stepIndex: 0,
  completedEvents: new Set(),
  complete: false,
};

function readCompletion() {
  const profileCourse = currentProfile()?.tutorialProgress?.coop;
  if (profileCourse?.status === 'completed') return true;
  try {
    const saved = JSON.parse(localStorage.getItem(COOP_TUTORIAL_STORAGE_KEY) || 'null');
    if (saved?.version === COOP_TUTORIAL_VERSION && saved?.complete === true) return true;
    const legacy = JSON.parse(localStorage.getItem('gs.coop.tutorial.v1') || 'null');
    if (legacy?.version === 1 && legacy?.complete === true) {
      updateTutorialCourseProgress('coop', {
        status: 'completed',
        currentStepId: null,
        completedStepIds: [],
      }).catch(() => {});
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function writeProgress(complete = false) {
  const current = COOP_TUTORIAL_STEPS[tutorial.stepIndex] ?? null;
  const completedStepIds = [...tutorial.completedEvents]
    .map((eventId) => COOP_TUTORIAL_STEPS.find((step) => step.requiredEvent === eventId)?.id)
    .filter(Boolean);
  try {
    localStorage.setItem(COOP_TUTORIAL_STORAGE_KEY, JSON.stringify({
      version: COOP_TUTORIAL_VERSION,
      complete: complete === true,
      completedAt: complete ? Date.now() : null,
      currentStepId: complete ? null : current?.id ?? null,
      completedStepIds,
    }));
  } catch {
    // Private browsing can reject storage. The in-memory tour still works.
  }
  updateTutorialCourseProgress('coop', {
    status: complete ? 'completed' : 'in_progress',
    currentStepId: complete ? null : current?.id ?? null,
    completedStepIds,
  }).catch(() => {});
}

export function beginCoopTutorial({ force = false } = {}) {
  if (!force && readCompletion()) return getCoopTutorialState();
  tutorial = {
    active: true,
    stepIndex: 0,
    completedEvents: new Set(),
    complete: false,
  };
  writeProgress(false);
  return getCoopTutorialState();
}

export function markCoopTutorialEvent(eventId) {
  if (!tutorial.active || !eventId) return getCoopTutorialState();
  const current = COOP_TUTORIAL_STEPS[tutorial.stepIndex] ?? null;
  if (current?.requiredEvent !== eventId) return getCoopTutorialState();
  tutorial.completedEvents.add(String(eventId));
  writeProgress(false);
  return getCoopTutorialState();
}

export function advanceCoopTutorial() {
  const state = getCoopTutorialState();
  if (!state.active) return { ok: false, reason: 'Co-op tour is not active' };
  if (!state.canContinue) return { ok: false, reason: state.current?.status ?? 'Complete the current objective first' };
  if (state.current?.readyToFinish || tutorial.stepIndex >= COOP_TUTORIAL_STEPS.length - 1) {
    return completeCoopTutorial();
  }
  tutorial.stepIndex += 1;
  writeProgress(false);
  return { ok: true, advanced: true, ...getCoopTutorialState() };
}

export function completeCoopTutorial() {
  tutorial.active = false;
  tutorial.complete = true;
  writeProgress(true);
  return { ok: true, complete: true, ...getCoopTutorialState() };
}

export function dismissCoopTutorial() {
  return completeCoopTutorial();
}

export function restartCoopTutorial() {
  return beginCoopTutorial({ force: true });
}

export function getCoopTutorialState() {
  const base = tutorial.active ? COOP_TUTORIAL_STEPS[tutorial.stepIndex] ?? null : null;
  const current = base ? {
    ...base,
    input: base.input ?? (base.controlActionId ? formatControlAction(base.controlActionId) : ''),
    instruction: base.input ?? (base.controlActionId ? formatControlAction(base.controlActionId) : ''),
  } : null;
  const canContinue = !!current && (!current.requiredEvent || tutorial.completedEvents.has(current.requiredEvent));
  return {
    version: COOP_TUTORIAL_VERSION,
    active: tutorial.active,
    step: current?.id ?? null,
    stepIndex: tutorial.stepIndex,
    totalSteps: COOP_TUTORIAL_STEPS.length,
    canContinue,
    complete: !tutorial.active && (tutorial.complete || readCompletion()),
    current: current ? {
      ...current,
      index: tutorial.stepIndex,
      status: canContinue && current.requiredEvent
        ? 'Confirmed — continue when ready.'
        : current.statusPending,
    } : null,
  };
}
