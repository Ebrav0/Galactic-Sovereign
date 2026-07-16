import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { cooldownNormalizedVolleyDamage } from '../src/js/combat-orders.js';
import {
  autonomousTargetClass,
  doctrinePolicy,
  retreatThresholdForUnit,
} from '../src/js/combat-autonomy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');
const outDir = path.join(here, 'visuals');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

check('cooldown-normalized volley preserves displayed DPS',
  Math.abs(cooldownNormalizedVolleyDamage(10, 800) - 8) < 1e-9);
const interceptor = { id: 'i', hull: 'interceptor', isWing: true, side: 'player' };
const capitalOnly = [{ id: 'c', hull: 'battleship', hp: 750, side: 'enemy' }];
check('interceptor joins the main strike when no hostile wings exist',
  autonomousTargetClass({ combatSettings: { fleetPriority: 'auto' }, combatDoctrine: 'assault' },
    { doctrine: 'assault' }, interceptor, capitalOnly) === 'capital');
check('carrier strike doctrine prioritizes carriers',
  doctrinePolicy('carrier_strike').defaultTargetClass === 'carrier');
check('withdrawal thresholds progressively protect high-value hulls',
  retreatThresholdForUnit({ hull: 'interceptor', isWing: true }, 'screen')
    < retreatThresholdForUnit({ hull: 'frigate' }, 'screen')
    && retreatThresholdForUnit({ hull: 'frigate' }, 'screen')
      < retreatThresholdForUnit({ hull: 'battleship' }, 'screen')
    && retreatThresholdForUnit({ hull: 'battleship' }, 'screen')
      < retreatThresholdForUnit({ hull: 'fleet_carrier' }, 'screen'));

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

const setup = await page.evaluate(() => {
  window.__newGame(171717);
  const state = window.getGameState();
  const systemId = state.stronghold;
  window.__viewSystem(systemId);
  window.__forceResearch('mil_carrier_launch_doctrine');
  window.__spawnFriendlyShip('light_carrier', 2);
  state.pirates.fleets = [{
    id: 'command-first-pirates',
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: Array.from({ length: 4 }, (_, index) => ({
      id: `command-first-capital-${index}`,
      hull: 'battleship',
      hp: 50000,
      maxHp: 50000,
    })),
  }];
  state.paused = false;
  window.__forcePirateIntoSystem(systemId);
  window.advanceTime(50);
  state.paused = true;
  const battle = window.__getBattleState(systemId);
  return {
    systemId,
    active: battle?.active,
    wings: battle?.units.filter((unit) => unit.side === 'player' && unit.isWing).length ?? 0,
    hostileWings: battle?.units.filter((unit) => unit.side !== 'player' && unit.isWing).length ?? 0,
  };
});
check('carrier-versus-pirate fixture launches wings', setup.active && setup.wings > 0 && setup.hostileWings === 0,
  JSON.stringify(setup));

const contact = await page.evaluate(() => {
  const state = window.getGameState();
  const battle = window.__getBattleState();
  const target = battle.units.find((unit) => unit.side !== 'player' && unit.hp > 0);
  const shieldTotal = (unit) => Object.values(unit.shieldFacings ?? unit.shields ?? {})
    .reduce((total, facing) => total + Math.max(0, facing?.value ?? 0), 0);
  const initialHp = target.hp;
  const initialDurability = target.hp + shieldTotal(target);
  const wings = battle.units.filter((unit) => unit.side === 'player' && unit.isWing);
  const initialAmmo = new Map(wings.map((wing) => [wing.id, wing.ammo]));
  let firstDamageAt = null;
  let firstWingShot = null;
  let firstEnemyShotAt = null;
  let firstEnemyShot = null;
  for (let elapsed = 50; elapsed <= 8000; elapsed += 50) {
    state.paused = false;
    window.advanceTime(50);
    state.paused = true;
    firstWingShot = battle.fxEvents.find((event) => event.kind === 'shot'
      && initialAmmo.has(event.attackerId)
      && ((event.shieldAbsorbed ?? 0) > 0 || (event.hullDamage ?? 0) > 0));
    if (firstWingShot && firstDamageAt == null) firstDamageAt = elapsed;
    firstEnemyShot = battle.fxEvents.find((event) => event.kind === 'shot'
      && event.side === 'enemy'
      && ((event.shieldAbsorbed ?? 0) > 0 || (event.hullDamage ?? 0) > 0));
    if (firstEnemyShot && firstEnemyShotAt == null) firstEnemyShotAt = elapsed;
    if (firstWingShot && firstEnemyShot) break;
  }
  const shooter = firstWingShot ? wings.find((wing) => wing.id === firstWingShot.attackerId) : null;
  return {
    firstDamageAt,
    targetHp: target.hp,
    initialHp,
    initialDurability,
    durabilityAfter: target.hp + shieldTotal(target),
    firstWingShot,
    firstEnemyShotAt,
    firstEnemyShot,
    shooterAmmoBefore: shooter ? initialAmmo.get(shooter.id) : null,
    shooterAmmoAfter: shooter?.ammo ?? null,
    interceptorTarget: wings.find((wing) => wing.hull === 'interceptor')?.weaponTargetId ?? null,
    targetId: target.id,
  };
});
check('fighter contact and visible damage occur within eight seconds',
  contact.firstDamageAt != null && contact.firstDamageAt <= 8000
    && contact.firstWingShot
    && ((contact.firstWingShot.shieldAbsorbed ?? 0) > 0 || (contact.firstWingShot.hullDamage ?? 0) > 0),
  JSON.stringify(contact));
check('interceptor attacks the main target without hostile fighters',
  contact.interceptorTarget != null, contact.interceptorTarget ?? 'no target');
check('fighter ammunition is consumed by an emitted shot',
  contact.firstWingShot && contact.shooterAmmoAfter < contact.shooterAmmoBefore,
  `${contact.shooterAmmoBefore} -> ${contact.shooterAmmoAfter}`);
check('pirate capital ships acquire targets and fire back within eight seconds',
  contact.firstEnemyShotAt != null && contact.firstEnemyShotAt <= 8000 && contact.firstEnemyShot,
  JSON.stringify({ firstEnemyShotAt: contact.firstEnemyShotAt, firstEnemyShot: contact.firstEnemyShot }));

const sortie = await page.evaluate(() => {
  const state = window.getGameState();
  const battle = window.__getBattleState();
  const wing = battle.units.find((unit) => unit.side === 'player' && unit.isWing);
  const carrier = battle.units.find((unit) => unit.id === wing.parentCarrierId);
  wing.x = carrier.x + 8;
  wing.y = carrier.y;
  wing.vx = 0;
  wing.vy = 0;
  wing.ammo = 0;
  const sortieBefore = wing.sortieNumber;
  state.paused = false;
  window.advanceTime(100);
  const recovered = wing.recovered && wing.sortiePhase === 'rearm';
  const ammoWhileRearming = wing.ammo;
  const recoveryCue = battle.fxEvents.some((event) => event.kind === 'wing_recover' && event.attackerId === wing.id);
  window.advanceTime(4100);
  state.paused = true;
  return {
    recovered,
    ammoWhileRearming,
    relaunched: !wing.recovered && wing.sortieNumber === sortieBefore + 1,
    phase: wing.sortiePhase,
    ammo: wing.ammo,
    launchCue: battle.fxEvents.some((event) => event.kind === 'wing_launch' && event.targetId === wing.id),
    recoveryCue,
  };
});
check('wing returns, rearms for four seconds, and relaunches',
  sortie.recovered && sortie.ammoWhileRearming === 0 && sortie.relaunched,
  JSON.stringify(sortie));
check('carrier launch and recovery FX cues are emitted', sortie.launchCue && sortie.recoveryCue);

const carrierFallback = await page.evaluate(() => {
  const state = window.getGameState();
  const battle = window.__getBattleState();
  const carriers = battle.units.filter((unit) => unit.side === 'player' && unit.hull === 'light_carrier');
  const wing = battle.units.find((unit) => unit.isWing && unit.parentCarrierId === carriers[0]?.id);
  if (!wing || carriers.length < 2) return { ok: false };
  carriers[0].hp = 0;
  wing.returning = true;
  wing.ammo = 1;
  wing.fuel = 50;
  state.paused = false;
  window.advanceTime(50);
  state.paused = true;
  return { ok: true, recoveryCarrierId: wing.recoveryCarrierId, expected: carriers[1].id };
});
check('surviving craft rally to another allied carrier',
  carrierFallback.ok && carrierFallback.recoveryCarrierId === carrierFallback.expected,
  JSON.stringify(carrierFallback));

const orphan = await page.evaluate(() => {
  const state = window.getGameState();
  const battle = window.__getBattleState();
  const wing = battle.units.find((unit) => unit.side === 'player' && unit.isWing && unit.hp > 0);
  for (const unit of battle.units) {
    if (unit.side === 'player' && ['flagship', 'light_carrier', 'fleet_carrier', 'super_carrier'].includes(unit.hull)) {
      unit.hp = 0;
    }
  }
  wing.returning = true;
  wing.ammo = 2;
  wing.fuel = 20;
  state.paused = false;
  window.advanceTime(50);
  state.paused = true;
  const continued = wing.orphaned && !wing.escaped && !wing.returning;
  wing.ammo = 0;
  wing.returning = true;
  state.paused = false;
  window.advanceTime(50);
  state.paused = true;
  return { continued, escapedWhenDry: wing.escaped, hp: wing.hp };
});
check('orphaned craft continue until fuel or ammunition is exhausted',
  orphan.continued && orphan.escapedWhenDry && orphan.hp > 0, JSON.stringify(orphan));

const detachedFleet = await page.evaluate(() => {
  window.__newGame(171719);
  const state = window.getGameState();
  const systemId = state.stronghold;
  state.flagship.galaxyId = 'gal-1';
  state.flagship.x = 0;
  state.flagship.y = -500;
  window.__spawnFriendlyShip('destroyer', 3);
  state.pirates.fleets = [{
    id: 'detached-fleet-pirates',
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: Array.from({ length: 3 }, (_, index) => ({
      id: `detached-pirate-${index}`,
      hull: index === 0 ? 'battleship' : 'destroyer',
      hp: 8000,
      maxHp: 8000,
    })),
  }];
  window.__setView('galaxy');
  state.paused = false;
  window.__forcePirateIntoSystem(systemId);
  window.advanceTime(50);
  const beforeViewMode = window.__getBattleState(systemId)?.mode;
  window.__viewSystem(systemId);
  const battle = window.__getBattleState(systemId);
  const afterViewMode = battle?.mode;
  let playerShot = null;
  let enemyShot = null;
  let playerShotAt = null;
  let enemyShotAt = null;
  for (let elapsed = 50; elapsed <= 20000; elapsed += 50) {
    window.advanceTime(50);
    if (!playerShot) {
      playerShot = battle.fxEvents.find((event) => event.kind === 'shot' && event.side === 'player');
      if (playerShot) playerShotAt = elapsed;
    }
    if (!enemyShot) {
      enemyShot = battle.fxEvents.find((event) => event.kind === 'shot' && event.side === 'enemy');
      if (enemyShot) enemyShotAt = elapsed;
    }
    const multiMountShipFired = battle.units
      .filter((unit) => unit.side === 'player')
      .some((unit) => (unit.weaponMounts ?? []).filter((mount) => mount.lastFiredAt != null).length >= 2);
    if (playerShot && enemyShot && multiMountShipFired) break;
  }
  state.paused = true;
  return {
    beforeViewMode,
    afterViewMode,
    playerShot,
    enemyShot,
    playerShotAt,
    enemyShotAt,
    playerTargetIds: battle.units.filter((unit) => unit.side === 'player').map((unit) => unit.weaponTargetId).filter(Boolean),
    enemyTargetIds: battle.units.filter((unit) => unit.side === 'enemy').map((unit) => unit.weaponTargetId).filter(Boolean),
    units: battle.units.filter((unit) => !unit.isWing).map((unit) => ({
      id: unit.id,
      side: unit.side,
      hull: unit.hull,
      x: Math.round(unit.x),
      y: Math.round(unit.y),
      heading: Number((unit.heading ?? 0).toFixed(2)),
      speed: Math.round(Math.hypot(unit.vx ?? 0, unit.vy ?? 0)),
      targetId: unit.weaponTargetId ?? null,
      cooldownMs: unit.cooldownMs,
      mounts: (unit.weaponMounts ?? []).map((mount) => ({
        id: mount.id,
        profile: mount.profile,
        targetId: mount.targetId,
        fired: mount.lastFiredAt != null,
      })),
    })),
  };
});
check('viewing a detached-fleet battle promotes offscreen resolution to tactical combat',
  detachedFleet.beforeViewMode === 'auto' && detachedFleet.afterViewMode === 'tactical',
  JSON.stringify(detachedFleet));
check('detached player ships and pirates both acquire targets and fire',
  detachedFleet.playerShot && detachedFleet.enemyShot
    && detachedFleet.playerTargetIds.length > 0 && detachedFleet.enemyTargetIds.length > 0,
  JSON.stringify(detachedFleet));
check('ordinary line ships carry and fire multiple independent weapon mounts',
  detachedFleet.units.filter((unit) => unit.side === 'player')
    .every((unit) => unit.mounts.length >= 3)
    && detachedFleet.units.filter((unit) => unit.side === 'player')
      .some((unit) => unit.mounts.filter((mount) => mount.fired).length >= 2),
  JSON.stringify(detachedFleet.units.filter((unit) => unit.side === 'player')));
await page.evaluate(() => { window.getGameState().paused = false; });
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outDir, 'detached-fleet-return-fire.png'), fullPage: true });
await page.evaluate(() => { window.getGameState().paused = true; });

const returnFlight = await page.evaluate(() => {
  const state = window.getGameState();
  const battle = window.__getBattleState();
  const survivor = battle.units.find((unit) => unit.side === 'player' && !unit.isWing && unit.hp > 0);
  const finalCombatPose = { x: survivor.x, y: survivor.y, heading: survivor.heading };
  for (const unit of battle.units) if (unit.side === 'enemy') unit.hp = 0;
  state.paused = false;
  window.advanceTime(50);
  state.paused = true;
  const ship = state.playerShips.find((candidate) => candidate.id === survivor.id);
  const recovery = { ...ship.postBattleReturn };
  const startPose = window.__stationedShipPose(ship.id);
  const halfMs = Math.max(1, Math.floor((recovery.completeAt - state.time) / 2));
  state.paused = false;
  window.advanceTime(halfMs);
  state.paused = true;
  return {
    shipId: ship.id,
    finalCombatPose,
    startPose,
    midPose: window.__stationedShipPose(ship.id),
    recovery,
  };
});
check('survivors begin return flight at their final tactical position instead of snapping',
  returnFlight.recovery?.completeAt > returnFlight.recovery?.startedAt
    && Math.hypot(
      returnFlight.startPose.x - returnFlight.finalCombatPose.x,
      returnFlight.startPose.y - returnFlight.finalCombatPose.y,
    ) < 8
    && Math.hypot(
      returnFlight.midPose.x - returnFlight.startPose.x,
      returnFlight.midPose.y - returnFlight.startPose.y,
    ) > 10,
  JSON.stringify(returnFlight));
const returnPersistence = await page.evaluate(async (shipId) => {
  const beforeState = window.getGameState();
  const beforeShip = beforeState.playerShips.find((candidate) => candidate.id === shipId);
  const before = { ...beforeShip.postBattleReturn };
  const beforePose = window.__stationedShipPose(shipId);
  const save = await window.__saveSlot('slot-3');
  const load = await window.__loadSlot('slot-3');
  const afterState = window.getGameState();
  const afterShip = afterState.playerShips.find((candidate) => candidate.id === shipId);
  return {
    saveOk: save?.ok !== false,
    loadOk: load?.ok !== false,
    before,
    after: { ...afterShip?.postBattleReturn },
    beforePose,
    afterPose: window.__stationedShipPose(shipId),
  };
}, returnFlight.shipId);
check('save and load preserve an in-progress post-battle return trajectory',
  returnPersistence.saveOk && returnPersistence.loadOk
    && returnPersistence.after?.startedAt === returnPersistence.before?.startedAt
    && returnPersistence.after?.completeAt === returnPersistence.before?.completeAt
    && returnPersistence.after?.fromX === returnPersistence.before?.fromX
    && returnPersistence.after?.fromY === returnPersistence.before?.fromY
    && Math.hypot(
      returnPersistence.afterPose.x - returnPersistence.beforePose.x,
      returnPersistence.afterPose.y - returnPersistence.beforePose.y,
    ) < 1,
  JSON.stringify(returnPersistence));
await page.evaluate(() => { window.getGameState().paused = false; });
await page.waitForTimeout(100);
await page.screenshot({ path: path.join(outDir, 'post-battle-return-flight.png'), fullPage: true });
await page.evaluate(() => { window.getGameState().paused = true; });
const returnComplete = await page.evaluate((shipId) => {
  const state = window.getGameState();
  const ship = state.playerShips.find((candidate) => candidate.id === shipId);
  const remaining = Math.max(50, (ship.postBattleReturn?.completeAt ?? state.time) - state.time + 50);
  state.paused = false;
  window.advanceTime(remaining);
  state.paused = true;
  return {
    returning: !!ship.postBattleReturn,
    pose: window.__stationedShipPose(shipId),
  };
}, returnFlight.shipId);
check('return flight completes at the assigned orbit and clears recovery state',
  !returnComplete.returning
    && Math.hypot(
      returnComplete.pose.x - returnFlight.midPose.x,
      returnComplete.pose.y - returnFlight.midPose.y,
    ) > 10,
  JSON.stringify(returnComplete));

// Start a fresh engagement for HUD, alert, and flagship-control checks.
await page.evaluate(() => {
  window.__newGame(171718);
  const state = window.getGameState();
  const systemId = state.stronghold;
  window.__setView('galaxy');
  state.pirates.fleets = [{
    id: 'command-alert-pirates',
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: [{ id: 'alert-pirate', hull: 'battleship', hp: 20000, maxHp: 20000 }],
  }];
  state.paused = false;
  window.__forcePirateIntoSystem(systemId);
  window.advanceTime(100);
});
await page.waitForFunction(() => !document.getElementById('battle-alert')?.classList.contains('hidden'));
const alert = await page.evaluate(() => ({
  view: JSON.parse(window.render_game_to_text()).view,
  paused: window.getGameState().paused,
  visible: !document.getElementById('battle-alert').classList.contains('hidden'),
}));
check('battle-start alert is persistent without pausing or changing strategic view',
  alert.visible && alert.view === 'galaxy' && alert.paused === false, JSON.stringify(alert));
await page.screenshot({ path: path.join(outDir, 'command-first-battle-alert.png'), fullPage: true });
await page.evaluate(() => window.__viewSystem(window.getGameState().stronghold));

const hud = await page.evaluate(() => ({
  control: document.getElementById('combat-hud-control')?.textContent,
  priority: document.getElementById('combat-hud-priority')?.value,
  advanced: document.getElementById('combat-hud')?.classList.contains('combat-hud--advanced'),
  text: JSON.parse(window.render_game_to_text()).combatUi,
}));
check('command-first HUD defaults to AUTO, Auto priority, and Advanced Tactics off',
  hud.control === 'AUTO' && hud.priority === 'auto' && !hud.advanced
    && hud.text?.advancedTactics === false, JSON.stringify(hud));

const flagship = await page.evaluate(() => {
  const state = window.getGameState();
  const before = { x: state.flagship.x, y: state.flagship.y };
  window.__setFlagshipInput(1, 0);
  window.advanceTime(100);
  const manual = JSON.parse(window.render_game_to_text()).combatUi.flagshipControl;
  window.__setFlagshipInput(0, 0);
  window.advanceTime(1950);
  const stillManual = JSON.parse(window.render_game_to_text()).combatUi.flagshipControl;
  const beforeReturn = { x: state.flagship.x, y: state.flagship.y };
  window.advanceTime(100);
  const returning = JSON.parse(window.render_game_to_text()).combatUi.flagshipControl;
  const afterReturn = { x: state.flagship.x, y: state.flagship.y };
  window.advanceTime(550);
  const auto = JSON.parse(window.render_game_to_text()).combatUi.flagshipControl;
  return {
    before,
    manual: manual.mode,
    stillManual: stillManual.mode,
    returning: returning.mode,
    auto: auto.mode,
    transitionDistance: Math.hypot(afterReturn.x - beforeReturn.x, afterReturn.y - beforeReturn.y),
  };
});
check('manual flagship input overrides for two seconds then blends to autopilot',
  flagship.manual === 'manual' && flagship.stillManual === 'manual'
    && flagship.returning === 'returning_to_auto' && flagship.auto === 'auto',
  JSON.stringify(flagship));
check('flagship resumes autonomy without a position jump', flagship.transitionDistance < 30,
  `${flagship.transitionDistance.toFixed(2)} units`);

const advanced = await page.evaluate(() => {
  const state = window.getGameState();
  const battle = window.__getBattleState();
  const unit = battle.units.find((candidate) => candidate.side === 'player' && candidate.hp > 0);
  const rejected = window.__issueTacticalOrder({ type: 'hold', subjectIds: [unit.id] });
  window.__setAdvancedTactics(true);
  const accepted = window.__issueTacticalOrder({ type: 'hold', subjectIds: [unit.id] });
  window.__setAdvancedTactics(false);
  window.advanceTime(50);
  return {
    rejected: rejected.ok,
    accepted: accepted.ok,
    advanced: battle.advancedTactics,
    intent: unit.intent,
  };
});
check('Advanced Tactics gates explicit orders and returns units to doctrine control',
  !advanced.rejected && advanced.accepted && !advanced.advanced && advanced.intent !== 'explicit_order',
  JSON.stringify(advanced));

check('render_game_to_text exposes command-first autonomy state',
  hud.text?.fleetPriority === 'auto' && hud.text?.flagshipControl?.mode
    && hud.text?.autonomy?.intentCounts != null);
check('no new console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const passed = results.filter((result) => result.pass).length;
console.log(`\nCommand-first combat: ${passed}/${results.length} checks passed`);
await browser.close();
if (passed !== results.length) process.exit(1);
