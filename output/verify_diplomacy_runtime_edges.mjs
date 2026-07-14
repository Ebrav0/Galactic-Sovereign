import { createNewGame, systemById } from '../src/js/state.js';
import { seedAiFaction } from '../src/js/ai-faction.js';
import { spawnAiShip } from '../src/js/ai-ships.js';
import { spawnPlayerShip } from '../src/js/fleets.js';
import { checkBattleTrigger, tickCombat } from '../src/js/combat.js';
import {
  concludePeace,
  createClaim,
  declareWar,
  ensureDiplomacy,
  establishContact,
  recordOccupation,
  getActiveWar,
} from '../src/js/diplomacy.js';
import {
  createExpansionCampaign,
  tickStrategicOperations,
} from '../src/js/strategic-operations.js';
import { strategicIntegrationHooks } from '../src/js/strategic-integration.js';
import {
  ensureSuperweapon,
  superweaponDestroy,
  tickSuperweapon,
} from '../src/js/superweapon.js';

let passed = 0;
let failed = 0;
function check(condition, label, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${details ? ` - ${details}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${details ? ` - ${details}` : ''}`);
  }
}

function fresh(seed) {
  const state = createNewGame(seed);
  state.paused = false;
  seedAiFaction(state, state.homeGalaxyId);
  ensureDiplomacy(state);
  const faction = state.factions.list[0];
  establishContact(state, faction.id, { stage: 'established', trigger: 'test' });
  const system = Object.values(state.galaxies[state.activeGalaxyId].systems)
    .find((entry) => entry.owner === 'ai' && entry.factionId === faction.id);
  if (!system) throw new Error('AI fixture has no owned system');
  return { state, faction, system };
}

function startWar(state, faction, systemId) {
  const result = declareWar(state, faction.id, {
    attacker: 'player',
    goals: [{ type: 'claimed_conquest', systemIds: [systemId] }],
  });
  if (!result.ok) throw new Error(result.reason);
  return result.war;
}

{
  const { state, faction, system } = fresh(8101);
  faction.research ??= { unlocked: [] };
  faction.research.unlocked ??= [];
  faction.research.unlocked.push('mil_missile_silo_network');
  state.research.unlocked = state.research.unlocked.filter((id) => id !== 'mil_missile_silo_network');
  const silo = {
    id: 'edge-silo', type: 'missile_silo', bodyId: system.bodies[0]?.id ?? null,
    level: 1, hp: 340, maxHp: 340, factionId: faction.id,
  };
  system.structures.push(silo);
  const war = startWar(state, faction, system.id);
  const occupation = recordOccupation(state, {
    warId: war.id,
    galaxyId: state.activeGalaxyId,
    systemId: system.id,
    occupier: 'player',
    previousActor: faction.id,
  });
  check(occupation.ok && silo.mothballed === true, 'occupation mothballs structures unsupported by the new owner');
  const peace = concludePeace(state, war.id, {});
  check(peace.ok && system.owner === 'ai' && system.factionId === faction.id, 'peace restores sovereign ownership');
  check(silo.mothballed === false, 'peace reactivates structures supported by the restored owner');
}

{
  const { state, faction, system } = fresh(8102);
  const war = startWar(state, faction, system.id);
  const clone = structuredClone(system);
  clone.owner = 'ai';
  clone.factionId = faction.id;
  state.galaxies['gal-1'].systems = { [system.id]: clone };
  const first = recordOccupation(state, {
    warId: war.id, galaxyId: 'gal-0', systemId: system.id,
    occupier: 'player', previousActor: faction.id,
  });
  const second = recordOccupation(state, {
    warId: war.id, galaxyId: 'gal-1', systemId: system.id,
    occupier: 'player', previousActor: faction.id,
  });
  check(first.ok && second.ok, 'same system id can be occupied independently in two galaxies');
  const ambiguous = concludePeace(state, war.id, { cededSystemIds: [system.id] });
  check(!ambiguous.ok && /Ambiguous cession/.test(ambiguous.reason), 'unscoped multi-galaxy cession is rejected atomically');
  check(war.status === 'active', 'ambiguous peace leaves the active war unchanged');
  const scoped = concludePeace(state, war.id, {
    cededSystems: [{ galaxyId: 'gal-0', systemId: system.id }],
  });
  check(scoped.ok, 'galaxy-scoped cession concludes peace');
  check(state.galaxies['gal-0'].systems[system.id].owner === 'player', 'scoped cession transfers only the named galaxy');
  check(state.galaxies['gal-1'].systems[system.id].owner === 'ai', 'same-id system in the other galaxy is restored');
}

{
  const { state, faction, system } = fresh(8103);
  const war = startWar(state, faction, system.id);
  state.flagship.systemId = system.id;
  state.flagship.galaxyId = state.activeGalaxyId;
  state.flagship.transit = null;
  state.flagship.wormholeTransit = null;
  const playerShip = spawnPlayerShip(state, system.id, 'corvette');
  spawnAiShip(state, system.id, 'corvette', null, faction.id);
  const battle = checkBattleTrigger(state, system.id);
  const unit = battle?.units?.find((entry) => entry.id === playerShip.id);
  if (unit) unit.hp = Math.max(1, unit.maxHp - 37);
  const beforeCredits = state.credits;
  const peace = concludePeace(state, war.id, {});
  tickCombat(state);
  check(peace.ok && !state.systemBattles[system.id], 'peace terminates an active tactical battle as a ceasefire');
  check(playerShip.hp === unit?.hp, 'ceasefire persists in-progress tactical hull damage');
  check(state.credits === beforeCredits, 'ceasefire awards no combat salvage');
  check(state.battleReports.at(-1)?.winner === 'ceasefire', 'ceasefire produces an auditable battle report');
}

{
  const { state, faction, system } = fresh(8104);
  const war = startWar(state, faction, system.id);
  state.flagship.systemId = system.id;
  state.flagship.galaxyId = state.activeGalaxyId;
  state.flagship.transit = null;
  state.flagship.wormholeTransit = null;
  spawnPlayerShip(state, system.id, 'corvette');
  spawnAiShip(state, system.id, 'corvette', null, faction.id);
  const battle = checkBattleTrigger(state, system.id);
  for (const unit of battle.units.filter((entry) => entry.side === 'enemy')) unit.hp = 0;
  tickCombat(state);
  check(war.score > 0, 'formal-war tactical victory updates persistent war score', `score=${war.score}`);
  check(war.events.some((entry) => entry.type === 'battle_victory'), 'combat outcome is recorded in diplomatic war history');
}

{
  const { state, faction, system } = fresh(8105);
  const war = startWar(state, faction, system.id);
  // Model an enemy occupation so the system remains a legal hostile target.
  system.owner = 'player';
  system.factionId = null;
  const occupation = recordOccupation(state, {
    warId: war.id,
    galaxyId: 'gal-0',
    systemId: system.id,
    occupier: faction.id,
    previousActor: 'player',
    previousOwner: 'player',
  });
  const claim = createClaim(state, {
    claimant: 'player', target: faction.id, galaxyId: 'gal-0', systemId: system.id,
  });
  const remoteCopy = structuredClone(system);
  state.galaxies['gal-1'].systems = { [system.id]: remoteCopy };
  const remoteShip = spawnPlayerShip(state, state.stronghold, 'corvette');
  remoteShip.galaxyId = 'gal-1';
  remoteShip.systemId = system.id;
  ensureSuperweapon(state);
  state.superweapon.online = true;
  state.solarii = 10_000;
  if (!state.research.unlocked.includes('sw_destroy_star')) state.research.unlocked.push('sw_destroy_star');
  const destroy = superweaponDestroy(state, system.id, { immediate: true });
  check(destroy.ok && !systemById(state, system.id, 'gal-0'), 'authorized superweapon strike removes its target system');
  check(state.playerShips.some((ship) => ship.id === remoteShip.id), 'same-id entities in another galaxy survive the purge');
  check(occupation.occupation.status === 'destroyed', 'destroyed system closes its active occupation');
  check(claim.claim.status === 'void', 'destroyed system voids its active claims');
  const peace = concludePeace(state, war.id, {});
  check(peace.ok, 'destroyed occupation cannot deadlock a later peace settlement');
}

{
  const { state, faction, system } = fresh(8106);
  const war = startWar(state, faction, system.id);
  ensureSuperweapon(state);
  state.superweapon.online = true;
  state.solarii = 10_000;
  if (!state.research.unlocked.includes('sw_destroy_star')) state.research.unlocked.push('sw_destroy_star');
  const before = state.solarii;
  const request = superweaponDestroy(state, system.id, { immediate: false });
  const charged = state.solarii;
  const peace = concludePeace(state, war.id, {});
  state.time = state.superweapon.fireSequence.resolveAt;
  tickSuperweapon(state);
  check(request.ok && peace.ok, 'deferred strike can be followed by a negotiated peace');
  check(systemById(state, system.id, 'gal-0') != null, 'peace revalidation blocks the deferred hostile strike');
  check(state.superweapon.fireSequence.blocked === true, 'blocked deferred strike records its authorization failure');
  check(charged < before && state.solarii === before, 'blocked deferred strike refunds its full Solarii cost');
}

{
  const { state } = fresh(8107);
  const [firstFaction, secondFaction] = state.factions.list;
  const galaxy = state.galaxies[state.activeGalaxyId];
  const candidates = galaxy.graph.stars
    .map((star) => star.id)
    .filter((systemId) => systemId !== state.stronghold && galaxy.systems[systemId]);
  const [midId, targetId] = candidates;
  const sourceStar = galaxy.graph.stars.find((star) => star.id === state.stronghold);
  const midStar = galaxy.graph.stars.find((star) => star.id === midId);
  const targetStar = galaxy.graph.stars.find((star) => star.id === targetId);
  galaxy.graph = {
    ...galaxy.graph,
    stars: [sourceStar, midStar, targetStar],
    lanes: [[state.stronghold, midId], [midId, targetId]],
  };
  galaxy.systems[midId].owner = 'ai';
  galaxy.systems[midId].factionId = firstFaction.id;
  galaxy.systems[targetId].owner = 'ai';
  galaxy.systems[targetId].factionId = secondFaction.id;
  state.credits = 1_000_000;
  for (const tech of ['eco_construction_drones', 'eco_sector_capitals']) {
    if (!state.research.unlocked.includes(tech)) state.research.unlocked.push(tech);
  }
  const hooks = {
    ...strategicIntegrationHooks(),
    hasIntel: () => true,
    assessTarget: () => ({
      ok: true,
      requiredCaptureForce: 1,
      requiredCombatPower: 1,
      hostileCombatPower: 1,
      availableCaptureForce: 10,
      availableCombatPower: 10,
    }),
    dispatchFleet: () => ({ ok: true, dispatchId: 'edge-dispatch', status: 'traveling' }),
    fleetStatus: () => ({ ok: true, status: 'traveling' }),
  };
  const created = createExpansionCampaign(state, {
    name: 'Two-border corridor',
    targets: [targetId],
    templateId: 'frontier',
    warAuthorizations: [
      { factionId: firstFaction.id, warGoal: 'border_security' },
      { factionId: secondFaction.id, warGoal: 'claimed_conquest' },
    ],
  }, { hooks });
  check(created.ok, 'campaign preview accepts explicitly authorized intermediary and target wars');
  for (let index = 0; index < 5; index += 1) {
    state.time += 500;
    tickStrategicOperations(state, { hooks });
  }
  check(!!getActiveWar(state, firstFaction.id), 'campaign declares the authorized intermediary war before dispatch');
  check(!!getActiveWar(state, secondFaction.id), 'campaign declares the authorized target war before dispatch');
}

console.log(`\nDIPLOMACY RUNTIME EDGES: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
