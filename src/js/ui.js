// HUD, build panel, save menu, toasts. Manipulates DOM inside #hud only.

import {
  OUTPOST_COST,
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  CAPTURE_HOLD_MS,
  HULL_STATS,
  SHIPYARD_COMBAT_HULLS,
  FOUNDRY_COST,
  LAUNCHER_COST,
  LAUNCHERS_PER_BODY_MAX,
  SHELL_SAILS_REQUIRED,
  TRADE_STATION_COST,
  RESEARCH_STATION_COST,
  RESEARCH_STATION_CAP,
} from './constants.js';
import {
  systemById,
  findPlanet,
  hasOutpost,
  hasShipyard,
  findShipyardOnPlanet,
  isPlayerOwned,
  isAiOwned,
  hasFoundry,
  launcherCountOnBody,
  ensureDyson,
  dysonLaunchers,
  foundryHostPlanet,
} from './state.js';
import { canBuildOutpost, incomePerSecond, incomePerSecondInSystem } from './economy.js';
import { canBuildShipyard, canQueueScout, canQueueHull } from './production.js';
import {
  canBuildFoundry,
  canBuildLauncher,
  solariiPerSecond,
  solariiPerSecondInSystem,
  activeShellBonuses,
} from './dyson.js';
import { transitStatus, isFlagshipOrbiting, orbitTargetLabel } from './flagship.js';
import { scoutEtaMs, findScout } from './scout.js';
import { SLOTS, listSlots, exportSaveFile, importSaveFile } from './save.js';
import { getActiveGalaxy } from './galaxy-scope.js';
import { canEnterWormhole, canBuildWormholeAnchor } from './wormholes.js';
import { WORMHOLE_ANCHOR_COST } from './constants.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { enqueueHull, cancelQueueItem, pinQueueItem, empireQueueSummary, listPlayerShipyards } from './empire-queue.js';
import { startResearch, canBuildResearchStation, buildResearchStation, researchSummary, researchStationCount } from './research.js';
import { canBuildTradeStation, buildTradeStation, tradeSummary } from './trade.js';
import { allTechNodes, isTechUnlocked, techPrereqsMet, techNode } from './tech-web.js';
import { empireQueueHulls } from './tech-web.js';
import { normalizeShipyardBuilds } from './empire-queue.js';

const el = (id) => document.getElementById(id);

const HINTS = {
  system: 'WASD / arrows: fly flagship · O: stable orbit · F: follow · drag: pan · M: galaxy map',
  galaxy: 'Click star: travel · Shift+click: send scout · double-click: view system · M: system view',
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

function renderIntelBody(container, sys, captureReq) {
  clearChildren(container);
  if (!sys) {
    const msg = document.createElement('p');
    msg.className = 'empty-state';
    msg.textContent = 'No system data.';
    container.appendChild(msg);
    return;
  }

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

  const block = document.createElement('div');
  block.className = 'capture-block';

  const header = document.createElement('div');
  header.className = 'capture-block__header';
  header.innerHTML = `<span class="capture-block__force">Force: <strong>${force}</strong> / ${req}</span>`;
  block.appendChild(header);

  const barWrap = document.createElement('div');
  barWrap.className = 'progress';
  const barFill = document.createElement('div');
  barFill.className = 'progress__fill';
  const forcePct = Math.min(1, force / Math.max(req, 1));
  barFill.style.width = `${Math.round(forcePct * 100)}%`;
  barWrap.appendChild(barFill);
  block.appendChild(barWrap);

  const status = document.createElement('div');
  status.className = 'panel-note panel-note--muted';
  status.style.marginTop = '8px';

  if (canHoldCapture(state, systemId) && progress > 0) {
    const holdPct = progress / CAPTURE_HOLD_MS;
    const holdBar = document.createElement('div');
    holdBar.className = 'progress';
    holdBar.style.marginTop = '8px';
    const holdFill = document.createElement('div');
    holdFill.className = 'progress__fill';
    holdFill.style.width = `${Math.round(holdPct * 100)}%`;
    holdFill.style.background = `linear-gradient(90deg, rgba(122, 255, 158, 0.5), var(--accent-green))`;
    holdBar.appendChild(holdFill);
    block.appendChild(holdBar);
    status.textContent = `Holding… ${Math.ceil((CAPTURE_HOLD_MS - progress) / 1000)}s / ${CAPTURE_HOLD_MS / 1000}s`;
  } else if (enemyCombatPresence(state, systemId) > 0) {
    status.innerHTML = '<span class="badge badge--contested">Contested!</span>';
    status.classList.remove('panel-note--muted');
  } else if (!isPlayerOwned(state, systemId) && force >= req) {
    status.textContent = 'Hold starting…';
  } else {
    status.textContent = force >= req ? 'Ready to hold' : 'Insufficient capture force';
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
    {
      label: 'Sail Foundry',
      built: hasFoundry(state, systemId) && foundryHostPlanet(state, systemId)?.id === planet.id,
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

  if (isPlayerOwned(state, systemId) && !hasFoundry(state, systemId)) {
    const foundryNote = document.createElement('p');
    foundryNote.className = 'panel-note panel-note--muted';
    foundryNote.style.marginTop = '10px';
    foundryNote.textContent =
      'Sail Foundry — an orbital ring station that produces Dyson sails in a fixed ring orbit around this planet.';
    container.appendChild(foundryNote);
  } else if (
    hasFoundry(state, systemId) &&
    foundryHostPlanet(state, systemId)?.id === planet.id
  ) {
    const foundryNote = document.createElement('p');
    foundryNote.className = 'panel-note panel-note--muted';
    foundryNote.style.marginTop = '10px';
    foundryNote.textContent =
      'Sail Foundry ring online — feeds sail shuttles to launchers across this system.';
    container.appendChild(foundryNote);
  }
}

function updateTabBar(view, sidePanel) {
  el('tab-galaxy').classList.toggle('tab--active', view === 'galaxy' && !sidePanel);
  el('tab-system').classList.toggle('tab--active', view === 'system' && !sidePanel);
  el('tab-dyson').classList.toggle('tab--active', sidePanel === 'dyson');
  el('tab-tech').classList.toggle('tab--active', sidePanel === 'tech');
}

function renderDysonPanel(container, state, systemId) {
  clearChildren(container);
  const system = systemById(state, systemId);
  if (!system || systemId === 'core') {
    const msg = document.createElement('p');
    msg.className = 'empty-state';
    msg.textContent = 'No Dyson project in this system.';
    container.appendChild(msg);
    return;
  }

  const dyson = ensureDyson(system);
  const launchers = dysonLaunchers(state, systemId);
  const hostPlanet = foundryHostPlanet(state, systemId);

  const header = document.createElement('div');
  header.className = 'intel-header';
  const name = document.createElement('span');
  name.className = 'intel-header__name';
  name.textContent = system.name;
  header.appendChild(name);
  container.appendChild(header);

  const dysonNote = document.createElement('p');
  dysonNote.className = 'panel-note panel-note--muted';
  dysonNote.style.marginTop = '8px';
  dysonNote.textContent = hasFoundry(state, systemId)
    ? 'The Sail Foundry is an orbital ring station around its host planet; it produces sails for every launcher in this system.'
    : 'Build a Sail Foundry from a planet panel — one orbital ring station per system, anchored to that world.';
  container.appendChild(dysonNote);

  const rows = [
    {
      label: 'Foundry',
      value: hasFoundry(state, systemId)
        ? (hostPlanet ? `Ring at ${hostPlanet.name}` : 'Online')
        : 'Not built',
    },
    { label: 'Launchers', value: String(launchers.length) },
    { label: 'Shells', value: `${dyson.completedShells} / ${SHELL_COUNT}` },
    { label: 'Sails to next shell', value: `${Math.floor(dyson.shellSails)} / ${SHELL_SAILS_REQUIRED}` },
    { label: 'Foundry stock', value: `${Math.floor(dyson.foundryStock)} sails` },
    { label: 'System Solarii', value: `${solariiPerSecondInSystem(state, systemId).toFixed(3)}/s` },
  ];
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'status-row';
    const label = document.createElement('span');
    label.className = 'status-row__label';
    label.textContent = row.label;
    const val = document.createElement('span');
    val.className = 'status-indicator status-indicator--built';
    val.textContent = row.value;
    r.appendChild(label);
    r.appendChild(val);
    container.appendChild(r);
  }

  const shellPct = dyson.completedShells >= SHELL_COUNT
    ? 1
    : dyson.shellSails / SHELL_SAILS_REQUIRED;
  const progBlock = document.createElement('div');
  progBlock.className = 'progress-block';
  progBlock.style.marginTop = '12px';
  const progLabel = document.createElement('div');
  progLabel.className = 'progress-block__label';
  progLabel.textContent = dyson.completedShells >= SHELL_COUNT
    ? 'Sphere complete'
    : `Shell ${dyson.completedShells + 1} progress`;
  const prog = document.createElement('div');
  prog.className = 'progress';
  const fill = document.createElement('div');
  fill.className = 'progress__fill';
  fill.style.width = `${Math.round(shellPct * 100)}%`;
  prog.appendChild(fill);
  progBlock.appendChild(progLabel);
  progBlock.appendChild(prog);
  container.appendChild(progBlock);

  const bonusTitle = document.createElement('div');
  bonusTitle.className = 'intel-section-title';
  bonusTitle.style.marginTop = '12px';
  bonusTitle.textContent = 'Active bonuses';
  container.appendChild(bonusTitle);

  const bonuses = activeShellBonuses(system);
  if (bonuses.length === 0) {
    const none = document.createElement('p');
    none.className = 'panel-note panel-note--muted';
    none.textContent = 'Complete Shell #1 to begin earning Solarii.';
    container.appendChild(none);
  } else {
    for (const b of bonuses) {
      const li = document.createElement('div');
      li.className = 'planet-row__meta';
      li.textContent = `• ${b}`;
      container.appendChild(li);
    }
  }
}

const LOG_LIMIT = 40;

function renderEmpireQueuePanel(state) {
  const list = el('empire-queue-list');
  const actions = el('empire-queue-actions');
  if (!list || !actions) return;
  clearChildren(list);
  clearChildren(actions);

  const queue = empireQueueSummary(state);
  if (queue.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No ships queued.';
    list.appendChild(empty);
  } else {
    const yards = listPlayerShipyards(state);
    for (const item of queue) {
      const row = document.createElement('div');
      row.className = 'planet-row';
      const title = document.createElement('div');
      title.className = 'planet-row__name';
      title.textContent = `${item.hull} · ${item.status}`;
      row.appendChild(title);
      if (item.status === 'pending') {
        const pin = document.createElement('select');
        pin.className = 'btn btn--ghost btn--sm';
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Auto route';
        pin.appendChild(opt);
        for (const y of yards) {
          const o = document.createElement('option');
          o.value = y.shipyardId;
          o.textContent = `${y.systemId.slice(-6)} / ${y.shipyardId}`;
          if (item.pinnedShipyardId === y.shipyardId) o.selected = true;
          pin.appendChild(o);
        }
        pin.onchange = () => pinQueueItem(state, item.id, pin.value || null);
        row.appendChild(pin);
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn--ghost btn--xs';
        cancel.textContent = 'Cancel';
        cancel.onclick = () => {
          const res = cancelQueueItem(state, item.id);
          if (!res.ok) toast(res.reason, 'error');
        };
        row.appendChild(cancel);
      }
      list.appendChild(row);
    }
  }

  for (const hull of empireQueueHulls(state)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--primary btn--block';
    btn.textContent = `Queue ${hull}`;
    btn.onclick = () => {
      const res = enqueueHull(state, hull);
      if (!res.ok) toast(res.reason, 'error');
      else toast(`Queued ${hull}`, 'ok');
    };
    actions.appendChild(btn);
  }
}

function renderTechPanel(container, state) {
  clearChildren(container);
  const summary = researchSummary(state);
  if (summary.activeNodeId) {
    const active = document.createElement('div');
    active.className = 'progress-block';
    active.innerHTML = `<div class="progress-block__label">Researching: ${summary.activeNodeId}</div>`;
    const prog = document.createElement('div');
    prog.className = 'progress';
    const fill = document.createElement('div');
    fill.className = 'progress__fill';
    fill.style.width = `${Math.round(summary.progress * 100)}%`;
    prog.appendChild(fill);
    active.appendChild(prog);
    container.appendChild(active);
  }

  for (const node of allTechNodes()) {
    if (node.id === 'eco_baseline') continue;
    const row = document.createElement('div');
    row.className = 'planet-row';
    const unlocked = isTechUnlocked(state, node.id);
    const available = techPrereqsMet(state, node.id) && !unlocked;
    const name = document.createElement('div');
    name.className = 'planet-row__name';
    name.textContent = `${node.name} (${node.creditCost} cr${node.solariiCost ? ` + ${node.solariiCost} SO` : ''})`;
    row.appendChild(name);
    if (unlocked) {
      const badge = document.createElement('span');
      badge.className = 'badge badge--gold';
      badge.textContent = 'Done';
      row.appendChild(badge);
    } else if (available) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary btn--sm';
      btn.textContent = 'Research';
      btn.onclick = () => {
        const res = startResearch(state, node.id);
        if (!res.ok) toast(res.reason, 'error');
        else toast(`Started ${node.name}`, 'ok');
      };
      row.appendChild(btn);
    } else {
      const lock = document.createElement('span');
      lock.className = 'planet-row__meta';
      lock.textContent = 'Locked';
      row.appendChild(lock);
    }
    container.appendChild(row);
  }
}

function appendLogEntry(message, kind) {
  const body = el('notification-log-body');
  if (!body) return;
  body.querySelector('.empty-state')?.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry${kind ? ` log-entry--${kind}` : ''}`;
  const time = document.createElement('span');
  time.className = 'log-entry__time';
  time.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const msg = document.createElement('span');
  msg.className = 'log-entry__msg';
  msg.textContent = message;
  entry.appendChild(time);
  entry.appendChild(msg);
  body.prepend(entry);

  while (body.children.length > LOG_LIMIT) body.removeChild(body.lastChild);
}

export function toast(message, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  el('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3600);
  appendLogEntry(message, kind);
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
    doBuildFoundry,
    doBuildLauncher,
    doEnterWormhole,
    doBuildWormholeAnchor,
  } = ctx;

  let sidePanel = null;

  let hullBtnContainer = el('combat-hull-buttons');
  if (!hullBtnContainer) {
    hullBtnContainer = document.createElement('div');
    hullBtnContainer.id = 'combat-hull-buttons';
    hullBtnContainer.className = 'panel__actions';
    el('queue-scout-btn').after(hullBtnContainer);
    for (const hull of SHIPYARD_COMBAT_HULLS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary btn--block';
      btn.dataset.hull = hull;
      hullBtnContainer.appendChild(btn);
    }
    hullBtnContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hull]');
      if (!btn || btn.disabled) return;
      const res = enqueueHull(getState(), btn.dataset.hull);
      if (!res.ok) toast(res.reason, 'error');
      else toast(`Queued ${btn.dataset.hull}`, 'ok');
    });
  }
  const hullButtons = [...hullBtnContainer.querySelectorAll('[data-hull]')];

  el('pause-btn').addEventListener('click', doTogglePause);
  el('view-toggle-btn').addEventListener('click', doToggleView);
  el('tab-galaxy').addEventListener('click', () => {
    sidePanel = null;
    if (getView() !== 'galaxy') doToggleView();
  });
  el('tab-system').addEventListener('click', () => {
    sidePanel = null;
    if (getView() !== 'system') doToggleView();
  });
  el('tab-dyson').addEventListener('click', () => {
    sidePanel = 'dyson';
    if (getView() !== 'system') doToggleView();
  });
  el('tab-tech').addEventListener('click', () => {
    sidePanel = 'tech';
  });

  el('build-trade-btn')?.addEventListener('click', () => {
    const sel = getSelection();
    if (sel) {
      const res = buildTradeStation(getState(), getViewedSystemId(), sel);
      if (!res.ok) toast(res.reason, 'error');
      else toast('Trade station built', 'ok');
    }
  });
  el('build-research-btn')?.addEventListener('click', () => {
    const res = buildResearchStation(getState(), getViewedSystemId());
    if (!res.ok) toast(res.reason, 'error');
    else toast('Research station built', 'ok');
  });

  el('build-outpost-btn').addEventListener('click', () => {
    const sel = getSelection();
    if (sel) doBuildOutpost(sel);
  });
  el('build-shipyard-btn').addEventListener('click', () => {
    const sel = getSelection();
    if (sel) doBuildShipyard(sel);
  });
  el('build-foundry-btn').addEventListener('click', () => doBuildFoundry());
  el('build-launcher-btn').addEventListener('click', () => {
    const sel = getSelection();
    if (sel) doBuildLauncher(sel);
  });
  el('queue-scout-btn').addEventListener('click', () => {
    const res = enqueueHull(getState(), 'scout');
    if (!res.ok) toast(res.reason, 'error');
    else toast('Queued scout', 'ok');
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
    const viewedSystemId = getViewedSystemId();
    const viewedSystem = systemById(state, viewedSystemId);
    const selectedScoutId = getSelectedScoutId();

    el('credits-value').textContent = Math.floor(state.credits).toLocaleString();
    el('income-value').textContent = incomePerSecond(state).toFixed(1);

    const solariiChip = el('solarii-chip');
    if (state.solariiUnlocked) {
      solariiChip.classList.remove('hidden');
      el('solarii-value').textContent = (state.solarii ?? 0).toFixed(2);
      el('solarii-rate').textContent = solariiPerSecond(state).toFixed(3);
    } else {
      solariiChip.classList.add('hidden');
    }

    const trade = tradeSummary(state);
    const tradeChip = el('trade-chip');
    if (trade.incomePerSec > 0) {
      tradeChip.classList.remove('hidden');
      el('trade-income-value').textContent = trade.incomePerSec.toFixed(2);
    } else {
      tradeChip.classList.add('hidden');
    }

    renderEmpireQueuePanel(state);

    const techPanel = el('tech-panel');
    if (sidePanel === 'tech') {
      techPanel.classList.remove('hidden');
      renderTechPanel(el('tech-panel-body'), state);
    } else {
      techPanel.classList.add('hidden');
    }

    el('pause-btn').querySelector('.btn-label').textContent = state.paused ? 'Resume' : 'Pause';
    el('pause-overlay').classList.toggle('hidden', !state.paused);
    el('view-toggle-btn').querySelector('.btn-label').textContent =
      view === 'galaxy' ? 'System View (M)' : 'Galaxy Map (M)';
    el('view-hint').textContent = HINTS[view];
    updateTabBar(view, sidePanel);

    const dysonPanel = el('dyson-panel');
    if (sidePanel === 'dyson' && view === 'system') {
      dysonPanel.classList.remove('hidden');
      renderDysonPanel(el('dyson-panel-body'), state, viewedSystemId);
    } else {
      dysonPanel.classList.add('hidden');
    }

    el('system-name').textContent = view === 'galaxy'
      ? `${getActiveGalaxy(state)?.name ?? 'Galaxy Map'}`
      : (viewedSystem?.name ?? '—');
    el('stronghold-badge').classList.toggle(
      'hidden',
      view !== 'system' || state.stronghold !== viewedSystemId,
    );

    const transit = transitStatus(state);
    if (transit) {
      const dest = systemById(state, transit.destId);
      el('flagship-loc').textContent =
        `→ ${dest?.name ?? transit.destId} (${Math.ceil(transit.etaMs / 1000)}s)`;
    } else if (isFlagshipOrbiting(state)) {
      const target = orbitTargetLabel(state);
      el('flagship-loc').textContent =
        `${systemById(state, state.flagship.systemId)?.name ?? '—'} · orbiting ${target ?? 'body'}`;
    } else {
      el('flagship-loc').textContent = systemById(state, state.flagship.systemId)?.name ?? '—';
    }

    const readyScouts = state.scouts.filter((s) => !s.transit).length;
    const transitScouts = state.scouts.filter((s) => s.transit).length;
    el('scout-summary').textContent =
      state.scouts.length === 0
        ? '—'
        : `${readyScouts}${transitScouts ? `+${transitScouts}` : ''}`;

    const scoutPanel = el('scout-panel');
    if (state.scouts.length > 0) {
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
      renderIntelBody(intelBody, sys, req);
      renderCaptureBody(captureBody, state, viewedSystemId, req, captureCtx);
      const battle = battleSummaryForSystem(state, viewedSystemId);
      if (battle?.active) {
        const warn = document.createElement('div');
        warn.className = 'panel-note';
        warn.style.marginTop = '10px';
        warn.innerHTML = `<span class="badge badge--contested">Battle</span> ${battle.mode} — ${battle.playerShips} vs ${battle.enemyShips}`;
        captureBody.appendChild(warn);
      } else if (enemyCombatPresence(state, viewedSystemId) > 0) {
        const warn = document.createElement('div');
        warn.className = 'panel-note panel-note--muted';
        warn.style.marginTop = '10px';
        warn.textContent = 'Pirate presence detected in this system.';
        captureBody.appendChild(warn);
      }
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
    const wormholePanel = el('wormhole-panel');

    if (view === 'system' && viewedSystemId === BLACK_HOLE_ID && sidePanel !== 'dyson') {
      panel.classList.add('hidden');
      wormholePanel?.classList.remove('hidden');
      const enterBtn = el('enter-wormhole-btn');
      const anchorBtn = el('build-anchor-btn');
      const anchorSelect = el('anchor-target-select');
      if (enterBtn) {
        enterBtn.disabled = !canEnterWormhole(state).ok;
        enterBtn.onclick = () => doEnterWormhole({});
      }
      if (anchorSelect) {
        anchorSelect.innerHTML = '';
        for (const [gid, gal] of Object.entries(state.galaxies ?? {})) {
          if (gid === state.activeGalaxyId) continue;
          const opt = document.createElement('option');
          opt.value = gid;
          opt.textContent = gal.name;
          anchorSelect.appendChild(opt);
        }
      }
      if (anchorBtn) {
        const target = anchorSelect?.value;
        const canAnchor = canBuildWormholeAnchor(state).ok && target;
        anchorBtn.disabled = !canAnchor;
        anchorBtn.textContent = `Build Anchor (${WORMHOLE_ANCHOR_COST} cr)`;
        anchorBtn.onclick = () => doBuildWormholeAnchor(target);
      }
      return;
    }
    wormholePanel?.classList.add('hidden');

    if (view !== 'system' || sidePanel === 'dyson' || sidePanel === 'tech' || !selection) {
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
    el('build-panel-title').textContent = planet?.name ?? 'Planet';
    renderBuildBody(el('build-panel-body'), planet, state, viewedSystemId);

    const outpostCheck = canBuildOutpost(state, viewedSystemId, planet.id);
    const shipyardCheck = canBuildShipyard(state, viewedSystemId, planet.id);
    const shipyard = findShipyardOnPlanet(state, viewedSystemId, planet.id);
    const scoutCheck = shipyard ? canQueueScout(state, shipyard.id, viewedSystemId) : { ok: false };

    const foundryCheck = canBuildFoundry(state, viewedSystemId, planet.id);
    const launcherCheck = canBuildLauncher(state, viewedSystemId, planet.id);
    const launcherCount = launcherCountOnBody(state, viewedSystemId, planet.id);

    const foundryBtn = el('build-foundry-btn');
    foundryBtn.classList.toggle('hidden', hasFoundry(state, viewedSystemId));
    foundryBtn.disabled = !foundryCheck.ok;
    foundryBtn.textContent = `Build Sail Foundry ring (${FOUNDRY_COST} cr)`;

    const launcherBtn = el('build-launcher-btn');
    const showLauncher = hasFoundry(state, viewedSystemId) && launcherCount < LAUNCHERS_PER_BODY_MAX;
    launcherBtn.classList.toggle('hidden', !showLauncher);
    launcherBtn.disabled = !launcherCheck.ok;
    launcherBtn.textContent = `Build Dyson Launcher (${launcherCount}/${LAUNCHERS_PER_BODY_MAX}) · ${LAUNCHER_COST} cr`;

    const tradeCheck = canBuildTradeStation(state, viewedSystemId, planet.id);
    const researchCheck = canBuildResearchStation(state, viewedSystemId);

    const tradeBtn = el('build-trade-btn');
    tradeBtn.classList.toggle('hidden', !hasOutpost(state, viewedSystemId, planet.id));
    tradeBtn.disabled = !tradeCheck.ok;
    tradeBtn.textContent = `Build Trade Station (${TRADE_STATION_COST} cr)`;

    const researchBtn = el('build-research-btn');
    researchBtn.classList.toggle('hidden', !isPlayerOwned(state, viewedSystemId));
    researchBtn.disabled = !researchCheck.ok;
    researchBtn.textContent = `Build Research Station (${researchStationCount(state, viewedSystemId)}/${RESEARCH_STATION_CAP}) · ${RESEARCH_STATION_COST} cr`;

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

    if (shipyard) normalizeShipyardBuilds(shipyard);
    const showScoutBtn = isPlayerOwned(state, viewedSystemId);
    const scoutBtn = el('queue-scout-btn');
    scoutBtn.classList.toggle('hidden', !showScoutBtn);
    scoutBtn.disabled = false;
    scoutBtn.textContent = `Add Scout to Empire Queue (${SCOUT_HULL_COST} cr)`;

    const showHullBtns = isPlayerOwned(state, viewedSystemId);
    hullBtnContainer.classList.toggle('hidden', !showHullBtns);
    for (const btn of hullButtons) {
      const hull = btn.dataset.hull;
      if (!showHullBtns) continue;
      if (!empireQueueHulls(state).includes(hull)) {
        btn.classList.add('hidden');
        continue;
      }
      btn.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = `Queue ${hull} (${HULL_STATS[hull].cost} cr)`;
    }

    const activeBuild = shipyard?.builds?.[0] ?? shipyard?.build;
    if (activeBuild) {
      normalizeShipyardBuilds(shipyard);
      const prog = shipyardBuildProgress(shipyard, state.time, 0);
      setProgressBar('build-progress', 'build-progress-fill', 'build-progress-pct', prog, true);
      el('build-progress').querySelector('.progress-block__label').textContent =
        `Building ${activeBuild.hull}`;
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
    } else if (!tradeCheck.ok && hasOutpost(state, viewedSystemId, planet.id)) note = tradeCheck.reason;
    else if (!researchCheck.ok && isPlayerOwned(state, viewedSystemId)) note = researchCheck.reason;
    else if (!foundryCheck.ok && !hasFoundry(state, viewedSystemId)) note = foundryCheck.reason;
    el('build-panel-note').textContent = note;
  };
}
