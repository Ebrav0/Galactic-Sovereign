// Boot + loop wiring + test hooks. Wiring only — no balance or game logic here.

import { TICK_MS, AUTOSAVE_INTERVAL_MS, DEFAULT_SEED, SCOUT_BUILD_MS, CAMERA_DEFAULT_ZOOM, HULL_STATS, PIRATE_FLEET_COUNT, PIRATE_WANDER_MS, SAVE_VERSION, SHELL_SAILS_REQUIRED } from './constants.js';
import {
  createNewGame,
  systemById,
  findPlanet,
  hasOutpost,
  hasShipyard,
  findShipyardOnPlanet,
  isPlayerOwned,
  hasFoundry,
  launcherCountOnBody,
  dysonSummary,
  ensureDyson,
  planetPosition,
  foundryHostPlanet,
} from './state.js';
import { step, advance, togglePaused } from './simulation.js';
import { buildOutpost, canBuildOutpost, incomePerSecond, incomePerSecondInSystem, resetStructureIds } from './economy.js';
import {
  buildShipyard,
  queueScout,
  queueHull,
  canBuildShipyard,
  canQueueScout,
  canQueueHull,
  shipyardBuildProgress,
  activeCombatQueues,
} from './production.js';
import { setFlagshipInput, orderTravel, transitStatus, transitEtaMs, toggleFlagshipOrbit, isFlagshipOrbiting, orbitTargetLabel } from './flagship.js';
import {
  orderScoutTravel,
  scoutEtaMs,
  scoutStatus,
  findScout,
  resetScoutIds,
  idleScouts,
} from './scout.js';
import { gatherIntel, hasIntel, scoutedCount } from './intel.js';
import {
  captureRequirement,
  captureForceInSystem,
  captureProgressMs,
  canHoldCapture,
  enemyCombatPresence,
} from './capture.js';
import { spawnPirateFleets, forcePirateIntoSystem, pirateSystemsWithPresence, resetPirateIds, pirateFleetAtSystem } from './pirates.js';
import { orderShipTravel, resetShipIds, findPlayerShip, playerShipsAtSystem } from './fleets.js';
import {
  createBattleGroup,
  deleteBattleGroup,
  assignShipToGroup,
  orderBattleGroupTravel,
  resetBattleGroupIds,
  battleGroupsForGalaxy,
  formatFleetName,
} from './battle-groups.js';
import { battleSummaryForSystem, getBattleState, setBattleStance, checkBattleTrigger } from './combat.js';
import { activeShuttleCount, shuttlePositions } from './shuttles.js';
import { outpostSurfaceSites } from './surface-structures.js';
import { structureSites } from './structure-sites.js';
import { activeSailShuttleCount, foundryAnchor, computeFoundryRingRadius, sailShuttlePositions } from './sail-shuttles.js';
import { dysonVisualSummary, pointNearSupplySegment } from './dyson-visuals.js';
import {
  buildFoundry,
  buildLauncher,
  canBuildFoundry,
  canBuildLauncher,
  solariiPerSecond,
  solariiPerSecondInSystem,
  forceShellProgress,
} from './dyson.js';
import {
  drawSystem,
  drawGalaxy,
  follow,
  updateFollowCamera,
  snapCameraTo,
  camera,
  galaxyCamera,
} from './render.js';
import { attachInput } from './input.js';
import { writeSlot, readSlot } from './save.js';
import { initUi, toast } from './ui.js';
import { initStarRenderer, resizeStarRenderer } from './gl/star-renderer.js';
import {
  devAction,
  devGrantCredits,
  devForceShellProgress as devForceShell,
  devSpawnFriendlyShips,
  devSpawnEnemyFleet,
} from './dev.js';
import { initDevPanel } from './dev-panel.js';
import { getGraph, getActiveGalaxy, getGalaxyCount, hydratedGalaxyCount, setGalaxyCountForTests, getSystems } from './galaxy-scope.js';
import { graphStats, galaxyGraphFingerprint, setGalaxyStarCountForTests } from './galaxy.js';
import { abstractGalaxySummaries, wormholeSummary } from './abstract-galaxy.js';
import { dehydrateGalaxy, hydrateGalaxy } from './hydration.js';
import {
  orderWormholeTravel,
  buildWormholeAnchor,
  canEnterWormhole,
  wormholeTransitStatus,
  tickWormholeTransit,
  strongholdComposition,
  resetWormholeJumpCounter,
} from './wormholes.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { seedAiFaction } from './ai-faction.js';
import {
  enqueueHull,
  cancelQueueItem,
  pinQueueItem,
  empireQueueSummary,
  resetQueueIds,
  migrateShipyardBuilds,
  listPlayerShipyards,
} from './empire-queue.js';
import { startResearch, researchSummary, buildResearchStation, canBuildResearchStation } from './research.js';
import { buildTradeStation, canBuildTradeStation, tradeSummary } from './trade.js';
import { aiFactionSummary, forceAiCapture, listAiFactions } from './ai-faction.js';
import { resetAiShipIds, aiShipsSummary } from './ai-ships.js';
import { productionSlotSummary } from './production.js';
import { allTechNodes, isTechUnlocked, techPrereqsMet } from './tech-web.js';
import { milestonesSummary, setCompletedDysonsForTest } from './milestones.js';
import {
  buildSuperweaponCradle,
  superweaponCreate,
  superweaponDestroy,
  superweaponJump,
  superweaponSummary,
  completeDysonShellForTest,
  resetSuperweaponIds,
} from './superweapon.js';
import {
  buildHeroFlagship,
  spawnHeroFlagshipForTest,
  setHeroRally,
  orderHeroTravel,
  heroFlagshipsSummary,
  resetHeroFlagshipIds,
} from './hero-flagships.js';
import {
  offerTreaty,
  setRelation,
  diplomacySummary,
} from './diplomacy.js';
import { addTradeRoute, clearTradeRoutes, tradeRoutesSummary } from './trade-routes.js';
import { setVictoryType, checkVictory, checkDefeat, campaignSummary } from './campaign.js';
import { startMission, completeMissionForTest, advanceMissionObjective, missionsSummary } from './missions.js';
import { getTutorialState, setTutorialStep, initTutorial } from './tutorial.js';
import { buildStrategicStructure, strategicStructuresSummary } from './strategic-structures.js';
import { shellShieldBonus, shellRepairBonus } from './dyson.js';
import { setBattleGroupHeroAnchor } from './battle-groups.js';
import { tickContextualTips, resetContextualTips } from './tips.js';

let state = createNewGame(DEFAULT_SEED);
state.pirates = spawnPirateFleets(state);
seedAiFaction(state, state.homeGalaxyId);
let selection = null;
let view = 'system';
let viewedSystemId = state.stronghold;
let lastFlagshipSystemId = state.flagship.systemId;
let selectedScoutId = null;
let selectedBattleGroupId = null;
let galaxyTargetStarId = null;
let tradeRoutePending = null;

const canvas = document.getElementById('game-canvas');
const ctx2d = canvas.getContext('2d');
const glCanvas = document.getElementById('game-canvas-gl');

function resizeCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
  resizeStarRenderer(w, h);
}
window.addEventListener('resize', resizeCanvas);
initStarRenderer(glCanvas);
resizeCanvas();

camera.zoom = CAMERA_DEFAULT_ZOOM;
snapCameraTo(0, 0);

function ensureSelectedScout() {
  if (selectedScoutId && findScout(state, selectedScoutId)) return;
  const idle = idleScouts(state);
  selectedScoutId = idle.length ? idle[idle.length - 1].id : null;
}

function doSelectScout(scoutId) {
  if (scoutId && !findScout(state, scoutId)) return;
  selectedScoutId = scoutId;
  selectedBattleGroupId = null;
}

function doSelectBattleGroup(groupId) {
  if (groupId && !battleGroupsForGalaxy(state).some((g) => g.id === groupId)) return;
  selectedBattleGroupId = groupId;
  selectedScoutId = null;
}

function doDeleteBattleGroup(groupId) {
  const res = deleteBattleGroup(state, groupId);
  if (!res.ok) {
    toast(res.reason, 'error');
    return res;
  }
  if (selectedBattleGroupId === groupId) selectedBattleGroupId = null;
  return res;
}

// --- Actions ---

function doTogglePause() {
  togglePaused(state);
}

function doToggleView() {
  view = view === 'system' ? 'galaxy' : 'system';
  setFlagshipInput(0, 0);
}

function doSetView(v) {
  if (v !== view) doToggleView();
}

function doViewSystem(systemId) {
  if (!systemById(state, systemId)) return;
  viewedSystemId = systemId;
  view = 'system';
  selection = null;
  follow.enabled = false;
  snapCameraTo(0, 0);
}

function doFlagshipInput(x, y) {
  if (view !== 'system') {
    setFlagshipInput(0, 0);
    return;
  }
  setFlagshipInput(x, y);
  if (x !== 0 || y !== 0) follow.enabled = true;
}

function doToggleOrbit() {
  if (view !== 'system') {
    toast('Switch to system view to enter orbit', 'error');
    return;
  }
  const f = state.flagship;
  if (f.systemId !== viewedSystemId) {
    toast('Flagship is not in this system', 'error');
    return;
  }
  const res = toggleFlagshipOrbit(state, selection);
  if (res.ok && res.orbiting) {
    toast(`Stable orbit: ${res.target}`, 'ok');
    follow.enabled = true;
  } else if (res.ok) {
    toast('Orbit disengaged', 'ok');
  } else {
    toast(res.reason, 'error');
  }
}

function doOrderTravel(targetId) {
  const res = orderTravel(state, targetId);
  if (res.ok) {
    const dest = systemById(state, targetId);
    toast(`Course set: ${dest.name} — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doOrderScoutTravel(targetId) {
  ensureSelectedScout();
  if (!selectedScoutId) {
    toast('Build a scout at your shipyard first', 'error');
    return { ok: false, reason: 'Build a scout at your shipyard first' };
  }
  const res = orderScoutTravel(state, selectedScoutId, targetId);
  if (res.ok) {
    const dest = systemById(state, targetId);
    toast(`Scout dispatched to ${dest.name} — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doOrderBattleGroupTravel(targetId) {
  if (!selectedBattleGroupId) {
    toast('Select a fleet in Fleet Command first', 'error');
    return { ok: false, reason: 'Select a fleet in Fleet Command first' };
  }
  const res = orderBattleGroupTravel(state, selectedBattleGroupId, targetId);
  const dest = systemById(state, targetId);
  const destName = dest?.name ?? targetId;
  if (res.ok) {
    const skipNote = res.skipped > 0 ? ` · ${res.skipped} skipped` : '';
    toast(`${res.fleetName}: ${res.dispatched} dispatched to ${destName}${skipNote}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doBuildOutpost(planetId) {
  const res = buildOutpost(state, viewedSystemId, planetId);
  if (res.ok) {
    toast(`Outpost established on ${findPlanet(state, viewedSystemId, planetId).name}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doBuildShipyard(planetId) {
  const res = buildShipyard(state, viewedSystemId, planetId);
  if (res.ok) {
    toast(`Shipyard established on ${findPlanet(state, viewedSystemId, planetId).name}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doQueueScout(shipyardId) {
  const res = queueScout(state, shipyardId, viewedSystemId);
  if (res.ok) {
    toast(`Scout queued (${SCOUT_BUILD_MS / 1000}s)`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doQueueHull(shipyardId, hull) {
  const res = queueHull(state, shipyardId, viewedSystemId, hull);
  if (res.ok) toast(`${hull} queued`, 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doDispatchShip(shipId, starId) {
  const res = orderShipTravel(state, shipId, starId);
  if (res.ok) {
    const dest = systemById(state, starId);
    toast(`Ship dispatched to ${dest?.name ?? starId}`, 'ok');
  } else toast(res.reason, 'error');
  return res;
}

function doBuildFoundry(planetId = selection) {
  const system = systemById(state, viewedSystemId);
  const resolvedId = planetId
    ?? system?.bodies.find((p) => p.type === 'habitable')?.id
    ?? system?.bodies[0]?.id;
  const planet = resolvedId ? findPlanet(state, viewedSystemId, resolvedId) : null;
  const res = buildFoundry(state, viewedSystemId, resolvedId);
  if (res.ok) {
    toast(`Sail Foundry ring established at ${planet?.name ?? 'planet'}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doBuildLauncher(bodyId) {
  const res = buildLauncher(state, viewedSystemId, bodyId);
  if (res.ok) toast('Dyson launcher deployed', 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doEnterWormhole(opts = {}) {
  const res = orderWormholeTravel(state, opts);
  if (res.ok) toast(`Wormhole transit — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doBuildWormholeAnchor(targetGalaxyId) {
  const res = buildWormholeAnchor(state, targetGalaxyId);
  if (res.ok) toast(`Wormhole anchored to ${state.galaxies[targetGalaxyId]?.name ?? targetGalaxyId}`, 'ok');
  else toast(res.reason, 'error');
  return res;
}

async function doSaveSlot(slot) {
  const res = await writeSlot(slot, state);
  toast(res.ok ? `Saved to ${slot}` : `Save failed: ${res.error}`, res.ok ? 'ok' : 'error');
  return res;
}

async function doLoadSlot(slot) {
  const res = await readSlot(slot);
  if (res.ok) {
    doImportState(res.state);
    toast(`Loaded ${slot}`, 'ok');
  } else {
    toast(`Load failed: ${res.error}`, 'error');
  }
  return res;
}

function doImportState(newState) {
  state = newState;
  selection = null;
  viewedSystemId = newState.flagship.systemId ?? newState.stronghold;
  lastFlagshipSystemId = newState.flagship.systemId;
  follow.enabled = true;
  resetStructureIds(state);
  resetScoutIds(state);
  resetShipIds(state);
  resetBattleGroupIds(state);
  resetSuperweaponIds(state);
  resetHeroFlagshipIds(state);
  resetPirateIds(state);
  resetQueueIds(state);
  resetAiShipIds(state);
  migrateShipyardBuilds(state);
  if (!newState.empireQueue) newState.empireQueue = [];
  if (!newState.research) newState.research = { activeNodeId: null, progress: 0, unlocked: ['eco_baseline'], queue: [] };
  if (!newState.aiShips) newState.aiShips = [];
  if (!newState.factions?.ai?.homeSystemId) seedAiFaction(newState, newState.homeGalaxyId ?? 'gal-0');
  if (!newState.pirates?.fleets?.length) {
    newState.pirates = spawnPirateFleets(newState);
  }
  if (!newState.activeGalaxyId) newState.activeGalaxyId = 'gal-0';
  if (!newState.homeGalaxyId) newState.homeGalaxyId = 'gal-0';
  if (!newState.battleGroups) newState.battleGroups = [];
  ensureSelectedScout();
  const f = state.flagship;
  snapCameraTo(f.systemId ? f.x : 0, f.systemId ? f.y : 0);
}

function checkFlagshipArrival() {
  const current = state.flagship.systemId;
  if (current && current !== lastFlagshipSystemId) {
    viewedSystemId = current;
    follow.enabled = true;
    if (view === 'system') snapCameraTo(state.flagship.x, state.flagship.y);
    const name = systemById(state, current)?.name ?? current;
    if (gatherIntel(state, current)) {
      toast(`Intel gathered: ${name}`, 'ok');
    } else {
      toast(`Flagship arrived at ${name}`, 'ok');
    }
  }
  lastFlagshipSystemId = current;
}

// --- UI + input wiring ---

const { updateUi, closeSidePanel } = initUi({
  getState: () => state,
  getSelection: () => selection,
  setSelection: (id) => { selection = id; },
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  getSelectedScoutId: () => selectedScoutId,
  doSelectScout,
  getSelectedBattleGroupId: () => selectedBattleGroupId,
  doSelectBattleGroup,
  createBattleGroup: () => createBattleGroup(state),
  deleteBattleGroup: doDeleteBattleGroup,
  assignShipToGroup: (shipId, groupId) => assignShipToGroup(state, shipId, groupId),
  doBuildOutpost,
  doBuildShipyard,
  doBuildFoundry,
  doBuildLauncher,
  doEnterWormhole,
  doBuildWormholeAnchor,
  doQueueScout,
  doQueueHull,
  doTogglePause,
  doToggleView,
  doSaveSlot,
  doLoadSlot,
  doImportState,
  shipyardBuildProgress,
  hasIntel,
  captureRequirement,
  captureForceInSystem,
  captureProgressMs,
  canHoldCapture,
  enemyCombatPresence,
  battleSummaryForSystem,
  canQueueHull,
  getGalaxyTargetStar: () => galaxyTargetStarId,
  doStartNewGame: (opts) => doStartNewGame(opts),
});

attachInput(canvas, {
  getState: () => state,
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  getSelectedScoutId: () => selectedScoutId,
  onSelect: (id) => { selection = id; },
  onCloseSidePanel: closeSidePanel,
  onTogglePause: doTogglePause,
  onToggleView: doToggleView,
  onFlagshipInput: doFlagshipInput,
  onStarTravel: doOrderTravel,
  onScoutTravel: doOrderScoutTravel,
  onBattleGroupTravel: doOrderBattleGroupTravel,
  onStarView: doViewSystem,
  onScoutSelect: doSelectScout,
  onFollowRequest: () => { follow.enabled = true; },
  onToggleOrbit: doToggleOrbit,
  onGalaxyStarClick: (starId) => { galaxyTargetStarId = starId; },
  onTradeRouteClick: (starId) => {
    if (!tradeRoutePending) {
      tradeRoutePending = starId;
      const name = systemById(state, starId)?.name ?? starId;
      toast(`Trade route start: ${name}`, 'info');
      return;
    }
    const res = addTradeRoute(state, tradeRoutePending, starId);
    tradeRoutePending = null;
    toast(res.ok ? 'Manual trade route added' : res.reason, res.ok ? 'ok' : 'error');
  },
});

window.__devLastResult = null;
let devPanel = null;

function runDevAction(action, params = {}) {
  const result = devAction(state, action, {
    ...params,
    systemId: params.systemId ?? viewedSystemId,
    planetId: params.planetId ?? selection,
  });
  window.__devLastResult = result;
  if (result.ok) {
    checkFlagshipArrival();
    ensureSelectedScout();
  }
  return result;
}

if (import.meta.env.DEV) {
  devPanel = initDevPanel({
    getState: () => state,
    getViewedSystemId: () => viewedSystemId,
    getSelection: () => selection,
    getView: () => view,
    toast,
    runAction: runDevAction,
    onResult: (result) => { window.__devLastResult = result; },
  });

  window.__toggleDevPanel = () => devPanel.toggle();
  window.__devAction = (action, params) => runDevAction(action, params);

  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      devPanel.toggle();
    }
    if (e.key === 'Escape' && devPanel.isOpen()) {
      devPanel.toggle(false);
    }
  });
}

if (window.gameSave?.onExitSaveRequest) {
  window.gameSave.onExitSaveRequest(() => writeSlot('exit-save', state));
} else {
  window.addEventListener('beforeunload', () => {
    writeSlot('autosave', state);
  });
}

// --- Main loop ---

let lastFrame = performance.now();
let accumulator = 0;
let lastAutosave = performance.now();

function frame(now) {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;

  if (!state.paused) state.meta.playTimeMs += dt;
  const tickEvents = step(state, accumulator + dt);
  accumulator = tickEvents.remainingMs ?? 0;

  for (const ready of tickEvents.prodReady ?? []) {
    const name = systemById(state, ready.systemId)?.name ?? ready.systemId;
    if (ready.scoutId) {
      toast(`Scout ready at ${name}`, 'ok');
      selectedScoutId = ready.scoutId;
    } else if (ready.shipId) {
      toast(`${ready.hull} ready at ${name}`, 'ok');
    }
  }
  for (const arrival of tickEvents.scoutArrivals ?? []) {
    const name = systemById(state, arrival.systemId)?.name ?? arrival.systemId;
    toast(`Intel gathered: ${name}`, 'ok');
  }
  for (const battle of tickEvents.battleEvents ?? []) {
    const name = systemById(state, battle.systemId)?.name ?? battle.systemId;
    const outcome = battle.playerWins ? 'Victory' : 'Defeat';
    toast(`${outcome} at ${name} (${battle.mode})`, battle.playerWins ? 'ok' : 'error');
  }
  for (const cap of tickEvents.captures ?? []) {
    const name = systemById(state, cap.captured)?.name ?? cap.captured;
    toast(`Captured: ${name}`, 'ok');
  }
  for (const ev of tickEvents.dysonEvents ?? []) {
    if (ev.shellCompleted) {
      const name = systemById(state, ev.systemId)?.name ?? ev.systemId;
      const msg = ev.shellNumber === 1
        ? `Shell #1 complete at ${name} — Solarii online!`
        : ev.shellNumber >= 8
          ? `Dyson sphere complete at ${name}!`
          : `Shell #${ev.shellNumber} complete at ${name}`;
      toast(msg, 'ok');
      for (const me of ev.milestoneEvents ?? []) {
        if (me.milestone === 'diplomacy') toast('Diplomacy unlocked — treaties now available', 'ok');
        if (me.milestone === 'superweapon') toast('Superweapon unlocked — build the cradle at your Stronghold', 'ok');
      }
    }
  }

  for (const ev of tickEvents.campaignEvents ?? []) {
    if (ev.type === 'victory') toast(`Victory: ${ev.victoryType}`, 'ok');
    if (ev.type === 'defeat') toast(`Defeat: ${ev.reason}`, 'error');
  }

  tickContextualTips(state, toast);

  for (const wh of tickEvents.wormholeArrivals ?? []) {
    const destGal = getActiveGalaxy(state);
    toast(`Arrived in ${destGal?.name ?? wh.toGalaxyId} via wormhole`, 'ok');
    viewedSystemId = BLACK_HOLE_ID;
    view = 'system';
    follow.enabled = true;
    snapCameraTo(0, 0);
  }

  checkFlagshipArrival();
  ensureSelectedScout();

  if (!state.paused && now - lastAutosave >= AUTOSAVE_INTERVAL_MS) {
    lastAutosave = now;
    writeSlot('autosave', state);
  }

  if (view === 'galaxy') {
    drawGalaxy(ctx2d, state, selectedScoutId);
  } else {
    updateFollowCamera(state, viewedSystemId, dt, accumulator);
    drawSystem(ctx2d, state, viewedSystemId, selection, accumulator);
  }
  updateUi();
  if (devPanel?.isOpen()) devPanel.updateDevPanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Test hooks ---

window.advanceTime = (ms) => {
  const events = advance(state, ms);
  for (const wh of events.wormholeArrivals ?? []) {
    viewedSystemId = BLACK_HOLE_ID;
    view = 'system';
  }
  checkFlagshipArrival();
  ensureSelectedScout();
  for (const ready of events.prodReady ?? []) {
    if (ready.scoutId) selectedScoutId = ready.scoutId;
  }
  return events;
};

window.render_game_to_text = () => {
  const f = state.flagship;
  const transit = transitStatus(state);
  const whTransit = wormholeTransitStatus(state);
  const viewedSystem = systemById(state, viewedSystemId);
  const graph = getGraph(state);
  const activeGal = getActiveGalaxy(state);
  const scoutSummaries = state.scouts
    .filter((s) => s.galaxyId === state.activeGalaxyId)
    .map((scout) => {
      const st = scout.transit ? scoutStatus(scout, graph, state.time) : null;
      return {
        id: scout.id,
        systemId: scout.systemId,
        inTransit: !!scout.transit,
        destination: st?.destId ?? null,
        etaMs: scout.transit ? scoutEtaMs(state, scout) : null,
      };
    });

  const neighborFog = graph.stars
    .filter((star) => star.id !== state.stronghold)
    .slice(0, 3)
    .map((star) => ({ id: star.id, hasIntel: hasIntel(state, star.id) }));

  const dyson = viewedSystem ? ensureDyson(viewedSystem) : null;
  const summary = dysonSummary(state, viewedSystemId);
  const shComp = strongholdComposition(state);
  const foundryPlanet = foundryHostPlanet(state, viewedSystemId);
  const foundryPose = foundryAnchor(state, viewedSystemId);
  const orbitTarget = orbitTargetLabel(state);

  return JSON.stringify({
    saveVersion: SAVE_VERSION,
    time: state.time,
    paused: state.paused,
    credits: state.credits,
    solarii: state.solarii ?? 0,
    solariiUnlocked: !!state.solariiUnlocked,
    solariiPerSec: solariiPerSecond(state),
    view,
    currentSystem: viewedSystemId,
    systemName: viewedSystem?.name ?? null,
    strongholdSystem: state.stronghold,
    systemOwner: viewedSystem?.owner ?? null,
    metaGalaxy: {
      activeGalaxyId: state.activeGalaxyId,
      homeGalaxyId: state.homeGalaxyId,
      galaxyCount: Object.keys(state.galaxies ?? {}).length,
      hydratedCount: hydratedGalaxyCount(state),
    },
    stronghold: shComp,
    abstractGalaxies: abstractGalaxySummaries(state),
    wormholes: wormholeSummary(state),
    selection,
    selectedScoutId,
    incomePerSec: incomePerSecond(state),
    incomePerSecInViewedSystem: incomePerSecondInSystem(state, viewedSystemId),
    flagship: {
      galaxyId: f.galaxyId,
      systemId: f.systemId,
      x: Math.round(f.x * 100) / 100,
      y: Math.round(f.y * 100) / 100,
      vx: Math.round(f.vx * 100) / 100,
      vy: Math.round(f.vy * 100) / 100,
      heading: Math.round(f.heading * 1000) / 1000,
      inTransit: !!f.transit,
      orbiting: isFlagshipOrbiting(state),
      orbitTarget: orbitTarget ?? null,
      destination: transit?.destId ?? null,
      transitProgress: transit ? Math.round(transit.progress * 1000) / 1000 : null,
      etaMs: f.transit ? transitEtaMs(state) : null,
      wormholeTransit: whTransit ? {
        fromWh: whTransit.fromWh,
        toWh: whTransit.toWh,
        progress: Math.round(whTransit.progress * 1000) / 1000,
        etaMs: whTransit.etaMs,
      } : null,
      atCore: f.systemId === BLACK_HOLE_ID && !f.transit && !f.wormholeTransit,
      canEnterWormhole: canEnterWormhole(state).ok,
    },
    scouts: scoutSummaries,
    scoutCount: state.scouts.length,
    intel: {
      scoutedCount: scoutedCount(state),
      viewedSystemHasIntel: hasIntel(state, viewedSystemId),
      captureRequirement: hasIntel(state, viewedSystemId)
        ? captureRequirement(state, viewedSystemId)
        : null,
      neighborFog,
    },
    capture: {
      force: captureForceInSystem(state, viewedSystemId),
      requirement: hasIntel(state, viewedSystemId)
        ? captureRequirement(state, viewedSystemId)
        : null,
      progressMs: captureProgressMs(state, viewedSystemId),
      canHold: canHoldCapture(state, viewedSystemId),
      contested: enemyCombatPresence(state, viewedSystemId) > 0,
    },
    production: {
      shipyardCount: Object.values(getSystems(state)).reduce(
        (n, sys) => n + sys.structures.filter((s) => s.type === 'shipyard').length,
        0,
      ),
      buildingScout: Object.values(getSystems(state)).some(
        (sys) => sys.structures.some((s) => s.type === 'shipyard' && (s.builds?.some((b) => b.hull === 'scout') || s.build?.hull === 'scout')),
      ),
      scoutCount: state.scouts.filter((s) => s.galaxyId === state.activeGalaxyId).length,
      combatQueues: activeCombatQueues(state),
      ...productionSlotSummary(state),
    },
    empireQueue: empireQueueSummary(state),
    research: researchSummary(state),
    trade: tradeSummary(state),
    factions: {
      ai: aiFactionSummary(state),
      list: listAiFactions(state).map((f) => ({
        id: f.id,
        name: f.name,
        personality: f.personality,
        homeSystemId: f.homeSystemId,
      })),
    },
    aiShips: aiShipsSummary(state),
    playerShips: (state.playerShips ?? [])
      .filter((ship) => ship.galaxyId === state.activeGalaxyId)
      .map((ship) => ({
      id: ship.id,
      hull: ship.hull,
      systemId: ship.systemId,
      inTransit: !!ship.transit,
      hp: ship.hp,
      maxHp: ship.maxHp,
    })),
    battleGroups: battleGroupsForGalaxy(state).map((g) => ({
      id: g.id,
      name: formatFleetName(g.ordinal),
      ordinal: g.ordinal,
      shipIds: [...g.shipIds],
      anchorHeroId: g.anchorHeroId ?? null,
    })),
    pirates: {
      fleetCount: state.pirates?.fleets?.length ?? 0,
      inViewedSystem: pirateFleetAtSystem(state, viewedSystemId).length > 0,
      markers: pirateSystemsWithPresence(state),
      fleets: (state.pirates?.fleets ?? []).map((fleet) => ({
        id: fleet.id,
        systemId: fleet.systemId,
        inTransit: !!fleet.transit,
        shipCount: fleet.ships.filter((s) => s.hp > 0).length,
        totalHp: fleet.ships.reduce((n, s) => n + Math.max(0, s.hp), 0),
      })),
    },
    battle: battleSummaryForSystem(state, viewedSystemId),
    hullStats: Object.keys(HULL_STATS),
    galaxy: {
      starCount: graph.stars.length,
      laneCount: graph.lanes.length,
      blackHole: graph.blackHole.id,
      galaxyId: state.activeGalaxyId,
      galaxyName: activeGal?.name ?? null,
    },
    bodies: (viewedSystem?.bodies ?? []).map((b) => ({
      id: b.id,
      kind: b.kind,
      type: b.type,
      name: b.name,
      moonCount: b.moons.length,
      hasOutpost: hasOutpost(state, viewedSystemId, b.id),
      hasShipyard: hasShipyard(state, viewedSystemId, b.id),
      canBuildOutpost: canBuildOutpost(state, viewedSystemId, b.id).ok,
      canBuildShipyard: canBuildShipyard(state, viewedSystemId, b.id).ok,
      launcherCount: launcherCountOnBody(state, viewedSystemId, b.id),
      canBuildLauncher: canBuildLauncher(state, viewedSystemId, b.id).ok,
      shipyardId: findShipyardOnPlanet(state, viewedSystemId, b.id)?.id ?? null,
      canQueueScout: (() => {
        const sy = findShipyardOnPlanet(state, viewedSystemId, b.id);
        return sy ? canQueueScout(state, sy.id, viewedSystemId).ok : false;
      })(),
    })),
    structures: (viewedSystem?.structures ?? []).map((s) => ({
      id: s.id,
      type: s.type,
      bodyId: s.bodyId,
      building: s.type === 'shipyard' && !!s.build,
      buildProgress: s.type === 'shipyard' ? shipyardBuildProgress(s, state.time) : null,
    })),
    shuttles: {
      active: activeShuttleCount(state, viewedSystemId) > 0,
      count: activeShuttleCount(state, viewedSystemId),
    },
    surfaceSites: (() => {
      const sites = hasIntel(state, viewedSystemId) ? outpostSurfaceSites(state, viewedSystemId) : [];
      return {
        count: sites.length,
        pads: sites.filter((s) => s.kind.endsWith('-pad')).length,
        rigs: sites.filter((s) => s.kind === 'moon-rig').length,
        active: sites.filter((s) => s.active).length,
      };
    })(),
    structureVisuals: (() => {
      const sites = hasIntel(state, viewedSystemId) ? structureSites(state, viewedSystemId) : [];
      const round = (n) => Math.round(n * 10) / 10;
      return {
        shipyards: sites
          .filter((s) => s.kind === 'shipyard')
          .map((s) => ({
            planetId: s.planetId,
            x: round(s.x),
            y: round(s.y),
            orbitR: round(s.orbitR),
            slotAngle: round(s.slotAngle * 1000) / 1000,
            building: s.building,
            buildProgress: round(s.buildProgress),
          })),
        launchers: sites
          .filter((s) => s.kind === 'launcher')
          .map((s) => ({
            bodyId: s.bodyId,
            x: round(s.x),
            y: round(s.y),
            heading: round(s.heading * 1000) / 1000,
            muzzleX: round(s.muzzleX),
            muzzleY: round(s.muzzleY),
            slotAngle: round(s.slotAngle * 1000) / 1000,
            firing: s.firing,
          })),
      };
    })(),
    sailShuttles: {
      active: activeSailShuttleCount(state, viewedSystemId) > 0,
      count: activeSailShuttleCount(state, viewedSystemId),
    },
    dyson: summary && dyson ? {
      ...summary,
      foundryHostPlanetId: foundryPlanet?.id ?? null,
      foundryRingRadius: foundryPlanet ? Math.round(computeFoundryRingRadius(foundryPlanet) * 10) / 10 : null,
      firstMoonOrbit: foundryPlanet?.moons?.[0]?.orbitRadius ?? null,
      foundryDock: foundryPose.planetId
        ? { x: Math.round(foundryPose.x * 10) / 10, y: Math.round(foundryPose.y * 10) / 10 }
        : null,
      shellProgress: summary.completedShells >= 8
        ? 1
        : Math.round((dyson.shellSails / SHELL_SAILS_REQUIRED) * 1000) / 1000,
      solariiPerSec: solariiPerSecondInSystem(state, viewedSystemId),
      solariiUnlocked: !!state.solariiUnlocked,
      nextShell: Math.min(8, summary.completedShells + 1),
      canBuildFoundry: canBuildFoundry(state, viewedSystemId, selection).ok,
    } : null,
    dysonVisuals: viewedSystem && hasIntel(state, viewedSystemId)
      ? dysonVisualSummary(state, viewedSystemId, viewedSystem.star.radius, camera.zoom)
      : null,
    milestones: milestonesSummary(state),
    diplomacy: diplomacySummary(state),
    superweapon: superweaponSummary(state),
    heroFlagships: heroFlagshipsSummary(state),
    campaign: campaignSummary(state),
    missions: missionsSummary(state),
    tutorial: getTutorialState(state),
    manualTradeRoutes: tradeRoutesSummary(state),
    strategicStructures: strategicStructuresSummary(state),
    shellBonuses: viewedSystem ? {
      shield: shellShieldBonus(viewedSystem, state),
      repair: shellRepairBonus(viewedSystem),
    } : null,
    tickMs: TICK_MS,
  });
};

window.getGameState = () => state;

window.__selectPlanet = (id) => { selection = id; };
window.__buildOutpost = (id) => doBuildOutpost(id);
window.__buildShipyard = (id) => doBuildShipyard(id);
window.__buildFoundry = (planetId) => doBuildFoundry(planetId ?? selection);
window.__toggleOrbit = (planetId) => toggleFlagshipOrbit(state, planetId ?? selection);
window.__buildLauncher = (bodyId) => doBuildLauncher(bodyId ?? selection);
window.__grantCredits = (n) => {
  const res = devGrantCredits(state, n);
  return res.ok ? res.details.after : state.credits;
};
window.__forceShellProgress = (systemId, sails) => devForceShell(state, systemId ?? viewedSystemId, sails);
window.__spawnFriendlyShip = (hull, count = 1) =>
  devSpawnFriendlyShips(state, viewedSystemId, hull, count, selection);
window.__spawnEnemyFleet = (systemId) =>
  devSpawnEnemyFleet(state, systemId ?? viewedSystemId);
window.__fastForwardDyson = (ms) => window.advanceTime(ms);
window.__queueScout = (shipyardId) => doQueueScout(shipyardId);
window.__queueHull = (shipyardId, hull) => doQueueHull(shipyardId, hull);
window.__queueHullLocal = (shipyardId, hull) => doQueueHull(shipyardId, hull);
window.__enqueueHull = (hull) => enqueueHull(state, hull);
window.__cancelQueueItem = (id) => cancelQueueItem(state, id);
window.__pinQueueItem = (id, shipyardId) => pinQueueItem(state, id, shipyardId ?? null);
window.__getEmpireQueue = () => empireQueueSummary(state);
window.__startResearch = (nodeId) => startResearch(state, nodeId);
window.__buildResearchStation = (systemId) => buildResearchStation(state, systemId ?? viewedSystemId);
window.__buildTradeStation = (planetId) => buildTradeStation(state, viewedSystemId, planetId ?? selection);
window.__getTradeSummary = () => tradeSummary(state);
window.__getTechWeb = () => allTechNodes().map((n) => ({
  id: n.id,
  unlocked: isTechUnlocked(state, n.id),
  available: techPrereqsMet(state, n.id) && !isTechUnlocked(state, n.id),
}));
window.__getAiSummary = () => aiFactionSummary(state);
window.__forceAiCapture = (systemId) => forceAiCapture(state, systemId);
window.__listPlayerShipyards = () => listPlayerShipyards(state);
window.__seedTestShipyards = () => {
  const st = window.getGameState();
  const sys = st.stronghold;
  const systems = st.galaxies['gal-0'].systems;
  const ensureYard = (systemId) => {
    const system = systems[systemId];
    if (!system) return null;
    const planet = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
    if (!planet) return null;
    if (!system.structures.some((s) => s.type === 'outpost')) {
      system.structures.push({ id: `test-out-${systemId}`, type: 'outpost', bodyId: planet.id, builtAtTime: 0 });
    }
    let yard = system.structures.find((s) => s.type === 'shipyard');
    if (!yard) {
      yard = { id: `test-yard-${systemId}`, type: 'shipyard', bodyId: planet.id, builds: [], builtAtTime: 0 };
      system.structures.push(yard);
    }
    return { systemId, shipyardId: yard.id };
  };
  const near = ensureYard(sys);
  const neighbors = st.galaxies['gal-0'].graph.lanes
    .filter((l) => l.from === sys || l.to === sys)
    .map((l) => (l.from === sys ? l.to : l.from))
    .filter((id) => systems[id]);
  let far = null;
  for (const nid of neighbors) {
    systems[nid].owner = 'player';
    far = ensureYard(nid);
    if (far) break;
  }
  return { ok: true, near, far };
};
window.__dispatchShip = (shipId, starId) => doDispatchShip(shipId, starId);
window.__createBattleGroup = () => createBattleGroup(state);
window.__selectBattleGroup = (groupId) => { doSelectBattleGroup(groupId); return selectedBattleGroupId; };
window.__assignShipToGroup = (shipId, groupId) => assignShipToGroup(state, shipId, groupId);
window.__orderBattleGroup = (starId) => doOrderBattleGroupTravel(starId);
window.__deleteBattleGroup = (groupId) => doDeleteBattleGroup(groupId);
window.__listBattleGroups = () => battleGroupsForGalaxy(state).map((g) => ({
  id: g.id,
  name: formatFleetName(g.ordinal),
  ordinal: g.ordinal,
  shipIds: [...g.shipIds],
}));
window.__formatFleetName = (ordinal) => formatFleetName(ordinal);
window.__setBattleStance = (stance) => setBattleStance(state, stance);
window.__forcePirateIntoSystem = (systemId) => {
  forcePirateIntoSystem(state, systemId);
  checkBattleTrigger(state, systemId);
};
window.__getBattleState = (systemId) => getBattleState(state, systemId);
window.__getHullStats = () => ({ ...HULL_STATS });
window.__newGame = (seed = DEFAULT_SEED, opts = {}) => {
  resetWormholeJumpCounter(0);
  state = createNewGame(seed);
  state.pirates = spawnPirateFleets(state);
  seedAiFaction(state, state.homeGalaxyId);
  resetContextualTips();
  tradeRoutePending = null;
  galaxyTargetStarId = state.stronghold;
  if (opts.victoryType) setVictoryType(state, opts.victoryType, opts.mode ?? 'sandbox');
  if (opts.mode === 'tutorial') initTutorial(state);
  document.getElementById('new-game-modal')?.classList.add('hidden');
  document.getElementById('new-game-modal-backdrop')?.classList.add('hidden');
  doImportState(state);
  return state;
};

function doStartNewGame(opts = {}) {
  window.__newGame(DEFAULT_SEED, opts);
  view = 'system';
  viewedSystemId = state.stronghold;
  selection = null;
  selectedScoutId = null;
  selectedBattleGroupId = null;
  snapCameraTo(0, 0);
  toast(`New ${opts.mode ?? 'sandbox'} campaign started`, 'ok');
}
window.__saveSlot = (slot) => doSaveSlot(slot);
window.__loadSlot = (slot) => doLoadSlot(slot);
window.__setFlagshipInput = (x, y) => setFlagshipInput(x, y);
window.__orderTravel = (starId) => doOrderTravel(starId);
window.__orderScout = (scoutId, starId) => {
  if (scoutId) selectedScoutId = scoutId;
  return doOrderScoutTravel(starId);
};
window.__selectScout = (scoutId) => doSelectScout(scoutId);
window.__gatherIntel = (systemId) => gatherIntel(state, systemId);
window.__setView = (v) => doSetView(v);
window.__viewSystem = (systemId) => doViewSystem(systemId);
window.__snapCamera = (x, y, zoom) => {
  follow.enabled = false;
  snapCameraTo(x, y);
  if (zoom != null) camera.zoom = zoom;
};
window.__snapGalaxyCamera = (x, y, zoom) => {
  galaxyCamera.x = x;
  galaxyCamera.y = y;
  if (zoom != null) galaxyCamera.zoom = zoom;
};
window.__planetPos = (systemId, planetId) => {
  const planet = findPlanet(state, systemId, planetId);
  return planet ? planetPosition(planet, state.time) : null;
};
window.__shuttleInfo = (systemId) => shuttlePositions(state, systemId ?? viewedSystemId);
window.__sailShuttleInfo = (systemId) => sailShuttlePositions(state, systemId ?? viewedSystemId);
window.__pointNearSupplySegment = pointNearSupplySegment;
window.__getDyson = (systemId) => {
  const sys = systemById(state, systemId ?? viewedSystemId ?? state.stronghold);
  return sys ? ensureDyson(sys) : null;
};

window.__setGalaxyScaleForTests = ({ stars, galaxies }) => {
  if (stars != null) setGalaxyStarCountForTests(stars);
  if (galaxies != null) setGalaxyCountForTests(galaxies);
};
window.__enterWormhole = (opts = {}) => doEnterWormhole(opts);
window.__buildWormholeAnchor = (targetGalaxyId) => doBuildWormholeAnchor(targetGalaxyId);
window.__hydrateGalaxy = (galaxyId) => hydrateGalaxy(state, galaxyId);
window.__dehydrateGalaxy = (galaxyId) => dehydrateGalaxy(state, galaxyId);
window.__getGraphStats = () => graphStats(getGraph(state));
window.__getAbstractGalaxy = (galaxyId) => state.galaxies?.[galaxyId]?.abstract ?? null;
window.__getGalaxyFingerprint = (galaxyId) => {
  const g = state.galaxies?.[galaxyId]?.graph;
  return g ? galaxyGraphFingerprint(g) : null;
};
window.__getStrongholdComposition = () => strongholdComposition(state);
window.__resetWormholeJumpCounter = (n = 0) => resetWormholeJumpCounter(n);
window.__completeWormholeTransit = () => {
  const wt = state.flagship?.wormholeTransit;
  if (!wt) return { ok: false, reason: 'No wormhole transit' };
  state.time = wt.startTime + wt.durationMs;
  const arrival = tickWormholeTransit(state);
  return arrival ? { ok: true, ...arrival } : { ok: false, reason: 'Transit incomplete' };
};
window.__listGalaxyIds = () => Object.keys(state.galaxies ?? {});

// --- Phase 6 test hooks ---
window.__completeDysonShell = (systemId, shellNum) =>
  completeDysonShellForTest(state, systemId ?? viewedSystemId, shellNum);
window.__setCompletedDysons = (n) => setCompletedDysonsForTest(state, n);
window.__buildSuperweaponCradle = () => buildSuperweaponCradle(state);
window.__superweaponCreate = (anchorId) => superweaponCreate(state, anchorId ?? state.stronghold);
window.__superweaponDestroy = (systemId) => superweaponDestroy(state, systemId);
window.__superweaponJump = (starId) => superweaponJump(state, starId ?? state.stronghold);
window.__buildHeroFlagship = (rallyStarId) => buildHeroFlagship(state, rallyStarId);
window.__spawnHeroFlagship = (systemId) => spawnHeroFlagshipForTest(state, systemId ?? viewedSystemId);
window.__setRelation = (factionId, status) => setRelation(state, factionId, status);
window.__offerTreaty = (factionId, type) => offerTreaty(state, factionId, type);
window.__addTradeRoute = (from, to) => addTradeRoute(state, from, to);
window.__clearTradeRoutes = () => clearTradeRoutes(state);
window.__startMission = (id) => startMission(state, id);
window.__advanceMissionObjective = (missionId, objectiveId) =>
  advanceMissionObjective(state, missionId, objectiveId);
window.__completeMission = (id) => completeMissionForTest(state, id);
window.__setTutorialStep = (n) => setTutorialStep(state, n);
window.__getTutorialState = () => getTutorialState(state);
window.__initTutorial = () => initTutorial(state);
window.__setVictoryType = (type, mode) => setVictoryType(state, type, mode);
window.__checkVictory = () => checkVictory(state);
window.__checkDefeat = () => checkDefeat(state);
window.__buildStrategicStructure = (type, planetId) =>
  buildStrategicStructure(state, viewedSystemId, type, planetId ?? selection);
window.__setBattleGroupHeroAnchor = (groupId, heroId) =>
  setBattleGroupHeroAnchor(state, groupId, heroId);
window.__setHeroRally = (heroId, starId) => setHeroRally(state, heroId, starId);
window.__destroyFlagship = () => {
  state.flagship.hp = 0;
  return { ok: true };
};
