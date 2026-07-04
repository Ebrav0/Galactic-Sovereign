// Dev panel UI — DOM only; actions delegated to dev.js via ctx.

import { SHIPYARD_COMBAT_HULLS } from './constants.js';
import { systemById, findPlanet, findShipyardOnPlanet } from './state.js';
import {
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

function clampCountInput(input) {
  let v = parseInt(input.value, 10);
  if (!Number.isFinite(v)) v = 1;
  v = Math.max(1, Math.min(20, v));
  input.value = String(v);
  return v;
}

export function initDevPanel(ctx) {
  const {
    getState,
    getViewedSystemId,
    getSelection,
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
  const stanceSelect = el('dev-stance-select');

  let isOpen = false;

  function setStatus(result) {
    if (!statusEl) return;
    statusEl.className = 'dev-status';
    if (result.ok) {
      statusEl.classList.add('dev-status--ok');
      statusEl.textContent = result.details
        ? `OK — ${JSON.stringify(result.details).slice(0, 120)}`
        : 'OK';
    } else {
      statusEl.classList.add('dev-status--error');
      statusEl.textContent = `${result.code}: ${result.reason}`;
    }
    onResult?.(result);
  }

  function exec(action, params = {}) {
    const state = getState();
    const systemId = params.systemId ?? getViewedSystemId();
    const planetId = params.planetId ?? getSelection();
    const result = runAction(action, { ...params, systemId, planetId });
    setStatus(result);
    if (result.ok) {
      const d = result.details;
      if (d?.built?.length || d?.skipped?.length) {
        toast(`Built: ${d.built?.length ?? 0}, Skipped: ${d.skipped?.length ?? 0}, Errors: ${d.errors?.length ?? 0}`, 'ok');
      } else {
        toast(`${action} — OK`, 'ok');
      }
    } else {
      toast(result.reason, 'error');
    }
    updateDevPanel();
    return result;
  }

  function bindClick(id, handler) {
    el(id)?.addEventListener('click', handler);
  }

  bindClick('dev-close-btn', () => toggle(false));
  backdrop?.addEventListener('click', () => toggle(false));

  bindClick('dev-grant-1k', () => exec('grantCredits', { amount: 1000 }));
  bindClick('dev-grant-10k', () => exec('grantCredits', { amount: 10000 }));
  bindClick('dev-grant-solarii', () => exec('grantSolarii', { amount: 100 }));
  bindClick('dev-unlock-solarii', () => exec('unlockSolarii'));
  bindClick('dev-reveal-intel', () => exec('revealIntel'));
  bindClick('dev-force-capture', () => exec('forceCapture'));
  bindClick('dev-advance-60', () => exec('advanceTime', { ms: 60000 }));
  bindClick('dev-advance-300', () => exec('advanceTime', { ms: 300000 }));
  bindClick('dev-force-shell', () => exec('forceShellProgress', { sails: 500 }));

  stanceSelect?.addEventListener('change', () => {
    exec('setBattleStance', { stance: stanceSelect.value });
  });

  bindClick('dev-build-outpost', () => exec('forceBuildOutpost'));
  bindClick('dev-build-shipyard', () => exec('forceBuildShipyard'));
  bindClick('dev-build-foundry', () => exec('forceBuildFoundry'));
  bindClick('dev-build-launcher', () => exec('forceBuildLauncher'));
  bindClick('dev-planet-kit', () => exec('buildPlanetKit'));
  bindClick('dev-system-kit', () => exec('buildSystemKit'));
  bindClick('dev-dyson-kit', () => exec('buildDysonKit'));

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

  bindClick('dev-spawn-friendly', () => {
    const count = clampCountInput(countInput);
    const hull = hullSelect?.value ?? 'corvette';
    exec('spawnFriendly', { hull, count, anchorBodyId: getSelection() });
  });

  bindClick('dev-spawn-scouts', () => {
    const count = clampCountInput(countInput);
    exec('spawnScouts', { count });
  });

  bindClick('dev-spawn-enemy', () => exec('spawnEnemyFleet'));
  bindClick('dev-teleport-pirate', () => exec('teleportPirate'));

  countInput?.addEventListener('blur', () => clampCountInput(countInput));

  function toggle(open) {
    isOpen = open ?? !isOpen;
    panel?.classList.toggle('hidden', !isOpen);
    backdrop?.classList.toggle('hidden', !isOpen);
    badge?.classList.toggle('hidden', !isOpen);
    if (isOpen) {
      updateDevPanel();
      const first = panel?.querySelector('button, select, input');
      first?.focus();
    }
  }

  function updateDevPanel() {
    if (!isOpen) return;
    const state = getState();
    const systemId = getViewedSystemId();
    const selection = getSelection();
    const system = systemById(state, systemId);
    const planet = selection ? findPlanet(state, systemId, selection) : null;
    const flagshipSys = state.flagship?.systemId;

    if (contextEl) {
      contextEl.textContent = [
        `System: ${system?.name ?? '?'} (${systemId})`,
        `Owner: ${system?.owner ?? '?'}`,
        `Planet: ${planet ? `${planet.name} (${selection})` : 'none — click a planet'}`,
        `Flagship @ ${flagshipSys ?? 'transit'}`,
      ].join(' · ');
    }

    const sysOk = devValidateSystem(state, systemId).ok;
    const sysNotCore = devValidateSystem(state, systemId, { forbidCore: true }).ok;
    const planetOk = selection && devValidatePlanet(state, systemId, selection).ok;
    const hullOk = devValidateHull(hullSelect?.value ?? 'corvette', { includeScout: false }).ok;
    const countOk = devValidateCount(countInput?.value ?? 1).ok;
    const shipyard = planetOk ? findShipyardOnPlanet(state, systemId, selection) : null;
    const hasFleets = (state.pirates?.fleets?.length ?? 0) > 0;
    const alreadyOwned = system?.owner === 'player';

    const setBtn = (id, enabled) => {
      const btn = el(id);
      if (btn) btn.disabled = !enabled;
    };

    setBtn('dev-reveal-intel', sysOk);
    setBtn('dev-force-capture', sysNotCore && !alreadyOwned);
    setBtn('dev-force-shell', sysOk);
    setBtn('dev-build-outpost', planetOk && devCanForceBuildOutpost(state, systemId, selection).ok);
    setBtn('dev-build-shipyard', planetOk && devCanForceBuildShipyard(state, systemId, selection).ok);
    setBtn('dev-build-foundry', planetOk && devCanForceBuildFoundry(state, systemId, selection).ok);
    setBtn('dev-build-launcher', selection && devCanForceBuildLauncher(state, systemId, selection).ok);
    setBtn('dev-planet-kit', planetOk);
    setBtn('dev-system-kit', sysOk);
    setBtn('dev-dyson-kit', sysNotCore);
    setBtn('dev-instant-spawn', !!shipyard && hullOk);
    setBtn('dev-spawn-friendly', sysOk && hullOk && countOk);
    setBtn('dev-spawn-scouts', sysOk && countOk);
    setBtn('dev-spawn-enemy', sysOk);
    setBtn('dev-teleport-pirate', sysOk && hasFleets);
  }

  return { toggle, isOpen: () => isOpen, updateDevPanel };
}

export const DEV_FRIENDLY_HULLS = SHIPYARD_COMBAT_HULLS;
