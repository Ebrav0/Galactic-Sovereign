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
  SAIL_SHUTTLE_CAPACITY,
  SOLARII_BASE_RATE,
  SOLARII_SHELL_MULTIPLIERS,
  SHELL_BONUS_CREDIT_MULT,
  SHELL_BONUS_SAIL_EFFICIENCY,
  SHELL_TRADE_BONUS,
  SHELL_RESEARCH_BONUS,
  TICK_MS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import { isTechUnlocked } from './tech-web.js';
import {
  systemById,
  findBody,
  findPlanet,
  isPlayerOwned,
  hasFoundry,
  launcherCountOnBody,
  dysonLaunchers,
  ensureDyson,
  pendingStructureOnBody,
} from './state.js';
import { getSystems } from './galaxy-scope.js';
import { sailShuttleLauncherArrivals } from './sail-shuttles.js';
import { flagshipInSystem } from './flagship-presence.js';
import {
  canUseBuilderTech,
  hasPendingJob,
  queueConstructionJob,
} from './drones.js';

// --- Build validation ---

export function canBuildFoundry(state, systemId, bodyId) {
  if (!isTechUnlocked(state, 'mega_foundry_unlock')) {
    return { ok: false, reason: 'Research Sail Foundry first' };
  }
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (systemId === 'core') return { ok: false, reason: 'Cannot build at the galactic core' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  if (!bodyId) return { ok: false, reason: 'Select a planet to anchor the foundry ring' };
  if (!findPlanet(state, systemId, bodyId)) return { ok: false, reason: 'No such planet' };
  if (hasFoundry(state, systemId)) return { ok: false, reason: 'Sail foundry already built in this system' };
  if (system.structures.some((s) => s.type === 'sail_foundry' && s.construction)) {
    return { ok: false, reason: 'Sail foundry construction already in progress' };
  }
  const builderCheck = canUseBuilderTech(state, 'sail_foundry');
  if (!builderCheck.ok) return builderCheck;
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < FOUNDRY_COST) return { ok: false, reason: `Need ${FOUNDRY_COST} credits` };
  return { ok: true };
}

export function buildFoundry(state, systemId, bodyId) {
  const check = canBuildFoundry(state, systemId, bodyId);
  if (!check.ok) return check;

  return queueConstructionJob(state, {
    systemId,
    structureType: 'sail_foundry',
    bodyId,
    creditCost: FOUNDRY_COST,
    durationMs: STRUCTURE_BUILD_MS.sail_foundry,
  });
}

export function canBuildLauncher(state, systemId, bodyId) {
  if (!isTechUnlocked(state, 'mega_launcher_unlock')) {
    return { ok: false, reason: 'Research Dyson Launcher first' };
  }
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
  const pendingLaunchers = system.structures.filter(
    (s) => s.type === 'dyson_launcher' && s.bodyId === bodyId && s.construction,
  ).length;
  if (launcherCountOnBody(state, systemId, bodyId) + pendingLaunchers >= LAUNCHERS_PER_BODY_MAX) {
    return { ok: false, reason: `Maximum ${LAUNCHERS_PER_BODY_MAX} launchers per body` };
  }
  const builderCheck = canUseBuilderTech(state, 'dyson_launcher');
  if (!builderCheck.ok) return builderCheck;
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < LAUNCHER_COST) return { ok: false, reason: `Need ${LAUNCHER_COST} credits` };
  return { ok: true };
}

export function buildLauncher(state, systemId, bodyId) {
  const check = canBuildLauncher(state, systemId, bodyId);
  if (!check.ok) return check;

  const launcherIndex = launcherCountOnBody(state, systemId, bodyId)
    + (systemById(state, systemId)?.structures.filter(
      (s) => s.type === 'dyson_launcher' && s.bodyId === bodyId && s.construction,
    ).length ?? 0);

  return queueConstructionJob(state, {
    systemId,
    structureType: 'dyson_launcher',
    bodyId,
    creditCost: LAUNCHER_COST,
    durationMs: STRUCTURE_BUILD_MS.dyson_launcher,
    launcherIndex,
  });
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

export function shellTradeBonus(system) {
  const shells = system?.dyson?.completedShells ?? 0;
  return shells >= 5 ? SHELL_TRADE_BONUS : 1.0;
}

export function shellResearchBonus(system) {
  const shells = system?.dyson?.completedShells ?? 0;
  return shells >= 6 ? SHELL_RESEARCH_BONUS : 1.0;
}

export function shellRepairBonus(_system) {
  return 1.0; // wired when fleet repair uses shell bonus
}

export function solariiPerSecond(state) {
  let total = 0;
  for (const system of Object.values(getSystems(state))) {
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
  const prevTime = state.time - TICK_MS;

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

  // 2. Trip logistics: one shuttle per launcher; deliver capacity on each docking
  if (launchers.length > 0 && dyson.foundryStock > 0) {
    launchers.forEach((launcher, idx) => {
      const arrivals = sailShuttleLauncherArrivals(prevTime, state.time, idx, launchers.length);
      if (arrivals <= 0) return;
      const wanted = SAIL_SHUTTLE_CAPACITY * arrivals;
      const deliver = Math.min(dyson.foundryStock, wanted);
      if (deliver <= 0) return;
      dyson.foundryStock -= deliver;
      dyson.launcherStock[launcher.id] = (dyson.launcherStock[launcher.id] ?? 0) + deliver;
    });
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
  for (const system of Object.values(getSystems(state))) {
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
  if (shells >= 5) bonuses.push(`Trade output ×${shellTradeBonus(system).toFixed(2)}`);
  if (shells >= 6) bonuses.push(`Research efficiency ×${shellResearchBonus(system).toFixed(2)}`);
  if (shells >= 7) bonuses.push('Fleet repair (pending)');
  if (shells >= 8) bonuses.push('Completed Dyson sphere');
  return bonuses;
}
