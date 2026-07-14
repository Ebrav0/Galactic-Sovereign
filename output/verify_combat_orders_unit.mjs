// Pure unit verification for combat-orders.js. No running game or browser needed.
import {
  FLEET_ORDER_TYPES,
  activeFleetOrders,
  aggregateCombatUnits,
  applyFacedDamage,
  applyFleetOrder,
  completeFighterReplenishment,
  consumeFighterSupplies,
  createFighterWingState,
  createLargeBattleLodParityInputs,
  createPostBattleReport,
  createShieldFacings,
  fighterWingConservation,
  launchFighters,
  queueFighterReplenishment,
  rankCombatTargets,
  recoverFighters,
  replenishFighters,
  scoreTargetPriority,
  selectPriorityTarget,
  shieldFacingForHit,
  validateFleetOrder,
  validateLodConservation,
} from '../src/js/combat-orders.js';

const results = [];
function check(name, condition, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function approx(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}

const allies = [
  { id: 'ally-a', side: 'player', hull: 'destroyer', hp: 350, maxHp: 350 },
  { id: 'ally-carrier', side: 'player', hull: 'fleet_carrier', hp: 550, maxHp: 550 },
  { id: 'enemy-structure', side: 'enemy', hull: 'ion_battery', isStructure: true, hp: 220, maxHp: 220 },
];

// --- Order validation and recording ---
check('order contract exposes all ten commands', FLEET_ORDER_TYPES.length === 10
  && ['formation', 'screen', 'protect', 'hold', 'attack_class', 'focus_fire', 'bombard',
    'escort_convoy', 'rally', 'emergency_retreat'].every((type) => FLEET_ORDER_TYPES.includes(type)));

const unknown = validateFleetOrder({ type: 'ram' });
check('unknown order is rejected', !unknown.ok && unknown.errors[0]?.code === 'UNKNOWN_ORDER_TYPE');

const badFormation = validateFleetOrder({ type: 'formation', formation: 'blob' });
check('invalid formation is rejected', !badFormation.ok
  && badFormation.errors.some((error) => error.code === 'INVALID_FORMATION'));

const badAttack = validateFleetOrder({ type: 'attack_class', targetClass: 'planet' });
check('invalid target class is rejected', !badAttack.ok
  && badAttack.errors.some((error) => error.code === 'INVALID_TARGET_CLASS'));

const badRetreat = validateFleetOrder({ type: 'emergency_retreat' });
check('retreat without destination is rejected', !badRetreat.ok
  && badRetreat.errors.some((error) => error.code === 'RETREAT_DESTINATION_REQUIRED'));

const enemyProtect = validateFleetOrder(
  { type: 'protect', targetId: 'enemy-structure', subjectIds: ['ally-a'] },
  { units: allies, side: 'player' },
);
check('protecting enemy target is rejected', !enemyProtect.ok
  && enemyProtect.errors.some((error) => error.code === 'TARGET_NOT_FRIENDLY'));

const battle = { time: 1200, units: allies };
const formation = applyFleetOrder(battle, {
  type: 'formation', formation: 'wedge', groupId: 'bg-1', subjectIds: ['ally-carrier', 'ally-a'],
}, { side: 'player', time: 1300 });
const attack = applyFleetOrder(battle, {
  type: 'attack_class', targetClass: 'fighter', groupId: 'bg-1', subjectIds: ['ally-a'],
}, { side: 'player', time: 1400 });
check('valid orders apply without advancing battle', formation.ok && attack.ok
  && battle.orderSequence === 2 && battle.time === 1200);
check('formation and directive occupy independent slots', activeFleetOrders(battle).length === 2
  && activeFleetOrders(battle)[0].formation === 'wedge'
  && activeFleetOrders(battle)[1].targetClass === 'fighter');

const replacement = applyFleetOrder(battle, {
  type: 'hold', groupId: 'bg-1', subjectIds: ['ally-a'], radius: 120,
}, { side: 'player' });
check('new directive deterministically replaces old directive', replacement.ok
  && replacement.previousOrder?.type === 'attack_class'
  && activeFleetOrders(battle).length === 2);

// --- Deterministic target priorities ---
const interceptor = {
  id: 'interceptor-1', side: 'player', hull: 'interceptor', weaponProfile: 'point_defense',
  hp: 25, maxHp: 25, x: 0, y: 0,
};
const targets = [
  { id: 'capital-z', side: 'enemy', hull: 'battleship', hp: 500, maxHp: 750, x: 80, y: 0 },
  { id: 'fighter-b', side: 'enemy', hull: 'fighter', isWing: true, hp: 25, maxHp: 30, x: 120, y: 0 },
  { id: 'fighter-a', side: 'enemy', hull: 'fighter', isWing: true, hp: 25, maxHp: 30, x: 120, y: 0 },
];
const fighterOrder = { type: 'attack_class', targetClass: 'fighter' };
const rankedA = rankCombatTargets(interceptor, targets, fighterOrder);
const rankedB = rankCombatTargets(interceptor, [...targets].reverse(), fighterOrder);
check('fighter order outranks nearer capital', rankedA[0]?.target.id === 'fighter-a');
check('target tie uses stable id', rankedA[0]?.target.id === 'fighter-a'
  && rankedA[1]?.target.id === 'fighter-b');
check('priority is independent of input order', rankedA.map((entry) => entry.target.id).join('|')
  === rankedB.map((entry) => entry.target.id).join('|'));
check('priority scoring repeats exactly', scoreTargetPriority(interceptor, targets[1], fighterOrder)
  === scoreTargetPriority(interceptor, targets[1], fighterOrder));
check('priority selector returns ranked winner', selectPriorityTarget(interceptor, targets, fighterOrder)?.id === 'fighter-a');

// --- Focus fire ---
const missingFocus = validateFleetOrder({ type: 'focus_fire', subjectIds: ['ally-a'] }, { units: allies, side: 'player' });
check('O2 focus_fire without targetId → TARGET_REQUIRED', !missingFocus.ok
  && missingFocus.errors.some((error) => error.code === 'TARGET_REQUIRED'));

const friendlyFocus = validateFleetOrder(
  { type: 'focus_fire', targetId: 'ally-carrier', subjectIds: ['ally-a'] },
  { units: allies, side: 'player' },
);
check('O3 focus_fire on friendly → TARGET_NOT_HOSTILE', !friendlyFocus.ok
  && friendlyFocus.errors.some((error) => error.code === 'TARGET_NOT_HOSTILE'));

const focusBattle = {
  time: 2000,
  units: [
    ...allies,
    { id: 'enemy-cap', side: 'enemy', hull: 'battleship', hp: 500, maxHp: 500, x: 400, y: 0 },
  ],
  tacticalOrders: {},
  orderSequence: 0,
};
applyFleetOrder(focusBattle, {
  type: 'formation', formation: 'wedge', groupId: 'bg-1', subjectIds: ['ally-a', 'ally-carrier'],
}, { side: 'player', time: 2000, units: focusBattle.units });
const focusApply = applyFleetOrder(focusBattle, {
  type: 'focus_fire', targetId: 'enemy-cap', groupId: 'bg-1', subjectIds: ['ally-a'],
}, { side: 'player', time: 2100, units: focusBattle.units });
check('O4 valid focus_fire applies as directive', focusApply.ok
  && activeFleetOrders(focusBattle).some((order) => order.type === 'focus_fire'));

const focusOrder = { type: 'focus_fire', targetId: 'capital-z' };
const focusPick = selectPriorityTarget(interceptor, targets, focusOrder);
check('O5 focus_fire selects named enemy even if farther', focusPick?.id === 'capital-z');

check('O6 formation slot remains when focus_fire replaces attack directive',
  activeFleetOrders(focusBattle).some((order) => order.type === 'formation' && order.formation === 'wedge')
    && activeFleetOrders(focusBattle).some((order) => order.type === 'focus_fire'));

// --- Shield facings and damage states ---
const shielded = {
  id: 'shielded', side: 'player', hull: 'cruiser', x: 0, y: 0, heading: 0,
  hp: 500, maxHp: 500, shieldFacings: createShieldFacings(50),
};
check('front source resolves to front facing', shieldFacingForHit(shielded, { x: 100, y: 0 }) === 'front');
check('clockwise source resolves to starboard', shieldFacingForHit(shielded, { x: 0, y: -100 }) === 'starboard');
const firstHit = applyFacedDamage(shielded, 80, { x: 100, y: 0 });
check('facing shield absorbs before hull', firstHit.shieldAbsorbed === 50 && firstHit.hullDamage === 30
  && shielded.hp === 470 && shielded.shieldFacings.front.value === 0);

// --- Persistent fighter lifecycle and supplies ---
const wing = createFighterWingState({ capacity: 6, ammoPerCraft: 4, fuelPerCraft: 20 });
check('new wing starts fully ready and conserved', wing.ready === 6 && wing.ammo === 24 && wing.fuel === 120
  && fighterWingConservation(wing).ok);

const launched = launchFighters(wing, 4, { minAmmoPerCraft: 1, minFuelPerCraft: 2 });
check('launch moves ready craft to deployed', launched.ok && wing.ready === 2 && wing.launched === 4
  && fighterWingConservation(wing).ok);

const supplies = consumeFighterSupplies(wing, { ammo: 7, fuel: 25 });
check('sortie consumes persistent ammo and fuel', supplies.ok && wing.ammo === 17 && wing.fuel === 95);

const recovery = recoverFighters(wing, { returned: 3, lost: 1 });
check('recovery records survivors and permanent losses', recovery.ok && recovery.returned === 3
  && recovery.lost === 1 && wing.ready === 5 && wing.launched === 0 && wing.lost === 1
  && fighterWingConservation(wing).ok);
check('loss clamps supplies to surviving capacity', wing.ammo <= 5 * wing.ammoPerCraft
  && wing.fuel <= 5 * wing.fuelPerCraft);

const queued = queueFighterReplenishment(wing, 1);
check('factory queue reserves a lost fighter', queued.ok && wing.lost === 0 && wing.replenishing === 1
  && fighterWingConservation(wing).ok);
const completed = completeFighterReplenishment(wing, 1);
check('completed replacement restores capacity', completed.ok && wing.ready === 6
  && wing.replenishing === 0 && fighterWingConservation(wing).ok);

wing.lost = 1;
wing.ready = 5;
const immediate = replenishFighters(wing, 1);
check('immediate replenishment helper composes queue and completion', immediate.ok
  && immediate.queued === 1 && immediate.completed === 1 && fighterWingConservation(wing).ok);

// --- Deterministic aggregation and conservation ---
const aggregateUnits = [
  {
    id: 'a-2', side: 'player', hull: 'corvette', weaponProfile: 'point_defense',
    hp: 80, maxHp: 120, x: 20, y: 10, shieldFacings: createShieldFacings(5),
  },
  {
    id: 'a-1', side: 'player', hull: 'corvette', weaponProfile: 'point_defense',
    hp: 120, maxHp: 120, x: 0, y: 10, shieldFacings: createShieldFacings(5),
  },
  {
    id: 'e-1', side: 'enemy', hull: 'battleship', weaponProfile: 'torpedo',
    hp: 700, maxHp: 750, x: 200, y: -30,
  },
];
const aggregation = aggregateCombatUnits(aggregateUnits);
const conservation = validateLodConservation(aggregateUnits, aggregation);
check('aggregation conserves unit, hp, shield, and dps totals', conservation.ok,
  conservation.errors.map((error) => error.field).join(','));
check('aggregation produces stable bucket membership', aggregation.buckets
  .flatMap((bucket) => bucket.unitIds).sort().join('|') === 'a-1|a-2|e-1');
const parityA = createLargeBattleLodParityInputs(aggregateUnits, { seed: 42, tickIndex: 7, elapsedMs: 350 });
const parityB = createLargeBattleLodParityInputs([...aggregateUnits].reverse(), { seed: 42, tickIndex: 7, elapsedMs: 350 });
check('LOD parity signature is input-order independent', parityA.signature === parityB.signature,
  `${parityA.signature}/${parityB.signature}`);

const tampered = structuredClone(aggregation);
tampered.buckets[0].hp += 1;
check('conservation verifier detects aggregate drift', !validateLodConservation(aggregateUnits, tampered).ok);

// --- After-action report ---
const report = createPostBattleReport({
  battleId: 'battle-1', systemId: 'sys-1', winner: 'player', startedAt: 1000, endedAt: 5000,
  initialUnits: aggregateUnits,
  finalUnits: [
    { ...aggregateUnits[0], hp: 50 },
    { ...aggregateUnits[1], hp: 120 },
    { ...aggregateUnits[2], hp: 0 },
  ],
  objectives: [{ id: 'depot-1', type: 'export_depot', outcome: 'secured' }],
  cargo: { saved: 90, lost: 10 },
  salvage: { credits: 25, materials: 12 },
});
check('post-battle report summarizes losses and duration', report.durationMs === 4000
  && report.sides.enemy.lost === 1 && report.sides.player.survived === 2);
check('post-battle report preserves objective and logistics outcomes', report.objectives[0]?.outcome === 'secured'
  && report.cargo.saved === 90 && report.salvage.materials === 12);

const failed = results.filter((result) => !result.pass);
console.log(`\nCombat orders unit: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`Failed: ${failed.map((result) => result.name).join(', ')}`);
  process.exit(1);
}
