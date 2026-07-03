// Boot + loop wiring + test hooks. Wiring only — no balance or game logic here.

import { TICK_MS, AUTOSAVE_INTERVAL_MS, DEFAULT_SEED, SCOUT_BUILD_MS, CAMERA_DEFAULT_ZOOM, HULL_STATS, PIRATE_FLEET_COUNT, PIRATE_WANDER_MS } from './constants.js';
import {
  createNewGame,
  systemById,
  findPlanet,
  hasOutpost,
  hasShipyard,
  findShipyardOnPlanet,
  isPlayerOwned,
} from './state.js';
import { step, advance, togglePaused } from './simulation.js';
import { buildOutpost, canBuildOutpost, incomePerSecond, resetStructureIds } from './economy.js';
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
import { setFlagshipInput, orderTravel, transitStatus, transitEtaMs } from './flagship.js';
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
import { battleSummaryForSystem, getBattleState, setBattleStance, checkBattleTrigger } from './combat.js';
import { activeShuttleCount } from './shuttles.js';
import {
  drawSystem,
  drawGalaxy,
  follow,
  updateFollowCamera,
  snapCameraTo,
  camera,
} from './render.js';
import { attachInput } from './input.js';
import { writeSlot, readSlot } from './save.js';
import { initUi, toast } from './ui.js';
import { initStarRenderer, resizeStarRenderer } from './gl/star-renderer.js';

let state = createNewGame(DEFAULT_SEED);
state.pirates = spawnPirateFleets(state);
let selection = null;
let view = 'system';
let viewedSystemId = state.stronghold;
let lastFlagshipSystemId = state.flagship.systemId;
let selectedScoutId = null;

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
  resetPirateIds(state);
  if (!newState.pirates?.fleets?.length) {
    newState.pirates = spawnPirateFleets(newState);
  }
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

const updateUi = initUi({
  getState: () => state,
  getSelection: () => selection,
  setSelection: (id) => { selection = id; },
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  getSelectedScoutId: () => selectedScoutId,
  doSelectScout,
  doBuildOutpost,
  doBuildShipyard,
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
});

attachInput(canvas, {
  getState: () => state,
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  getSelectedScoutId: () => selectedScoutId,
  onSelect: (id) => { selection = id; },
  onTogglePause: doTogglePause,
  onToggleView: doToggleView,
  onFlagshipInput: doFlagshipInput,
  onStarTravel: doOrderTravel,
  onScoutTravel: doOrderScoutTravel,
  onStarView: doViewSystem,
  onScoutSelect: doSelectScout,
  onFollowRequest: () => { follow.enabled = true; },
});

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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Test hooks ---

window.advanceTime = (ms) => {
  const events = advance(state, ms);
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
  const viewedSystem = systemById(state, viewedSystemId);
  const scoutSummaries = state.scouts.map((scout) => {
    const st = scout.transit ? scoutStatus(scout, state.galaxy, state.time) : null;
    return {
      id: scout.id,
      systemId: scout.systemId,
      inTransit: !!scout.transit,
      destination: st?.destId ?? null,
      etaMs: scout.transit ? scoutEtaMs(state, scout) : null,
    };
  });

  const neighborFog = state.galaxy.stars
    .filter((star) => star.id !== state.stronghold)
    .slice(0, 3)
    .map((star) => ({ id: star.id, hasIntel: hasIntel(state, star.id) }));

  return JSON.stringify({
    time: state.time,
    paused: state.paused,
    credits: state.credits,
    view,
    currentSystem: viewedSystemId,
    systemName: viewedSystem?.name ?? null,
    strongholdSystem: state.stronghold,
    systemOwner: viewedSystem?.owner ?? null,
    selection,
    selectedScoutId,
    incomePerSec: incomePerSecond(state),
    flagship: {
      systemId: f.systemId,
      x: Math.round(f.x * 100) / 100,
      y: Math.round(f.y * 100) / 100,
      vx: Math.round(f.vx * 100) / 100,
      vy: Math.round(f.vy * 100) / 100,
      heading: Math.round(f.heading * 1000) / 1000,
      inTransit: !!f.transit,
      destination: transit?.destId ?? null,
      transitProgress: transit ? Math.round(transit.progress * 1000) / 1000 : null,
      etaMs: f.transit ? transitEtaMs(state) : null,
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
      shipyardCount: Object.values(state.systems).reduce(
        (n, sys) => n + sys.structures.filter((s) => s.type === 'shipyard').length,
        0,
      ),
      buildingScout: Object.values(state.systems).some(
        (sys) => sys.structures.some((s) => s.type === 'shipyard' && s.build?.hull === 'scout'),
      ),
      scoutCount: state.scouts.length,
      combatQueues: activeCombatQueues(state),
    },
    playerShips: (state.playerShips ?? []).map((ship) => ({
      id: ship.id,
      hull: ship.hull,
      systemId: ship.systemId,
      inTransit: !!ship.transit,
      hp: ship.hp,
      maxHp: ship.maxHp,
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
      starCount: state.galaxy.stars.length,
      laneCount: state.galaxy.lanes.length,
      blackHole: state.galaxy.blackHole.id,
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
    tickMs: TICK_MS,
  });
};

window.getGameState = () => state;

window.__selectPlanet = (id) => { selection = id; };
window.__buildOutpost = (id) => doBuildOutpost(id);
window.__buildShipyard = (id) => doBuildShipyard(id);
window.__queueScout = (shipyardId) => doQueueScout(shipyardId);
window.__queueHull = (shipyardId, hull) => doQueueHull(shipyardId, hull);
window.__dispatchShip = (shipId, starId) => doDispatchShip(shipId, starId);
window.__setBattleStance = (stance) => setBattleStance(state, stance);
window.__forcePirateIntoSystem = (systemId) => {
  forcePirateIntoSystem(state, systemId);
  checkBattleTrigger(state, systemId);
};
window.__getBattleState = (systemId) => getBattleState(state, systemId);
window.__getHullStats = () => ({ ...HULL_STATS });
window.__newGame = (seed = DEFAULT_SEED) => {
  state = createNewGame(seed);
  state.pirates = spawnPirateFleets(state);
  doImportState(state);
  return state;
};
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
