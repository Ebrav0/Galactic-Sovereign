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
  FLAGSHIP_MAX_SPEED,
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
  applyConstructionJobsSummary,
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
import { setFlagshipInput, getFlagshipInput, flagshipControlStatus, flagshipEngineStatus, orderTravel, transitStatus, transitEtaMs, toggleFlagshipOrbit, isFlagshipOrbiting, orbitTargetLabel, resyncFlagshipDisplayPose, advanceCoopFlagshipVisual, ensurePlayerFlagships, getPlayerFlagship } from './flagship.js';
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
  cancelTacticalRetreat,
  resolveRetreatDestination,
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
  updateCombatCinemaCamera,
  setCombatCinemaEnabled,
  cancelCombatCinema,
  combatCinemaState,
  snapCameraTo,
  camera,
  galaxyCamera,
  hitTestCombatUnit,
  hitTestStar,
  pushMapPing,
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
  canArmSuperweaponAction,
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
  endAgreement,
  establishContact,
  offerTreaty,
  previewProposal,
  resolveCouncilResolution,
  respondToProposal,
  settleDiplomaticTradeDelivery,
  setRelation,
  actionableDiplomacySummary,
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
import { AUDIO_CATALOG, AUDIO_PRELOAD_CUES } from './audio-catalog.js';
import { createAudioEngine } from './audio-engine.js';
import { createAudioDirector } from './audio-director.js';
import { initAudioUi } from './audio-ui.js';
import { createCoopClient, coopQueryEnabled, defaultWsUrl } from './coop-client.js';
import { applyCombatSummary, applyFleetsSummary } from './coop-protocol.js';
import { applySharedStateDelta } from './coop-replication.js';
import { captureCombatDisplayPose } from './combat-steering.js';

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
let helioclastTargetingMode = null;
let followedConvoyId = null;
let combatSelectionIds = [];
let combatCommandMode = null;
let combatMarquee = null;
let coopStatus = { phase: 'idle', connected: false, authed: false };

const EMPTY_TICK_EVENTS = Object.freeze({
  captures: [],
  prodReady: [],
  scoutArrivals: [],
  shipArrivals: [],
  aiArrivals: [],
  pirateArrivals: [],
  pirateInterdictions: [],
  battleEvents: [],
  dysonEvents: [],
  wormholeArrivals: [],
  builderDroneEvents: [],
  droneCompletions: [],
  logisticsEvents: [],
  bulkProductionEvents: [],
  bulkDeliveryEvents: [],
  strategicOperationEvents: [],
  diplomacyEvents: [],
  campaignEvents: [],
  remainingMs: 0,
});

/** Min gap between full world applies (join/flush bypass). Keeps the UI thread free
 * while still letting post-command debounced snapshots land promptly. */
const COOP_SNAPSHOT_MIN_INTERVAL_MS = 1_500;

/**
 * Align camera/view with the shared flagship after a co-op world replace.
 * System ids collide across seeds (sys-N), so "does this id exist?" is not enough.
 * @param {{ force?: boolean }} [opts] force=true on join; later only when system changes / view invalid.
 */
function syncCoopViewToFlagship({ force = false } = {}) {
  const f = state.flagship;
  resyncFlagshipDisplayPose(state);

  if (f?.transit) {
    const transit = transitStatus(state);
    view = 'galaxy';
    follow.enabled = false;
    lastFlagshipSystemId = f.systemId ?? lastFlagshipSystemId;
    if (transit) {
      galaxyCamera.x = transit.x;
      galaxyCamera.y = transit.y;
      galaxyCamera.zoom = Math.max(galaxyCamera.zoom, 0.28);
    }
    return;
  }

  const focusId = f?.systemId || state.stronghold;
  const viewedMissing = !systemById(state, viewedSystemId);
  const arrivedViaSnapshot = !!(focusId && focusId !== lastFlagshipSystemId);
  // Do not chase the flagship on every snapshot while the player is freely panning.
  const shouldFocus = force || viewedMissing || arrivedViaSnapshot;

  if (shouldFocus && focusId) {
    viewedSystemId = focusId;
    view = 'system';
    follow.enabled = true;
    snapCameraTo(f?.systemId ? f.x : 0, f?.systemId ? f.y : 0);
    if (force || arrivedViaSnapshot) camera.zoom = CAMERA_DEFAULT_ZOOM;
  } else if (viewedMissing && state.stronghold) {
    viewedSystemId = state.stronghold;
  }

  lastFlagshipSystemId = f?.systemId ?? lastFlagshipSystemId;
}

/** Latest teammate roster from summaries ([{id, callsign, online}]). */
let coopPlayers = [];

/** Max acceptable client↔host divergence for co-op presentation (ms). */
const COOP_SYNC_LAG_MS = 250;
/** Position error budget ≈ how far a flagship can travel in that window. */
const COOP_SYNC_POS_ERR = FLAGSHIP_MAX_SPEED * (COOP_SYNC_LAG_MS / 1000);

/**
 * Host-anchored presentation clock.
 * state.time advances smoothly every frame and slews toward host — never rewinds
 * (rewinds hitch planet/moon/ambient-fleet orbits that are f(state.time)).
 */
const coopClock = {
  latestHostTime: 0,
  latestHostAt: 0,
  ready: false,
};

function syncCoopClockFromHost(hostTime) {
  if (!Number.isFinite(hostTime)) return;
  const now = performance.now();
  if (!coopClock.ready) {
    coopClock.latestHostTime = hostTime;
    coopClock.latestHostAt = now;
    coopClock.ready = true;
    state.time = hostTime;
    return;
  }
  // Reject only true host rewinds (monotonic sim time). Never compare against
  // wall-extrapolated estimates — that falsely rejects good poses and locks the
  // client into jump/hold stutter (skew multi-second in logs).
  if (hostTime + 1 < coopClock.latestHostTime) {
    return;
  }
  coopClock.latestHostTime = hostTime;
  coopClock.latestHostAt = now;
}

function advanceCoopClock(dtMs) {
  if (!coopClock.ready) return;
  const dt = Math.max(0, Number(dtMs) || 0);
  const estimatedHost = coopClock.latestHostTime + (performance.now() - coopClock.latestHostAt);
  if (!Number.isFinite(state.time)) {
    state.time = estimatedHost;
    return;
  }
  const err = estimatedHost - state.time;
  if (err > 500) {
    // Only hard-catch when catastrophically behind; soft-slew covers the 250ms budget.
    state.time = estimatedHost - 80;
  } else if (err < -30) {
    // Ahead of host — keep planets/fleets moving (never freeze), just slow the clock.
    state.time += dt * 0.35;
  } else {
    // Advance with frame dt and catch up remaining error over ~150ms.
    state.time += dt + err * Math.min(1, dt / 150);
  }
}

/**
 * Pull a pose toward authority without leaving the 250ms sync budget.
 * Large errors snap; mid errors correct strongly this packet; small errors blend.
 */
function reconcilePose2d(target, pose, {
  local = false,
  systemChanged = false,
  maxErr = COOP_SYNC_POS_ERR,
} = {}) {
  if (typeof pose.x !== 'number' || typeof pose.y !== 'number') {
    if (typeof pose.x === 'number') target.x = pose.x;
    if (typeof pose.y === 'number') target.y = pose.y;
    return { hardSnapped: false, err: 0, alpha: 0 };
  }
  const hasPose = Number.isFinite(target.x) && Number.isFinite(target.y);
  const dx = pose.x - (target.x ?? pose.x);
  const dy = pose.y - (target.y ?? pose.y);
  const err = Math.hypot(dx, dy);
  if (!hasPose || systemChanged || err > maxErr * 2.5) {
    target.x = pose.x;
    target.y = pose.y;
    return { hardSnapped: true, err, alpha: 1 };
  }
  // Outside the 250ms budget — yank most of the way back this packet.
  if (err > maxErr) {
    target.x += dx * 0.85;
    target.y += dy * 0.85;
    return { hardSnapped: false, err, alpha: 0.85 };
  }
  // Local pilot thrusting inside budget: trust prediction (host trails by RTT).
  if (local) {
    const inp = getFlagshipInput?.();
    if (inp && Math.hypot(inp.x || 0, inp.y || 0) > 1e-6) {
      return { hardSnapped: false, err, alpha: 0 };
    }
  }
  // Inside budget: light blend so we don't fight dead-reckoning every 100ms.
  const alpha = local ? 0.12 : 0.22;
  target.x += dx * alpha;
  target.y += dy * alpha;
  return { hardSnapped: false, err, alpha };
}

function reconcileHeading(target, heading, { local = false, systemChanged = false } = {}) {
  if (typeof heading !== 'number') return;
  if (!Number.isFinite(target.heading) || systemChanged) {
    target.heading = heading;
    return;
  }
  let dH = heading - target.heading;
  while (dH > Math.PI) dH -= 2 * Math.PI;
  while (dH < -Math.PI) dH += 2 * Math.PI;
  target.heading += dH * (local ? 0.3 : 0.4);
}

function applyPoseToFlagship(f, pose, { local = false, authTime = null } = {}) {
  const prevSys = f.systemId;
  const systemChanged = pose.systemId != null && pose.systemId !== f.systemId;
  if (pose.systemId !== undefined) f.systemId = pose.systemId;
  if (pose.galaxyId != null) f.galaxyId = pose.galaxyId;

  if ('orbit' in pose) {
    if (pose.orbit && typeof pose.orbit === 'object') {
      f.orbit = {
        kind: pose.orbit.kind,
        bodyId: pose.orbit.bodyId ?? null,
        radius: pose.orbit.radius,
        angle: pose.orbit.angle,
      };
      // Auth sample — extrapolate with state.time (same clock as planet centers).
      f._coopOrbitAngle = pose.orbit.angle;
      f._coopOrbitSimTime = Number.isFinite(authTime) ? authTime : state.time;
    } else {
      f.orbit = null;
      f._coopOrbitAngle = null;
      f._coopOrbitSimTime = null;
    }
  }

  const orbiting = !!f.orbit;
  let hardSnapped = false;
  // While orbiting, position is kinematic from angle+planet time — don't xy-rubber-band.
  if (!orbiting) {
    const rec = reconcilePose2d(f, pose, { local, systemChanged });
    hardSnapped = rec.hardSnapped;
    reconcileHeading(f, pose.heading, { local, systemChanged });
    if (typeof pose.vx === 'number') {
      const thrusting = local && (() => {
        const inp = getFlagshipInput?.();
        return inp && Math.hypot(inp.x || 0, inp.y || 0) > 1e-6;
      })();
      f.vx = thrusting && Number.isFinite(f.vx) ? f.vx : (local && Number.isFinite(f.vx) ? f.vx * 0.5 + pose.vx * 0.5 : pose.vx);
    }
    if (typeof pose.vy === 'number') {
      const thrusting = local && (() => {
        const inp = getFlagshipInput?.();
        return inp && Math.hypot(inp.x || 0, inp.y || 0) > 1e-6;
      })();
      f.vy = thrusting && Number.isFinite(f.vy) ? f.vy : (local && Number.isFinite(f.vy) ? f.vy * 0.5 + pose.vy * 0.5 : pose.vy);
    }
  }

  if (typeof pose.hp === 'number') f.hp = pose.hp;
  if (typeof pose.maxHp === 'number') f.maxHp = pose.maxHp;
  if ('transit' in pose) f.transit = pose.transit;
  if ('wormholeTransit' in pose) f.wormholeTransit = pose.wormholeTransit;
  if (pose.callsign != null) f.callsign = pose.callsign;
  return { prevSys, systemChanged, hardSnapped };
}

function advanceCoopCombatVisual(state, dtMs) {
  if (!state || state.paused) return;
  const dt = Math.max(0, Number(dtMs) || 0) / 1000;
  if (dt <= 0) return;
  for (const battle of Object.values(state.systemBattles ?? {})) {
    if (!battle?.active || battle.mode !== 'tactical' || !Array.isArray(battle.units)) continue;
    for (const unit of battle.units) {
      if (!unit || unit.hp <= 0 || unit.escaped) continue;
      // Piloted flagships are advanced by advanceCoopFlagshipVisual / pose sync.
      if (unit.hull === 'flagship') continue;
      const vx = Number(unit.vx) || 0;
      const vy = Number(unit.vy) || 0;
      if (vx === 0 && vy === 0) continue;
      unit.x = (unit.x ?? 0) + vx * dt;
      unit.y = (unit.y ?? 0) + vy * dt;
    }
  }
}

/**
 * Lightweight HUD / pose sync from periodic summaries — no 1MB deserialize.
 * Client extrapolates time/pose between summaries; this snaps to authority.
 * Applies every pilot's flagship pose plus ally hero capitals.
 */
function applyCoopSummary(summary) {
  if (!summary || !coop.isActive()) {
    updateCoopBanner();
    return;
  }
  if (typeof summary.time === 'number') {
    syncCoopClockFromHost(summary.time);
  }
  if (typeof summary.credits === 'number') state.credits = summary.credits;
  if (typeof summary.paused === 'boolean') {
    const wasPaused = !!state.paused;
    state.paused = summary.paused;
    // Don't let wall-clock pause duration inflate the extrapolated host time.
    if (wasPaused && !summary.paused && coopClock.ready) {
      coopClock.latestHostAt = performance.now();
      state.time = coopClock.latestHostTime;
    }
  }
  state.pausedBy = summary.paused ? (summary.pausedBy ?? state.pausedBy ?? null) : null;
  if (typeof summary.research === 'number') {
    if (state.research && typeof state.research === 'object') state.research.points = summary.research;
    else state.researchPoints = summary.research;
  }
  if (Array.isArray(summary.players)) {
    coopPlayers = summary.players;
    state._coopOnlineIds = new Set(
      summary.players.filter((p) => p?.online && p.id != null).map((p) => p.id),
    );
  }

  const localPilotId = coop.getPlayerId();
  ensurePlayerFlagships(state, localPilotId);

  const poses = summary.flagships && typeof summary.flagships === 'object'
    ? summary.flagships
    : (summary.flagship ? { [localPilotId ?? 'solo']: summary.flagship } : {});

  for (const [pilotId, pose] of Object.entries(poses)) {
    let f = getPlayerFlagship(state, pilotId);
    if (!f) {
      // Pilot joined after our last snapshot — materialize a minimal entry so
      // their ship renders now; the next snapshot replaces it wholesale.
      f = { pilotId, callsign: pose.callsign ?? pilotId, weapons: [], wing: null, orbit: null };
      state.playerFlagships.push(f);
    }
    const applied = applyPoseToFlagship(f, pose, {
      local: pilotId === localPilotId,
      authTime: typeof summary.time === 'number' ? summary.time : state.time,
    });
    if (f === state.flagship) {
      // Co-op sets accumulator=0, so display pose is `prev` — keep it glued to live coords.
      resyncFlagshipDisplayPose(state);
      if (pose.systemId && pose.systemId !== applied.prevSys) {
        syncCoopViewToFlagship({ force: false });
      }
    }
  }

  if (summary.heroes && typeof summary.heroes === 'object') {
    if (!Array.isArray(state.heroFlagships)) state.heroFlagships = [];
    for (const [heroId, h] of Object.entries(summary.heroes)) {
      let hero = state.heroFlagships.find((entry) => entry.id === heroId);
      if (!hero) {
        hero = { id: heroId, vx: 0, vy: 0 };
        state.heroFlagships.push(hero);
      }
      const systemChanged = h.systemId != null && h.systemId !== hero.systemId;
      hero.ownerPlayerId = h.ownerPlayerId ?? hero.ownerPlayerId ?? null;
      if (h.galaxyId != null) hero.galaxyId = h.galaxyId;
      if (h.systemId !== undefined) hero.systemId = h.systemId;
      reconcilePose2d(hero, h, { systemChanged, maxErr: COOP_SYNC_POS_ERR });
      reconcileHeading(hero, h.heading, { systemChanged });
      if (typeof h.hp === 'number') hero.hp = h.hp;
      if (typeof h.maxHp === 'number') hero.maxHp = h.maxHp;
      if ('transit' in h) hero.transit = h.transit;
      if (h.rallyStarId !== undefined) hero.rallyStarId = h.rallyStarId;
      if (h.buildCompleteAt !== undefined) hero.buildCompleteAt = h.buildCompleteAt;
    }
  }

  if (Array.isArray(summary.builds)) {
    applyConstructionJobsSummary(state, summary.builds);
  }

  if (Array.isArray(summary.combat)) {
    applyCombatSummary(state, summary.combat, { capturePose: captureCombatDisplayPose });
  }

  if (summary.fleets && typeof summary.fleets === 'object') {
    applyFleetsSummary(state, summary.fleets);
  }

  updateCoopBanner();
}

function adoptCoopSnapshot(snapshotJson, { forceFocus = false, summary = null } = {}) {
  if (!coop.isActive()) return;
  // Preserve client-local presentation (camera/view/selection live outside state).
  const presentation = {
    view,
    viewedSystemId,
    selection,
    selectedScoutId,
    selectedBattleGroupId,
    selectedBuilderDroneId,
    combatSelectionIds: [...combatSelectionIds],
    combatCommandMode,
    followEnabled: follow.enabled,
    followAllyPilotId: follow.allyPilotId,
    helioclastTargetingMode,
  };
  const prevSys = state.flagship?.systemId ?? null;
  const next = coop.parseSnapshot(snapshotJson);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
  // Bind state.flagship to *my* ship in the roster (camera/HUD/WASD follow it).
  ensurePlayerFlagships(state, coop.getPlayerId());
  // Re-apply the snapshot's companion summary so fleets/combat that arrived
  // via the fast channel aren't wiped by a slightly older world blob.
  if (summary) applyCoopSummary(summary);
  // Restore presentation that must never be host-owned.
  if (!forceFocus) {
    if (presentation.view) view = presentation.view;
    if (presentation.viewedSystemId && systemById(state, presentation.viewedSystemId)) {
      viewedSystemId = presentation.viewedSystemId;
    }
    selection = presentation.selection;
    selectedScoutId = presentation.selectedScoutId;
    selectedBattleGroupId = presentation.selectedBattleGroupId;
    selectedBuilderDroneId = presentation.selectedBuilderDroneId;
    combatSelectionIds = presentation.combatSelectionIds;
    combatCommandMode = presentation.combatCommandMode;
    follow.enabled = presentation.followEnabled;
    follow.allyPilotId = presentation.followAllyPilotId ?? null;
    helioclastTargetingMode = presentation.helioclastTargetingMode;
  }
  const nextSys = state.flagship?.systemId ?? null;
  // Camera/pose focus only on join or when the shared flagship changed systems.
  if (forceFocus || prevSys !== nextSys) {
    syncCoopViewToFlagship({ force: forceFocus });
  } else {
    resyncFlagshipDisplayPose(state);
  }
  lastCoopSnapshotAt = performance.now();
  lastUiAt = 0; // refresh HUD on the next frame after a world adopt
  updateCoopBanner();
}

let pendingCoopSnapshot = null;
/** @type {object | null} */
let pendingCoopSnapshotSummary = null;
/** @type {{ worldId?: string, tick?: number, revision?: number, reason?: string } | null} */
let pendingCoopSnapshotMeta = null;
/** @type {ReturnType<typeof setTimeout> | 0} */
let coopSnapshotTimer = 0;
let coopSnapshotRaf = 0;
let coopAwaitingFirstFocus = false;
let lastCoopSnapshotAt = -Infinity;
let coopJoinInFlight = false;

function clearCoopSnapshotSchedule() {
  if (coopSnapshotTimer) {
    clearTimeout(coopSnapshotTimer);
    coopSnapshotTimer = 0;
  }
  if (coopSnapshotRaf) {
    cancelAnimationFrame(coopSnapshotRaf);
    coopSnapshotRaf = 0;
  }
}

function resetClientCoopPresentation() {
  clearCoopSnapshotSchedule();
  pendingCoopSnapshot = null;
  pendingCoopSnapshotSummary = null;
  pendingCoopSnapshotMeta = null;
  coopAwaitingFirstFocus = false;
  coopClock.ready = false;
  coopClock.latestHostTime = 0;
  coopClock.latestHostAt = 0;
  coopPlayers = [];
  follow.allyPilotId = null;
  state.pausedBy = null;
  closeCoopRoster();
  hideControlRequestToast();
  updateCoopBanner();
}

function parkTitleSeedWorld() {
  resetClientCoopPresentation();
  audioDirector.reset();
  state = createNewGame(DEFAULT_SEED);
  state.pirates = spawnPirateFleets(state);
  seedAiFaction(state, state.homeGalaxyId);
  initBuilderDrones(state);
  state.paused = true;
  selection = null;
  selectedScoutId = null;
  selectedBattleGroupId = null;
  selectedBuilderDroneId = null;
  combatSelectionIds = [];
  combatCommandMode = null;
  helioclastTargetingMode = null;
  followedConvoyId = null;
  view = 'system';
  viewedSystemId = state.stronghold;
  lastFlagshipSystemId = state.flagship?.systemId ?? null;
  follow.enabled = true;
  setBootPhase(BOOT_PHASE.TITLE);
  document.getElementById('title-screen')?.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('gs-show-title', { detail: { panel: 'root' } }));
}

function stripCoopQueryParams() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ['coop', 'coopName', 'coopPass', 'coopPort']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', next);
    }
  } catch { /* ignore */ }
}

function runCoopSnapshotApply({ forceFocus = false } = {}) {
  if (!coop.isActive()) {
    pendingCoopSnapshot = null;
    pendingCoopSnapshotSummary = null;
    pendingCoopSnapshotMeta = null;
    return;
  }
  const json = pendingCoopSnapshot;
  const summary = pendingCoopSnapshotSummary;
  const meta = pendingCoopSnapshotMeta;
  pendingCoopSnapshot = null;
  pendingCoopSnapshotSummary = null;
  pendingCoopSnapshotMeta = null;
  if (!json) return;
  if (meta?.tick && meta.tick < coop.getLastAppliedTick()) return;
  const focus = forceFocus || coopAwaitingFirstFocus;
  coopAwaitingFirstFocus = false;
  adoptCoopSnapshot(json, { forceFocus: focus, summary });
}

function queueCoopSnapshot(snapshotJson, summary = null, meta = null) {
  // Keep only the newest world; drop intermediates so a backlog cannot freeze tabs.
  pendingCoopSnapshot = snapshotJson;
  if (summary) pendingCoopSnapshotSummary = summary;
  if (meta) pendingCoopSnapshotMeta = meta;
  if (coopAwaitingFirstFocus) {
    // Join path: flushPendingCoopSnapshot applies immediately after connect.
    return;
  }
  if (coopSnapshotTimer || coopSnapshotRaf) return;
  const elapsed = performance.now() - lastCoopSnapshotAt;
  const wait = Math.max(0, COOP_SNAPSHOT_MIN_INTERVAL_MS - elapsed);
  coopSnapshotTimer = setTimeout(() => {
    coopSnapshotTimer = 0;
    if (!pendingCoopSnapshot) return;
    // Apply on the next frame so the timer callback itself stays cheap.
    coopSnapshotRaf = requestAnimationFrame(() => {
      coopSnapshotRaf = 0;
      runCoopSnapshotApply({ forceFocus: false });
    });
  }, wait);
}

function flushPendingCoopSnapshot({ forceFocus = false } = {}) {
  clearCoopSnapshotSchedule();
  if (!coop.isActive() || !pendingCoopSnapshot) {
    if (!coop.isActive()) {
      pendingCoopSnapshot = null;
      pendingCoopSnapshotSummary = null;
      pendingCoopSnapshotMeta = null;
    }
    return false;
  }
  coopAwaitingFirstFocus = false;
  runCoopSnapshotApply({ forceFocus });
  return true;
}

function callsignForCoop(playerId) {
  if (!playerId) return 'ally';
  if (playerId === coop.getPlayerId()) return 'you';
  const hit = coopPlayers.find((p) => p.id === playerId);
  return hit?.callsign ?? playerId;
}

function updateCoopBanner() {
  const el = document.getElementById('coop-banner');
  if (!el) return;
  if (!coop.isActive()) {
    el.classList.add('hidden');
    closeCoopRoster();
    hideControlRequestToast();
    return;
  }
  const summary = coop.getSummary();
  el.classList.remove('hidden');
  const online = summary?.playersOnline
    ?? (summary?.players ?? []).filter((p) => p.online).length
    ?? 1;
  const pausedBy = state.paused ? (state.pausedBy ?? summary?.pausedBy) : null;
  const pauseNote = pausedBy ? ` · Paused by ${callsignForCoop(pausedBy)}` : '';
  el.textContent = `CO-OP · ${coop.getPlayerId() ?? 'pilot'} · ${online} online${pauseNote}`;
  if (!document.getElementById('coop-roster')?.classList.contains('hidden')) {
    renderCoopRoster();
  }
}

function setCoopRosterOpen(open) {
  const panel = document.getElementById('coop-roster');
  if (!panel) return;
  if (open) {
    panel.hidden = false;
    panel.classList.remove('hidden');
    renderCoopRoster();
  } else {
    panel.hidden = true;
    panel.classList.add('hidden');
  }
}

function closeCoopRoster() {
  setCoopRosterOpen(false);
}

function renderCoopRoster() {
  const list = document.getElementById('coop-roster-list');
  if (!list || !coop.isActive()) return;
  list.replaceChildren();
  const poses = coop.getSummary()?.flagships ?? {};
  for (const p of coopPlayers) {
    const li = document.createElement('li');
    if (!p.online) li.classList.add('is-offline');
    const pose = poses[p.id];
    const loc = pose?.systemId
      ? (systemById(state, pose.systemId)?.name ?? pose.systemId)
      : '—';
    const meta = document.createElement('span');
    meta.textContent = `${p.callsign ?? p.id}${p.id === coop.getPlayerId() ? ' (you)' : ''} · ${p.online ? loc : 'offline'}`;
    li.appendChild(meta);
    if (p.online && p.id !== coop.getPlayerId()) {
      const followBtn = document.createElement('button');
      followBtn.type = 'button';
      followBtn.className = 'btn btn--ghost btn--xs';
      followBtn.textContent = follow.allyPilotId === p.id ? 'Following' : 'Follow';
      followBtn.onclick = () => followAllyCamera(p.id);
      li.appendChild(followBtn);
    }
    list.appendChild(li);
  }
}

function followAllyCamera(pilotId) {
  const ally = (state.playerFlagships ?? []).find((p) => p.pilotId === pilotId);
  if (!ally) {
    toast('Ally flagship not found', 'error');
    return;
  }
  follow.enabled = true;
  follow.allyPilotId = pilotId;
  if (ally.systemId) {
    viewedSystemId = ally.systemId;
    view = 'system';
    snapCameraTo(ally.x ?? 0, ally.y ?? 0);
  }
  toast(`Camera following ${callsignForCoop(pilotId)}`, 'ok');
  renderCoopRoster();
}

function copyCoopInviteUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('coop', coop.getUrl?.() || defaultWsUrl());
  if (!url.searchParams.get('coopName')) url.searchParams.set('coopName', 'pilot');
  const text = url.toString();
  const done = () => toast('Invite URL copied', 'ok');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      window.prompt('Copy invite URL', text);
    });
  } else {
    window.prompt('Copy invite URL', text);
  }
}

function leaveCoopSession(opts = {}) {
  const returnToTitle = opts.returnToTitle !== false;
  if (coop.isActive()) {
    coop.disconnect();
  }
  resetClientCoopPresentation();
  if (returnToTitle) {
    parkTitleSeedWorld();
    if (opts.silent) return;
    toast('Left co-op — choose Single Player or Multiplayer', 'info');
  } else if (!opts.silent) {
    toast('Left co-op session', 'info');
  }
}

async function returnToTitleFromPlay(opts = {}) {
  const autosave = opts.autosave !== false;
  if (coop.isActive()) {
    leaveCoopSession({ returnToTitle: true });
    return { ok: true };
  }
  if (autosave && getBootPhase() === BOOT_PHASE.PLAYING) {
    try { await writeSlot('autosave', state); } catch { /* private mode */ }
  }
  parkTitleSeedWorld();
  toast('Returned to title', 'info');
  return { ok: true };
}

function hideControlRequestToast() {
  const el = document.getElementById('coop-request-toast');
  if (!el) return;
  el.hidden = true;
  el.classList.add('hidden');
  el.replaceChildren();
}

function showControlRequestToast(ev) {
  const el = document.getElementById('coop-request-toast');
  if (!el) return;
  el.hidden = false;
  el.classList.remove('hidden');
  el.replaceChildren();
  const title = document.createElement('div');
  title.textContent = `${ev.fromCallsign ?? ev.fromPlayerId} requests control of ${ev.label ?? ev.assetId}`;
  el.appendChild(title);
  const actions = document.createElement('div');
  actions.className = 'coop-request-toast__actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'btn btn--xs';
  accept.textContent = 'Accept';
  accept.dataset.testid = 'coop-request-accept';
  accept.onclick = () => {
    coopSend('respondControlRequest', { requestId: ev.requestId, accept: true }).then((res) => {
      toast(res.ok ? 'Control shared' : (res.reason || 'Failed'), res.ok ? 'ok' : 'error');
      hideControlRequestToast();
    });
  };
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'btn btn--ghost btn--xs';
  deny.textContent = 'Deny';
  deny.dataset.testid = 'coop-request-deny';
  deny.onclick = () => {
    coopSend('respondControlRequest', { requestId: ev.requestId, accept: false }).then((res) => {
      toast(res.ok ? 'Request denied' : (res.reason || 'Failed'), res.ok ? 'ok' : 'error');
      hideControlRequestToast();
    });
  };
  actions.appendChild(accept);
  actions.appendChild(deny);
  el.appendChild(actions);
}

function handleCoopMeshEvents(events) {
  const me = coop.getPlayerId();
  for (const ev of events ?? []) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.kind === 'controlRequest') {
      if (ev.ownerPlayerId === me) showControlRequestToast(ev);
      continue;
    }
    if (ev.kind === 'controlRequestResolved') {
      if (ev.fromPlayerId === me) {
        toast(
          ev.accept
            ? `Control granted for ${ev.label ?? ev.assetId}`
            : `Control request denied for ${ev.label ?? ev.assetId}`,
          ev.accept ? 'ok' : 'info',
        );
      }
      if (ev.ownerPlayerId === me) hideControlRequestToast();
      continue;
    }
    if (ev.kind === 'mapPing') {
      pushMapPing(ev);
      if (ev.fromPlayerId !== me) {
        const where = ev.systemId
          ? (systemById(state, ev.systemId)?.name ?? ev.systemId)
          : 'map';
        toast(`${ev.fromCallsign ?? 'Ally'} pinged ${where}`, 'info');
      }
    }
  }
}

function doMapPing(opts = {}) {
  if (!coop.isActive()) return { ok: false, reason: 'Not in co-op' };
  const galaxyId = state.activeGalaxyId ?? null;
  if (view === 'system') {
    const f = state.flagship;
    const x = Number.isFinite(opts.x) ? opts.x : (f?.systemId === viewedSystemId ? f.x : 0);
    const y = Number.isFinite(opts.y) ? opts.y : (f?.systemId === viewedSystemId ? f.y : 0);
    coopSend('mapPing', { galaxyId, systemId: viewedSystemId, x, y, label: opts.label });
    return { ok: true };
  }
  let systemId = opts.systemId ?? null;
  if (!systemId && Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
    systemId = hitTestStar(state, opts.x, opts.y);
  }
  if (!systemId) {
    const graph = getGraph(state);
    let best = null;
    let bestD = Infinity;
    for (const star of graph.stars ?? []) {
      const d = Math.hypot(star.x - galaxyCamera.x, star.y - galaxyCamera.y);
      if (d < bestD) {
        bestD = d;
        best = star.id;
      }
    }
    systemId = best;
  }
  if (!systemId) {
    toast('No star to ping', 'error');
    return { ok: false, reason: 'No star' };
  }
  coopSend('mapPing', { galaxyId, systemId, label: opts.label });
  return { ok: true };
}

function wireCoopRosterUi() {
  const banner = document.getElementById('coop-banner');
  banner?.addEventListener('click', () => {
    if (!coop.isActive()) return;
    const panel = document.getElementById('coop-roster');
    const open = panel?.classList.contains('hidden');
    setCoopRosterOpen(!!open);
  });
  banner?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      banner.click();
    }
  });
  document.getElementById('coop-roster-close')?.addEventListener('click', () => closeCoopRoster());
  document.getElementById('coop-copy-invite')?.addEventListener('click', () => copyCoopInviteUrl());
  document.getElementById('coop-leave-btn')?.addEventListener('click', () => leaveCoopSession());
}

wireCoopRosterUi();

function coopSend(command, payload = {}) {
  return coop.command(command, payload).catch((err) => {
    toast(err.message || 'Co-op command failed', 'error');
    return { ok: false, reason: err.message };
  });
}

let pendingCoopTickEvents = null;

function mergeCoopTickEvents(events) {
  for (const envelope of events ?? []) {
    const tickEvents = envelope?.tickEvents;
    if (!tickEvents || typeof tickEvents !== 'object') continue;
    if (!pendingCoopTickEvents) pendingCoopTickEvents = { ...EMPTY_TICK_EVENTS };
    for (const [key, value] of Object.entries(tickEvents)) {
      if (!Array.isArray(value) || !value.length) continue;
      pendingCoopTickEvents[key] = [...(pendingCoopTickEvents[key] ?? []), ...value];
    }
  }
}

function takeCoopTickEvents() {
  const events = pendingCoopTickEvents ?? EMPTY_TICK_EVENTS;
  pendingCoopTickEvents = null;
  return events;
}

function applyCoopDelta(operations) {
  if (!coop.isActive()) return;
  const applied = applySharedStateDelta(state, operations);
  if (!applied) return;
  ensurePlayerFlagships(state, coop.getPlayerId());
  lastUiAt = 0;
}

const coop = createCoopClient({
  onSnapshot: (snapshotJson, summary, meta) => queueCoopSnapshot(snapshotJson, summary, meta),
  onSummary: (summary) => applyCoopSummary(summary),
  onDelta: (operations) => applyCoopDelta(operations),
  onEvents: (events) => mergeCoopTickEvents(events),
  onNotice: (notice) => toast(notice, 'info'),
  onStatus: (info) => {
    coopStatus = info;
    updateCoopBanner();
  },
  onError: (message) => toast(message, 'error'),
});

const audioEngine = createAudioEngine(AUDIO_CATALOG);
const audioDirector = createAudioDirector(audioEngine);
initAudioUi(audioEngine, { preloadCues: AUDIO_PRELOAD_CUES });

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
  cancelCombatCinema();
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
  cancelCombatCinema();
  combatSelectionIds = [];
  pruneCombatSelection();
  return combatSelectionIds;
}

function doSetCombatSelection(ids = []) {
  cancelCombatCinema();
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
  cancelCombatCinema();
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
    cancelCombatCinema();
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
  helioclast_shipyard: { cost: SUPERWEAPON_CRADLE_COST, disallowOnTradeNexus: true },
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
  if (coop.isActive()) {
    coopSend('deleteBattleGroup', { groupId }).then((res) => {
      if (res.ok && selectedBattleGroupId === groupId) selectedBattleGroupId = null;
      else if (!res.ok && res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    const willPause = !state.paused;
    audioEngine.playCue(willPause ? 'ui.pause' : 'ui.resume');
    coopSend('togglePaused');
    return { ok: true, pending: true };
  }
  togglePaused(state);
  audioEngine.playCue(state.paused ? 'ui.pause' : 'ui.resume');
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
  if (coop.isActive()) {
    coopSend('promoteBattleToTactical', { systemId }).catch(() => {});
  } else {
    promoteBattleToTactical(state, systemId);
  }
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

// Throttled WASD relay to the co-op host (host integrates thrust authoritatively).
const coopThrust = { x: 0, y: 0, sentAt: 0 };
const COOP_THRUST_MIN_INTERVAL_MS = 50;

function sendCoopFlagshipInput(x, y) {
  const now = performance.now();
  const changed = x !== coopThrust.x || y !== coopThrust.y;
  if (!changed) return;
  const releasing = x === 0 && y === 0;
  if (!releasing && now - coopThrust.sentAt < COOP_THRUST_MIN_INTERVAL_MS) return;
  coopThrust.x = x;
  coopThrust.y = y;
  coopThrust.sentAt = now;
  // Fire-and-forget: pose corrections arrive via summaries; no toast spam.
  coop.command('setFlagshipInput', { x, y }).catch(() => {});
}

function doFlagshipInput(x, y) {
  if (view !== 'system') {
    setFlagshipInput(0, 0, state.time);
    if (coop.isActive()) sendCoopFlagshipInput(0, 0);
    return;
  }
  setFlagshipInput(x, y, state.time);
  if (coop.isActive()) sendCoopFlagshipInput(x, y);
  if (x !== 0 || y !== 0) {
    cancelCombatCinema();
    follow.enabled = true;
  }
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
  if (coop.isActive()) {
    coopSend('toggleOrbit', { bodyId: selection }).then((res) => {
      if (res.ok && res.orbiting) toast(`Stable orbit: ${res.target}`, 'ok');
      else if (res.ok) toast('Orbit disengaged', 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
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
  if (coop.isActive()) {
    coopSend('toggleWingHangar').then((res) => {
      if (!res.ok) {
        if (res.reason) toast(res.reason, 'error');
        return;
      }
      if (res.already) {
        toast(res.hangar === 'stowed' || res.hangar === 'recalling'
          ? 'Escorts already in hangar'
          : 'Escorts already deployed', 'ok');
        return;
      }
      toast(res.hangar === 'recalling' ? 'Escorts returning to hangar' : 'Escorts launching', 'ok');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    coopSend('orderTravel', { targetId }).then((res) => {
      if (res.ok) {
        const dest = systemById(state, targetId);
        toast(`Course set: ${dest?.name ?? targetId} — ETA ${Math.ceil((res.etaMs ?? 0) / 1000)}s`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
    // Flush travel audio on the same click (depart) instead of waiting a frame.
    audioDirector.syncFrame({
      state,
      view,
      viewedSystemId,
      phase: getBootPhase(),
      now: performance.now(),
      cameraX: camera.x,
    });
    const dest = systemById(state, targetId);
    toast(`Course set: ${dest.name} — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
  } else {
    toast(res.reason, 'error');
  }
  return res;
}

function setHelioclastTargetingMode(mode) {
  if (mode == null) {
    helioclastTargetingMode = null;
    toast('Helioclast targeting cancelled');
    return { ok: true, mode: null };
  }
  const check = canArmSuperweaponAction(state, mode);
  if (!check.ok) {
    toast(check.reason, 'error');
    return check;
  }
  helioclastTargetingMode = mode;
  galaxyTargetStarId = null;
  const label = mode === 'create' ? 'Forge Star' : mode === 'destroy' ? 'Annihilate' : 'Gate Jump';
  toast(`${label} armed — click a destination star`, 'ok');
  return { ok: true, mode };
}

function doHelioclastTarget(targetId, requestedMode = helioclastTargetingMode) {
  const mode = requestedMode ?? helioclastTargetingMode;
  if (!mode) return { ok: false, reason: 'No Helioclast command armed' };
  galaxyTargetStarId = targetId;
  const label = mode === 'create' ? 'Forge Star' : mode === 'destroy' ? 'Annihilate' : 'Gate Jump';
  if (coop.isActive()) {
    // Team-unique superweapon: fire through the host so the single Helioclast
    // sequence plays out identically on every screen.
    coopSend('superweaponAction', { mode, targetId }).then((res) => {
      if (res.ok) {
        helioclastTargetingMode = null;
        const targetName = systemById(state, targetId)?.name ?? targetId;
        toast(`${label} sequence started on ${targetName}`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
  const action = mode === 'create' ? superweaponCreate
    : mode === 'destroy' ? superweaponDestroy
      : superweaponJump;
  const res = action(state, targetId);
  if (!res.ok) {
    toast(res.reason, 'error');
    return res;
  }
  helioclastTargetingMode = null;
  const targetName = systemById(state, targetId)?.name ?? targetId;
  toast(`${label} sequence started on ${targetName}`, 'ok');
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
  if (coop.isActive()) {
    const scoutId = selectedScoutId;
    coopSend('orderScoutTravel', { scoutId, targetId }).then((res) => {
      if (res.ok) {
        const dest = systemById(state, targetId);
        toast(`Scout dispatched to ${dest?.name ?? targetId} — ETA ${Math.ceil((res.etaMs ?? 0) / 1000)}s`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
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
  if (coop.isActive()) {
    const groupId = selectedBattleGroupId;
    coopSend('orderBattleGroupTravel', { groupId, targetId }).then((res) => {
      const dest = systemById(state, targetId);
      const destName = dest?.name ?? targetId;
      if (res.ok) {
        const skipNote = res.skipped > 0 ? ` · ${res.skipped} skipped` : '';
        toast(`${res.fleetName ?? 'Fleet'}: ${res.dispatched ?? 0} dispatched to ${destName}${skipNote}`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
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
  if (coop.isActive()) {
    const droneId = selectedBuilderDroneId;
    coopSend('deployBuilderDrone', { systemId: targetId, droneId }).then((res) => {
      if (res.ok) {
        const dest = systemById(state, targetId);
        toast(`Builder drone dispatched to ${dest?.name ?? targetId} — ETA ${Math.ceil((res.etaMs ?? 0) / 1000)}s`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
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
  if (coop.isActive()) {
    const systemId = viewedSystemId;
    coopSend('buildOutpost', { systemId, planetId }).then((res) => {
      if (res.ok) toast(`Outpost established on ${findPlanet(state, systemId, planetId)?.name ?? planetId}`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    const systemId = viewedSystemId;
    coopSend('buildShipyard', { systemId, planetId }).then((res) => {
      if (res.ok) toast(`Shipyard established on ${findPlanet(state, systemId, planetId)?.name ?? planetId}`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    coopSend('queueScout', { shipyardId, systemId: viewedSystemId }).then((res) => {
      if (res.ok) toast(`Scout queued (${SCOUT_BUILD_MS / 1000}s)`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    coopSend('queueHull', { shipyardId, systemId: viewedSystemId, hull }).then((res) => {
      if (res.ok) toast(`${hull} queued`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
  const res = queueHull(state, shipyardId, viewedSystemId, hull);
  if (res.ok) toast(`${hull} queued`, 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doDispatchShip(shipId, starId) {
  if (coop.isActive()) {
    coopSend('orderShipTravel', { shipId, targetId: starId }).then((res) => {
      if (res.ok) {
        const dest = systemById(state, starId);
        toast(`Ship dispatched to ${dest?.name ?? starId}`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    coopSend('buildFoundry', { systemId: viewedSystemId, planetId: resolvedId }).then((res) => {
      if (res.ok) toast(`Sail Foundry ring established at ${planet?.name ?? 'planet'}`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    coopSend('buildLauncher', { systemId: viewedSystemId, bodyId }).then((res) => {
      if (res.ok) toast('Dyson launcher deployed', 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
  const res = buildLauncher(state, viewedSystemId, bodyId);
  if (res.ok) toast('Dyson launcher deployed', 'ok');
  else toast(res.reason, 'error');
  return res;
}

function doDeployBuilderDrone(systemId) {
  const access = tutorialGuard('operations');
  if (!access.ok) return access;
  if (coop.isActive()) {
    coopSend('deployBuilderDrone', { systemId }).then((res) => {
      if (res.ok) {
        const name = systemById(state, res.systemId ?? systemId)?.name ?? systemId;
        toast(`Builder drone deployed to ${name}`, 'ok');
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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
  if (coop.isActive()) {
    coopSend('cancelBuilderDrone', { droneId }).then((res) => {
      toast(res.ok ? 'Builder drone recalled' : (res.reason || 'Failed'), res.ok ? 'ok' : 'error');
    });
    return { ok: true, pending: true };
  }
  const res = cancelBuilderDrone(state, droneId);
  toast(res.ok ? 'Builder drone recalled' : res.reason, res.ok ? 'ok' : 'error');
  return res;
}

function doEnterWormhole(opts = {}) {
  const access = tutorialGuard('wormholes');
  if (!access.ok) return access;
  if (coop.isActive()) {
    coopSend('enterWormhole', {
      targetGalaxyId: opts.targetGalaxyId ?? null,
      forceAnchored: !!opts.forceAnchored,
    }).then((res) => {
      if (res.ok) {
        toast(`Wormhole transit — ETA ${Math.ceil((res.etaMs ?? 0) / 1000)}s`, 'ok');
        audioEngine.playCue('navigation.wormhole', { force: true });
      } else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
  const res = orderWormholeTravel(state, opts);
  if (res.ok) {
    toast(`Wormhole transit — ETA ${Math.ceil(res.etaMs / 1000)}s`, 'ok');
    audioEngine.playCue('navigation.wormhole', { force: true });
  }
  else toast(res.reason, 'error');
  return res;
}

function doBuildWormholeAnchor(targetGalaxyId) {
  const access = tutorialGuard('wormholes');
  if (!access.ok) return access;
  if (coop.isActive()) {
    coopSend('buildWormholeAnchor', { targetGalaxyId }).then((res) => {
      if (res.ok) toast(`Wormhole anchored to ${state.galaxies[targetGalaxyId]?.name ?? targetGalaxyId}`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
  const res = buildWormholeAnchor(state, targetGalaxyId);
  if (res.ok) toast(`Wormhole anchored to ${state.galaxies[targetGalaxyId]?.name ?? targetGalaxyId}`, 'ok');
  else toast(res.reason, 'error');
  return res;
}

async function doSaveSlot(slot) {
  if (coop.isActive()) {
    toast('Leave co-op before saving a local slot', 'error');
    return { ok: false, error: 'coop-active' };
  }
  const res = await writeSlot(slot, state);
  toast(res.ok ? `Saved to ${slot}` : `Save failed: ${res.error}`, res.ok ? 'ok' : 'error');
  return res;
}

async function doLoadSlot(slot) {
  if (coop.isActive()) {
    toast('Leave co-op before loading a local save', 'error');
    return { ok: false, error: 'coop-active' };
  }
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
  helioclastTargetingMode = null;
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
  audioDirector.reset();
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
  cancelCombatCinema();
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
  let retreatDestinationId = order?.destinationId ?? null;
  if (order?.type === 'emergency_retreat' && !retreatDestinationId) {
    const retreat = resolveRetreatDestination(state, systemId);
    if (!retreat.ok) {
      toast(retreat.reason, 'error');
      return retreat;
    }
    retreatDestinationId = retreat.destinationId;
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
    destinationId: retreatDestinationId ?? order?.destinationId ?? null,
    side: 'player',
    groupId: group?.id ?? null,
    subjectIds,
  };
  if (coop.isActive()) {
    // Host owns the battle sim; unit ids match our snapshot copy.
    coopSend('issueTacticalOrder', { systemId, order: canonical }).then((res) => {
      if (res.ok) toast(`Order: ${canonical.type.replaceAll('_', ' ')}`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
    });
    return { ok: true, pending: true };
  }
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

function doCancelTacticalRetreat() {
  if (coop.isActive()) {
    return coopSend('cancelTacticalRetreat', { systemId: viewedSystemId }).then((res) => {
      if (res.ok) toast('Withdrawal cancelled', 'ok');
      else if (res.reason) toast(res.reason, 'error');
      return res;
    });
  }
  const result = cancelTacticalRetreat(state, viewedSystemId);
  if (result.ok) toast('Withdrawal cancelled', 'ok');
  else toast(result.reason, 'error');
  return result;
}

function doSetCombatCinema(enabled) {
  return setCombatCinemaEnabled(enabled);
}

function doSetCombatDoctrine(doctrine) {
  if (coop.isActive()) {
    return coopSend('setCombatDoctrine', { doctrine, systemId: viewedSystemId }).then((res) => {
      if (res.ok) toast(`Doctrine: ${normalizeDoctrine(doctrine).replaceAll('_', ' ')}`, 'ok');
      else if (res.reason) toast(res.reason, 'error');
      return res;
    });
  }
  const result = setCombatDoctrine(state, doctrine, viewedSystemId);
  if (result.ok) toast(`Doctrine: ${normalizeDoctrine(doctrine).replaceAll('_', ' ')}`, 'ok');
  return result;
}

function doSetAdvancedTactics(enabled) {
  if (coop.isActive()) {
    return coopSend('setAdvancedTactics', { enabled, systemId: viewedSystemId }).then((res) => {
      if (!enabled) combatCommandMode = null;
      return res;
    });
  }
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

function doSetCombatPriority(priority) {
  if (coop.isActive()) {
    return coopSend('setCombatPriority', { priority, systemId: viewedSystemId });
  }
  return setCombatFleetPriority(state, priority, viewedSystemId);
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
    if (structureType === 'helioclast_shipyard' || structureType === 'superweapon_cradle') {
      return buildSuperweaponCradle(state, systemId);
    }
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
  createBattleGroup: () => {
    if (coop.isActive()) {
      coopSend('createBattleGroup').then((res) => {
        if (res.ok && res.groupId) selectedBattleGroupId = res.groupId;
      });
      return null; // fleet appears via the post-command snapshot
    }
    return createBattleGroup(state);
  },
  deleteBattleGroup: doDeleteBattleGroup,
  assignShipToGroup: (shipId, groupId) => {
    if (coop.isActive()) {
      coopSend('assignShipToGroup', { shipId, groupId }).then((res) => {
        if (!res.ok && res.reason) toast(res.reason, 'error');
      });
      return { ok: true, pending: true };
    }
    return assignShipToGroup(state, shipId, groupId);
  },
  coopActive: () => coop.isActive(),
  coopRun: (command, payload = {}) => coopSend(command, payload),
  getCoopPlayers: () => coopPlayers,
  getCoopPlayerId: () => coop.getPlayerId(),
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
  getHelioclastTargetingMode: () => helioclastTargetingMode,
  setHelioclastTargetingMode,
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
  setCombatPriority: doSetCombatPriority,
  setAdvancedTactics: doSetAdvancedTactics,
  getFlagshipControlStatus: () => flagshipControlStatus(state),
  getCombatSelection: () => [...combatSelectionIds],
  selectCombatUnit: doSelectCombatUnit,
  clearCombatSelection: doClearCombatSelection,
  combatFocus: doCombatFocus,
  getCombatCommandMode: () => combatCommandMode,
  setCombatCommandMode: doSetCombatCommandMode,
  cancelTacticalRetreat: doCancelTacticalRetreat,
  getCombatCinemaState: () => combatCinemaState(state),
  setCombatCinema: doSetCombatCinema,
  combatUiActive,
  followConvoy: doFollowConvoy,
  getBootPhase,
  setBootPhase,
  joinCoop: (opts) => joinCoopSession(opts),
  leaveCoop: (opts) => leaveCoopSession(opts),
  returnToTitle: (opts) => returnToTitleFromPlay(opts),
  parkTitleSeed: () => parkTitleSeedWorld(),
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
  onCameraIntent: cancelCombatCinema,
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
  onFollowRequest: () => {
    follow.enabled = true;
    follow.allyPilotId = null;
  },
  onToggleOrbit: doToggleOrbit,
  onGalaxyStarClick: (starId) => { galaxyTargetStarId = starId; },
  getHelioclastTargetingMode: () => helioclastTargetingMode,
  onHelioclastTarget: doHelioclastTarget,
  onHelioclastCancelTargeting: () => setHelioclastTargetingMode(null),
  onBuilderDroneDeployClick: doDeployBuilderDrone,
  onMapPing: (opts) => doMapPing(opts),
});

window.__devLastResult = null;
let devPanel = null;

function runDevAction(action, params = {}) {
  const payload = {
    ...params,
    systemId: params.systemId ?? viewedSystemId,
    planetId: params.planetId ?? selection,
  };
  if (coop.isActive()) {
    // Host is authority — local mutates would desync alpha/beta views.
    return coopSend('devAction', { action, ...payload }).then((res) => {
      window.__devLastResult = res;
      if (res?.ok) {
        checkFlagshipArrival();
        ensureSelectedScout();
      }
      return res;
    });
  }
  const result = devAction(state, action, payload);
  window.__devLastResult = result;
  if (result.ok) {
    checkFlagshipArrival();
    ensureSelectedScout();
  }
  return result;
}

/** Keep the backtick Dev Panel on shipped CT builds until we lock it down. */
function shouldEnableDevPanel() {
  if (import.meta.env.DEV) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('dev');
    if (q === '0' || q === 'false') return false;
    if (q === '1' || q === 'true') {
      try { localStorage.setItem('gs-dev-panel', '1'); } catch { /* ignore */ }
      return true;
    }
    const stored = localStorage.getItem('gs-dev-panel');
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch { /* ignore */ }
  // Default ON for home testing builds; set localStorage gs-dev-panel=0 to disable.
  return true;
}

if (shouldEnableDevPanel()) {
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
  window.gameSave.onExitSaveRequest(() => {
    if (!coop.isActive()) writeSlot('exit-save', state);
  });
} else {
  window.addEventListener('beforeunload', () => {
    if (!coop.isActive()) writeSlot('autosave', state);
  });
}

// --- Main loop ---

let lastFrame = performance.now();
let accumulator = 0;
let lastAutosave = performance.now();
let lastUiAt = 0;
// HUD refresh is expensive; keep sim/render at full rate, throttle DOM updates.
const SOLO_UI_INTERVAL_MS = 50;   // ~20 Hz HUD — keeps Solo smooth on the CT
const COOP_UI_INTERVAL_MS = 100;  // ~10 Hz — shared-world clients
const MAX_CATCHUP_TICKS = 3;      // avoid spiral-of-death when a frame hitch accumulates sim work
let frameCount = 0;
let fpsWindowStart = performance.now();
let lastFps = 0;

function scheduleNextFrame() {
  // Background co-op tabs still ate CPU at 60fps; throttle them so the focused tab stays usable.
  if (coop.isActive() && typeof document !== 'undefined' && document.hidden) {
    setTimeout(() => frame(performance.now()), 250);
    return;
  }
  requestAnimationFrame(frame);
}

function maybeUpdateUi(now) {
  const interval = coop.isActive() ? COOP_UI_INTERVAL_MS : SOLO_UI_INTERVAL_MS;
  if (now - lastUiAt < interval) return;
  lastUiAt = now;
  updateUi();
}

function noteFrameFps(now) {
  frameCount += 1;
  const elapsed = now - fpsWindowStart;
  if (elapsed >= 1000) {
    lastFps = Math.round((frameCount * 1000) / elapsed);
    frameCount = 0;
    fpsWindowStart = now;
  }
}

function frame(now) {
  noteFrameFps(now);
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  const phase = getBootPhase();

  if (phase === BOOT_PHASE.TITLE) {
    drawTitleBackground(ctx2d, canvas, now);
    maybeUpdateUi(now);
    audioDirector.syncFrame({ state, view, viewedSystemId, phase, now, cameraX: camera.x });
    scheduleNextFrame();
    return;
  }

  if (phase === BOOT_PHASE.WARP_INTRO) {
    drawWarpIntro(ctx2d, canvas, now);
    maybeUpdateUi(now);
    audioDirector.syncFrame({
      state,
      view,
      viewedSystemId,
      phase,
      intro: warpIntroState(now),
      now,
      cameraX: camera.x,
    });
    scheduleNextFrame();
    return;
  }

  if (!coop.isActive() && !state.paused) state.meta.playTimeMs += dt;
  const tickEvents = coop.isActive()
    ? takeCoopTickEvents()
    : step(state, accumulator + dt, { maxTicks: MAX_CATCHUP_TICKS });
  accumulator = coop.isActive() ? 0 : (tickEvents.remainingMs ?? 0);

  if (coop.isActive()) {
    handleCoopMeshEvents(tickEvents.coopMeshEvents);
  }

  // Co-op clients do not run step(); advance presentation clock + dead-reckon pose
  // so planets/flagship stay smooth between authority summaries.
  if (coop.isActive() && !state.paused) {
    advanceCoopClock(dt);
    advanceCoopFlagshipVisual(state, dt);
    advanceCoopCombatVisual(state, dt);
  }

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
  for (const ev of tickEvents.diplomacyEvents ?? []) {
    if (ev.type === 'proposal_accepted') toast('A diplomatic proposal was accepted', 'ok');
    if (ev.type === 'proposal_countered') toast('A counteroffer has arrived in Diplomacy', 'info');
    if (ev.type === 'proposal_rejected') toast('A diplomatic proposal was rejected', 'error');
    if (ev.type === 'call_to_arms_accepted') toast('An ally answered a defensive call', 'ok');
    if (ev.type === 'call_to_arms_refused') toast('A defensive call was refused', 'error');
    if (ev.type === 'council_resolution_resolved') toast(`Council resolution ${ev.passed ? 'passed' : 'failed'}`, ev.passed ? 'ok' : 'error');
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
  audioDirector.syncFrame({ state, view, viewedSystemId, phase, tickEvents, now, cameraX: camera.x });

  if (!coop.isActive() && !state.paused && now - lastAutosave >= AUTOSAVE_INTERVAL_MS) {
    lastAutosave = now;
    const snapshot = state;
    const schedule = typeof requestIdleCallback === 'function'
      ? (fn) => requestIdleCallback(() => fn(), { timeout: 2500 })
      : (fn) => setTimeout(fn, 0);
    schedule(() => { writeSlot('autosave', snapshot); });
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
      galaxyTargetStarId,
    );
  } else {
    if (state.campaign?.mode === 'tutorial') markTutorialSystemViewed(state);
    if (follow.enabled && follow.allyPilotId) {
      const ally = (state.playerFlagships ?? []).find((p) => p.pilotId === follow.allyPilotId);
      if (ally?.systemId && ally.systemId !== viewedSystemId && !ally.transit) {
        viewedSystemId = ally.systemId;
        snapCameraTo(ally.x ?? 0, ally.y ?? 0);
      }
    }
    updateCombatCinemaCamera(state, viewedSystemId, dt);
    updateFollowCamera(state, viewedSystemId, dt, accumulator);
    drawSystem(ctx2d, state, viewedSystemId, selection, accumulator, combatOverlayForRender());
  }
  maybeUpdateUi(now);
  if (devPanel?.isOpen()) devPanel.updateDevPanel();
  scheduleNextFrame();
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
  audioDirector.syncFrame({
    state,
    view,
    viewedSystemId,
    phase: getBootPhase(),
    tickEvents: events,
    now: performance.now(),
    cameraX: camera.x,
  });
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
    audio: audioEngine.snapshot(true),
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
      engine: flagshipEngineStatus(state),
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
          wingPassPhase: unit.isWing ? (unit.passPhase ?? null) : null,
          recentThreat: unit.lastAttackerId == null ? null : {
            attackerId: unit.lastAttackerId,
            damagedAt: unit.lastDamagedAt ?? null,
            ageMs: Math.max(0, state.time - (unit.lastDamagedAt ?? state.time)),
          },
          destinationAnchor: unit.moveAnchor ?? null,
          destroyerAa: unit.aaBattery ? {
            unlocked: true,
            targetId: unit.aaBattery.targetId ?? null,
            lastTargetId: unit.aaBattery.lastTargetId ?? null,
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
        cinematicCamera: combatCinemaState(state),
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
    diplomacy: actionableDiplomacySummary(state),
    bulkProduction: bulkProductionSummary(state),
    strategicOrders: strategicOrdersSummary(state),
    superweapon: {
      ...superweaponSummary(state),
      selectedTargetSystemId: galaxyTargetStarId,
      targetingMode: helioclastTargetingMode,
    },
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

window.__audioDebugSnapshot = () => audioEngine.snapshot();
window.__audioUnlock = () => audioEngine.unlock();
window.__playAudioCue = (cueId, opts = {}) => audioEngine.playCue(cueId, { ...opts, force: true });
window.__setAudioSettings = (patch = {}) => audioEngine.setSettings(patch);
window.__syncAudioForTest = (events = {}) => {
  audioDirector.syncFrame({
    state,
    view,
    viewedSystemId,
    phase: getBootPhase(),
    tickEvents: events,
    now: performance.now(),
    cameraX: camera.x,
  });
  return audioEngine.snapshot();
};

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
window.__setCombatCinema = (enabled) => doSetCombatCinema(enabled);
window.__getCombatCinemaState = () => combatCinemaState(state);
window.__cancelTacticalRetreat = () => doCancelTacticalRetreat();
window.__resolveRetreatDestination = (systemId = null) =>
  resolveRetreatDestination(state, systemId ?? viewedSystemId);
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
  helioclastTargetingMode = null;
  if (opts.victoryType) setVictoryType(state, opts.victoryType, opts.mode ?? 'sandbox');
  if (opts.mode === 'tutorial') initTutorial(state, { replay: opts.replay === true });
  document.getElementById('new-game-modal')?.classList.add('hidden');
  document.getElementById('new-game-modal-backdrop')?.classList.add('hidden');
  doImportState(state);
  return state;
};

async function joinCoopSession(opts = {}) {
  if (coopJoinInFlight) {
    return { ok: false, reason: 'Already joining' };
  }
  coopJoinInFlight = true;
  try {
    const params = new URLSearchParams(window.location.search);
    let password = opts.password ?? params.get('coopPass');
    if (password == null && opts.promptPassword) {
      password = window.prompt('Co-op password (leave blank if none)', '') ?? '';
    }
    password = password ?? '';

    let playerName = opts.playerName ?? params.get('coopName');
    if (!playerName && opts.promptPassword) {
      playerName = window.prompt('Pilot callsign', 'pilot') ?? 'pilot';
    }
    playerName = String(playerName || 'pilot').slice(0, 32) || 'pilot';

    toast(`Connecting to ${opts.url || defaultWsUrl()}…`, 'info');
    coopAwaitingFirstFocus = true;
    coopClock.ready = false;
    try {
      await coop.connect({
        url: opts.url,
        password,
        playerName,
      });
    } catch (err) {
      coopAwaitingFirstFocus = false;
      resetClientCoopPresentation();
      toast(err.message || 'Co-op connect failed', 'error');
      return { ok: false, reason: err.message };
    }

    try { localStorage.setItem('gs.coop.callsign', playerName); } catch { /* private mode */ }

    try {
      // Welcome snapshot is queued during connect — apply it now so we don't keep the
      // title-screen world's sys-N id / display pose (ids collide across seeds).
      if (!flushPendingCoopSnapshot({ forceFocus: true })) {
        syncCoopViewToFlagship({ force: true });
      }
    } catch (err) {
      coop.disconnect();
      resetClientCoopPresentation();
      parkTitleSeedWorld();
      const reason = err?.message || 'Failed to apply co-op world';
      toast(reason, 'error');
      return { ok: false, reason };
    }

    if (!coop.isActive()) {
      resetClientCoopPresentation();
      parkTitleSeedWorld();
      return { ok: false, reason: 'Co-op session ended during join' };
    }

    document.getElementById('title-screen')?.classList.add('hidden');
    setBootPhase(BOOT_PHASE.PLAYING);
    selection = null;
    updateCoopBanner();
    stripCoopQueryParams();
    toast(`Co-op online as ${coop.getPlayerId()} — your flagship, shared empire vs AI`, 'ok');
    // Each browser tab needs its own gesture unlock for audio.
    audioEngine.unlock?.().catch?.(() => {});
    return { ok: true };
  } finally {
    coopJoinInFlight = false;
  }
}

function doStartNewGame(opts = {}) {
  if (coop.isActive()) {
    leaveCoopSession({ returnToTitle: false, silent: true });
  }
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
window.__armHelioclastCommand = (mode) => setHelioclastTargetingMode(mode);
window.__targetHelioclastCommand = (systemId) => doHelioclastTarget(systemId);
window.__getHelioclastTargetingMode = () => helioclastTargetingMode;
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
window.__resolveCouncilResolution = (resolutionId, options = {}) =>
  resolveCouncilResolution(state, resolutionId, options);
window.__endDiplomaticAgreement = (agreementId, options = {}) =>
  endAgreement(state, agreementId, options);
window.__settleDiplomaticTradeDelivery = (input = {}) =>
  settleDiplomaticTradeDelivery(state, input);
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

window.__joinCoop = (opts) => joinCoopSession(opts ?? { promptPassword: true });
window.__coopStatus = () => ({ ...coopStatus, active: coop.isActive(), summary: coop.getSummary() });
window.__fps = () => lastFps;

if (coopQueryEnabled()) {
  // Auto-join when opened as http://localhost:5173/?coop=1 (or ?coop=2, ?coop=true, …)
  queueMicrotask(() => joinCoopSession({ promptPassword: false }));
}
