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
import { aiShipFactionId, aiShipsInSystem } from './ai-ships.js';
import {
  forwardBaseCaptureBonus,
  commandPostCaptureReduction,
} from './strategic-structures.js';
import { heroesInSystem } from './hero-flagships.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
import { isOperationalStructure, reconcileStructureTechnology } from './body-structures.js';
import { canAttackSystem, isAtWar, recordOccupation } from './diplomacy.js';
import { hostileStructureCombatPresence } from './combat.js';
import { captureForceForShip } from './hull.js';
import { tutorialCaptureHoldMs } from './tutorial-access.js';

export function captureRequirement(state, systemId) {
  const system = systemById(state, systemId);
  if (!system) return 0;
  let req = CAPTURE_BASE;
  for (const body of system.bodies) {
    req += CAPTURE_PER_PLANET;
    req += body.moons.length * CAPTURE_PER_MOON;
  }
  for (const s of system.structures) {
    if (!isOperationalStructure(state, s, { systemId })) continue;
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
    force += CAPTURE_FLAGSHIP_FORCE * (techEffects(state).flagshipCommandMult ?? 1);
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
  const hostileAi = aiShipsInSystem(state, systemId)
    .filter((ship) => isAtWar(state, aiShipFactionId(state, ship)))
    .reduce((total, ship) => total + captureForceForShip(ship), 0);
  return pirateCombatPresence(state, systemId)
    + hostileAi
    + hostileStructureCombatPresence(state, systemId);
}

export function isCapturableSystem(state, systemId) {
  const system = systemById(state, systemId);
  if (!system || systemId === BLACK_HOLE_ID) return false;
  return system.owner !== 'player';
}

export function canHoldCapture(state, systemId) {
  if (!isCapturableSystem(state, systemId)) return false;
  if (state.systemBattles?.[systemId]?.active) return false;
  const target = systemById(state, systemId);
  if (target?.owner !== 'neutral') {
    const attack = canAttackSystem(state, target, 'player');
    if (!attack.ok) return false;
  }
  if (!hasIntel(state, systemId)) return false;
  if (captureForceInSystem(state, systemId) < captureRequirement(state, systemId)) return false;
  if (enemyCombatPresence(state, systemId) > 0) return false;
  return true;
}

export function captureProgressMs(state, systemId) {
  return getGalaxyCapture(state)[systemId]?.progressMs ?? 0;
}

function captureCandidateSystemIds(state, capture) {
  const ids = new Set(Object.keys(capture ?? {}));

  const f = state.flagship;
  if (f.galaxyId === state.activeGalaxyId && f.systemId && !f.transit && !f.wormholeTransit) {
    ids.add(f.systemId);
  }

  for (const ship of state.playerShips ?? []) {
    if (ship.galaxyId === state.activeGalaxyId && ship.systemId && !ship.transit && ship.hp > 0) {
      ids.add(ship.systemId);
    }
  }

  for (const hero of state.heroFlagships ?? []) {
    if (hero.galaxyId === state.activeGalaxyId && hero.systemId && !hero.transit) {
      ids.add(hero.systemId);
    }
  }

  // Preserve the old global behavior for any future tech that grants passive capture force.
  if ((techEffects(state).captureForceBonus ?? 0) > 0) {
    for (const systemId of Object.keys(getSystems(state))) ids.add(systemId);
  }

  return ids;
}

export function tickCapture(state) {
  const capture = getGalaxyCapture(state);
  for (const systemId of captureCandidateSystemIds(state, capture)) {
    if (!isCapturableSystem(state, systemId)) {
      if (capture[systemId]) delete capture[systemId];
      continue;
    }

    if (canHoldCapture(state, systemId)) {
      const entry = capture[systemId] ?? { progressMs: 0 };
      entry.progressMs += TICK_MS;
      capture[systemId] = entry;

      if (entry.progressMs >= tutorialCaptureHoldMs(state, CAPTURE_HOLD_MS)) {
        const system = systemById(state, systemId);
        const previousOwner = system.owner;
        const previousFactionId = system.factionId
          ?? (previousOwner === 'ai'
            ? state.factions?.ai?.id ?? state.factions?.list?.[0]?.id ?? 'unknown-ai'
            : null);
        let occupation = null;
        if (previousOwner === 'neutral') {
          system.owner = 'player';
          system.factionId = null;
          for (const structure of system.structures ?? []) structure.factionId = null;
        } else {
          const occupied = recordOccupation(state, {
            galaxyId: state.activeGalaxyId,
            systemId,
            occupier: 'player',
            previousActor: previousFactionId,
            previousOwner,
            previousFactionId,
          });
          if (!occupied.ok) {
            delete capture[systemId];
            return { blocked: systemId, reason: occupied.reason };
          }
          occupation = occupied.occupation;
        }
        const technology = reconcileStructureTechnology(state, systemId, { owner: 'player' });
        delete capture[systemId];
        return {
          captured: systemId,
          mothballed: technology.mothballed ?? [],
          reactivated: technology.reactivated ?? [],
          occupationId: occupation?.id ?? null,
        };
      }
    } else if (capture[systemId]) {
      delete capture[systemId];
    }
  }
  return null;
}
