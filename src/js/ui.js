// HUD, build panel, save menu, toasts. Manipulates DOM inside #hud only.

import {
  OUTPOST_COST,
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  CAPTURE_HOLD_MS,
} from './constants.js';
import {
  systemById,
  findPlanet,
  hasOutpost,
  hasShipyard,
  findShipyardOnPlanet,
  isPlayerOwned,
} from './state.js';
import { canBuildOutpost, incomePerSecond } from './economy.js';
import { canBuildShipyard, canQueueScout } from './production.js';
import { transitStatus } from './flagship.js';
import { scoutEtaMs, findScout } from './scout.js';
import { SLOTS, listSlots, exportSaveFile, importSaveFile } from './save.js';

const el = (id) => document.getElementById(id);

const HINTS = {
  system: 'WASD / arrows: fly flagship · F: follow · drag: pan · M: galaxy map',
  galaxy: 'Click star: travel · Shift+click: send scout · double-click: view system · M: system view',
};

export function toast(message, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  el('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function initUi(ctx) {
  const {
    getState,
    getSelection,
    setSelection,
    getView,
    getViewedSystemId,
    getSelectedScoutId,
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
  } = ctx;

  el('pause-btn').addEventListener('click', doTogglePause);
  el('view-toggle-btn').addEventListener('click', doToggleView);
  el('build-outpost-btn').addEventListener('click', () => {
    const sel = getSelection();
    if (sel) doBuildOutpost(sel);
  });
  el('build-shipyard-btn').addEventListener('click', () => {
    const sel = getSelection();
    if (sel) doBuildShipyard(sel);
  });
  el('queue-scout-btn').addEventListener('click', () => {
    const state = getState();
    const sel = getSelection();
    const shipyard = findShipyardOnPlanet(state, getViewedSystemId(), sel);
    if (shipyard) doQueueScout(shipyard.id);
  });

  const saveMenu = el('save-menu');

  async function refreshSaveMenu() {
    const res = await listSlots();
    const existing = new Map((res.saves ?? []).map((s) => [s.slot, s]));
    const container = el('save-slots');
    container.innerHTML = '';
    for (const slot of SLOTS) {
      const info = existing.get(slot);
      const row = document.createElement('div');
      row.className = 'save-slot-row';

      const label = document.createElement('div');
      label.innerHTML = `<span class="slot-name">${slot}</span><br><span class="slot-meta">${
        info ? new Date(info.savedAt).toLocaleString() : 'empty'
      }</span>`;
      row.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'slot-actions';

      if (slot !== 'exit-save') {
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          await doSaveSlot(slot);
          refreshSaveMenu();
        });
        actions.appendChild(saveBtn);
      }

      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Load';
      loadBtn.disabled = !info;
      loadBtn.addEventListener('click', async () => {
        await doLoadSlot(slot);
        saveMenu.classList.add('hidden');
      });
      actions.appendChild(loadBtn);

      row.appendChild(actions);
      container.appendChild(row);
    }
  }

  el('save-menu-btn').addEventListener('click', () => {
    saveMenu.classList.toggle('hidden');
    if (!saveMenu.classList.contains('hidden')) refreshSaveMenu();
  });
  el('close-save-menu-btn').addEventListener('click', () => saveMenu.classList.add('hidden'));

  el('export-save-btn').addEventListener('click', () => exportSaveFile(getState()));
  el('import-save-btn').addEventListener('click', () => el('import-file-input').click());
  el('import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const res = await importSaveFile(file);
    if (res.ok) {
      doImportState(res.state);
      saveMenu.classList.add('hidden');
      toast('Save imported', 'ok');
    } else {
      toast(res.error, 'error');
    }
  });

  return function updateUi() {
    const state = getState();
    const selection = getSelection();
    const view = getView();
    const viewedSystemId = getViewedSystemId();
    const viewedSystem = systemById(state, viewedSystemId);
    const selectedScoutId = getSelectedScoutId();

    el('credits-value').textContent = Math.floor(state.credits).toLocaleString();
    el('income-value').textContent = incomePerSecond(state).toFixed(1);
    el('pause-btn').textContent = state.paused ? 'Resume' : 'Pause';
    el('pause-overlay').classList.toggle('hidden', !state.paused);
    el('view-toggle-btn').textContent = view === 'galaxy' ? 'System View (M)' : 'Galaxy Map (M)';
    el('view-hint').textContent = HINTS[view];

    el('system-name').textContent = view === 'galaxy' ? 'Galaxy Map' : (viewedSystem?.name ?? '—');
    el('stronghold-badge').classList.toggle(
      'hidden',
      view !== 'system' || state.stronghold !== viewedSystemId,
    );

    const transit = transitStatus(state);
    if (transit) {
      const dest = systemById(state, transit.destId);
      el('flagship-loc').textContent =
        `In transit → ${dest?.name ?? transit.destId} (${Math.ceil(transit.etaMs / 1000)}s)`;
    } else {
      el('flagship-loc').textContent = systemById(state, state.flagship.systemId)?.name ?? '—';
    }

    const readyScouts = state.scouts.filter((s) => !s.transit).length;
    const transitScouts = state.scouts.filter((s) => s.transit).length;
    el('scout-summary').textContent =
      state.scouts.length === 0
        ? 'none'
        : `${readyScouts} ready${transitScouts ? `, ${transitScouts} in transit` : ''}`;

    const scoutPanel = el('scout-panel');
    if (state.scouts.length > 0) {
      scoutPanel.classList.remove('hidden');
      const roster = el('scout-roster');
      roster.innerHTML = '';
      for (const scout of state.scouts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'scout-select-btn' + (scout.id === selectedScoutId ? ' selected' : '');
        if (scout.transit) {
          const st = scout.transit;
          const dest = systemById(state, st.path[st.path.length - 1]);
          btn.textContent =
            `${scout.id} → ${dest?.name ?? '?'} (${Math.ceil(scoutEtaMs(state, scout) / 1000)}s)`;
        } else {
          const loc = systemById(state, scout.systemId)?.name ?? scout.systemId;
          btn.textContent = `${scout.id} @ ${loc}`;
        }
        btn.addEventListener('click', () => doSelectScout(scout.id));
        roster.appendChild(btn);
      }
      const sel = selectedScoutId ? findScout(state, selectedScoutId) : null;
      if (sel?.transit) {
        const dest = systemById(state, sel.transit.path[sel.transit.path.length - 1]);
        el('selected-scout-line').textContent =
          `Selected: ${sel.id} in transit to ${dest?.name ?? '?'} (${Math.ceil(scoutEtaMs(state, sel) / 1000)}s)`;
      } else if (sel) {
        el('selected-scout-line').textContent =
          `Selected: ${sel.id} at ${systemById(state, sel.systemId)?.name ?? sel.systemId}`;
      } else {
        el('selected-scout-line').textContent = 'Select a scout to dispatch (Shift+click star on galaxy map)';
      }
    } else {
      scoutPanel.classList.add('hidden');
    }

    const intelPanel = el('intel-panel');
    if (view === 'system' && hasIntel(state, viewedSystemId)) {
      intelPanel.classList.remove('hidden');
      const sys = viewedSystem;
      let intelHtml = `<strong>${sys.name}</strong> — ${sys.owner}<br>`;
      intelHtml += 'Planets:<br>';
      for (const p of sys.bodies) {
        intelHtml += `· ${p.name} (${p.type}, ${p.moons.length} moons)<br>`;
      }
      if (sys.structures.length > 0) {
        intelHtml += 'Structures:<br>';
        for (const s of sys.structures) {
          intelHtml += `· ${s.type} on ${s.bodyId}<br>`;
        }
      } else {
        intelHtml += 'Structures: none<br>';
      }
      const req = captureRequirement(state, viewedSystemId);
      intelHtml += `<br>Capture Requirement: <strong>${req}</strong>`;
      el('intel-panel-body').innerHTML = intelHtml;

      const force = captureForceInSystem(state, viewedSystemId);
      const progress = captureProgressMs(state, viewedSystemId);
      let capHtml = `Capture force: ${force} / ${req}`;
      if (canHoldCapture(state, viewedSystemId) && progress > 0) {
        capHtml += `<br>Holding… ${Math.ceil((CAPTURE_HOLD_MS - progress) / 1000)}s / ${CAPTURE_HOLD_MS / 1000}s`;
      } else if (enemyCombatPresence(state, viewedSystemId) > 0) {
        capHtml += '<br><span class="contested">Contested!</span>';
      } else if (!isPlayerOwned(state, viewedSystemId) && force >= req) {
        capHtml += '<br>Hold starting…';
      }
      el('capture-panel-body').innerHTML = capHtml;
    } else if (view === 'system' && viewedSystem) {
      intelPanel.classList.remove('hidden');
      el('intel-panel-body').innerHTML = 'No intel — send a scout or visit with your flagship.';
      el('capture-panel-body').innerHTML = '';
    } else {
      intelPanel.classList.add('hidden');
    }

    const panel = el('build-panel');
    if (view !== 'system' || !selection) {
      panel.classList.add('hidden');
      return;
    }
    const planet = findPlanet(state, viewedSystemId, selection);
    if (!planet) {
      setSelection(null);
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    el('build-panel-title').textContent = `${planet.name} — ${planet.type}`;
    el('build-panel-body').innerHTML =
      `Moons: ${planet.moons.length}<br>` +
      `Outpost: ${hasOutpost(state, viewedSystemId, planet.id) ? 'built' : 'none'}<br>` +
      `Shipyard: ${hasShipyard(state, viewedSystemId, planet.id) ? 'built' : 'none'}`;

    const outpostCheck = canBuildOutpost(state, viewedSystemId, planet.id);
    const shipyardCheck = canBuildShipyard(state, viewedSystemId, planet.id);
    const shipyard = findShipyardOnPlanet(state, viewedSystemId, planet.id);
    const scoutCheck = shipyard ? canQueueScout(state, shipyard.id, viewedSystemId) : { ok: false };

    el('build-outpost-btn').classList.toggle('hidden', hasOutpost(state, viewedSystemId, planet.id));
    el('build-outpost-btn').disabled = !outpostCheck.ok;
    el('build-outpost-btn').textContent = `Build Outpost (${OUTPOST_COST} cr)`;

    el('build-shipyard-btn').classList.toggle(
      'hidden',
      !hasOutpost(state, viewedSystemId, planet.id) || hasShipyard(state, viewedSystemId, planet.id),
    );
    el('build-shipyard-btn').disabled = !shipyardCheck.ok;
    el('build-shipyard-btn').textContent = `Build Shipyard (${SHIPYARD_COST} cr)`;

    const showScoutBtn = shipyard && !shipyard.build;
    el('queue-scout-btn').classList.toggle('hidden', !showScoutBtn);
    el('queue-scout-btn').disabled = !scoutCheck.ok;
    el('queue-scout-btn').textContent = `Build Scout (${SCOUT_HULL_COST} cr)`;

    const progressEl = el('build-progress');
    if (shipyard?.build) {
      const prog = shipyardBuildProgress(shipyard, state.time);
      progressEl.classList.remove('hidden');
      progressEl.textContent = `Scout ${Math.round(prog * 100)}%`;
    } else {
      progressEl.classList.add('hidden');
    }

    let note = '';
    if (!outpostCheck.ok && !hasOutpost(state, viewedSystemId, planet.id)) note = outpostCheck.reason;
    else if (!shipyardCheck.ok && hasOutpost(state, viewedSystemId, planet.id) && !hasShipyard(state, viewedSystemId, planet.id)) {
      note = shipyardCheck.reason;
    } else if (shipyard && !scoutCheck.ok && !shipyard.build) note = scoutCheck.reason;
    el('build-panel-note').textContent = note;
  };
}
