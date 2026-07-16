// Directed tactical movement, command cursor, and destroyer AA browser verification.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { hullMotionProfile } from '../src/js/combat-steering.js';
import { factionTechContext } from '../src/js/ai-tech.js';
import { techEffects } from '../src/js/tech-web.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');
const outDir = path.join(here, 'visuals');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, condition, detail = '') => {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

check('fighter hull turn rate exceeds escort and capital rates',
  hullMotionProfile('fighter').turnRateMult > hullMotionProfile('corvette').turnRateMult
    && hullMotionProfile('corvette').turnRateMult > hullMotionProfile('battleship').turnRateMult);

const aiFaction = { id: 'aa-ai', research: { unlocked: ['mil_point_defense'], queue: [] } };
const aiEffects = techEffects(factionTechContext(aiFaction));
check('AI Point Defense Grid grants destroyer AA and retained PD improvement',
  aiEffects.unlockDestroyerAa === true && Math.abs(aiEffects.pointDefenseMult - 1.2) < 1e-9);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(814));

const setup = await page.evaluate(() => {
  const state = window.getGameState();
  const systemId = state.stronghold;
  window.__viewSystem(systemId);
  window.__snapCamera(1850, 1600, 0.75);
  state.paused = false;
  state.flagship.systemId = systemId;
  state.flagship.transit = null;
  state.flagship.wormholeTransit = null;
  window.__spawnFriendlyShip('destroyer', 2);
  state.pirates.fleets = [{
    id: 'directed-verify-pirates',
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: [
      { id: 'directed-enemy-capital', hull: 'battleship', hp: 750, maxHp: 750 },
      // Durable enough to survive the faster command-first opening while the
      // verifier exercises move-leash and independent AA behavior.
      { id: 'directed-enemy-fighter', hull: 'fighter', hp: 3000, maxHp: 3000 },
    ],
  }];
  window.__forcePirateIntoSystem(systemId);
  window.advanceTime(100);
  window.__setAdvancedTactics(true);
  const battle = window.__getBattleState(systemId);
  const destroyers = battle.units.filter((unit) => unit.side === 'player' && unit.hull === 'destroyer');
  const capital = battle.units.find((unit) => unit.id === 'directed-enemy-capital');
  const fighter = battle.units.find((unit) => unit.id === 'directed-enemy-fighter');
  return {
    systemId,
    active: battle?.active,
    destroyerIds: destroyers.map((unit) => unit.id),
    capitalId: capital?.id,
    fighterId: fighter?.id,
    aaBeforeTech: destroyers.map((unit) => unit.aaBattery ?? null),
  };
});

check('directed combat fixture starts', setup.active && setup.destroyerIds.length === 2
  && setup.capitalId && setup.fighterId, JSON.stringify(setup));
check('destroyers have no secondary AA before Point Defense Grid',
  setup.aaBeforeTech.every((battery) => battery == null));

await page.evaluate((ids) => window.__selectCombatUnits(ids), setup.destroyerIds);
await page.locator('#combat-hud-attack').click();
check('HUD Attack button arms command cursor',
  await page.evaluate(() => window.__getCombatCommandMode()) === 'attack');

await page.evaluate(() => {
  const canvas = document.getElementById('game-canvas');
  canvas.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientX: 18,
    clientY: 18,
  }));
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 18, clientY: 18 }));
});
check('invalid Attack click keeps command mode armed',
  await page.evaluate(() => window.__getCombatCommandMode()) === 'attack');

await page.keyboard.press('Escape');
check('Escape cancels armed command',
  await page.evaluate(() => window.__getCombatCommandMode()) == null);

await page.locator('#combat-hud-move').click();
check('HUD Move button arms command cursor',
  await page.evaluate(() => window.__getCombatCommandMode()) === 'move');

const move = await page.evaluate((ids) => {
  const battle = window.__getBattleState();
  const destroyers = battle.units.filter((unit) => ids.includes(unit.id));
  battle.units.filter((unit) => unit.side !== 'player').forEach((unit, index) => {
    unit.x = 4000;
    unit.y = 1600 + index * 80;
    unit.vx = 0;
    unit.vy = 0;
  });
  destroyers.forEach((unit, index) => {
    unit.x = 1600;
    unit.y = 1600 + (index ? 12 : -12);
    unit.vx = 0;
    unit.vy = 0;
    unit.heading = Math.PI;
  });
  window.__selectCombatUnits(ids);
  const canvas = document.getElementById('game-canvas');
  canvas.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    clientX: (2100 - 1850) * 0.75 + canvas.width / 2,
    clientY: canvas.height / 2,
  }));
  const result = Object.values(battle.tacticalOrders ?? {})
    .sort((a, b) => a.sequence - b.sequence).at(-1);
  const before = destroyers.map((unit) => ({ id: unit.id, x: unit.x, y: unit.y, heading: unit.heading }));
  window.advanceTime(50);
  const firstTick = destroyers.map((unit) => ({
    id: unit.id,
    x: unit.x,
    y: unit.y,
    heading: unit.heading,
    anchor: unit.moveAnchor,
  }));
  window.advanceTime(12000);
  const after = destroyers.map((unit) => ({
    id: unit.id,
    x: unit.x,
    y: unit.y,
    anchor: unit.moveAnchor,
  }));
  return {
    result: { ok: result?.type === 'move', order: result },
    before,
    firstTick,
    after,
    text: JSON.parse(window.render_game_to_text()).combatUi,
  };
}, setup.destroyerIds);

const angleDelta = (a, b) => {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
};
check('move directive applies and defaults to 420-unit defense leash',
  move.result.ok && move.text.activeDirective?.type === 'move'
    && move.text.activeDirective?.engagementRadius === 420);
check('right-click ground issued the move directive and cleared armed mode',
  move.result.order?.type === 'move' && move.text.commandMode == null);
check('opposite-facing destroyers turn within hull rate on first tick',
  move.firstTick.every((unit, index) => angleDelta(unit.heading, move.before[index].heading) <= 0.06),
  move.firstTick.map((unit, index) => angleDelta(unit.heading, move.before[index].heading).toFixed(4)).join(','));
check('group receives distinct deterministic formation slots',
  move.firstTick.every((unit) => unit.anchor)
    && new Set(move.firstTick.map((unit) => `${unit.anchor.slotX},${unit.anchor.slotY}`)).size === 2);
check('ships close distance to their assigned move slots', move.after.every((unit, index) => {
  const before = move.before[index];
  const anchor = unit.anchor;
  return anchor && Math.hypot(unit.x - anchor.slotX, unit.y - anchor.slotY)
    < Math.hypot(before.x - anchor.slotX, before.y - anchor.slotY);
}), JSON.stringify({ before: move.before, after: move.after }));
check('combat text state exposes headings, anchors, arcs, and directives',
  move.text.selectedUnits?.length === 2
    && move.text.selectedUnits.every((unit) => unit.destinationAnchor && unit.weaponArcRadians > 0)
    && move.text.threatBoard?.entries?.length === 2
    && move.text.coordinateSystem);

await page.screenshot({ path: path.join(outDir, 'directed-combat-move.png'), fullPage: true });

const persistence = await page.evaluate(async () => {
  const before = JSON.parse(window.render_game_to_text());
  const save = await window.__saveSlot('slot-3');
  const envelope = JSON.parse(localStorage.getItem('gs-save-slot-3'));
  const load = await window.__loadSlot('slot-3');
  const after = JSON.parse(window.render_game_to_text());
  const moveOrder = Object.values(after.tacticalOrders ?? {})
    .find((order) => order.type === 'move');
  return {
    saveOk: save.ok,
    loadOk: load.ok,
    beforeVersion: before.saveVersion,
    envelopeVersion: envelope?.saveVersion,
    afterVersion: after.saveVersion,
    active: after.battle?.active,
    moveOrder,
  };
});

check('save/load during battle preserves the move order shape without a version bump',
  persistence.saveOk && persistence.loadOk && persistence.active
    && persistence.beforeVersion === persistence.envelopeVersion
    && persistence.envelopeVersion === persistence.afterVersion
    && persistence.moveOrder?.engagementRadius === 420
    && persistence.moveOrder?.point,
  JSON.stringify(persistence));

const anchorDefense = await page.evaluate(({ destroyerId, fighterId }) => {
  const battle = window.__getBattleState();
  const destroyer = battle.units.find((unit) => unit.id === destroyerId);
  const fighter = battle.units.find((unit) => unit.id === fighterId);
  const anchor = { ...destroyer.moveAnchor };
  destroyer.x = anchor.slotX;
  destroyer.y = anchor.slotY;
  destroyer.vx = 0;
  destroyer.vy = 0;
  destroyer.heading = 0;
  fighter.returning = true;
  fighter.isWing = true;
  fighter.parentCarrierId = 'missing-anchor-test-carrier';
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.x = anchor.x + 150;
  fighter.y = anchor.y;
  window.advanceTime(100);
  const interceptedTargetId = destroyer.weaponTargetId;

  fighter.x = anchor.x + anchor.engagementRadius + 100;
  fighter.y = anchor.y;
  destroyer.x = anchor.x + anchor.engagementRadius + 10;
  destroyer.y = anchor.slotY;
  destroyer.vx = 0;
  destroyer.vy = 0;
  destroyer.heading = 0;
  const distanceBeforeReturn = Math.hypot(destroyer.x - anchor.slotX, destroyer.y - anchor.slotY);
  window.advanceTime(6000);
  return {
    interceptedTargetId,
    targetAfterLeash: destroyer.weaponTargetId,
    distanceBeforeReturn,
    distanceAfterReturn: Math.hypot(destroyer.x - anchor.slotX, destroyer.y - anchor.slotY),
    anchor: destroyer.moveAnchor,
    fighter: { x: fighter.x, y: fighter.y, hp: fighter.hp },
  };
}, { destroyerId: setup.destroyerIds[0], fighterId: setup.fighterId });

check('arrived move anchor intercepts a threat inside its defensive leash',
  anchorDefense.interceptedTargetId === setup.fighterId, JSON.stringify(anchorDefense));
check('ship drops a threat outside the leash and returns toward its formation slot',
  anchorDefense.targetAfterLeash == null
    && anchorDefense.distanceAfterReturn < anchorDefense.distanceBeforeReturn,
  JSON.stringify(anchorDefense));

const aa = await page.evaluate(({ destroyerId, capitalId, fighterId }) => {
  window.__forceResearch('mil_point_defense');
  window.__snapCamera(1850, 1600, 0.75);
  const battle = window.__getBattleState();
  const destroyer = battle.units.find((unit) => unit.id === destroyerId);
  const capital = battle.units.find((unit) => unit.id === capitalId);
  const fighter = battle.units.find((unit) => unit.id === fighterId);
  for (const unit of battle.units) {
    if (unit.id !== destroyerId && unit.side === 'player') {
      unit.x = -4000;
      unit.y = -4000;
    }
  }
  destroyer.x = 1600;
  destroyer.y = 1600;
  destroyer.vx = 0;
  destroyer.vy = 0;
  destroyer.heading = 0;
  destroyer.cooldownMs = 0;
  capital.x = 1810;
  capital.y = 1600;
  capital.vx = 0;
  capital.vy = 0;
  fighter.x = 1695;
  fighter.y = 1608;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.escaped = false;
  fighter.returning = false;
  fighter.orphaned = false;
  fighter.ammo = 8;
  fighter.fuel = 100;
  const vitality = (unit) => unit.hp + Object.values(unit.shieldFacings ?? {})
    .reduce((total, facing) => total + (facing?.value ?? 0), 0);
  const before = {
    capitalHp: capital.hp,
    capitalVitality: vitality(capital),
    fighterHp: fighter.hp,
    fighterVitality: vitality(fighter),
  };
  window.__selectCombatUnits([destroyerId]);
  const canvas = document.getElementById('game-canvas');
  canvas.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    clientX: (capital.x - 1850) * 0.75 + canvas.width / 2,
    clientY: (capital.y - 1600) * 0.75 + canvas.height / 2,
  }));
  const applied = Object.values(battle.tacticalOrders ?? {})
    .sort((a, b) => a.sequence - b.sequence).at(-1);
  const order = { ok: applied?.type === 'focus_fire' && applied?.targetId === capitalId, order: applied };
  window.advanceTime(1050);
  const snap = JSON.parse(window.render_game_to_text()).combatUi;
  return {
    order,
    before,
    after: {
      capitalHp: capital.hp,
      capitalVitality: vitality(capital),
      fighterHp: fighter.hp,
      fighterVitality: vitality(fighter),
    },
    destroyer: {
      weaponProfile: destroyer.weaponProfile,
      weaponTargetId: destroyer.weaponTargetId,
      cooldownMs: destroyer.cooldownMs,
      heading: destroyer.heading,
      position: { x: destroyer.x, y: destroyer.y },
      aaBattery: destroyer.aaBattery,
    },
    snap,
  };
}, {
  destroyerId: setup.destroyerIds[0],
  capitalId: setup.capitalId,
  fighterId: setup.fighterId,
});

check('Point Defense Grid unlocks 30% destroyer AA battery',
  aa.destroyer.aaBattery?.damageShare === 0.3 && aa.snap.destroyerAaUnlocked === true,
  JSON.stringify(aa.destroyer.aaBattery));
check('destroyer retains torpedo primary while AA is installed',
  aa.destroyer.weaponProfile === 'torpedo', aa.destroyer.weaponProfile);
check('direct target remains primary while AA independently targets fighter',
  aa.order.ok && aa.destroyer.weaponTargetId === setup.capitalId
    && aa.destroyer.aaBattery?.targetId === setup.fighterId,
  JSON.stringify(aa.destroyer));
check('right-click enemy creates direct focus-fire order',
  aa.order.ok && aa.order.order?.type === 'focus_fire');
check('destroyer damages capital and fighter shields or hull concurrently',
  aa.after.capitalVitality < aa.before.capitalVitality
    && aa.after.fighterVitality < aa.before.fighterVitality,
  JSON.stringify({ before: aa.before, after: aa.after }));
check('destroyer AA actually fired', aa.destroyer.aaBattery?.lastFiredAt != null);

await page.screenshot({ path: path.join(outDir, 'directed-combat-aa.png'), fullPage: true });

const fallback = await page.evaluate(({ destroyerId, capitalId, fighterId }) => {
  const battle = window.__getBattleState();
  const destroyer = battle.units.find((unit) => unit.id === destroyerId);
  const capital = battle.units.find((unit) => unit.id === capitalId);
  capital.hp = 0;
  window.advanceTime(100);
  return {
    targetId: destroyer.weaponTargetId,
    focusTargetId: destroyer.focusTargetId,
    fighterAlive: battle.units.some((unit) => unit.id === fighterId && unit.hp > 0),
  };
}, {
  destroyerId: setup.destroyerIds[0],
  capitalId: setup.capitalId,
  fighterId: setup.fighterId,
});
check('destroyed direct target falls back to automatic threat targeting',
  fallback.fighterAlive && fallback.targetId === setup.fighterId,
  JSON.stringify(fallback));

check('zero browser console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const failed = results.filter((result) => !result.pass);
console.log(`\nDirected combat: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
