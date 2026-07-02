// HUD, build panel, save menu, toasts. Manipulates DOM inside #hud only.

import {
  OUTPOST_COST,
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  CAPTURE_HOLD_MS,
  HULL_STATS,
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
import { canBuildShipyard, canQueueScout, canQueueHull } from './production.js';
import { transitStatus } from './flagship.js';
import { scoutEtaMs, findScout } from './scout.js';
import { findShip } from './ships.js';
import { shipEtaMs } from './fleet.js';
import { hullVisual, hullCssClass, formatHullName } from './combatVisuals.js';
import { hexToRgba } from './theme.js';
import { AUTO_RESOLVE_MS } from './constants.js';
import { SLOTS, listSlots, exportSaveFile, importSaveFile } from './save.js';

const el = (id) => document.getElementById(id);

const HINTS = {
  system: 'WASD / arrows: fly flagship · F: follow · drag: pan · M: galaxy map',
  galaxy: 'Click star: travel · Shift+click: scout · Alt+click: ship · double-click: view · M: system view',
  fleet: 'Select a ship · Alt+click star on galaxy map to dispatch',
};

const PLANET_DOT = {
  habitable: 'planet-dot--habitable',
  barren: 'planet-dot--barren',
  gas: 'planet-dot--gas',
};

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setProgressBar(containerId, fillId, pctId, progress, visible) {
  const block = el(containerId);
  const fill = el(fillId);
  const pct = el(pctId);
  block.classList.toggle('hidden', !visible);
  if (!visible) return;
  const pctVal = Math.round(progress * 100);
  fill.style.width = `${pctVal}%`;
  pct.textContent = `${pctVal}%`;
}

function renderIntelBody(container, sys, captureReq, garrisonText, garrisonComp = []) {
  clearChildren(container);

  const header = document.createElement('div');
  header.className = 'intel-header';
  const name = document.createElement('span');
  name.className = 'intel-header__name';
  name.textContent = sys.name;
  const ownerBadge = document.createElement('span');
  ownerBadge.className = 'badge badge--owner';
  ownerBadge.textContent = sys.owner;
  header.appendChild(name);
  header.appendChild(ownerBadge);
  container.appendChild(header);

  const planetsTitle = document.createElement('div');
  planetsTitle.className = 'intel-section-title';
  planetsTitle.textContent = 'Planets';
  container.appendChild(planetsTitle);

  for (const p of sys.bodies) {
    const row = document.createElement('div');
    row.className = 'planet-row';

    const dot = document.createElement('span');
    dot.className = `planet-dot ${PLANET_DOT[p.type] ?? 'planet-dot--barren'}`;

    const info = document.createElement('div');
    info.className = 'planet-row__info';
    const pName = document.createElement('div');
    pName.className = 'planet-row__name';
    pName.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'planet-row__meta';
    meta.textContent = `${p.type} · ${p.moons.length} moon${p.moons.length === 1 ? '' : 's'}`;
    info.appendChild(pName);
    info.appendChild(meta);

    row.appendChild(dot);
    row.appendChild(info);
    container.appendChild(row);
  }

  if (sys.structures.length > 0) {
    const structTitle = document.createElement('div');
    structTitle.className = 'intel-section-title';
    structTitle.style.marginTop = '12px';
    structTitle.textContent = 'Structures';
    container.appendChild(structTitle);

    for (const s of sys.structures) {
      const row = document.createElement('div');
      row.className = 'planet-row';
      const tag = document.createElement('span');
      tag.className = `tag tag--${s.type === 'shipyard' ? 'shipyard' : 'outpost'}`;
      tag.textContent = s.type;
      const label = document.createElement('span');
      label.className = 'planet-row__meta';
      label.textContent = `on ${s.bodyId}`;
      row.appendChild(tag);
      row.appendChild(label);
      container.appendChild(row);
    }
  }

  const capTitle = document.createElement('div');
  capTitle.className = 'intel-section-title';
  capTitle.style.marginTop = '12px';
  capTitle.textContent = 'Capture Requirement';
  container.appendChild(capTitle);

  const reqVal = document.createElement('div');
  reqVal.className = 'capture-block__force';
  reqVal.innerHTML = `<strong>${captureReq}</strong> force required`;
  container.appendChild(reqVal);

  if (garrisonText) {
    const garTitle = document.createElement('div');
    garTitle.className = 'intel-section-title';
    garTitle.style.marginTop = '8px';
    garTitle.textContent = 'Defenders';
    container.appendChild(garTitle);

    const garRow = document.createElement('div');
    garRow.className = 'garrison-row';
    const garVal = document.createElement('span');
    garVal.className = 'garrison-row__summary';
    garVal.textContent = garrisonText;
    garRow.appendChild(garVal);
    for (const entry of garrisonComp) {
      const chip = document.createElement('span');
      const vis = hullVisual(entry.hull);
      chip.className = `hull-badge ${hullCssClass(entry.hull)}`;
      chip.textContent = `${formatHullName(entry.hull)} ×${entry.count}`;
      chip.style.borderColor = vis.color;
      chip.style.color = vis.color;
      garRow.appendChild(chip);
    }
    container.appendChild(garRow);
  }
}

function renderMiniHpBar(container, hp, maxHp, accent) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-hp';
  const fill = document.createElement('div');
  fill.className = 'mini-hp__fill';
  fill.style.width = `${Math.round((hp / maxHp) * 100)}%`;
  fill.style.background = accent;
  wrap.appendChild(fill);
  container.appendChild(wrap);
}

function renderCombatBody(container, combat, flagship) {
  clearChildren(container);

  if (!combat.active && combat.phase !== 'resolved') {
    const idle = document.createElement('div');
    idle.className = 'combat-idle';
    idle.innerHTML = '<span class="combat-idle__icon">◇</span><span>All quiet — no battle in this system</span>';
    container.appendChild(idle);
    return;
  }

  const modeClass = combat.mode === 'tactical' ? 'combat-mode--tactical' : 'combat-mode--auto';
  const header = document.createElement('div');
  header.className = `combat-mode ${modeClass}`;
  header.innerHTML = `
    <span class="combat-mode__label">${combat.mode === 'tactical' ? 'Tactical' : 'Auto-Resolve'}</span>
    <span class="combat-mode__phase">${combat.phase === 'resolved' ? 'Resolved' : 'Active'}</span>
  `;
  container.appendChild(header);

  const counts = document.createElement('div');
  counts.className = 'combat-counts';
  counts.innerHTML = `
    <div class="combat-count combat-count--friendly">
      <span class="combat-count__num">${combat.friendlyCount ?? 0}</span>
      <span class="combat-count__lbl">Friendly</span>
    </div>
    <div class="combat-count__vs">vs</div>
    <div class="combat-count combat-count--enemy">
      <span class="combat-count__num">${combat.enemyCount ?? 0}</span>
      <span class="combat-count__lbl">Hostile</span>
    </div>
  `;
  container.appendChild(counts);

  if (flagship?.maxHp) {
    const fh = document.createElement('div');
    fh.className = 'combat-flagship-hp';
    fh.innerHTML = `<span class="combat-flagship-hp__label">Flagship</span><span class="combat-flagship-hp__val">${flagship.hp}/${flagship.maxHp}</span>`;
    renderMiniHpBar(fh, flagship.hp, flagship.maxHp, 'var(--accent-gold)');
    container.appendChild(fh);
  }

  if (combat.mode === 'auto' && combat.resolveEtaMs != null && combat.phase === 'active') {
    const prog = document.createElement('div');
    prog.className = 'combat-auto-progress';
    const pct = 1 - combat.resolveEtaMs / AUTO_RESOLVE_MS;
    prog.innerHTML = `<div class="combat-auto-progress__label">Resolving… ${Math.ceil(combat.resolveEtaMs / 1000)}s</div>`;
    const bar = document.createElement('div');
    bar.className = 'progress';
    const fill = document.createElement('div');
    fill.className = 'progress__fill progress__fill--gold';
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
    bar.appendChild(fill);
    prog.appendChild(bar);
    if (combat.predictedOutcome) {
      const pred = document.createElement('div');
      pred.className = 'combat-auto-progress__pred';
      pred.textContent = `Predicted: ${combat.predictedOutcome}`;
      prog.appendChild(pred);
    }
    container.appendChild(prog);
  }

  if (combat.healerActive) {
    const heal = document.createElement('div');
    heal.className = 'combat-healer-pill';
    heal.textContent = `Healers active · +${combat.repairPerTick ?? 0} HP/tick`;
    container.appendChild(heal);
  }

  if (combat.resolveInputs?.factors?.length) {
    const factors = document.createElement('div');
    factors.className = 'combat-factors';
    for (const f of combat.resolveInputs.factors) {
      const chip = document.createElement('span');
      chip.className = 'combat-factor-chip';
      chip.textContent = f;
      factors.appendChild(chip);
    }
    container.appendChild(factors);
  }

  if (combat.phase === 'resolved') {
    const win = document.createElement('div');
    win.className = `combat-result combat-result--${combat.winner === 'player' ? 'win' : 'loss'}`;
    win.textContent = combat.winner === 'player' ? 'Victory' : 'Defeat';
    container.appendChild(win);
  }
}

function renderCaptureBody(container, state, systemId, req, ctx) {
  clearChildren(container);

  const {
    captureForceInSystem,
    captureProgressMs,
    canHoldCapture,
    enemyCombatPresence,
  } = ctx;

  const force = captureForceInSystem(state, systemId);
  const progress = captureProgressMs(state, systemId);
  const contested = enemyCombatPresence(state, systemId) > 0;

  const block = document.createElement('div');
  block.className = 'capture-block';

  const header = document.createElement('div');
  header.className = 'capture-block__header';
  header.innerHTML = `
    <span class="capture-block__title">Capture Force</span>
    <span class="capture-block__force"><strong>${force}</strong> / ${req}</span>
  `;
  block.appendChild(header);

  const forceBar = document.createElement('div');
  forceBar.className = 'progress progress--capture';
  const forceFill = document.createElement('div');
  forceFill.className = 'progress__fill';
  forceFill.style.width = `${Math.round(Math.min(1, force / Math.max(req, 1)) * 100)}%`;
  forceBar.appendChild(forceFill);
  block.appendChild(forceBar);

  if (canHoldCapture(state, systemId) && progress > 0) {
    const holdLabel = document.createElement('div');
    holdLabel.className = 'capture-hold-label';
    holdLabel.textContent = `Securing system… ${Math.ceil((CAPTURE_HOLD_MS - progress) / 1000)}s`;
    block.appendChild(holdLabel);

    const holdBar = document.createElement('div');
    holdBar.className = 'progress progress--hold';
    const holdFill = document.createElement('div');
    holdFill.className = 'progress__fill progress__fill--green';
    holdFill.style.width = `${Math.round((progress / CAPTURE_HOLD_MS) * 100)}%`;
    holdBar.appendChild(holdFill);
    block.appendChild(holdBar);
  }

  const status = document.createElement('div');
  status.className = 'capture-status';

  if (contested) {
    status.innerHTML = '<span class="badge badge--contested">Contested — clear hostiles</span>';
  } else if (canHoldCapture(state, systemId) && progress > 0) {
    status.innerHTML = '<span class="badge badge--gold">Hold in progress</span>';
  } else if (force >= req) {
    status.innerHTML = '<span class="badge badge--owner">Ready to hold</span>';
  } else {
    status.textContent = `Need ${req - force} more capture force`;
    status.className = 'capture-status capture-status--muted';
  }

  block.appendChild(status);
  container.appendChild(block);
}

function renderBuildBody(container, planet, state, systemId) {
  clearChildren(container);

  const header = document.createElement('div');
  header.className = 'build-header';
  const dot = document.createElement('span');
  dot.className = `build-header__dot ${PLANET_DOT[planet.type] ?? 'planet-dot--barren'}`;
  dot.style.background = `var(--planet-${planet.type}, var(--planet-barren))`;
  dot.style.color = `var(--planet-${planet.type}, var(--planet-barren))`;
  const title = document.createElement('span');
  title.className = 'planet-row__name';
  title.textContent = `${planet.type} world`;
  header.appendChild(dot);
  header.appendChild(title);
  container.appendChild(header);

  const rows = [
    { label: 'Moons', value: String(planet.moons.length) },
    {
      label: 'Outpost',
      built: hasOutpost(state, systemId, planet.id),
    },
    {
      label: 'Shipyard',
      built: hasShipyard(state, systemId, planet.id),
    },
  ];

  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'status-row';
    const label = document.createElement('span');
    label.className = 'status-row__label';
    label.textContent = row.label;
    const val = document.createElement('span');
    if ('built' in row) {
      val.className = `status-indicator ${row.built ? 'status-indicator--built' : 'status-indicator--none'}`;
      val.textContent = row.built ? 'Built' : '—';
    } else {
      val.className = 'status-indicator status-indicator--built';
      val.textContent = row.value;
    }
    r.appendChild(label);
    r.appendChild(val);
    container.appendChild(r);
  }
}

function updateTabBar(view, activeTab) {
  el('tab-galaxy').classList.toggle('tab--active', view === 'galaxy');
  el('tab-system').classList.toggle('tab--active', view === 'system');
  el('tab-fleet').classList.toggle('tab--active', activeTab === 'fleet');
}

export function toast(message, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  el('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

export function initUi(ctx) {
  const {
    getState,
    getSelection,
    setSelection,
    getView,
    getViewedSystemId,
    getSelectedScoutId,
    getSelectedShipId,
    getActiveTab,
    setActiveTab,
    doSelectScout,
    doSelectShip,
    doBuildOutpost,
    doBuildShipyard,
    doQueueScout,
    doQueueHull,
    canQueueHull,
    hullLabel,
    BUILDABLE_HULLS,
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
    garrisonIntelText,
    garrisonSummary,
    combatObservability,
    fleetSummary,
  } = ctx;

  el('pause-btn').addEventListener('click', doTogglePause);
  el('view-toggle-btn').addEventListener('click', doToggleView);
  el('tab-galaxy').addEventListener('click', () => {
    if (getView() !== 'galaxy') doToggleView();
  });
  el('tab-system').addEventListener('click', () => {
    setActiveTab('system');
    if (getView() !== 'system') doToggleView();
  });
  el('tab-fleet').addEventListener('click', () => {
    setActiveTab('fleet');
  });

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
  const saveBackdrop = el('save-menu-backdrop');

  function openSaveMenu() {
    saveMenu.classList.remove('hidden');
    saveBackdrop.classList.remove('hidden');
    refreshSaveMenu();
  }

  function closeSaveMenu() {
    saveMenu.classList.add('hidden');
    saveBackdrop.classList.add('hidden');
  }

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
      label.innerHTML = `<div class="slot-name">${slot}</div><div class="slot-meta">${
        info ? new Date(info.savedAt).toLocaleString() : 'Empty slot'
      }</div>`;
      row.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'slot-actions';

      if (slot !== 'exit-save') {
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'btn btn--ghost btn--sm';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          await doSaveSlot(slot);
          refreshSaveMenu();
        });
        actions.appendChild(saveBtn);
      }

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn--primary btn--sm';
      loadBtn.textContent = 'Load';
      loadBtn.disabled = !info;
      loadBtn.addEventListener('click', async () => {
        await doLoadSlot(slot);
        closeSaveMenu();
      });
      actions.appendChild(loadBtn);

      row.appendChild(actions);
      container.appendChild(row);
    }
  }

  el('save-menu-btn').addEventListener('click', () => {
    if (saveMenu.classList.contains('hidden')) openSaveMenu();
    else closeSaveMenu();
  });
  el('close-save-menu-btn').addEventListener('click', closeSaveMenu);
  saveBackdrop.addEventListener('click', closeSaveMenu);

  el('notification-toggle').addEventListener('click', () => {
    el('notification-log').classList.toggle('collapsed');
    el('notification-toggle').textContent =
      el('notification-log').classList.contains('collapsed') ? '+' : '−';
  });

  el('export-save-btn').addEventListener('click', () => exportSaveFile(getState()));
  el('import-save-btn').addEventListener('click', () => el('import-file-input').click());
  el('import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const res = await importSaveFile(file);
    if (res.ok) {
      doImportState(res.state);
      closeSaveMenu();
      toast('Save imported', 'ok');
    } else {
      toast(res.error, 'error');
    }
  });

  const captureCtx = {
    captureForceInSystem,
    captureProgressMs,
    canHoldCapture,
    enemyCombatPresence,
  };

  return function updateUi() {
    const state = getState();
    const selection = getSelection();
    const view = getView();
    const activeTab = getActiveTab();
    const viewedSystemId = getViewedSystemId();
    const viewedSystem = systemById(state, viewedSystemId);
    const selectedScoutId = getSelectedScoutId();
    const selectedShipId = getSelectedShipId();

    el('credits-value').textContent = Math.floor(state.credits).toLocaleString();
    el('income-value').textContent = incomePerSecond(state).toFixed(1);
    el('pause-btn').querySelector('.btn-label').textContent = state.paused ? 'Resume' : 'Pause';
    el('pause-overlay').classList.toggle('hidden', !state.paused);
    el('view-toggle-btn').querySelector('.btn-label').textContent =
      view === 'galaxy' ? 'System View (M)' : 'Galaxy Map (M)';
    el('view-hint').textContent = HINTS[activeTab === 'fleet' ? 'fleet' : view] ?? HINTS.system;
    updateTabBar(view, activeTab);

    const fleet = fleetSummary(state);
    el('fleet-summary').textContent =
      fleet.totalShips === 0 ? '—' : `${fleet.totalShips}${fleet.inTransit ? `+${fleet.inTransit}` : ''}`;

    const fhp = state.flagship;
    const hpChip = el('flagship-hp-line');
    const hpVal = el('flagship-hp-value');
    if (fhp.maxHp && !fhp.transit) {
      hpVal.textContent = `${Math.round(fhp.hp)}/${fhp.maxHp}`;
      hpChip.classList.remove('hidden');
    } else {
      hpChip.classList.add('hidden');
    }

    el('system-name').textContent = view === 'galaxy' ? 'Galaxy Map' : (viewedSystem?.name ?? '—');
    el('stronghold-badge').classList.toggle(
      'hidden',
      view !== 'system' || state.stronghold !== viewedSystemId,
    );

    const transit = transitStatus(state);
    if (transit) {
      const dest = systemById(state, transit.destId);
      el('flagship-loc').textContent =
        `→ ${dest?.name ?? transit.destId} (${Math.ceil(transit.etaMs / 1000)}s)`;
    } else {
      el('flagship-loc').textContent = systemById(state, state.flagship.systemId)?.name ?? '—';
    }

    const readyScouts = state.scouts.filter((s) => !s.transit).length;
    const transitScouts = state.scouts.filter((s) => s.transit).length;
    el('scout-summary').textContent =
      state.scouts.length === 0
        ? '—'
        : `${readyScouts}${transitScouts ? `+${transitScouts}` : ''}`;

    const fleetPanel = el('fleet-panel');
    const combatPanel = el('combat-panel');
    fleetPanel.classList.toggle('hidden', activeTab !== 'fleet');
    combatPanel.classList.toggle('hidden', view !== 'system' || activeTab === 'fleet');

    if (activeTab === 'fleet') {
      const roster = el('fleet-roster');
      roster.innerHTML = '';
      const allUnits = [
        ...(state.ships ?? []).filter((s) => s.hp > 0).map((s) => ({ kind: 'ship', unit: s })),
        ...state.scouts.map((s) => ({ kind: 'scout', unit: s })),
      ];
      if (allUnits.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No ships — build at a shipyard';
        roster.appendChild(empty);
      }
      for (const { kind, unit } of allUnits) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const selected = kind === 'ship' ? unit.id === selectedShipId : unit.id === selectedScoutId;
        btn.className = `list-row fleet-row${selected ? ' list-row--selected' : ''}`;

        const icon = document.createElement('span');
        icon.className = `fleet-row__badge ${kind === 'ship' ? hullCssClass(unit.hull) : 'hull-badge--special'}`;
        icon.textContent = kind === 'ship' ? hullVisual(unit.hull).short : 'SC';

        const main = document.createElement('div');
        main.className = 'list-row__main';
        const title = document.createElement('div');
        title.className = 'list-row__title';
        title.textContent = kind === 'ship' ? formatHullName(unit.hull) : unit.id;
        const sub = document.createElement('div');
        sub.className = 'list-row__sub';
        if (unit.transit) {
          const eta = kind === 'ship' ? shipEtaMs(state, unit) : scoutEtaMs(state, unit);
          sub.textContent = `In transit · ${Math.ceil(eta / 1000)}s remaining`;
        } else {
          sub.textContent = `@ ${systemById(state, unit.systemId)?.name ?? unit.systemId}`;
        }
        main.appendChild(title);
        main.appendChild(sub);
        btn.appendChild(icon);
        btn.appendChild(main);

        if (kind === 'ship') {
          const hpWrap = document.createElement('div');
          hpWrap.className = 'fleet-row__hp';
          renderMiniHpBar(hpWrap, unit.hp, unit.maxHp, hullVisual(unit.hull).color);
          btn.appendChild(hpWrap);
        }

        btn.addEventListener('click', () => {
          if (kind === 'ship') doSelectShip(unit.id);
          else doSelectScout(unit.id);
        });
        roster.appendChild(btn);
      }
      const shipLine = el('selected-ship-line');
      const selShip = selectedShipId ? findShip(state, selectedShipId) : null;
      shipLine.textContent = selShip
        ? `Selected: ${selShip.id} — Alt+click star to dispatch`
        : 'Select a combat ship for Alt+click dispatch';
    }

    if (view === 'system' && activeTab !== 'fleet') {
      renderCombatBody(el('combat-panel-body'), combatObservability(state, viewedSystemId), state.flagship);
    }

    const scoutPanel = el('scout-panel');
    if (state.scouts.length > 0 && activeTab !== 'fleet') {
      scoutPanel.classList.remove('hidden');
      const roster = el('scout-roster');
      roster.innerHTML = '';
      for (const scout of state.scouts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const selected = scout.id === selectedScoutId;
        btn.className = `list-row scout-select-btn${selected ? ' list-row--selected' : ''}`;

        const icon = document.createElement('span');
        icon.className = 'list-row__icon';
        icon.style.background = scout.transit ? 'var(--accent-gold)' : 'var(--accent-cyan)';

        const main = document.createElement('span');
        main.className = 'list-row__main';
        const title = document.createElement('div');
        title.className = 'list-row__title';
        title.textContent = scout.id;
        const sub = document.createElement('div');
        sub.className = 'list-row__sub';

        if (scout.transit) {
          const st = scout.transit;
          const dest = systemById(state, st.path[st.path.length - 1]);
          sub.textContent = `→ ${dest?.name ?? '?'} · ${Math.ceil(scoutEtaMs(state, scout) / 1000)}s`;
        } else {
          const loc = systemById(state, scout.systemId)?.name ?? scout.systemId;
          sub.textContent = `@ ${loc}`;
        }

        main.appendChild(title);
        main.appendChild(sub);
        btn.appendChild(icon);
        btn.appendChild(main);
        btn.addEventListener('click', () => doSelectScout(scout.id));
        roster.appendChild(btn);
      }

      const sel = selectedScoutId ? findScout(state, selectedScoutId) : null;
      const line = el('selected-scout-line');
      if (sel?.transit) {
        const dest = systemById(state, sel.transit.path[sel.transit.path.length - 1]);
        line.textContent =
          `Selected: ${sel.id} → ${dest?.name ?? '?'} (${Math.ceil(scoutEtaMs(state, sel) / 1000)}s)`;
        line.className = 'panel__footer panel-note panel-note--muted';
      } else if (sel) {
        line.textContent =
          `Selected: ${sel.id} @ ${systemById(state, sel.systemId)?.name ?? sel.systemId}`;
        line.className = 'panel__footer panel-note panel-note--muted';
      } else {
        line.textContent = 'Shift+click a star on the galaxy map to dispatch';
        line.className = 'panel__footer panel-note panel-note--muted';
      }
    } else {
      scoutPanel.classList.add('hidden');
    }

    const intelPanel = el('intel-panel');
    const intelBody = el('intel-panel-body');
    const captureBody = el('capture-panel-body');

    if (view === 'system' && hasIntel(state, viewedSystemId)) {
      intelPanel.classList.remove('hidden');
      const sys = viewedSystem;
      const req = captureRequirement(state, viewedSystemId);
      renderIntelBody(
        intelBody,
        sys,
        req,
        garrisonIntelText(state, viewedSystemId),
        garrisonSummary(state, viewedSystemId).composition,
      );
      renderCaptureBody(captureBody, state, viewedSystemId, req, captureCtx);
    } else if (view === 'system' && viewedSystem) {
      intelPanel.classList.remove('hidden');
      clearChildren(intelBody);
      clearChildren(captureBody);
      const msg = document.createElement('p');
      msg.className = 'no-intel-msg';
      msg.textContent = 'No intel — send a scout or visit with your flagship.';
      intelBody.appendChild(msg);
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
    el('build-panel-title').textContent = planet.name;
    renderBuildBody(el('build-panel-body'), planet, state, viewedSystemId);

    const outpostCheck = canBuildOutpost(state, viewedSystemId, planet.id);
    const shipyardCheck = canBuildShipyard(state, viewedSystemId, planet.id);
    const shipyard = findShipyardOnPlanet(state, viewedSystemId, planet.id);
    const scoutCheck = shipyard ? canQueueScout(state, shipyard.id, viewedSystemId) : { ok: false };

    const outpostBtn = el('build-outpost-btn');
    outpostBtn.classList.toggle('hidden', hasOutpost(state, viewedSystemId, planet.id));
    outpostBtn.disabled = !outpostCheck.ok;
    outpostBtn.textContent = `Build Outpost (${OUTPOST_COST} cr)`;

    const shipyardBtn = el('build-shipyard-btn');
    shipyardBtn.classList.toggle(
      'hidden',
      !hasOutpost(state, viewedSystemId, planet.id) || hasShipyard(state, viewedSystemId, planet.id),
    );
    shipyardBtn.disabled = !shipyardCheck.ok;
    shipyardBtn.textContent = `Build Shipyard (${SHIPYARD_COST} cr)`;

    const showScoutBtn = shipyard && !shipyard.build;
    const scoutBtn = el('queue-scout-btn');
    scoutBtn.classList.toggle('hidden', !showScoutBtn);
    scoutBtn.disabled = !scoutCheck.ok;
    scoutBtn.textContent = `Build Scout (${SCOUT_HULL_COST} cr)`;

    const hullGrid = el('hull-queue-buttons');
    hullGrid.innerHTML = '';
    if (shipyard && !shipyard.build) {
      hullGrid.classList.remove('hidden');
      for (const hull of BUILDABLE_HULLS) {
        if (hull === 'scout') continue;
        const stats = HULL_STATS[hull];
        const vis = hullVisual(hull);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn--ghost btn--sm hull-queue-btn ${hullCssClass(hull)}`;
        btn.disabled = !canQueueHull(state, shipyard.id, viewedSystemId, hull).ok;
        btn.innerHTML = `<span class="hull-queue-btn__name">${formatHullName(hull)}</span><span class="hull-queue-btn__meta">${stats.cost}cr · ${vis.role}</span>`;
        btn.title = `${hull} · ${stats.buildMs / 1000}s build`;
        btn.style.borderColor = hexToRgba(vis.color, 0.45);
        btn.addEventListener('click', () => doQueueHull(shipyard.id, hull));
        hullGrid.appendChild(btn);
      }
    } else {
      hullGrid.classList.add('hidden');
    }

    if (shipyard?.build) {
      const prog = shipyardBuildProgress(shipyard, state.time);
      el('build-progress').querySelector('.progress-block__label').textContent =
        `Building ${shipyard.build.hull.replace(/_/g, ' ')}`;
      setProgressBar('build-progress', 'build-progress-fill', 'build-progress-pct', prog, true);
    } else {
      setProgressBar('build-progress', 'build-progress-fill', 'build-progress-pct', 0, false);
    }

    let note = '';
    if (!outpostCheck.ok && !hasOutpost(state, viewedSystemId, planet.id)) note = outpostCheck.reason;
    else if (
      !shipyardCheck.ok &&
      hasOutpost(state, viewedSystemId, planet.id) &&
      !hasShipyard(state, viewedSystemId, planet.id)
    ) {
      note = shipyardCheck.reason;
    } else if (shipyard && !scoutCheck.ok && !shipyard.build) note = scoutCheck.reason;
    el('build-panel-note').textContent = note;
  };
}
