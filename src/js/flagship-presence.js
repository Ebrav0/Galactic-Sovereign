// Shared flagship presence checks for build orders and drone work.
// Co-op: every pilot has their own flagship — presence is resolved against
// the roster (playerFlagships), not only the local state.flagship alias.

import { ensurePlayerFlagships, getPlayerFlagship } from './flagship.js';

function isPresentInSystem(f, state, systemId) {
  if (!f) return false;
  if (f.systemId !== systemId || f.transit || f.wormholeTransit) return false;
  // Allow missing galaxyId (legacy / mid-spawn) so builds don't freeze.
  if (f.galaxyId != null && state.activeGalaxyId != null && f.galaxyId !== state.activeGalaxyId) {
    return false;
  }
  return true;
}

/** True if the given pilot (or any pilot if pilotId omitted) is in-system. */
export function flagshipInSystem(state, systemId, pilotId = null) {
  if (pilotId) {
    return isPresentInSystem(getPlayerFlagship(state, pilotId) ?? state.flagship, state, systemId);
  }
  // Solo / unspecified: any roster entry counts (legacy jobs without an owner).
  for (const f of ensurePlayerFlagships(state)) {
    if (isPresentInSystem(f, state, systemId)) return true;
  }
  return isPresentInSystem(state.flagship, state, systemId);
}

/**
 * Systems where at least one player flagship is present and can run drones.
 * @returns {string[]}
 */
export function flagshipSystemsPresentForDrones(state) {
  const systems = [];
  const seen = new Set();
  for (const f of ensurePlayerFlagships(state)) {
    if (!f?.systemId || f.transit || f.wormholeTransit) continue;
    if (f.galaxyId != null && state.activeGalaxyId != null && f.galaxyId !== state.activeGalaxyId) continue;
    if (seen.has(f.systemId)) continue;
    seen.add(f.systemId);
    systems.push(f.systemId);
  }
  // Legacy fallback if roster empty.
  if (systems.length === 0) {
    const f = state.flagship;
    if (f?.systemId && !f.transit && !f.wormholeTransit) {
      if (f.galaxyId == null || state.activeGalaxyId == null || f.galaxyId === state.activeGalaxyId) {
        systems.push(f.systemId);
      }
    }
  }
  return systems;
}

/** @deprecated Prefer flagshipSystemsPresentForDrones — kept for callers that expect one system. */
export function flagshipPresentForDrones(state) {
  return flagshipSystemsPresentForDrones(state)[0] ?? null;
}

/** Resolve the flagship that owns a construction job (or any present ship). */
export function flagshipForJob(state, job) {
  if (job?.ownerPlayerId) {
    const owned = getPlayerFlagship(state, job.ownerPlayerId);
    if (owned) return owned;
  }
  // Prefer a ship that is actually in the job's system.
  if (job?.systemId) {
    for (const f of ensurePlayerFlagships(state)) {
      if (isPresentInSystem(f, state, job.systemId)) return f;
    }
  }
  return state.flagship ?? null;
}
