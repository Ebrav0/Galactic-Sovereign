// HUD, build panel, save menu, toasts. Manipulates DOM inside #hud only.

import {
  OUTPOST_COST,
  SHIPYARD_COST,
  SCOUT_HULL_COST,
  CAPTURE_HOLD_MS,
  HULL_STATS,
  SHIP_HULL_CATEGORIES,
  FOUNDRY_COST,
  LAUNCHER_COST,
  LAUNCHERS_PER_BODY_MAX,
  SHELL_COUNT,
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
import { SLOTS, listSlots, readSlot, exportSaveFile, importSaveFile } from './save.js';
import { getActiveGalaxy } from './galaxy-scope.js';
import { canEnterWormhole, canBuildWormholeAnchor } from './wormholes.js';
import { WORMHOLE_ANCHOR_COST } from './constants.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { enqueueHull, cancelQueueItem, pinQueueItem, empireQueueSummary, listPlayerShipyards } from './empire-queue.js';
import { startResearch, canBuildResearchStation, buildResearchStation, researchSummary, researchStationCount } from './research.js';
import { canBuildTradeStation, buildTradeStation, tradeSummary } from './trade.js';
import { diplomacySummary, offerTreaty } from './diplomacy.js';
import { campaignSummary } from './campaign.js';
import { listMissions, startMission } from './missions.js';
import { initTutorial } from './tutorial.js';
import { milestonesSummary } from './milestones.js';
import {
  superweaponCreate,
  superweaponDestroy,
  superweaponJump,
  superweaponSummary,
} from './superweapon.js';
import {
  buildHeroFlagship,
  heroFlagshipsSummary,
  setHeroRally,
} from './hero-flagships.js';
import { clearTradeRoutes, tradeRoutesSummary } from './trade-routes.js';
import {
  canBuildStrategicStructure,
  buildStrategicStructure,
  STRUCTURE_DEFS,
} from './strategic-structures.js';
import { allTechNodes, techNode } from './tech-web.js';
import { empireQueueHulls } from './tech-web.js';
import { mountTechWebGraph, researchSnapshotKey, TECH_CLUSTERS, tierRoman } from './tech-web-ui.js';
import { normalizeShipyardBuilds } from './empire-queue.js';
import {
  playerShipEtaMs,
  findPlayerShip,
} from './fleets.js';
import {
  formatFleetName,
  battleGroupsForGalaxy,
  unassignedPlayerShips,
  fleetLocationSummary,
  setBattleGroupHeroAnchor,
} from './battle-groups.js';
import { getGraph } from './galaxy-scope.js';

const el = (id) => document.getElementById(id);

const HINTS = {
  system: 'WASD / arrows: fly flagship · O: stable orbit · F: follow · drag: pan · M: galaxy map',
  galaxy: 'Click star: travel · Alt+click: fleet · Shift+click: scout · Ctrl+click: trade route · double-click: view · M: system',
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
  el('tab-fleet')?.classList.toggle('tab--active', sidePanel === 'fleet');
  el('tab-diplomacy')?.classList.toggle('tab--active', sidePanel === 'diplomacy');
  el('tab-campaign')?.classList.toggle('tab--active', sidePanel === 'campaign');
}

function renderDiplomacyPanel(container, state) {
  clearChildren(container);
  const summary = diplomacySummary(state);
  if (!summary.unlocked) {
    const locked = document.createElement('p');
    locked.className = 'empty-state';
    locked.textContent = 'Complete a Dyson sphere (Shell #8) to unlock diplomacy.';
    container.appendChild(locked);
    return;
  }
  for (const f of summary.factions) {
    const row = document.createElement('div');
    row.className = 'intel-row';
    row.innerHTML = `<span>${f.name}</span><span>${f.status}</span>`;
    container.appendChild(row);
    const actions = document.createElement('div');
    actions.className = 'dev-row';
    for (const [type, label] of [['truce', 'Truce'], ['trade', 'Trade'], ['alliance', 'Alliance']]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--xs';
      btn.textContent = label;
      btn.onclick = () => {
        const res = offerTreaty(state, f.id, type);
        toast(res.ok ? `${label} with ${f.name}` : res.reason, res.ok ? 'ok' : 'error');
      };
      actions.appendChild(btn);
    }
    container.appendChild(actions);
  }
}

function renderCampaignPanel(container, state) {
  clearChildren(container);
  const camp = campaignSummary(state);
  const ms = milestonesSummary(state);
  const intro = document.createElement('p');
  intro.className = 'panel-note';
  intro.textContent = `Mode: ${camp.mode} · Victory: ${camp.victoryType}${camp.won ? ' · WON' : ''}${camp.defeated ? ' · DEFEATED' : ''}`;
  container.appendChild(intro);
  const mile = document.createElement('p');
  mile.className = 'panel-note panel-note--muted';
  mile.textContent = `Completed Dysons: ${ms.completedDysonCount} · Diplomacy: ${ms.diplomacyUnlocked ? 'yes' : 'no'} · Superweapon: ${ms.superweaponUnlocked ? 'yes' : 'no'}`;
  container.appendChild(mile);
  const sw = superweaponSummary(state);
  if (sw.online) {
    const swRow = document.createElement('div');
    swRow.className = 'dev-row';
    for (const [label, fn] of [
      ['Create Star', () => superweaponCreate(state, state.stronghold)],
      ['Destroy Viewed', () => superweaponDestroy(state, getViewedSystemId())],
      ['Jump Home', () => superweaponJump(state, state.stronghold)],
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = label;
      btn.onclick = () => {
        const res = fn();
        toast(res.ok ? label : res.reason, res.ok ? 'ok' : 'error');
      };
      swRow.appendChild(btn);
    }
    container.appendChild(swRow);
    const heroBtn = document.createElement('button');
    heroBtn.type = 'button';
    heroBtn.className = 'btn btn--primary btn--sm';
    heroBtn.textContent = 'Build Hero Flagship';
    heroBtn.onclick = () => {
      const res = buildHeroFlagship(state);
      toast(res.ok ? 'Hero flagship queued' : res.reason, res.ok ? 'ok' : 'error');
    };
    container.appendChild(heroBtn);
  }
  const tutBtn = document.createElement('button');
  tutBtn.type = 'button';
  tutBtn.className = 'btn btn--ghost btn--sm';
  tutBtn.textContent = 'Start Tutorial';
  tutBtn.onclick = () => {
    initTutorial(state);
    toast('Tutorial started', 'ok');
  };
  container.appendChild(tutBtn);
  for (const m of listMissions()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--xs';
    btn.textContent = m.name;
    btn.onclick = () => {
      const res = startMission(state, m.id);
      toast(res.ok ? `Mission: ${m.name}` : res.reason, res.ok ? 'ok' : 'error');
    };
    container.appendChild(btn);
  }
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

function hullLabel(hull) {
  return hull.replace(/_/g, ' ');
}

function empireQueueListSnapshot(state) {
  const yards = listPlayerShipyards(state).map((y) => y.shipyardId).sort().join(',');
  const items = empireQueueSummary(state).map((q) => ({
    id: q.id,
    hull: q.hull,
    status: q.status,
    pin: q.pinnedShipyardId ?? null,
  }));
  return JSON.stringify({ yards, items });
}

function empireQueueActionsSnapshot(state) {
  const yards = listPlayerShipyards(state);
  if (yards.length === 0) return 'no-yards';
  return empireQueueHulls(state).join(',');
}

function scoutRosterStructureSnapshot(state, selectedScoutId) {
  return JSON.stringify(
    state.scouts.map((s) => ({
      id: s.id,
      selected: s.id === selectedScoutId,
      loc: s.transit ? s.transit.path[s.transit.path.length - 1] : s.systemId,
      transit: !!s.transit,
    })),
  );
}

function fleetPanelStructureSnapshot(state, selectedBattleGroupId, selectedScoutId) {
  const playerShips = (state.playerShips ?? []).filter((s) => s.galaxyId === state.activeGalaxyId && s.hp > 0);
  return JSON.stringify({
    groups: battleGroupsForGalaxy(state).map((g) => ({
      id: g.id,
      ordinal: g.ordinal,
      shipIds: g.shipIds,
      selected: g.id === selectedBattleGroupId,
    })),
    unassigned: unassignedPlayerShips(state).map((s) => s.id),
    ships: playerShips.map((s) => ({
      id: s.id,
      hull: s.hull,
      transit: !!s.transit,
      loc: s.transit ? s.transit.path[s.transit.path.length - 1] : s.systemId,
    })),
    scouts: state.scouts.map((s) => ({
      id: s.id,
      selected: s.id === selectedScoutId,
      transit: !!s.transit,
      loc: s.transit ? s.transit.path[s.transit.path.length - 1] : s.systemId,
    })),
    yards: listPlayerShipyards(state).length,
    queuePending: empireQueueSummary(state).filter((q) => q.status === 'pending').length,
  });
}

function updateFleetPanelLabels(state, selectedScoutId, selectedBattleGroupId) {
  const container = el('fleet-panel-body');
  if (!container) return;

  const playerShips = (state.playerShips ?? []).filter((s) => s.galaxyId === state.activeGalaxyId && s.hp > 0);
  const readyShips = playerShips.filter((s) => !s.transit).length;
  const transitShips = playerShips.filter((s) => s.transit).length;
  const battleGroups = battleGroupsForGalaxy(state);
  const queue = empireQueueSummary(state);

  const stats = container.querySelector('.fleet-stats');
  if (stats) {
    stats.innerHTML = `
      <span>Ships: <strong>${readyShips}</strong>${transitShips ? ` +${transitShips} transit` : ''}</span>
      <span>Fleets: <strong>${battleGroups.length}</strong></span>
      <span>Scouts: <strong>${state.scouts.length}</strong></span>
      <span>Shipyards: <strong>${listPlayerShipyards(state).length}</strong></span>
      <span>Queue: <strong>${queue.filter((q) => q.status === 'pending').length}</strong></span>
    `;
  }

  for (const row of container.querySelectorAll('.fleet-ship-row')) {
    const ship = findPlayerShip(state, row.dataset.shipId);
    if (!ship) continue;
    const icon = row.querySelector('.list-row__icon');
    if (icon) icon.style.background = ship.transit ? 'var(--accent-gold)' : 'var(--accent-cyan)';
    const sub = row.querySelector('.list-row__sub');
    if (!sub) continue;
    if (ship.transit) {
      const destId = ship.transit.path[ship.transit.path.length - 1];
      const dest = systemById(state, destId);
      sub.textContent = `→ ${dest?.name ?? destId} · ${Math.ceil(playerShipEtaMs(state, ship) / 1000)}s`;
    } else {
      const loc = systemById(state, ship.systemId)?.name ?? ship.systemId ?? '—';
      sub.textContent = `@ ${loc} · HP ${Math.ceil(ship.hp)}/${ship.maxHp}`;
    }
  }

  for (const header of container.querySelectorAll('.fleet-group-header')) {
    const groupId = header.dataset.fleetSelect;
    const group = battleGroups.find((g) => g.id === groupId);
    if (!group) continue;
    header.classList.toggle('list-row--selected', group.id === selectedBattleGroupId);
    const fleetIcon = header.querySelector('.fleet-group-icon');
    fleetIcon?.classList.toggle('fleet-group-icon--selected', group.id === selectedBattleGroupId);
    const sub = header.querySelector('.list-row__sub');
    if (!sub) continue;
    const shipCount = group.shipIds.length;
    sub.textContent = `${shipCount} ship${shipCount === 1 ? '' : 's'} · ${fleetLocationSummary(state, group.id)}`;
  }

  for (const btn of container.querySelectorAll('.scout-select-btn')) {
    const scout = findScout(state, btn.dataset.scoutId);
    if (!scout) continue;
    btn.classList.toggle('list-row--selected', scout.id === selectedScoutId);
    const icon = btn.querySelector('.list-row__icon');
    if (icon) icon.style.background = scout.transit ? 'var(--accent-gold)' : 'var(--accent-cyan)';
    const sub = btn.querySelector('.list-row__sub');
    if (!sub) continue;
    if (scout.transit) {
      const st = scout.transit;
      const dest = systemById(state, st.path[st.path.length - 1]);
      sub.textContent = `→ ${dest?.name ?? '?'} · ${Math.ceil(scoutEtaMs(state, scout) / 1000)}s`;
    } else {
      const loc = systemById(state, scout.systemId)?.name ?? scout.systemId;
      sub.textContent = `@ ${loc}`;
    }
  }
}

function renderGroupedHullButtons(container, state) {
  clearChildren(container);
  const unlocked = new Set(empireQueueHulls(state));
  let anyVisible = false;

  for (const [catId, cat] of Object.entries(SHIP_HULL_CATEGORIES)) {
    const visibleHulls = cat.hulls.filter((h) => unlocked.has(h));
    if (visibleHulls.length === 0) continue;
    anyVisible = true;

    const section = document.createElement('div');
    section.className = 'queue-category';
    section.dataset.category = catId;
    section.dataset.categoryLabel = cat.label;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'queue-category__toggle';
    toggle.textContent = `▾ ${cat.label}`;
    section.appendChild(toggle);

    const btns = document.createElement('div');
    btns.className = 'queue-category__buttons';
    for (const hull of visibleHulls) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary btn--block';
      btn.dataset.queueHull = hull;
      const cost = HULL_STATS[hull]?.cost ?? 0;
      btn.textContent = `Queue ${hullLabel(hull)} (${cost} cr)`;
      btns.appendChild(btn);
    }
    section.appendChild(btns);
    container.appendChild(section);
  }

  return anyVisible;
}

function renderEmpireQueueList(state) {
  const list = el('empire-queue-list');
  if (!list) return;
  clearChildren(list);

  const queue = empireQueueSummary(state);
  if (queue.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No ships queued.';
    list.appendChild(empty);
    return;
  }

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
      pin.dataset.queuePin = item.id;
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
      row.appendChild(pin);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn--ghost btn--xs';
      cancel.dataset.queueCancel = item.id;
      cancel.textContent = 'Cancel';
      row.appendChild(cancel);
    }
    list.appendChild(row);
  }
}

function renderEmpireQueueActions(state) {
  const actions = el('empire-queue-actions');
  if (!actions) return;
  clearChildren(actions);

  if (listPlayerShipyards(state).length === 0) {
    const note = document.createElement('p');
    note.className = 'panel-note panel-note--muted';
    note.textContent = 'Build a shipyard to queue ships.';
    actions.appendChild(note);
    return;
  }

  renderGroupedHullButtons(actions, state);
}

function renderScoutRoster(state, selectedScoutId) {
  const roster = el('scout-roster');
  if (!roster) return;
  clearChildren(roster);

  for (const scout of state.scouts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.scoutId = scout.id;
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
    roster.appendChild(btn);
  }
}

function updateSelectedScoutLine(state, selectedScoutId) {
  const sel = selectedScoutId ? findScout(state, selectedScoutId) : null;
  const line = el('selected-scout-line');
  if (!line) return;
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
}

function updateScoutRosterLabels(state, selectedScoutId) {
  const roster = el('scout-roster');
  if (!roster) return;
  for (const btn of roster.querySelectorAll('.scout-select-btn')) {
    const scout = findScout(state, btn.dataset.scoutId);
    if (!scout) continue;
    btn.classList.toggle('list-row--selected', scout.id === selectedScoutId);
    const icon = btn.querySelector('.list-row__icon');
    if (icon) icon.style.background = scout.transit ? 'var(--accent-gold)' : 'var(--accent-cyan)';
    const sub = btn.querySelector('.list-row__sub');
    if (!sub) continue;
    if (scout.transit) {
      const st = scout.transit;
      const dest = systemById(state, st.path[st.path.length - 1]);
      sub.textContent = `→ ${dest?.name ?? '?'} · ${Math.ceil(scoutEtaMs(state, scout) / 1000)}s`;
    } else {
      const loc = systemById(state, scout.systemId)?.name ?? scout.systemId;
      sub.textContent = `@ ${loc}`;
    }
  }
  updateSelectedScoutLine(state, selectedScoutId);
}

function wireQueueCategoryToggle(container, e) {
  const toggle = e.target.closest('.queue-category__toggle');
  if (!toggle) return false;
  const section = toggle.closest('.queue-category');
  if (!section) return true;
  section.classList.toggle('queue-category--collapsed');
  const label = section.dataset.categoryLabel ?? '';
  toggle.textContent = section.classList.contains('queue-category--collapsed')
    ? `▸ ${label}`
    : `▾ ${label}`;
  return true;
}

function createFleetGroupIcon(selected = false) {
  const wrap = document.createElement('span');
  wrap.className = `fleet-group-icon${selected ? ' fleet-group-icon--selected' : ''}`;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <g fill="currentColor">
      <path opacity="0.7" d="M5.1 14.4 6.9 10.4 6 10 4.2 13.6z"/>
      <path opacity="0.7" d="M14.9 14.4 13.1 10.4 14 10 15.8 13.6z"/>
      <path d="M10 2.8 13.4 4.9 12.8 9.1 11.3 9.6 10.8 6.4 9.2 6.4 8.7 9.6 7.2 9.1 6.6 4.9z"/>
      <rect x="9.05" y="5.15" width="1.9" height="2.05" rx="0.25"/>
      <path fill="none" stroke="currentColor" stroke-width="0.55" opacity="0.35"
        d="M10 10.6v4.2M7.4 13.8l2.6-1.3 2.6 1.3"/>
    </g>
  </svg>`;
  return wrap;
}

function renderFleetShipRow(ship, galaxy, state) {
  const row = document.createElement('div');
  row.className = 'list-row fleet-ship-row';
  row.draggable = true;
  row.dataset.shipId = ship.id;

  const icon = document.createElement('span');
  icon.className = 'list-row__icon';
  icon.style.background = ship.transit ? 'var(--accent-gold)' : 'var(--accent-cyan)';

  const main = document.createElement('span');
  main.className = 'list-row__main';
  const title = document.createElement('div');
  title.className = 'list-row__title';
  title.textContent = `${ship.id} · ${ship.hull}`;
  const sub = document.createElement('div');
  sub.className = 'list-row__sub';

  if (ship.transit) {
    const destId = ship.transit.path[ship.transit.path.length - 1];
    const dest = systemById(state, destId);
    sub.textContent = `→ ${dest?.name ?? destId} · ${Math.ceil(playerShipEtaMs(state, ship) / 1000)}s`;
  } else {
    const loc = systemById(state, ship.systemId)?.name ?? ship.systemId ?? '—';
    sub.textContent = `@ ${loc} · HP ${Math.ceil(ship.hp)}/${ship.maxHp}`;
  }

  main.appendChild(title);
  main.appendChild(sub);
  row.appendChild(icon);
  row.appendChild(main);
  return row;
}

function renderStrategicBuildButtons(container, state, systemId, planetId) {
  if (!container) return;
  clearChildren(container);
  if (!isPlayerOwned(state, systemId)) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  const labels = {
    listening_post: 'Listening Post',
    lane_relay: 'Lane Relay',
    blockade_fort: 'Blockade Fort',
    forward_base: 'Forward Base',
    supply_cache: 'Supply Cache',
    command_post: 'Command Post',
  };
  for (const type of Object.keys(STRUCTURE_DEFS)) {
    const def = STRUCTURE_DEFS[type];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--block btn--sm';
    const pid = def.perBody ? planetId : null;
    const check = canBuildStrategicStructure(state, systemId, type, pid);
    btn.disabled = !check.ok;
    btn.textContent = `${labels[type] ?? type} (${def.cost} cr)`;
    btn.onclick = () => {
      const res = buildStrategicStructure(state, systemId, type, pid);
      if (res.ok) toast(`${labels[type] ?? type} built`, 'ok');
      else toast(res.reason, 'error');
    };
    container.appendChild(btn);
  }
}

function renderFleetPanel(container, state, ctx) {
  const {
    getSelectedScoutId,
    doSelectScout,
    getSelectedBattleGroupId,
    doSelectBattleGroup,
    createBattleGroup,
    deleteBattleGroup,
  } = ctx;
  clearChildren(container);
  const galaxy = getGraph(state);
  const selectedScoutId = getSelectedScoutId();
  const selectedBattleGroupId = getSelectedBattleGroupId?.() ?? null;

  const playerShips = (state.playerShips ?? []).filter((s) => s.galaxyId === state.activeGalaxyId && s.hp > 0);
  const scouts = state.scouts ?? [];
  const yards = listPlayerShipyards(state);
  const queue = empireQueueSummary(state);
  const battleGroups = battleGroupsForGalaxy(state);
  const unassigned = unassignedPlayerShips(state);

  const stats = document.createElement('div');
  stats.className = 'fleet-stats';
  const readyShips = playerShips.filter((s) => !s.transit).length;
  const transitShips = playerShips.filter((s) => s.transit).length;
  stats.innerHTML = `
    <span>Ships: <strong>${readyShips}</strong>${transitShips ? ` +${transitShips} transit` : ''}</span>
    <span>Fleets: <strong>${battleGroups.length}</strong></span>
    <span>Scouts: <strong>${scouts.length}</strong></span>
    <span>Shipyards: <strong>${yards.length}</strong></span>
    <span>Queue: <strong>${queue.filter((q) => q.status === 'pending').length}</strong></span>
  `;
  container.appendChild(stats);

  const groupsTitle = document.createElement('div');
  groupsTitle.className = 'intel-section-title fleet-section-header';
  groupsTitle.textContent = 'Battle Groups';
  container.appendChild(groupsTitle);

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'btn btn--ghost btn--sm fleet-create-btn';
  createBtn.dataset.fleetCreate = '1';
  createBtn.textContent = 'Create Fleet';
  container.appendChild(createBtn);

  if (battleGroups.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'panel-note panel-note--muted';
    empty.textContent = 'No battle groups — create a fleet and drag ships into it.';
    container.appendChild(empty);
  }

  for (const group of battleGroups) {
    const block = document.createElement('div');
    block.className = 'fleet-group-block';
    block.dataset.groupId = group.id;

    const header = document.createElement('button');
    header.type = 'button';
    const selected = group.id === selectedBattleGroupId;
    header.className = `list-row fleet-group-header${selected ? ' list-row--selected' : ''}`;
    header.dataset.fleetSelect = group.id;

    const icon = createFleetGroupIcon(selected);

    const main = document.createElement('span');
    main.className = 'list-row__main';
    const title = document.createElement('div');
    title.className = 'list-row__title';
    title.textContent = formatFleetName(group.ordinal);
    const sub = document.createElement('div');
    sub.className = 'list-row__sub';
    const shipCount = group.shipIds.length;
    sub.textContent = `${shipCount} ship${shipCount === 1 ? '' : 's'} · ${fleetLocationSummary(state, group.id)}`;
    main.appendChild(title);
    main.appendChild(sub);

    const del = document.createElement('span');
    del.className = 'fleet-group-delete';
    del.dataset.fleetDelete = group.id;
    del.title = 'Delete fleet';
    del.textContent = '×';
    del.setAttribute('role', 'button');
    del.setAttribute('aria-label', `Delete ${formatFleetName(group.ordinal)}`);

    header.appendChild(icon);
    header.appendChild(main);
    header.appendChild(del);
    block.appendChild(header);

    const drop = document.createElement('div');
    drop.className = 'fleet-drop-zone';
    drop.dataset.dropTarget = group.id;
    if (shipCount === 0) {
      const hint = document.createElement('p');
      hint.className = 'panel-note panel-note--muted fleet-drop-hint';
      hint.textContent = 'Drop ships here';
      drop.appendChild(hint);
    } else {
      const list = document.createElement('div');
      list.className = 'list fleet-ship-list';
      for (const shipId of group.shipIds) {
        const ship = playerShips.find((s) => s.id === shipId);
        if (ship) list.appendChild(renderFleetShipRow(ship, galaxy, state));
      }
      drop.appendChild(list);
    }
    block.appendChild(drop);

    const anchorRow = document.createElement('div');
    anchorRow.className = 'dev-row';
    anchorRow.style.marginTop = '6px';
    const anchorLabel = document.createElement('span');
    anchorLabel.className = 'panel-note';
    anchorLabel.textContent = 'Anchor to hero:';
    const anchorSel = document.createElement('select');
    anchorSel.className = 'btn btn--ghost btn--sm';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    anchorSel.appendChild(noneOpt);
    for (const hero of heroFlagshipsSummary(state)) {
      const opt = document.createElement('option');
      opt.value = hero.id;
      opt.textContent = `${hero.id} @ ${systemById(state, hero.systemId)?.name ?? hero.systemId}`;
      if (group.anchorHeroId === hero.id) opt.selected = true;
      anchorSel.appendChild(opt);
    }
    anchorSel.onchange = () => {
      const res = setBattleGroupHeroAnchor(state, group.id, anchorSel.value || null);
      if (!res.ok) toast(res.reason, 'error');
    };
    anchorRow.appendChild(anchorLabel);
    anchorRow.appendChild(anchorSel);
    block.appendChild(anchorRow);

    container.appendChild(block);
  }

  const heroes = heroFlagshipsSummary(state);
  if (heroes.length > 0) {
    const heroTitle = document.createElement('div');
    heroTitle.className = 'intel-section-title fleet-section-header';
    heroTitle.textContent = 'Hero Flagships';
    container.appendChild(heroTitle);
    for (const hero of heroes) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const main = document.createElement('span');
      main.className = 'list-row__main';
      main.innerHTML = `<div class="list-row__title">${hero.id}</div><div class="list-row__sub">${systemById(state, hero.systemId)?.name ?? hero.systemId} · HP ${Math.ceil(hero.hp)} · rally ${hero.rallyStarId ?? '—'}</div>`;
      row.appendChild(main);
      const rallySel = document.createElement('select');
      rallySel.className = 'btn btn--ghost btn--xs';
      const graph = getGraph(state);
      for (const star of graph.stars) {
        const opt = document.createElement('option');
        opt.value = star.id;
        opt.textContent = star.name;
        if (hero.rallyStarId === star.id) opt.selected = true;
        rallySel.appendChild(opt);
      }
      rallySel.onchange = () => {
        const res = setHeroRally(state, hero.id, rallySel.value);
        if (!res.ok) toast(res.reason, 'error');
      };
      row.appendChild(rallySel);
      container.appendChild(row);
    }
  }

  const fleetHint = document.createElement('p');
  fleetHint.className = 'panel-note panel-note--muted';
  fleetHint.style.marginTop = '8px';
  fleetHint.textContent = 'Alt+click a star on the galaxy map to dispatch the selected fleet. Shift+click still sends scouts.';
  container.appendChild(fleetHint);

  const unassignedTitle = document.createElement('div');
  unassignedTitle.className = 'intel-section-title';
  unassignedTitle.style.marginTop = '12px';
  unassignedTitle.textContent = 'Unassigned Ships';
  container.appendChild(unassignedTitle);

  const unassignedDrop = document.createElement('div');
  unassignedDrop.className = 'fleet-drop-zone fleet-drop-zone--unassigned';
  unassignedDrop.dataset.dropTarget = 'unassigned';

  if (unassigned.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'panel-note panel-note--muted';
    empty.textContent = playerShips.length === 0
      ? 'No ships deployed — queue hulls from the Empire Build Queue.'
      : 'All ships are assigned to battle groups.';
    unassignedDrop.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'list';
    for (const ship of unassigned) {
      list.appendChild(renderFleetShipRow(ship, galaxy, state));
    }
    unassignedDrop.appendChild(list);
  }
  container.appendChild(unassignedDrop);

  const scoutTitle = document.createElement('div');
  scoutTitle.className = 'intel-section-title';
  scoutTitle.style.marginTop = '12px';
  scoutTitle.textContent = 'Scouts';
  container.appendChild(scoutTitle);

  if (scouts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'panel-note panel-note--muted';
    empty.textContent = 'No scouts — build from a shipyard in an owned system.';
    container.appendChild(empty);
  } else {
    const roster = document.createElement('div');
    roster.className = 'list';
    for (const scout of scouts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const selected = scout.id === selectedScoutId;
      btn.className = `list-row scout-select-btn${selected ? ' list-row--selected' : ''}`;
      btn.dataset.scoutId = scout.id;

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
    container.appendChild(roster);

    const hint = document.createElement('p');
    hint.className = 'panel-note panel-note--muted';
    hint.style.marginTop = '8px';
    hint.textContent = 'Shift+click a star on the galaxy map to dispatch the selected scout.';
    container.appendChild(hint);
  }

  if (yards.length > 0) {
    const yardTitle = document.createElement('div');
    yardTitle.className = 'intel-section-title';
    yardTitle.style.marginTop = '12px';
    yardTitle.textContent = 'Shipyard Capacity';
    container.appendChild(yardTitle);

    for (const y of yards) {
      const row = document.createElement('div');
      row.className = 'status-row';
      const label = document.createElement('span');
      label.className = 'status-row__label';
      const sys = systemById(state, y.systemId);
      label.textContent = sys?.name ?? y.systemId;
      const val = document.createElement('span');
      val.className = 'status-indicator status-indicator--built';
      val.textContent = `${y.activeBuilds} / ${y.slots} slots`;
      row.appendChild(label);
      row.appendChild(val);
      container.appendChild(row);
    }
  }
}

function renderTechScreen(container, state, techUiState) {
  const summary = researchSummary(state);
  const snapshot = researchSnapshotKey(summary);

  let chrome = container.querySelector('.tech-screen__chrome');
  if (!chrome) {
    clearChildren(container);
    chrome = document.createElement('div');
    chrome.className = 'tech-screen__chrome';
    container.appendChild(chrome);

    const graphWrap = document.createElement('div');
    graphWrap.className = 'tech-screen__graph-wrap';
    graphWrap.id = 'tech-screen-graph-wrap';
    container.appendChild(graphWrap);

    techUiState.graphWrap = graphWrap;
    techUiState.detailEl = null;
    techUiState.fitView = null;
    techUiState.svg = null;
    techUiState.mounted = false;
    techUiState.lastSnapshot = '';
    techUiState.clusterFilter = null;
    techUiState.graphHandle = null;
  } else if (!techUiState.graphWrap) {
    techUiState.graphWrap = container.querySelector('#tech-screen-graph-wrap')
      ?? container.querySelector('.tech-screen__graph-wrap');
  }

  const savedDetail = techUiState.detailEl?.textContent ?? 'Hover a node for details';
  clearChildren(chrome);

  const stats = document.createElement('div');
  stats.className = 'tech-web-stats';
  stats.innerHTML = `
    <span>Stations: <strong>${summary.stationCount}</strong></span>
    <span>Speed: <strong>${summary.speedMult}×</strong></span>
    <span>Unlocked: <strong>${summary.unlocked.length - 1}</strong> / ${allTechNodes().length - 1}</span>
  `;
  chrome.appendChild(stats);

  if (summary.activeNodeId) {
    const node = techNode(summary.activeNodeId);
    const active = document.createElement('div');
    active.className = 'progress-block';
    active.innerHTML = `
      <div class="progress-block__label">${
        node
          ? `Researching: ${node.name} · Tier ${tierRoman(summary.activeNodeId)}`
          : `Researching: ${summary.activeNodeId}`
      }</div>
      <div class="progress"><div class="progress__fill" style="width:${Math.round(summary.progress * 100)}%"></div></div>
    `;
    chrome.appendChild(active);
  }

  if (summary.queue.length > 0) {
    const q = document.createElement('p');
    q.className = 'panel-note panel-note--muted';
    q.textContent = `Queued: ${summary.queue.map((id) => techNode(id)?.name ?? id).join(', ')}`;
    chrome.appendChild(q);
  }

  const legend = document.createElement('div');
  legend.className = 'tech-web-legend';
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `tech-web-legend__chip${!techUiState.clusterFilter ? ' tech-web-legend__chip--active' : ''}`;
  allChip.textContent = 'All';
  allChip.onclick = () => {
    techUiState.clusterFilter = null;
    techUiState.graphHandle?.setClusterFilter(null);
  };
  legend.appendChild(allChip);
  for (const [clusterId, meta] of Object.entries(TECH_CLUSTERS)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `tech-web-legend__chip${techUiState.clusterFilter === clusterId ? ' tech-web-legend__chip--active' : ''}`;
    chip.style.borderColor = meta.color;
    chip.style.color = meta.color;
    chip.textContent = meta.label;
    chip.onclick = () => {
      techUiState.clusterFilter = clusterId;
      techUiState.graphHandle?.setClusterFilter(clusterId);
    };
    legend.appendChild(chip);
  }
  chrome.appendChild(legend);

  const toolbar = document.createElement('div');
  toolbar.className = 'tech-screen__toolbar';
  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'btn btn--ghost btn--sm';
  fitBtn.textContent = 'Fit View';
  fitBtn.onclick = () => techUiState.fitView?.();
  toolbar.appendChild(fitBtn);
  chrome.appendChild(toolbar);

  if (!techUiState.detailEl) {
    techUiState.detailEl = document.createElement('div');
    techUiState.detailEl.className = 'tech-screen__detail';
  }
  techUiState.detailEl.textContent = savedDetail;
  chrome.appendChild(techUiState.detailEl);

  const hint = document.createElement('p');
  hint.className = 'tech-screen__hint';
  hint.textContent = 'Drag to pan · Scroll to zoom · Click available nodes to research';
  chrome.appendChild(hint);

  const onResearch = (nodeId) => {
    const res = startResearch(state, nodeId);
    if (!res.ok) toast(res.reason, 'error');
    else toast(`Started ${techNode(nodeId)?.name ?? nodeId}`, 'ok');
  };

  const onHoverNode = (nodeId) => {
    if (!techUiState.detailEl) return;
    if (!nodeId) {
      techUiState.detailEl.textContent = 'Hover a node for details';
      return;
    }
    const node = techNode(nodeId);
    if (!node) return;
    const prereqNames = node.prereqs.map((p) => techNode(p)?.name ?? p).join(', ') || 'None';
    techUiState.detailEl.textContent =
      `${node.name} · ${costLabelFromNode(node)} · Requires: ${prereqNames}`;
  };

  if (!techUiState.mounted) {
    techUiState.graphWrap.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'tech-web-mount';
    techUiState.graphWrap.appendChild(mount);
    const handle = mountTechWebGraph(mount, state, {
      summary,
      clusterFilter: techUiState.clusterFilter,
      onResearch,
      onHoverNode,
    });
    techUiState.svg = handle.svg;
    techUiState.fitView = handle.fitView;
    techUiState.graphHandle = handle;
    techUiState.mounted = true;
    techUiState.lastSnapshot = snapshot;
  } else if (techUiState.lastSnapshot !== snapshot && techUiState.svg) {
    techUiState.graphHandle?.refresh(state, summary);
    techUiState.lastSnapshot = snapshot;
  }
}

function costLabelFromNode(node) {
  const parts = [];
  if (node.creditCost) parts.push(`${node.creditCost} cr`);
  if (node.solariiCost) parts.push(`${node.solariiCost} SO`);
  return parts.length ? parts.join(' + ') : 'Free';
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
    getSelectedBattleGroupId,
    doSelectBattleGroup,
    createBattleGroup,
    deleteBattleGroup,
    assignShipToGroup,
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
    getGalaxyTargetStar,
    doStartNewGame,
    getBootPhase,
    setBootPhase,
  } = ctx;

  let sidePanel = null;
  const techUiState = { mounted: false, lastSnapshot: '', svg: null, fitView: null, graphWrap: null, detailEl: null };

  function resetTechUiState() {
    techUiState.mounted = false;
    techUiState.lastSnapshot = '';
    techUiState.svg = null;
    techUiState.fitView = null;
    techUiState.graphWrap = null;
    techUiState.detailEl = null;
    const body = el('tech-screen-body');
    if (body) clearChildren(body);
  }

  function closeSidePanel() {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = null;
  }

  let hullBtnContainer = el('combat-hull-buttons');
  if (!hullBtnContainer) {
    hullBtnContainer = document.createElement('div');
    hullBtnContainer.id = 'combat-hull-buttons';
    hullBtnContainer.className = 'panel__actions';
    el('queue-scout-btn').after(hullBtnContainer);
  }

  const uiSnapshots = {
    empireQueueList: '',
    empireQueueActions: '',
    scoutRoster: '',
    buildHullActions: '',
    fleetPanel: '',
  };

  function queueHullFromUi(hull) {
    const res = enqueueHull(getState(), hull);
    if (!res.ok) toast(res.reason, 'error');
    else toast(`Queued ${hull}`, 'ok');
  }

  function wireInteractivePanels() {
    const onQueueMouseDown = (e) => {
      if (e.button !== 0) return;
      if (wireQueueCategoryToggle(e.currentTarget, e)) return;
      const btn = e.target.closest('[data-queue-hull]');
      if (!btn) return;
      e.preventDefault();
      queueHullFromUi(btn.dataset.queueHull);
    };

    el('empire-queue-actions')?.addEventListener('mousedown', onQueueMouseDown);
    hullBtnContainer.addEventListener('mousedown', onQueueMouseDown);

    el('empire-queue-list')?.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-queue-pin]');
      if (!sel) return;
      const res = pinQueueItem(getState(), sel.dataset.queuePin, sel.value || null);
      if (!res.ok) toast(res.reason, 'error');
    });
    el('empire-queue-list')?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest('[data-queue-cancel]');
      if (!btn) return;
      e.preventDefault();
      const res = cancelQueueItem(getState(), btn.dataset.queueCancel);
      if (!res.ok) toast(res.reason, 'error');
    });

    el('scout-roster')?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const btn = e.target.closest('.scout-select-btn');
      if (!btn?.dataset.scoutId) return;
      e.preventDefault();
      doSelectScout(btn.dataset.scoutId);
    });

    let fleetDragShipId = null;
    let fleetDidDrag = false;
    const fleetPanelBody = el('fleet-panel-body');

    fleetPanelBody?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (fleetDidDrag) {
        fleetDidDrag = false;
        return;
      }
      const createTarget = e.target.closest('[data-fleet-create]');
      if (createTarget) {
        e.preventDefault();
        const group = createBattleGroup();
        doSelectBattleGroup(group.id);
        return;
      }
      const deleteTarget = e.target.closest('[data-fleet-delete]');
      if (deleteTarget?.dataset.fleetDelete) {
        e.preventDefault();
        e.stopPropagation();
        deleteBattleGroup(deleteTarget.dataset.fleetDelete);
        return;
      }
      const selectTarget = e.target.closest('[data-fleet-select]');
      if (selectTarget?.dataset.fleetSelect) {
        e.preventDefault();
        doSelectBattleGroup(selectTarget.dataset.fleetSelect);
      }
    });

    fleetPanelBody?.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.fleet-ship-row');
      if (!row?.dataset.shipId) return;
      fleetDragShipId = row.dataset.shipId;
      fleetDidDrag = false;
      row.classList.add('list-row--dragging');
      e.dataTransfer.setData('text/plain', fleetDragShipId);
      e.dataTransfer.effectAllowed = 'move';
    });

    fleetPanelBody?.addEventListener('dragend', (e) => {
      e.target.closest('.fleet-ship-row')?.classList.remove('list-row--dragging');
      fleetPanelBody.querySelectorAll('.fleet-drop-zone--active').forEach((el) => {
        el.classList.remove('fleet-drop-zone--active');
      });
      fleetDragShipId = null;
    });

    fleetPanelBody?.addEventListener('dragover', (e) => {
      const zone = e.target.closest('.fleet-drop-zone');
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('fleet-drop-zone--active');
    });

    fleetPanelBody?.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('.fleet-drop-zone');
      if (zone && !zone.contains(e.relatedTarget)) {
        zone.classList.remove('fleet-drop-zone--active');
      }
    });

    fleetPanelBody?.addEventListener('drop', (e) => {
      const zone = e.target.closest('.fleet-drop-zone');
      if (!zone) return;
      e.preventDefault();
      fleetDidDrag = true;
      zone.classList.remove('fleet-drop-zone--active');
      const shipId = e.dataTransfer.getData('text/plain') || fleetDragShipId;
      if (!shipId) return;
      const target = zone.dataset.dropTarget;
      const groupId = target === 'unassigned' ? null : target;
      const res = assignShipToGroup(shipId, groupId);
      if (!res.ok) toast(res.reason, 'error');
    });
  }

  wireInteractivePanels();

  el('pause-btn').addEventListener('click', doTogglePause);
  el('view-toggle-btn').addEventListener('click', doToggleView);
  el('tab-galaxy').addEventListener('click', () => {
    closeSidePanel();
    if (getView() !== 'galaxy') doToggleView();
  });
  el('tab-system').addEventListener('click', () => {
    closeSidePanel();
    if (getView() !== 'system') doToggleView();
  });
  el('tab-dyson').addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = 'dyson';
    if (getView() !== 'system') doToggleView();
  });
  el('tab-tech').addEventListener('click', () => {
    if (sidePanel === 'tech') {
      closeSidePanel();
    } else {
      sidePanel = 'tech';
    }
  });
  el('tab-fleet')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'fleet' ? null : 'fleet';
  });
  el('tab-diplomacy')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'diplomacy' ? null : 'diplomacy';
  });
  el('tab-campaign')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'campaign' ? null : 'campaign';
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

  el('sw-create-btn')?.addEventListener('click', () => {
    const st = getState();
    const anchor = getGalaxyTargetStar?.() ?? st.stronghold;
    const res = superweaponCreate(st, anchor);
    toast(res.ok ? 'Star created' : res.reason, res.ok ? 'ok' : 'error');
  });
  el('sw-destroy-btn')?.addEventListener('click', () => {
    const target = getGalaxyTargetStar?.();
    if (!target) { toast('Click a target star on the map', 'error'); return; }
    const res = superweaponDestroy(getState(), target);
    toast(res.ok ? 'System destroyed' : res.reason, res.ok ? 'ok' : 'error');
  });
  el('sw-jump-btn')?.addEventListener('click', () => {
    const target = getGalaxyTargetStar?.();
    if (!target) { toast('Click a target star on the map', 'error'); return; }
    const res = superweaponJump(getState(), target);
    toast(res.ok ? 'Jump complete' : res.reason, res.ok ? 'ok' : 'error');
  });
  el('clear-trade-routes-btn')?.addEventListener('click', () => {
    const res = clearTradeRoutes(getState());
    toast(`Cleared ${res.cleared ?? 0} routes`, 'ok');
  });

  const newGameModal = el('new-game-modal');
  const newGameBackdrop = el('new-game-modal-backdrop');
  const titleScreen = el('title-screen');

  function openNewGameModal() {
    titleScreen?.classList.add('hidden');
    newGameModal?.classList.remove('hidden');
    newGameBackdrop?.classList.remove('hidden');
  }
  function closeNewGameModal() {
    newGameModal?.classList.add('hidden');
    newGameBackdrop?.classList.add('hidden');
    if (getBootPhase?.() === 'title') titleScreen?.classList.remove('hidden');
  }
  function showTitleScreen() {
    titleScreen?.classList.remove('hidden');
    setBootPhase?.('title');
    getState().paused = true;
  }

  el('title-new-campaign-btn')?.addEventListener('click', openNewGameModal);
  el('title-continue-btn')?.addEventListener('click', async () => {
    titleScreen?.classList.add('hidden');
    setBootPhase?.('playing');
    getState().paused = false;
    await doLoadSlot('autosave');
  });
  el('title-load-btn')?.addEventListener('click', () => {
    titleScreen?.classList.add('hidden');
    openSaveMenu();
  });

  readSlot('autosave').then((res) => {
    const btn = el('title-continue-btn');
    if (res.ok) btn?.classList.remove('hidden');
    else btn?.classList.add('hidden');
  });

  showTitleScreen();
  el('close-new-game-btn')?.addEventListener('click', closeNewGameModal);
  newGameBackdrop?.addEventListener('click', closeNewGameModal);
  el('new-game-sandbox-btn')?.addEventListener('click', () => {
    const vt = el('new-game-victory')?.value ?? 'sandbox';
    doStartNewGame?.({ mode: 'sandbox', victoryType: vt });
    closeNewGameModal();
  });
  el('new-game-tutorial-btn')?.addEventListener('click', () => {
    doStartNewGame?.({ mode: 'tutorial', victoryType: 'sandbox' });
    closeNewGameModal();
  });
  el('new-game-missions-btn')?.addEventListener('click', () => {
    doStartNewGame?.({ mode: 'mission', victoryType: 'dominion' });
    closeNewGameModal();
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
    if (getBootPhase?.() === 'title') titleScreen?.classList.remove('hidden');
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

  function updateUi() {
    const phase = getBootPhase?.() ?? 'playing';
    el('hud')?.classList.toggle('hud--boot', phase !== 'playing');

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

    const listSnap = empireQueueListSnapshot(state);
    if (listSnap !== uiSnapshots.empireQueueList) {
      uiSnapshots.empireQueueList = listSnap;
      renderEmpireQueueList(state);
    }

    const actionsSnap = empireQueueActionsSnapshot(state);
    if (actionsSnap !== uiSnapshots.empireQueueActions) {
      uiSnapshots.empireQueueActions = actionsSnap;
      renderEmpireQueueActions(state);
    }

    const techScreen = el('tech-screen');
    const diploScreen = el('diplomacy-screen');
    const campScreen = el('campaign-screen');
    el('tech-panel')?.classList.add('hidden');
    if (sidePanel === 'tech') {
      techScreen?.classList.remove('hidden');
      renderTechScreen(el('tech-screen-body'), state, techUiState);
    } else {
      techScreen?.classList.add('hidden');
    }
    if (sidePanel === 'diplomacy') {
      diploScreen?.classList.remove('hidden');
      renderDiplomacyPanel(el('diplomacy-screen-body'), state);
    } else {
      diploScreen?.classList.add('hidden');
    }
    if (sidePanel === 'campaign') {
      campScreen?.classList.remove('hidden');
      renderCampaignPanel(el('campaign-screen-body'), state);
    } else {
      campScreen?.classList.add('hidden');
    }

    const fleetPanel = el('fleet-panel');
    if (sidePanel === 'fleet') {
      fleetPanel?.classList.remove('hidden');
      const fleetSnap = fleetPanelStructureSnapshot(state, getSelectedBattleGroupId?.() ?? null, selectedScoutId);
      if (fleetSnap !== uiSnapshots.fleetPanel) {
        uiSnapshots.fleetPanel = fleetSnap;
        renderFleetPanel(el('fleet-panel-body'), state, {
          getSelectedScoutId,
          doSelectScout,
          getSelectedBattleGroupId,
          doSelectBattleGroup,
          createBattleGroup,
          deleteBattleGroup,
        });
      } else {
        updateFleetPanelLabels(state, selectedScoutId, getSelectedBattleGroupId?.() ?? null);
      }
    } else {
      fleetPanel?.classList.add('hidden');
      uiSnapshots.fleetPanel = '';
    }

    el('pause-btn').querySelector('.btn-label').textContent = state.paused ? 'Resume' : 'Pause';
    el('pause-overlay').classList.toggle('hidden', !state.paused || phase !== 'playing');
    el('view-toggle-btn').querySelector('.btn-label').textContent =
      view === 'galaxy' ? 'System View (M)' : 'Galaxy Map (M)';
    el('view-hint').textContent = HINTS[view];
    updateTabBar(view, sidePanel);

    const swGalaxyPanel = el('superweapon-galaxy-panel');
    const tradeRoutesPanel = el('trade-routes-panel');
    const ms = milestonesSummary(state);
    if (view === 'galaxy' && ms.superweaponUnlocked) {
      swGalaxyPanel?.classList.remove('hidden');
      const sw = superweaponSummary(state);
      const targetId = getGalaxyTargetStar?.() ?? null;
      const targetName = targetId ? (systemById(state, targetId)?.name ?? targetId) : '—';
      el('superweapon-galaxy-body').innerHTML =
        `<p class="panel-note">Target: <strong>${targetName}</strong></p>`
        + `<p class="panel-note">Online: ${sw.online ? 'yes' : 'no'} · CD ${Math.ceil(sw.cooldownMs / 1000)}s</p>`;
    } else {
      swGalaxyPanel?.classList.add('hidden');
    }
    if (view === 'galaxy' && ms.diplomacyUnlocked) {
      tradeRoutesPanel?.classList.remove('hidden');
      const tr = tradeRoutesSummary(state);
      el('trade-routes-body').innerHTML =
        `<p class="panel-note">${tr.count}/${tr.max} routes · bonus ×${tr.bonus?.toFixed?.(2) ?? tr.bonus}</p>`
        + (tr.routes?.map((r) => `<div class="intel-row">${r.from} ↔ ${r.to}</div>`).join('') ?? '');
    } else {
      tradeRoutesPanel?.classList.add('hidden');
    }

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
    if (state.scouts.length > 0 && sidePanel !== 'fleet') {
      scoutPanel.classList.remove('hidden');
      const rosterSnap = scoutRosterStructureSnapshot(state, selectedScoutId);
      if (rosterSnap !== uiSnapshots.scoutRoster) {
        uiSnapshots.scoutRoster = rosterSnap;
        renderScoutRoster(state, selectedScoutId);
        updateSelectedScoutLine(state, selectedScoutId);
      } else {
        updateScoutRosterLabels(state, selectedScoutId);
      }
    } else {
      scoutPanel.classList.add('hidden');
      uiSnapshots.scoutRoster = '';
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

    if (view !== 'system' || sidePanel === 'dyson' || sidePanel === 'tech' || sidePanel === 'fleet' || !selection) {
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
    const hasYards = listPlayerShipyards(state).length > 0;
    const showQueueBtns = isPlayerOwned(state, viewedSystemId) && hasYards;
    const scoutBtn = el('queue-scout-btn');
    scoutBtn.classList.toggle('hidden', !showQueueBtns);
    scoutBtn.disabled = false;
    scoutBtn.textContent = `Add Scout to Empire Queue (${SCOUT_HULL_COST} cr)`;

    hullBtnContainer.classList.toggle('hidden', !showQueueBtns);
    if (showQueueBtns) {
      const hullSnap = empireQueueActionsSnapshot(state);
      if (hullSnap !== uiSnapshots.buildHullActions) {
        uiSnapshots.buildHullActions = hullSnap;
        renderGroupedHullButtons(hullBtnContainer, state);
      }
    } else {
      uiSnapshots.buildHullActions = '';
      clearChildren(hullBtnContainer);
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
    renderStrategicBuildButtons(el('strategic-build-btns'), state, viewedSystemId, planet.id);
    el('build-panel-note').textContent = note;
  };

  return { updateUi, closeSidePanel };
}
