// Construction drones — timed structure builds while flagship is in-system (Phase 6).

import {
  DRONE_BASE_CAPACITY,
  DRONE_BUILDER_SHIP_BONUS,
  DRONE_MIL_BUILDER_BONUS,
  DRONE_MAX_PER_JOB,
  DRONE_MAX_PER_SYSTEM,
  DRONE_WORK_PER_TICK,
  DRONE_SURVEYOR_SPEED_BONUS,
  STRUCTURE_BUILD_MS,
  TICK_MS,
} from './constants.js';
import {
  systemById,
  findStructure,
  isPlayerOwned,
  isStructureActive,
} from './state.js';
import { allocateStructureId } from './economy.js';
import { flagshipInSystem, flagshipPresentForDrones } from './flagship-presence.js';
import { isTechUnlocked } from './tech-web.js';
import { ensureDyson } from './state.js';
import { refreshSystemStructureCombatFields } from './body-structures.js';

let nextJobId = 1;
let nextDroneId = 1;

export function resetDroneIds(state) {
  let maxDrone = 0;
  for (const drone of state.drones ?? []) {
    const n = parseInt(String(drone.id).replace('drone-', ''), 10);
    if (Number.isFinite(n)) maxDrone = Math.max(maxDrone, n);
  }
  nextDroneId = maxDrone + 1;

  let maxJob = 0;
  for (const job of state.constructionJobs ?? []) {
    const n = parseInt(String(job.id).replace('job-', ''), 10);
    if (Number.isFinite(n)) maxJob = Math.max(maxJob, n);
  }
  nextJobId = maxJob + 1;
}

function ensureArrays(state) {
  if (!state.constructionJobs) state.constructionJobs = [];
  if (!state.drones) state.drones = [];
}

function builderShipCountInSystem(state, systemId) {
  return (state.playerShips ?? []).filter(
    (s) => s.galaxyId === state.activeGalaxyId
      && s.systemId === systemId
      && !s.transit
      && s.hull === 'builder_ship',
  ).length;
}

export function droneCapacity(state, systemId) {
  if (!systemId || !isPlayerOwned(state, systemId)) return 0;
  let cap = DRONE_BASE_CAPACITY;
  cap += builderShipCountInSystem(state, systemId) * DRONE_BUILDER_SHIP_BONUS;
  if (isTechUnlocked(state, 'mil_builder_ship')) cap += DRONE_MIL_BUILDER_BONUS;
  return Math.min(DRONE_MAX_PER_SYSTEM, cap);
}

function surveyorSpeedBonus(state) {
  return isTechUnlocked(state, 'eco_surveyor') ? DRONE_SURVEYOR_SPEED_BONUS : 1;
}

export function activeJobsInSystem(state, systemId, galaxyId = state.activeGalaxyId) {
  ensureArrays(state);
  return state.constructionJobs.filter(
    (j) => j.galaxyId === galaxyId
      && j.systemId === systemId
      && (j.status === 'queued' || j.status === 'active' || j.status === 'paused'),
  );
}

export function hasPendingJob(state, systemId, bodyId, structureType, galaxyId = state.activeGalaxyId) {
  ensureArrays(state);
  return state.constructionJobs.some(
    (j) => j.galaxyId === galaxyId
      && j.systemId === systemId
      && j.bodyId === bodyId
      && j.structureType === structureType
      && (j.status === 'queued' || j.status === 'active' || j.status === 'paused'),
  );
}

export function hasPendingResearchJob(state, systemId, galaxyId = state.activeGalaxyId) {
  ensureArrays(state);
  return state.constructionJobs.some(
    (j) => j.galaxyId === galaxyId
      && j.systemId === systemId
      && j.structureType === 'research_station'
      && (j.status === 'queued' || j.status === 'active' || j.status === 'paused'),
  );
}

export function jobProgress(job) {
  if (!job || job.workRequiredMs <= 0) return 0;
  return Math.min(1, job.workDoneMs / job.workRequiredMs);
}

export function jobEtaMs(job, state) {
  if (!job || job.status === 'complete') return 0;
  const assigned = job.assignedDroneIds?.length ?? 0;
  if (assigned === 0 || job.status === 'paused') return null;
  const rate = DRONE_WORK_PER_TICK * assigned * surveyorSpeedBonus(state);
  if (rate <= 0) return null;
  const remaining = Math.max(0, job.workRequiredMs - job.workDoneMs);
  const ticks = Math.ceil(remaining / rate);
  return ticks * TICK_MS;
}

function syncDronesForSystem(state, systemId) {
  ensureArrays(state);
  const cap = droneCapacity(state, systemId);
  const galaxyId = state.activeGalaxyId;

  let drones = state.drones.filter(
    (d) => d.galaxyId === galaxyId && d.systemId === systemId,
  );

  while (drones.length < cap) {
    const drone = {
      id: `drone-${nextDroneId++}`,
      galaxyId,
      systemId,
      jobId: null,
      slotIndex: drones.length,
    };
    state.drones.push(drone);
    drones.push(drone);
  }

  while (drones.length > cap) {
    const removed = drones.pop();
    unassignDroneFromJob(state, removed.id);
    state.drones = state.drones.filter((d) => d.id !== removed.id);
  }
}

function unassignDroneFromJob(state, droneId) {
  const drone = state.drones.find((d) => d.id === droneId);
  if (!drone?.jobId) return;
  const job = state.constructionJobs.find((j) => j.id === drone.jobId);
  if (job?.assignedDroneIds) {
    job.assignedDroneIds = job.assignedDroneIds.filter((id) => id !== droneId);
  }
  drone.jobId = null;
}

function pauseJobsInSystem(state, systemId) {
  for (const job of state.constructionJobs) {
    if (job.systemId !== systemId || job.galaxyId !== state.activeGalaxyId) continue;
    if (job.status === 'active' || job.status === 'queued') job.status = 'paused';
  }
}

function resumeJobsInSystem(state, systemId) {
  for (const job of state.constructionJobs) {
    if (job.systemId !== systemId || job.galaxyId !== state.activeGalaxyId) continue;
    if (job.status === 'paused') job.status = 'queued';
  }
}

function assignDronesToJobs(state, systemId) {
  const jobs = state.constructionJobs.filter(
    (j) => j.systemId === systemId
      && j.galaxyId === state.activeGalaxyId
      && (j.status === 'queued' || j.status === 'active'),
  );
  const idleDrones = state.drones.filter(
    (d) => d.systemId === systemId && d.galaxyId === state.activeGalaxyId && !d.jobId,
  );

  for (const job of jobs) {
    if (!job.assignedDroneIds) job.assignedDroneIds = [];
    job.assignedDroneIds = job.assignedDroneIds.filter((id) => {
      const drone = state.drones.find((d) => d.id === id);
      return drone && drone.jobId === job.id;
    });
    while (job.assignedDroneIds.length < DRONE_MAX_PER_JOB && idleDrones.length > 0) {
      const drone = idleDrones.shift();
      drone.jobId = job.id;
      job.assignedDroneIds.push(drone.id);
      if (job.status === 'queued') job.status = 'active';
    }
  }
}

function completeStructureJob(state, job) {
  const system = systemById(state, job.systemId, job.galaxyId);
  const structure = findStructure(state, job.systemId, job.structureId, job.galaxyId);
  if (!structure) {
    job.status = 'complete';
    return null;
  }

  delete structure.construction;
  structure.builtAtTime = state.time;
  if (job.upgradeToLevel) {
    structure.level = Math.max(1, Math.min(3, Math.round(job.upgradeToLevel)));
    if (Number.isFinite(job.targetMaxHp)) {
      structure.maxHp = job.targetMaxHp;
      structure.hp = Math.round(job.targetMaxHp * Math.max(0, Math.min(1, job.hpRatio ?? 1)));
    }
  } else {
    structure.level = Math.max(1, Math.min(3, Math.round(structure.level ?? 1)));
  }
  structure.operational = structure.operational !== false;

  if (structure.type === 'outpost') {
    structure.hp = structure.hp ?? 240;
    structure.maxHp = structure.maxHp ?? 240;
    if (system?.star?.kind !== 'trade_nexus'
        && !system?.structures?.some((entry) => entry.type === 'export_depot')) {
      system.structures.push({
        id: allocateStructureId(),
        type: 'export_depot',
        bodyId: null,
        sourceBodyId: structure.bodyId,
        builtAtTime: state.time,
        level: 1,
        hp: 520,
        maxHp: 520,
        operational: true,
      });
    }
  }

  if (structure.type === 'shipyard' && !structure.builds) {
    structure.builds = [];
  }
  if (structure.type === 'dyson_launcher') {
    const dyson = ensureDyson(system);
    dyson.launcherStock[structure.id] = 0;
    dyson.launcherLastFireAt[structure.id] = state.time;
  }
  if (structure.type === 'research_station') {
    system.researchStationCount = (system.researchStationCount ?? 0) + 1;
  }
  refreshSystemStructureCombatFields(state, job.systemId);

  job.status = 'complete';
  for (const droneId of job.assignedDroneIds ?? []) {
    unassignDroneFromJob(state, droneId);
  }
  return {
    jobId: job.id,
    structureId: structure.id,
    structureType: structure.type,
    systemId: job.systemId,
    upgradedToLevel: job.upgradeToLevel ?? null,
  };
}

export function queueStructureUpgradeJob(state, opts) {
  ensureArrays(state);
  const {
    systemId,
    structureId,
    creditCost,
    durationMs,
    targetLevel,
    targetMaxHp = null,
    hpRatio = 1,
  } = opts;
  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct upgrades' };
  }
  if (state.credits < creditCost) return { ok: false, reason: `Need ${creditCost} credits` };
  const structure = findStructure(state, systemId, structureId);
  if (!structure) return { ok: false, reason: 'No such structure' };
  if (structure.construction) return { ok: false, reason: 'Structure work already in progress' };

  const jobId = `job-${nextJobId++}`;
  const workRequiredMs = durationMs ?? 20000;
  state.credits -= creditCost;
  structure.construction = { jobId, durationMs: workRequiredMs, startedAt: state.time, upgrade: true };
  state.constructionJobs.push({
    id: jobId,
    galaxyId: state.activeGalaxyId,
    systemId,
    structureType: structure.type,
    bodyId: structure.bodyId ?? null,
    structureId,
    creditCost,
    workRequiredMs,
    workDoneMs: 0,
    assignedDroneIds: [],
    status: 'queued',
    orderedAt: state.time,
    upgradeToLevel: targetLevel,
    targetMaxHp,
    hpRatio,
  });
  syncDronesForSystem(state, systemId);
  assignDronesToJobs(state, systemId);
  return { ok: true, jobId, structureId, targetLevel };
}

export function queueConstructionJob(state, opts) {
  ensureArrays(state);
  const {
    systemId,
    structureType,
    bodyId,
    creditCost,
    durationMs,
    orbitIndex,
    launcherIndex,
    extraStructureFields = {},
  } = opts;

  if (!flagshipInSystem(state, systemId)) {
    return { ok: false, reason: 'Flagship must be in this system to direct construction' };
  }
  if (state.credits < creditCost) {
    return { ok: false, reason: `Need ${creditCost} credits` };
  }

  const workRequiredMs = durationMs ?? STRUCTURE_BUILD_MS[structureType] ?? 20000;
  const structureId = allocateStructureId();
  const jobId = `job-${nextJobId++}`;

  state.credits -= creditCost;

  const system = systemById(state, systemId);
  system.structures.push({
    id: structureId,
    type: structureType,
    bodyId,
    builtAtTime: null,
    construction: {
      jobId,
      durationMs: workRequiredMs,
      startedAt: state.time,
    },
    ...extraStructureFields,
  });

  state.constructionJobs.push({
    id: jobId,
    galaxyId: state.activeGalaxyId,
    systemId,
    structureType,
    bodyId,
    structureId,
    creditCost,
    workRequiredMs,
    workDoneMs: 0,
    assignedDroneIds: [],
    status: 'queued',
    orderedAt: state.time,
    orbitIndex: orbitIndex ?? null,
    launcherIndex: launcherIndex ?? null,
  });

  syncDronesForSystem(state, systemId);
  assignDronesToJobs(state, systemId);

  return { ok: true, jobId, structureId };
}

export function constructionProgressForStructure(structure, time) {
  if (!structure?.construction) return null;
  const { durationMs, startedAt } = structure.construction;
  if (!durationMs) return 0;
  return Math.min(1, Math.max(0, (time - startedAt) / durationMs));
}

export function tickDrones(state) {
  ensureArrays(state);
  const completions = [];
  const flagshipSystem = flagshipPresentForDrones(state);

  if (flagshipSystem && isPlayerOwned(state, flagshipSystem)) {
    syncDronesForSystem(state, flagshipSystem);
    resumeJobsInSystem(state, flagshipSystem);
    assignDronesToJobs(state, flagshipSystem);

    const speed = surveyorSpeedBonus(state);
    for (const job of state.constructionJobs) {
      if (job.systemId !== flagshipSystem || job.galaxyId !== state.activeGalaxyId) continue;
      if (job.status !== 'active') continue;

      let assignedCount = job.assignedDroneIds?.length ?? 0;
      if (assignedCount > 0) {
        job.workDoneMs += DRONE_WORK_PER_TICK * assignedCount * speed;
      }
      if (job.workDoneMs >= job.workRequiredMs) {
        const event = completeStructureJob(state, job);
        if (event) completions.push(event);
      }
    }
  } else {
    for (const job of state.constructionJobs) {
      if (job.status === 'active' || job.status === 'queued') {
        if (job.systemId) pauseJobsInSystem(state, job.systemId);
      }
    }
  }

  return completions;
}

export function droneSummaryForSystem(state, systemId) {
  ensureArrays(state);
  const drones = state.drones.filter(
    (d) => d.galaxyId === state.activeGalaxyId && d.systemId === systemId,
  );
  const active = drones.filter((d) => d.jobId).length;
  return {
    capacity: droneCapacity(state, systemId),
    count: drones.length,
    active,
    idle: drones.length - active,
  };
}

export function requiresBuilderTech(structureType) {
  return structureType === 'sail_foundry' || structureType === 'dyson_launcher';
}

export function canUseBuilderTech(state, structureType) {
  if (!requiresBuilderTech(structureType)) return { ok: true };
  if (!isTechUnlocked(state, 'mil_builder_ship')) {
    return { ok: false, reason: 'Research Builder Drones first' };
  }
  return { ok: true };
}

export function isStructureUnderConstruction(structure) {
  return !!structure?.construction;
}

export function activeStructureCount(state, systemId, structureType) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  return system.structures.filter(
    (s) => s.type === structureType && isStructureActive(s),
  ).length;
}

export function pendingOrActiveStructureCount(state, systemId, bodyId, structureType) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  const pending = system.structures.filter(
    (s) => s.bodyId === bodyId && s.type === structureType && s.construction,
  ).length;
  return pending;
}
