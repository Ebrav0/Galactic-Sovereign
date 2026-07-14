// Dev panel UI — DOM only; actions delegated to dev.js via ctx.

import { SHIPYARD_COMBAT_HULLS } from './constants.js';
import { systemById, findPlanet, findShipyardOnPlanet, ensureDyson } from './state.js';
import { allTechNodes } from './tech-web.js';
import { researchSummary } from './research.js';
import { empireQueueSummary } from './empire-queue.js';
import { aiFactionSummary } from './ai-faction.js';
import { BODY_STRUCTURE_DEFS } from './body-structures.js';
import { STRUCTURE_DEFS } from './strategic-structures.js';
import {
  DEV_FLEET_PRESETS,
  devValidateSystem,
  devValidatePlanet,
  devValidateHull,
  devValidateCount,
  devCanForceBuildOutpost,
  devCanForceBuildShipyard,
  devCanForceBuildFoundry,
  devCanForceBuildLauncher,
} from './dev.js';

const el = (id) => document.getElementById(id);
const PASSIVE_REFRESH_MS = 250;
const SPAWN_COUNT_MAX = 50;

function clampCountInput(input) {
  let v = parseInt(input.value, 10);
  if (!Number.isFinite(v)) v = 1;
  v = Math.max(1, Math.min(SPAWN_COUNT_MAX, v));
  input.value = String(v);
  return v;
}

function populateHullSelect(select) {
  if (!select || select.dataset.populated) return;
  select.innerHTML = '';
  const scout = document.createElement('option');
  scout.value = 'scout';
  scout.textContent = 'scout';
  select.appendChild(scout);
  for (const hull of SHIPYARD_COMBAT_HULLS) {
    const opt = document.createElement('option');
    opt.value = hull;
    opt.textContent = hull;
    select.appendChild(opt);
  }
  select.dataset.populated = '1';
}

function populateTechSelect(select) {
  if (!select || select.dataset.populated) return;
  select.innerHTML = '';
  for (const node of allTechNodes()) {
    const opt = document.createElement('option');
    opt.value = node.id;
    opt.textContent = `${node.id} — ${node.name ?? node.id}`;
    select.appendChild(opt);
  }
  select.dataset.populated = '1';
}

function populateKeyedSelect(select, entries, labelFn) {
  if (!select || select.dataset.populated) return;
  select.innerHTML = '';
  for (const [id, def] of entries) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = labelFn ? labelFn(id, def) : id;
    select.appendChild(opt);
  }
  select.dataset.populated = '1';
}

export function initDevPanel(ctx) {
  const {
    getState,
    getViewedSystemId,
    getSelection,
    getView,
    toast,
    runAction,
    onResult,
  } = ctx;

  const panel = el('dev-panel');
  const backdrop = el('dev-panel-backdrop');
  const badge = el('dev-badge');
  const statusEl = el('dev-status');
  const contextEl = el('dev-context');
  const countInput = el('dev-spawn-count');
  const hullSelect = el('dev-friendly-hull');
  const techSelect = el('dev-tech-select');
  const stanceSelect = el('dev-stance-select');
  const doctrineSelect = el('dev-doctrine-select');
  const bodyStructureSelect = el('dev-body-structure-select');
  const strategicStructureSelect = el('dev-strategic-structure-select');

  populateHullSelect(hullSelect);
  populateTechSelect(techSelect);
  populateKeyedSelect(
    bodyStructureSelect,
    Object.entries(BODY_STRUCTURE_DEFS),
    (id, def) => `${id} — ${def.label ?? id}`,
  );
  populateKeyedSelect(
    strategicStructureSelect,
    Object.entries(STRUCTURE_DEFS),
    (id) => id,
  );

  let isOpen = false;
  let lastPassiveRefreshAt = 0;

  function setStatus(result) {
    if (!statusEl) return;
    statusEl.className = 'dev-status';
    if (result.ok) {
      statusEl.classList.add('dev-status--ok');
      statusEl.textContent = result.details
        ? `OK — ${JSON.stringify(result.details).slice(0, 140)}`
        : 'OK';
    } else {
      statusEl.classList.add('dev-status--error');
      statusEl.textContent = `${result.code}: ${result.reason}`;
    }
    onResult?.(result);
  }

  function exec(action, params = {}) {
    const systemId = params.systemId ?? getViewedSystemId();
    const planetId = params.planetId ?? getSelection();
    const result = runAction(action, { ...params, systemId, planetId });
    setStatus(result);
    if (result.ok) {
      const d = result.details;
      if (d?.built?.length || d?.skipped?.length || d?.errors?.length) {
        toast(
          `Built: ${d.built?.length ?? 0}, Skipped: ${d.skipped?.length ?? 0}, Errors: ${d.errors?.length ?? 0}`,
          'ok',
        );
      } else {
        toast(`${action} — OK`, 'ok');
      }
    } else {
      toast(result.reason, 'error');
    }
    updateDevPanel(true);
    return result;
  }

  function bindClick(id, handler) {
    el(id)?.addEventListener('click', handler);
  }

  bindClick('dev-close-btn', () => toggle(false));
  backdrop?.addEventListener('click', () => toggle(false));

  bindClick('dev-grant-1k', () => exec('grantCredits', { amount: 1000 }));
  bindClick('dev-grant-10k', () => exec('grantCredits', { amount: 10000 }));
  bindClick('dev-grant-100k', () => exec('grantCredits', { amount: 100000 }));
  bindClick('dev-grant-solarii', () => exec('grantSolarii', { amount: 100 }));
  bindClick('dev-grant-cargo', () => exec('grantCargo', {
    rawMaterials: 100, fuel: 100, manufacturedGoods: 100,
  }));
  bindClick('dev-grant-cargo-raw', () => exec('grantCargo', { rawMaterials: 100 }));
  bindClick('dev-grant-cargo-fuel', () => exec('grantCargo', { fuel: 100 }));
  bindClick('dev-grant-cargo-goods', () => exec('grantCargo', { manufacturedGoods: 100 }));
  bindClick('dev-unlock-solarii', () => exec('unlockSolarii'));
  bindClick('dev-reveal-intel', () => exec('revealIntel'));
  bindClick('dev-reveal-all-intel', () => exec('revealAllIntel'));
  bindClick('dev-force-capture', () => exec('forceCapture'));
  bindClick('dev-force-ai-capture', () => exec('forceAiCapture'));
  bindClick('dev-advance-60', () => exec('advanceTime', { ms: 60000 }));
  bindClick('dev-advance-300', () => exec('advanceTime', { ms: 300000 }));

  stanceSelect?.addEventListener('change', () => {
    exec('setBattleStance', { stance: stanceSelect.value });
  });
  doctrineSelect?.addEventListener('change', () => {
    exec('setCombatDoctrine', { doctrine: doctrineSelect.value });
  });

  bindClick('dev-unlock-all-tech', () => exec('unlockAllTech'));
  bindClick('dev-complete-research', () => exec('completeResearch'));
  bindClick('dev-unlock-tech', () => {
    const nodeId = techSelect?.value;
    if (!nodeId) return;
    exec('unlockTech', { nodeId });
  });

  bindClick('dev-build-outpost', () => exec('forceBuildOutpost'));
  bindClick('dev-build-shipyard', () => exec('forceBuildShipyard'));
  bindClick('dev-build-foundry', () => exec('forceBuildFoundry'));
  bindClick('dev-build-launcher', () => exec('forceBuildLauncher'));
  bindClick('dev-build-research', () => exec('forceBuildResearchStation'));
  bindClick('dev-build-trade', () => exec('forceBuildTradeStation'));
  bindClick('dev-deploy-drone', () => exec('deployBuilderDrone'));
  bindClick('dev-planet-kit', () => exec('buildPlanetKit'));
  bindClick('dev-system-kit', () => exec('buildSystemKit'));
  bindClick('dev-empire-kit', () => exec('buildEmpireKit'));
  bindClick('dev-dyson-kit', () => exec('buildDysonKit'));

  bindClick('dev-build-body-structure', () => {
    const type = bodyStructureSelect?.value;
    if (!type) return;
    exec('forceBuildBodyStructure', { type, bodyId: getSelection() });
  });
  bindClick('dev-build-strategic-structure', () => {
    const type = strategicStructureSelect?.value;
    if (!type) return;
    exec('forceBuildStrategicStructure', { type });
  });

  bindClick('dev-instant-spawn', () => {
    const state = getState();
    const systemId = getViewedSystemId();
    const planetId = getSelection();
    const shipyard = planetId ? findShipyardOnPlanet(state, systemId, planetId) : null;
    const hull = hullSelect?.value ?? 'corvette';
    if (!shipyard) {
      toast('Select a planet with a shipyard', 'error');
      return;
    }
    exec('instantSpawnAtShipyard', { shipyardId: shipyard.id, hull });
  });

  for (const [btnId, presetId] of [
    ['dev-preset-scout-wing', 'scout_wing'],
    ['dev-preset-battle-fleet', 'battle_fleet'],
    ['dev-preset-carrier-group', 'carrier_group'],
    ['dev-preset-logistics', 'logistics_convoy'],
  ]) {
    bindClick(btnId, () => exec('spawnFleetPreset', {
      presetId,
      anchorBodyId: getSelection(),
    }));
  }

  bindClick('dev-spawn-friendly', () => {
    const hull = hullSelect?.value ?? 'corvette';
    if (hull === 'scout') {
      exec('spawnScouts', { count: clampCountInput(countInput) });
      return;
    }
    exec('spawnFriendly', { hull, count: clampCountInput(countInput), anchorBodyId: getSelection() });
  });

  bindClick('dev-spawn-ai', () => {
    const hull = hullSelect?.value ?? 'corvette';
    if (hull === 'scout') {
      toast('Pick a combat hull for AI spawn', 'error');
      return;
    }
    exec('spawnAiShips', { hull, count: clampCountInput(countInput), anchorBodyId: getSelection() });
  });

  bindClick('dev-spawn-scouts', () => {
    exec('spawnScouts', { count: clampCountInput(countInput) });
  });

  bindClick('dev-spawn-hero', () => exec('spawnHeroFlagship'));
  bindClick('dev-spawn-enemy-small', () => exec('spawnEnemyFleet', { size: 'small' }));
  bindClick('dev-spawn-enemy-medium', () => exec('spawnEnemyFleet', { size: 'medium' }));
  bindClick('dev-spawn-enemy-large', () => exec('spawnEnemyFleet', { size: 'large' }));
  bindClick('dev-teleport-pirate', () => exec('teleportPirate'));

  bindClick('dev-shell-plus-10', () => {
    const state = getState();
    const systemId = getViewedSystemId();
    const system = systemById(state, systemId);
    if (system) ensureDyson(system);
    const current = system?.dyson?.shellSails ?? 0;
    exec('forceShellProgress', { sails: current + 10 });
  });
  bindClick('dev-force-shell', () => exec('forceShellProgress'));
  bindClick('dev-set-dysons-1', () => exec('setCompletedDysons', { count: 1 }));
  bindClick('dev-set-dysons-3', () => exec('setCompletedDysons', { count: 3 }));
  bindClick('dev-build-cradle', () => exec('buildSuperweaponCradle', { systemId: getState().stronghold }));
  bindClick('dev-sw-create', () => exec('superweaponCreate'));
  bindClick('dev-sw-destroy', () => exec('superweaponDestroy'));
  bindClick('dev-sw-jump', () => exec('superweaponJump'));

  bindClick('dev-heal-flagship', () => exec('healFlagship'));
  bindClick('dev-heal-ships', () => exec('healShipsInSystem'));

  countInput?.addEventListener('blur', () => clampCountInput(countInput));

  function toggle(open) {
    isOpen = open ?? !isOpen;
    panel?.classList.toggle('hidden', !isOpen);
    backdrop?.classList.toggle('hidden', !isOpen);
    badge?.classList.toggle('hidden', !isOpen);
    if (isOpen) {
      updateDevPanel(true);
      const first = panel?.querySelector('button, select, input');
      first?.focus();
    }
  }

  function updateDevPanel(force = false) {
    if (!isOpen) return;
    const now = performance.now();
    if (!force && now - lastPassiveRefreshAt < PASSIVE_REFRESH_MS) return;
    lastPassiveRefreshAt = now;

    const state = getState();
    const systemId = getViewedSystemId();
    const selection = getSelection();
    const system = systemById(state, systemId);
    const planet = selection ? findPlanet(state, systemId, selection) : null;
    const flagship = state.flagship;
    const research = researchSummary(state);
    const queue = empireQueueSummary(state);
    const ai = aiFactionSummary(state);

    if (contextEl) {
      const lines = [
        `Galaxy ${state.activeGalaxyId ?? '?'} · View ${getView?.() ?? 'system'} · ${system?.name ?? '?'} (${systemId})`,
        `Owner ${system?.owner ?? '?'} · Credits ${Math.floor(state.credits)} · Solarii ${Math.floor(state.solarii ?? 0)}${state.solariiUnlocked ? '' : ' (locked)'}`,
        `Planet ${planet ? `${planet.name} (${selection})` : 'none — click a planet'} · Flagship @ ${flagship?.systemId ?? 'transit'}`,
        `Research ${research.activeNodeId ?? 'idle'} (${Math.round((research.progress ?? 0) * 100)}%) · Queue ${queue.length ?? 0} · AI systems ${ai.ownedSystemCount ?? 0}`,
        `Dysons ${state.milestones?.completedDysonSystems?.length ?? 0} · Diplo ${state.milestones?.diplomacyUnlocked ? 'on' : 'off'} · SW ${state.milestones?.superweaponUnlocked ? 'on' : 'off'}`,
      ];
      contextEl.innerHTML = lines.map((line) => `<span class="dev-context__line">${line}</span>`).join('');
    }

    if (stanceSelect && state.battleStance) stanceSelect.value = state.battleStance;
    if (doctrineSelect && state.combatDoctrine) doctrineSelect.value = state.combatDoctrine;

    const sysOk = devValidateSystem(state, systemId).ok;
    const sysNotCore = devValidateSystem(state, systemId, { forbidCore: true }).ok;
    const planetOk = selection && devValidatePlanet(state, systemId, selection).ok;
    const hull = hullSelect?.value ?? 'corvette';
    const hullOk = hull === 'scout'
      ? true
      : devValidateHull(hull, { includeScout: false }).ok;
    const combatHullOk = hull !== 'scout' && devValidateHull(hull, { includeScout: false }).ok;
    const countOk = devValidateCount(countInput?.value ?? 1).ok;
    const shipyard = planetOk ? findShipyardOnPlanet(state, systemId, selection) : null;
    const hasFleets = (state.pirates?.fleets?.length ?? 0) > 0;
    const alreadyOwned = system?.owner === 'player';
    const aiOwned = system?.owner === 'ai';
    const bodyType = bodyStructureSelect?.value;
    const bodyDef = bodyType ? BODY_STRUCTURE_DEFS[bodyType] : null;
    const bodyBuildOk = !!bodyType && (bodyDef?.starNode ? sysOk : !!selection);
    const strategicType = strategicStructureSelect?.value;
    const strategicDef = strategicType ? STRUCTURE_DEFS[strategicType] : null;
    const strategicOk = !!strategicType && sysNotCore
      && (strategicDef?.perBody ? !!planetOk : true);

    const setBtn = (id, enabled) => {
      const btn = el(id);
      if (btn) btn.disabled = !enabled;
    };

    setBtn('dev-grant-cargo', sysOk);
    setBtn('dev-grant-cargo-raw', sysOk);
    setBtn('dev-grant-cargo-fuel', sysOk);
    setBtn('dev-grant-cargo-goods', sysOk);
    setBtn('dev-reveal-intel', sysOk);
    setBtn('dev-reveal-all-intel', sysOk);
    setBtn('dev-force-capture', sysNotCore && !alreadyOwned);
    setBtn('dev-force-ai-capture', sysNotCore && !aiOwned && systemId !== state.stronghold);
    setBtn('dev-complete-research', !!research.activeNodeId);
    setBtn('dev-build-outpost', planetOk && devCanForceBuildOutpost(state, systemId, selection).ok);
    setBtn('dev-build-shipyard', planetOk && devCanForceBuildShipyard(state, systemId, selection).ok);
    setBtn('dev-build-foundry', planetOk && devCanForceBuildFoundry(state, systemId, selection).ok);
    setBtn('dev-build-launcher', selection && devCanForceBuildLauncher(state, systemId, selection).ok);
    setBtn('dev-build-research', sysNotCore);
    setBtn('dev-build-trade', planetOk);
    setBtn('dev-deploy-drone', sysOk && alreadyOwned);
    setBtn('dev-planet-kit', planetOk);
    setBtn('dev-system-kit', sysOk);
    setBtn('dev-empire-kit', planetOk);
    setBtn('dev-dyson-kit', sysNotCore);
    setBtn('dev-build-body-structure', bodyBuildOk);
    setBtn('dev-build-strategic-structure', strategicOk);
    setBtn('dev-instant-spawn', !!shipyard && (hull === 'scout' || hullOk));

    for (const presetId of Object.keys(DEV_FLEET_PRESETS)) {
      const btn = panel?.querySelector(`[data-preset="${presetId}"]`);
      if (btn) btn.disabled = !sysOk;
    }

    setBtn('dev-spawn-friendly', sysOk && hullOk && countOk);
    setBtn('dev-spawn-ai', sysOk && combatHullOk && countOk);
    setBtn('dev-spawn-scouts', sysOk && countOk);
    setBtn('dev-spawn-hero', sysOk);
    setBtn('dev-spawn-enemy-small', sysOk);
    setBtn('dev-spawn-enemy-medium', sysOk);
    setBtn('dev-spawn-enemy-large', sysOk);
    setBtn('dev-teleport-pirate', sysOk && hasFleets);
    setBtn('dev-shell-plus-10', sysOk);
    setBtn('dev-force-shell', sysOk);
    setBtn('dev-sw-create', sysOk);
    setBtn('dev-sw-destroy', sysOk);
    setBtn('dev-sw-jump', sysOk);
    setBtn('dev-heal-flagship', !!flagship);
    setBtn('dev-heal-ships', sysOk);
  }

  return { toggle, isOpen: () => isOpen, updateDevPanel };
}
