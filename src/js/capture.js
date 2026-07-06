// Dynamic capture requirement + 20s uncontested hold (GDD §9).

import {
  CAPTURE_BASE,
  CAPTURE_PER_PLANET,
  CAPTURE_PER_MOON,
  CAPTURE_STRUCTURE_WEIGHT,
  CAPTURE_DYSON_SHELL_WEIGHT,
  CAPTURE_FLAGSHIP_FORCE,
  CAPTURE_HOLD_MS,
  TICK_MS,
  HERO_FLAGSHIP_CAPTURE_FORCE,
} from './constants.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { systemById } from './state.js';
import { getGalaxyCapture, getSystems } from './galaxy-scope.js';
import { hasIntel } from './intel.js';
import { totalCaptureForceFromShips, captureForceFromAnchoredGroups } from './fleets.js';
import { pirateCombatPresence } from './pirates.js';
import { aiCombatPresence } from './ai-ships.js';
import {
  forwardBaseCaptureBonus,
  commandPostCaptureReduction,
} from './strategic-structures.js';
import { heroesInSystem } from './hero-flagships.js';
import { isTechUnlocked, techEffects } from './tech-web.js';

export function captureRequirement(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  let req = CAPTURE_BASE;
  for (const body of system.bodies) {
    req += CAPTURE_PER_PLANET;
    req += body.moons.length * CAPTURE_PER_MOON;
  }
  for (const s of system.structures) {
    req += CAPTURE_STRUCTURE_WEIGHT[s.type] ?? 1;
  }
  const shells = system.dyson?.completedShells ?? 0;
  req += shells * CAPTURE_DYSON_SHELL_WEIGHT;
  req -= commandPostCaptureReduction(state, systemId);
  return Math.max(CAPTURE_BASE, Math.ceil(req));
}

export function captureForceInSystem(state, systemId) {
  let force = totalCaptureForceFromShips(state, systemId);
  force += captureForceFromAnchoredGroups(state, systemId);
  const f = state.flagship;
  if (f.systemId === systemId && !f.transit && !f.wormholeTransit
      && f.galaxyId === state.activeGalaxyId) {
    force += CAPTURE_FLAGSHIP_FORCE;
  }
  for (const hero of heroesInSystem(state, systemId)) {
    if (state.time >= (hero.buildCompleteAt ?? 0)) {
      let hf = HERO_FLAGSHIP_CAPTURE_FORCE;
      if (isTechUnlocked(state, 'hero_rally_doctrine')) hf *= 1.25;
      force += hf;
    }
  }
  force += forwardBaseCaptureBonus(state, systemId);
  force += techEffects(state).captureForceBonus ?? 0;
  return force;
}

export function enemyCombatPresence(state, systemId) {
  return pirateCombatPresence(state, systemId) + aiCombatPresence(state, systemId);
}

export function isCapturableSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || systemId === BLACK_HOLE_ID) return false;
  return system.owner !== 'player';
}

export function canHoldCapture(state, systemId) {
  if (!isCapturableSystem(state, systemId)) return false;
  if (!hasIntel(state, systemId)) return false;
  if (captureForceInSystem(state, systemId) < captureRequirement(state, systemId)) return false;
  if (enemyCombatPresence(state, systemId) > 0) return false;
  return true;
}

export function captureProgressMs(state, systemId) {
  return getGalaxyCapture(state)[systemId]?.progressMs ?? 0;
}

export function tickCapture(state) {
  const capture = getGalaxyCapture(state);
  for (const systemId of Object.keys(getSystems(state))) {
    if (!isCapturableSystem(state, systemId)) {
      if (capture[systemId]) delete capture[systemId];
      continue;
    }

    if (canHoldCapture(state, systemId)) {
      const entry = capture[systemId] ?? { progressMs: 0 };
      entry.progressMs += TICK_MS;
      capture[systemId] = entry;

      if (entry.progressMs >= CAPTURE_HOLD_MS) {
        systemById(state, systemId).owner = 'player';
        delete capture[systemId];
        return { captured: systemId };
      }
    } else if (capture[systemId]) {
      delete capture[systemId];
    }
  }
  return null;
}
