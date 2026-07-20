// Dev-only cheats, autobuild, and spawn helpers. No DOM/canvas imports.

import {
  TICK_MS,
  SHIPYARD_COMBAT_HULLS,
  LAUNCHERS_PER_BODY_MAX,
  PIRATE_SHIPS,
  PIRATE_SHIPS_LARGE,
  SHELL_SAILS_REQUIRED,
  RESEARCH_STATION_CAP,
} from './constants.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { getSystems, getGalaxyIntel } from './galaxy-scope.js';
import {
  systemById,
  findPlanet,
  findBody,
  hasOutpost,
  hasShipyard,
  hasFoundry,
  findStructure,
  isPlayerOwned,
  ensureDyson,
  launcherCountOnBody,
} from './state.js';
import { allocateStructureId } from './economy.js';
import { forceShellProgress } from './dyson.js';
import { hasIntel, invalidateIntelCache } from './intel.js';
import { advance } from './simulation.js';
import { setBattleStance, setCombatDoctrine, checkBattleTrigger } from './combat.js';
import { COMBAT_DOCTRINES } from './combat-doctrine.js';
import { spawnPlayerShip } from './fleets.js';
import { spawnScout } from './scout.js';
import { spawnAiShip } from './ai-ships.js';
import { hullStats, refreshFlagshipHullFromTech, flagshipHullStage, flagshipMaxHpForState } from './hull.js';
import {
  devSpawnEnemyFleetAtSystem,
  devTeleportPirateFleet,
  ensurePiratesState,
} from './pirates.js';
import { ensureResearchState, researchStationCount } from './research.js';
import { forceAiCapture } from './ai-faction.js';
import { allTechNodes, applyTechEffect, isTechUnlocked, techNode, techEffects } from './tech-web.js';
import { normalizeShipyardBuilds } from './empire-queue.js';
import {
  ensureLogisticsState,
  findExportDepot,
  registerExportDepot,
  normalizeCargo,
  addCargo,
  emptyCargo,
  cargoTotal,
} from './logistics.js';
import {
  BODY_STRUCTURE_DEFS,
  buildBodyStructure,
} from './body-structures.js';
import {
  STRUCTURE_DEFS,
} from './strategic-structures.js';
import { deployBuilderDrone } from './builder-drones.js';
import { setCompletedDysonsForTest } from './milestones.js';
import { spawnHeroFlagshipForTest } from './hero-flagships.js';
import {
  ensureSuperweapon,
  hasSuperweaponCradle,
  buildSuperweaponCradle,
  superweaponCreate,
  superweaponDestroy,
  superweaponJump,
  installSuperweaponPart,
  completeHelioclastBuildJob,
  SUPERWEAPON_PART_IDS,
} from './superweapon.js';

export const DEV_CODES = {
  INVALID_SYSTEM: 'INVALID_SYSTEM',
  INVALID_PLANET: 'INVALID_PLANET',
  INVALID_BODY: 'INVALID_BODY',
  INVALID_HULL: 'INVALID_HULL',
  INVALID_COUNT: 'INVALID_COUNT',
  INVALID_STANCE: 'INVALID_STANCE',
  INVALID_DOCTRINE: 'INVALID_DOCTRINE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_PRESET: 'INVALID_PRESET',
  INVALID_STRUCTURE: 'INVALID_STRUCTURE',
  CORE_FORBIDDEN: 'CORE_FORBIDDEN',
  DUPLICATE_STRUCTURE: 'DUPLICATE_STRUCTURE',
  UNSUPPORTED_PLANET_TYPE: 'UNSUPPORTED_PLANET_TYPE',
  NO_SHIPYARD: 'NO_SHIPYARD',
  NO_FOUNDRY: 'NO_FOUNDRY',
  LAUNCHER_CAP: 'LAUNCHER_CAP',
  NO_PIRATES_STATE: 'NO_PIRATES_STATE',
  NO_FLEET: 'NO_FLEET',
  NO_FLAGSHIP: 'NO_FLAGSHIP',
  ALREADY_OWNED: 'ALREADY_OWNED',
  UNKNOWN_TECH: 'UNKNOWN_TECH',
  RESEARCH_CAP: 'RESEARCH_CAP',
  TRADE_DUPLICATE: 'TRADE_DUPLICATE',
  ACTION_FAILED: 'ACTION_FAILED',
};

export const DEV_FLEET_PRESETS = Object.freeze({
  scout_wing: Object.freeze([{ hull: 'scout', count: 5 }]),
  battle_fleet: Object.freeze([
    { hull: 'corvette', count: 4 },
    { hull: 'frigate', count: 3 },
    { hull: 'destroyer', count: 2 },
    { hull: 'cruiser', count: 1 },
  ]),
  carrier_group: Object.freeze([
    { hull: 'light_carrier', count: 1 },
    { hull: 'frigate', count: 4 },
    { hull: 'destroyer', count: 2 },
  ]),
  logistics_convoy: Object.freeze([
    { hull: 'light_hauler', count: 2 },
    { hull: 'bulk_freighter', count: 1 },
    { hull: 'patrol_cutter', count: 2 },
  ]),
});

export const DEV_ENEMY_PRESETS = Object.freeze({
  small: PIRATE_SHIPS,
  medium: Object.freeze([
    { hull: 'corvette', count: 4 },
    { hull: 'frigate', count: 2 },
    { hull: 'destroyer', count: 1 },
  ]),
  large: PIRATE_SHIPS_LARGE,
});

/** Hull Forge stage tech ids (index 0 = stage 1). */
export const DEV_HULL_FORGE_STAGE_IDS = Object.freeze([
  'fs_hull_frame',
  'fs_hull_drives',
  'fs_hull_arsenal',
  'fs_hull_command',
  'fs_hull_sovereign',
]);

export const DEV_FLEET_REFIT_TECH_IDS = Object.freeze([
  'mil_corvette_hardening',
  'mil_destroyer_torpedoes',
  'mil_frigate_alloy',
  'mil_healer_hospital',
  'mil_carrier_hangar',
  'mil_carrier_bombers',
  'mil_cruiser_beams',
  'mil_battleship_siege',
  'mil_dreadnought_plate',
]);

export const DEV_LATE_FLAGSHIP_TECH_IDS = Object.freeze([
  'hero_arsenal',
  'hero_wing_bay',
  'hero_hull_unlock',
  'hero_rally_doctrine',
  'hero_plate',
  'hero_command_suite',
]);

const DEV_SPAWN_COUNT_MAX = 50;

function ok(details) {
  return { ok: true, details };
}

function err(code, reason) {
  return { ok: false, code, reason };
}

// --- Validators ---

export function devValidateSystem(state, systemId, { forbidCore = false } = {}) {
  if (!systemId) return err(DEV_CODES.INVALID_SYSTEM, 'No system specified');
  const system = systemById(state, systemId);
  if (!system) return err(DEV_CODES.INVALID_SYSTEM, 'No such system');
  if (forbidCore && systemId === BLACK_HOLE_ID) {
    return err(DEV_CODES.CORE_FORBIDDEN, 'Cannot use the galactic core');
  }
  return ok({ systemId, system });
}

export function devValidatePlanet(state, systemId, planetId, { allowGas = false, allowBarren = false } = {}) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  if (!planetId) return err(DEV_CODES.INVALID_PLANET, 'No planet specified');
  const planet = findPlanet(state, systemId, planetId);
  if (!planet) return err(DEV_CODES.INVALID_PLANET, 'No such planet');
  if (planet.type === 'gas' && !allowGas) {
    return err(DEV_CODES.UNSUPPORTED_PLANET_TYPE, 'Gas giants have no surface structures');
  }
  if (planet.type === 'barren' && !allowBarren) {
    return err(DEV_CODES.UNSUPPORTED_PLANET_TYPE, 'Barren worlds cannot support surface structures');
  }
  return ok({ planetId, planet });
}

export function devValidateBody(state, systemId, bodyId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  if (!bodyId) return err(DEV_CODES.INVALID_BODY, 'No body specified');
  const found = findBody(state, systemId, bodyId);
  if (!found) return err(DEV_CODES.INVALID_BODY, 'No such body');
  return ok({ bodyId, found });
}

export function devValidateHull(hull, { includeScout = true, allowedHulls = null } = {}) {
  if (!hull) return err(DEV_CODES.INVALID_HULL, 'No hull specified');
  const allowed = allowedHulls ?? (includeScout
    ? ['scout', ...SHIPYARD_COMBAT_HULLS]
    : [...SHIPYARD_COMBAT_HULLS]);
  if (!allowed.includes(hull)) return err(DEV_CODES.INVALID_HULL, `Hull not allowed: ${hull}`);
  if (!hullStats(hull)) return err(DEV_CODES.INVALID_HULL, `Unknown hull: ${hull}`);
  return ok({ hull });
}

export function devValidateCount(n, { min = 1, max = DEV_SPAWN_COUNT_MAX } = {}) {
  const count = Number(n);
  if (!Number.isFinite(count) || !Number.isInteger(count)) {
    return err(DEV_CODES.INVALID_COUNT, 'Count must be an integer');
  }
  if (count < min || count > max) {
    return err(DEV_CODES.INVALID_COUNT, `Count must be between ${min} and ${max}`);
  }
  return ok({ count });
}

export function devValidateDoctrine(doctrine) {
  const id = String(doctrine ?? '');
  if (!COMBAT_DOCTRINES.includes(id)) {
    return err(DEV_CODES.INVALID_DOCTRINE, `Doctrine must be one of: ${COMBAT_DOCTRINES.join(', ')}`);
  }
  return ok({ doctrine: id });
}

export function devValidateStance(stance) {
  if (!['aggressive', 'balanced', 'defensive'].includes(stance)) {
    return err(DEV_CODES.INVALID_STANCE, 'Stance must be aggressive, balanced, or defensive');
  }
  return ok({ stance });
}

export function devCanForceBuildOutpost(state, systemId, planetId) {
  const planetCheck = devValidatePlanet(state, systemId, planetId);
  if (!planetCheck.ok) return planetCheck;
  if (hasOutpost(state, systemId, planetId)) {
    return ok({ skipped: true });
  }
  return ok({});
}

export function devCanForceBuildShipyard(state, systemId, planetId) {
  const planetCheck = devValidatePlanet(state, systemId, planetId);
  if (!planetCheck.ok) return planetCheck;
  if (hasShipyard(state, systemId, planetId)) {
    return ok({ skipped: true });
  }
  return ok({});
}

export function devCanForceBuildFoundry(state, systemId, planetId) {
  const planetCheck = devValidatePlanet(state, systemId, planetId);
  if (!planetCheck.ok) return planetCheck;
  if (hasFoundry(state, systemId)) {
    return ok({ skipped: true });
  }
  return ok({});
}

export function devCanForceBuildLauncher(state, systemId, bodyId) {
  const bodyCheck = devValidateBody(state, systemId, bodyId);
  if (!bodyCheck.ok) return bodyCheck;
  if (!hasFoundry(state, systemId)) {
    return err(DEV_CODES.NO_FOUNDRY, 'Build a sail foundry in this system first');
  }
  if (launcherCountOnBody(state, systemId, bodyId) >= LAUNCHERS_PER_BODY_MAX) {
    return ok({ skipped: true, atCap: true });
  }
  return ok({});
}

function devValidateAmount(n) {
  const amount = Number(n);
  if (!Number.isFinite(amount) || amount < 0) {
    return err(DEV_CODES.INVALID_AMOUNT, 'Amount must be a non-negative number');
  }
  return ok({ amount });
}

// --- Cheats ---

export function devGrantCredits(state, n) {
  const check = devValidateAmount(n);
  if (!check.ok) return check;
  const before = state.credits;
  state.credits += check.details.amount;
  return ok({ before, after: state.credits, granted: check.details.amount });
}

export function devGrantSolarii(state, n) {
  const check = devValidateAmount(n);
  if (!check.ok) return check;
  state.solarii = (state.solarii ?? 0) + check.details.amount;
  return ok({ granted: check.details.amount, total: state.solarii });
}

export function devUnlockSolarii(state) {
  state.solariiUnlocked = true;
  return ok({ solariiUnlocked: true });
}

function applyCargoToInventory(inventory, capacityHolder, grant) {
  const next = addCargo(inventory, grant);
  const total = cargoTotal(next);
  if (total > (capacityHolder.capacity ?? 0)) {
    capacityHolder.capacity = Math.ceil(total);
  }
  inventory.rawMaterials = next.rawMaterials;
  inventory.fuel = next.fuel;
  inventory.manufacturedGoods = next.manufacturedGoods;
  return next;
}

/** Grant logistics cargo into the viewed system's export depot (creating one if needed). */
export function devGrantCargo(state, systemId, cargo = {}) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const grant = normalizeCargo({
    rawMaterials: cargo.rawMaterials ?? 0,
    fuel: cargo.fuel ?? 0,
    manufacturedGoods: cargo.manufacturedGoods ?? 0,
  });
  if (cargoTotal(grant) <= 0) {
    return err(DEV_CODES.INVALID_AMOUNT, 'Cargo grant must include at least one resource');
  }

  ensureLogisticsState(state);
  let depot = findExportDepot(state, systemId);
  if (!depot) {
    const reg = registerExportDepot(state, state.activeGalaxyId, systemId, {
      inventory: emptyCargo(),
      allowNonPlayer: true,
      force: true,
      source: 'dev',
    });
    if (!reg.ok) return err(DEV_CODES.ACTION_FAILED, reg.reason ?? 'Could not create export depot');
    depot = reg.depot;
  }

  const before = normalizeCargo(depot.inventory);
  const after = applyCargoToInventory(depot.inventory, depot, grant);
  depot.operational = true;
  return ok({ systemId, depotId: depot.id, before, after, granted: grant });
}

export function devRevealIntel(state, systemId) {
  const check = devValidateSystem(state, systemId);
  if (!check.ok) return check;
  if (!hasIntel(state, systemId)) {
    getGalaxyIntel(state)[systemId] = { gatheredAt: state.time };
    invalidateIntelCache(state);
  }
  return ok({ systemId, hasIntel: true });
}

export function devRevealAllIntel(state) {
  let systems = 0;
  let galaxies = 0;
  let wormholes = 0;
  for (const [galaxyId, galaxy] of Object.entries(state.galaxies ?? {})) {
    galaxy.intel ??= {};
    const nodes = [...(galaxy.graph?.stars ?? [])];
    if (galaxy.graph?.blackHole) nodes.push(galaxy.graph.blackHole);
    for (const node of nodes) {
      galaxy.intel[node.id] = galaxy.intel[node.id] ?? { gatheredAt: state.time, source: 'dev-reveal-all' };
      systems++;
    }
    galaxy.discovered = true;
    if (galaxy.abstract) galaxy.abstract.intel = { ...galaxy.intel };
    galaxies++;
    const wormhole = state.wormholes?.[`wh-${galaxyId}`];
    if (wormhole) {
      wormhole.discovered = true;
      wormholes++;
    }
  }
  invalidateIntelCache(state);
  return ok({ systems, galaxies, wormholes });
}

export function devAdvanceTime(state, ms) {
  const amount = Number(ms);
  if (!Number.isFinite(amount) || amount <= 0) {
    return err(DEV_CODES.INVALID_AMOUNT, 'Time advance must be a positive number');
  }
  const before = state.time;
  const wasPaused = state.paused;
  const events = advance(state, amount);
  return ok({
    before,
    after: state.time,
    ticks: Math.floor(amount / TICK_MS),
    wasPaused,
    events,
  });
}

export function devForceShellProgress(state, systemId, sails) {
  const check = devValidateSystem(state, systemId);
  if (!check.ok) return check;
  const sailCount = Number(sails);
  if (!Number.isFinite(sailCount) || sailCount < 0) {
    return err(DEV_CODES.INVALID_AMOUNT, 'Sails must be a non-negative number');
  }
  const result = forceShellProgress(state, systemId, sailCount);
  if (!result.ok) return err(DEV_CODES.INVALID_SYSTEM, result.reason ?? 'Shell progress failed');
  return ok({ systemId, sails: sailCount, events: result.events ?? [] });
}

export function devSetBattleStance(state, stance) {
  const check = devValidateStance(stance);
  if (!check.ok) return check;
  setBattleStance(state, stance);
  return ok({ stance: state.battleStance });
}

export function devSetCombatDoctrine(state, doctrine, systemId = null) {
  const check = devValidateDoctrine(doctrine);
  if (!check.ok) return check;
  const result = setCombatDoctrine(state, check.details.doctrine, systemId);
  return ok({ doctrine: result.doctrine, applied: result.applied });
}

export function devForceCapture(state, systemId) {
  const check = devValidateSystem(state, systemId, { forbidCore: true });
  if (!check.ok) return check;
  if (isPlayerOwned(state, systemId)) {
    return err(DEV_CODES.ALREADY_OWNED, 'System is already player-owned');
  }
  devRevealIntel(state, systemId);
  systemById(state, systemId).owner = 'player';
  if (state.capture[systemId]) delete state.capture[systemId];
  return ok({ systemId, owner: 'player' });
}

// --- Force-build ---

export function devForceBuildOutpost(state, systemId, planetId) {
  const can = devCanForceBuildOutpost(state, systemId, planetId);
  if (!can.ok) return can;
  if (can.details?.skipped) return ok({ skipped: true, type: 'outpost' });

  const system = systemById(state, systemId);
  const id = allocateStructureId();
  system.structures.push({
    id,
    type: 'outpost',
    bodyId: planetId,
    builtAtTime: state.time,
  });
  return ok({ built: 'outpost', structureId: id, bodyId: planetId });
}

export function devForceBuildShipyard(state, systemId, planetId) {
  const can = devCanForceBuildShipyard(state, systemId, planetId);
  if (!can.ok) return can;
  if (can.details?.skipped) return ok({ skipped: true, type: 'shipyard' });

  const system = systemById(state, systemId);
  const id = allocateStructureId();
  system.structures.push({
    id,
    type: 'shipyard',
    bodyId: planetId,
    builtAtTime: state.time,
    builds: [],
  });
  return ok({ built: 'shipyard', structureId: id, bodyId: planetId });
}

export function devForceBuildFoundry(state, systemId, planetId) {
  const can = devCanForceBuildFoundry(state, systemId, planetId);
  if (!can.ok) return can;
  if (can.details?.skipped) return ok({ skipped: true, type: 'sail_foundry' });

  const system = systemById(state, systemId);
  const id = allocateStructureId();
  system.structures.push({
    id,
    type: 'sail_foundry',
    bodyId: planetId,
    builtAtTime: state.time,
  });
  return ok({ built: 'sail_foundry', structureId: id, bodyId: planetId });
}

export function devForceBuildLauncher(state, systemId, bodyId) {
  const can = devCanForceBuildLauncher(state, systemId, bodyId);
  if (!can.ok) return can;
  if (can.details?.skipped) {
    return ok({ skipped: true, type: 'dyson_launcher', atCap: !!can.details.atCap });
  }

  const system = systemById(state, systemId);
  const id = allocateStructureId();
  system.structures.push({
    id,
    type: 'dyson_launcher',
    bodyId,
    builtAtTime: state.time,
  });
  const dyson = ensureDyson(system);
  dyson.launcherStock[id] = 0;
  dyson.launcherLastFireAt[id] = state.time;
  return ok({ built: 'dyson_launcher', structureId: id, bodyId });
}

export function devForceBuildResearchStation(state, systemId) {
  const check = devValidateSystem(state, systemId, { forbidCore: true });
  if (!check.ok) return check;
  if (researchStationCount(state, systemId) >= RESEARCH_STATION_CAP) {
    return ok({ skipped: true, type: 'research_station', atCap: true });
  }
  const system = check.details.system;
  const host = system.bodies.find((b) => b.type === 'habitable') ?? system.bodies[0];
  if (!host) return err(DEV_CODES.INVALID_PLANET, 'No anchor body for research station');

  const id = allocateStructureId();
  const orbitIndex = researchStationCount(state, systemId);
  system.structures.push({
    id,
    type: 'research_station',
    bodyId: host.id,
    orbitIndex,
    builtAtTime: state.time,
  });
  system.researchStationCount = researchStationCount(state, systemId) + 1;
  return ok({ built: 'research_station', structureId: id, bodyId: host.id });
}

export function devForceBuildTradeStation(state, systemId, planetId) {
  const planetCheck = devValidatePlanet(state, systemId, planetId);
  if (!planetCheck.ok) return planetCheck;
  const system = systemById(state, systemId);
  const existing = system.structures.some((s) => s.type === 'trade_station' && s.bodyId === planetId);
  if (existing) return ok({ skipped: true, type: 'trade_station' });

  const id = allocateStructureId();
  system.structures.push({
    id,
    type: 'trade_station',
    bodyId: planetId,
    builtAtTime: state.time,
  });
  return ok({ built: 'trade_station', structureId: id, bodyId: planetId });
}

export function devUnlockTech(state, nodeId) {
  ensureResearchState(state);
  if (!techNode(nodeId)) return err(DEV_CODES.UNKNOWN_TECH, `Unknown tech: ${nodeId}`);
  if (!isTechUnlocked(state, nodeId)) {
    state.research.unlocked.push(nodeId);
    applyTechEffect(state, nodeId);
  }
  if (String(nodeId).startsWith('fs_hull_')) {
    refreshFlagshipHullFromTech(state);
  }
  return ok({ nodeId, unlocked: true, hullStage: flagshipHullStage(state) });
}

export function devUnlockAllTech(state) {
  ensureResearchState(state);
  const unlocked = [];
  const unlockedIds = new Set(state.research.unlocked ?? []);
  for (const node of allTechNodes()) {
    if (!unlockedIds.has(node.id)) {
      state.research.unlocked.push(node.id);
      unlockedIds.add(node.id);
      applyTechEffect(state, node.id);
      unlocked.push(node.id);
    }
  }
  refreshFlagshipHullFromTech(state);
  return ok({ count: unlocked.length, unlocked, hullStage: flagshipHullStage(state) });
}

function unlockTechList(state, nodeIds) {
  ensureResearchState(state);
  const unlocked = [];
  const unlockedIds = new Set(state.research.unlocked ?? []);
  for (const nodeId of nodeIds) {
    if (!techNode(nodeId)) continue;
    if (unlockedIds.has(nodeId)) continue;
    state.research.unlocked.push(nodeId);
    unlockedIds.add(nodeId);
    applyTechEffect(state, nodeId);
    unlocked.push(nodeId);
  }
  return unlocked;
}

function invalidateTechCache(state) {
  applyTechEffect(state, state.research?.unlocked?.[0] ?? 'eco_baseline');
}

/**
 * Set Hull Forge stage to 0–5. Unlocks stages ≤ N and strips higher stage techs
 * so visuals/stats match the requested Mk for testing.
 */
export function devSetHullForgeStage(state, stage) {
  ensureResearchState(state);
  const target = Math.max(0, Math.min(5, Math.round(Number(stage) || 0)));
  const forgeSet = new Set(DEV_HULL_FORGE_STAGE_IDS);
  state.research.unlocked = (state.research.unlocked ?? []).filter((id) => !forgeSet.has(id));
  const unlocked = [];
  for (let i = 0; i < target; i++) {
    const id = DEV_HULL_FORGE_STAGE_IDS[i];
    state.research.unlocked.push(id);
    unlocked.push(id);
  }
  invalidateTechCache(state);
  const hull = refreshFlagshipHullFromTech(state);
  return ok({
    stage: flagshipHullStage(state),
    unlocked,
    maxHp: hull?.nextMax ?? flagshipMaxHpForState(state),
    effects: {
      hpMult: techEffects(state).flagshipHpMult,
      dpsMult: techEffects(state).flagshipDpsMult,
      speedMult: techEffects(state).flagshipSpeedMult,
      commandMult: techEffects(state).flagshipCommandMult,
    },
  });
}

export function devUnlockHullForge(state) {
  return devSetHullForgeStage(state, 5);
}

export function devUnlockFleetRefits(state) {
  const unlocked = unlockTechList(state, DEV_FLEET_REFIT_TECH_IDS);
  return ok({
    count: unlocked.length,
    unlocked,
    refits: { ...techEffects(state).hullRefits },
  });
}

export function devUnlockLateFlagship(state) {
  // Ensure Hull Forge stage 5 + late cluster for hero path testing.
  const forge = unlockTechList(state, DEV_HULL_FORGE_STAGE_IDS);
  const late = unlockTechList(state, DEV_LATE_FLAGSHIP_TECH_IDS);
  refreshFlagshipHullFromTech(state);
  return ok({
    forge,
    late,
    hullStage: flagshipHullStage(state),
    unlockHeroFlagship: !!techEffects(state).unlockHeroFlagship,
  });
}

/** Damage flagship to a fraction of max HP (visual scorch testing). */
export function devDamageFlagship(state, fraction = 0.5) {
  const flagship = state.flagship;
  if (!flagship) return err(DEV_CODES.NO_FLAGSHIP, 'No player flagship');
  refreshFlagshipHullFromTech(state);
  const maxHp = Math.max(1, flagship.maxHp ?? flagshipMaxHpForState(state));
  const pct = Math.max(0.01, Math.min(1, Number(fraction) || 0.5));
  const before = flagship.hp;
  flagship.hp = Math.max(1, Math.round(maxHp * pct));
  return ok({ before, after: flagship.hp, maxHp, fraction: pct });
}

export function devMaxFlagshipKit(state) {
  const forge = devSetHullForgeStage(state, 5);
  const refits = devUnlockFleetRefits(state);
  const late = unlockTechList(state, DEV_LATE_FLAGSHIP_TECH_IDS);
  refreshFlagshipHullFromTech(state);
  const heal = devHealFlagship(state);
  return ok({
    stage: forge.details?.stage,
    refitCount: refits.details?.count,
    late,
    heal: heal.ok ? heal.details : heal,
  });
}

export function devCompleteActiveResearch(state) {
  ensureResearchState(state);
  if (!state.research.activeNodeId) {
    return err(DEV_CODES.INVALID_SYSTEM, 'No active research');
  }
  const nodeId = state.research.activeNodeId;
  if (!isTechUnlocked(state, nodeId)) {
    state.research.unlocked.push(nodeId);
    applyTechEffect(state, nodeId);
  }
  if (String(nodeId).startsWith('fs_hull_')) {
    refreshFlagshipHullFromTech(state);
  }
  state.research.activeNodeId = null;
  state.research.progress = 0;
  state.research.durationMs = null;
  return ok({ nodeId, completed: true, hullStage: flagshipHullStage(state) });
}

export function devForceAiCaptureSystem(state, systemId) {
  const check = devValidateSystem(state, systemId, { forbidCore: true });
  if (!check.ok) return check;
  return forceAiCapture(state, systemId);
}

export function devBuildEmpireKit(state, systemId, planetId) {
  const results = [
    devBuildPlanetKit(state, systemId, planetId),
    devForceBuildResearchStation(state, systemId),
    devForceBuildTradeStation(state, systemId, planetId),
  ];
  const built = [];
  const skipped = [];
  const errors = [];
  for (const r of results) {
    if (!r.ok) {
      errors.push({ code: r.code, reason: r.reason });
      continue;
    }
    if (r.details?.built) {
      if (Array.isArray(r.details.built)) built.push(...r.details.built);
      else built.push(r.details.built);
    }
    if (r.details?.skipped) {
      if (Array.isArray(r.details.skipped)) skipped.push(...r.details.skipped);
      else skipped.push(r.details.skipped);
    }
    if (r.details?.errors) errors.push(...r.details.errors);
  }
  return ok({ built, skipped, errors });
}

// --- Kits ---

function aggregateKitResults(results) {
  const built = [];
  const skipped = [];
  const errors = [];
  for (const r of results) {
    if (!r.ok) {
      errors.push({ code: r.code, reason: r.reason });
      continue;
    }
    if (r.details?.skipped) skipped.push(r.details.type ?? 'unknown');
    else if (r.details?.built) built.push(r.details.built);
    else if (r.details?.builtItems) {
      built.push(...r.details.builtItems);
      skipped.push(...(r.details.skippedItems ?? []));
    }
  }
  return ok({ built, skipped, errors });
}

export function devBuildPlanetKit(state, systemId, planetId) {
  const planetCheck = devValidatePlanet(state, systemId, planetId);
  if (!planetCheck.ok) return planetCheck;

  const results = [
    devForceBuildOutpost(state, systemId, planetId),
    devForceBuildShipyard(state, systemId, planetId),
  ];
  return aggregateKitResults(results);
}

export function devBuildSystemKit(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const system = sysCheck.details.system;
  const habitable = system.bodies.filter((b) => b.type === 'habitable');
  if (!habitable.length) {
    return ok({ built: [], skipped: [], errors: [], planets: 0 });
  }

  const built = [];
  const skipped = [];
  const errors = [];
  for (const planet of habitable) {
    const kit = devBuildPlanetKit(state, systemId, planet.id);
    if (!kit.ok) {
      errors.push({ planetId: planet.id, code: kit.code, reason: kit.reason });
      continue;
    }
    built.push(...kit.details.built.map((t) => `${planet.id}:${t}`));
    skipped.push(...kit.details.skipped.map((t) => `${planet.id}:${t}`));
    errors.push(...kit.details.errors);
  }
  return ok({ built, skipped, errors, planets: habitable.length });
}

export function devBuildDysonKit(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId, { forbidCore: true });
  if (!sysCheck.ok) return sysCheck;

  const system = sysCheck.details.system;
  const built = [];
  const skipped = [];
  const errors = [];

  const habitable = system.bodies.find((b) => b.type === 'habitable');
  if (habitable) {
    const foundry = devForceBuildFoundry(state, systemId, habitable.id);
    if (!foundry.ok) errors.push({ code: foundry.code, reason: foundry.reason });
    else if (foundry.details.skipped) skipped.push('sail_foundry');
    else built.push('sail_foundry');
  }

  for (const planet of system.bodies) {
    for (const moon of planet.moons) {
      while (launcherCountOnBody(state, systemId, moon.id) < LAUNCHERS_PER_BODY_MAX) {
        const launcher = devForceBuildLauncher(state, systemId, moon.id);
        if (!launcher.ok) {
          errors.push({ bodyId: moon.id, code: launcher.code, reason: launcher.reason });
          break;
        }
        if (launcher.details.skipped) break;
        built.push(`launcher:${moon.id}`);
      }
    }
  }

  ensureDyson(system);
  return ok({ built, skipped, errors });
}

export function devInstantSpawnAtShipyard(state, systemId, shipyardId, hull) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const hullCheck = devValidateHull(hull, { includeScout: true });
  if (!hullCheck.ok) return hullCheck;

  const shipyard = findStructure(state, systemId, shipyardId);
  if (!shipyard || shipyard.type !== 'shipyard') {
    return err(DEV_CODES.NO_SHIPYARD, 'No such shipyard');
  }

  if (shipyard.builds?.length) shipyard.builds = [];
  normalizeShipyardBuilds(shipyard);

  let spawned;
  if (hull === 'scout') {
    spawned = spawnScout(state, systemId);
    return ok({ hull, scoutId: spawned.id, shipyardId });
  }

  spawned = spawnPlayerShip(state, systemId, hull, shipyard.bodyId);
  checkBattleTrigger(state, systemId);
  return ok({ hull, shipId: spawned.id, shipyardId });
}

// --- Spawn ---

export function devSpawnFriendlyShips(state, systemId, hull, count, anchorBodyId = null) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const hullCheck = devValidateHull(hull, { includeScout: false });
  if (!hullCheck.ok) return hullCheck;

  const countCheck = devValidateCount(count);
  if (!countCheck.ok) return countCheck;

  if (anchorBodyId) {
    const bodyCheck = devValidateBody(state, systemId, anchorBodyId);
    if (!bodyCheck.ok) return bodyCheck;
  }

  const ids = [];
  for (let i = 0; i < countCheck.details.count; i++) {
    const ship = spawnPlayerShip(state, systemId, hull, anchorBodyId);
    ids.push(ship.id);
  }
  checkBattleTrigger(state, systemId);
  return ok({ hull, count: ids.length, shipIds: ids, systemId });
}

export function devSpawnScouts(state, systemId, count) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const countCheck = devValidateCount(count);
  if (!countCheck.ok) return countCheck;

  const ids = [];
  for (let i = 0; i < countCheck.details.count; i++) {
    ids.push(spawnScout(state, systemId).id);
  }
  return ok({ count: ids.length, scoutIds: ids, systemId });
}

export function devSpawnEnemyFleet(state, systemId, composition = PIRATE_SHIPS) {
  ensurePiratesState(state);
  const result = devSpawnEnemyFleetAtSystem(state, systemId, composition);
  if (!result.ok) return result;
  checkBattleTrigger(state, systemId);
  return result;
}

export function devSpawnEnemyFleetPreset(state, systemId, size = 'small') {
  const composition = DEV_ENEMY_PRESETS[size];
  if (!composition) {
    return err(DEV_CODES.INVALID_PRESET, `Unknown enemy preset: ${size}`);
  }
  return devSpawnEnemyFleet(state, systemId, composition);
}

export function devSpawnFleetPreset(state, systemId, presetId, anchorBodyId = null) {
  const composition = DEV_FLEET_PRESETS[presetId];
  if (!composition) {
    return err(DEV_CODES.INVALID_PRESET, `Unknown fleet preset: ${presetId}`);
  }
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const spawned = [];
  for (const entry of composition) {
    if (entry.hull === 'scout') {
      const res = devSpawnScouts(state, systemId, entry.count);
      if (!res.ok) return res;
      spawned.push({ hull: 'scout', count: res.details.count, ids: res.details.scoutIds });
    } else {
      const res = devSpawnFriendlyShips(state, systemId, entry.hull, entry.count, anchorBodyId);
      if (!res.ok) return res;
      spawned.push({ hull: entry.hull, count: res.details.count, ids: res.details.shipIds });
    }
  }
  return ok({ presetId, systemId, spawned });
}

export function devSpawnAiShips(state, systemId, hull, count, anchorBodyId = null, factionId = null) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  const hullCheck = devValidateHull(hull, { includeScout: false });
  if (!hullCheck.ok) return hullCheck;

  const countCheck = devValidateCount(count);
  if (!countCheck.ok) return countCheck;

  if (anchorBodyId) {
    const bodyCheck = devValidateBody(state, systemId, anchorBodyId);
    if (!bodyCheck.ok) return bodyCheck;
  }

  const ids = [];
  for (let i = 0; i < countCheck.details.count; i++) {
    const ship = spawnAiShip(state, systemId, hull, anchorBodyId, factionId);
    if (!ship) return err(DEV_CODES.INVALID_HULL, `Failed to spawn AI hull: ${hull}`);
    ids.push(ship.id);
  }
  checkBattleTrigger(state, systemId);
  return ok({ hull, count: ids.length, shipIds: ids, systemId, owner: 'ai' });
}

export function devSpawnHeroFlagship(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  const result = spawnHeroFlagshipForTest(state, systemId);
  if (!result.ok) return err(DEV_CODES.ACTION_FAILED, result.reason ?? 'Hero spawn failed');
  checkBattleTrigger(state, systemId);
  return ok({ heroId: result.heroId, systemId: result.systemId ?? systemId });
}

export function devHealFlagship(state) {
  const flagship = state.flagship;
  if (!flagship) return err(DEV_CODES.NO_FLAGSHIP, 'No player flagship');
  refreshFlagshipHullFromTech(state);
  const before = flagship.hp;
  flagship.hp = flagship.maxHp ?? flagshipMaxHpForState(state);
  if (flagship.wing?.ready != null && flagship.wing?.complement) {
    // leave wing as-is; HP heal only
  }
  return ok({
    before,
    after: flagship.hp,
    maxHp: flagship.maxHp,
    hullStage: flagshipHullStage(state),
  });
}

export function devHealShipsInSystem(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  let healed = 0;
  for (const ship of state.playerShips ?? []) {
    if (ship.systemId !== systemId || ship.transit) continue;
    if (ship.hp < (ship.maxHp ?? ship.hp)) {
      ship.hp = ship.maxHp ?? ship.hp;
      healed++;
    } else {
      ship.hp = ship.maxHp ?? ship.hp;
      healed++;
    }
  }
  const flagship = state.flagship;
  if (flagship && flagship.systemId === systemId && !flagship.transit && !flagship.wormholeTransit) {
    flagship.hp = flagship.maxHp ?? flagship.hp;
  }
  for (const hero of state.heroFlagships ?? []) {
    if (hero.systemId === systemId && !hero.transit) {
      hero.hp = hero.maxHp ?? hero.hp;
      healed++;
    }
  }
  return ok({ systemId, healed });
}

export function devForceBuildBodyStructure(state, systemId, bodyId, type) {
  if (!type || !BODY_STRUCTURE_DEFS[type]) {
    return err(DEV_CODES.INVALID_STRUCTURE, `Unknown body structure: ${type}`);
  }
  const def = BODY_STRUCTURE_DEFS[type];
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;

  if (!def.starNode) {
    const bodyCheck = devValidateBody(state, systemId, bodyId);
    if (!bodyCheck.ok) return bodyCheck;
  }

  // Ensure player ownership for force-build convenience
  if (!isPlayerOwned(state, systemId) && !def.blackHoleOnly) {
    systemById(state, systemId).owner = 'player';
  }

  const result = buildBodyStructure(state, systemId, def.starNode ? null : bodyId, type, {
    remote: true,
    ignoreCredits: true,
    ignoreTech: true,
    immediate: true,
    alreadyPaid: true,
  });
  if (!result.ok) return err(DEV_CODES.ACTION_FAILED, result.reason ?? 'Body structure build failed');
  return ok({
    built: type,
    structureId: result.structureId,
    systemId,
    bodyId: result.bodyId ?? null,
  });
}

export function devForceBuildStrategicStructure(state, systemId, type, planetId = null) {
  if (!type || !STRUCTURE_DEFS[type]) {
    return err(DEV_CODES.INVALID_STRUCTURE, `Unknown strategic structure: ${type}`);
  }
  const def = STRUCTURE_DEFS[type];
  const sysCheck = devValidateSystem(state, systemId, { forbidCore: true });
  if (!sysCheck.ok) return sysCheck;

  if (!isPlayerOwned(state, systemId)) {
    systemById(state, systemId).owner = 'player';
  }

  if (def.perBody) {
    const planetCheck = devValidatePlanet(state, systemId, planetId, { allowBarren: true, allowGas: false });
    if (!planetCheck.ok) return planetCheck;
    if (def.requiresOutpost && !hasOutpost(state, systemId, planetId)) {
      const outpost = devForceBuildOutpost(state, systemId, planetId);
      if (!outpost.ok) return outpost;
    }
  }

  const system = systemById(state, systemId);
  const existing = def.perBody
    ? (system.structures ?? []).filter((s) => s.type === type && s.bodyId === planetId).length
    : (system.structures ?? []).filter((s) => s.type === type).length;
  if (existing >= def.cap) return ok({ skipped: true, type });

  const id = allocateStructureId();
  system.structures.push({
    id,
    type,
    bodyId: def.perBody ? planetId : null,
    builtAtTime: state.time,
  });
  return ok({ built: type, structureId: id, systemId, bodyId: def.perBody ? planetId : null });
}

export function devDeployBuilderDrone(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  const result = deployBuilderDrone(state, systemId);
  if (!result.ok) return err(DEV_CODES.ACTION_FAILED, result.reason ?? 'Builder drone deploy failed');
  return ok(result);
}

export function devSetCompletedDysons(state, count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return err(DEV_CODES.INVALID_COUNT, 'Completed Dyson count must be a non-negative integer');
  }
  const events = setCompletedDysonsForTest(state, n);
  return ok({
    count: n,
    diplomacyUnlocked: state.milestones?.diplomacyUnlocked ?? false,
    superweaponUnlocked: state.milestones?.superweaponUnlocked ?? false,
    events,
  });
}

export function devForceBuildSuperweaponCradle(state, systemId = null) {
  const target = systemId ?? state.stronghold;
  const sysCheck = devValidateSystem(state, target);
  if (!sysCheck.ok) return sysCheck;

  setCompletedDysonsForTest(state, Math.max(3, state.milestones?.completedDysonSystems?.length ?? 0));
  ensureResearchState(state);
  if (!isTechUnlocked(state, 'sw_cradle_unlock')) {
    state.research.unlocked.push('sw_cradle_unlock');
    applyTechEffect(state, 'sw_cradle_unlock');
  }

  if (hasSuperweaponCradle(state, target)) {
    ensureSuperweapon(state);
    const existingYard = systemById(state, target)?.structures?.find((structure) => (
      structure.type === 'helioclast_shipyard' || structure.type === 'superweapon_cradle'
    ));
    if (existingYard && existingYard.builtAtTime == null) {
      existingYard.builtAtTime = state.time;
      existingYard.operational = true;
    }
    state.superweapon.cradleSystemId = target;
    return ok({ skipped: true, type: 'helioclast_shipyard', systemId: target });
  }

  const attempt = buildSuperweaponCradle(state, target, { tutorialBypass: true, instant: true });
  if (attempt.ok) return ok({ built: 'helioclast_shipyard', systemId: target });

  ensureSuperweapon(state);
  const system = systemById(state, target);
  system.structures.push({
    id: allocateStructureId(),
    type: 'helioclast_shipyard',
    bodyId: null,
    builtAtTime: state.time,
  });
  state.superweapon.cradleSystemId = target;
  return ok({ built: 'helioclast_shipyard', systemId: target, forced: true, bypassReason: attempt.reason });
}

function mapGameResult(result, fallbackCode = DEV_CODES.ACTION_FAILED) {
  if (result?.ok) return ok(result);
  return err(result?.code ?? fallbackCode, result?.reason ?? 'Action failed');
}

export function devSuperweaponCreate(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  return mapGameResult(superweaponCreate(state, systemId, { immediate: true, tutorialBypass: true }));
}

export function devSuperweaponDestroy(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  return mapGameResult(superweaponDestroy(state, systemId, { immediate: true, tutorialBypass: true }));
}

export function devSuperweaponJump(state, systemId) {
  const sysCheck = devValidateSystem(state, systemId);
  if (!sysCheck.ok) return sysCheck;
  return mapGameResult(superweaponJump(state, systemId, { immediate: true, tutorialBypass: true }));
}

export function devUnlockSuperweaponMilestone(state) {
  setCompletedDysonsForTest(state, Math.max(3, state.milestones?.completedDysonSystems?.length ?? 0));
  return ok({
    superweaponUnlocked: !!state.milestones?.superweaponUnlocked,
    completedDysons: state.milestones?.completedDysonSystems?.length ?? 0,
  });
}

const SW_PART_TECH = Object.freeze({
  frame: 'sw_cradle_unlock',
  power: 'sw_cradle_power_core',
  focus: 'sw_precision_targeting',
  create: 'sw_create_star',
  destroy: 'sw_destroy_star',
  jump: 'sw_jump_gate',
  containment: 'sw_containment_lattice',
  gate_cap: 'sw_gate_capacitor',
  sovereign_relay: 'sw_sovereign_relay',
});

export function devInstallAllSuperweaponParts(state) {
  const cradle = devForceBuildSuperweaponCradle(state, state.stronghold);
  if (!cradle.ok) return cradle;
  ensureResearchState(state);
  ensureSuperweapon(state);
  const installed = [];
  const skipped = [];
  for (const partId of SUPERWEAPON_PART_IDS) {
    const techId = SW_PART_TECH[partId];
    if (techId && !isTechUnlocked(state, techId)) {
      state.research.unlocked.push(techId);
      applyTechEffect(state, techId);
    }
    if (state.superweapon.installedParts?.[partId]) {
      skipped.push(partId);
      continue;
    }
    // Bypass cost for install in order.
    state.credits = Math.max(state.credits, 999999);
    state.solarii = Math.max(state.solarii ?? 0, 999);
    const res = installSuperweaponPart(state, partId, { instant: true });
    if (res.ok) installed.push(partId);
    else skipped.push(partId);
  }
  state.superweapon.online = true;
  return ok({ installed, skipped, online: true, cradleSystemId: state.superweapon.cradleSystemId });
}

export function devSkipHelioclastPartTimer(state) {
  ensureSuperweapon(state);
  if (!state.superweapon.buildJob) return ok({ skipped: true, reason: 'No active berth job' });
  return mapGameResult(completeHelioclastBuildJob(state));
}

/** Start a timed berth job for the next installable part (visible yard work). */
export function devAssembleNextHelioclastPart(state) {
  ensureSuperweapon(state);
  if (state.superweapon.buildJob) {
    return ok({
      skipped: true,
      reason: `Already assembling ${state.superweapon.buildJob.partId}`,
      partId: state.superweapon.buildJob.partId,
    });
  }
  if (!hasSuperweaponCradle(state, state.superweapon.cradleSystemId ?? state.stronghold)) {
    const cradle = devForceBuildSuperweaponCradle(state, state.stronghold);
    if (!cradle.ok) return cradle;
  }
  ensureResearchState(state);
  state.credits = Math.max(state.credits, 999999);
  state.solarii = Math.max(state.solarii ?? 0, 999);
  for (const partId of SUPERWEAPON_PART_IDS) {
    const techId = SW_PART_TECH[partId];
    if (techId && !isTechUnlocked(state, techId)) {
      state.research.unlocked.push(techId);
      applyTechEffect(state, techId);
    }
    if (state.superweapon.installedParts?.[partId]) continue;
    const res = installSuperweaponPart(state, partId, { instant: false });
    if (res.ok) return ok({ partId, buildJob: res.buildJob, timed: true });
  }
  return ok({ skipped: true, reason: 'All berth parts already installed' });
}

export function devForceSuperweaponOnline(state) {
  const parts = devInstallAllSuperweaponParts(state);
  if (!parts.ok) return parts;
  ensureResearchState(state);
  for (const techId of ['sw_live_fire', 'sw_novacula_online']) {
    if (!isTechUnlocked(state, techId)) {
      state.research.unlocked.push(techId);
      applyTechEffect(state, techId);
    }
  }
  ensureSuperweapon(state);
  state.superweapon.liveFireComplete = true;
  state.superweapon.online = true;
  state.superweapon.cooldownUntil = 0;
  state.superweapon.jumpCooldownUntil = 0;
  return ok({ online: true, novaculaOnline: true, helioclastOnline: true, liveFireComplete: true });
}

export function devMarkHelioclastLiveFire(state) {
  ensureSuperweapon(state);
  state.superweapon.liveFireComplete = true;
  return ok({ liveFireComplete: true });
}

export function devClearSuperweaponCooldown(state) {
  ensureSuperweapon(state);
  state.superweapon.cooldownUntil = 0;
  state.superweapon.jumpCooldownUntil = 0;
  if (state.superweapon.fireSequence) state.superweapon.fireSequence = null;
  return ok({ cleared: true });
}

export function devTeleportPirate(state, systemId, fleetIndex = 0) {
  ensurePiratesState(state);
  const check = devValidateSystem(state, systemId);
  if (!check.ok) return check;
  const result = devTeleportPirateFleet(state, systemId, fleetIndex);
  if (!result.ok) return result;
  checkBattleTrigger(state, systemId);
  return result;
}

/** Dispatch table for tests and panel. */
export function devAction(state, action, params = {}) {
  switch (action) {
    case 'grantCredits':
      return devGrantCredits(state, params.amount ?? 1000);
    case 'grantSolarii':
      return devGrantSolarii(state, params.amount ?? 100);
    case 'grantCargo':
      return devGrantCargo(state, params.systemId, params);
    case 'unlockSolarii':
      return devUnlockSolarii(state);
    case 'revealIntel':
      return devRevealIntel(state, params.systemId);
    case 'revealAllIntel':
      return devRevealAllIntel(state);
    case 'advanceTime':
      return devAdvanceTime(state, params.ms ?? 60000);
    case 'forceShellProgress':
      return devForceShellProgress(state, params.systemId, params.sails ?? SHELL_SAILS_REQUIRED);
    case 'setBattleStance':
      return devSetBattleStance(state, params.stance ?? 'balanced');
    case 'setCombatDoctrine':
      return devSetCombatDoctrine(state, params.doctrine ?? 'assault', params.systemId ?? null);
    case 'forceCapture':
      return devForceCapture(state, params.systemId);
    case 'forceBuildOutpost':
      return devForceBuildOutpost(state, params.systemId, params.planetId);
    case 'forceBuildShipyard':
      return devForceBuildShipyard(state, params.systemId, params.planetId);
    case 'forceBuildFoundry':
      return devForceBuildFoundry(state, params.systemId, params.planetId);
    case 'forceBuildLauncher':
      return devForceBuildLauncher(state, params.systemId, params.bodyId ?? params.planetId);
    case 'forceBuildResearchStation':
      return devForceBuildResearchStation(state, params.systemId);
    case 'forceBuildTradeStation':
      return devForceBuildTradeStation(state, params.systemId, params.planetId);
    case 'forceBuildBodyStructure':
      return devForceBuildBodyStructure(
        state,
        params.systemId,
        params.bodyId ?? params.planetId,
        params.type,
      );
    case 'forceBuildStrategicStructure':
      return devForceBuildStrategicStructure(
        state,
        params.systemId,
        params.type,
        params.planetId ?? params.bodyId ?? null,
      );
    case 'deployBuilderDrone':
      return devDeployBuilderDrone(state, params.systemId);
    case 'buildPlanetKit':
      return devBuildPlanetKit(state, params.systemId, params.planetId);
    case 'buildSystemKit':
      return devBuildSystemKit(state, params.systemId);
    case 'buildDysonKit':
      return devBuildDysonKit(state, params.systemId);
    case 'buildEmpireKit':
      return devBuildEmpireKit(state, params.systemId, params.planetId);
    case 'unlockTech':
      return devUnlockTech(state, params.nodeId);
    case 'unlockAllTech':
      return devUnlockAllTech(state);
    case 'setHullForgeStage':
      return devSetHullForgeStage(state, params.stage ?? 5);
    case 'unlockHullForge':
      return devUnlockHullForge(state);
    case 'unlockFleetRefits':
      return devUnlockFleetRefits(state);
    case 'unlockLateFlagship':
      return devUnlockLateFlagship(state);
    case 'damageFlagship':
      return devDamageFlagship(state, params.fraction ?? 0.5);
    case 'maxFlagshipKit':
      return devMaxFlagshipKit(state);
    case 'completeResearch':
      return devCompleteActiveResearch(state);
    case 'forceAiCapture':
      return devForceAiCaptureSystem(state, params.systemId);
    case 'instantSpawnAtShipyard':
      return devInstantSpawnAtShipyard(state, params.systemId, params.shipyardId, params.hull);
    case 'spawnFriendly':
      return devSpawnFriendlyShips(
        state,
        params.systemId,
        params.hull,
        params.count ?? 1,
        params.anchorBodyId ?? null,
      );
    case 'spawnScouts':
      return devSpawnScouts(state, params.systemId, params.count ?? 1);
    case 'spawnFleetPreset':
      return devSpawnFleetPreset(
        state,
        params.systemId,
        params.presetId,
        params.anchorBodyId ?? params.planetId ?? null,
      );
    case 'spawnAiShips':
      return devSpawnAiShips(
        state,
        params.systemId,
        params.hull,
        params.count ?? 1,
        params.anchorBodyId ?? params.planetId ?? null,
        params.factionId ?? null,
      );
    case 'spawnHeroFlagship':
      return devSpawnHeroFlagship(state, params.systemId);
    case 'spawnEnemyFleet':
      if (params.size) return devSpawnEnemyFleetPreset(state, params.systemId, params.size);
      return devSpawnEnemyFleet(state, params.systemId, params.composition);
    case 'teleportPirate':
      return devTeleportPirate(state, params.systemId, params.fleetIndex ?? 0);
    case 'healFlagship':
      return devHealFlagship(state);
    case 'healShipsInSystem':
      return devHealShipsInSystem(state, params.systemId);
    case 'setCompletedDysons':
      return devSetCompletedDysons(state, params.count ?? 3);
    case 'buildSuperweaponCradle':
      return devForceBuildSuperweaponCradle(state, params.systemId ?? null);
    case 'unlockSuperweaponMilestone':
      return devUnlockSuperweaponMilestone(state);
    case 'installAllSuperweaponParts':
      return devInstallAllSuperweaponParts(state);
    case 'forceSuperweaponOnline':
      return devForceSuperweaponOnline(state);
    case 'markHelioclastLiveFire':
      return devMarkHelioclastLiveFire(state);
    case 'skipHelioclastPartTimer':
      return devSkipHelioclastPartTimer(state);
    case 'assembleNextHelioclastPart':
      return devAssembleNextHelioclastPart(state);
    case 'clearSuperweaponCooldown':
      return devClearSuperweaponCooldown(state);
    case 'superweaponCreate':
      return devSuperweaponCreate(state, params.systemId);
    case 'superweaponDestroy':
      return devSuperweaponDestroy(state, params.systemId);
    case 'superweaponJump':
      return devSuperweaponJump(state, params.systemId);
    default:
      return err(DEV_CODES.INVALID_SYSTEM, `Unknown dev action: ${action}`);
  }
}
