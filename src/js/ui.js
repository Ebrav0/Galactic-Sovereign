// HUD, build panel, save menu, toasts. Manipulates DOM inside #hud only;
// calls exported APIs, never mutates state fields directly.

import { OUTPOST_COST } from './constants.js';
import { systemById, findPlanet, hasOutpost } from './state.js';
import { canBuildOutpost, incomePerSecond } from './economy.js';
import { transitStatus } from './flagship.js';
import { SLOTS, listSlots, exportSaveFile, importSaveFile } from './save.js';

const el = (id) => document.getElementById(id);

const HINTS = {
  system: 'WASD / arrows: fly flagship · F: follow camera · drag: pan · M: galaxy map',
  galaxy: 'Click star: travel · double-click: view system · M: system view',
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
    getState, getSelection, setSelection, getView, getViewedSystemId,
    doBuildOutpost, doTogglePause, doToggleView, doSaveSlot, doLoadSlot, doImportState,
  } = ctx;

  el('pause-btn').addEventListener('click', doTogglePause);
  el('view-toggle-btn').addEventListener('click', doToggleView);
  el('build-outpost-btn').addEventListener('click', () => {
    const sel = getSelection();
    if (sel) doBuildOutpost(sel);
  });

  // --- Save menu ---
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

  // --- Per-frame HUD sync ---
  return function updateUi() {
    const state = getState();
    const selection = getSelection();
    const view = getView();
    const viewedSystemId = getViewedSystemId();
    const viewedSystem = systemById(state, viewedSystemId);

    el('credits-value').textContent = Math.floor(state.credits).toLocaleString();
    el('income-value').textContent = incomePerSecond(state).toFixed(1);
    el('pause-btn').textContent = state.paused ? 'Resume' : 'Pause';
    el('pause-overlay').classList.toggle('hidden', !state.paused);
    el('view-toggle-btn').textContent = view === 'galaxy' ? 'System View (M)' : 'Galaxy Map (M)';
    el('view-hint').textContent = HINTS[view];

    el('system-name').textContent = view === 'galaxy' ? 'Galaxy Map' : (viewedSystem?.name ?? '—');
    el('stronghold-badge').classList.toggle(
      'hidden',
      view !== 'system' || state.stronghold !== viewedSystemId
    );

    // Flagship location line
    const transit = transitStatus(state);
    if (transit) {
      const dest = systemById(state, transit.destId);
      el('flagship-loc').textContent = `In transit → ${dest?.name ?? transit.destId} (${Math.ceil(transit.etaMs / 1000)}s)`;
    } else {
      el('flagship-loc').textContent = systemById(state, state.flagship.systemId)?.name ?? '—';
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
      `Outpost cost: ${OUTPOST_COST} credits`;

    const check = canBuildOutpost(state, viewedSystemId, planet.id);
    el('build-outpost-btn').disabled = !check.ok;
    el('build-panel-note').textContent = check.ok ? '' : check.reason;
  };
}
