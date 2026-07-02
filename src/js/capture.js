// Dynamic capture requirement + 20s uncontested hold (GDD §9).

import {
  CAPTURE_BASE,
  CAPTURE_PER_PLANET,
  CAPTURE_PER_MOON,
  CAPTURE_STRUCTURE_WEIGHT,
  CAPTURE_HOLD_MS,
  CAPTURE_GARRISON_WEIGHT,
  TICK_MS,
} from './constants.js';
import { BLACK_HOLE_ID } from './galaxy.js';
import { systemById } from './state.js';
import { hasIntel } from './intel.js';
import { captureForceFor, flagshipCaptureForce } from './hulls.js';
import { shipsInSystem } from './ships.js';
import { garrisonCaptureWeight, garrisonUnitCount } from './garrison.js';
import { liveEnemyCount } from './combat.js';

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
  if (hasIntel(state, systemId)) {
    req += garrisonCaptureWeight(state, systemId) * CAPTURE_GARRISON_WEIGHT;
  }
  return Math.ceil(req);
}

export function captureForceInSystem(state, systemId) {
  let force = 0;
  for (const ship of shipsInSystem(state, systemId)) {
    force += captureForceFor(ship.hull);
  }
  const f = state.flagship;
  if (f.systemId === systemId && !f.transit && f.hp > 0) {
    force += flagshipCaptureForce(f);
  }
  return force;
}

export function enemyCombatPresence(state, systemId) {
  const override = state._testEnemyPresence?.[systemId];
  if (override !== undefined && override > 0) return override;
  return liveEnemyCount(state, systemId);
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
  return state.capture[systemId]?.progressMs ?? 0;
}

export function tickCapture(state) {
  for (const systemId of Object.keys(state.systems)) {
    if (!isCapturableSystem(state, systemId)) {
      if (state.capture[systemId]) delete state.capture[systemId];
      continue;
    }

    if (canHoldCapture(state, systemId)) {
      const entry = state.capture[systemId] ?? { progressMs: 0 };
      entry.progressMs += TICK_MS;
      state.capture[systemId] = entry;

      if (entry.progressMs >= CAPTURE_HOLD_MS) {
        systemById(state, systemId).owner = 'player';
        delete state.garrisons?.[systemId];
        delete state.capture[systemId];
        return { captured: systemId };
      }
    } else if (state.capture[systemId]) {
      delete state.capture[systemId];
    }
  }
  return null;
}

export function garrisonIntelText(state, systemId) {
  const count = garrisonUnitCount(state, systemId);
  if (count === 0) return 'No garrison detected';
  return `Estimated garrison: ${count} combat unit${count === 1 ? '' : 's'}`;
}
