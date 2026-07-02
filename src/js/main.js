// Boot + loop wiring + test hooks. Wiring only — no balance or game logic here.

import { TICK_MS, AUTOSAVE_INTERVAL_MS, DEFAULT_SEED } from './constants.js';
import { createNewGame, systemById, findPlanet, hasOutpost } from './state.js';
import { step, advance, togglePaused } from './simulation.js';
import { buildOutpost, canBuildOutpost, incomePerSecond, resetStructureIds } from './economy.js';
import { setFlagshipInput, orderTravel, transitStatus, transitEtaMs } from './flagship.js';
import { activeShuttleCount } from './shuttles.js';
import {
  drawSystem,
  drawGalaxy,
  camera,
  follow,
  updateFollowCamera,
  snapCameraTo,
} from './render.js';
import { attachInput } from './input.js';
import { writeSlot, readSlot } from './save.js';
import { initUi, toast } from './ui.js';

let state = createNewGame(DEFAULT_SEED);
let selection = null;
let view = 'system'; // 'system' | 'galaxy' — UI state, never serialized
let viewedSystemId = state.stronghold;
let lastFlagshipSystemId = state.flagship.systemId;

const canvas = document.getElementById('game-canvas');
const ctx2d = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

snapCameraTo(state.flagship.x, state.flagship.y);

// --- Actions (single mutation entry points shared by UI, input, hooks) ---

function doTogglePause() {
  togglePaused(state);
}

function doToggleView() {
  view = view === 'system' ? 'galaxy' : 'system';
  setFlagshipInput(0, 0); // drop any held thrust when the pilot looks away
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
  if (x !== 0 || y !== 0) follow.enabled = true; // thrust re-engages follow
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

function doBuildOutpost(planetId) {
  const res = buildOutpost(state, viewedSystemId, planetId);
  if (res.ok) {
    toast(`Outpost established on ${findPlanet(state, viewedSystemId, planetId).name}`, 'ok');
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
  const f = state.flagship;
  snapCameraTo(f.systemId ? f.x : 0, f.systemId ? f.y : 0);
}

// Transit arrivals retarget the system view to the flagship's new system.
function checkFlagshipArrival() {
  const current = state.flagship.systemId;
  if (current && current !== lastFlagshipSystemId) {
    viewedSystemId = current;
    follow.enabled = true;
    if (view === 'system') snapCameraTo(state.flagship.x, state.flagship.y);
    toast(`Flagship arrived at ${systemById(state, current)?.name ?? current}`, 'ok');
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
  doBuildOutpost,
  doTogglePause,
  doToggleView,
  doSaveSlot,
  doLoadSlot,
  doImportState,
});

attachInput(canvas, {
  getState: () => state,
  getView: () => view,
  getViewedSystemId: () => viewedSystemId,
  onSelect: (id) => { selection = id; },
  onTogglePause: doTogglePause,
  onToggleView: doToggleView,
  onFlagshipInput: doFlagshipInput,
  onStarTravel: doOrderTravel,
  onStarView: doViewSystem,
  onFollowRequest: () => { follow.enabled = true; },
});

// Electron exit-save (browser fallback: best-effort autosave on unload)
if (window.gameSave?.onExitSaveRequest) {
  window.gameSave.onExitSaveRequest(() => writeSlot('exit-save', state));
} else {
  window.addEventListener('beforeunload', () => {
    writeSlot('autosave', state);
  });
}

// --- Main loop: fixed 20 Hz simulation, rAF rendering ---

let lastFrame = performance.now();
let accumulator = 0;
let lastAutosave = performance.now();

function frame(now) {
  const dt = Math.min(now - lastFrame, 250); // clamp long tab-switch gaps
  lastFrame = now;

  if (!state.paused) state.meta.playTimeMs += dt;
  accumulator = step(state, accumulator + dt);
  checkFlagshipArrival();

  if (!state.paused && now - lastAutosave >= AUTOSAVE_INTERVAL_MS) {
    lastAutosave = now;
    writeSlot('autosave', state);
  }

  if (view === 'galaxy') {
    drawGalaxy(ctx2d, state);
  } else {
    updateFollowCamera(state, viewedSystemId, dt);
    drawSystem(ctx2d, state, viewedSystemId, selection);
  }
  updateUi();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Test hooks (IMPLEMENTATION_PLAN §7) ---

window.advanceTime = (ms) => {
  advance(state, ms); // respects pause; exact floor(ms / TICK_MS) ticks
  checkFlagshipArrival();
};

window.render_game_to_text = () => {
  const f = state.flagship;
  const transit = transitStatus(state);
  const viewedSystem = systemById(state, viewedSystemId);
  return JSON.stringify({
    time: state.time,
    paused: state.paused,
    credits: state.credits,
    view,
    currentSystem: viewedSystemId,
    systemName: viewedSystem?.name ?? null,
    strongholdSystem: state.stronghold,
    selection,
    incomePerSec: incomePerSecond(state),
    // World coords: origin at the local star (system view) or the black hole
    // (galaxy view); +x right, +y down.
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
      canBuildOutpost: canBuildOutpost(state, viewedSystemId, b.id).ok,
    })),
    structures: (viewedSystem?.structures ?? []).map((s) => ({
      id: s.id,
      type: s.type,
      bodyId: s.bodyId,
    })),
    shuttles: {
      active: activeShuttleCount(state, viewedSystemId) > 0,
      count: activeShuttleCount(state, viewedSystemId),
    },
    tickMs: TICK_MS,
  });
};

window.getGameState = () => state;

// Extra dev/test conveniences (not part of the save path)
window.__selectPlanet = (id) => { selection = id; };
window.__buildOutpost = (id) => doBuildOutpost(id);
window.__saveSlot = (slot) => doSaveSlot(slot);
window.__loadSlot = (slot) => doLoadSlot(slot);
window.__setFlagshipInput = (x, y) => setFlagshipInput(x, y);
window.__orderTravel = (starId) => doOrderTravel(starId);
window.__setView = (v) => doSetView(v);
window.__viewSystem = (systemId) => doViewSystem(systemId);
