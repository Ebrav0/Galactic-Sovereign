// Browser integration verifier for Trade Nexus logistics, command combat, Sol
// confirmation, command UI, and responsive screenshots.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');
const outputDir = path.join(root, 'output', 'visuals', 'unified-overhaul');
fs.mkdirSync(outputDir, { recursive: true });

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(0x5601));

let snapshot = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
check('new campaign uses save v12', snapshot.saveVersion === 12, `version=${snapshot.saveVersion}`);
check('new galaxy contains exactly four Trade Nexuses', snapshot.logistics.nexuses.length === 4,
  `count=${snapshot.logistics.nexuses.length}`);
check('Trade Nexuses expose planets and disable Dyson projects', await page.evaluate(() => {
  const state = window.getGameState();
  return window.__listTradeNexuses().every((nexus) => {
    const system = state.galaxies[nexus.galaxyId].systems[nexus.systemId];
    return system?.bodies?.length >= 2 && system?.dyson?.disabled === true
      && system?.structures?.some((structure) => structure.type === 'trade_nexus');
  });
}));

await page.evaluate(() => {
  const state = window.getGameState();
  window.__viewSystem(state.stronghold);
  window.__snapCamera(state.flagship.x, state.flagship.y, 3.6);
});
await page.screenshot({ path: path.join(outputDir, 'flagship-closeup.png') });
await page.evaluate(() => {
  const state = window.getGameState();
  state.flagship.wormholeTransit = {
    fromWh: `wh-${state.activeGalaxyId}`,
    toWh: 'wh-gal-1',
    startTime: state.time - 50000,
    durationMs: 100000,
  };
  window.__viewSystem('core');
  window.__snapCamera(0, 0, 0.62);
});
await page.screenshot({ path: path.join(outputDir, 'wormhole-event.png') });
await page.evaluate(() => {
  const state = window.getGameState();
  state.flagship.wormholeTransit = null;
  window.__viewSystem(state.stronghold);
  window.__snapCamera(0, 0, 0.48);
});

const logisticsResult = await page.evaluate(() => {
  const state = window.getGameState();
  const nexus = window.__listTradeNexuses().find((entry) => entry.available);
  const depot = window.__registerExportDepot(state.stronghold, {
    inventory: { rawMaterials: 30, fuel: 20, manufacturedGoods: 18 },
  }).depot;
  window.__setDepotDestination(depot.id, nexus.systemId);
  const creditsBefore = state.credits;
  const dispatch = window.__dispatchDepot(depot.id);
  const creditsAtDispatch = state.credits;
  window.advanceTime(500);
  const creditsDuringJump = state.credits;
  const status = window.__getLogistics().convoys.find((convoy) => convoy.id === dispatch.convoy.id);
  const projection = JSON.parse(window.render_game_to_text()).logistics.convoys
    .find((convoy) => convoy.id === dispatch.convoy.id)?.projection;
  window.advanceTime((projection?.etaMs ?? 180000) + 2500);
  const delivered = window.__getLogistics().convoys.find((convoy) => convoy.id === dispatch.convoy.id);
  return {
    dispatchOk: dispatch.ok,
    path: dispatch.convoy.path,
    jumping: status?.status === 'jumping',
    creditsBefore,
    creditsAtDispatch,
    creditsDuringJump,
    creditsAfter: state.credits,
    deliveredStatus: delivered?.status,
    destination: nexus.systemId,
    depotId: depot.id,
  };
});
check('depot dispatch starts visible jump on a lane path',
  logisticsResult.dispatchOk && logisticsResult.jumping && logisticsResult.path.length >= 2);
check('credits are paid only after Nexus delivery',
  logisticsResult.creditsBefore === logisticsResult.creditsAtDispatch
    && logisticsResult.creditsAtDispatch === logisticsResult.creditsDuringJump
    && logisticsResult.creditsAfter > logisticsResult.creditsDuringJump
    && logisticsResult.deliveredStatus === 'delivered');

const solResult = await page.evaluate(({ destination }) => {
  const state = window.getGameState();
  const recommendation = {
    id: 'route_1',
    tool: 'propose_route',
    title: 'Use the nearest market',
    rationale: 'This is the shortest currently valid delivery route.',
    confidence: 0.91,
    arguments: {
      fromSystemId: state.stronghold,
      toSystemId: destination,
      cargoClass: 'manufacturedGoods',
    },
  };
  const display = window.__validateSolRecommendation(recommendation, { stage: 'display' });
  const declined = window.__executeSolRecommendation(recommendation, false);
  const confirmed = window.__executeSolRecommendation(recommendation, true);
  const offlineA = JSON.stringify(window.__offlineSolAdvice());
  const offlineB = JSON.stringify(window.__offlineSolAdvice());
  const redacted = JSON.stringify(window.__redactedSolSnapshot());
  return { display, declined, confirmed, deterministic: offlineA === offlineB, redacted };
}, { destination: logisticsResult.destination });
check('Sol recommendation validates before display', solResult.display.ok);
check('state-changing Sol order is rejected without confirmation',
  !solResult.declined.ok && solResult.declined.code === 'confirmation_required');
check('same validated Sol route executes after confirmation', solResult.confirmed.ok);
check('offline advisor is deterministic', solResult.deterministic);
check('redacted Sol snapshot excludes settings and conversations',
  !solResult.redacted.includes('history') && !solResult.redacted.includes('spendingCapUsd'));

const combat = await page.evaluate(() => {
  const state = window.getGameState();
  const systemId = state.stronghold;
  state.flagship.systemId = systemId;
  state.flagship.transit = null;
  if (!state.research.unlocked.includes('mil_carrier_launch_doctrine')) {
    state.research.unlocked.push('mil_carrier_launch_doctrine');
  }
  const system = state.galaxies[state.activeGalaxyId].systems[systemId];
  if (!system.structures.some((structure) => structure.type === 'export_depot')) {
    system.structures.push({ id: 'objective-depot', type: 'export_depot', hp: 520, maxHp: 520, operational: true });
  }
  for (let i = 0; i < 8; i++) {
    state.playerShips.push({
      id: `order-corvette-${i}`, hull: i === 0 ? 'fleet_carrier' : 'corvette',
      galaxyId: state.activeGalaxyId, systemId, hp: i === 0 ? 900 : 120,
      maxHp: i === 0 ? 900 : 120, transit: null,
    });
  }
  state.pirates.fleets.push({
    id: 'order-test-pirates', galaxyId: state.activeGalaxyId, systemId,
    transit: null, wanderCooldownMs: 999999,
    ships: Array.from({ length: 12 }, (_, i) => ({
      id: `order-pirate-${i}`, hull: i % 4 === 0 ? 'frigate' : 'corvette',
      hp: i % 4 === 0 ? 200 : 120, maxHp: i % 4 === 0 ? 200 : 120,
    })),
  });
  window.__viewSystem(systemId);
  window.advanceTime(50);
  const formation = window.__issueTacticalOrder({ type: 'formation', formation: 'wedge' });
  const attack = window.__issueTacticalOrder({ type: 'attack_class', targetClass: 'fighter' });
  const battle = window.__getBattleState(systemId);
  return {
    active: battle?.active,
    mode: battle?.mode,
    formation: formation.ok,
    attack: attack.ok,
    playerOrders: Object.values(battle?.tacticalOrders ?? {}).filter((order) => order.side === 'player').length,
    enemyOrders: Object.values(battle?.tacticalOrders ?? {}).filter((order) => order.side === 'enemy').length,
    depotObjective: battle?.objectives?.some((objective) => objective.type === 'export_depot'),
    wingCount: battle?.units?.filter((unit) => unit.isWing).length ?? 0,
  };
});
check('ship-to-ship battle accepts formation and target-class orders',
  combat.active && combat.mode === 'tactical' && combat.formation && combat.attack && combat.playerOrders === 2);
check('AI uses the same tactical-order contract', combat.enemyOrders >= 1);
check('carrier launches persistent fighter units', combat.wingCount > 0, `wings=${combat.wingCount}`);
check('export depot is a tactical objective', combat.depotObjective);

await page.screenshot({ path: path.join(outputDir, 'tactical-command.png') });
await page.evaluate(() => {
  const state = window.getGameState();
  const nexuses = window.__listTradeNexuses();
  for (const nexus of nexuses) window.__gatherIntel(nexus.systemId);
  window.__setView('galaxy');
  const target = state.galaxies[state.activeGalaxyId].graph.stars.find((star) => star.id === nexuses[0].systemId);
  window.__snapGalaxyCamera(target.x, target.y, 0.42);
});
await page.screenshot({ path: path.join(outputDir, 'galaxy-trade-nexuses.png') });
await page.evaluate(() => {
  const nexus = window.__listTradeNexuses()[0];
  window.__viewSystem(nexus.systemId);
  window.__setView('system');
  window.__snapCamera(0, 0, 0.48);
});
await page.screenshot({ path: path.join(outputDir, 'trade-nexus-system.png') });
await page.evaluate(() => window.__setView('galaxy'));
await page.click('#tab-logistics', { noWaitAfter: true });
await page.screenshot({ path: path.join(outputDir, 'logistics-command.png') });
await page.evaluate(() => { window.getGameState().paused = true; });
await page.waitForTimeout(100);
check('paused order screen remains readable and interactive', await page.evaluate(() => {
  const overlay = document.getElementById('pause-overlay');
  const logistics = document.getElementById('logistics-panel');
  return !overlay.classList.contains('hidden') && !logistics.classList.contains('hidden')
    && !!logistics.querySelector('button');
}));

await page.setViewportSize({ width: 1024, height: 640 });
await page.screenshot({ path: path.join(outputDir, 'minimum-resolution.png') });
await page.keyboard.press('Tab');
check('keyboard navigation reaches native controls', await page.evaluate(() =>
  ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)));
check('responsive screenshot suite created', [
  'flagship-closeup.png', 'wormhole-event.png', 'tactical-command.png',
  'galaxy-trade-nexuses.png', 'trade-nexus-system.png',
  'logistics-command.png', 'minimum-resolution.png',
]
  .every((file) => fs.statSync(path.join(outputDir, file)).size > 1000));
check('no browser console errors', errors.length === 0, errors.join(' | '));

await browser.close();
const passed = results.filter((result) => result.pass).length;
console.log(`\nUnified overhaul: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
