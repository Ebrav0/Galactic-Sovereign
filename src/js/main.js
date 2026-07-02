// Boot + loop wiring + test hooks. Wiring only — no balance or game logic here.

import { TICK_MS, AUTOSAVE_INTERVAL_MS, DEFAULT_SEED, SCOUT_BUILD_MS } from './constants.js';
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
  canBuildShipyard,
  canQueueScout,
  shipyardBuildProgress,
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
import { activeShuttleCount } from './shuttles.js';
import {
  drawSystem,
  drawGalaxy,
  follow,
  updateFollowCamera,
  snapCameraTo,
} from './render.js';
import { attachInput } from './input.js';
import { writeSlot, readSlot } from './save.js';
import { initUi, toast } from './ui.js';

let state = createNewGame(DEFAULT_SEED);
let selection = null;
let view = 'system';
let viewedSystemId = state.stronghold;
let lastFlagshipSystemId = state.flagship.systemId;
let selectedScoutId = null;

const canvas = document.getElementById('game-canvas');
const ctx2d = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

snapCameraTo(state.flagship.x, state.flagship.y);

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
  follow.enabled = true;
  const f = state.flagship;
  snapCameraTo(f.systemId === systemId ? f.x : 0, f.systemId === systemId ? f.y : 0);
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

  for (const ready of tickEvents.scoutReady ?? []) {
    const name = systemById(state, ready.systemId)?.name ?? ready.systemId;
    toast(`Scout ready at ${name}`, 'ok');
    selectedScoutId = ready.scoutId;
  }
  for (const arrival of tickEvents.scoutArrivals ?? []) {
    const name = systemById(state, arrival.systemId)?.name ?? arrival.systemId;
    toast(`Intel gathered: ${name}`, 'ok');
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
    updateFollowCamera(state, viewedSystemId, dt);
    drawSystem(ctx2d, state, viewedSystemId, selection);
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
  for (const ready of events.scoutReady) {
    selectedScoutId = ready.scoutId;
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
        (sys) => sys.structures.some((s) => s.type === 'shipyard' && s.build),
      ),
      scoutCount: state.scouts.length,
    },
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
window.__setEnemyPresence = (systemId, count) => {
  state._testEnemyPresence = state._testEnemyPresence ?? {};
  state._testEnemyPresence[systemId] = count;
};
window.__clearEnemyPresence = (systemId) => {
  if (state._testEnemyPresence) delete state._testEnemyPresence[systemId];
};
