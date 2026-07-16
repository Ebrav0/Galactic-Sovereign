// Boot + loop wiring + test hooks. Wiring only — no balance or game logic here.

import {
  TICK_MS,
  AUTOSAVE_INTERVAL_MS,
  DEFAULT_SEED,
  SCOUT_BUILD_MS,
  CAMERA_DEFAULT_ZOOM,
  HULL_STATS,
  PIRATE_FLEET_COUNT,
  PIRATE_WANDER_MS,
  SAVE_VERSION,
  SHELL_SAILS_REQUIRED,
  OUTPOST_COST,
  SHIPYARD_COST,
  TRADE_STATION_COST,
  RESEARCH_STATION_COST,
  FOUNDRY_COST,
  LAUNCHER_COST,
  SUPERWEAPON_CRADLE_COST,
} from './constants.js';
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
import {
  buildOutpost,
  canBuildOutpost,
  incomePerSecond,
  incomePerSecondInSystem,
  resetStructureIds,
} from './economy.js';
import {
  activeJobsInSystem,
  droneCapacity,
  droneSummaryForSystem,
  jobEtaMs,
  jobProgress,
  resetDroneIds,
} from './drones.js';
import { dronePoses } from './drone-motion.js';
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
import { setFlagshipInput, flagshipControlStatus, orderTravel, transitStatus, transitEtaMs, toggleFlagshipOrbit, isFlagshipOrbiting, orbitTargetLabel } from './flagship.js';
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
import {
  spawnPirateFleets,
  forcePirateIntoSystem,
  pirateSystemsWithPresence,
  resetPirateIds,
  pirateFleetAtSystem,
  pirateFleetEtaMs,
  pirateFleetPower,
  pirateFleetMarkersForGalaxy,
  pirateFleetTransitMarkersForGalaxy,
  ensurePiratesState,
} from './pirates.js';
import {
  orderShipTravel,
  resetShipIds,
  findPlayerShip,
  playerShipsAtSystem,
  stationedShipPose,
} from './fleets.js';
import {
  createBattleGroup,
  deleteBattleGroup,
  assignShipToGroup,
  orderBattleGroupTravel,
  resetBattleGroupIds,
  battleGroupsForGalaxy,
  formatFleetName,
  autoAssignShipsToFleets,
  setBattleGroupFlagshipAnchor,
  syncFlagshipAnchoredFleets,
} from './battle-groups.js';
import {
  battleSummaryForSystem,
  getBattleState,
  promoteBattleToTactical,
  setBattleStance,
  checkBattleTrigger,
  setCombatDoctrine,
} from './combat.js';
import {
  analyzeFleetMix,
  normalizeDoctrine,
  recommendFormation,
} from './combat-doctrine.js';
import { combatFxSummary } from './combat-fx.js';
import { activeFleetOrders, applyFleetOrder, weaponArcRadians } from './combat-orders.js';
import {
  combatAutonomySummary,
  ensureCombatSettings,
  setAdvancedTactics,
  setCombatFleetPriority,
} from './combat-autonomy.js';
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
  drawTitleBackground,
  galaxyPerfSummary,
  follow,
  updateFollowCamera,
  snapCameraTo,
  camera,
  galaxyCamera,
  hitTestCombatUnit,
} from './render.js';
import { attachInput } from './input.js';
import {
  writeSlot,
  readSlot,
  writeTutorialCheckpoint,
  readTutorialCheckpoint,
  clearTutorialCheckpoint,
} from './save.js';
import { initUi, toast } from './ui.js';
import { initStarRenderer, resizeStarRenderer } from './gl/star-renderer.js';
import { stellarCatalogInfo } from './star-types.js';
import { getBootPhase, setBootPhase, BOOT_PHASE } from './boot.js';
import {
  startWarpIntro,
  drawWarpIntro,
  setWarpIntroElapsedForTest,
  warpIntroState,
} from './warp-intro.js';
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
  wormholeVisualState,
  triggerWormholeArrivalFx,
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
import { startResearch, researchSummary, buildResearchStation, canBuildResearchStation, ensureResearchState } from './research.js';
import { applyTechEffect, techEffects } from './tech-web.js';
import { buildTradeStation, canBuildTradeStation, tradeSummary } from './trade.js';
import { aiFactionSummary, forceAiCapture, listAiFactions } from './ai-faction.js';
import { resetAiShipIds, aiShipsSummary } from './ai-ships.js';
import { productionSlotSummary } from './production.js';
import { allTechNodes, isTechUnlocked, techPrereqsMet } from './tech-web.js';
import { milestonesSummary, setCompletedDysonsForTest } from './milestones.js';
import {
  buildSuperweaponCradle,
  installSuperweaponPart,
  superweaponCreate,
  superweaponDestroy,
  superweaponJump,
  superweaponSummary,
  completeDysonShellForTest,
  resetSuperweaponIds,
  fireSequenceStatus,
} from './superweapon.js';
import { ensureFlagshipWeapons } from './hull.js';
import { ensureFlagshipWing, flagshipWingPoses, flagshipWingSummary, toggleFlagshipWingHangar } from './flagship-wing.js';
import {
  buildHeroFlagship,
  spawnHeroFlagshipForTest,
  setHeroRally,
  orderHeroTravel,
  heroFlagshipsSummary,
  resetHeroFlagshipIds,
} from './hero-flagships.js';
import {
  castCouncilVote,
  concludePeace,
  createClaim,
  declareWar,
  establishContact,
  offerTreaty,
  previewProposal,
  respondToProposal,
  setRelation,
  diplomacySummary,
  submitProposal,
} from './diplomacy.js';
import {
  bulkProductionSummary,
  cancelBulkProductionOrder,
  createBulkProductionOrder,
  pauseBulkProductionOrder,
  previewBulkProductionOrder,
  resumeBulkProductionOrder,
} from './bulk-production.js';
import {
  cancelExpansionCampaign,
  createExpansionCampaign,
  pauseExpansionCampaign,
  previewExpansionCampaign,
  resumeExpansionCampaign,
  strategicOrdersSummary,
} from './strategic-operations.js';
import { strategicIntegrationHooks } from './strategic-integration.js';
import { listProductionProducts } from './production-products.js';
import { setVictoryType, checkVictory, checkDefeat, campaignSummary } from './campaign.js';
import { startMission, completeMissionForTest, advanceMissionObjective, missionsSummary } from './missions.js';
import {
  getTutorialFocus,
  getTutorialState,
  setTutorialStep,
  initTutorial,
  markTutorialSystemViewed,
  markTutorialTimeToggled,
  markTutorialLogisticsOpened,
  markTutorialBattlePrepared,
  markTutorialBattleCommand,
  markTutorialBattleResolved,
  tutorialNeedsBattlePreparation,
  tryAdvanceTutorial,
  beginTutorialGraduation,
  completeTutorialGraduation,
} from './tutorial.js';
import {
  clearTutorialProfile,
  currentProfile,
  markTutorialGraduated,
  loadProfile,
} from './profile.js';
import {
  requireTutorialAccess,
  setTutorialSessionOverride,
  tutorialAccess,
} from './tutorial-access.js';
import { buildStrategicStructure, strategicStructuresSummary, STRUCTURE_DEFS } from './strategic-structures.js';
import {
  allBodyStructuresSummary,
  BODY_STRUCTURE_DEFS,
  bodyStructureBuildRows,
  bodyStructuresSummary,
  buildBodyStructure,
} from './body-structures.js';
import {
  builderDroneSummary,
  cancelBuilderConstructionOrder,
  canDeployBuilderDrone,
  cancelBuilderDrone,
  confirmBuilderConstructionPlan,
  deployBuilderDrone,
  getDroneConstructionCatalog,
  initBuilderDrones,
  resetBuilderDroneIds,
} from './builder-drones.js';
import { shellShieldBonus, shellRepairBonus } from './dyson.js';
import { setBattleGroupHeroAnchor } from './battle-groups.js';
import { tickContextualTips, resetContextualTips } from './tips.js';
import {
  activeConvoys,
  convoyTransitStatus,
  dispatchDepot,
  discoverTradeNexuses,
  ensureLogisticsState,
  findExportDepot,
  logisticsSummary,
  registerExportDepot,
  setDepotDestination,
} from './logistics.js';
import {
  buildRedactedSolSnapshot,
  createOfflineSolAdvice,
  validateSolCommand,
} from './sol-commander.js';

let state = createNewGame(DEFAULT_SEED);
loadProfile();
state.pirates = spawnPirateFleets(state);
seedAiFaction(state, state.homeGalaxyId);
initBuilderDrones(state);
state.paused = true;
setBootPhase(BOOT_PHASE.TITLE);
let selection = null;
let view = 'system';
let viewedSystemId = state.stronghold;
let lastFlagshipSystemId = state.flagship.systemId;
let selectedScoutId = null;
let selectedBattleGroupId = null;
let selectedBuilderDroneId = null;
let galaxyTargetStarId = null;
let followedConvoyId = null;
let combatSelectionIds = [];
let combatCommandMode = null;
let combatMarquee = null;

const COMBAT_SELECTION_CAP = 24;

function pruneCombatSelection() {
  const battle = getBattleState(state, viewedSystemId);
  if (!battle?.active || !battle.units) {
    combatSelectionIds = [];
    combatCommandMode = null;
    return;
  }
  const live = new Set(
    battle.units.filter((unit) => unit.side === 'player' && unit.hp > 0).map((unit) => String(unit.id)),
  );
  combatSelectionIds = combatSelectionIds.filter((id) => live.has(String(id)));
  battle.uiSelectionIds = [...combatSelectionIds];
  battle.uiFocusTargetId = battleSummaryForSystem(state, viewedSystemId)?.focusTargetId ?? null;
}

function doSelectCombatUnit(unitId, { additive = false } = {}) {
  const battle = getBattleState(state, viewedSystemId);
  if (!battle?.active || battle.mode !== 'tactical') return [];
  const unit = battle.units?.find((entry) => String(entry.id) === String(unitId) && entry.hp > 0);
  if (!unit || unit.side !== 'player') return combatSelectionIds;
  const id = String(unit.id);
  if (additive) {
    if (combatSelectionIds.includes(id)) {
      combatSelectionIds = combatSelectionIds.filter((entry) => entry !== id);
    } else if (combatSelectionIds.length < COMBAT_SELECTION_CAP) {
      combatSelectionIds = [...combatSelectionIds, id];
    } else {
      toast('Selection capped at 24 ships', 'error');
    }
  } else {
    combatSelectionIds = [id];
  }
  pruneCombatSelection();
  return combatSelectionIds;
}

function doClearCombatSelection() {
  combatSelectionIds = [];
  pruneCombatSelection();
  return combatSelectionIds;
}

function doSetCombatSelection(ids = []) {
  const battle = getBattleState(state, viewedSystemId);
  if (!battle?.active || battle.mode !== 'tactical') {
    combatSelectionIds = [];
    return combatSelectionIds;
  }
  const live = new Set(
    battle.units.filter((unit) => unit.side === 'player' && unit.hp > 0).map((unit) => String(unit.id)),
  );
  combatSelectionIds = [...new Set((ids ?? []).map(String))]
    .filter((id) => live.has(id))
    .slice(0, COMBAT_SELECTION_CAP);
  pruneCombatSelection();
  return combatSelectionIds;
}

function doSelectCombatUnitsInWorldRect(minX, minY, maxX, maxY, { additive = false } = {}) {
  const battle = getBattleState(state, viewedSystemId);
  if (!battle?.active || battle.mode !== 'tactical') return combatSelectionIds;
  const left = Math.min(minX, maxX);
  const right = Math.max(minX, maxX);
  const top = Math.min(minY, maxY);
  const bottom = Math.max(minY, maxY);
  const hits = (battle.units ?? [])
    .filter((unit) => unit.side === 'player' && unit.hp > 0
      && unit.x >= left && unit.x <= right && unit.y >= top && unit.y <= bottom)
    .map((unit) => String(unit.id));
  if (!hits.length) {
    if (!additive) doClearCombatSelection();
    return combatSelectionIds;
  }
  if (additive) {
    const merged = [...new Set([...combatSelectionIds, ...hits])];
    if (merged.length > COMBAT_SELECTION_CAP) toast('Selection capped at 24 ships', 'error');
    return doSetCombatSelection(merged);
  }
  return doSetCombatSelection(hits);
}

function doSetCombatMarquee(rect = null) {
  combatMarquee = rect && Number.isFinite(rect.x0) && Number.isFinite(rect.y0)
    ? {
      x0: rect.x0,
      y0: rect.y0,
      x1: Number.isFinite(rect.x1) ? rect.x1 : rect.x0,
      y1: Number.isFinite(rect.y1) ? rect.y1 : rect.y0,
    }
    : null;
  return combatMarquee;
}

function doCombatFocus(targetId) {
  pruneCombatSelection();
  if (!combatSelectionIds.length) {
    toast('Select ships first', 'error');
    return { ok: false, reason: 'Select ships first' };
  }
  const result = doIssueTacticalOrder({
    type: 'focus_fire',
    targetId,
    subjectIds: [...combatSelectionIds],
  });
  if (result.ok) combatCommandMode = null;
  return result;
}

function doCombatMove(point) {
  pruneCombatSelection();
  if (!combatSelectionIds.length) {
    toast('Select ships first', 'error');
    return { ok: false, reason: 'Select ships first' };
  }
  const result = doIssueTacticalOrder({
    type: 'move',
    point,
    engagementRadius: 420,
    subjectIds: [...combatSelectionIds],
  });
  if (result.ok) combatCommandMode = null;
  return result;
}

function doSetCombatCommandMode(mode = null) {
  const next = mode == null ? null : String(mode);
  if (next != null && !['move', 'attack'].includes(next)) {
    return { ok: false, reason: 'Unknown combat command mode' };
  }
  if (next != null) {
    pruneCombatSelection();
    if (!combatSelectionIds.length) {
      toast('Select ships first', 'error');
      return { ok: false, reason: 'Select ships first' };
    }
  }
  combatCommandMode = next;
  return { ok: true, mode: combatCommandMode };
}

function doCombatCommandAt(point, unit = null, mode = combatCommandMode) {
  if (mode === 'attack') {
    if (!unit || unit.side === 'player') {
      toast('Attack requires a hostile ship', 'error');
      return { ok: false, reason: 'Attack requires a hostile ship' };
    }
    return doCombatFocus(unit.id);
  }
  if (mode === 'move') {
    if (unit) {
      toast('Move requires open battlefield space', 'error');
      return { ok: false, reason: 'Move requires open battlefield space' };
    }
    return doCombatMove(point);
  }
  return { ok: false, reason: 'No combat command is armed' };
}

function doCombatContextCommand(point, unit = null) {
  if (unit && unit.side !== 'player') return doCombatFocus(unit.id);
  return doCombatMove(point);
}

function combatOverlayForRender() {
  pruneCombatSelection();
  const summary = battleSummaryForSystem(state, viewedSystemId);
  return {
    selectionIds: [...combatSelectionIds],
    focusTargetId: summary?.focusTargetId ?? null,
    commandMode: combatCommandMode,
    marquee: combatMarquee,
  };
}

function combatUiActive() {
  const battle = getBattleState(state, viewedSystemId);
  return view === 'system' && !!battle?.active && battle.mode === 'tactical';
}

const SOL_BUILD_CATALOG = Object.freeze({
  outpost: { cost: OUTPOST_COST, requiresBody: true, disallowOnTradeNexus: true },
  shipyard: { cost: SHIPYARD_COST, requiresBody: true, disallowOnTradeNexus: true },
  trade_station: { cost: TRADE_STATION_COST, tech: 'eco_trade_hub', requiresBody: true, disallowOnTradeNexus: true },
  export_depot: { cost: TRADE_STATION_COST, tech: 'eco_trade_hub', requiresBody: true, disallowOnTradeNexus: true },
  research_station: { cost: RESEARCH_STATION_COST, tech: 'res_station_protocol' },
  dyson_foundry: { cost: FOUNDRY_COST, requiresBody: true, disallowOnTradeNexus: true },
  solar_sail_launcher: { cost: LAUNCHER_COST, requiresBody: true, disallowOnTradeNexus: true },
  superweapon_cradle: { cost: SUPERWEAPON_CRADLE_COST, disallowOnTradeNexus: true },
  ...Object.fromEntries(Object.entries(BODY_STRUCTURE_DEFS).map(([type, def]) => [type, {
    cost: def.cost,
    tech: def.tech,
    requiresBody: !def.starNode,
    disallowOnTradeNexus: true,
  }])),
  ...Object.fromEntries(Object.entries(STRUCTURE_DEFS).map(([type, def]) => [type, {
    cost: def.cost,
    tech: def.tech,
    requiresBody: def.perBody,
    disallowOnTradeNexus: true,
  }])),
});

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
  selectedBuilderDroneId = null;
}

function doSelectBattleGroup(groupId) {
  if (groupId && !battleGroupsForGalaxy(state).some((g) => g.id === groupId)) return;
  selectedBattleGroupId = groupId;
  selectedScoutId = null;
  selectedBuilderDroneId = null;
}

function doSelectBuilderDrone(droneId) {
  const drone = (state.builderDrones ?? []).find(
    (entry) => entry.id === droneId && entry.galaxyId === state.activeGalaxyId,
  );
  if (!drone) return;
  selectedBuilderDroneId = drone.id;
  selectedScoutId = null;
  selectedBattleGroupId = null;
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

function tutorialGuard(featureId) {
  const access = requireTutorialAccess(state, featureId);
  if (!access.ok) toast(access.reason, 'error');
  return access;
}

function accelerateCurrentTransit(entity, durationMs = 2200) {
  if (!entity?.transit || state.campaign?.mode !== 'tutorial') return;
  entity.transit.legStartTime = state.time;
  entity.transit.legDurationMs = Math.min(entity.transit.legDurationMs ?? durationMs, durationMs);
}

function doTogglePause() {
  const tutorial = getTutorialState(state);
  if (tutorial.active && tutorial.step === 'win_first_battle'
      && state.paused && !state.campaign.tutorial.flags.battleCommandIssued) {
    toast('Issue an Attack order before resuming the training battle', 'error');
    return { ok: false, reason: 'Attack order required' };
  }
  togglePaused(state);
  markTutorialTimeToggled(state);
  tryAdvanceTutorial(state);
  return { ok: true, paused: state.paused };
}

function doToggleView() {
  const next = view === 'system' ? 'galaxy' : 'system';
  const access = tutorialGuard(next === 'galaxy' ? 'galaxy_view' : 'system_view');
  if (!access.ok) return access;
  view = next;
  setFlagshipInput(0, 0, state.time);
  if (view === 'system') markTutorialSystemViewed(state);
  tryAdvanceTutorial(state);
  return { ok: true, view };
}

function doSetView(v) {
  if (v !== view) return doToggleView();
  return { ok: true, view };
}

function doViewSystem(systemId) {
  if (!systemById(state, systemId)) return;
  promoteBattleToTactical(state, systemId);
  viewedSystemId = systemId;
  view = 'system';
  selection = null;
  follow.enabled = false;
  snapCameraTo(0, 0);
  const battle = getBattleState(state, systemId);
  if (battle?.active) battle.alertAcknowledged = true;
  const alert = document.getElementById('battle-alert');
  if (alert?.dataset.systemId === systemId) alert.classList.add('hidden');
}

function showBattleAlert({ systemId, mode = 'tactical' }) {
  const alert = document.getElementById('battle-alert');
  if (!alert || !systemId) return;
  alert.dataset.systemId = systemId;
  const name = systemById(state, systemId)?.name ?? systemId;
  const systemEl = document.getElementById('battle-alert-system');
  const detailEl = document.getElementById('battle-alert-detail');
  if (systemEl) systemEl.textContent = name;
  if (detailEl) detailEl.textContent = `${mode === 'tactical' ? 'Fleet engagement' : 'Offscreen engagement'} · strategic simulation continues`;
  const viewBtn = document.getElementById('battle-alert-view');
  if (viewBtn) viewBtn.onclick = () => doViewSystem(systemId);
  alert.classList.remove('hidden');
}

function clearBattleAlert(systemId) {
  const alert = document.getElementById('battle-alert');
  if (!alert || (systemId && alert.dataset.systemId !== systemId)) return;
  alert.classList.add('hidden');
}

function doFocusTutorial() {
  const focus = getTutorialFocus(state);
  if (!focus) return { ok: false, reason: 'No tutorial target is available' };

  setFlagshipInput(0, 0, state.time);
  if (focus.view === 'galaxy') {
    view = 'galaxy';
    selection = null;
    galaxyTargetStarId = focus.systemId;
    const graph = getGraph(state);
    const target = graph?.stars.find((star) => star.id === focus.systemId);
    if (target) {
      const targetScreenX = Math.min(canvas.width - 88, canvas.width * 0.86);
      const targetScreenY = canvas.height * 0.42;
      galaxyCamera.x = target.x - (targetScreenX - canvas.width / 2) / galaxyCamera.zoom;
      galaxyCamera.y = target.y - (targetScreenY - canvas.height / 2) / galaxyCamera.zoom;
    }
    return { ok: true };
  }

  doViewSystem(focus.systemId);
  selection = focus.bodyId ?? null;
  markTutorialSystemViewed(state);

  if (focus.panel === 'logistics') {
    document.getElementById('tab-logistics')?.click();
    markTutorialLogisticsOpened(state);
  } else if (focus.panel === 'fleet') {
    document.getElementById('tab-fleet')?.click();
  } else if (focus.panel === 'campaign') {
    document.getElementById('tab-campaign')?.click();
  } else if (focus.showIntel) {
    const intel = document.getElementById('intel-panel');
    intel?.classList.remove('hidden');
  }

  return { ok: true };
}

function doFlagshipInput(x, y) {
  if (view !== 'system') {
    setFlagshipInput(0, 0, state.time);
    return;
  }
  setFlagshipInput(x, y, state.time);
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

function doToggleWingHangar() {
  const res = toggleFlagshipWingHangar(state);
  if (!res.ok) {
    toast(res.reason, 'error');
    return res;
  }
  if (res.already) {
    toast(res.hangar === 'stowed' || res.hangar === 'recalling'
      ? 'Escorts already in hangar'
      : 'Escorts already deployed', 'ok');
    return res;
  }
  toast(res.hangar === 'recalling' ? 'Escorts returning to hangar' : 'Escorts launching', 'ok');
  return res;
}

function doOrderTravel(targetId) {
  const access = tutorialGuard('flagship_travel');
  if (!access.ok) return access;
  const res = orderTravel(state, targetId);
  if (res.ok) {
    accelerateCurrentTransit(state.flagship);
    const tutorial = getTutorialState(state);
    if (tutorial.active && tutorial.step === 'travel_to_battle' && targetId === tutorial.targetSystemId) {
      for (const ship of state.playerShips ?? []) {
        if (ship.systemId !== state.stronghold || ship.transit || ship.hp <= 0 || ship.hull === 'scout') continue;
        const escort = orderShipTravel(state, ship.id, targetId);
        if (escort.ok) accelerateCurrentTransit(ship);
      }
    }
    syncFlagshipAnchoredFleets(state);
    const dest = systemById(state, targetId);
    toast(`Course set: ${dest.name} — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doOrderScoutTravel(targetId) {
  const access = tutorialGuard('scout_travel');
  if (!access.ok) return access;
  ensureSelectedScout();
  if (!selectedScoutId) {
    toast('Build a scout at your shipyard first', 'error');
    return { ok: false, reason: 'Build a scout at your shipyard first' };
  }
  const res = orderScoutTravel(state, selectedScoutId, targetId);
  if (res.ok) {
    accelerateCurrentTransit(findScout(state, selectedScoutId), 1800);
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

function doOrderBuilderDroneTravel(targetId) {
  if (!selectedBuilderDroneId) {
    return { ok: false, reason: 'Select a builder drone in Fleet Command first' };
  }
  const res = deployBuilderDrone(state, targetId, selectedBuilderDroneId);
  if (res.ok) {
    const dest = systemById(state, targetId);
    toast(`Builder drone dispatched to ${dest?.name ?? targetId} — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doBuildOutpost(planetId) {
  const access = tutorialGuard('outpost');
  if (!access.ok) return access;
  const res = buildOutpost(state, viewedSystemId, planetId);
  if (res.ok) {
    toast(`Outpost established on ${findPlanet(state, viewedSystemId, planetId).name}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  if (res.ok) tryAdvanceTutorial(state);
  return res;
}

function doBuildShipyard(planetId) {
  const access = tutorialGuard('shipyard');
  if (!access.ok) return access;
  const res = buildShipyard(state, viewedSystemId, planetId);
  if (res.ok) {
    toast(`Shipyard established on ${findPlanet(state, viewedSystemId, planetId).name}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doQueueScout(shipyardId) {
  const access = tutorialGuard('scout_queue');
  if (!access.ok) return access;
  const res = queueScout(state, shipyardId, viewedSystemId);
  if (res.ok) {
    toast(`Scout queued (${SCOUT_BUILD_MS / 1000}s)`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doQueueHull(shipyardId, hull) {
  const access = tutorialGuard(hull === 'scout' ? 'scout_queue' : 'combat_ship_queue');
  if (!access.ok) return access;
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
  const access = tutorialGuard('dyson');
  if (!access.ok) return access;
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
  const access = tutorialGuard('dyson');
  if (!access.ok) return access;
  const res = buildLauncher(state, viewedSystemId, bodyId);
  if (res.ok) toast('Dyson launcher deployed', 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doDeployBuilderDrone(systemId) {
  const access = tutorialGuard('operations');
  if (!access.ok) return access;
  const res = deployBuilderDrone(state, systemId);
  if (res.ok) {
    const name = systemById(state, res.systemId)?.name ?? res.systemId;
    toast(`Builder drone deployed to ${name}`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function doCancelBuilderDrone(droneId) {
  const res = cancelBuilderDrone(state, droneId);
  toast(res.ok ? 'Builder drone recalled' : res.reason, res.ok ? 'ok' : 'error');
  return res;
}

function doEnterWormhole(opts = {}) {
  const access = tutorialGuard('wormholes');
  if (!access.ok) return access;
  const res = orderWormholeTravel(state, opts);
  if (res.ok) toast(`Wormhole transit — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doBuildWormholeAnchor(targetGalaxyId) {
  const access = tutorialGuard('wormholes');
  if (!access.ok) return access;
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
  ensureLogisticsState(state);
  followedConvoyId = null;
  selection = null;
  selectedScoutId = null;
  selectedBattleGroupId = null;
  selectedBuilderDroneId = null;
  viewedSystemId = newState.flagship.systemId ?? newState.stronghold;
  lastFlagshipSystemId = newState.flagship.systemId;
  follow.enabled = true;
  resetStructureIds(state);
  resetScoutIds(state);
  resetDroneIds(state);
  resetShipIds(state);
  resetBattleGroupIds(state);
  resetSuperweaponIds(state);
  resetHeroFlagshipIds(state);
  resetBuilderDroneIds(state);
  resetPirateIds(state);
  resetQueueIds(state);
  resetAiShipIds(state);
  resetWormholeJumpCounter(state.wormholeJumpCounter ?? 0, state);
  migrateShipyardBuilds(state);
  if (!newState.empireQueue) newState.empireQueue = [];
  if (!newState.research) newState.research = { activeNodeId: null, progress: 0, unlocked: ['eco_baseline'], queue: [] };
  if (!newState.aiShips) newState.aiShips = [];
  if (!newState.constructionJobs) newState.constructionJobs = [];
  if (!newState.drones) newState.drones = [];
  if (!newState.factions?.ai?.homeSystemId) seedAiFaction(newState, newState.homeGalaxyId ?? 'gal-0');
  if (!newState.pirates?.fleets?.length) {
    newState.pirates = spawnPirateFleets(newState);
  }
  ensurePiratesState(newState);
  if (!newState.activeGalaxyId) newState.activeGalaxyId = 'gal-0';
  if (!newState.homeGalaxyId) newState.homeGalaxyId = 'gal-0';
  if (!newState.battleGroups) newState.battleGroups = [];
  initBuilderDrones(state);
  ensureSelectedScout();
  const f = state.flagship;
  snapCameraTo(f.systemId ? f.x : 0, f.systemId ? f.y : 0);
  setBootPhase(BOOT_PHASE.PLAYING);
  state.paused = false;
  combatSelectionIds = [];
  document.getElementById('title-screen')?.classList.add('hidden');
}

let tutorialBattlePreparing = false;

async function prepareTutorialBattle(systemId) {
  if (tutorialBattlePreparing || !tutorialNeedsBattlePreparation(state, systemId)) return null;
  tutorialBattlePreparing = true;
  state.paused = true;
  const checkpoint = await writeTutorialCheckpoint(state);
  if (!checkpoint.ok) toast(`Training checkpoint failed: ${checkpoint.error}`, 'error');

  forcePirateIntoSystem(state, systemId);
  const fixture = state.pirates?.fleets?.[0];
  if (fixture) {
    fixture.tutorialFixture = true;
    fixture.ships = fixture.ships.slice(0, 1);
    for (const ship of fixture.ships) {
      ship.hp = Math.max(1, Math.round((ship.maxHp ?? ship.hp ?? 1) * 0.45));
    }
  }
  const battle = checkBattleTrigger(state, systemId);
  if (battle) {
    promoteBattleToTactical(state, systemId);
    battle.advancedTactics = true;
    battle.alertAcknowledged = true;
  }
  viewedSystemId = systemId;
  view = 'system';
  selection = null;
  follow.enabled = false;
  snapCameraTo(0, 0);
  markTutorialBattlePrepared(state);
  toast('Training contact detected — time paused for tactical orders', 'error');
  tutorialBattlePreparing = false;
  return battle;
}

async function doRetryTutorialBattle() {
  state.paused = true;
  const checkpoint = await readTutorialCheckpoint();
  if (!checkpoint.ok) {
    toast(`Could not restore training checkpoint: ${checkpoint.error}`, 'error');
    return checkpoint;
  }
  doImportState(checkpoint.state);
  state.paused = true;
  const targetSystemId = state.campaign?.tutorial?.targetSystemId;
  tutorialBattlePreparing = false;
  await prepareTutorialBattle(targetSystemId);
  toast('Training engagement restored from checkpoint', 'info');
  return { ok: true };
}

async function doBeginTutorialGraduation() {
  const result = beginTutorialGraduation(state);
  if (!result.ok) return result;
  await markTutorialGraduated(Date.now());
  await clearTutorialCheckpoint();
  state.paused = true;
  return result;
}

function doCompleteTutorialGraduation(opts = {}) {
  const result = completeTutorialGraduation(state, opts);
  if (result.ok) {
    state.paused = false;
    toast('Academy complete — sovereign command granted', 'ok');
  }
  return result;
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
    prepareTutorialBattle(current);
  }
  lastFlagshipSystemId = current;
}

function doFollowConvoy(convoyId) {
  const convoy = activeConvoys(state).find((entry) => entry.id === convoyId);
  if (!convoy) return { ok: false, reason: 'Convoy is no longer active' };
  followedConvoyId = convoyId;
  view = 'galaxy';
  follow.enabled = false;
  const status = convoyTransitStatus(state, convoy);
  if (status) {
    galaxyCamera.x = status.x;
    galaxyCamera.y = status.y;
    galaxyCamera.zoom = Math.max(galaxyCamera.zoom, 0.28);
  }
  toast(`Following ${convoyId}`, 'ok');
  return { ok: true, convoyId };
}

function doIssueTacticalOrder(order, groupId = selectedBattleGroupId) {
  const access = tutorialGuard('tactical_combat');
  if (!access.ok) return access;
  const group = groupId ? battleGroupsForGalaxy(state).find((entry) => entry.id === groupId) : null;
  const fleetShipIds = new Set(group?.shipIds ?? []);
  const candidateSystemIds = [
    viewedSystemId,
    ...(state.playerShips ?? [])
      .filter((ship) => fleetShipIds.has(ship.id) && ship.systemId)
      .map((ship) => ship.systemId),
  ];
  const systemId = candidateSystemIds.find((id) => getBattleState(state, id)?.active);
  const battle = systemId ? getBattleState(state, systemId) : null;
  if (!battle?.active || battle.mode !== 'tactical') {
    return { ok: false, reason: 'No controllable tactical battle is active' };
  }
  if (battle.advancedTactics !== true && order?.type !== 'emergency_retreat') {
    return { ok: false, reason: 'Enable Command Assist to issue individual orders' };
  }
  const allPlayerUnits = battle.units.filter((unit) => unit.side === 'player' && unit.hp > 0);
  const liveIds = new Set(allPlayerUnits.map((unit) => String(unit.id)));
  let subjectIds;
  if (Array.isArray(order?.subjectIds) && order.subjectIds.length) {
    subjectIds = [...new Set(order.subjectIds.map(String))].filter((id) => liveIds.has(id));
    if (!subjectIds.length) return { ok: false, reason: 'No live selected units in this battle' };
  } else {
    subjectIds = allPlayerUnits
      .filter((unit) => !group || fleetShipIds.has(unit.id) || fleetShipIds.has(unit.parentCarrierId))
      .map((unit) => unit.id);
    if (!subjectIds.length) return { ok: false, reason: 'Selected fleet has no live units in this battle' };
  }
  const canonical = {
    ...order,
    side: 'player',
    groupId: group?.id ?? null,
    subjectIds,
  };
  const result = applyFleetOrder(battle, canonical, {
    time: state.time,
    units: battle.units,
    ownedUnitIds: subjectIds,
    targetIds: battle.units.filter((unit) => unit.hp > 0).map((unit) => unit.id),
    convoyIds: activeConvoys(state).map((convoy) => convoy.id),
    destinationIds: getGraph(state).stars.map((star) => star.id),
  });
  if (result.ok && order?.type === 'formation') {
    battle.playerFormationOverride = true;
  }
  if (result.ok && order?.type === 'attack') markTutorialBattleCommand(state);
  if (result.ok) toast(`Order #${result.order.sequence}: ${result.order.type.replaceAll('_', ' ')}`, 'ok');
  else toast(result.reason, 'error');
  return result;
}

function doSetCombatDoctrine(doctrine) {
  const result = setCombatDoctrine(state, doctrine, viewedSystemId);
  if (result.ok) toast(`Doctrine: ${normalizeDoctrine(doctrine).replaceAll('_', ' ')}`, 'ok');
  return result;
}

function doSetAdvancedTactics(enabled) {
  const result = setAdvancedTactics(state, enabled, viewedSystemId);
  if (!enabled) {
    const battle = getBattleState(state, viewedSystemId);
    if (battle?.active) {
      battle.playerFormationOverride = false;
      setCombatDoctrine(state, battle.doctrine ?? state.combatDoctrine, viewedSystemId);
    }
    combatCommandMode = null;
  }
  return result;
}

function doRecommendCombatFormation() {
  const battle = getBattleState(state, viewedSystemId);
  if (!battle?.active) return null;
  return recommendFormation({
    doctrine: battle.doctrine ?? state.combatDoctrine,
    ownMix: analyzeFleetMix(battle.units.filter((unit) => unit.side === 'player' && unit.hp > 0)),
    enemyMix: analyzeFleetMix(battle.units.filter((unit) => unit.side !== 'player' && unit.hp > 0)),
  });
}

function validateSolRecommendationForGame(recommendation, options = {}) {
  return validateSolCommand(state, recommendation, {
    ...options,
    buildCatalog: SOL_BUILD_CATALOG,
  });
}

function executeSolRecommendation(recommendation, { confirmed = false } = {}) {
  const validation = validateSolRecommendationForGame(recommendation, {
    stage: 'execute',
    confirmed,
  });
  if (!validation.ok) return validation;
  const { tool, arguments: args } = validation.command;
  if (!tool.startsWith('propose_')) {
    return { ok: true, inspected: true, tool };
  }

  if (tool === 'propose_route') {
    const depot = findExportDepot(state, args.fromSystemId);
    if (!depot) return { ok: false, reason: 'No export depot exists at the proposed origin' };
    return setDepotDestination(state, depot.id, args.toSystemId);
  }

  if (tool === 'propose_fleet_order') {
    const type = args.order === 'attack_target_class' ? 'attack_class' : args.order;
    const targetClass = args.targetClass === 'bomber' ? 'fighter' : args.targetClass;
    const formation = args.formation === 'escort' ? 'screen' : args.formation;
    const battleOrder = {
      type,
      targetId: args.targetId ?? null,
      targetClass: targetClass ?? null,
      formation: formation ?? null,
      convoyId: type === 'escort_convoy' ? args.targetId : null,
      destinationId: type === 'emergency_retreat' ? args.targetSystemId : null,
      point: ['rally', 'emergency_retreat'].includes(type) && !args.targetSystemId
        ? { x: type === 'rally' ? 0 : -1500, y: 0 }
        : null,
    };
    return doIssueTacticalOrder(battleOrder, args.fleetId);
  }

  if (tool === 'propose_build') {
    const { systemId, bodyId, structureType } = args;
    if (structureType === 'outpost') return buildOutpost(state, systemId, bodyId);
    if (structureType === 'shipyard') return buildShipyard(state, systemId, bodyId);
    if (structureType === 'trade_station' || structureType === 'export_depot') {
      return buildTradeStation(state, systemId, bodyId);
    }
    if (structureType === 'research_station') return buildResearchStation(state, systemId);
    if (structureType === 'dyson_foundry') return buildFoundry(state, systemId, bodyId);
    if (structureType === 'solar_sail_launcher') return buildLauncher(state, systemId, bodyId);
    if (structureType === 'superweapon_cradle') return buildSuperweaponCradle(state, systemId);
    if (BODY_STRUCTURE_DEFS[structureType]) {
      return buildBodyStructure(state, systemId, bodyId, structureType);
    }
    if (STRUCTURE_DEFS[structureType]) {
      return buildStrategicStructure(state, systemId, structureType, bodyId);
    }
  }
  return { ok: false, reason: 'Unsupported validated command' };
}

// --- UI + input wiring ---

const { updateUi, closeSidePanel } = initUi({
  getState: () => state,
  getSelection: () => selection,
  setSelection: (id) => { selection = id; },
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  getSelectedBuilderDroneId: () => selectedBuilderDroneId,
  getSelectedScoutId: () => selectedScoutId,
  doSelectScout,
  doSelectBuilderDrone,
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
  doToggleWingHangar,
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
  builderDroneSummary,
  cancelBuilderConstructionOrder: (orderId) => cancelBuilderConstructionOrder(state, orderId),
  canDeployBuilderDrone: (systemId) => canDeployBuilderDrone(state, systemId),
  deployBuilderDrone: doDeployBuilderDrone,
  getDroneConstructionCatalog: (systemId, draft) => getDroneConstructionCatalog(state, systemId, draft),
  confirmBuilderConstructionPlan: (systemId, draft) => confirmBuilderConstructionPlan(state, systemId, draft),
  setBuilderDronesAwaitingOrders: (systemId, awaiting) => {
    for (const drone of state.builderDrones ?? []) {
      if (drone.systemId === systemId && drone.status === 'idle') drone.awaitingOrders = awaiting;
    }
  },
  cancelBuilderDrone: doCancelBuilderDrone,
  getGalaxyTargetStar: () => galaxyTargetStarId,
  doStartNewGame: (opts) => doStartNewGame(opts),
  doFocusTutorial,
  doBeginTutorialGraduation,
  doCompleteTutorialGraduation,
  doRetryTutorialBattle,
  tutorialAccess: (featureId) => tutorialAccess(state, featureId),
  executeSolRecommendation,
  validateSolRecommendation: validateSolRecommendationForGame,
  issueTacticalOrder: doIssueTacticalOrder,
  setCombatDoctrine: doSetCombatDoctrine,
  setCombatPriority: (priority) => setCombatFleetPriority(state, priority, viewedSystemId),
  setAdvancedTactics: doSetAdvancedTactics,
  getFlagshipControlStatus: () => flagshipControlStatus(state),
  getCombatSelection: () => [...combatSelectionIds],
  selectCombatUnit: doSelectCombatUnit,
  clearCombatSelection: doClearCombatSelection,
  combatFocus: doCombatFocus,
  getCombatCommandMode: () => combatCommandMode,
  setCombatCommandMode: doSetCombatCommandMode,
  combatUiActive,
  followConvoy: doFollowConvoy,
  getBootPhase,
  setBootPhase,
});

attachInput(canvas, {
  getState: () => state,
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  getSelectedBuilderDroneId: () => selectedBuilderDroneId,
  getSelectedScoutId: () => selectedScoutId,
  onSelect: (id) => { selection = id; },
  onCombatSelect: doSelectCombatUnit,
  onCombatFocus: doCombatFocus,
  getCombatCommandMode: () => combatCommandMode,
  onCombatCommand: doCombatCommandAt,
  onCombatContextCommand: doCombatContextCommand,
  onCombatCancelCommand: () => doSetCombatCommandMode(null),
  onCombatClearSelection: doClearCombatSelection,
  onCombatMarqueeSelect: doSelectCombatUnitsInWorldRect,
  onCombatMarquee: doSetCombatMarquee,
  combatUiActive,
  onCloseSidePanel: closeSidePanel,
  onTogglePause: doTogglePause,
  onToggleView: doToggleView,
  onFlagshipInput: doFlagshipInput,
  onStarTravel: doOrderTravel,
  onScoutTravel: doOrderScoutTravel,
  onBuilderDroneTravel: doOrderBuilderDroneTravel,
  onBattleGroupTravel: doOrderBattleGroupTravel,
  onBattleGroupSelect: doSelectBattleGroup,
  onStarView: doViewSystem,
  onScoutSelect: doSelectScout,
  onFollowRequest: () => { follow.enabled = true; },
  onToggleOrbit: doToggleOrbit,
  onGalaxyStarClick: (starId) => { galaxyTargetStarId = starId; },
  onBuilderDroneDeployClick: doDeployBuilderDrone,
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
    retryTutorialBattle: doRetryTutorialBattle,
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
  const phase = getBootPhase();

  if (phase === BOOT_PHASE.TITLE) {
    drawTitleBackground(ctx2d, canvas, now);
    updateUi();
    requestAnimationFrame(frame);
    return;
  }

  if (phase === BOOT_PHASE.WARP_INTRO) {
    drawWarpIntro(ctx2d, canvas, now);
    updateUi();
    requestAnimationFrame(frame);
    return;
  }

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
  for (const arrival of tickEvents.pirateArrivals ?? []) {
    const name = systemById(state, arrival.systemId)?.name ?? arrival.systemId;
    toast(`Pirate fleet sighted at ${name}`, 'error');
  }
  for (const ev of tickEvents.pirateInterdictions ?? []) {
    const name = systemById(state, ev.systemId)?.name ?? ev.systemId;
    toast(`Pirates intercepted ${ev.shipId} near ${name}`, 'error');
  }
  for (const battle of tickEvents.battleEvents ?? []) {
    const name = systemById(state, battle.systemId)?.name ?? battle.systemId;
    if (battle.type === 'battle_started') {
      const activeBattle = getBattleState(state, battle.systemId);
      if (view === 'system' && viewedSystemId === battle.systemId) {
        promoteBattleToTactical(state, battle.systemId);
        if (activeBattle) activeBattle.alertAcknowledged = true;
        clearBattleAlert(battle.systemId);
      } else {
        showBattleAlert(battle);
      }
      toast(`Battle started at ${name}`, 'error');
      continue;
    }
    const outcome = battle.playerWins ? 'Victory' : 'Defeat';
    clearBattleAlert(battle.systemId);
    toast(`${outcome} at ${name} (${battle.mode})`, battle.playerWins ? 'ok' : 'error');
    const tutorial = getTutorialState(state);
    if (tutorial.active && battle.systemId === tutorial.targetSystemId) {
      markTutorialBattleResolved(state, battle.playerWins);
      if (battle.playerWins) {
        clearTutorialCheckpoint();
      } else {
        state.paused = true;
        toast('Training battle lost — restoring checkpoint', 'error');
        setTimeout(() => doRetryTutorialBattle(), 700);
      }
    }
  }
  const pendingBattle = Object.values(state.systemBattles ?? {}).find(
    (battle) => battle?.active && !battle.alertAcknowledged,
  );
  if (pendingBattle && view === 'system' && viewedSystemId === pendingBattle.systemId) {
    pendingBattle.alertAcknowledged = true;
    clearBattleAlert(pendingBattle.systemId);
  } else if (pendingBattle && document.getElementById('battle-alert')?.classList.contains('hidden')) {
    showBattleAlert(pendingBattle);
  }
  for (const ev of tickEvents.builderDroneEvents ?? []) {
    if (ev.type === 'builder_drone_deployed') {
      state.paused = true;
      const name = systemById(state, ev.systemId)?.name ?? ev.systemId;
      toast(`Construction drone arrived at ${name}`, 'ok');
    } else if (ev.type === 'builder_drone_build_complete') {
      const name = systemById(state, ev.systemId)?.name ?? ev.systemId;
      toast(`Builder drone completed ${ev.buildType} at ${name}`, 'ok');
    } else if (ev.type === 'builder_drone_build_failed') {
      toast(`Builder drone failed: ${ev.reason}`, 'error');
    }
  }
  for (const ev of tickEvents.logisticsEvents ?? []) {
    if (ev.ownerId && ev.ownerId !== 'player') continue;
    if (ev.type === 'convoy_dispatched') {
      toast(`${ev.convoyId} completed space-compression jump prep`, 'info');
    } else if (ev.type === 'convoy_delivered') {
      toast(`${ev.convoyId} delivered ${Math.floor(ev.credits)} credits`, 'ok');
    } else if (ev.type === 'convoy_intercepted') {
      toast(`${ev.convoyId} intercepted${ev.destroyed ? ' and destroyed' : ''}`, 'error');
    }
  }
  for (const cap of tickEvents.captures ?? []) {
    if (!cap?.captured) continue;
    const name = systemById(state, cap.captured)?.name ?? cap.captured;
    toast(`Captured: ${name}`, 'ok');
    tryAdvanceTutorial(state);
  }
  for (const ev of tickEvents.strategicOperationEvents ?? []) {
    if (ev.type === 'campaign_complete') toast(`Expansion campaign ${ev.campaignId} complete`, 'ok');
    if (ev.type === 'blocked') toast(`Expansion campaign blocked: ${ev.code}`, 'error');
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
  for (const done of tickEvents.droneCompletions ?? []) {
    const label = done.structureType?.replace(/_/g, ' ') ?? 'Structure';
    toast(`${label} construction complete`, 'ok');
  }

  for (const ev of tickEvents.campaignEvents ?? []) {
    if (ev.type === 'victory') toast(`Victory: ${ev.victoryType}`, 'ok');
    if (ev.type === 'defeat') toast(`Defeat: ${ev.reason}`, 'error');
  }

  tickContextualTips(state, toast);

  for (const wh of tickEvents.wormholeArrivals ?? []) {
    triggerWormholeArrivalFx(state, wh);
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
    if (followedConvoyId) {
      const convoy = activeConvoys(state).find((entry) => entry.id === followedConvoyId);
      const convoyStatus = convoy ? convoyTransitStatus(state, convoy) : null;
      if (convoyStatus) {
        galaxyCamera.x = convoyStatus.x;
        galaxyCamera.y = convoyStatus.y;
      } else {
        followedConvoyId = null;
      }
    }
    const tutorialFocus = getTutorialFocus(state);
    drawGalaxy(
      ctx2d,
      state,
      selectedScoutId,
      selectedBattleGroupId,
      tutorialFocus?.view === 'galaxy' ? tutorialFocus.systemId : null,
    );
  } else {
    markTutorialSystemViewed(state);
    updateFollowCamera(state, viewedSystemId, dt, accumulator);
    drawSystem(ctx2d, state, viewedSystemId, selection, accumulator, combatOverlayForRender());
  }
  updateUi();
  if (devPanel?.isOpen()) devPanel.updateDevPanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Test hooks ---

window.advanceTime = (ms) => {
  if (getBootPhase() === BOOT_PHASE.WARP_INTRO) {
    const intro = warpIntroState();
    return setWarpIntroElapsedForTest(intro.elapsedMs + Math.max(0, Number(ms) || 0));
  }
  const events = advance(state, ms);
  for (const wh of events.wormholeArrivals ?? []) {
    triggerWormholeArrivalFx(state, wh);
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
  const whVisual = wormholeVisualState(state);
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
  const stellarInfo = stellarCatalogInfo(viewedSystem?.star);

  const passiveOutpostCreditsPerSecond = incomePerSecond(state);
  const cargoDeliveryCreditsPerSecond = logisticsSummary(state).throughputCreditsPerMinute / 60;
  return JSON.stringify({
    bootPhase: getBootPhase(),
    intro: getBootPhase() === BOOT_PHASE.WARP_INTRO ? warpIntroState() : null,
    saveVersion: SAVE_VERSION,
    time: state.time,
    paused: state.paused,
    aiDifficulty: state.aiDifficulty ?? 'normal',
    credits: state.credits,
    solarii: state.solarii ?? 0,
    solariiUnlocked: !!state.solariiUnlocked,
    solariiPerSec: solariiPerSecond(state),
    view,
    currentSystem: viewedSystemId,
    systemName: viewedSystem?.name ?? null,
    systemCatalogId: viewedSystem?.catalogId ?? null,
    systemAlias: viewedSystem?.alias ?? null,
    systemKind: viewedSystem?.star?.kind ?? 'star',
    stellarClass: stellarInfo?.displayName ?? null,
    stellarRendererKind: stellarInfo?.rendererKind ?? null,
    stellarProperties: stellarInfo?.properties ?? null,
    tradeNexus: viewedSystem?.star?.kind === 'trade_nexus',
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
    wormholeVisualPhase: whVisual.phase,
    selection,
    selectedScoutId,
    selectedBattleGroupId,
    passiveOutpostCreditsPerSecond,
    cargoDeliveryCreditsPerSecond,
    totalProjectedCreditsPerSecond: passiveOutpostCreditsPerSecond + cargoDeliveryCreditsPerSecond,
    incomePerSec: passiveOutpostCreditsPerSecond + cargoDeliveryCreditsPerSecond,
    incomePerSecInViewedSystem: incomePerSecondInSystem(state, viewedSystemId),
    flagship: {
      galaxyId: f.galaxyId,
      hp: f.hp,
      maxHp: f.maxHp,
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
        phase: whTransit.phase,
        etaMs: whTransit.etaMs,
      } : null,
      atCore: f.systemId === BLACK_HOLE_ID && !f.transit && !f.wormholeTransit,
      canEnterWormhole: canEnterWormhole(state).ok,
      weapons: ensureFlagshipWeapons(state).map((w) => ({
        id: w.id,
        profile: w.profile,
        hardpoint: w.hardpoint,
        cooldownMs: w.cooldownMs ?? 0,
      })),
      wing: flagshipWingSummary(state),
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
    drones: (() => {
      const summary = droneSummaryForSystem(state, viewedSystemId);
      const poses = dronePoses(state, viewedSystemId, state.time).map((dp) => ({
        id: dp.drone.id,
        jobId: dp.jobId,
        phase: dp.phase,
        x: Math.round(dp.x * 10) / 10,
        y: Math.round(dp.y * 10) / 10,
        heading: Math.round(dp.heading * 1000) / 1000,
      }));
      return {
        capacity: droneCapacity(state, viewedSystemId),
        ...summary,
        inViewedSystem: poses,
      };
    })(),
    constructionJobs: activeJobsInSystem(state, viewedSystemId).map((job) => ({
      id: job.id,
      structureType: job.structureType,
      bodyId: job.bodyId,
      structureId: job.structureId,
      progress: Math.round(jobProgress(job) * 1000) / 1000,
      status: job.status,
      workDoneMs: job.workDoneMs,
      workRequiredMs: job.workRequiredMs,
      etaMs: jobEtaMs(job, state),
      assignedDrones: job.assignedDroneIds?.length ?? 0,
    })),
    logistics: {
      ...logisticsSummary(state),
      nexuses: discoverTradeNexuses(state),
      depots: Object.values(state.logistics?.depots ?? {}).map((depot) => ({
        id: depot.id,
        systemId: depot.systemId,
        operational: depot.operational,
        routePaused: depot.routePaused,
        preferredNexusId: depot.preferredNexusId,
        inventory: depot.inventory,
      })),
      convoys: activeConvoys(state).map((convoy) => ({
        id: convoy.id,
        ownerId: convoy.ownerId ?? 'player',
        status: convoy.status,
        fromSystemId: convoy.fromSystemId,
        destinationSystemId: convoy.destinationSystemId,
        path: [...convoy.path],
        manifest: convoy.manifest,
        escortStrength: convoy.escortStrength,
        projection: convoyTransitStatus(state, convoy),
      })),
    },
    solCommander: {
      enabled: !!state.solCommander?.settings?.enabled,
      providerMode: state.solCommander?.settings?.providerMode ?? 'offline',
      model: state.solCommander?.settings?.model ?? 'gpt-5.6-sol',
      confirmationRequired: state.solCommander?.settings?.confirmationRequired !== false,
      previewData: state.solCommander?.settings?.previewData !== false,
      historyCount: state.solCommander?.history?.length ?? 0,
    },
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
      weaponProfile: ship.weaponProfile ?? null,
      wingState: ship.wingState ?? null,
    })),
    battleGroups: battleGroupsForGalaxy(state).map((g) => ({
      id: g.id,
      name: formatFleetName(g.ordinal),
      ordinal: g.ordinal,
      shipIds: [...g.shipIds],
      anchorHeroId: g.anchorHeroId ?? null,
      anchorFlagship: !!g.anchorFlagship,
    })),
    builderDrones: builderDroneSummary(state),
    pirates: {
      fleetCount: state.pirates?.fleets?.length ?? 0,
      inViewedSystem: pirateFleetAtSystem(state, viewedSystemId).length > 0,
      markers: pirateSystemsWithPresence(state),
      galaxyMarkers: pirateFleetMarkersForGalaxy(state),
      transitMarkers: pirateFleetTransitMarkersForGalaxy(state),
      fleets: (state.pirates?.fleets ?? []).map((fleet) => ({
        id: fleet.id,
        systemId: fleet.systemId,
        inTransit: !!fleet.transit,
        destination: fleet.transit?.path?.length ? fleet.transit.path[fleet.transit.path.length - 1] : null,
        etaMs: fleet.transit ? pirateFleetEtaMs(state, fleet) : null,
        intent: fleet.intent?.type ?? 'wander',
        targetSystemId: fleet.intent?.targetSystemId ?? null,
        shipCount: fleet.ships.filter((s) => s.hp > 0).length,
        power: pirateFleetPower(fleet, state),
        totalHp: fleet.ships.reduce((n, s) => n + Math.max(0, s.hp), 0),
      })),
    },
    battle: battleSummaryForSystem(state, viewedSystemId),
    tacticalOrders: getBattleState(state, viewedSystemId)?.tacticalOrders ?? {},
    combatUi: (() => {
      pruneCombatSelection();
      const summary = battleSummaryForSystem(state, viewedSystemId);
      const battle = getBattleState(state, viewedSystemId);
      const selected = new Set([...combatSelectionIds].map(String));
      const directives = activeFleetOrders(battle, 'player')
        .filter((order) => order.type !== 'formation'
          && (order.subjectIds.length === 0
            || order.subjectIds.some((id) => selected.has(String(id)))));
      const activeDirective = directives.at(-1) ?? null;
      const selectedUnits = (battle?.units ?? [])
        .filter((unit) => unit.hp > 0 && selected.has(String(unit.id)))
        .map((unit) => ({
          id: unit.id,
          hull: unit.hull,
          position: { x: Math.round(unit.x * 10) / 10, y: Math.round(unit.y * 10) / 10 },
          headingRadians: Math.round((unit.heading ?? 0) * 1000) / 1000,
          weaponProfile: unit.weaponProfile,
          weaponArcRadians: Math.round(weaponArcRadians(unit.weaponProfile) * 1000) / 1000,
          weaponTargetId: unit.weaponTargetId ?? null,
          recentThreat: unit.lastAttackerId == null ? null : {
            attackerId: unit.lastAttackerId,
            damagedAt: unit.lastDamagedAt ?? null,
            ageMs: Math.max(0, state.time - (unit.lastDamagedAt ?? state.time)),
          },
          destinationAnchor: unit.moveAnchor ?? null,
          destroyerAa: unit.aaBattery ? {
            unlocked: true,
            targetId: unit.aaBattery.targetId ?? null,
            cooldownMs: Math.round(unit.aaBattery.cooldownMs ?? 0),
            damageShare: unit.aaBattery.damageShare,
            firingArcRadians: Math.PI * 2,
          } : null,
          mountTargets: (unit.weapons ?? unit.weaponMounts ?? []).map((slot) => ({
            profile: slot.profile,
            targetId: slot.targetId ?? null,
            hardpoint: slot.hardpoint ?? null,
            firingArcRadians: Math.round(weaponArcRadians(slot.profile, slot.hardpoint) * 1000) / 1000,
          })),
        }));
      return {
        active: combatUiActive(),
        commandMode: combatCommandMode,
        doctrine: summary?.doctrine ?? state.combatDoctrine ?? null,
        fleetPriority: summary?.fleetPriority ?? ensureCombatSettings(state).fleetPriority,
        advancedTactics: summary?.advancedTactics ?? ensureCombatSettings(state).advancedTactics,
        flagshipControl: flagshipControlStatus(state),
        autonomy: summary?.autonomy ?? null,
        selectionIds: [...combatSelectionIds],
        focusTargetId: summary?.focusTargetId ?? null,
        activeDirective,
        threatBoard: battle?.threatBoards?.player ?? null,
        selectedUnits,
        destroyerAaUnlocked: !!techEffects(state).unlockDestroyerAa,
        formation: summary?.formation ?? null,
        autoFormationApplied: !!summary?.autoFormationApplied,
        playerFormationOverride: !!summary?.playerFormationOverride,
        coordinateSystem: 'World coordinates; heading 0 points east and increases clockwise on screen.',
      };
    })(),
    battleReports: (state.battleReports ?? []).slice(-5),
    hullStats: Object.keys(HULL_STATS),
    galaxy: {
      starCount: graph.stars.length,
      laneCount: graph.lanes.length,
      blackHole: graph.blackHole.id,
      galaxyId: state.activeGalaxyId,
      galaxyName: activeGal?.name ?? null,
      perf: galaxyPerfSummary(),
    },
    bodies: (viewedSystem?.bodies ?? []).map((b) => ({
      id: b.id,
      kind: b.kind,
      type: b.type,
      name: b.name,
      catalogId: b.catalogId ?? null,
      alias: b.alias ?? null,
      moonCount: b.moons.length,
      moons: b.moons.map((moon) => ({
        id: moon.id,
        kind: moon.kind,
        name: moon.name,
        catalogId: moon.catalogId ?? null,
        alias: moon.alias ?? null,
      })),
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
      placement: s.placement ?? null,
      level: s.level ?? 1,
      hp: s.hp ?? null,
      maxHp: s.maxHp ?? null,
      disabled: state.time < (s.disabledUntil ?? 0),
      operational: s.operational !== false && (s.hp ?? 1) > 0 && state.time >= (s.disabledUntil ?? 0),
      mothballed: !!s.mothballed,
      underConstruction: !!s.construction,
      building: s.type === 'shipyard' && (!!s.build || !!s.construction),
      buildProgress: s.construction
        ? jobProgress((state.constructionJobs ?? []).find((j) => j.id === s.construction.jobId))
        : (s.type === 'shipyard' ? shipyardBuildProgress(s, state.time) : null),
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
        buildings: sites.filter((s) => s.kind.startsWith('surface-')).length,
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
        drydocks: sites
          .filter((s) => s.kind === 'drydock')
          .map((s) => ({ bodyId: s.bodyId, x: round(s.x), y: round(s.y), active: s.active })),
        orbitalDefense: sites
          .filter((s) => s.kind === 'orbital_defense')
          .map((s) => ({ bodyId: s.bodyId, x: round(s.x), y: round(s.y), active: s.active })),
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
    bulkProduction: bulkProductionSummary(state),
    strategicOrders: strategicOrdersSummary(state),
    superweapon: superweaponSummary(state),
    heroFlagships: heroFlagshipsSummary(state),
    campaign: campaignSummary(state),
    missions: missionsSummary(state),
    tutorial: getTutorialState(state),
    strategicStructures: strategicStructuresSummary(state),
    bodyStructures: {
      empire: allBodyStructuresSummary(state),
      viewedSystem: bodyStructuresSummary(state, viewedSystemId),
      buildRows: selection ? bodyStructureBuildRows(state, viewedSystemId, selection).map((row) => ({
        type: row.type,
        label: row.label,
        placement: row.placement,
        cost: row.cost,
        canBuild: row.check.ok,
        reason: row.check.ok ? null : row.check.reason,
      })) : [],
    },
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
window.__autoAssignShipsToFleets = (options = {}) => autoAssignShipsToFleets(state, options);
window.__setBattleGroupFlagshipAnchor = (groupId, anchored = true) =>
  setBattleGroupFlagshipAnchor(state, groupId, anchored);
window.__syncFlagshipAnchoredFleets = () => syncFlagshipAnchoredFleets(state);
window.__orderBattleGroup = (starId) => doOrderBattleGroupTravel(starId);
window.__deleteBattleGroup = (groupId) => doDeleteBattleGroup(groupId);
window.__listBattleGroups = () => battleGroupsForGalaxy(state).map((g) => ({
  id: g.id,
  name: formatFleetName(g.ordinal),
  ordinal: g.ordinal,
  shipIds: [...g.shipIds],
  anchorHeroId: g.anchorHeroId ?? null,
  anchorFlagship: !!g.anchorFlagship,
}));
window.__formatFleetName = (ordinal) => formatFleetName(ordinal);
window.__setBattleStance = (stance) => setBattleStance(state, stance);
window.__forcePirateIntoSystem = (systemId) => {
  forcePirateIntoSystem(state, systemId);
  checkBattleTrigger(state, systemId);
};
window.__getBattleState = (systemId = null) => getBattleState(state, systemId ?? viewedSystemId);
window.__combatFxSummary = (systemId = null) => {
  const id = systemId ?? viewedSystemId;
  const battle = getBattleState(state, id);
  return combatFxSummary(battle, state.time);
};
window.__issueTacticalOrder = (order, groupId = null) => doIssueTacticalOrder(order, groupId);
window.__selectCombatUnits = (ids) => doSetCombatSelection(ids);
window.__clearCombatSelection = () => doClearCombatSelection();
window.__getCombatSelection = () => [...combatSelectionIds];
window.__setCombatDoctrine = (doctrine) => doSetCombatDoctrine(doctrine);
window.__setCombatPriority = (priority) => setCombatFleetPriority(state, priority, viewedSystemId);
window.__setAdvancedTactics = (enabled) => doSetAdvancedTactics(enabled);
window.__getCombatAutonomySummary = (systemId = null) =>
  combatAutonomySummary(state, systemId ?? viewedSystemId);
window.__recommendCombatFormation = () => doRecommendCombatFormation();
window.__hitTestCombatUnit = (wx, wy) => {
  const unit = hitTestCombatUnit(state, viewedSystemId, wx, wy);
  return unit ? { id: unit.id, side: unit.side, hull: unit.hull, x: unit.x, y: unit.y } : null;
};
window.__combatFocus = (targetId) => doCombatFocus(targetId);
window.__combatMove = (x, y) => doCombatMove({ x, y });
window.__setCombatCommandMode = (mode) => doSetCombatCommandMode(mode);
window.__getCombatCommandMode = () => combatCommandMode;
window.__getLogistics = () => JSON.parse(JSON.stringify(ensureLogisticsState(state)));
window.__listTradeNexuses = () => discoverTradeNexuses(state);
window.__registerExportDepot = (systemId, opts = {}) =>
  registerExportDepot(state, state.activeGalaxyId, systemId, opts);
window.__setDepotDestination = (depotId, nexusSystemId = null) =>
  setDepotDestination(state, depotId, nexusSystemId);
window.__dispatchDepot = (depotId, opts = {}) => dispatchDepot(state, depotId, opts);
window.__followConvoy = (convoyId) => doFollowConvoy(convoyId);
window.__offlineSolAdvice = () => createOfflineSolAdvice(state);
window.__redactedSolSnapshot = () => buildRedactedSolSnapshot(state);
window.__validateSolRecommendation = (recommendation, options = {}) =>
  validateSolRecommendationForGame(recommendation, options);
window.__executeSolRecommendation = (recommendation, confirmed = false) =>
  executeSolRecommendation(recommendation, { confirmed });
window.__getHullStats = () => ({ ...HULL_STATS });
window.__newGame = (seed = DEFAULT_SEED, opts = {}) => {
  resetWormholeJumpCounter(0);
  state = createNewGame(seed);
  state.aiDifficulty = ['easy', 'normal', 'hard', 'sovereign'].includes(opts.aiDifficulty)
    ? opts.aiDifficulty
    : 'normal';
  state.pirates = spawnPirateFleets(state);
  seedAiFaction(state, state.homeGalaxyId);
  resetContextualTips();
  galaxyTargetStarId = state.stronghold;
  if (opts.victoryType) setVictoryType(state, opts.victoryType, opts.mode ?? 'sandbox');
  if (opts.mode === 'tutorial') initTutorial(state, { replay: opts.replay === true });
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
  selectedBuilderDroneId = null;
  state.paused = true;
  document.getElementById('title-screen')?.classList.add('hidden');
  setBootPhase(BOOT_PHASE.WARP_INTRO);
  const objectiveLabels = {
    sandbox: 'OPEN ASCENDANCY',
    dominion: 'DOMINION PROTOCOL',
    megastructure: 'MEGASTRUCTURE ASCENSION',
    annihilation: 'TOTAL SUPREMACY',
    economic: 'ECONOMIC HEGEMONY',
    sculptor: 'GALACTIC SCULPTOR',
  };
  const modeLabels = {
    tutorial: 'GUIDED CAMPAIGN',
    mission: 'MISSION CAMPAIGN',
    sandbox: 'SANDBOX CAMPAIGN',
  };
  startWarpIntro(ctx2d, canvas, {
    campaign: {
      mode: modeLabels[opts.mode] ?? 'NEW CAMPAIGN',
      objective: objectiveLabels[opts.victoryType] ?? 'SOVEREIGN ASCENDANCY',
      difficulty: opts.aiDifficulty ?? 'normal',
      systemName: systemById(state, state.stronghold)?.name ?? 'Stronghold',
    },
    onComplete: () => {
      setBootPhase(BOOT_PHASE.PLAYING);
      state.paused = false;
      snapCameraTo(0, 0);
      camera.zoom = CAMERA_DEFAULT_ZOOM;
      follow.enabled = true;
      toast(`New ${opts.mode ?? 'sandbox'} campaign started`, 'ok');
    },
    drawGameFrame: (ctx, fade) => {
      const savedZoom = camera.zoom;
      camera.zoom = 0.24 + (CAMERA_DEFAULT_ZOOM - 0.24) * fade;
      ctx.save();
      ctx.globalAlpha = fade;
      drawSystem(ctx, state, viewedSystemId, selection, 0, combatOverlayForRender());
      ctx.restore();
      camera.zoom = savedZoom;
    },
  });
}
window.__setBootPhase = (phase) => setBootPhase(phase);
window.__getBootPhase = () => getBootPhase();
window.__getWarpIntroState = () => warpIntroState();
window.__setWarpIntroElapsed = (ms) => setWarpIntroElapsedForTest(ms);
window.__startWarpIntro = () => {
  document.getElementById('title-screen')?.classList.add('hidden');
  setBootPhase(BOOT_PHASE.WARP_INTRO);
  startWarpIntro(ctx2d, canvas, {
    onComplete: () => {
      setBootPhase(BOOT_PHASE.PLAYING);
      state.paused = false;
    },
  });
};
window.__saveSlot = (slot) => doSaveSlot(slot);
window.__loadSlot = (slot) => doLoadSlot(slot);
window.__setFlagshipInput = (x, y) => setFlagshipInput(x, y, state.time);
window.__orderTravel = (starId) => doOrderTravel(starId);
window.__orderScout = (scoutId, starId) => {
  if (scoutId) selectedScoutId = scoutId;
  return doOrderScoutTravel(starId);
};
window.__selectScout = (scoutId) => doSelectScout(scoutId);
window.__gatherIntel = (systemId) => gatherIntel(state, systemId);
window.__setView = (v) => doSetView(v);
window.__viewSystem = (systemId) => doViewSystem(systemId);
window.__stationedShipPose = (shipId, time = state.time) => {
  const ship = state.playerShips.find((candidate) => candidate.id === shipId);
  if (!ship?.systemId) return null;
  const system = systemById(state, ship.systemId);
  if (!system) return null;
  const ships = playerShipsAtSystem(state, ship.systemId);
  const index = ships.findIndex((candidate) => candidate.id === ship.id);
  return stationedShipPose(state, system, ship, Math.max(0, index), Math.max(1, ships.length), time);
};
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
window.__buildWormholeAnchor = (targetGalaxyId) => doBuildWormholeAnchor(targetGalaxyId);
window.__enterWormhole = (opts = {}) => doEnterWormhole(opts);
window.__hydrateGalaxy = (galaxyId) => hydrateGalaxy(state, galaxyId);
window.__dehydrateGalaxy = (galaxyId) => dehydrateGalaxy(state, galaxyId);
window.__getGraphStats = () => graphStats(getGraph(state));
window.__getAbstractGalaxy = (galaxyId) => state.galaxies?.[galaxyId]?.abstract ?? null;
window.__getGalaxyFingerprint = (galaxyId) => {
  const g = state.galaxies?.[galaxyId]?.graph;
  return g ? galaxyGraphFingerprint(g) : null;
};
window.__getStrongholdComposition = () => strongholdComposition(state);
window.__resetWormholeJumpCounter = (n = 0) => resetWormholeJumpCounter(n, state);
window.__completeWormholeTransit = () => {
  const wt = state.flagship?.wormholeTransit;
  if (!wt) return { ok: false, reason: 'No wormhole transit' };
  state.time = wt.startTime + wt.durationMs;
  const arrival = tickWormholeTransit(state);
  if (arrival) triggerWormholeArrivalFx(state, arrival);
  return arrival ? { ok: true, ...arrival } : { ok: false, reason: 'Transit incomplete' };
};
window.__listGalaxyIds = () => Object.keys(state.galaxies ?? {});
window.__queueOutpost = (planetId) => buildOutpost(state, viewedSystemId, planetId ?? selection);
window.__droneSummary = () => ({
  capacity: droneCapacity(state, viewedSystemId),
  jobs: activeJobsInSystem(state, viewedSystemId),
  summary: droneSummaryForSystem(state, viewedSystemId),
});
window.__forceResearch = (nodeId) => {
  ensureResearchState(state);
  if (!state.research.unlocked.includes(nodeId)) {
    state.research.unlocked.push(nodeId);
    applyTechEffect(state, nodeId);
  }
  return { ok: true, unlocked: state.research.unlocked };
};
window.__spawnBuilderShip = (systemId) => {
  const sysId = systemId ?? viewedSystemId ?? state.stronghold;
  state.playerShips.push({
    id: `ship-test-${state.playerShips.length + 1}`,
    hull: 'builder_ship',
    galaxyId: state.activeGalaxyId,
    systemId: sysId,
    hp: 200,
    maxHp: 200,
    transit: null,
  });
  return { ok: true };
};

// --- Phase 6 test hooks ---
window.__completeDysonShell = (systemId, shellNum) =>
  completeDysonShellForTest(state, systemId ?? viewedSystemId, shellNum);
window.__setCompletedDysons = (n) => setCompletedDysonsForTest(state, n);
window.__buildSuperweaponCradle = () => buildSuperweaponCradle(state);
window.__installSuperweaponPart = (partId) => installSuperweaponPart(state, partId);
window.__superweaponCreate = (anchorId, opts) => superweaponCreate(state, anchorId ?? state.stronghold, opts ?? { immediate: true });
window.__superweaponDestroy = (systemId, opts) => superweaponDestroy(state, systemId, opts ?? { immediate: true });
window.__superweaponJump = (starId, opts) => superweaponJump(state, starId ?? state.stronghold, opts ?? { immediate: true });
window.__superweaponCreateDeferred = (anchorId) => superweaponCreate(state, anchorId ?? state.stronghold, { immediate: false });
window.__superweaponDestroyDeferred = (systemId) => superweaponDestroy(state, systemId, { immediate: false });
window.__superweaponJumpDeferred = (starId) => superweaponJump(state, starId ?? state.stronghold, { immediate: false });
window.__fireSequenceStatus = () => fireSequenceStatus(state);
window.__flagshipWeapons = () => ensureFlagshipWeapons(state);
window.__flagshipWing = () => flagshipWingSummary(state);
window.__flagshipWingPoses = () => flagshipWingPoses(state);
window.__toggleFlagshipWingHangar = () => doToggleWingHangar();
window.__buildHeroFlagship = (rallyStarId) => buildHeroFlagship(state, rallyStarId);
window.__spawnHeroFlagship = (systemId) => spawnHeroFlagshipForTest(state, systemId ?? viewedSystemId);
window.__setRelation = (factionId, status) => setRelation(state, factionId, status);
window.__offerTreaty = (factionId, type) => offerTreaty(state, factionId, type);
window.__diplomacySummary = () => diplomacySummary(state);
window.__establishContact = (factionId, options = {}) => establishContact(state, factionId, options);
window.__previewDiplomaticProposal = (input, options = {}) => previewProposal(state, input, options);
window.__submitDiplomaticProposal = (input, options = {}) => submitProposal(state, input, options);
window.__respondToDiplomaticProposal = (proposalId, decision, options = {}) =>
  respondToProposal(state, proposalId, decision, options);
window.__declareWar = (factionIdOrInput, options = {}) => declareWar(state, factionIdOrInput, options);
window.__concludePeace = (factionIdOrWar, terms = {}) => concludePeace(state, factionIdOrWar, terms);
window.__createClaim = (factionIdOrInput, systemId = null, options = {}) =>
  createClaim(state, factionIdOrInput, systemId, options);
window.__castCouncilVote = (resolutionId, voterId, vote) =>
  castCouncilVote(state, resolutionId, voterId, vote);
window.__bulkProductionSummary = (orderId = null) => bulkProductionSummary(state, orderId);
window.__productionProducts = () => listProductionProducts(state);
window.__previewBulkProductionOrder = (input = {}) => previewBulkProductionOrder(state, input);
window.__createBulkProductionOrder = (input = {}) => createBulkProductionOrder(state, input);
window.__pauseBulkProductionOrder = (orderId) => pauseBulkProductionOrder(state, orderId);
window.__resumeBulkProductionOrder = (orderId) => resumeBulkProductionOrder(state, orderId);
window.__cancelBulkProductionOrder = (orderId) => cancelBulkProductionOrder(state, orderId);
window.__strategicOrdersSummary = () => strategicOrdersSummary(state);
window.__previewExpansionCampaign = (spec = {}) => previewExpansionCampaign(state, spec, {
  hooks: strategicIntegrationHooks(),
});
window.__createExpansionCampaign = (spec = {}) => createExpansionCampaign(state, spec, {
  hooks: strategicIntegrationHooks(),
});
window.__pauseExpansionCampaign = (campaignId, reason) =>
  pauseExpansionCampaign(state, campaignId, reason);
window.__resumeExpansionCampaign = (campaignId) => resumeExpansionCampaign(state, campaignId);
window.__cancelExpansionCampaign = (campaignId, mode = 'hold') =>
  cancelExpansionCampaign(state, campaignId, mode, { hooks: strategicIntegrationHooks() });
window.__startMission = (id) => startMission(state, id);
window.__advanceMissionObjective = (missionId, objectiveId) =>
  advanceMissionObjective(state, missionId, objectiveId);
window.__completeMission = (id) => completeMissionForTest(state, id);
window.__setTutorialStep = (n) => setTutorialStep(state, n);
window.__getTutorialState = () => getTutorialState(state);
window.__initTutorial = () => initTutorial(state);
window.__tutorialAccess = (featureId) => tutorialAccess(state, featureId);
window.__setTutorialOverride = (enabled) => setTutorialSessionOverride(enabled);
window.__getProfile = () => ({ ...currentProfile(), briefingsSeen: [...currentProfile().briefingsSeen] });
window.__markTutorialGraduated = (at) => markTutorialGraduated(at);
window.__clearTutorialProfile = () => clearTutorialProfile();
window.__beginTutorialGraduation = () => doBeginTutorialGraduation();
window.__completeTutorialGraduation = (opts) => doCompleteTutorialGraduation(opts);
window.__retryTutorialBattle = () => doRetryTutorialBattle();
window.__focusTutorial = () => doFocusTutorial();
window.__setVictoryType = (type, mode) => setVictoryType(state, type, mode);
window.__checkVictory = () => checkVictory(state);
window.__checkDefeat = () => checkDefeat(state);
window.__buildStrategicStructure = (type, planetId) =>
  buildStrategicStructure(state, viewedSystemId, type, planetId ?? selection);
window.__buildBodyStructure = (type, bodyId) =>
  buildBodyStructure(state, viewedSystemId, bodyId ?? selection, type);
window.__deployBuilderDrone = (systemId) => doDeployBuilderDrone(systemId ?? galaxyTargetStarId ?? viewedSystemId);
window.__listBuilderDrones = () => builderDroneSummary(state);
window.__canDeployBuilderDrone = (systemId) =>
  canDeployBuilderDrone(state, systemId ?? galaxyTargetStarId ?? viewedSystemId);
window.__getDroneConstructionCatalog = (systemId, draft = []) =>
  getDroneConstructionCatalog(state, systemId ?? viewedSystemId, draft);
window.__confirmBuilderConstructionPlan = (systemId, draft = []) =>
  confirmBuilderConstructionPlan(state, systemId ?? viewedSystemId, draft);
window.__cancelBuilderConstructionOrder = (orderId) => cancelBuilderConstructionOrder(state, orderId);
window.__cancelBuilderDrone = (droneId) => doCancelBuilderDrone(droneId);
window.__galaxyPerfSummary = () => galaxyPerfSummary();
window.__setBattleGroupHeroAnchor = (groupId, heroId) =>
  setBattleGroupHeroAnchor(state, groupId, heroId);
window.__setHeroRally = (heroId, starId) => setHeroRally(state, heroId, starId);
window.__destroyFlagship = () => {
  state.flagship.hp = 0;
  return { ok: true };
};
