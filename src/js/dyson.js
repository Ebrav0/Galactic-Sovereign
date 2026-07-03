// Dyson megastructure: foundry, launchers, shell progress, Solarii (Phase 3, GDD §6–7).
// May mutate state.credits, state.solarii, system structures, and system.dyson.
// Never touches DOM/canvas.

import {
  FOUNDRY_COST,
  LAUNCHER_COST,
  LAUNCHERS_PER_BODY_MAX,
  SHELL_SAILS_REQUIRED,
  SHELL_COUNT,
  SAIL_CREDIT_COST,
  FOUNDRY_SAIL_RATE,
  LAUNCHER_BATCH_SIZE,
  LAUNCHER_LAUNCH_INTERVAL_MS,
  SHUTTLE_TRANSFER_RATE,
  SOLARII_BASE_RATE,
  SOLARII_SHELL_MULTIPLIERS,
  SHELL_BONUS_CREDIT_MULT,
  SHELL_BONUS_SAIL_EFFICIENCY,
  TICK_MS,
} from './constants.js';
import {
  systemById,
  findBody,
  isPlayerOwned,
  hasFoundry,
  launcherCountOnBody,
  dysonLaunchers,
  ensureDyson,
} from './state.js';
import { allocateStructureId } from './economy.js';

function flagshipInSystem(state, systemId) {
  return state.flagship.systemId === systemId && !state.flagship.transit;
}

// --- Build validation ---

export function canBuildFoundry(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (systemId === 'core') return { ok: false, reason: 'Cannot build at the galactic core' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  if (hasFoundry(state, systemId)) return { ok: false, reason: 'Sail foundry already built in this system' };
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < FOUNDRY_COST) return { ok: false, reason: `Need ${FOUNDRY_COST} credits` };
  return { ok: true };
}

export function buildFoundry(state, systemId) {
  const check = canBuildFoundry(state, systemId);
  if (!check.ok) return check;

  state.credits -= FOUNDRY_COST;
  systemById(state, systemId).structures.push({
    id: allocateStructureId(),
    type: 'sail_foundry',
    bodyId: null,
    builtAtTime: state.time,
  });
  return { ok: true };
}

export function canBuildLauncher(state, systemId, bodyId) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (systemId === 'core') return { ok: false, reason: 'Cannot build at the galactic core' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  const found = findBody(state, systemId, bodyId);
  if (!found) return { ok: false, reason: 'No such body' };
  if (!hasFoundry(state, systemId)) {
    return { ok: false, reason: 'Build a sail foundry in this system first' };
  }
  if (launcherCountOnBody(state, systemId, bodyId) >= LAUNCHERS_PER_BODY_MAX) {
    return { ok: false, reason: `Maximum ${LAUNCHERS_PER_BODY_MAX} launchers per body` };
  }
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < LAUNCHER_COST) return { ok: false, reason: `Need ${LAUNCHER_COST} credits` };
  return { ok: true };
}

export function buildLauncher(state, systemId, bodyId) {
  const check = canBuildLauncher(state, systemId, bodyId);
  if (!check.ok) return check;

  state.credits -= LAUNCHER_COST;
  const id = allocateStructureId();
  systemById(state, systemId).structures.push({
    id,
    type: 'dyson_launcher',
    bodyId,
    builtAtTime: state.time,
  });
  ensureDyson(systemById(state, systemId)).launcherStock[id] = 0;
  ensureDyson(systemById(state, systemId)).launcherLastFireAt[id] = state.time;
  return { ok: true };
}

// --- Shell bonus hooks (Phase 5–6 features return 1.0 until wired) ---

export function shellCreditBonus(system) {
  const shells = system.dyson?.completedShells ?? 0;
  return SHELL_BONUS_CREDIT_MULT[shells] ?? 1;
}

export function shellSailEfficiencyBonus(system) {
  const shells = system.dyson?.completedShells ?? 0;
  return SHELL_BONUS_SAIL_EFFICIENCY[shells] ?? 1;
}

export function shellShieldBonus(_system) {
  return 1.0; // Phase 6 Superweapon counterplay
}

export function shellTradeBonus(_system) {
  return 1.0; // Phase 5 trade stations
}

export function shellResearchBonus(_system) {
  return 1.0; // Phase 5 research stations
}

export function shellRepairBonus(_system) {
  return 1.0; // wired when fleet repair uses shell bonus
}

export function solariiPerSecond(state) {
  let total = 0;
  for (const system of Object.values(state.systems)) {
    if (!isPlayerOwned(state, system.id)) continue;
    const shells = system.dyson?.completedShells ?? 0;
    if (shells < 1) continue;
    const mult = SOLARII_SHELL_MULTIPLIERS[shells] ?? 0;
    total += SOLARII_BASE_RATE * mult;
  }
  return total;
}

export function solariiPerSecondInSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || !isPlayerOwned(state, systemId)) return 0;
  const shells = system.dyson?.completedShells ?? 0;
  if (shells < 1) return 0;
  return SOLARII_BASE_RATE * (SOLARII_SHELL_MULTIPLIERS[shells] ?? 0);
}

export function applySolariiTick(state) {
  if (!state.solariiUnlocked) return;
  state.solarii = (state.solarii ?? 0) + solariiPerSecond(state) * (TICK_MS / 1000);
}

function completeShell(state, system, dyson) {
  dyson.completedShells = Math.min(SHELL_COUNT, dyson.completedShells + 1);
  dyson.shellSails -= SHELL_SAILS_REQUIRED;
  dyson.lastShellCompletedAt = state.time;
  const shellNum = dyson.completedShells;
  if (shellNum >= 1) state.solariiUnlocked = true;
  return { shellCompleted: true, systemId: system.id, shellNumber: shellNum };
}

function tickSystemDyson(state, system) {
  const events = [];
  if (!isPlayerOwned(state, system.id)) return events;
  if (!hasFoundry(state, system.id)) return events;

  const dyson = ensureDyson(system);
  if (dyson.completedShells >= SHELL_COUNT) return events;

  const launchers = dysonLaunchers(state, system.id);
  const dt = TICK_MS / 1000;

  // 1. Foundry production
  const sailRate = FOUNDRY_SAIL_RATE * shellSailEfficiencyBonus(system);
  const sailsToMake = sailRate * dt;
  if (sailsToMake > 0) {
    const creditCost = sailsToMake * SAIL_CREDIT_COST;
    if (state.credits >= creditCost) {
      state.credits -= creditCost;
      dyson.foundryStock += sailsToMake;
    }
  }

  // 2. Auto logistics: foundry -> launcher stocks
  if (launchers.length > 0 && dyson.foundryStock > 0) {
    const transferCap = SHUTTLE_TRANSFER_RATE * launchers.length * dt;
    const toTransfer = Math.min(dyson.foundryStock, transferCap);
    const perLauncher = toTransfer / launchers.length;
    dyson.foundryStock -= toTransfer;
    for (const launcher of launchers) {
      dyson.launcherStock[launcher.id] = (dyson.launcherStock[launcher.id] ?? 0) + perLauncher;
    }
  }

  // 3. Launcher firing
  for (const launcher of launchers) {
    const stock = dyson.launcherStock[launcher.id] ?? 0;
    if (stock < LAUNCHER_BATCH_SIZE) continue;
    const lastFire = dyson.launcherLastFireAt[launcher.id] ?? 0;
    if (state.time - lastFire < LAUNCHER_LAUNCH_INTERVAL_MS) continue;

    dyson.launcherStock[launcher.id] = stock - LAUNCHER_BATCH_SIZE;
    dyson.shellSails += LAUNCHER_BATCH_SIZE;
    dyson.launcherLastFireAt[launcher.id] = state.time;
    events.push({ launched: true, systemId: system.id, launcherId: launcher.id, sails: LAUNCHER_BATCH_SIZE });
  }

  // 4. Shell completion (may complete multiple if overflow)
  while (dyson.shellSails >= SHELL_SAILS_REQUIRED && dyson.completedShells < SHELL_COUNT) {
    events.push(completeShell(state, system, dyson));
  }

  return events;
}

export function tickDyson(state) {
  const events = [];
  for (const system of Object.values(state.systems)) {
    events.push(...tickSystemDyson(state, system));
  }
  return events;
}

/** Dev/test: inject shell progress without full production chain. */
export function forceShellProgress(state, systemId, sails) {
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  const dyson = ensureDyson(system);
  dyson.shellSails = Math.max(0, sails);
  const events = [];
  while (dyson.shellSails >= SHELL_SAILS_REQUIRED && dyson.completedShells < SHELL_COUNT) {
    events.push(completeShell(state, system, dyson));
  }
  return { ok: true, events };
}

export function activeShellBonuses(system) {
  const shells = system.dyson?.completedShells ?? 0;
  const bonuses = [];
  if (shells >= 1) bonuses.push('Solarii income');
  if (shells >= 2) bonuses.push(`Credit output ×${shellCreditBonus(system).toFixed(2)}`);
  if (shells >= 3) bonuses.push(`Sail efficiency ×${shellSailEfficiencyBonus(system).toFixed(2)}`);
  if (shells >= 4) bonuses.push('System shield (pending Phase 6)');
  if (shells >= 5) bonuses.push('Trade output (pending Phase 5)');
  if (shells >= 6) bonuses.push('Research efficiency (pending Phase 5)');
  if (shells >= 7) bonuses.push('Fleet repair (pending)');
  if (shells >= 8) bonuses.push('Completed Dyson sphere');
  return bonuses;
}
