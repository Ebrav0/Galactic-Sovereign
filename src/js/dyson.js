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
  SOLARII_DRAIN_PER_SHELL,
  SHELL_BONUS_CREDIT_MULT,
  SHELL_BONUS_SAIL_EFFICIENCY,
  SHELL_TRADE_BONUS,
  SHELL_RESEARCH_BONUS,
  SHELL_SHIELD_BONUS,
  SHELL_REPAIR_BONUS,
  TICK_MS,
  STRUCTURE_BUILD_MS,
} from './constants.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
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
import { refreshMilestones } from './milestones.js';
import { allocateStructureId } from './economy.js';
import { getSystems } from './galaxy-scope.js';
import { sailShuttleLauncherArrivals } from './sail-shuttles.js';
import { flagshipInSystem } from './flagship-presence.js';
import { stellarSolariiMultiplier } from './star-types.js';
import {
  hasPendingJob,
  queueConstructionJob,
} from './drones.js';
import {
  bodyStructureDef,
  isOperationalStructure,
  structureFoundryOutputMultiplier,
  structureLauncherRateMultiplier,
  structureLevelMultiplier,
  structureSolariiIncomeMultiplier,
} from './body-structures.js';

function persistentDysonSystems(state) {
  if (!state.galaxies) return Object.values(getSystems(state)).map((system) => ({ system, galaxyId: state.activeGalaxyId, active: true }));
  const out = [];
  for (const galaxy of Object.values(state.galaxies)) {
    const hydrated = Object.values(galaxy.systems ?? {});
    if (hydrated.length > 0) {
      for (const system of hydrated) out.push({ system, galaxyId: galaxy.id, active: true });
    } else {
      for (const [systemId, overlay] of Object.entries(galaxy.abstract?.systemOverlays ?? {})) {
        out.push({
          galaxyId: galaxy.id,
          active: false,
          system: {
            id: systemId,
            owner: overlay.owner,
            factionId: overlay.factionId ?? null,
            structures: overlay.structures ?? [],
            dyson: overlay.dyson ?? {},
          },
        });
      }
    }
  }
  return out;
}

function persistentSolariiMultiplier(state, system, galaxyId, active) {
  if (active) return structureSolariiIncomeMultiplier(state, system.id, { galaxyId });
  const effect = bodyStructureDef('solar_collector')?.effects?.find((entry) => entry.key === 'solariiIncomeMult');
  if (!effect) return 1;
  let multiplier = 1;
  for (const structure of system.structures ?? []) {
    if (structure.type !== 'solar_collector' || !isOperationalStructure(state, structure)) continue;
    const scaled = 1 + (effect.value - 1) * structureLevelMultiplier(structure);
    multiplier *= scaled;
  }
  return multiplier;
}

// --- Build validation ---

export function canBuildFoundry(state, systemId, bodyId, opts = {}) {
  if (!isTechUnlocked(state, 'mega_foundry_unlock')) {
    return { ok: false, reason: 'Research Sail Foundry first' };
  }
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (system.star?.kind === 'trade_nexus' || system.dyson?.disabled) {
    return { ok: false, reason: 'Trade Nexus systems have no star for a Dyson project' };
  }
  if (systemId === 'core') return { ok: false, reason: 'Cannot build at the galactic core' };
  if (!isPlayerOwned(state, systemId)) return { ok: false, reason: 'System not under your control' };
  if (!bodyId) return { ok: false, reason: 'Select a planet to anchor the foundry ring' };
  if (!findPlanet(state, systemId, bodyId)) return { ok: false, reason: 'No such planet' };
  if (hasFoundry(state, systemId)) return { ok: false, reason: 'Sail foundry already built in this system' };
  if (system.structures.some((s) => s.type === 'sail_foundry' && s.construction)) {
    return { ok: false, reason: 'Sail foundry construction already in progress' };
  }
  if (!opts.remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (!opts.ignoreCredits && state.credits < FOUNDRY_COST) return { ok: false, reason: `Need ${FOUNDRY_COST} credits` };
  return { ok: true };
}

export function buildFoundry(state, systemId, bodyId, opts = {}) {
  const check = canBuildFoundry(state, systemId, bodyId, opts);
  if (!check.ok) return check;

  if (opts.remote) {
    if (!opts.alreadyPaid) state.credits -= FOUNDRY_COST;
    const system = systemById(state, systemId);
    const structure = {
      id: allocateStructureId(),
      type: 'sail_foundry',
      bodyId,
      builtAtTime: state.time,
      level: 1,
      operational: true,
    };
    system.structures.push(structure);
    return { ok: true, structureId: structure.id, systemId, bodyId, type: structure.type };
  }

  return queueConstructionJob(state, {
    systemId,
    structureType: 'sail_foundry',
    bodyId,
    creditCost: FOUNDRY_COST,
    durationMs: STRUCTURE_BUILD_MS.sail_foundry,
  });
}

export function canBuildLauncher(state, systemId, bodyId, opts = {}) {
  if (!isTechUnlocked(state, 'mega_launcher_unlock')) {
    return { ok: false, reason: 'Research Dyson Launcher first' };
  }
  const system = systemById(state, systemId);
  if (!system) return { ok: false, reason: 'No such system' };
  if (system.star?.kind === 'trade_nexus' || system.dyson?.disabled) {
    return { ok: false, reason: 'Trade Nexus systems have no star for a Dyson project' };
  }
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
  if (!opts.remote && !flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (!opts.ignoreCredits && state.credits < LAUNCHER_COST) return { ok: false, reason: `Need ${LAUNCHER_COST} credits` };
  return { ok: true };
}

export function buildLauncher(state, systemId, bodyId, opts = {}) {
  const check = canBuildLauncher(state, systemId, bodyId, opts);
  if (!check.ok) return check;

  const launcherIndex = launcherCountOnBody(state, systemId, bodyId)
    + (systemById(state, systemId)?.structures.filter(
      (s) => s.type === 'dyson_launcher' && s.bodyId === bodyId && s.construction,
    ).length ?? 0);

  if (opts.remote) {
    if (!opts.alreadyPaid) state.credits -= LAUNCHER_COST;
    const system = systemById(state, systemId);
    const structure = {
      id: allocateStructureId(),
      type: 'dyson_launcher',
      bodyId,
      builtAtTime: state.time,
      level: 1,
      operational: true,
    };
    system.structures.push(structure);
    const dyson = ensureDyson(system);
    dyson.launcherStock[structure.id] = 0;
    dyson.launcherLastFireAt[structure.id] = state.time;
    return { ok: true, structureId: structure.id, systemId, bodyId, type: structure.type };
  }

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

export function shellShieldBonus(system, state = null) {
  const shells = system?.dyson?.completedShells ?? 0;
  if (shells < 4) return 1.0;
  let mult = SHELL_SHIELD_BONUS;
  if (state && isTechUnlocked(state, 'mega_orbital_shield')) mult *= 1.15;
  return mult;
}

export function shellShieldBonusForState(state, system) {
  return shellShieldBonus(system, state);
}

export function shellTradeBonus(system) {
  const shells = system?.dyson?.completedShells ?? 0;
  return shells >= 5 ? SHELL_TRADE_BONUS : 1.0;
}

export function shellResearchBonus(system) {
  const shells = system?.dyson?.completedShells ?? 0;
  return shells >= 6 ? SHELL_RESEARCH_BONUS : 1.0;
}

export function shellRepairBonus(system) {
  const shells = system?.dyson?.completedShells ?? 0;
  return shells >= 7 ? SHELL_REPAIR_BONUS : 1.0;
}

export function solariiPerSecond(state) {
  let total = 0;
  const effects = techEffects(state);
  for (const { system, galaxyId, active } of persistentDysonSystems(state)) {
    if (system.owner !== 'player') continue;
    const shells = system.dyson?.completedShells ?? 0;
    if (shells < 1) continue;
    const mult = SOLARII_SHELL_MULTIPLIERS[shells] ?? 0;
    let rate = SOLARII_BASE_RATE * mult
      * persistentSolariiMultiplier(state, system, galaxyId, active)
      * stellarSolariiMultiplier(system.star)
      * effects.solariiIncomeMult
      * effects.dysonOutputMult;
    if (effects.dysonShellBonus) rate *= 1.08;
    total += rate;
  }
  return total;
}

/** Passive Solarii upkeep across completed player shells. */
export function solariiDrainPerSecond(state) {
  let shells = 0;
  for (const { system } of persistentDysonSystems(state)) {
    if (system.owner !== 'player') continue;
    shells += system.dyson?.completedShells ?? 0;
  }
  return shells * SOLARII_DRAIN_PER_SHELL;
}

/** Net Solarii/s after upkeep (can be negative while stocks remain). */
export function solariiNetPerSecond(state) {
  return solariiPerSecond(state) - solariiDrainPerSecond(state);
}

export function solariiPerSecondInSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || !isPlayerOwned(state, systemId)) return 0;
  const shells = system.dyson?.completedShells ?? 0;
  if (shells < 1) return 0;
  const effects = techEffects(state);
  let rate = SOLARII_BASE_RATE
    * (SOLARII_SHELL_MULTIPLIERS[shells] ?? 0)
    * structureSolariiIncomeMultiplier(state, systemId)
    * stellarSolariiMultiplier(system.star)
    * effects.solariiIncomeMult
    * effects.dysonOutputMult;
  if (effects.dysonShellBonus) rate *= 1.08;
  return rate;
}

export function applySolariiTick(state) {
  if (!state.solariiUnlocked) return;
  const net = solariiNetPerSecond(state) * (TICK_MS / 1000);
  state.solarii = Math.max(0, (state.solarii ?? 0) + net);
}

function completeShell(state, system, dyson) {
  dyson.completedShells = Math.min(SHELL_COUNT, dyson.completedShells + 1);
  dyson.shellSails -= SHELL_SAILS_REQUIRED;
  dyson.lastShellCompletedAt = state.time;
  const shellNum = dyson.completedShells;
  if (shellNum >= 1) state.solariiUnlocked = true;
  const milestoneEvents = refreshMilestones(state);
  return { shellCompleted: true, systemId: system.id, shellNumber: shellNum, milestoneEvents };
}

function tickSystemDyson(state, system) {
  const events = [];
  if (!isPlayerOwned(state, system.id)) return events;
  const foundry = (system.structures ?? []).find(
    (structure) => structure.type === 'sail_foundry'
      && isOperationalStructure(state, structure, { systemId: system.id, owner: 'player' }),
  );
  if (!foundry) return events;

  const dyson = ensureDyson(system);
  if (dyson.completedShells >= SHELL_COUNT) return events;

  const launchers = dysonLaunchers(state, system.id).filter(
    (launcher) => isOperationalStructure(state, launcher, { systemId: system.id, owner: 'player' }),
  );
  const dt = TICK_MS / 1000;
  const prevTime = state.time - TICK_MS;
  const effects = techEffects(state);

  // 1. Foundry production
  const sailRate = FOUNDRY_SAIL_RATE
    * shellSailEfficiencyBonus(system)
    * structureLevelMultiplier(foundry)
    * structureFoundryOutputMultiplier(state, system.id)
    * effects.foundryOutputMult
    * effects.dysonOutputMult;
  const sailsToMake = sailRate * dt;
  if (sailsToMake > 0) {
    const creditCost = sailsToMake * SAIL_CREDIT_COST * effects.sailCostMult;
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
    const launcherThroughput = structureLevelMultiplier(launcher)
      * structureLauncherRateMultiplier(state, system.id)
      * effects.launcherRateMult
      * effects.dysonOutputMult
      * (effects.dysonShellSync ? 1.12 : 1);
    const intervalMs = LAUNCHER_LAUNCH_INTERVAL_MS / Math.max(0.1, launcherThroughput);
    if (state.time - lastFire < intervalMs) continue;

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
  if (shells >= 4) bonuses.push(`System shield ×${shellShieldBonus(system).toFixed(2)}`);
  if (shells >= 5) bonuses.push(`Trade output ×${shellTradeBonus(system).toFixed(2)}`);
  if (shells >= 6) bonuses.push(`Research efficiency ×${shellResearchBonus(system).toFixed(2)}`);
  if (shells >= 7) bonuses.push(`Fleet repair ×${shellRepairBonus(system).toFixed(2)}`);
  if (shells >= 8) bonuses.push('Completed Dyson sphere');
  return bonuses;
}
