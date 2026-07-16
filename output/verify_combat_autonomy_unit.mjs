import assert from 'node:assert/strict';

import { applyFleetOrder } from '../src/js/combat-orders.js';
import {
  combatIntentForUnit,
  doctrinePolicy,
  explicitDirectiveForUnit,
  flagshipAutopilotPlan,
  setAdvancedTactics,
  setCombatFleetPriority,
  shouldDoctrineDisengage,
} from '../src/js/combat-autonomy.js';

const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

const hostile = { id: 'enemy-capital', hull: 'battleship', side: 'enemy', hp: 750, maxHp: 750, x: 500, y: 0 };
function fixture(doctrine, unit) {
  return {
    state: {
      time: 1000,
      combatDoctrine: doctrine,
      combatSettings: {
        controlMode: 'command',
        fleetPriority: 'auto',
        flagshipAutopilot: true,
        advancedTactics: false,
        retreatPolicy: 'doctrine',
      },
      flagship: { systemId: 'sys-test', x: 0, y: 0, heading: 0 },
      systemBattles: {},
    },
    battle: {
      active: true,
      mode: 'tactical',
      doctrine,
      advancedTactics: false,
      tacticalOrders: {},
      units: [unit, hostile],
    },
  };
}

check('assault units engage aggressively', () => {
  const { state, battle } = fixture('assault', { id: 'escort', hull: 'frigate', side: 'player', hp: 200, maxHp: 200 });
  assert.equal(combatIntentForUnit(state, battle, battle.units[0], [hostile]), 'engage');
  assert.ok(doctrinePolicy('assault').chaseLeash > doctrinePolicy('hold_the_line').chaseLeash);
});

check('screen escorts protect the formation', () => {
  const { state, battle } = fixture('screen', { id: 'escort', hull: 'frigate', side: 'player', hp: 200, maxHp: 200 });
  assert.equal(combatIntentForUnit(state, battle, battle.units[0], [hostile]), 'screen');
  assert.equal(doctrinePolicy('screen').defaultTargetClass, 'fighter');
});

check('carrier strike carriers maintain standoff range', () => {
  const carrier = { id: 'carrier', hull: 'fleet_carrier', side: 'player', hp: 550, maxHp: 550 };
  const { state, battle } = fixture('carrier_strike', carrier);
  assert.equal(combatIntentForUnit(state, battle, carrier, [hostile]), 'maintain_range');
  assert.ok(doctrinePolicy('carrier_strike').flagshipRange > doctrinePolicy('assault').flagshipRange);
});

check('hold the line limits chasing at the formation anchor', () => {
  const line = { id: 'line', hull: 'destroyer', side: 'player', hp: 350, maxHp: 350 };
  const { state, battle } = fixture('hold_the_line', line);
  assert.equal(combatIntentForUnit(state, battle, line, [hostile]), 'hold');
  assert.equal(doctrinePolicy('hold_the_line').defaultTargetClass, null);
});

check('doctrine withdrawal triggers at the role threshold', () => {
  const carrier = { id: 'carrier', hull: 'fleet_carrier', side: 'player', hp: 200, maxHp: 550 };
  const { state, battle } = fixture('carrier_strike', carrier);
  assert.equal(shouldDoctrineDisengage(state, battle, carrier), true);
  carrier.hp = 400;
  assert.equal(shouldDoctrineDisengage(state, battle, carrier), false);
});

check('fleet priority and Advanced Tactics hooks update live battle state', () => {
  const unit = { id: 'escort', hull: 'frigate', side: 'player', hp: 200, maxHp: 200 };
  const { state, battle } = fixture('assault', unit);
  state.systemBattles['sys-test'] = battle;
  assert.equal(setCombatFleetPriority(state, 'carrier', 'sys-test').ok, true);
  assert.equal(battle.fleetPriority, 'carrier');
  assert.equal(setAdvancedTactics(state, true, 'sys-test').ok, true);
  assert.equal(battle.advancedTactics, true);
});

check('explicit orders override doctrine only while Advanced Tactics is enabled', () => {
  const unit = { id: 'escort', hull: 'frigate', side: 'player', hp: 200, maxHp: 200 };
  const { battle } = fixture('assault', unit);
  applyFleetOrder(battle, { type: 'hold', side: 'player', subjectIds: [unit.id] }, {
    time: 1000,
    units: battle.units,
    ownedUnitIds: [unit.id],
  });
  assert.equal(explicitDirectiveForUnit(battle, unit), null);
  battle.advancedTactics = true;
  assert.equal(explicitDirectiveForUnit(battle, unit)?.type, 'hold');
});

check('flagship autopilot selects and closes on the doctrine target', () => {
  const flagship = { id: 'flagship', hull: 'flagship', side: 'player', hp: 2000, maxHp: 2000, x: 0, y: 0 };
  const { state, battle } = fixture('assault', flagship);
  state.systemBattles['sys-test'] = battle;
  const plan = flagshipAutopilotPlan(state);
  assert.equal(plan.targetId, hostile.id);
  assert.ok(plan.x > 0);
  assert.equal(plan.intent, 'maintain_range');
});

console.log(`\nCombat autonomy unit: ${checks.length}/${checks.length} checks passed`);
