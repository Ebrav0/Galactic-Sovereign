// Required first-command curriculum. Steps advance from authoritative game
// state; presentation is handled by the coach UI.

import { ensureCampaign, startTutorial } from './campaign.js';
import { getGraph, getSystems } from './galaxy-scope.js';
import {
  hasOutpost,
  hasShipyard,
  planetPosition,
  systemById,
} from './state.js';
import { hasIntel } from './intel.js';
import {
  TUTORIAL_CURRICULUM_VERSION,
  TUTORIAL_STEP_IDS,
  tutorialStepIndex,
} from './tutorial-access.js';
import { formatControlAction } from './control-registry.js';
import { defineTutorialCourse } from './tutorial-course.js';
import { updateTutorialCourseProgress } from './profile.js';

export const TUTORIAL_STEPS = Object.freeze([
  {
    id: 'command_overview',
    module: '1 · Screen orientation',
    title: 'Welcome to your command screen',
    objective: 'Use the notification toggle on the right once.',
    input: 'Click the + / − beside Comms Log',
    why: 'Alerts report finished construction, battles, discoveries, and problems that need your attention.',
    expected: 'The right-side notification list changes between expanded and collapsed.',
    recovery: 'Choose “Show me” to highlight the notification control.',
    actionLabel: 'Show notifications',
    uiTargetId: 'notification-toggle',
    placement: 'left',
  },
  {
    id: 'time_controls',
    module: '1 · Screen orientation',
    title: 'Pause before making decisions',
    objective: 'Pause and resume the simulation once.',
    controlActionId: 'pause',
    why: 'Singleplayer time can stop while you read panels or prepare an order.',
    expected: 'The top button changes between Pause and Resume.',
    recovery: 'Click the highlighted Pause button if the keyboard shortcut does not respond.',
    actionLabel: 'Show time control',
    uiTargetId: 'pause-btn',
    placement: 'bottom',
  },
  {
    id: 'movement',
    module: '2 · Flight and camera',
    title: 'Fly your flagship',
    objective: 'Apply thrust in any direction.',
    input: 'W / A / S / D or the arrow keys',
    why: 'Your flagship is your personal command ship and must physically travel through each system.',
    expected: 'The flagship moves and its engine trail appears.',
    recovery: 'Return to System view, click the game map, then hold an arrow key.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
  },
  {
    id: 'select_orbit_body',
    module: '2 · Flight and camera',
    title: 'Select a world',
    objective: 'Left-click the highlighted habitable world.',
    controlActionId: 'select',
    why: 'Selection opens that object’s information and available actions in the side panels.',
    expected: 'A selection ring appears and the construction panel names the world.',
    recovery: 'Choose “Show me” to center the camera and highlight a valid world.',
    actionLabel: 'Show orbit world',
    uiTargetId: 'game-canvas',
    placement: 'right',
  },
  {
    id: 'enter_orbit',
    module: '2 · Flight and camera',
    title: 'Enter orbit',
    objective: 'With the highlighted world selected, press O to enter orbit.',
    controlActionId: 'orbit',
    why: 'Orbit keeps your flagship moving safely around a selected body while you manage the empire.',
    expected: 'The flagship location reads “orbiting” and follows a circular path.',
    recovery: 'Keep the world selected and move closer if Command reports that the body is out of range.',
    actionLabel: 'Show orbit target',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
  },
  {
    id: 'exit_orbit',
    module: '2 · Flight and camera',
    title: 'Leave orbit',
    objective: 'Press O again to disengage orbit.',
    controlActionId: 'orbit',
    why: 'You must leave orbit before manually flying to another location.',
    expected: 'The “orbiting” label disappears and manual thrust becomes available.',
    recovery: 'Press O while still in System view; the selected body can remain selected.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
  },
  {
    id: 'camera_pan',
    module: '2 · Flight and camera',
    title: 'Pan the camera',
    objective: 'Drag the map or middle-drag to look away from the flagship.',
    controlActionId: 'pan',
    why: 'Panning lets you inspect planets, battles, and structures elsewhere in the system.',
    expected: 'The map moves independently from the flagship.',
    recovery: 'Drag on empty map space rather than on a panel.',
    uiTargetId: 'game-canvas',
    placement: 'right',
  },
  {
    id: 'camera_zoom',
    module: '2 · Flight and camera',
    title: 'Zoom the camera',
    objective: 'Use the mouse wheel to zoom in or out.',
    controlActionId: 'zoom',
    why: 'Zoom in for precise selections and out for system awareness.',
    expected: 'Planets and ships change size while the cursor stays over the same location.',
    recovery: 'Move the pointer over the map before using the wheel.',
    uiTargetId: 'game-canvas',
    placement: 'right',
  },
  {
    id: 'camera_follow',
    module: '2 · Flight and camera',
    title: 'Find your flagship again',
    objective: 'Press F to recenter and follow your flagship.',
    controlActionId: 'follow',
    why: 'Follow is the fastest recovery whenever the camera becomes lost.',
    expected: 'The camera snaps back to the flagship and tracks it.',
    recovery: 'Use the Flagship location chip at the top to confirm which system it occupies.',
    uiTargetId: 'flagship-loc',
    placement: 'bottom',
  },
  {
    id: 'galaxy_view',
    module: '3 · Maps and navigation',
    title: 'Open the Galaxy map',
    objective: 'Press M or click Galaxy Map.',
    controlActionId: 'toggle_view',
    why: 'System view handles local flight and construction; Galaxy view handles routes between stars.',
    expected: 'The screen changes to a network of star systems and travel lanes.',
    recovery: 'Click the highlighted Galaxy Map button.',
    actionLabel: 'Show map button',
    uiTargetId: 'view-toggle-btn',
    placement: 'bottom',
  },
  {
    id: 'inspect_star',
    module: '3 · Maps and navigation',
    title: 'Inspect without travelling',
    objective: 'Double-click the highlighted neighboring star.',
    controlActionId: 'inspect_star',
    why: 'Double-click changes what you are viewing without ordering your flagship to move.',
    expected: 'System view opens on that star while the flagship remains at home.',
    recovery: 'Return to Galaxy view with M, then double-click the cyan training marker.',
    actionLabel: 'Show neighboring star',
    uiTargetId: 'game-canvas',
    placement: 'right',
  },
  {
    id: 'map_ping',
    module: '3 · Maps and navigation',
    title: 'Mark a location',
    objective: 'Press P or right-click the map once.',
    controlActionId: 'ping',
    why: 'Pings mark intent in multiplayer and provide a harmless location marker during training.',
    expected: 'A ping confirmation appears without issuing a travel order.',
    recovery: 'Press P while the map has focus.',
    uiTargetId: 'deck-breadcrumb',
    placement: 'top',
  },
  {
    id: 'system_return',
    module: '3 · Maps and navigation',
    title: 'Return to your Stronghold',
    objective: 'Open your Stronghold in System view.',
    input: 'Click “Return home”, or Galaxy Map (M) then double-click your home star',
    why: 'Inspecting a neighbor left you looking elsewhere — construction starts at home. Pressing M alone only flips the map; it does not change which system you are viewing.',
    expected: 'System view shows your Stronghold (home badge) again.',
    recovery: 'Click “Return home” on this coach. Or press M for Galaxy, then double-click your Stronghold star.',
    actionLabel: 'Return home',
    uiTargetId: 'game-canvas',
    placement: 'right',
  },
  {
    id: 'resources_costs',
    module: '4 · First empire actions',
    title: 'Read credits and income',
    objective: 'Click the ? beside Credits and Income at the top.',
    input: 'Click Explain credits and income',
    why: 'Credits pay for structures and ships; income replenishes them over time. Disabled actions explain missing costs or prerequisites.',
    expected: 'A short resource explanation appears and the build site is prepared.',
    recovery: 'Choose “Show me” to highlight the resource strip.',
    actionLabel: 'Show resources',
    uiTargetId: 'resource-explain-btn',
    placement: 'bottom',
  },
  {
    id: 'build_outpost',
    module: '4 · First empire actions',
    title: 'Establish an Outpost',
    objective: 'Build an outpost on the highlighted Stronghold world.',
    input: 'Select the world, then click Build Outpost',
    why: 'Outposts generate credits and cargo. Moons improve their output.',
    expected: 'A construction job appears, then the outpost comes online.',
    recovery: 'Use “Show build site”; unavailable buttons explain their exact requirement.',
    actionLabel: 'Show build site',
    uiTargetId: 'build-outpost-btn',
    placement: 'left',
  },
  {
    id: 'review_logistics',
    module: '4 · First empire actions',
    title: 'Review Logistics',
    objective: 'Open Logistics and inspect your first export depot.',
    input: 'Click Logistics in the navigation rail',
    why: 'Cargo moves through depots and convoys to Trade Nexuses for credits.',
    expected: 'The Logistics panel opens and shows current routes or their prerequisites.',
    recovery: 'Choose “Open Logistics” to focus the correct tab.',
    actionLabel: 'Open Logistics',
    uiTargetId: 'tab-logistics',
    placement: 'top',
  },
  {
    id: 'build_shipyard',
    module: '4 · First empire actions',
    title: 'Build an Orbital Shipyard',
    objective: 'Commission a shipyard beside the outpost.',
    input: 'Select the outpost world, then click Build Shipyard',
    why: 'Shipyards fulfill the empire-wide production queue and deliver completed hulls.',
    expected: 'A shipyard construction job finishes beside the world.',
    recovery: 'Use “Show shipyard site” to restore the correct selection.',
    actionLabel: 'Show shipyard site',
    uiTargetId: 'build-shipyard-btn',
    placement: 'left',
  },
  {
    id: 'launch_scout',
    module: '4 · First empire actions',
    title: 'Launch a Scout',
    objective: 'Queue a scout and wait for it to launch.',
    input: 'Click Queue Scout and keep time running',
    why: 'Scouts reveal ownership, planets, threats, and capture requirements before your fleet commits.',
    expected: 'The Empire Build Queue completes and a scout appears in the roster.',
    recovery: 'If production is paused, resume time with Space.',
    actionLabel: 'Show scout queue',
    uiTargetId: 'queue-scout-btn',
    placement: 'left',
  },
  {
    id: 'scout_frontier',
    module: '5 · First expansion and battle',
    title: 'Survey the Frontier',
    objective: 'Send the scout to the cyan-marked neighboring system.',
    controlActionId: 'scout_dispatch',
    why: 'Scouting reveals threats before valuable ships commit.',
    expected: 'The scout travels, then the target system displays intel.',
    recovery: 'Select the scout in the roster, open Galaxy view, and Shift-click the cyan marker.',
    actionLabel: 'Show target',
    uiTargetId: 'tab-galaxy',
    placement: 'bottom',
  },
  {
    id: 'assemble_escort',
    module: '5 · First expansion and battle',
    title: 'Assemble an Escort',
    objective: 'Queue a corvette and wait for it to join your fleet.',
    input: 'Queue Corvette from the shipyard or production panel',
    why: 'Combat hulls protect the flagship and provide capture force after battle.',
    expected: 'A corvette finishes and appears in Fleet Command.',
    recovery: 'Keep time running and check the Empire Build Queue for cost or capacity errors.',
    actionLabel: 'Open Fleet Command',
    uiTargetId: 'queue-corvette-btn',
    placement: 'right',
  },
  {
    id: 'open_fleet',
    module: '5 · First expansion and battle',
    title: 'Open Fleet Command',
    objective: 'Open Fleet and inspect the new escort.',
    input: 'Click Fleet in the navigation rail',
    why: 'Fleet Command organizes combat ships, doctrines, formations, and group travel.',
    expected: 'The Fleet panel opens and lists the corvette.',
    recovery: 'Choose “Open Fleet” to focus the correct tab.',
    actionLabel: 'Open Fleet',
    uiTargetId: 'tab-fleet',
    placement: 'top',
  },
  {
    id: 'travel_to_battle',
    module: '5 · First expansion and battle',
    title: 'Set a Battle Course',
    objective: 'Send the flagship and its escort to the surveyed system.',
    controlActionId: 'travel',
    why: 'A normal star click orders flagship travel; Training Command routes the home escort alongside it.',
    expected: 'A route and ETA appear, followed by arrival at the training contact.',
    recovery: 'Open Galaxy view and single-click the cyan training marker.',
    actionLabel: 'Show destination',
    uiTargetId: 'tab-galaxy',
    placement: 'bottom',
  },
  {
    id: 'win_first_battle',
    module: '5 · First expansion and battle',
    title: 'Win the Engagement',
    objective: 'Select your ships, issue an Attack order, resume time, and destroy the training raider.',
    input: 'Left-click friendlies · Attack · right-click enemy · Space',
    why: 'Tactical battles accept direct orders when your flagship is present.',
    expected: 'The selected ships focus fire and destroy the training raider.',
    recovery: 'Pause, click a friendly ship, choose Attack, click the raider, then resume.',
    actionLabel: 'Show battle',
    uiTargetId: 'combat-hud-attack',
    placement: 'right',
  },
  {
    id: 'capture_first_system',
    module: '5 · First expansion and battle',
    title: 'Claim the System',
    objective: 'Hold the cleared system for five seconds.',
    input: 'Keep friendly force present and time running',
    why: 'Capture progresses only while sufficient friendly force is present and no enemy contests the system.',
    expected: 'The capture meter fills and the system changes to player control.',
    recovery: 'Resume time and keep the flagship and escort inside the cleared system.',
    actionLabel: 'Show capture status',
    uiTargetId: 'capture-panel-body',
    placement: 'right',
  },
  {
    id: 'graduation',
    module: '5 · First expansion and battle',
    title: 'Sovereign Command Granted',
    objective: 'Your first expansion loop is complete.',
    input: 'Choose Finish Foundations',
    why: 'You now know how to fly, orbit, navigate, build, scout, fight, and recover.',
    expected: 'Normal modes unlock and optional feature chapters appear as systems become relevant.',
    recovery: 'Foundations and every control remain replayable from Controls & Tutorials.',
    actionLabel: null,
    uiTargetId: 'tab-campaign',
    placement: 'top',
  },
]);

export const FOUNDATIONS_COURSE = defineTutorialCourse({
  id: 'foundations',
  version: TUTORIAL_CURRICULUM_VERSION,
  mode: 'solo',
  title: 'Sovereign Foundations',
  steps: TUTORIAL_STEPS,
});

const STEP_EVENT_REQUIREMENTS = Object.freeze({
  command_overview: 'notification_opened',
  time_controls: 'pause_toggled',
  movement: 'movement',
  select_orbit_body: 'body_selected',
  enter_orbit: 'orbit_entered',
  exit_orbit: 'orbit_exited',
  camera_pan: 'camera_panned',
  camera_zoom: 'camera_zoomed',
  camera_follow: 'camera_followed',
  galaxy_view: 'galaxy_viewed',
  inspect_star: 'star_inspected',
  map_ping: 'map_pinged',
  system_return: 'stronghold_returned',
  resources_costs: 'resources_inspected',
  open_fleet: 'fleet_opened',
});

function tutorialState(state) {
  ensureCampaign(state);
  return state.campaign.tutorial;
}

function tutorialTargetSystemId(state) {
  const tutorial = tutorialState(state);
  const saved = tutorial.targetSystemId;
  if (saved && systemById(state, saved)) return saved;

  const graph = getGraph(state);
  const systems = getSystems(state);
  const candidates = [];
  for (const [a, b] of graph?.lanes ?? []) {
    if (a === state.stronghold) candidates.push(b);
    if (b === state.stronghold) candidates.push(a);
  }
  const viable = candidates
    .filter((id) => id !== 'core' && systems[id]?.star?.kind !== 'trade_nexus')
    .sort((a, b) => String(a).localeCompare(String(b)));
  const target = viable.find((id) => systems[id]?.owner === 'neutral')
    ?? viable.find((id) => systems[id]?.owner !== 'ai')
    ?? viable[0]
    ?? null;
  tutorial.targetSystemId = target;
  return target;
}

function homeBuildBody(state, predicate) {
  const home = systemById(state, state.stronghold);
  return home?.bodies.find((body) => body.type !== 'gas' && body.type !== 'barren' && predicate(body)) ?? null;
}

function homeOrbitBody(state) {
  const home = systemById(state, state.stronghold);
  const f = state.flagship;
  return [...(home?.bodies ?? [])]
    .map((body) => ({
      body,
      pos: planetPosition(body, state.time),
    }))
    .filter((entry) => entry.pos)
    .sort((a, b) => (
      Math.hypot(a.pos.x - f.x, a.pos.y - f.y)
      - Math.hypot(b.pos.x - f.x, b.pos.y - f.y)
    ))[0]?.body ?? null;
}

function homeOutpostBody(state) {
  return homeBuildBody(state, (body) => hasOutpost(state, state.stronghold, body.id));
}

function homeShipyardBody(state) {
  return homeBuildBody(state, (body) => hasShipyard(state, state.stronghold, body.id));
}

function hasHomeOutpost(state) {
  return !!homeOutpostBody(state);
}

function hasHomeShipyard(state) {
  return !!homeShipyardBody(state);
}

function hasScout(state) {
  return (state.scouts ?? []).length > 0;
}

function hasCombatShip(state) {
  return (state.playerShips ?? []).some((ship) => ship.hp > 0 && ship.hull && ship.hull !== 'scout');
}

function targetOwnedByPlayer(state, targetId) {
  return systemById(state, targetId)?.owner === 'player';
}

function targetName(state, targetId) {
  return systemById(state, targetId)?.name ?? 'the marked neighboring system';
}

function eventCount(state, eventId) {
  return Number(tutorialState(state).events?.[eventId]?.count ?? 0);
}

function canAdvance(state, stepId, targetId) {
  const flags = tutorialState(state).flags;
  if (stepId === 'command_overview') return eventCount(state, 'notification_opened') > 0;
  if (stepId === 'time_controls') return eventCount(state, 'pause_toggled') >= 2 && !state.paused;
  if (stepId === 'movement') return eventCount(state, 'movement') > 0;
  if (stepId === 'select_orbit_body') return eventCount(state, 'body_selected') > 0;
  if (stepId === 'enter_orbit') return eventCount(state, 'orbit_entered') > 0;
  if (stepId === 'exit_orbit') return eventCount(state, 'orbit_exited') > 0;
  if (stepId === 'camera_pan') return eventCount(state, 'camera_panned') > 0;
  if (stepId === 'camera_zoom') return eventCount(state, 'camera_zoomed') > 0;
  if (stepId === 'camera_follow') return eventCount(state, 'camera_followed') > 0;
  if (stepId === 'galaxy_view') return eventCount(state, 'galaxy_viewed') > 0;
  if (stepId === 'inspect_star') return eventCount(state, 'star_inspected') > 0;
  if (stepId === 'map_ping') return eventCount(state, 'map_pinged') > 0;
  if (stepId === 'system_return') return eventCount(state, 'stronghold_returned') > 0;
  if (stepId === 'resources_costs') return eventCount(state, 'resources_inspected') > 0;
  if (stepId === 'build_outpost') return hasHomeOutpost(state);
  if (stepId === 'review_logistics') return flags.logisticsOpened;
  if (stepId === 'build_shipyard') return hasHomeShipyard(state);
  if (stepId === 'launch_scout') return hasScout(state);
  if (stepId === 'scout_frontier') return hasIntel(state, targetId);
  if (stepId === 'assemble_escort') return hasCombatShip(state);
  if (stepId === 'open_fleet') return eventCount(state, 'fleet_opened') > 0;
  if (stepId === 'travel_to_battle') return flags.battlePrepared;
  if (stepId === 'win_first_battle') return flags.battleCommandIssued && flags.battleWon;
  if (stepId === 'capture_first_system') return targetOwnedByPlayer(state, targetId);
  return false;
}

function statusForStep(state, stepId, targetId) {
  const flags = tutorialState(state).flags;
  const target = targetName(state, targetId);
  const eventStatus = {
    command_overview: 'Use the Comms Log + / − control on the right.',
    time_controls: state.paused
      ? 'Paused — press Space or Resume to restart the simulation.'
      : 'Pause once, then resume so play can continue.',
    movement: 'Apply thrust with W/A/S/D or an arrow key.',
    select_orbit_body: 'Select the highlighted habitable world.',
    enter_orbit: 'Press O with the world selected.',
    exit_orbit: 'Press O again to disengage.',
    camera_pan: 'Drag empty map space or middle-drag.',
    camera_zoom: 'Use the mouse wheel over the map.',
    camera_follow: 'Press F to find the flagship.',
    galaxy_view: 'Press M to open the Galaxy map.',
    inspect_star: `Double-click ${target} to inspect it without travelling.`,
    map_ping: 'Press P or right-click the map.',
    system_return: 'Open the Stronghold system — “Return home”, or M then double-click home.',
    resources_costs: 'Click the Credits and Income strip.',
    open_fleet: 'Open Fleet Command and inspect the escort.',
  };
  if (eventStatus[stepId]) return canAdvance(state, stepId, targetId)
    ? 'Confirmed — moving to the next lesson.'
    : eventStatus[stepId];
  if (stepId === 'build_outpost') return hasHomeOutpost(state) ? 'Outpost online.' : 'Select the highlighted habitable world.';
  if (stepId === 'review_logistics') return flags.logisticsOpened ? 'Logistics reviewed.' : 'Open Logistics to inspect cargo flow.';
  if (stepId === 'build_shipyard') return hasHomeShipyard(state) ? 'Shipyard commissioned.' : 'Build beside the Stronghold outpost.';
  if (stepId === 'launch_scout') return hasScout(state) ? 'Scout ready.' : 'Queue a scout and keep time running.';
  if (stepId === 'scout_frontier') return hasIntel(state, targetId) ? `${target} surveyed.` : `Dispatch the scout to ${target}.`;
  if (stepId === 'assemble_escort') return hasCombatShip(state) ? 'Escort ready.' : 'Queue a corvette and wait for delivery.';
  if (stepId === 'travel_to_battle') return flags.battlePrepared ? `Training contact at ${target}.` : `Send the flagship to ${target}.`;
  if (stepId === 'win_first_battle') {
    if (flags.battleWon) return 'Training raider destroyed.';
    return flags.battleCommandIssued ? 'Attack order accepted — resume time.' : 'Select friendlies and issue an Attack order.';
  }
  if (stepId === 'capture_first_system') return targetOwnedByPlayer(state, targetId) ? `${target} secured.` : 'Hold uncontested for five seconds.';
  return 'Training complete. Choose the shape of your campaign.';
}

function currentStep(state) {
  const tutorial = tutorialState(state);
  const index = Math.max(0, tutorialStepIndex(tutorial.currentStepId));
  const base = TUTORIAL_STEPS[index] ?? null;
  if (!base) return null;
  const targetSystemId = tutorialTargetSystemId(state);
  return {
    ...base,
    courseId: 'foundations',
    instruction: base.input ?? (base.controlActionId ? formatControlAction(base.controlActionId) : ''),
    input: base.input ?? (base.controlActionId ? formatControlAction(base.controlActionId) : ''),
    index,
    targetSystemId,
    targetName: targetName(state, targetSystemId),
    status: statusForStep(state, base.id, targetSystemId),
    canConfirm: false,
    readyToFinish: base.id === 'graduation',
  };
}

export function getTutorialState(state) {
  const tutorial = tutorialState(state);
  const active = state.campaign.mode === 'tutorial' && tutorial.status === 'active';
  return {
    active,
    status: tutorial.status,
    step: tutorial.currentStepId,
    stepIndex: tutorialStepIndex(tutorial.currentStepId),
    totalSteps: TUTORIAL_STEPS.length,
    targetSystemId: tutorial.targetSystemId,
    current: active ? currentStep(state) : null,
    graduationPending: tutorial.graduationPending,
    completedAt: tutorial.completedAt,
  };
}

export function getTutorialFocus(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.status !== 'active') return null;
  const stepId = tutorial.currentStepId;
  const targetSystemId = tutorialTargetSystemId(state);
  if ([
    'command_overview',
    'time_controls',
    'movement',
    'camera_pan',
    'camera_zoom',
    'camera_follow',
    'system_return',
    'resources_costs',
    'build_outpost',
  ].includes(stepId)) {
    const body = homeBuildBody(state, (candidate) => !hasOutpost(state, state.stronghold, candidate.id))
      ?? homeOutpostBody(state)
      ?? homeBuildBody(state, () => true);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : { view: 'system', systemId: state.stronghold };
  }
  if (['select_orbit_body', 'enter_orbit', 'exit_orbit'].includes(stepId)) {
    const body = homeOrbitBody(state);
    return body ? { view: 'system', systemId: state.stronghold, bodyId: body.id } : { view: 'system', systemId: state.stronghold };
  }
  if (stepId === 'review_logistics') return { view: 'system', systemId: state.stronghold, panel: 'logistics' };
  if (['build_shipyard', 'launch_scout', 'assemble_escort', 'open_fleet'].includes(stepId)) {
    const body = homeShipyardBody(state) ?? homeOutpostBody(state);
    return body
      ? { view: 'system', systemId: state.stronghold, bodyId: body.id, panel: stepId === 'open_fleet' ? 'fleet' : null }
      : { view: 'system', systemId: state.stronghold, panel: stepId === 'open_fleet' ? 'fleet' : null };
  }
  if (['galaxy_view', 'inspect_star', 'map_ping', 'scout_frontier', 'travel_to_battle'].includes(stepId)) {
    return targetSystemId ? { view: 'galaxy', systemId: targetSystemId } : null;
  }
  if (['win_first_battle', 'capture_first_system'].includes(stepId)) {
    return targetSystemId ? { view: 'system', systemId: targetSystemId, showIntel: true } : null;
  }
  return { view: 'system', systemId: state.stronghold, panel: 'campaign' };
}

export function markTutorialSystemViewed(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode === 'tutorial') tutorial.flags.systemViewed = true;
}

export function recordTutorialEvent(state, eventId, detail = {}) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.status !== 'active' || !eventId) return null;
  if (STEP_EVENT_REQUIREMENTS[tutorial.currentStepId] !== eventId) return null;
  tutorial.events ??= {};
  const prior = tutorial.events[eventId] ?? { count: 0 };
  tutorial.events[eventId] = {
    count: Number(prior.count ?? 0) + 1,
    at: state.time,
    detail: detail && typeof detail === 'object' ? { ...detail } : {},
  };
  return tryAdvanceTutorial(state);
}

export function markTutorialTimeToggled(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode === 'tutorial') tutorial.flags.timeToggled = true;
}

export function markTutorialLogisticsOpened(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode === 'tutorial') tutorial.flags.logisticsOpened = true;
}

export function markTutorialBattlePrepared(state) {
  const tutorial = tutorialState(state);
  tutorial.flags.battlePrepared = true;
  return setTutorialStep(state, 'win_first_battle');
}

export function markTutorialBattleCommand(state) {
  const tutorial = tutorialState(state);
  tutorial.flags.battleCommandIssued = true;
}

export function markTutorialBattleResolved(state, playerWon) {
  const tutorial = tutorialState(state);
  tutorial.flags.battleWon = playerWon === true;
  tutorial.flags.battleFailed = playerWon !== true;
  if (playerWon) return setTutorialStep(state, 'capture_first_system');
  return { ok: true, failed: true };
}

export function tutorialNeedsBattlePreparation(state, systemId) {
  const tutorial = tutorialState(state);
  return state.campaign.mode === 'tutorial'
    && tutorial.status === 'active'
    && tutorial.currentStepId === 'travel_to_battle'
    && tutorial.targetSystemId === systemId
    && !tutorial.flags.battlePrepared;
}

export function setTutorialStep(state, step) {
  const tutorial = tutorialState(state);
  const stepId = Number.isInteger(step) ? TUTORIAL_STEP_IDS[step] : step;
  if (!TUTORIAL_STEP_IDS.includes(stepId)) return { ok: false, reason: 'Invalid tutorial step' };
  tutorial.status = 'active';
  tutorial.currentStepId = stepId;
  tutorial.graduationPending = false;
  state.campaign.mode = 'tutorial';
  tutorialTargetSystemId(state);
  return { ok: true, step: stepId, stepIndex: tutorialStepIndex(stepId) };
}

export function tryAdvanceTutorial(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.status !== 'active') return null;
  const index = tutorialStepIndex(tutorial.currentStepId);
  if (index < 0 || index >= TUTORIAL_STEP_IDS.length - 1) return null;
  const targetSystemId = tutorialTargetSystemId(state);
  if (!canAdvance(state, tutorial.currentStepId, targetSystemId)) return null;
  if (!tutorial.completedStepIds.includes(tutorial.currentStepId)) {
    tutorial.completedStepIds.push(tutorial.currentStepId);
  }
  tutorial.currentStepId = TUTORIAL_STEP_IDS[index + 1];
  updateTutorialCourseProgress('foundations', {
    status: 'in_progress',
    currentStepId: tutorial.currentStepId,
    completedStepIds: tutorial.completedStepIds,
  }).catch(() => {});
  return { advanced: true, step: tutorial.currentStepId, stepIndex: index + 1 };
}

export function acknowledgeTutorialStep(state) {
  const advanced = tryAdvanceTutorial(state);
  return advanced ? { ok: true, ...advanced } : { ok: false, reason: 'Complete the current objective first' };
}

export function beginTutorialGraduation(state) {
  const tutorial = tutorialState(state);
  if (state.campaign.mode !== 'tutorial' || tutorial.currentStepId !== 'graduation') {
    return { ok: false, reason: 'Complete the tutorial first' };
  }
  tutorial.status = 'graduation_pending';
  tutorial.graduationPending = true;
  tutorial.completedAt = state.time;
  return { ok: true, graduationPending: true };
}

export function completeTutorialGraduation(state, { victoryType = 'sandbox', aiDifficulty = 'normal' } = {}) {
  const tutorial = tutorialState(state);
  if (!tutorial.graduationPending) return { ok: false, reason: 'Graduation is not pending' };
  tutorial.status = 'complete';
  tutorial.graduationPending = false;
  tutorial.currentStepId = 'graduation';
  state.campaign.mode = 'sandbox';
  state.campaign.tutorialCompletedAt = tutorial.completedAt;
  state.campaign.victoryType = victoryType;
  state.campaign.defeated = false;
  state.campaign.won = false;
  state.aiDifficulty = aiDifficulty;
  return { ok: true, victoryType, aiDifficulty };
}

/** Dev / skip path: end Academy immediately and leave a free sandbox run. */
export function forceGraduateTutorial(state, { victoryType = 'sandbox', aiDifficulty = null } = {}) {
  const tutorial = tutorialState(state);
  tutorial.completedStepIds = [...TUTORIAL_STEP_IDS];
  tutorial.currentStepId = 'graduation';
  tutorial.status = 'complete';
  tutorial.graduationPending = false;
  tutorial.completedAt = state.time;
  tutorial.replay = false;
  state.campaign.mode = 'sandbox';
  state.campaign.tutorialCompletedAt = state.time;
  state.campaign.victoryType = victoryType;
  state.campaign.defeated = false;
  state.campaign.won = false;
  if (aiDifficulty) state.aiDifficulty = aiDifficulty;
  return { ok: true, mode: 'sandbox', victoryType };
}

export function finishTutorial(state, { skipped = false, allowReplayExit = false } = {}) {
  if (skipped && !allowReplayExit) return { ok: false, reason: 'Tutorial graduation is required' };
  if (skipped) {
    return forceGraduateTutorial(state);
  }
  return beginTutorialGraduation(state);
}

export function initTutorial(state, { replay = false } = {}) {
  const result = startTutorial(state);
  const tutorial = tutorialState(state);
  tutorial.version = TUTORIAL_CURRICULUM_VERSION;
  tutorial.status = 'active';
  tutorial.currentStepId = TUTORIAL_STEP_IDS[0];
  tutorial.completedStepIds = [];
  tutorial.targetSystemId = null;
  tutorial.flags = {
    systemViewed: false,
    timeToggled: false,
    logisticsOpened: false,
    battlePrepared: false,
    battleCommandIssued: false,
    battleWon: false,
    battleFailed: false,
  };
  tutorial.graduationPending = false;
  tutorial.completedAt = null;
  tutorial.replay = replay === true;
  tutorial.events = {};
  state.credits = Math.max(state.credits ?? 0, 2500);
  tutorialTargetSystemId(state);
  updateTutorialCourseProgress('foundations', {
    status: 'in_progress',
    currentStepId: tutorial.currentStepId,
    completedStepIds: [],
  }).catch(() => {});
  return result;
}
