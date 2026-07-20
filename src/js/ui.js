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
  HELIOCLAST_ID,
  HELIOCLAST_SHIPYARD_COST,
  HELIOCLAST_SHIPYARD_SOLARII,
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
  activeJobsInSystem,
  droneSummaryForSystem,
  jobEtaMs,
  jobProgress,
} from './drones.js';
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
import {
  diplomacyPanelSnapshot,
  renderDiplomacyCommandScreen,
} from './diplomacy-ui.js';
import { campaignSummary } from './campaign.js';
import { listMissions, startMission } from './missions.js';
import {
  acknowledgeTutorialStep,
  finishTutorial,
  getTutorialState,
  initTutorial,
  markTutorialLogisticsOpened,
  markTutorialSystemViewed,
} from './tutorial.js';
import {
  currentProfile,
  hasSeenBriefing,
  loadProfile,
  markBriefingSeen,
  tutorialGraduated,
} from './profile.js';
import {
  FIELD_MANUAL_ENTRIES,
  fieldManualEntry,
  newlyUnlockedBriefings,
} from './field-manual.js';
import { milestonesSummary } from './milestones.js';
import {
  installSuperweaponPart,
  superweaponCreate,
  superweaponDestroy,
  superweaponJump,
  superweaponSummary,
  setHelioclastFleetMode,
  isHelioclastMobile,
  getHelioclastShip,
  buildHelioclastShipyard,
  canBuildHelioclastShipyard,
  canSuperweaponAction,
  takeSuperweaponResolveNotify,
  hasHelioclastShipyard,
  canMarkLiveFire,
  markLiveFireComplete,
} from './superweapon.js';
import {
  buildHeroFlagship,
  heroFlagshipsSummary,
  setHeroRally,
} from './hero-flagships.js';
import {
  canBuildStrategicStructure,
  buildStrategicStructure,
  STRUCTURE_DEFS,
} from './strategic-structures.js';
import {
  BODY_STRUCTURE_DEFS,
  bodyStructureBuildRows,
  starNodeStructureBuildRows,
  buildBodyStructure,
  bodyStructuresSummary,
  bodyStructureDef,
  structureUpgradeDef,
  structureIconGlyph,
  canUpgradeBodyStructure,
  upgradeBodyStructure,
} from './body-structures.js';
import { allTechNodes, derivedTier, techNode } from './tech-web.js';
import { empireQueueHulls } from './tech-web.js';
import { hullDisplayName, flagshipHullStage } from './hull.js';
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
  setBattleGroupFlagshipAnchor,
  autoAssignShipsToFleets,
} from './battle-groups.js';
import { getGraph } from './galaxy-scope.js';
import { getBattleState } from './combat.js';
import {
  activeConvoys,
  cargoTotal,
  convoyEtaMs,
  depotSummary,
  discoverTradeNexuses,
  dispatchDepot,
  logisticsSummary,
  pauseDepotRoute,
  rerouteConvoy,
  resumeDepotRoute,
  setConvoyEscort,
  setDepotDestination,
} from './logistics.js';
import {
  activeFleetOrders,
  FORMATION_TYPES,
  TARGET_CLASSES,
} from './combat-orders.js';
import {
  COMBAT_DOCTRINES,
  DOCTRINE_LABELS,
  normalizeDoctrine,
} from './combat-doctrine.js';
import {
  operationsPanelSnapshot,
  renderOperationsPanel,
} from './operations-ui.js';
import { stellarCatalogInfo } from './star-types.js';

const CONSTRUCTION_AFFORDABILITY_THRESHOLDS = Object.freeze([
  ...new Set([
    OUTPOST_COST,
    SHIPYARD_COST,
    FOUNDRY_COST,
    LAUNCHER_COST,
    TRADE_STATION_COST,
    RESEARCH_STATION_COST,
    ...Object.values(BODY_STRUCTURE_DEFS).map((def) => def.cost),
    ...Object.values(STRUCTURE_DEFS).map((def) => def.cost),
  ]),
]);

const el = (id) => document.getElementById(id);

function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

const HINTS = {
  system: 'WASD / arrows: fly flagship · O: orbit star/planet/moon · F: follow · drag: pan · M: galaxy map',
  galaxy: 'Click star: travel · Fleet tab: select builder, then Shift+click · Ctrl/Cmd+click: quick drone deploy · Tab+click: fleet · Shift+click: scout · double-click: view · M: system',
};

const PLANET_DOT = {
  habitable: 'planet-dot--habitable',
  barren: 'planet-dot--barren',
  gas: 'planet-dot--gas',
};

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Unified Helioclast fire target: map selection → viewed system → optional Stronghold. */
function getHelioclastFireTarget(ctx, state, { allowStrongholdFallback = false } = {}) {
  const map = ctx?.getGalaxyTargetStar?.() ?? null;
  if (map && systemById(state, map)) return map;
  const viewed = ctx?.getViewedSystemId?.() ?? null;
  if (viewed) return viewed;
  if (allowStrongholdFallback) return state.stronghold;
  return null;
}

function formatSwResolveToast(note) {
  if (!note) return null;
  if (!note.ok) {
    return {
      msg: note.reason
        ?? (note.blocked ? `${note.type} blocked` : `${note.type} failed`),
      kind: 'error',
    };
  }
  if (note.type === 'create') return { msg: 'Star created', kind: 'ok' };
  if (note.type === 'destroy') return { msg: 'System destroyed', kind: 'ok' };
  if (note.type === 'jump') return { msg: 'Helioclast jumped', kind: 'ok' };
  return { msg: 'Helioclast action complete', kind: 'ok' };
}

const SW_ACTION_COPY = {
  create: { ready: 'Create beside the selected anchor' },
  destroy: { ready: 'Erase the selected hostile system' },
  jump: { ready: 'Relocate to the selected star' },
};

function updateSuperweaponActionButton(type, check, cost, sequence) {
  const button = el(`sw-${type}-btn`);
  if (!button) return;
  const active = sequence?.type === type;
  const detail = active
    ? `${String(sequence.phase ?? 'charging').replaceAll('_', ' ')} · ${Math.round((sequence.totalProgress ?? 0) * 100)}%`
    : check.ok ? SW_ACTION_COPY[type].ready : (check.reason ?? 'Unavailable');
  button.disabled = !check.ok;
  button.classList.toggle('is-firing', active);
  button.title = detail;
  button.setAttribute('aria-label', `${type} mode, ${cost} Solarii. ${detail}`);
  const detailEl = button.querySelector('.sw-action__detail');
  const costEl = button.querySelector('.sw-action__cost');
  if (detailEl) detailEl.textContent = detail;
  if (costEl) costEl.textContent = active ? 'LIVE' : `${cost} ◈`;
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

function formatStellarProperty(key, value) {
  const labels = {
    massSolar: 'Mass', totalMassSolar: 'Total mass', compactMassSolar: 'Compact mass',
    companionMassSolar: 'Companion mass', temperatureK: 'Temperature',
    componentTemperatureK: 'Component temperature', accretionTemperatureK: 'Disc temperature',
    luminositySolar: 'Luminosity', radiusKm: 'Radius', spinPeriodMs: 'Spin period',
    magneticFieldGauss: 'Magnetic field', lifetime: 'Lifetime', solariiMultiplier: 'Dyson output',
  };
  const suffix = key.includes('MassSolar') || key === 'massSolar' || key === 'totalMassSolar' ? ' M☉'
    : key.includes('TemperatureK') || key === 'temperatureK' ? ' K'
      : key === 'luminositySolar' ? ' L☉'
        : key === 'radiusKm' ? ' km'
          : key === 'spinPeriodMs' ? ' ms'
            : key === 'magneticFieldGauss' ? ' gauss'
              : key === 'solariiMultiplier' ? '×' : '';
  const display = typeof value === 'number'
    ? value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 3 : 0 })
    : value;
  return `${labels[key] ?? key}: ${display}${suffix}`;
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

  const environment = document.createElement('p');
  environment.className = 'panel-note panel-note--muted';
  environment.textContent = `Environment: ${(sys.environment ?? 'clear').replaceAll('_', ' ')}`;
  container.appendChild(environment);

  const stellarInfo = stellarCatalogInfo(sys.star);
  if (stellarInfo) {
    const stellarClass = document.createElement('p');
    stellarClass.className = 'panel-note panel-note--muted';
    stellarClass.innerHTML = `<strong>Stellar class:</strong> ${stellarInfo.displayName}`;
    container.appendChild(stellarClass);
    const stellarDescription = document.createElement('p');
    stellarDescription.className = 'panel-note panel-note--muted';
    stellarDescription.textContent = stellarInfo.description;
    container.appendChild(stellarDescription);
    const physical = document.createElement('p');
    physical.className = 'panel-note panel-note--muted';
    physical.textContent = Object.entries(stellarInfo.properties ?? {})
      .map(([key, value]) => formatStellarProperty(key, value))
      .join(' · ');
    container.appendChild(physical);
  }

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
      const body = s.bodyId ? sys.bodies.find((candidate) => candidate.id === s.bodyId) : null;
      label.textContent = body ? `at ${body.name}` : 'system orbital';
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
  const bodySummary = bodyStructuresSummary(state, systemId);

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
    { label: 'Surface', value: String(bodySummary.byPlacement.surface) },
    { label: 'Orbital', value: String(bodySummary.byPlacement.orbital) },
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
  el('tab-logistics')?.classList.toggle('tab--active', sidePanel === 'logistics');
  el('tab-diplomacy')?.classList.toggle('tab--active', sidePanel === 'diplomacy');
  el('tab-operations')?.classList.toggle('tab--active', sidePanel === 'operations');
  el('tab-campaign')?.classList.toggle('tab--active', sidePanel === 'campaign');
}

function formatEta(ms) {
  if (ms == null) return 'Paused';
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function appendMetric(container, label, value) {
  const cell = document.createElement('div');
  cell.className = 'metric-cell';
  const labelNode = document.createElement('span');
  labelNode.className = 'metric-cell__label';
  labelNode.textContent = label;
  const valueNode = document.createElement('span');
  valueNode.className = 'metric-cell__value';
  valueNode.textContent = value;
  cell.append(labelNode, valueNode);
  container.appendChild(cell);
}

function renderLogisticsPanel(container, state, { onFollowConvoy } = {}) {
  clearChildren(container);
  const summary = logisticsSummary(state);
  const metrics = document.createElement('div');
  metrics.className = 'metric-grid';
  appendMetric(metrics, 'Outposts', `${incomePerSecond(state).toFixed(1)} cr/s`);
  appendMetric(metrics, 'Throughput', `${summary.throughputCreditsPerMinute.toFixed(1)} cr/min`);
  appendMetric(metrics, 'Projected total', `${(incomePerSecond(state) + summary.throughputCreditsPerMinute / 60).toFixed(1)} cr/s`);
  appendMetric(metrics, 'In transit', `${cargoTotal(summary.cargoInTransit).toFixed(1)} cargo`);
  appendMetric(metrics, 'Trade Nexuses', `${summary.availableNexusCount}/${summary.nexusCount}`);
  appendMetric(metrics, 'Blockades', String(summary.laneBlockadeCount + summary.systemBlockadeCount));
  container.appendChild(metrics);

  const nexuses = discoverTradeNexuses(state);
  const depots = Object.values(state.logistics?.depots ?? {})
    .filter((depot) => depot.galaxyId === state.activeGalaxyId)
    .sort((a, b) => a.systemId.localeCompare(b.systemId));
  if (!depots.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Build an outpost to establish its system export depot.';
    container.appendChild(empty);
  }

  for (const depot of depots) {
    const data = depotSummary(state, depot.id);
    const card = document.createElement('article');
    card.className = 'logistics-card';
    const title = document.createElement('strong');
    title.textContent = `${systemById(state, depot.systemId)?.name ?? depot.systemId} Export Depot`;
    const status = document.createElement('p');
    status.className = 'panel-note';
    status.textContent = `${data.storedCargo.toFixed(1)}/${data.capacity} cargo · ${data.activeConvoys} active convoy${data.activeConvoys === 1 ? '' : 's'}${data.routePaused ? ` · paused (${data.pauseReason ?? 'manual'})` : ''}`;
    card.append(title, status);

    const destinationLabel = document.createElement('label');
    destinationLabel.className = 'field-label';
    destinationLabel.textContent = 'Destination';
    const destination = document.createElement('select');
    destination.className = 'command-input';
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = 'Automatic shortest valid route';
    destination.appendChild(automatic);
    for (const nexus of nexuses) {
      const option = document.createElement('option');
      option.value = nexus.systemId;
      option.textContent = `${nexus.name}${nexus.available ? '' : ' — unavailable'}`;
      option.disabled = !nexus.available;
      option.selected = depot.preferredNexusId === nexus.systemId;
      destination.appendChild(option);
    }
    destination.onchange = () => {
      const result = setDepotDestination(state, depot.id, destination.value || null);
      toast(result.ok ? 'Logistics destination updated' : result.reason, result.ok ? 'ok' : 'error');
    };
    card.append(destinationLabel, destination);

    const actions = document.createElement('div');
    actions.className = 'panel__actions';
    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'btn btn--ghost btn--xs';
    pause.textContent = depot.routePaused ? 'Resume route' : 'Pause route';
    pause.onclick = () => {
      const wasPaused = depot.routePaused;
      const result = wasPaused ? resumeDepotRoute(state, depot.id) : pauseDepotRoute(state, depot.id);
      toast(result.ok ? (wasPaused ? 'Route resumed' : 'Route paused') : result.reason, result.ok ? 'ok' : 'error');
    };
    const dispatch = document.createElement('button');
    dispatch.type = 'button';
    dispatch.className = 'btn btn--ghost btn--xs';
    dispatch.textContent = 'Dispatch now';
    dispatch.onclick = () => {
      const result = dispatchDepot(state, depot.id);
      toast(result.ok ? `${result.convoy.id} jumping to Trade Nexus` : result.reason, result.ok ? 'ok' : 'error');
    };
    actions.append(pause, dispatch);
    card.appendChild(actions);
    container.appendChild(card);
  }

  for (const convoy of activeConvoys(state)) {
    const card = document.createElement('article');
    card.className = 'logistics-card';
    const title = document.createElement('strong');
    title.textContent = convoy.id.toUpperCase();
    const eta = convoyEtaMs(state, convoy);
    const status = document.createElement('p');
    status.className = 'panel-note';
    status.textContent = `${convoy.status.replaceAll('_', ' ')} · ETA ${formatEta(eta)} · ${cargoTotal(convoy.manifest).toFixed(1)} cargo · escort ${convoy.escortStrength ?? 0}`;
    const danger = document.createElement('p');
    danger.className = 'panel-note panel-note--muted';
    danger.textContent = convoy.pauseReason
      ? `Risk: ${convoy.pauseReason}`
      : `Route: ${(convoy.path ?? []).map((id) => systemById(state, id)?.name ?? id).join(' → ')}`;
    const actions = document.createElement('div');
    actions.className = 'panel__actions';
    const followButton = document.createElement('button');
    followButton.type = 'button';
    followButton.className = 'btn btn--ghost btn--xs';
    followButton.textContent = 'Follow';
    followButton.onclick = () => onFollowConvoy?.(convoy.id);
    const reroute = document.createElement('button');
    reroute.type = 'button';
    reroute.className = 'btn btn--ghost btn--xs';
    reroute.textContent = 'Reroute';
    reroute.onclick = () => {
      const result = rerouteConvoy(state, convoy.id);
      toast(result.ok ? 'Convoy rerouted over shortest valid lanes' : result.reason, result.ok ? 'ok' : 'error');
    };
    const escort = document.createElement('button');
    escort.type = 'button';
    escort.className = 'btn btn--ghost btn--xs';
    escort.textContent = '+ Escort';
    escort.onclick = () => {
      const result = setConvoyEscort(state, convoy.id, (convoy.escortStrength ?? 0) + 25);
      toast(result.ok ? 'Escort strength assigned' : result.reason, result.ok ? 'ok' : 'error');
    };
    actions.append(followButton, reroute, escort);
    card.append(title, status, danger, actions);
    container.appendChild(card);
  }
}

function renderCombatCommandPanel(container, state, battle, issueTacticalOrder) {
  clearChildren(container);
  const alive = battle.units.filter((unit) => unit.side === 'player' && unit.hp > 0);
  const enemy = battle.units.filter((unit) => unit.side !== 'player' && unit.hp > 0);
  const metrics = document.createElement('div');
  metrics.className = 'metric-grid';
  appendMetric(metrics, 'Friendly', String(alive.length));
  appendMetric(metrics, 'Hostile', String(enemy.length));
  appendMetric(metrics, 'Mode', battle.mode ?? 'tactical');
  appendMetric(metrics, 'Elapsed', formatEta(battle.elapsedMs ?? 0));
  container.appendChild(metrics);

  const formationLabel = document.createElement('label');
  formationLabel.className = 'field-label';
  formationLabel.textContent = 'Formation';
  const formation = document.createElement('select');
  formation.className = 'command-input';
  for (const value of FORMATION_TYPES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    formation.appendChild(option);
  }
  formation.onchange = () => issueTacticalOrder?.({ type: 'formation', formation: formation.value });
  container.append(formationLabel, formation);

  const actions = document.createElement('div');
  actions.className = 'panel__actions panel__actions--stack';
  for (const targetClass of TARGET_CLASSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost btn--xs';
    button.textContent = `Attack ${targetClass}`;
    button.onclick = () => issueTacticalOrder?.({ type: 'attack_class', targetClass });
    actions.appendChild(button);
  }
  for (const [type, label, extra] of [
    ['hold', 'Hold position', {}],
    ['rally', 'Rally center', { point: { x: 0, y: 0 } }],
    ['emergency_retreat', 'Emergency retreat', { point: { x: -1500, y: 0 } }],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = type === 'emergency_retreat' ? 'btn btn--danger btn--xs' : 'btn btn--ghost btn--xs';
    button.textContent = label;
    button.onclick = () => issueTacticalOrder?.({ type, ...extra });
    actions.appendChild(button);
  }
  container.appendChild(actions);

  const orders = activeFleetOrders(battle, 'player');
  if (orders.length) {
    const label = document.createElement('div');
    label.className = 'field-label';
    label.textContent = 'Order timeline';
    container.appendChild(label);
    for (const order of orders.slice(-6).reverse()) {
      const row = document.createElement('div');
      row.className = 'tactical-order-card';
      row.textContent = `#${order.sequence} ${order.type.replaceAll('_', ' ')}${order.targetClass ? ` · ${order.targetClass}` : ''}`;
      container.appendChild(row);
    }
  }
}

function renderCombatHud(state, battle, systemName, ctx) {
  const {
    issueTacticalOrder,
    setCombatDoctrine,
    setCombatPriority,
    setAdvancedTactics,
    getFlagshipControlStatus,
    getCombatSelection,
    getCombatCommandMode,
    setCombatCommandMode,
    cancelTacticalRetreat,
    getCombatCinemaState,
    setCombatCinema,
    doTogglePause,
    doToggleView,
  } = ctx;
  const selectionIds = getCombatSelection?.() ?? [];
  const selectedSet = new Set(selectionIds.map(String));
  const friendlies = (battle.units ?? []).filter((unit) => unit.side === 'player' && unit.hp > 0);
  const hostiles = (battle.units ?? []).filter((unit) => unit.side !== 'player' && unit.hp > 0);
  const selectedUnits = friendlies.filter((unit) => selectedSet.has(String(unit.id)));
  const formationOrder = activeFleetOrders(battle, 'player').filter((o) => o.type === 'formation').at(-1);
  const focusOrder = activeFleetOrders(battle, 'player').filter((o) => o.type === 'focus_fire').at(-1);
  const focusUnit = focusOrder?.targetId
    ? hostiles.find((unit) => String(unit.id) === String(focusOrder.targetId))
    : null;
  const doctrine = normalizeDoctrine(battle.doctrine ?? state.combatDoctrine);
  const commandMode = getCombatCommandMode?.() ?? null;
  const elapsed = Math.max(0, (state.time ?? 0) - (battle.startedAt ?? state.time ?? 0));
  const fleetPriority = battle.fleetPriority ?? state.combatSettings?.fleetPriority ?? 'auto';
  const advancedTactics = battle.advancedTactics ?? state.combatSettings?.advancedTactics ?? false;
  const flagshipControl = getFlagshipControlStatus?.() ?? { mode: 'auto' };
  const retreatOrder = activeFleetOrders(battle, 'player').filter((o) => o.type === 'emergency_retreat').at(-1);
  const retreatChargeMs = Math.max(1, battle.retreatChargeMs ?? 1500);
  const retreatElapsedMs = battle.retreatStartedAt == null
    ? 0
    : Math.max(0, (state.time ?? 0) - battle.retreatStartedAt);
  const withdrawalActive = !!retreatOrder;
  const retreat = withdrawalActive ? {
    destinationId: battle.retreatDestinationId ?? retreatOrder.destinationId ?? null,
    progress: battle.retreatBlockedBy ? 0 : Math.min(1, retreatElapsedMs / retreatChargeMs),
    blocker: battle.retreatBlockedBy ?? null,
  } : null;
  const cinema = getCombatCinemaState?.() ?? { enabled: false, active: false };

  el('combat-hud')?.classList.toggle('combat-hud--advanced', advancedTactics);
  const controlEl = el('combat-hud-control');
  if (controlEl) {
    const controlLabels = {
      auto: 'AUTO',
      manual: 'MANUAL',
      returning_to_auto: 'RETURNING TO AUTO',
    };
    controlEl.textContent = controlLabels[flagshipControl.mode] ?? 'AUTO';
    controlEl.classList.toggle('combat-hud__control--manual', flagshipControl.mode !== 'auto');
  }

  const systemEl = el('combat-hud-system');
  const elapsedEl = el('combat-hud-elapsed');
  const friendlyEl = el('combat-hud-friendly');
  const hostileEl = el('combat-hud-hostile');
  const formationEl = el('combat-hud-formation');
  const focusEl = el('combat-hud-focus');
  if (systemEl) systemEl.textContent = systemName ?? '—';
  if (elapsedEl) elapsedEl.textContent = formatEta(elapsed);
  if (friendlyEl) friendlyEl.textContent = String(friendlies.length);
  if (hostileEl) hostileEl.textContent = String(hostiles.length);
  if (formationEl) formationEl.textContent = `Formation: ${formationOrder?.formation ?? '—'}`;
  if (focusEl) {
    focusEl.textContent = withdrawalActive
      ? `Withdrawal ${retreat.destinationId ?? 'pending'} · ${Math.round((retreat.progress ?? 0) * 100)}%${retreat.blocker ? ` · ${retreat.blocker.replaceAll('_', ' ')}` : ''}`
      : commandMode
      ? `${commandMode === 'move' ? 'Move' : 'Attack'} armed · click a valid ${commandMode === 'move' ? 'location' : 'hostile'} · Esc cancels`
      : (focusUnit
        ? `Focus: ${focusUnit.hull?.replaceAll('_', ' ') ?? focusUnit.id}`
        : (advancedTactics
          ? 'Right-click: contextual order'
          : `Autonomous command · ${fleetPriority.replaceAll('_', ' ')} priority`));
  }

  const selectionEl = el('combat-hud-selection');
  if (selectionEl) {
    clearChildren(selectionEl);
    if (!selectedUnits.length) {
      const empty = document.createElement('p');
      empty.className = 'combat-hud__empty';
      empty.textContent = 'Drag to box-select · Shift multi-select · right-click to command';
      selectionEl.appendChild(empty);
    } else {
      for (const unit of selectedUnits.slice(0, 6)) {
        const row = document.createElement('div');
        row.className = 'combat-hud__selection-row';
        const name = document.createElement('span');
        name.textContent = (unit.hull ?? unit.id).replaceAll('_', ' ');
        const stats = document.createElement('span');
        const shields = unit.shieldFacings ?? unit.shields;
        let shieldCur = 0;
        let shieldMax = 0;
        if (shields && typeof shields === 'object') {
          for (const facing of Object.values(shields)) {
            shieldCur += Math.max(0, facing?.value ?? 0);
            shieldMax += Math.max(0, facing?.max ?? 0);
          }
        }
        const hpLine = `H ${Math.round(unit.hp)}/${Math.round(unit.maxHp ?? unit.hp)}`;
        stats.textContent = shieldMax > 0
          ? `S ${Math.round(shieldCur)}/${Math.round(shieldMax)} · ${hpLine}`
          : hpLine;
        row.append(name, stats);
        selectionEl.appendChild(row);
      }
      if (selectedUnits.length > 6) {
        const more = document.createElement('p');
        more.className = 'combat-hud__empty';
        more.textContent = `+${selectedUnits.length - 6} more`;
        selectionEl.appendChild(more);
      }
    }
  }

  const chipsEl = el('combat-hud-chips');
  if (chipsEl) {
    clearChildren(chipsEl);
    for (const unit of selectedUnits.slice(0, 8)) {
      const chip = document.createElement('span');
      chip.className = 'combat-hud__chip';
      chip.textContent = (unit.hull ?? 'ship').replaceAll('_', ' ');
      chipsEl.appendChild(chip);
    }
  }

  const doctrineEl = el('combat-hud-doctrine');
  if (doctrineEl && !doctrineEl.dataset.bound) {
    clearChildren(doctrineEl);
    for (const id of COMBAT_DOCTRINES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost btn--xs';
      button.dataset.doctrine = id;
      button.textContent = DOCTRINE_LABELS[id] ?? id;
      button.onclick = () => setCombatDoctrine?.(id);
      doctrineEl.appendChild(button);
    }
    doctrineEl.dataset.bound = '1';
  }
  if (doctrineEl) {
    for (const button of doctrineEl.querySelectorAll('[data-doctrine]')) {
      button.classList.toggle('btn--active', button.dataset.doctrine === doctrine);
    }
  }

  const priorityEl = el('combat-hud-priority');
  if (priorityEl) {
    priorityEl.value = fleetPriority;
    priorityEl.onchange = () => setCombatPriority?.(priorityEl.value);
  }

  const advancedBtn = el('combat-hud-advanced-toggle');
  if (advancedBtn) {
    advancedBtn.textContent = advancedTactics ? 'Command Assist: On' : 'Command Assist: Off';
    advancedBtn.title = advancedTactics
      ? 'RTS orders enabled · turn off for pure doctrine autonomy'
      : 'Doctrine autonomy only · turn on for select / move / focus fire';
    advancedBtn.classList.toggle('btn--active', advancedTactics);
    advancedBtn.onclick = () => {
      setAdvancedTactics?.(!advancedTactics);
      if (advancedTactics) setCombatCommandMode?.(null);
    };
  }

  const wingStatusEl = el('combat-hud-wing-status');
  if (wingStatusEl) {
    const wings = friendlies.filter((unit) => unit.isWing && !unit.escaped);
    const counts = wings.reduce((summary, wing) => {
      const phase = wing.recovered ? 'rearm' : (wing.sortiePhase ?? 'attack');
      summary[phase] = (summary[phase] ?? 0) + 1;
      return summary;
    }, {});
    const parts = [
      counts.launch ? `Launch ${counts.launch}` : null,
      counts.approach ? `Approach ${counts.approach}` : null,
      counts.attack ? `Attack ${counts.attack}` : null,
      counts.return ? `Return ${counts.return}` : null,
      counts.rearm ? `Rearm ${counts.rearm}` : null,
    ].filter(Boolean);
    const sorties = wings.reduce((total, wing) => total + Math.max(1, wing.sortieNumber ?? 1), 0);
    const selectedCarriers = selectedUnits.filter((unit) => (
      ['light_carrier', 'fleet_carrier', 'super_carrier', 'flagship', 'hero_flagship'].includes(unit.hull)
    ));
    let rearmNote = '';
    if (selectedCarriers.length) {
      const carrierIds = new Set(selectedCarriers.map((unit) => String(unit.id)));
      const rearming = wings.filter((wing) => wing.recovered && carrierIds.has(String(wing.parentCarrierId)));
      if (rearming.length) {
        const nextMs = Math.min(...rearming.map((wing) => Math.max(0, (wing.rearmUntil ?? 0) - (state.time ?? 0))));
        rearmNote = ` · Hangar rearm ${formatEta(nextMs)} (${rearming.length})`;
      }
    }
    wingStatusEl.textContent = wings.length
      ? `Wings ${wings.length} · Sorties ${sorties} · ${parts.join(' · ') || 'Standing by'}${rearmNote}`
      : 'No active wings';
  }

  const subjectIds = selectedUnits.length
    ? selectedUnits.map((unit) => unit.id)
    : friendlies.map((unit) => unit.id);
  const fleetSubjectIds = friendlies.map((unit) => unit.id);
  const moveBtn = el('combat-hud-move');
  const attackBtn = el('combat-hud-attack');
  const holdBtn = el('combat-hud-hold');
  const retreatBtn = el('combat-hud-retreat');
  const cinemaBtn = el('combat-hud-cinema');
  const pauseBtn = el('combat-hud-pause');
  const galaxyBtn = el('combat-hud-galaxy');
  if (moveBtn) {
    moveBtn.classList.toggle('btn--active', commandMode === 'move');
    moveBtn.disabled = selectedUnits.length === 0;
    moveBtn.onclick = () => setCombatCommandMode?.(commandMode === 'move' ? null : 'move');
  }
  if (attackBtn) {
    attackBtn.classList.toggle('btn--active', commandMode === 'attack');
    attackBtn.disabled = selectedUnits.length === 0;
    attackBtn.onclick = () => setCombatCommandMode?.(commandMode === 'attack' ? null : 'attack');
  }
  if (holdBtn && !holdBtn.dataset.bound) {
    holdBtn.onclick = () => issueTacticalOrder?.({ type: 'hold', subjectIds });
    holdBtn.dataset.bound = '1';
  }
  if (retreatBtn) {
    retreatBtn.textContent = withdrawalActive ? 'Cancel Retreat' : 'Retreat';
    retreatBtn.classList.toggle('btn--active', withdrawalActive);
    retreatBtn.onclick = () => withdrawalActive
      ? cancelTacticalRetreat?.()
      : issueTacticalOrder?.({ type: 'emergency_retreat', subjectIds: fleetSubjectIds });
  }
  if (cinemaBtn) {
    cinemaBtn.textContent = cinema.enabled ? 'Cinema: On' : 'Cinema: Off';
    cinemaBtn.setAttribute('aria-pressed', cinema.enabled ? 'true' : 'false');
    cinemaBtn.classList.toggle('btn--active', cinema.enabled);
    cinemaBtn.title = cinema.active
      ? `Tracking ${cinema.kind?.replaceAll('_', ' ') ?? 'battle cue'}`
      : 'Briefly tracks strafes, heavy impacts, kills, and Helioclast fire';
    cinemaBtn.onclick = () => setCombatCinema?.(!cinema.enabled);
  }
  if (pauseBtn && !pauseBtn.dataset.bound) {
    pauseBtn.onclick = () => doTogglePause?.();
    pauseBtn.dataset.bound = '1';
  }
  if (galaxyBtn && !galaxyBtn.dataset.bound) {
    galaxyBtn.onclick = () => doToggleView?.();
    galaxyBtn.dataset.bound = '1';
  }
  // Rebind subjectIds each frame via closures on fresh handlers for order buttons.
  if (holdBtn) holdBtn.onclick = () => issueTacticalOrder?.({ type: 'hold', subjectIds });
  if (retreatBtn) {
    retreatBtn.onclick = () => issueTacticalOrder?.({
      type: 'emergency_retreat',
      point: { x: -1500, y: 0 },
      subjectIds: fleetSubjectIds,
    });
  }
}

function renderCampaignPanel(container, state, ctx = {}) {
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
  if (sw.cradleSystemId || sw.partStatus?.some((p) => p.blueprint || p.installed)) {
    const skeleton = document.createElement('div');
    skeleton.className = 'panel-note';
    skeleton.textContent = sw.novaculaOnline
      ? 'Helioclast: online'
      : sw.online
        ? 'Helioclast shipyard: charging (modes available when assembled)'
        : sw.cradleSystemId
          ? 'Helioclast berth: keel ready — assemble power & focus'
          : 'Helioclast shipyard: not built';
    container.appendChild(skeleton);
    const partRow = document.createElement('div');
    partRow.className = 'dev-row';
    for (const part of sw.partStatus ?? []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = part.installed
        ? `✓ ${part.label}`
        : part.canInstall
          ? `Install ${part.label}`
          : part.blueprint
            ? `${part.label} (locked)`
            : part.label;
      btn.disabled = part.installed || !part.canInstall;
      btn.onclick = () => {
        const res = installSuperweaponPart(state, part.id);
        toast(res.ok ? `Installed ${part.label}` : res.reason, res.ok ? 'ok' : 'error');
      };
      partRow.appendChild(btn);
    }
    container.appendChild(partRow);
  }
  if (sw.online) {
    const swRow = document.createElement('div');
    swRow.className = 'dev-row';
    const fireCtx = {
      getGalaxyTargetStar: ctx.getGalaxyTargetStar,
      getViewedSystemId: ctx.getViewedSystemId,
    };
    for (const [label, type, allowFallback] of [
      ['Create Star', 'create', true],
      ['Destroy Target', 'destroy', false],
      ['Jump Here', 'jump', false],
    ]) {
      const tid = getHelioclastFireTarget(fireCtx, state, { allowStrongholdFallback: allowFallback });
      const check = tid ? canSuperweaponAction(state, type, tid) : { ok: false, reason: 'Select a target' };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = label;
      btn.disabled = !check.ok;
      btn.title = check.reason ?? '';
      btn.onclick = () => {
        if (!tid) { toast('Select a target star', 'error'); return; }
        const fn = type === 'create' ? superweaponCreate
          : type === 'destroy' ? superweaponDestroy
            : superweaponJump;
        const res = fn(state, tid);
        toast(res.ok ? (res.pending ? `${label} started…` : label) : res.reason, res.ok ? 'ok' : 'error');
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
  const tutorial = getTutorialState(state);
  if (camp.mode === 'tutorial' || tutorial.status === 'complete') {
    const tracker = document.createElement('div');
    tracker.className = 'tutorial-curriculum';
    tracker.innerHTML = `<strong>Academy</strong><span>${tutorial.status === 'complete'
      ? 'Graduated'
      : `Step ${Math.max(1, tutorial.stepIndex + 1)} of ${tutorial.totalSteps}`}</span>`;
    container.appendChild(tracker);
  }

  const manualTitle = document.createElement('div');
  manualTitle.className = 'intel-section-title';
  manualTitle.textContent = 'Field Manual';
  container.appendChild(manualTitle);
  const manual = document.createElement('div');
  manual.className = 'field-manual-list';
  for (const entry of FIELD_MANUAL_ENTRIES) {
    const seen = hasSeenBriefing(entry.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `field-manual-entry${seen || entry.optional ? ' field-manual-entry--available' : ''}`;
    btn.disabled = !seen && !entry.optional;
    btn.innerHTML = `<span>${seen || entry.optional ? '◆' : '🔒'} ${entry.title}</span><small>${seen ? 'Replay briefing' : entry.optional ? 'Reference' : 'Unlock to reveal'}</small>`;
    btn.onclick = () => ctx.openFieldManualBriefing?.(entry.id, { replay: true });
    manual.appendChild(btn);
  }
  container.appendChild(manual);

  if (tutorialGraduated()) {
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'btn btn--ghost btn--sm';
    replay.textContent = 'Replay Tutorial (new academy save)';
    replay.onclick = () => {
      if (window.confirm('Start a new Academy save? Unsaved progress in the current session will be replaced.')) {
        ctx.doStartNewGame?.({ mode: 'tutorial', victoryType: 'sandbox', replay: true });
      }
    };
    container.appendChild(replay);
  }
  for (const m of listMissions()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--xs';
    btn.textContent = m.name;
    const missionAccess = ctx.tutorialAccess?.('missions') ?? { allowed: true };
    btn.disabled = !missionAccess.allowed;
    btn.title = missionAccess.reason ?? m.description;
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

function hullLabel(hull, state = null) {
  if (state) return hullDisplayName(state, hull);
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

function fleetPanelStructureSnapshot(state, selectedBattleGroupId, selectedScoutId, selectedBuilderDroneId, fleetSubTab = 'ships') {
  const playerShips = (state.playerShips ?? []).filter((s) => s.galaxyId === state.activeGalaxyId && s.hp > 0);
  const sw = state.superweapon;
  return JSON.stringify({
    fleetSubTab,
    groups: battleGroupsForGalaxy(state).map((g) => ({
      id: g.id,
      ordinal: g.ordinal,
      shipIds: g.shipIds,
      anchorHeroId: g.anchorHeroId ?? null,
      anchorFlagship: !!g.anchorFlagship,
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
    drones: (state.builderDrones ?? []).map((d) => ({
      id: d.id,
      status: d.status,
      selected: d.id === selectedBuilderDroneId,
      systemId: d.systemId,
      target: d.targetSystemId,
      buildType: d.buildType,
      buildStartedAt: d.buildStartedAt,
      awaitingOrders: !!d.awaitingOrders,
    })),
    builderOrders: (state.builderConstructionOrders ?? []).map((order) => [order.id, order.status, order.assignedDroneId]),
    yards: listPlayerShipyards(state).length,
    queuePending: empireQueueSummary(state).filter((q) => q.status === 'pending').length,
    wingHangar: state.flagship?.wing?.hangar ?? 'deployed',
    wingReady: state.flagship?.wing?.ready ?? 0,
    helioclast: sw ? {
      liveFire: !!sw.liveFireComplete,
      online: !!sw.online,
      parts: Object.keys(sw.installedParts ?? {}).sort(),
      shipSystem: sw.ship?.systemId ?? null,
      fleetMode: sw.ship?.fleetMode ?? 'flagship',
      groupId: sw.ship?.battleGroupId ?? null,
      transit: !!sw.ship?.transit,
    } : null,
  });
}

function updateFleetPanelLabels(state, selectedScoutId, selectedBattleGroupId, selectedBuilderDroneId) {
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

  const hangar = state.flagship?.wing?.hangar ?? 'deployed';
  const hangarStatus = el('fleet-wing-hangar-status');
  if (hangarStatus) {
    hangarStatus.textContent = hangar === 'stowed' ? 'stowed in hangar'
      : hangar === 'recalling' ? 'returning to hangar'
      : hangar === 'launching' ? 'launching'
      : 'flying escort';
  }
  const hangarBtn = el('wing-hangar-btn');
  if (hangarBtn) {
    if (hangar === 'stowed' || hangar === 'recalling') {
      hangarBtn.textContent = hangar === 'recalling' ? 'Docking…' : 'Launch';
      hangarBtn.title = 'Launch escort fighters from the hangar';
    } else {
      hangarBtn.textContent = hangar === 'launching' ? 'Launching…' : 'Hangar';
      hangarBtn.title = 'Recall escort fighters into the flagship hangar';
    }
    hangarBtn.disabled = hangar === 'recalling' || hangar === 'launching';
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

  for (const row of container.querySelectorAll('[data-builder-drone-select]')) {
    const drone = (state.builderDrones ?? []).find((entry) => entry.id === row.dataset.builderDroneSelect);
    if (!drone) continue;
    row.classList.toggle('list-row--selected', drone.id === selectedBuilderDroneId);
    const icon = row.querySelector('.list-row__icon');
    if (icon) icon.style.background = drone.status === 'idle' ? 'var(--accent-green)' : 'var(--accent-gold)';
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
      if (hull === 'corvette') btn.id = 'queue-corvette-btn';
      const cost = HULL_STATS[hull]?.cost ?? 0;
      btn.textContent = `Queue ${hullLabel(hull, state)} (${cost} cr)`;
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
    let line = `@ ${loc} · HP ${Math.ceil(ship.hp)}/${ship.maxHp}`;
    if (ship.wingState) {
      const ready = Math.round(ship.wingState.ready ?? 0);
      const lost = Math.round(ship.wingState.lost ?? 0);
      const launched = Math.round(ship.wingState.launched ?? 0);
      line += ` · Wings ${ready}`;
      if (launched > 0) line += ` (${launched} out)`;
      if (lost > 0) line += ` · ${lost} lost`;
    }
    sub.textContent = line;
  }

  main.appendChild(title);
  main.appendChild(sub);
  row.appendChild(icon);
  row.appendChild(main);
  return row;
}

function decorateStructureButton(button, row, { action = 'Build', subtext = null } = {}) {
  clearChildren(button);
  button.classList.add('structure-build-card');
  const def = bodyStructureDef(row.type);
  const icon = document.createElement('span');
  icon.className = 'structure-build-card__icon';
  icon.textContent = structureIconGlyph(row.type);
  icon.style.color = def?.visual?.color ?? 'var(--accent-cyan)';
  icon.setAttribute('aria-hidden', 'true');

  const copy = document.createElement('span');
  copy.className = 'structure-build-card__copy';
  const title = document.createElement('span');
  title.className = 'structure-build-card__title';
  title.textContent = `${action} ${row.label}${row.cost != null ? ` · ${row.cost} cr` : ''}`;
  const detail = document.createElement('span');
  detail.className = 'structure-build-card__detail';
  detail.textContent = subtext ?? (row.check?.ok
    ? row.description ?? row.effects?.join(' · ') ?? row.placement
    : row.check?.reason ?? 'Unavailable');
  copy.append(title, detail);
  button.append(icon, copy);
}

function renderStructureUpgradeButtons(container, state, systemId, bodyId = undefined) {
  const system = systemById(state, systemId);
  if (!system) return;
  const structures = (system.structures ?? []).filter((structure) => {
    if (!structureUpgradeDef(structure.type)) return false;
    if (bodyId === undefined) return structure.bodyId == null;
    return structure.bodyId === bodyId;
  });
  if (structures.length === 0) return;

  const heading = document.createElement('div');
  heading.className = 'intel-section-title';
  heading.textContent = 'Infrastructure Upgrades';
  container.appendChild(heading);
  for (const structure of structures) {
    const def = bodyStructureDef(structure.type);
    const label = def?.label ?? structure.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const check = canUpgradeBodyStructure(state, systemId, structure.id);
    const level = Math.max(1, Math.min(3, Number(structure.level ?? 1)));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--block btn--sm';
    btn.disabled = !check.ok;
    decorateStructureButton(btn, {
      type: structure.type,
      label: `${label} L${level} → L${Math.min(3, level + 1)}`,
      cost: check.cost ?? null,
      check,
      description: `Retains structure identity and current damage ratio.`,
    }, { action: 'Upgrade' });
    btn.title = check.ok ? `Upgrade ${label} to level ${check.nextLevel}` : check.reason;
    btn.onclick = () => {
      const result = upgradeBodyStructure(state, systemId, structure.id);
      if (result.ok) toast(
        result.queued ? `${label} level ${result.level} upgrade queued` : `${label} upgraded to level ${result.level}`,
        'ok',
      );
      else toast(result.reason, 'error');
    };
    container.appendChild(btn);
  }
}

function renderStarNodeBuildButtons(container, state, systemId, { includeHeading = true, filter = null } = {}) {
  if (!container) return;
  const rows = starNodeStructureBuildRows(state, systemId).filter((row) => !filter || filter(row));
  if (rows.length === 0) return;
  if (includeHeading) {
    const heading = document.createElement('div');
    heading.className = 'intel-section-title';
    heading.textContent = 'Star-Node Buildings';
    container.appendChild(heading);
  }
  for (const row of rows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--block btn--sm';
    btn.disabled = !row.check.ok;
    decorateStructureButton(btn, row);
    btn.title = row.check.ok ? row.description : row.check.reason;
    btn.onclick = () => {
      const result = buildBodyStructure(state, systemId, null, row.type);
      if (result.ok) toast(result.queued ? `${row.label} construction queued` : `${row.label} built`, 'ok');
      else toast(result.reason, 'error');
    };
    container.appendChild(btn);
  }
  renderStructureUpgradeButtons(container, state, systemId);
}

function renderStrategicBuildButtons(container, state, systemId, planetId) {
  if (!container) return;
  clearChildren(container);
  const owned = isPlayerOwned(state, systemId);
  if (!owned) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  const bodyRows = bodyStructureBuildRows(state, systemId, planetId);
  const groups = [
    ['surface', 'Surface Buildings'],
    ['orbital', 'Orbital Buildings'],
  ];
  for (const [placement, title] of groups) {
    const rows = bodyRows.filter((row) => row.placement === placement);
    if (rows.length === 0) continue;
    const heading = document.createElement('div');
    heading.className = 'intel-section-title';
    heading.textContent = title;
    container.appendChild(heading);
    for (const row of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--block btn--sm';
      btn.disabled = !row.check.ok;
      decorateStructureButton(btn, row);
      btn.title = row.check.ok ? `${row.label} · ${placement}` : row.check.reason;
      btn.onclick = () => {
        const res = buildBodyStructure(state, systemId, planetId, row.type);
        if (res.ok) toast(res.queued ? `${row.label} construction queued` : `${row.label} built`, 'ok');
        else toast(res.reason, 'error');
      };
      container.appendChild(btn);

    }
  }

  renderStructureUpgradeButtons(container, state, systemId, planetId);
  renderStarNodeBuildButtons(container, state, systemId);

  const strategicHeading = document.createElement('div');
  strategicHeading.className = 'intel-section-title';
  strategicHeading.textContent = 'Strategic Buildings';
  container.appendChild(strategicHeading);
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

function renderHelioclastFleetTab(container, state, ctx) {
  const sw = superweaponSummary(state);
  const ship = getHelioclastShip(state);
  const battleGroups = battleGroupsForGalaxy(state);
  const toast = ctx.toast ?? (() => {});
  const targetId = getHelioclastFireTarget(ctx, state, { allowStrongholdFallback: true });
  const targetName = targetId ? (systemById(state, targetId)?.name ?? targetId) : '—';

  const title = document.createElement('div');
  title.className = 'intel-section-title';
  title.textContent = 'Helioclast Shipyard';
  container.appendChild(title);

  const status = document.createElement('p');
  status.className = 'panel-note';
  const stage = sw.buildStage ?? 0;
  const stageNames = [
    'Empty berth — assemble keel frame',
    'Keel frame',
    'Power core',
    'Focus array',
    'Containment lattice',
    'Gate capacitor — live-fire / Online',
    'Focal aperture — online & mobile',
  ];
  const job = sw.buildProgress;
  let statusText = `Stage ${stage}/6 · ${stageNames[stage] ?? '—'}`;
  if (job?.partId && job.jobProgress < 1) {
    statusText += ` · Assembling ${job.partId} (${Math.round(job.jobProgress * 100)}%, ${Math.ceil((job.remainingMs ?? 0) / 1000)}s)`;
  }
  statusText += (sw.liveFireComplete ? ' · Live-fire complete' : stage >= 5 ? ' · Awaiting live-fire calibration' : '')
    + (sw.mobile ? ' · Mobile' : ' · Berth-locked');
  status.textContent = statusText;
  container.appendChild(status);

  const checklist = document.createElement('p');
  checklist.className = 'panel-note panel-note--muted';
  const hasYard = !!sw.cradleSystemId || hasHelioclastShipyard(state, state.stronghold);
  checklist.textContent = [
    hasYard ? '✓ Yard' : '○ Yard',
    stage >= 5 ? '✓ Construction' : '○ Construction',
    sw.liveFireComplete ? '✓ Live-fire' : '○ Live-fire',
    sw.novaculaOnline ? '✓ Online tech' : '○ Online tech',
    sw.mobile ? '✓ Mobile' : '○ Mobile',
  ].join(' · ');
  container.appendChild(checklist);

  if (!hasYard) {
    const tip = document.createElement('p');
    tip.className = 'panel-note';
    tip.textContent = 'Build the Helioclast Shipyard at your Stronghold (drones assemble the berth).';
    container.appendChild(tip);
    const buildBtn = document.createElement('button');
    buildBtn.type = 'button';
    buildBtn.className = 'btn btn--primary btn--sm';
    buildBtn.textContent = `Build Helioclast Shipyard (${HELIOCLAST_SHIPYARD_COST}¢ / ${HELIOCLAST_SHIPYARD_SOLARII} Solarii)`;
    const can = canBuildHelioclastShipyard(state, state.stronghold);
    buildBtn.disabled = !can.ok;
    buildBtn.title = can.ok ? 'Queue berth construction at Stronghold' : (can.reason ?? '');
    buildBtn.onclick = () => {
      const res = buildHelioclastShipyard(state, state.stronghold);
      toast(
        res.ok
          ? (res.instant ? 'Helioclast shipyard online' : 'Helioclast shipyard construction started')
          : res.reason,
        res.ok ? 'ok' : 'error',
      );
    };
    container.appendChild(buildBtn);
  }

  if (ship) {
    const loc = document.createElement('p');
    loc.className = 'panel-note panel-note--muted';
    loc.textContent = ship.transit
      ? `In transit → ${ship.transit.path?.[ship.transit.path.length - 1] ?? '?'}`
      : `At ${systemById(state, ship.systemId)?.name ?? ship.systemId ?? 'berth'}`
        + ` · HP ${Math.floor(ship.hp)}/${Math.floor(ship.maxHp ?? ship.hp)}`
        + ` · Mode ${ship.fleetMode === 'group' ? `fleet ${ship.battleGroupId}` : 'with flagship'}`;
    container.appendChild(loc);
  }

  if (hasYard) {
    const partRow = document.createElement('div');
    partRow.className = 'dev-row';
    for (const part of sw.partStatus ?? []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--xs';
      if (part.installed) {
        btn.textContent = `✓ ${part.label}`;
        btn.disabled = true;
      } else if (part.assembling) {
        btn.textContent = `… ${part.label}`;
        btn.disabled = true;
      } else {
        btn.textContent = part.canInstall ? `Assemble ${part.label}` : part.label;
        btn.disabled = !part.canInstall;
      }
      btn.onclick = () => {
        const res = installSuperweaponPart(state, part.id);
        toast(res.ok ? (res.instant ? `Installed ${part.label}` : `Assembling ${part.label}…`) : res.reason, res.ok ? 'ok' : 'error');
      };
      partRow.appendChild(btn);
    }
    container.appendChild(partRow);
  }

  if (stage >= 5 && !sw.liveFireComplete) {
    const tip = document.createElement('p');
    tip.className = 'panel-note';
    const liveCheck = canMarkLiveFire(state);
    tip.textContent = liveCheck.ok
      ? 'Live-fire calibration ready — run the berth test (or fire Create / Destroy once).'
      : `Live-fire locked: ${liveCheck.reason}`;
    container.appendChild(tip);
    if (liveCheck.ok) {
      const calBtn = document.createElement('button');
      calBtn.type = 'button';
      calBtn.className = 'btn btn--primary';
      calBtn.textContent = 'Run live-fire test';
      calBtn.onclick = () => {
        const res = markLiveFireComplete(state);
        toast(res.ok ? 'Live-fire calibration complete' : res.reason, res.ok ? 'ok' : 'error');
      };
      container.appendChild(calBtn);
    }
  }

  const targetNote = document.createElement('p');
  targetNote.className = 'panel-note';
  targetNote.textContent = `Fire target: ${targetName} (galaxy map selection preferred)`;
  container.appendChild(targetNote);

  const fireRow = document.createElement('div');
  fireRow.className = 'dev-row';
  const actions = [
    ['Create', 'create', true],
    ['Destroy', 'destroy', false],
    ['Jump', 'jump', false],
  ];
  for (const [label, type, allowFallback] of actions) {
    const tid = getHelioclastFireTarget(ctx, state, { allowStrongholdFallback: allowFallback });
    const check = tid ? canSuperweaponAction(state, type, tid) : { ok: false, reason: 'Select a target star' };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--sm';
    const cost = sw.costs?.[type] ?? '?';
    btn.textContent = `${label} (${cost}◎)`;
    btn.disabled = !check.ok;
    btn.title = check.ok
      ? `${label} → ${systemById(state, tid)?.name ?? tid}`
      : (check.reason ?? '');
    btn.onclick = () => {
      if (!tid) { toast('Select a target star on the galaxy map', 'error'); return; }
      const fn = type === 'create' ? superweaponCreate
        : type === 'destroy' ? superweaponDestroy
          : superweaponJump;
      const res = fn(state, tid);
      toast(res.ok ? (res.pending ? `${label} sequence started…` : label) : res.reason, res.ok ? 'ok' : 'error');
    };
    fireRow.appendChild(btn);
  }
  container.appendChild(fireRow);

  if (isHelioclastMobile(state)) {
    const modeTitle = document.createElement('div');
    modeTitle.className = 'intel-section-title';
    modeTitle.textContent = 'Assignment';
    container.appendChild(modeTitle);

    const modeRow = document.createElement('div');
    modeRow.className = 'dev-row';
    const withFlag = document.createElement('button');
    withFlag.type = 'button';
    withFlag.className = 'btn btn--ghost btn--sm';
    withFlag.textContent = 'Keep with Flagship';
    withFlag.onclick = () => {
      const res = setHelioclastFleetMode(state, 'flagship');
      toast(res.ok ? 'Helioclast slowly escorts the flagship' : res.reason, res.ok ? 'ok' : 'error');
    };
    modeRow.appendChild(withFlag);

    for (const group of battleGroups) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--xs';
      btn.textContent = `Assign · Fleet ${group.ordinal}`;
      btn.onclick = () => {
        const res = setHelioclastFleetMode(state, 'group', group.id);
        toast(res.ok ? `Assigned to Fleet ${group.ordinal}` : res.reason, res.ok ? 'ok' : 'error');
      };
      modeRow.appendChild(btn);
    }
    container.appendChild(modeRow);
  }
}

function renderFleetPanel(container, state, ctx) {
  const {
    getSelectedScoutId,
    doSelectScout,
    getSelectedBuilderDroneId,
    doSelectBuilderDrone,
    getSelectedBattleGroupId,
    doSelectBattleGroup,
    createBattleGroup,
    deleteBattleGroup,
    builderDroneSummary,
    cancelBuilderDrone,
    openBuilderDronePlanner,
    doToggleWingHangar,
    getFleetSubTab,
    setFleetSubTab,
    getViewedSystemId,
  } = ctx;
  clearChildren(container);
  const subTab = getFleetSubTab?.() ?? 'ships';

  const tabBar = document.createElement('div');
  tabBar.className = 'fleet-subtabs';
  for (const [id, label] of [
    ['ships', 'Ships'],
    ['fleets', 'Fleets'],
    ['helioclast', 'Helioclast'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--ghost btn--xs${subTab === id ? ' btn--active' : ''}`;
    btn.textContent = label;
    btn.onclick = () => {
      setFleetSubTab?.(id);
    };
    tabBar.appendChild(btn);
  }
  container.appendChild(tabBar);

  if (subTab === 'helioclast') {
    renderHelioclastFleetTab(container, state, ctx);
    return;
  }

  const galaxy = getGraph(state);
  const selectedScoutId = getSelectedScoutId();
  const selectedBuilderDroneId = getSelectedBuilderDroneId?.() ?? null;
  const selectedBattleGroupId = getSelectedBattleGroupId?.() ?? null;

  const playerShips = (state.playerShips ?? []).filter((s) => s.galaxyId === state.activeGalaxyId && s.hp > 0);
  const scouts = state.scouts ?? [];
  const yards = listPlayerShipyards(state);
  const queue = empireQueueSummary(state);
  const battleGroups = battleGroupsForGalaxy(state);
  const unassigned = unassignedPlayerShips(state);
  const drones = builderDroneSummary?.(state);

  const stats = document.createElement('div');
  stats.className = 'fleet-stats';
  const readyShips = playerShips.filter((s) => !s.transit).length;
  const transitShips = playerShips.filter((s) => s.transit).length;
  stats.innerHTML = `
    <span>Ships: <strong>${readyShips}</strong>${transitShips ? ` +${transitShips} transit` : ''}</span>
    <span>Fleets: <strong>${battleGroups.length}</strong></span>
    <span>Scouts: <strong>${scouts.length}</strong></span>
    <span>Drones: <strong>${drones?.unlocked ? `${drones.idle}/${drones.capacity}` : 'locked'}</strong></span>
    <span>Shipyards: <strong>${yards.length}</strong></span>
    <span>Queue: <strong>${queue.filter((q) => q.status === 'pending').length}</strong></span>
  `;
  container.appendChild(stats);

  if (subTab === 'fleets') {
    // Fleets tab focuses on battle groups (below); skip ship roster extras.
  } else {
  const wing = state.flagship?.wing;
  if (wing) {
    const hangar = wing.hangar ?? 'deployed';
    const wingTitle = document.createElement('div');
    wingTitle.className = 'intel-section-title fleet-section-header';
    wingTitle.textContent = 'Flagship Escorts';
    container.appendChild(wingTitle);

    const wingRow = document.createElement('div');
    wingRow.className = 'list-row';
    const wingMain = document.createElement('span');
    wingMain.className = 'list-row__main';
    const wingName = document.createElement('div');
    wingName.className = 'list-row__title';
    wingName.textContent = `Fighter wing · ${Math.floor(wing.ready ?? 0)}/${wing.capacity ?? 0}`;
    const wingSub = document.createElement('div');
    wingSub.className = 'list-row__sub';
    wingSub.id = 'fleet-wing-hangar-status';
    const hangarStatus = hangar === 'stowed' ? 'stowed in hangar'
      : hangar === 'recalling' ? 'returning to hangar'
      : hangar === 'launching' ? 'launching'
      : 'flying escort';
    wingSub.textContent = hangarStatus;
    wingMain.append(wingName, wingSub);
    wingRow.appendChild(wingMain);

    const hangarBtn = document.createElement('button');
    hangarBtn.type = 'button';
    hangarBtn.className = 'btn btn--ghost btn--xs';
    hangarBtn.id = 'wing-hangar-btn';
    if (hangar === 'stowed' || hangar === 'recalling') {
      hangarBtn.textContent = hangar === 'recalling' ? 'Docking…' : 'Launch';
      hangarBtn.title = 'Launch escort fighters from the hangar';
    } else {
      hangarBtn.textContent = hangar === 'launching' ? 'Launching…' : 'Hangar';
      hangarBtn.title = 'Recall escort fighters into the flagship hangar';
    }
    hangarBtn.disabled = hangar === 'recalling' || hangar === 'launching';
    hangarBtn.onclick = () => doToggleWingHangar?.();
    wingRow.appendChild(hangarBtn);
    container.appendChild(wingRow);
  }

  if (drones?.unlocked) {
    const droneTitle = document.createElement('div');
    droneTitle.className = 'intel-section-title fleet-section-header';
    droneTitle.textContent = 'Builder Drones';
    container.appendChild(droneTitle);
    const droneList = document.createElement('div');
    droneList.className = 'list';
    for (const drone of drones.drones) {
      const row = document.createElement('div');
      row.className = `list-row${drone.id === selectedBuilderDroneId ? ' list-row--selected' : ''}`;
      row.dataset.builderDroneSelect = drone.id;
      row.title = 'Select this builder drone, then Shift+click a star to dispatch it';
      const icon = document.createElement('span');
      icon.className = 'list-row__icon';
      icon.style.background = drone.status === 'idle' ? 'var(--accent-green)' : 'var(--accent-gold)';
      const main = document.createElement('span');
      main.className = 'list-row__main';
      const title = document.createElement('div');
      title.className = 'list-row__title';
      title.textContent = `${drone.id} · ${drone.status}`;
      const sub = document.createElement('div');
      sub.className = 'list-row__sub';
      if (drone.status === 'building') {
        sub.textContent = `${drone.buildType} · ${Math.round((drone.buildProgress ?? 0) * 100)}%`;
      } else if (drone.etaMs != null) {
        sub.textContent = `→ ${systemById(state, drone.targetSystemId)?.name ?? drone.targetSystemId ?? 'flagship'} · ${Math.ceil(drone.etaMs / 1000)}s`;
      } else {
        sub.textContent = `@ ${systemById(state, drone.systemId)?.name ?? drone.systemId ?? 'flagship'}`;
      }
      main.appendChild(title);
      main.appendChild(sub);
      row.appendChild(icon);
      row.appendChild(main);
      if (drone.status !== 'idle' && drone.status !== 'building') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost btn--xs';
        btn.textContent = 'Cancel';
        btn.onclick = () => cancelBuilderDrone?.(drone.id);
        row.appendChild(btn);
      } else if (drone.status === 'idle' && drone.systemId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost btn--xs';
        btn.textContent = 'Plan Builds';
        btn.onclick = () => openBuilderDronePlanner?.(drone.systemId);
        row.appendChild(btn);
      }
      droneList.appendChild(row);
    }
    container.appendChild(droneList);
  }
  } // end ships-only extras

  if (subTab === 'ships') {
    // Ships tab: skip battle-group management (use Fleets sub-tab).
  } else {
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

  const autoAssignBtn = document.createElement('button');
  autoAssignBtn.type = 'button';
  autoAssignBtn.className = 'btn btn--primary btn--sm fleet-auto-assign-btn';
  autoAssignBtn.dataset.fleetAutoAssign = '1';
  autoAssignBtn.disabled = unassigned.length === 0;
  autoAssignBtn.textContent = unassigned.length > 0
    ? `Auto Assign ${unassigned.length} Ship${unassigned.length === 1 ? '' : 's'}`
    : 'All Ships Assigned';
  autoAssignBtn.onclick = () => {
    const result = autoAssignShipsToFleets(state, { preferredGroupId: selectedBattleGroupId });
    if (!result.ok) {
      toast(result.reason, 'error');
      return;
    }
    const selectedId = result.groupIds[0] ?? result.createdGroupIds[0];
    if (selectedId) doSelectBattleGroup?.(selectedId);
    toast(
      result.assigned > 0
        ? `${result.assigned} ship${result.assigned === 1 ? '' : 's'} assigned to fleets`
        : 'All ships are already assigned',
      result.assigned > 0 ? 'ok' : 'info',
    );
  };
  container.appendChild(autoAssignBtn);

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
        if (shipId === HELIOCLAST_ID) {
          const heli = getHelioclastShip(state);
          if (!heli || heli.hp <= 0) continue;
          const row = document.createElement('div');
          row.className = 'list-row';
          const main = document.createElement('span');
          main.className = 'list-row__main';
          main.innerHTML = `<div class="list-row__title">Helioclast</div><div class="list-row__sub">${heli.transit ? 'in transit' : systemById(state, heli.systemId)?.name ?? heli.systemId} · HP ${Math.floor(heli.hp)}</div>`;
          row.appendChild(main);
          list.appendChild(row);
          continue;
        }
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
    anchorLabel.textContent = 'Anchor:';
    const anchorSel = document.createElement('select');
    anchorSel.className = 'btn btn--ghost btn--sm';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    anchorSel.appendChild(noneOpt);
    const flagshipOpt = document.createElement('option');
    flagshipOpt.value = 'player-flagship';
    flagshipOpt.textContent = `Player Flagship @ ${systemById(state, state.flagship?.systemId)?.name ?? (state.flagship?.transit ? 'in transit' : 'unknown')}`;
    flagshipOpt.selected = !!group.anchorFlagship;
    anchorSel.appendChild(flagshipOpt);
    for (const hero of heroFlagshipsSummary(state)) {
      const opt = document.createElement('option');
      opt.value = `hero:${hero.id}`;
      opt.textContent = `${hero.id} @ ${systemById(state, hero.systemId)?.name ?? hero.systemId}`;
      if (group.anchorHeroId === hero.id) opt.selected = true;
      anchorSel.appendChild(opt);
    }
    anchorSel.onchange = () => {
      let res;
      if (anchorSel.value === 'player-flagship') {
        res = setBattleGroupFlagshipAnchor(state, group.id, true);
      } else if (anchorSel.value.startsWith('hero:')) {
        res = setBattleGroupHeroAnchor(state, group.id, anchorSel.value.slice(5));
      } else {
        setBattleGroupFlagshipAnchor(state, group.id, false);
        res = setBattleGroupHeroAnchor(state, group.id, null);
      }
      if (!res.ok) toast(res.reason, 'error');
      else toast(`${formatFleetName(group.ordinal)} anchor updated`, 'ok');
    };
    anchorRow.appendChild(anchorLabel);
    anchorRow.appendChild(anchorSel);
    block.appendChild(anchorRow);

    container.appendChild(block);
  }
  } // end fleets-only battle groups

  if (subTab === 'fleets') {
    const fleetHint = document.createElement('p');
    fleetHint.className = 'panel-note panel-note--muted';
    fleetHint.style.marginTop = '8px';
    fleetHint.textContent = 'Tab+click a star to dispatch the selected fleet. Assign the Helioclast from the Helioclast tab.';
    container.appendChild(fleetHint);
    return;
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
  fleetHint.textContent = 'Click a builder drone to select it, then Shift+click a star to dispatch it. Tab+click dispatches fleets; Shift+click sends scouts when no drone is selected.';
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
  const focusedControl = document.activeElement?.dataset?.techControl ?? null;
  const focusedSelection = focusedControl === 'search'
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    : null;
  techUiState.searchQuery ??= '';
  techUiState.tierFilter ??= '';
  techUiState.stateFilter ??= '';

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

  const savedDetailNodeId = techUiState.detailNodeId ?? null;
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

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'tech-screen__search';
  search.placeholder = 'Search technologies, effects, buildings…';
  search.setAttribute('aria-label', 'Search technology web');
  search.dataset.techControl = 'search';
  search.value = techUiState.searchQuery;

  const resultSelect = document.createElement('select');
  resultSelect.className = 'tech-screen__select tech-screen__results';
  resultSelect.setAttribute('aria-label', 'Matching technologies');
  resultSelect.dataset.techControl = 'results';
  const matchingNodes = () => {
    const query = techUiState.searchQuery.trim().toLowerCase();
    if (!query) return [];
    return allTechNodes().filter((node) => [
      node.id,
      node.name,
      node.description,
      node.cluster,
      node.effect,
      ...(node.tags ?? []),
      ...(node.unlocks ?? []),
      ...(node.effects ?? []).flatMap((effect) => [effect.type, effect.target, effect.label]),
    ].filter(Boolean).join(' ').toLowerCase().includes(query));
  };
  const populateResults = () => {
    resultSelect.innerHTML = '';
    const matches = matchingNodes();
    const lead = document.createElement('option');
    lead.value = '';
    lead.textContent = matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'No matches';
    resultSelect.appendChild(lead);
    for (const node of matches.slice(0, 40)) {
      const option = document.createElement('option');
      option.value = node.id;
      option.textContent = `${node.name} · T${derivedTier(node.id)}`;
      resultSelect.appendChild(option);
    }
  };
  populateResults();
  search.addEventListener('input', () => {
    techUiState.searchQuery = search.value;
    populateResults();
    techUiState.graphHandle?.setFilters({ query: techUiState.searchQuery });
  });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const first = matchingNodes()[0];
    if (first) techUiState.graphHandle?.focusNode(first.id);
  });
  resultSelect.addEventListener('change', () => {
    if (resultSelect.value) techUiState.graphHandle?.focusNode(resultSelect.value);
  });
  toolbar.append(search, resultSelect);

  const tierSelect = document.createElement('select');
  tierSelect.className = 'tech-screen__select';
  tierSelect.setAttribute('aria-label', 'Filter technology tier');
  tierSelect.dataset.techControl = 'tier';
  const maxTier = Math.max(...allTechNodes().map((node) => derivedTier(node.id)));
  tierSelect.innerHTML = '<option value="">All tiers</option>'
    + Array.from({ length: maxTier }, (_, index) => `<option value="${index + 1}">Tier ${index + 1}</option>`).join('');
  tierSelect.value = String(techUiState.tierFilter ?? '');
  tierSelect.addEventListener('change', () => {
    techUiState.tierFilter = tierSelect.value;
    techUiState.graphHandle?.setFilters({ tier: tierSelect.value || null });
  });
  toolbar.appendChild(tierSelect);

  const stateSelect = document.createElement('select');
  stateSelect.className = 'tech-screen__select';
  stateSelect.setAttribute('aria-label', 'Filter technology state');
  stateSelect.dataset.techControl = 'state';
  stateSelect.innerHTML = [
    ['', 'All states'],
    ['available', 'Available'],
    ['active', 'Researching'],
    ['queued', 'Queued'],
    ['unlocked', 'Unlocked'],
    ['locked', 'Locked'],
    ['hidden', 'Unknown'],
  ].map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  stateSelect.value = techUiState.stateFilter;
  stateSelect.addEventListener('change', () => {
    techUiState.stateFilter = stateSelect.value;
    techUiState.graphHandle?.setFilters({ state: stateSelect.value || null });
  });
  toolbar.appendChild(stateSelect);

  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'btn btn--ghost btn--sm';
  fitBtn.textContent = 'Fit View';
  fitBtn.onclick = () => techUiState.fitView?.();
  toolbar.appendChild(fitBtn);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn--ghost btn--sm';
  resetBtn.textContent = 'Reset';
  resetBtn.onclick = () => {
    techUiState.searchQuery = '';
    techUiState.tierFilter = '';
    techUiState.stateFilter = '';
    techUiState.clusterFilter = null;
    search.value = '';
    tierSelect.value = '';
    stateSelect.value = '';
    populateResults();
    techUiState.graphHandle?.setFilters({ query: null, tier: null, state: null, cluster: null });
    techUiState.graphHandle?.resetView();
  };
  toolbar.appendChild(resetBtn);
  chrome.appendChild(toolbar);

  if (!techUiState.detailEl) {
    techUiState.detailEl = document.createElement('div');
    techUiState.detailEl.className = 'tech-screen__detail';
  }
  chrome.appendChild(techUiState.detailEl);

  const hint = document.createElement('p');
  hint.className = 'tech-screen__hint';
  hint.textContent = 'Drag to pan · Scroll to zoom · Hover for details · Click to trace path · Click available nodes to research';
  chrome.appendChild(hint);

  const onResearch = (nodeId) => {
    const res = startResearch(state, nodeId);
    if (!res.ok) toast(res.reason, 'error');
    else toast(`Started ${techNode(nodeId)?.name ?? nodeId}`, 'ok');
  };

  const fillTechDetail = (nodeId, { traced = false } = {}) => {
    if (!techUiState.detailEl) return;
    techUiState.detailNodeId = nodeId;
    techUiState.detailEl.replaceChildren();
    if (!nodeId) {
      techUiState.detailEl.classList.remove('tech-screen__detail--filled');
      const empty = document.createElement('span');
      empty.className = 'tech-screen__detail-empty';
      empty.textContent = 'Hover a node for details · Click a node to trace its path';
      techUiState.detailEl.appendChild(empty);
      return;
    }
    const node = techNode(nodeId);
    if (!node) return;
    techUiState.detailEl.classList.add('tech-screen__detail--filled');

    const title = document.createElement('div');
    title.className = 'tech-screen__detail-title';
    title.textContent = node.name;
    techUiState.detailEl.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'tech-screen__detail-meta';
    const cluster = TECH_CLUSTERS[node.cluster]?.label ?? node.cluster;
    meta.textContent = [
      node.tags?.includes('spine') || node.spine ? 'Main Path' : cluster,
      `Tier ${derivedTier(node.id)}`,
      costLabelFromNode(node),
      traced ? 'Path traced' : null,
    ].filter(Boolean).join(' · ');
    techUiState.detailEl.appendChild(meta);

    const does = document.createElement('div');
    does.className = 'tech-screen__detail-block';
    const doesLabel = document.createElement('strong');
    doesLabel.textContent = 'Does';
    does.appendChild(doesLabel);
    does.append(` ${node.description || 'No description.'}`);
    techUiState.detailEl.appendChild(does);

    const unlocks = Array.isArray(node.unlocks) ? node.unlocks.filter(Boolean) : [];
    if (unlocks.length) {
      const unlockBlock = document.createElement('div');
      unlockBlock.className = 'tech-screen__detail-block';
      const unlockLabel = document.createElement('strong');
      unlockLabel.textContent = 'Unlocks';
      unlockBlock.appendChild(unlockLabel);
      unlockBlock.append(` ${unlocks.join(', ')}`);
      techUiState.detailEl.appendChild(unlockBlock);
    }

    const prereqNames = (node.prereqs ?? [])
      .map((p) => techNode(p)?.name ?? p)
      .join(', ') || 'None';
    const req = document.createElement('div');
    req.className = 'tech-screen__detail-block tech-screen__detail-block--muted';
    const reqLabel = document.createElement('strong');
    reqLabel.textContent = 'Requires';
    req.appendChild(reqLabel);
    req.append(` ${prereqNames}`);
    techUiState.detailEl.appendChild(req);
  };

  fillTechDetail(savedDetailNodeId, { traced: !!savedDetailNodeId });

  const onHoverNode = (nodeId, ctx = {}) => {
    const showId = nodeId || ctx.tracedNodeId || null;
    fillTechDetail(showId, { traced: !!(ctx.tracedNodeId && (!nodeId || ctx.tracedNodeId === nodeId)) });
  };

  const onSelectNode = (nodeId) => {
    fillTechDetail(nodeId, { traced: !!nodeId });
  };

  if (!techUiState.mounted) {
    techUiState.graphWrap.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'tech-web-mount';
    techUiState.graphWrap.appendChild(mount);
    const handle = mountTechWebGraph(mount, state, {
      summary,
      clusterFilter: techUiState.clusterFilter,
      filters: {
        cluster: techUiState.clusterFilter,
        query: techUiState.searchQuery || null,
        tier: techUiState.tierFilter || null,
        state: techUiState.stateFilter || null,
      },
      onResearch,
      onHoverNode,
      onSelectNode,
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

  if (focusedControl) {
    const control = chrome.querySelector(`[data-tech-control="${focusedControl}"]`);
    control?.focus();
    if (focusedSelection && control?.setSelectionRange) {
      control.setSelectionRange(focusedSelection[0], focusedSelection[1]);
    }
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
    getSelectedBuilderDroneId,
    doSelectBuilderDrone,
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
    cancelBuilderConstructionOrder,
    canDeployBuilderDrone,
    deployBuilderDrone,
    getDroneConstructionCatalog,
    confirmBuilderConstructionPlan,
    setBuilderDronesAwaitingOrders,
    cancelBuilderDrone,
    doBuildFoundry,
    doBuildLauncher,
    doEnterWormhole,
    doBuildWormholeAnchor,
    getGalaxyTargetStar,
    doStartNewGame,
    doFocusTutorial,
    doBeginTutorialGraduation,
    doCompleteTutorialGraduation,
    doRetryTutorialBattle,
    tutorialAccess,
    executeSolRecommendation,
    validateSolRecommendation,
    issueTacticalOrder,
    setCombatDoctrine,
    setCombatPriority,
    setAdvancedTactics,
    getFlagshipControlStatus,
    getCombatSelection,
    selectCombatUnit,
    clearCombatSelection,
    combatFocus,
    getCombatCommandMode,
    setCombatCommandMode,
    cancelTacticalRetreat,
    getCombatCinemaState,
    setCombatCinema,
    combatUiActive,
    followConvoy,
    getBootPhase,
    setBootPhase,
  } = ctx;

  let activeBriefingId = null;
  let briefingWasPaused = null;
  let fleetSubTab = 'ships';

  function closeFieldManualBriefing({ acknowledge = true } = {}) {
    const id = activeBriefingId;
    activeBriefingId = null;
    el('field-manual-modal')?.classList.add('hidden');
    el('field-manual-backdrop')?.classList.add('hidden');
    if (acknowledge && id) markBriefingSeen(id);
    if (briefingWasPaused != null) {
      getState().paused = briefingWasPaused;
      briefingWasPaused = null;
    }
  }

  function openFieldManualBriefing(id, { replay = false } = {}) {
    const entry = fieldManualEntry(id);
    if (!entry) return { ok: false, reason: 'Unknown Field Manual entry' };
    activeBriefingId = id;
    if (briefingWasPaused == null) briefingWasPaused = getState().paused;
    getState().paused = true;
    const title = el('field-manual-title');
    const summary = el('field-manual-summary');
    const steps = el('field-manual-steps');
    if (title) title.textContent = entry.title;
    if (summary) summary.textContent = entry.summary;
    if (steps) {
      clearChildren(steps);
      for (const text of entry.steps) {
        const li = document.createElement('li');
        li.textContent = text;
        steps.appendChild(li);
      }
    }
    const show = el('field-manual-show');
    if (show) {
      show.classList.toggle('hidden', !entry.targetId);
      show.onclick = () => {
        closeFieldManualBriefing({ acknowledge: !replay });
        const target = entry.targetId ? el(entry.targetId) : null;
        if (!target) {
          toast('That control is not currently available', 'info');
          return;
        }
        target.click();
        target.focus({ preventScroll: true });
      };
    }
    const ack = el('field-manual-ack');
    if (ack) ack.onclick = () => closeFieldManualBriefing({ acknowledge: true });
    el('field-manual-close').onclick = () => closeFieldManualBriefing({ acknowledge: true });
    el('field-manual-backdrop').onclick = () => closeFieldManualBriefing({ acknowledge: true });
    el('field-manual-modal')?.classList.remove('hidden');
    el('field-manual-backdrop')?.classList.remove('hidden');
    return { ok: true, id };
  }

  function renderFieldManualUnlocks(state, phase) {
    if (phase !== 'playing' || activeBriefingId || !tutorialGraduated()) return;
    const next = newlyUnlockedBriefings(state, currentProfile().briefingsSeen)[0];
    if (next) openFieldManualBriefing(next.id);
  }

  function setTutorialLock(elementId, featureId, state) {
    const node = el(elementId);
    if (!node) return;
    const access = tutorialAccess?.(featureId) ?? { allowed: true };
    node.disabled = !access.allowed;
    node.setAttribute('aria-disabled', String(!access.allowed));
    node.classList.toggle('tutorial-locked', !access.allowed);
    if (!node.dataset.baseTitle) node.dataset.baseTitle = node.title ?? '';
    node.title = access.reason ?? node.dataset.baseTitle;
  }

  function applyTutorialLocks(state) {
    const controls = [
      ['tab-galaxy', 'galaxy_view'],
      ['tab-system', 'system_view'],
      ['tab-fleet', 'fleet'],
      ['tab-logistics', 'logistics'],
      ['tab-tech', 'research'],
      ['tab-dyson', 'dyson'],
      ['tab-diplomacy', 'diplomacy'],
      ['tab-operations', 'operations'],
      ['tab-campaign', 'campaign_help'],
      ['build-outpost-btn', 'outpost'],
      ['build-shipyard-btn', 'shipyard'],
      ['queue-scout-btn', 'scout_queue'],
      ['build-foundry-btn', 'dyson'],
      ['build-launcher-btn', 'dyson'],
      ['build-research-btn', 'research'],
      ['builder-drone-deploy-btn', 'operations'],
      ['enter-wormhole-btn', 'wormholes'],
      ['build-anchor-btn', 'wormholes'],
      ['sw-create-btn', 'superweapon'],
      ['sw-destroy-btn', 'superweapon'],
      ['sw-jump-btn', 'superweapon'],
      ['combat-hud-advanced-toggle', 'tactical_combat'],
      ['combat-hud-move', 'tactical_combat'],
      ['combat-hud-attack', 'tactical_combat'],
      ['combat-hud-hold', 'tactical_combat'],
    ];
    for (const [elementId, featureId] of controls) setTutorialLock(elementId, featureId, state);
    setTutorialLock('view-toggle-btn', getView?.() === 'galaxy' ? 'system_view' : 'galaxy_view', state);
  }

  let sidePanel = null;
  const techUiState = {
    mounted: false,
    lastSnapshot: '',
    svg: null,
    fitView: null,
    graphWrap: null,
    detailEl: null,
    clusterFilter: null,
    searchQuery: '',
    tierFilter: '',
    stateFilter: '',
  };

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
    tutorialGuide: '',
    logisticsPanel: '',
    combatCommand: '',
    techPanel: '',
    diplomacyPanel: '',
    operationsPanel: '',
    campaignPanel: '',
    dysonPanel: '',
    buildPanel: '',
    starBuildPanel: '',
    wormholeBuildPanel: '',
    builderDroneGalaxyPanel: '',
  };
  let dronePlannerSystemId = null;
  let dronePlannerDraft = [];
  let dronePlannerResumeOnClose = false;
  let nextDronePlannerDraftId = 1;
  let uiPointerActive = false;
  window.addEventListener('pointerdown', () => { uiPointerActive = true; }, true);
  window.addEventListener('pointerup', () => { uiPointerActive = false; }, true);
  window.addEventListener('pointercancel', () => { uiPointerActive = false; }, true);

  function closeDronePlanner({ resume = true } = {}) {
    if (dronePlannerSystemId) setBuilderDronesAwaitingOrders?.(dronePlannerSystemId, false);
    el('drone-planner')?.classList.add('hidden');
    el('drone-planner-backdrop')?.classList.add('hidden');
    const shouldResume = dronePlannerResumeOnClose && resume;
    dronePlannerSystemId = null;
    dronePlannerDraft = [];
    dronePlannerResumeOnClose = false;
    if (shouldResume) getState().paused = false;
  }

  function addDronePlannerJob(bodyId, structureType, targetLabel = null) {
    dronePlannerDraft.push({
      clientId: `planner-${nextDronePlannerDraftId++}`,
      bodyId,
      structureType,
      targetLabel,
    });
    renderDronePlanner();
  }

  function renderDronePlanner() {
    if (!dronePlannerSystemId) return;
    const state = getState();
    const system = systemById(state, dronePlannerSystemId);
    const catalog = getDroneConstructionCatalog?.(dronePlannerSystemId, dronePlannerDraft)
      ?? { ok: false, reason: 'Construction catalog unavailable', targets: [], draftResults: [] };
    el('drone-planner-title').textContent = `Construction Planner · ${system?.name ?? dronePlannerSystemId}`;
    const stationed = (state.builderDrones ?? []).filter(
      (drone) => drone.systemId === dronePlannerSystemId && drone.status === 'idle',
    ).length;
    el('drone-planner-summary').innerHTML =
      `<p class="panel-note">${stationed} idle construction drone${stationed === 1 ? '' : 's'} stationed here. Jobs run in parallel by available drone count.</p>`;

    const catalogEl = el('drone-planner-catalog');
    clearChildren(catalogEl);
    const allTypes = new Map();
    for (const target of catalog.targets ?? []) {
      const card = document.createElement('section');
      card.className = 'drone-planner__target';
      const heading = document.createElement('div');
      heading.className = 'intel-section-title';
      heading.textContent = `${target.label} · ${target.kind}`;
      card.appendChild(heading);
      for (const building of target.buildings ?? []) {
        if (!allTypes.has(building.type)) allTypes.set(building.type, building.label);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost btn--block btn--sm';
        button.disabled = !building.ok;
        button.textContent = `${building.label} · ${building.cost} cr`;
        button.title = building.ok ? `Add ${building.label} to this target` : building.reason;
        button.onclick = () => addDronePlannerJob(target.id, building.type, target.label);
        card.appendChild(button);
        if (!building.ok) {
          const reason = document.createElement('div');
          reason.className = 'panel-note panel-note--muted';
          reason.textContent = building.reason;
          card.appendChild(reason);
        }
      }
      catalogEl.appendChild(card);
    }

    const bulk = el('drone-planner-bulk');
    clearChildren(bulk);
    for (const [type, label] of allTypes) {
      const eligible = (catalog.targets ?? []).filter(
        (target) => target.buildings?.some((building) => building.type === type && building.ok),
      );
      if (eligible.length < 2) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost btn--sm';
      button.textContent = `${label}: all eligible (${eligible.length})`;
      button.onclick = () => {
        for (const target of eligible) {
          dronePlannerDraft.push({
            clientId: `planner-${nextDronePlannerDraftId++}`,
            bodyId: target.id,
            structureType: type,
            targetLabel: target.label,
          });
        }
        renderDronePlanner();
      };
      bulk.appendChild(button);
    }

    const draftEl = el('drone-planner-draft');
    clearChildren(draftEl);
    const resultById = new Map((catalog.draftResults ?? []).map((result) => [result.clientId, result]));
    let total = 0;
    dronePlannerDraft.forEach((draft, index) => {
      const result = resultById.get(draft.clientId);
      total += result?.cost ?? 0;
      const row = document.createElement('div');
      row.className = 'list-row';
      const target = (catalog.targets ?? []).find((entry) => entry.id === draft.bodyId);
      row.innerHTML = `<div class="list-row__main"><div class="list-row__title">${index + 1}. ${draft.structureType.replaceAll('_', ' ')}</div><div class="list-row__sub">${draft.targetLabel ?? target?.label ?? 'System'} · ${result?.cost ?? 0} cr${result?.ok === false ? ` · ${result.reason}` : ''}</div></div>`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn--ghost btn--xs';
      remove.textContent = 'Remove';
      remove.onclick = () => {
        dronePlannerDraft.splice(index, 1);
        renderDronePlanner();
      };
      row.appendChild(remove);
      draftEl.appendChild(row);
    });

    const ordersEl = el('drone-planner-orders');
    clearChildren(ordersEl);
    const existing = (state.builderConstructionOrders ?? []).filter(
      (order) => order.systemId === dronePlannerSystemId && ['queued', 'active'].includes(order.status),
    );
    if (existing.length) {
      const title = document.createElement('div');
      title.className = 'intel-section-title';
      title.textContent = 'Confirmed Orders';
      ordersEl.appendChild(title);
    }
    for (const order of existing) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `<div class="list-row__main"><div class="list-row__title">${order.structureType.replaceAll('_', ' ')}</div><div class="list-row__sub">${order.status} · ${Math.round((order.workDoneMs / Math.max(1, order.workRequiredMs)) * 100)}%</div></div>`;
      if (order.status === 'queued') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn--ghost btn--xs';
        cancel.textContent = 'Cancel';
        cancel.onclick = () => {
          const result = cancelBuilderConstructionOrder?.(order.id);
          toast(result?.ok ? `Order canceled · ${result.refunded} cr refunded` : result?.reason, result?.ok ? 'ok' : 'error');
          renderDronePlanner();
        };
        row.appendChild(cancel);
      }
      ordersEl.appendChild(row);
    }

    const invalid = (catalog.draftResults ?? []).some((result) => !result.ok);
    el('drone-planner-total').textContent = `Reserved on confirmation: ${total} credits · ${dronePlannerDraft.length} job${dronePlannerDraft.length === 1 ? '' : 's'}`;
    const confirm = el('drone-planner-confirm');
    confirm.disabled = dronePlannerDraft.length === 0 || invalid || state.credits < total;
    confirm.title = invalid ? 'Resolve invalid jobs before confirming' : state.credits < total ? `Need ${total} credits` : '';
  }

  function openDronePlanner(systemId, { auto = false } = {}) {
    if (!systemId || !systemById(getState(), systemId)) return;
    dronePlannerSystemId = systemId;
    dronePlannerDraft = [];
    dronePlannerResumeOnClose = auto;
    getState().paused = true;
    el('drone-planner')?.classList.remove('hidden');
    el('drone-planner-backdrop')?.classList.remove('hidden');
    renderDronePlanner();
  }

  el('drone-planner-close')?.addEventListener('click', () => closeDronePlanner());
  el('drone-planner-backdrop')?.addEventListener('click', () => closeDronePlanner());
  el('drone-planner-confirm')?.addEventListener('click', () => {
    if (!dronePlannerSystemId) return;
    const result = confirmBuilderConstructionPlan?.(dronePlannerSystemId, dronePlannerDraft);
    if (!result?.ok) {
      toast(result?.reason ?? 'Construction plan failed', 'error');
      renderDronePlanner();
      return;
    }
    toast(`${result.orders.length} construction job${result.orders.length === 1 ? '' : 's'} confirmed`, 'ok');
    closeDronePlanner();
  });

  function constructionUiSnapshot(state, systemId, bodyId = null) {
    const system = systemById(state, systemId);
    return JSON.stringify({
      systemId,
      bodyId,
      owner: system?.owner,
      factionId: system?.factionId ?? null,
      affordable: CONSTRUCTION_AFFORDABILITY_THRESHOLDS.map((cost) => (state.credits ?? 0) >= cost),
      unlockedCount: state.research?.unlocked?.length ?? 0,
      flagship: [state.flagship?.galaxyId, state.flagship?.systemId, !!state.flagship?.transit, !!state.flagship?.wormholeTransit],
      structures: (system?.structures ?? []).map((structure) => [
        structure.id, structure.type, structure.bodyId ?? null, structure.level ?? 1,
        !!structure.construction, (structure.hp ?? 1) > 0,
        (structure.disabledUntil ?? 0) > state.time, !!structure.mothballed, structure.operational !== false,
      ]),
      jobs: (state.constructionJobs ?? [])
        .filter((job) => job.systemId === systemId)
        .map((job) => [job.id, job.structureType, job.bodyId, job.status]),
      drones: (state.builderDrones ?? []).map((drone) => [drone.id, drone.status, drone.targetSystemId, drone.buildType]),
      dyson: [system?.dyson?.completedShells ?? 0, !!system?.dyson?.disabled],
    });
  }

  function setTutorialTarget(targetId) {
    document.querySelectorAll('.tutorial-target').forEach((node) => {
      node.classList.remove('tutorial-target');
    });
    if (!targetId) return null;
    const node = el(targetId);
    if (!node || node.classList.contains('hidden') || node.offsetParent === null) return null;
    node.classList.add('tutorial-target');
    return node;
  }

  function positionTutorialCoach(coach, anchor, placement = 'left') {
    const rect = anchor.getBoundingClientRect();
    const gap = 12;
    coach.style.visibility = 'hidden';
    coach.classList.remove('hidden');
    const tip = coach.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    if (placement === 'left') {
      left = rect.left - tip.width - gap;
      top = rect.top + rect.height / 2 - 22;
    } else if (placement === 'right') {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - 22;
    } else if (placement === 'top') {
      left = rect.left + rect.width / 2 - tip.width / 2;
      top = rect.top - tip.height - gap;
    } else {
      left = rect.left + rect.width / 2 - tip.width / 2;
      top = rect.bottom + gap;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - tip.height - 8));
    coach.style.transform = '';
    coach.style.left = `${Math.round(left)}px`;
    coach.style.top = `${Math.round(top)}px`;
    coach.dataset.placement = placement;
    coach.style.visibility = 'visible';
  }

  function renderTutorialGuide(state, phase) {
    const coach = el('tutorial-coach');
    if (!coach) return;
    const tutorial = getTutorialState(state);
    if (phase !== 'playing' || !tutorial.active || !tutorial.current) {
      coach.classList.add('hidden');
      setTutorialTarget(null);
      uiSnapshots.tutorialGuide = '';
      return;
    }

    const current = tutorial.current;
    const anchor = setTutorialTarget(current.uiTargetId);
    const snapshot = JSON.stringify({
      step: tutorial.step,
      title: current.title,
      status: current.status,
      canConfirm: current.canConfirm,
      readyToFinish: current.readyToFinish,
      target: current.uiTargetId,
      anchorVisible: !!anchor,
    });
    if (snapshot !== uiSnapshots.tutorialGuide) {
      uiSnapshots.tutorialGuide = snapshot;
      clearChildren(coach);

      const meta = document.createElement('div');
      meta.className = 'tutorial-coach__meta';
      const step = document.createElement('span');
      step.className = 'tutorial-coach__step';
      step.textContent = `${current.index + 1}/${tutorial.totalSteps}`;
      meta.appendChild(step);

      const title = document.createElement('h2');
      title.className = 'tutorial-coach__title';
      title.textContent = current.title;

      const copy = document.createElement('p');
      copy.className = 'tutorial-coach__copy';
      copy.textContent = current.objective;

      const status = document.createElement('p');
      status.className = 'tutorial-coach__copy';
      status.textContent = current.status;

      const actions = document.createElement('div');
      actions.className = 'tutorial-coach__actions';
      if (current.readyToFinish) {
        const finish = document.createElement('button');
        finish.type = 'button';
        finish.className = 'btn btn--primary btn--xs';
        finish.textContent = 'Graduate';
        finish.onclick = async () => {
          const result = await doBeginTutorialGraduation?.();
          if (result?.ok) openGraduationModal();
          else toast(result?.reason ?? 'Could not graduate', 'error');
        };
        actions.appendChild(finish);
      } else if (current.canConfirm) {
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'btn btn--primary btn--xs';
        confirm.textContent = 'Continue';
        confirm.onclick = () => {
          const result = acknowledgeTutorialStep(getState());
          toast(result.ok ? 'Continue' : result.reason, result.ok ? 'ok' : 'error');
        };
        actions.appendChild(confirm);
      } else if (current.actionLabel) {
        const focus = document.createElement('button');
        focus.type = 'button';
        focus.className = 'btn btn--primary btn--xs';
        focus.textContent = 'Show';
        focus.onclick = () => {
          closeSidePanel();
          const result = doFocusTutorial?.();
          if (!result?.ok) toast(result?.reason ?? 'Tutorial target unavailable', 'error');
        };
        actions.appendChild(focus);
      }

      if (!current.readyToFinish && tutorialGraduated() && getState().campaign?.tutorial?.replay) {
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'btn btn--ghost btn--xs tutorial-coach__skip';
        skip.textContent = 'Skip';
        skip.onclick = () => {
          const result = finishTutorial(getState(), { skipped: true, allowReplayExit: true });
          toast(result.ok ? 'Tutorial replay ended' : result.reason, result.ok ? 'info' : 'error');
        };
        actions.appendChild(skip);
      }

      coach.append(meta, title, copy, status, actions);
    }

    if (anchor) {
      positionTutorialCoach(coach, anchor, current.placement ?? 'left');
    } else {
      coach.classList.remove('hidden');
      coach.style.left = '50%';
      coach.style.top = '72px';
      coach.style.transform = 'translateX(-50%)';
      coach.dataset.placement = 'bottom';
      coach.style.visibility = 'visible';
    }
  }

  function queueHullFromUi(hull) {
    const access = tutorialAccess?.(hull === 'scout' ? 'scout_queue' : 'combat_ship_queue') ?? { allowed: true };
    if (!access.allowed) {
      toast(access.reason, 'error');
      return access;
    }
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
        return;
      }
      const droneTarget = e.target.closest('[data-builder-drone-select]');
      if (droneTarget?.dataset.builderDroneSelect && !e.target.closest('button,select,input')) {
        e.preventDefault();
        doSelectBuilderDrone?.(droneTarget.dataset.builderDroneSelect);
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
    markTutorialSystemViewed(getState());
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
  el('tab-logistics')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'logistics' ? null : 'logistics';
    if (sidePanel === 'logistics') markTutorialLogisticsOpened(getState());
  });
  el('tab-diplomacy')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'diplomacy' ? null : 'diplomacy';
  });
  el('tab-operations')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'operations' ? null : 'operations';
  });
  el('tab-campaign')?.addEventListener('click', () => {
    if (sidePanel === 'tech') resetTechUiState();
    sidePanel = sidePanel === 'campaign' ? null : 'campaign';
  });
  for (const [id, key] of [['overlay-threat', 'threat'], ['overlay-sensor', 'sensor'], ['overlay-blockade', 'blockade']]) {
    el(id)?.addEventListener('click', () => {
      const state = getState();
      state.mapOverlays = { threat: true, sensor: false, blockade: true, ...(state.mapOverlays ?? {}) };
      state.mapOverlays[key] = !state.mapOverlays[key];
    });
  }

  el('build-trade-btn')?.addEventListener('click', () => {
    const sel = getSelection();
    if (sel) {
      const res = buildTradeStation(getState(), getViewedSystemId(), sel);
      if (!res.ok) toast(res.reason, 'error');
      else toast('Export depot built', 'ok');
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
    const access = tutorialAccess?.('scout_queue') ?? { allowed: true };
    if (!access.allowed) { toast(access.reason, 'error'); return; }
    const res = enqueueHull(getState(), 'scout');
    if (!res.ok) toast(res.reason, 'error');
    else toast('Queued scout', 'ok');
  });

  el('sw-create-btn')?.addEventListener('click', () => {
    const st = getState();
    const anchor = getHelioclastFireTarget(
      { getGalaxyTargetStar, getViewedSystemId },
      st,
      { allowStrongholdFallback: true },
    );
    const res = superweaponCreate(st, anchor);
    toast(res.ok ? (res.pending ? 'Create sequence started…' : 'Star created') : res.reason, res.ok ? 'ok' : 'error');
  });
  el('sw-destroy-btn')?.addEventListener('click', () => {
    const target = getHelioclastFireTarget(
      { getGalaxyTargetStar, getViewedSystemId },
      getState(),
    );
    if (!target) { toast('Click a target star on the map', 'error'); return; }
    const res = superweaponDestroy(getState(), target);
    toast(res.ok ? (res.pending ? 'Destroy sequence started…' : 'System destroyed') : res.reason, res.ok ? 'ok' : 'error');
  });
  el('sw-jump-btn')?.addEventListener('click', () => {
    const target = getHelioclastFireTarget(
      { getGalaxyTargetStar, getViewedSystemId },
      getState(),
    );
    if (!target) { toast('Click a target star on the map', 'error'); return; }
    const res = superweaponJump(getState(), target);
    toast(res.ok ? (res.pending ? 'Jump sequence started…' : 'Helioclast jumped') : res.reason, res.ok ? 'ok' : 'error');
  });

  const newGameModal = el('new-game-modal');
  const newGameBackdrop = el('new-game-modal-backdrop');
  const titleScreen = el('title-screen');

  function configureNewGameModal(flow = 'custom') {
    const graduation = flow === 'graduation';
    newGameModal.dataset.flow = flow;
    const title = el('new-game-modal-title');
    const note = el('new-game-modal-note');
    const start = el('new-game-sandbox-btn');
    if (title) title.textContent = graduation ? 'Academy Graduation' : 'Custom Campaign';
    if (note) note.textContent = graduation
      ? 'Choose the victory condition and rival difficulty for this continuing empire.'
      : 'Choose how to begin your reign.';
    if (start) start.textContent = graduation ? 'Continue Campaign' : 'Sandbox';
    el('new-game-tutorial-btn')?.classList.toggle('hidden', graduation);
    el('new-game-missions-btn')?.classList.toggle('hidden', graduation);
    el('close-new-game-btn')?.classList.toggle('hidden', graduation);
  }

  function openNewGameModal(flow = 'custom') {
    configureNewGameModal(flow);
    titleScreen?.classList.add('hidden');
    newGameModal?.classList.remove('hidden');
    newGameBackdrop?.classList.remove('hidden');
  }
  function closeNewGameModal() {
    if (newGameModal?.dataset.flow === 'graduation') return;
    newGameModal?.classList.add('hidden');
    newGameBackdrop?.classList.add('hidden');
    if (getBootPhase?.() === 'title') titleScreen?.classList.remove('hidden');
  }

  function openGraduationModal() {
    openNewGameModal('graduation');
  }

  function refreshTitleTutorialAccess() {
    const graduated = tutorialGraduated();
    const titleLocks = [
      ['title-custom-campaign-btn', 'Custom Campaign'],
      ['title-missions-btn', 'Missions'],
      ['title-sandbox-btn', 'Sandbox'],
    ];
    for (const [id, label] of titleLocks) {
      const button = el(id);
      if (!button) continue;
      button.disabled = !graduated;
      button.setAttribute('aria-disabled', String(!graduated));
      button.classList.toggle('tutorial-locked', !graduated);
      button.title = graduated ? `Open ${label}` : `Complete the Academy tutorial to unlock ${label}`;
    }
  }
  function showTitleScreen() {
    titleScreen?.classList.remove('hidden');
    setBootPhase?.('title');
    getState().paused = true;
  }

  el('title-new-campaign-btn')?.addEventListener('click', async () => {
    await loadProfile();
    if (tutorialGraduated()) openNewGameModal('custom');
    else doStartNewGame?.({ mode: 'tutorial', victoryType: 'sandbox' });
  });
  el('title-custom-campaign-btn')?.addEventListener('click', async () => {
    await loadProfile();
    if (!tutorialGraduated()) {
      toast('Complete the Academy tutorial to unlock Custom Campaign', 'error');
      return;
    }
    openNewGameModal('custom');
  });
  for (const id of ['title-missions-btn', 'title-sandbox-btn']) {
    el(id)?.addEventListener('click', async () => {
      await loadProfile();
      if (!tutorialGraduated()) {
        toast('Complete the Academy tutorial to unlock this campaign mode', 'error');
        return;
      }
      openNewGameModal('custom');
    });
  }
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

  refreshTitleTutorialAccess();
  showTitleScreen();
  loadProfile().then(refreshTitleTutorialAccess);
  window.addEventListener('gs-profile-changed', refreshTitleTutorialAccess);
  el('close-new-game-btn')?.addEventListener('click', closeNewGameModal);
  newGameBackdrop?.addEventListener('click', closeNewGameModal);
  el('new-game-sandbox-btn')?.addEventListener('click', () => {
    const vt = el('new-game-victory')?.value ?? 'sandbox';
    const aiDifficulty = el('new-game-ai-difficulty')?.value ?? 'normal';
    if (newGameModal?.dataset.flow === 'graduation') {
      const result = doCompleteTutorialGraduation?.({ victoryType: vt, aiDifficulty });
      if (result?.ok) {
        newGameModal.dataset.flow = 'custom';
        newGameModal.classList.add('hidden');
        newGameBackdrop?.classList.add('hidden');
        configureNewGameModal('custom');
        refreshTitleTutorialAccess();
      } else toast(result?.reason ?? 'Could not continue campaign', 'error');
      return;
    }
    doStartNewGame?.({ mode: 'sandbox', victoryType: vt, aiDifficulty });
    closeNewGameModal();
  });
  el('new-game-tutorial-btn')?.addEventListener('click', () => {
    const aiDifficulty = el('new-game-ai-difficulty')?.value ?? 'normal';
    doStartNewGame?.({ mode: 'tutorial', victoryType: 'sandbox', aiDifficulty });
    closeNewGameModal();
  });
  el('new-game-missions-btn')?.addEventListener('click', () => {
    if (!tutorialGraduated()) { toast('Complete the Academy tutorial to unlock Missions', 'error'); return; }
    const aiDifficulty = el('new-game-ai-difficulty')?.value ?? 'normal';
    doStartNewGame?.({ mode: 'mission', victoryType: 'dominion', aiDifficulty });
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
    const resolveNote = takeSuperweaponResolveNotify(state);
    if (resolveNote) {
      const formatted = formatSwResolveToast(resolveNote);
      if (formatted) toast(formatted.msg, formatted.kind);
    }
    const selection = getSelection();
    const view = getView();
    const viewedSystemId = getViewedSystemId();
    const viewedSystem = systemById(state, viewedSystemId);
    const selectedScoutId = getSelectedScoutId();
    const selectedBuilderDroneId = getSelectedBuilderDroneId?.() ?? null;

    const pendingPlannerDrone = (state.builderDrones ?? []).find(
      (drone) => drone.awaitingOrders && drone.status === 'idle' && drone.systemId,
    );
    const otherModalOpen = [...document.querySelectorAll('.panel--modal:not(.hidden)')]
      .some((node) => node.id !== 'drone-planner');
    if (pendingPlannerDrone && el('drone-planner')?.classList.contains('hidden') && !otherModalOpen) {
      openDronePlanner(pendingPlannerDrone.systemId, { auto: true });
    }

    el('credits-value').textContent = Math.floor(state.credits).toLocaleString();
    const logistics = logisticsSummary(state);
    el('income-value').textContent = incomePerSecond(state).toFixed(1);

    let contextualViewHint = HINTS[view];
    if (view === 'system' && viewedSystemId && isPlayerOwned(state, viewedSystemId)) {
      const ds = droneSummaryForSystem(state, viewedSystemId);
      const jobs = activeJobsInSystem(state, viewedSystemId);
      contextualViewHint += ` · Drones ${ds.active}/${ds.capacity} · ${jobs.length} job${jobs.length === 1 ? '' : 's'}`;
    }

    const solariiChip = el('solarii-chip');
    if (state.solariiUnlocked) {
      solariiChip.classList.remove('hidden');
      el('solarii-value').textContent = (state.solarii ?? 0).toFixed(2);
      el('solarii-rate').textContent = solariiPerSecond(state).toFixed(3);
    } else {
      solariiChip.classList.add('hidden');
    }

    const tradeChip = el('trade-chip');
    tradeChip.classList.toggle('hidden', logistics.depotCount === 0 && logistics.deliveredCredits === 0);
    el('trade-income-value').textContent = (logistics.throughputCreditsPerMinute / 60).toFixed(1);
    const logisticsChip = el('logistics-chip');
    logisticsChip?.classList.toggle('hidden', logistics.depotCount === 0 && logistics.activeConvoyCount === 0);
    if (el('cargo-transit-value')) el('cargo-transit-value').textContent = String(logistics.activeConvoyCount);

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
    const operationsScreen = el('operations-screen');
    const campScreen = el('campaign-screen');
    el('tech-panel')?.classList.add('hidden');
    if (sidePanel === 'tech') {
      techScreen?.classList.remove('hidden');
      const summary = researchSummary(state);
      const techSnap = JSON.stringify({
        unlocked: summary.unlocked,
        active: summary.activeNodeId,
        queue: summary.queue,
        stations: summary.stationCount,
        speed: summary.speedMult,
      });
      if (techSnap !== uiSnapshots.techPanel && !uiPointerActive) {
        uiSnapshots.techPanel = techSnap;
        renderTechScreen(el('tech-screen-body'), state, techUiState);
      } else {
        const progressFill = techScreen?.querySelector('.progress-block .progress__fill');
        if (progressFill) progressFill.style.width = `${Math.round(summary.progress * 100)}%`;
      }
    } else {
      techScreen?.classList.add('hidden');
      uiSnapshots.techPanel = '';
    }
    if (sidePanel === 'diplomacy') {
      diploScreen?.classList.remove('hidden');
      const diplomacyState = diplomacyPanelSnapshot(state);
      const diploSnap = JSON.stringify({
        version: diplomacyState.version,
        revision: diplomacyState.revision,
        unlocked: diplomacyState.unlocked,
        tech: diplomacyState.tech,
      });
      const diplomacyMounted = !!diploScreen?.querySelector('#diplomacy-command-screen');
      // Diplomacy actions refresh their own mounted screen. Holding the live
      // command DOM stable between actions prevents background relationship
      // ticks from detaching buttons while the player is trying to click them.
      if (!diplomacyMounted || (diploSnap !== uiSnapshots.diplomacyPanel && !uiPointerActive)) {
        uiSnapshots.diplomacyPanel = diploSnap;
        renderDiplomacyCommandScreen(el('diplomacy-screen-body'), state, {
          getGalaxyTargetStar,
          toast,
        });
      } else uiSnapshots.diplomacyPanel = diploSnap;
    } else {
      diploScreen?.classList.add('hidden');
      uiSnapshots.diplomacyPanel = '';
    }
    if (sidePanel === 'operations') {
      operationsScreen?.classList.remove('hidden');
      const operationsSnap = JSON.stringify(operationsPanelSnapshot(state));
      const operationsMounted = !!operationsScreen?.querySelector('#operations-command-screen');
      const operationsInteracting = operationsMounted && (uiPointerActive
        || operationsScreen?.matches(':hover')
        || operationsScreen?.contains(document.activeElement));
      if (operationsSnap !== uiSnapshots.operationsPanel && !operationsInteracting) {
        uiSnapshots.operationsPanel = operationsSnap;
        renderOperationsPanel(el('operations-screen-body'), state, {
          getGalaxyTargetStar,
          toast,
        });
      }
    } else {
      operationsScreen?.classList.add('hidden');
      uiSnapshots.operationsPanel = '';
    }
    if (sidePanel === 'campaign') {
      campScreen?.classList.remove('hidden');
      const campaignSuperweapon = superweaponSummary(state);
      const campaignSnap = JSON.stringify({
        campaign: campaignSummary(state),
        milestones: milestonesSummary(state),
        superweapon: {
          online: campaignSuperweapon.online,
          cradleSystemId: campaignSuperweapon.cradleSystemId,
          createCount: campaignSuperweapon.createCount,
          lastAction: campaignSuperweapon.lastAction,
        },
        missions: state.missions,
        profileTutorialGraduated: tutorialGraduated(),
        profileBriefingsSeen: currentProfile().briefingsSeen,
      });
      if (campaignSnap !== uiSnapshots.campaignPanel && !uiPointerActive) {
        uiSnapshots.campaignPanel = campaignSnap;
        renderCampaignPanel(el('campaign-screen-body'), state, {
          openFieldManualBriefing,
          doStartNewGame,
          tutorialAccess,
          getGalaxyTargetStar,
          getViewedSystemId,
          toast,
        });
      }
    } else {
      campScreen?.classList.add('hidden');
      uiSnapshots.campaignPanel = '';
    }

    const fleetPanel = el('fleet-panel');
    if (sidePanel === 'fleet') {
      fleetPanel?.classList.remove('hidden');
      const fleetSnap = fleetPanelStructureSnapshot(
        state,
        getSelectedBattleGroupId?.() ?? null,
        selectedScoutId,
        selectedBuilderDroneId,
        fleetSubTab,
      );
      if (fleetSnap !== uiSnapshots.fleetPanel) {
        uiSnapshots.fleetPanel = fleetSnap;
        renderFleetPanel(el('fleet-panel-body'), state, {
          getSelectedScoutId,
          doSelectScout,
          getSelectedBuilderDroneId,
          doSelectBuilderDrone,
          getSelectedBattleGroupId,
          doSelectBattleGroup,
          createBattleGroup,
          deleteBattleGroup,
          builderDroneSummary,
          cancelBuilderDrone,
          openBuilderDronePlanner: (systemId) => openDronePlanner(systemId, { auto: false }),
          doToggleWingHangar,
          getFleetSubTab: () => fleetSubTab,
          setFleetSubTab: (id) => {
            fleetSubTab = id;
            uiSnapshots.fleetPanel = '';
          },
          getViewedSystemId,
          getGalaxyTargetStar,
          toast,
        });
      } else {
        updateFleetPanelLabels(
          state,
          selectedScoutId,
          getSelectedBattleGroupId?.() ?? null,
          selectedBuilderDroneId,
        );
      }
    } else {
      fleetPanel?.classList.add('hidden');
      uiSnapshots.fleetPanel = '';
    }

    const logisticsPanel = el('logistics-panel');
    if (sidePanel === 'logistics') {
      logisticsPanel?.classList.remove('hidden');
      const logisticsSnap = JSON.stringify({
        time: Math.floor(state.time / 1000),
        summary: logistics,
        depots: state.logistics?.depots,
        convoys: activeConvoys(state),
      });
      if (logisticsSnap !== uiSnapshots.logisticsPanel) {
        uiSnapshots.logisticsPanel = logisticsSnap;
        renderLogisticsPanel(el('logistics-panel-body'), state, { onFollowConvoy: followConvoy });
      }
    } else {
      logisticsPanel?.classList.add('hidden');
      uiSnapshots.logisticsPanel = '';
    }

    const activeBattle = view === 'system' ? getBattleState(state, viewedSystemId) : null;
    const showCombatUi = !!combatUiActive?.()
      || (view === 'system' && !!activeBattle?.active && activeBattle.mode === 'tactical');
    el('hud')?.classList.toggle('hud--combat', showCombatUi && phase === 'playing');
    const combatHud = el('combat-hud');
    combatHud?.classList.toggle('hidden', !(showCombatUi && phase === 'playing'));
    if (showCombatUi && phase === 'playing' && activeBattle) {
      renderCombatHud(state, activeBattle, viewedSystem?.name, {
        issueTacticalOrder,
        setCombatDoctrine,
        setCombatPriority,
        setAdvancedTactics,
        getFlagshipControlStatus,
        getCombatSelection,
        getCombatCommandMode,
        setCombatCommandMode,
        cancelTacticalRetreat,
        getCombatCinemaState,
        setCombatCinema,
        doTogglePause,
        doToggleView,
      });
    }

    const combatPanel = el('combat-command-panel');
    combatPanel?.classList.add('hidden');
    uiSnapshots.combatCommand = '';

    el('pause-btn').querySelector('.btn-label').textContent = state.paused ? 'Resume' : 'Pause';
    el('pause-overlay').classList.toggle('hidden', !state.paused || phase !== 'playing');
    el('view-toggle-btn').querySelector('.btn-label').textContent =
      view === 'galaxy' ? 'System View (M)' : 'Galaxy Map (M)';
    el('view-hint').textContent = contextualViewHint;
    updateTabBar(view, sidePanel);
    const overlays = { threat: true, sensor: false, blockade: true, ...(state.mapOverlays ?? {}) };
    el('overlay-controls')?.classList.toggle('hidden', view !== 'galaxy');
    el('overlay-threat')?.classList.toggle('overlay-toggle--active', overlays.threat);
    el('overlay-sensor')?.classList.toggle('overlay-toggle--active', overlays.sensor);
    el('overlay-blockade')?.classList.toggle('overlay-toggle--active', overlays.blockade);

    const commandMode = el('command-mode');
    const commandDetail = el('command-detail');
    if (activeBattle?.active) {
      commandMode.textContent = 'Tactical command';
      const lastOrder = activeFleetOrders(activeBattle, 'player').at(-1);
      commandDetail.textContent = lastOrder
        ? `Order #${lastOrder.sequence}: ${lastOrder.type.replaceAll('_', ' ')}`
        : 'Battle active — set formation and target priorities.';
    } else if (logistics.activeConvoyCount > 0) {
      commandMode.textContent = 'Logistics command';
      commandDetail.textContent = `${logistics.activeConvoyCount} convoy${logistics.activeConvoyCount === 1 ? '' : 's'} active · ${cargoTotal(logistics.cargoInTransit).toFixed(1)} cargo in transit`;
    } else {
      commandMode.textContent = state.paused ? 'Paused order phase' : 'Strategic command';
      commandDetail.textContent = state.paused
        ? 'Issue orders while simulation time is stopped.'
        : 'Select a fleet, system, or convoy for contextual orders.';
    }

    const swGalaxyPanel = el('superweapon-galaxy-panel');
    const builderDroneGalaxyPanel = el('builder-drone-galaxy-panel');
    const ms = milestonesSummary(state);
    if (view === 'galaxy' && ms.superweaponUnlocked) {
      swGalaxyPanel?.classList.remove('hidden');
      const sw = superweaponSummary(state);
      const seq = sw.fireSequence;
      const fireCtx = { getGalaxyTargetStar, getViewedSystemId };
      const targetId = getHelioclastFireTarget(fireCtx, state, { allowStrongholdFallback: true });
      const displayTargetId = seq?.targetSystemId ?? targetId;
      const targetSystem = targetId ? systemById(state, targetId) : null;
      const targetName = seq?.targetName ?? (targetId ? (targetSystem?.name ?? targetId) : 'No target selected');
      const targetOwnerId = seq?.targetOwner ?? targetSystem?.owner;
      const targetOwner = targetOwnerId === 'player' ? 'Sovereign territory'
        : targetOwnerId === 'ai' ? 'Hostile territory'
          : (targetSystem || seq) ? 'Unclaimed system' : 'Click any star to acquire target';
      const firingSystemId = sw.fireSequence?.fromSystemId ?? sw.ship?.systemId ?? sw.cradleSystemId;
      const firingSystemName = firingSystemId
        ? (systemById(state, firingSystemId)?.name ?? firingSystemId)
        : (sw.ship?.transit ? 'In transit' : 'Berth');
      const createCheck = targetId ? canSuperweaponAction(state, 'create', targetId) : { ok: false };
      const destroyCheck = targetId ? canSuperweaponAction(state, 'destroy', targetId) : { ok: false };
      const jumpCheck = targetId ? canSuperweaponAction(state, 'jump', targetId) : { ok: false };
      const statusEl = el('sw-panel-status');
      if (statusEl) {
        statusEl.textContent = seq
          ? String(seq.phase ?? 'firing').replaceAll('_', ' ')
          : sw.online ? (sw.cooldownMs > 0 ? `CD ${Math.ceil(sw.cooldownMs / 1000)}s` : 'Weapons free') : 'Offline';
        statusEl.classList.toggle('is-firing', !!seq);
        statusEl.classList.toggle('is-offline', !sw.online);
      }
      const phaseOrder = ['charge', 'aim', 'fire', 'impact', 'aftermath'];
      const phaseIndex = seq ? phaseOrder.indexOf(seq.phase) : -1;
      const remainingMs = seq
        ? Math.max(0, seq.totalMs - (state.time - seq.startedAt))
        : 0;
      const sequenceMarkup = seq
        ? `<div class="sw-sequence sw-sequence--${escapeMarkup(seq.type)}">`
          + `<div class="sw-sequence__top"><span class="sw-sequence__title">${escapeMarkup(seq.type)} sequence · ${escapeMarkup(seq.phase)}</span>`
          + `<span class="sw-sequence__eta">${(remainingMs / 1000).toFixed(1)}s</span></div>`
          + `<div class="sw-sequence__track" role="progressbar" aria-label="Firing sequence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((seq.totalProgress ?? 0) * 100)}">`
          + `<div class="sw-sequence__fill" style="width:${Math.round((seq.totalProgress ?? 0) * 100)}%"></div></div>`
          + `<div class="sw-sequence__phases">${phaseOrder.map((phase, index) => `<span class="sw-sequence__phase${index < phaseIndex ? ' is-complete' : ''}${index === phaseIndex ? ' is-active' : ''}">${phase}</span>`).join('')}</div>`
          + `</div>`
        : `<p class="sw-guide"><strong>1.</strong> Click a star &nbsp;→&nbsp; <strong>2.</strong> Choose an effect</p>`;
      el('superweapon-galaxy-body').innerHTML =
        `<div class="sw-target"><span class="sw-target__eyebrow">Target lock</span>`
        + `<strong class="sw-target__name">${escapeMarkup(targetName)}</strong>`
        + `<span class="sw-target__meta">${escapeMarkup(targetOwner)} · ${escapeMarkup(displayTargetId ?? 'awaiting target')}</span></div>`
        + `<div class="sw-readouts">`
        + `<div class="sw-readout"><span class="sw-readout__label">Helioclast</span><strong class="sw-readout__value">${escapeMarkup(firingSystemName)}</strong></div>`
        + `<div class="sw-readout"><span class="sw-readout__label">Solarii</span><strong class="sw-readout__value">${Math.floor(state.solarii ?? 0)} ◈</strong></div>`
        + `<div class="sw-readout"><span class="sw-readout__label">Core</span><strong class="sw-readout__value">${sw.online ? (sw.cooldownMs > 0 ? `${Math.ceil(sw.cooldownMs / 1000)}s CD` : 'Ready') : 'Offline'}</strong></div>`
        + `</div>${sequenceMarkup}`;
      updateSuperweaponActionButton('create', createCheck, sw.costs?.create ?? 25, seq);
      updateSuperweaponActionButton('destroy', destroyCheck, sw.costs?.destroy ?? 30, seq);
      updateSuperweaponActionButton('jump', jumpCheck, sw.costs?.jump ?? 15, seq);
    } else {
      swGalaxyPanel?.classList.add('hidden');
    }

    const droneTargetId = getGalaxyTargetStar?.() ?? null;
    const droneTarget = droneTargetId ? systemById(state, droneTargetId) : null;
    if (view === 'galaxy' && droneTarget) {
      builderDroneGalaxyPanel?.classList.remove('hidden');
      const dronePanelSnap = JSON.stringify({
        targetId: droneTargetId,
        owner: droneTarget.owner,
        unlocked: state.research?.unlocked?.includes('eco_construction_drones') ?? false,
        canAffordDeploy: (state.credits ?? 0) >= 40,
        drones: (state.builderDrones ?? []).map((drone) => [
          drone.id, drone.status, drone.systemId, drone.targetSystemId,
        ]),
      });
      if (dronePanelSnap !== uiSnapshots.builderDroneGalaxyPanel && !uiPointerActive) {
        uiSnapshots.builderDroneGalaxyPanel = dronePanelSnap;
        const check = canDeployBuilderDrone?.(droneTargetId) ?? { ok: false, reason: 'Construction drones unavailable' };
        const summary = builderDroneSummary?.(state);
        el('builder-drone-galaxy-body').innerHTML =
          `<p class="panel-note">Target: <strong>${droneTarget.name ?? droneTargetId}</strong></p>`
          + `<p class="panel-note">${isPlayerOwned(state, droneTargetId) ? 'Claimed system' : 'Unclaimed — drones cannot deploy here.'}</p>`
          + `<p class="panel-note panel-note--muted">Idle drones: ${summary?.idle ?? 0}/${summary?.capacity ?? 0}. Deploy one, then open the system and choose its construction job.</p>`;
        const deployBtn = el('builder-drone-deploy-btn');
        deployBtn.disabled = !check.ok;
        deployBtn.textContent = `Deploy Builder Drone (${check.totalCost ?? 40} cr)`;
        deployBtn.title = check.ok ? 'Deploy an idle builder drone to this claimed system' : check.reason;
        deployBtn.onclick = () => deployBuilderDrone?.(droneTargetId);
      }
    } else {
      builderDroneGalaxyPanel?.classList.add('hidden');
      uiSnapshots.builderDroneGalaxyPanel = '';
    }

    const dysonPanel = el('dyson-panel');
    if (sidePanel === 'dyson' && view === 'system') {
      dysonPanel.classList.remove('hidden');
      const system = systemById(state, viewedSystemId);
      const dysonSnap = JSON.stringify({
        systemId: viewedSystemId,
        second: Math.floor(state.time / 1000),
        structures: system?.structures?.map((structure) => [structure.id, structure.type, structure.level, !!structure.construction]),
        shells: system?.dyson?.completedShells,
        sails: Math.floor(system?.dyson?.shellSails ?? 0),
        stock: Math.floor(system?.dyson?.foundryStock ?? 0),
      });
      if (dysonSnap !== uiSnapshots.dysonPanel && !uiPointerActive) {
        uiSnapshots.dysonPanel = dysonSnap;
        renderDysonPanel(el('dyson-panel-body'), state, viewedSystemId);
      }
    } else {
      dysonPanel.classList.add('hidden');
      uiSnapshots.dysonPanel = '';
    }

    el('system-name').textContent = view === 'galaxy'
      ? `${getActiveGalaxy(state)?.name ?? 'Galaxy Map'}`
      : (viewedSystem?.name ?? '—');
    el('stronghold-badge').classList.toggle(
      'hidden',
      view !== 'system' || state.stronghold !== viewedSystemId,
    );

    const transit = transitStatus(state);
    const hullMk = flagshipHullStage(state) > 0
      ? ` · ${hullDisplayName(state, 'flagship').replace(/^flagship · /, '')}`
      : '';
    if (transit) {
      const dest = systemById(state, transit.destId);
      el('flagship-loc').textContent =
        `→ ${dest?.name ?? transit.destId} (${Math.ceil(transit.etaMs / 1000)}s)${hullMk}`;
    } else if (isFlagshipOrbiting(state)) {
      const target = orbitTargetLabel(state);
      el('flagship-loc').textContent =
        `${systemById(state, state.flagship.systemId)?.name ?? '—'} · orbiting ${target ?? 'body'}${hullMk}`;
    } else {
      el('flagship-loc').textContent =
        `${systemById(state, state.flagship.systemId)?.name ?? '—'}${hullMk}`;
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

    renderTutorialGuide(state, phase);
    applyTutorialLocks(state);
    renderFieldManualUnlocks(state, phase);
    if (state.campaign?.tutorial?.graduationPending
        && el('new-game-modal')?.dataset.flow !== 'graduation') {
      openGraduationModal();
    }

    const panel = el('build-panel');
    const wormholePanel = el('wormhole-panel');

    if (view === 'system' && viewedSystemId === BLACK_HOLE_ID && sidePanel !== 'dyson') {
      panel.classList.add('hidden');
      wormholePanel?.classList.remove('hidden');
      const wormholeStructures = el('wormhole-structure-build-btns');
      const wormholeSnap = `${constructionUiSnapshot(state, viewedSystemId)}|${JSON.stringify(state.wormholes)}`;
      if (wormholeStructures && wormholeSnap !== uiSnapshots.wormholeBuildPanel && !uiPointerActive) {
        uiSnapshots.wormholeBuildPanel = wormholeSnap;
        clearChildren(wormholeStructures);
        renderStarNodeBuildButtons(wormholeStructures, state, viewedSystemId, {
          filter: (row) => row.type === 'wormhole_observatory',
        });
      }
      const enterBtn = el('enter-wormhole-btn');
      const anchorBtn = el('build-anchor-btn');
      const anchorSelect = el('anchor-target-select');
      if (enterBtn) {
        enterBtn.disabled = !canEnterWormhole(state).ok;
        enterBtn.onclick = () => doEnterWormhole({});
      }
      if (anchorSelect && wormholeSnap === uiSnapshots.wormholeBuildPanel
          && anchorSelect.options.length === 0 && !uiPointerActive) {
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
        anchorBtn.textContent = `Build Anchor (${canBuildWormholeAnchor(state).cost ?? WORMHOLE_ANCHOR_COST} cr)`;
        anchorBtn.onclick = () => doBuildWormholeAnchor(target);
      }
      applyTutorialLocks(state);
      return;
    }
    wormholePanel?.classList.add('hidden');
    uiSnapshots.wormholeBuildPanel = '';

    if (view !== 'system' || sidePanel === 'dyson' || sidePanel === 'tech' || sidePanel === 'fleet'
        || sidePanel === 'logistics') {
      panel.classList.add('hidden');
      return;
    }
    if (!selection || selection === 'star') {
      const showStarConstruction = isPlayerOwned(state, viewedSystemId);
      if (!showStarConstruction) {
        panel.classList.add('hidden');
        return;
      }
      panel.classList.remove('hidden');
      const starBuildSnap = constructionUiSnapshot(state, viewedSystemId) + `|sel:${selection ?? ''}`;
      if (starBuildSnap !== uiSnapshots.starBuildPanel && !uiPointerActive) {
        uiSnapshots.starBuildPanel = starBuildSnap;
        el('build-panel-title').textContent = selection === 'star'
          ? `${viewedSystem?.name ?? 'System'} · Star`
          : `${viewedSystem?.name ?? 'System'} Star Node`;
        const body = el('build-panel-body');
        clearChildren(body);
        const note = document.createElement('p');
        note.className = 'panel-note panel-note--muted';
        note.textContent = selection === 'star'
          ? 'Star selected — press O near the star to enter a stable stellar orbit.'
          : 'System-scale installations orbit the star and do not require a selected planet.';
        body.appendChild(note);
        for (const id of [
          'build-outpost-btn', 'build-shipyard-btn', 'build-foundry-btn', 'build-launcher-btn',
          'build-trade-btn', 'build-research-btn', 'queue-scout-btn',
        ]) el(id)?.classList.add('hidden');
        hullBtnContainer.classList.add('hidden');
        setProgressBar('build-progress', 'build-progress-fill', 'build-progress-pct', 0, false);
        const buildButtons = el('strategic-build-btns');
        clearChildren(buildButtons);
        buildButtons.classList.remove('hidden');
        renderStarNodeBuildButtons(buildButtons, state, viewedSystemId, {
          filter: (row) => row.type !== 'wormhole_observatory',
        });
        el('build-panel-note').textContent = '';
      }
      return;
    }
    uiSnapshots.starBuildPanel = '';
    const planet = findPlanet(state, viewedSystemId, selection);
    if (!planet) {
      setSelection(null);
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    el('build-panel-title').textContent = planet?.name ?? 'Planet';
    const buildPanelSnap = constructionUiSnapshot(state, viewedSystemId, planet.id);
    if (buildPanelSnap !== uiSnapshots.buildPanel && !uiPointerActive) {
      uiSnapshots.buildPanel = buildPanelSnap;
      renderBuildBody(el('build-panel-body'), planet, state, viewedSystemId);
      renderStrategicBuildButtons(el('strategic-build-btns'), state, viewedSystemId, planet.id);
    }

    const outpostCheck = canBuildOutpost(state, viewedSystemId, planet.id);
    const shipyardCheck = canBuildShipyard(state, viewedSystemId, planet.id);
    const shipyard = findShipyardOnPlanet(state, viewedSystemId, planet.id)
      ?? systemById(state, viewedSystemId)?.structures.find(
        (s) => s.type === 'shipyard' && s.bodyId === planet.id,
      )
      ?? null;
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
    tradeBtn.textContent = `Build Export Depot (${TRADE_STATION_COST} cr)`;

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
    shipyardBtn.textContent = `Build Shipyard (${shipyardCheck.cost ?? SHIPYARD_COST} cr)`;

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
    const bodyJobs = activeJobsInSystem(state, viewedSystemId).filter((j) => j.bodyId === planet.id);
    const constructionJob = bodyJobs[0] ?? null;

    if (constructionJob) {
      const prog = jobProgress(constructionJob);
      const eta = jobEtaMs(constructionJob, state);
      setProgressBar('build-progress', 'build-progress-fill', 'build-progress-pct', prog, true);
      const etaLabel = eta != null ? ` · ${Math.ceil(eta / 1000)}s` : '';
      el('build-progress').querySelector('.progress-block__label').textContent =
        `Building ${constructionJob.structureType.replace(/_/g, ' ')} (${Math.round(prog * 100)}%)${etaLabel}`;
    } else if (activeBuild) {
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
    applyTutorialLocks(state);
  };

  return { updateUi, closeSidePanel };
}
