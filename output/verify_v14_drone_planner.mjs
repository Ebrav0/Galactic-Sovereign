import playwright from '/Users/emmanuelbravo/.codex/skills/develop-web-game/node_modules/playwright/index.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';

const { chromium } = playwright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (error) => errors.push(error.message));

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, condition: !!condition, detail });
  console.log(`${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sampleFrames = () => page.evaluate(async () => {
  const start = performance.now();
  let last = start;
  let frames = 0;
  let worstGapMs = 0;
  await new Promise((resolve) => {
    function step(now) {
      frames += 1;
      worstGapMs = Math.max(worstGapMs, now - last);
      last = now;
      if (now - start >= 800) resolve();
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  return { frames, worstGapMs };
});

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__forceResearch === 'function');

const fixture = await page.evaluate(() => {
  window.__newGame(779);
  window.__setBootPhase('playing');
  const state = window.getGameState();
  window.__hydrateGalaxy(state.activeGalaxyId);
  state.paused = false;
  state.credits = 10000;
  window.__forceResearch('eco_surveyor');
  window.__forceResearch('eco_construction_drones');
  const galaxy = state.galaxies[state.activeGalaxyId];
  const home = state.stronghold;
  const neighbours = galaxy.graph.lanes
    .map(([a, b]) => a === home ? b : b === home ? a : null)
    .filter(Boolean);
  const targetId = neighbours.find((id) => galaxy.systems[id]?.bodies.some((body) => body.type === 'habitable'))
    ?? neighbours[0];
  const target = galaxy.systems[targetId];
  if (!target.bodies.some((body) => body.type === 'habitable')) {
    const template = galaxy.systems[home].bodies.find((body) => body.type === 'habitable');
    target.bodies = [{ ...structuredClone(template), id: 'planner-world', name: 'Planner World' }];
  }
  target.owner = 'player';
  target.star.kind = 'yellow';
  target.dyson.disabled = false;
  const unclaimedId = Object.keys(galaxy.systems).find((id) => id !== home && id !== targetId && galaxy.systems[id].owner === 'neutral');
  const star = galaxy.graph.stars.find((entry) => entry.id === targetId);
  const targetPlanet = target.bodies.find((body) => body.type === 'habitable');
  return {
    targetId,
    targetName: target.name,
    targetPlanetId: targetPlanet.id,
    targetPlanetName: targetPlanet.name,
    unclaimedId,
    star,
    flagship: structuredClone(state.flagship),
  };
});

const rejected = await page.evaluate((systemId) => window.__canDeployBuilderDrone(systemId), fixture.unclaimedId);
check('unclaimed system rejects construction drones', !rejected.ok, rejected.reason);

await page.evaluate(({ star }) => {
  window.__setView('galaxy');
  window.__snapGalaxyCamera(star.x, star.y, 1);
}, fixture);
const canvas = page.locator('#game-canvas');
const box = await canvas.boundingBox();
const baselineFrames = await sampleFrames();
await page.keyboard.down('Control');
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.up('Control');
await page.waitForFunction(() => window.__listBuilderDrones().drones.some((drone) => drone.status === 'outbound'));

const afterDispatch = await page.evaluate(() => ({
  drones: window.__listBuilderDrones(),
  flagship: structuredClone(window.getGameState().flagship),
}));
check('Ctrl-click dispatches exactly one drone', afterDispatch.drones.drones.filter((drone) => drone.status === 'outbound').length === 1);
check('Ctrl-click does not move the flagship', afterDispatch.flagship.systemId === fixture.flagship.systemId
  && !afterDispatch.flagship.transit && !afterDispatch.flagship.wormholeTransit);

await page.evaluate(() => {
  window.getGameState().time += 120000;
  window.advanceTime(250);
});
await page.waitForSelector('#drone-planner:not(.hidden)');
check('arrival pauses simulation', await page.evaluate(() => window.getGameState().paused === true));
check('arrival opens correct planner', (await page.locator('#drone-planner-title').textContent()).includes(fixture.targetName));
const plannerFrames = await sampleFrames();
check('open planner preserves baseline-relative frame cadence', plannerFrames.frames >= Math.max(2, baselineFrames.frames - 1)
  && plannerFrames.worstGapMs <= Math.max(180, baselineFrames.worstGapMs * 1.5),
`${baselineFrames.frames}/${baselineFrames.worstGapMs.toFixed(1)}ms → ${plannerFrames.frames}/${plannerFrames.worstGapMs.toFixed(1)}ms`);

const targetCard = page.locator('.drone-planner__target').filter({ hasText: fixture.targetPlanetName }).first();
const fallbackCard = page.locator('.drone-planner__target').filter({ has: page.getByRole('button', { name: /Outpost/ }) }).first();
const planetCard = await targetCard.count() ? targetCard : fallbackCard;
const outpostButton = planetCard.getByRole('button', { name: /Outpost/ }).first();
check('unlocked Outpost is offered', await outpostButton.isEnabled());
await outpostButton.click();
const shipyardButton = planetCard.getByRole('button', { name: /Shipyard/ }).first();
check('projected Outpost enables dependent Shipyard', await shipyardButton.isEnabled());
await shipyardButton.click();
await page.screenshot({ path: 'output/web-game/v14-drone-planner.png', fullPage: true });

const creditsBeforeConfirm = await page.evaluate(() => window.getGameState().credits);
await page.locator('#drone-planner-confirm').evaluate((button) => button.click());
await page.waitForTimeout(150);
const confirmed = await page.evaluate(() => ({
  paused: window.getGameState().paused,
  credits: window.getGameState().credits,
  orders: structuredClone(window.getGameState().builderConstructionOrders),
  modalHidden: document.getElementById('drone-planner').classList.contains('hidden'),
}));
check('confirmation reserves both job costs', confirmed.credits === creditsBeforeConfirm - 700, `${creditsBeforeConfirm}→${confirmed.credits}`);
check('dependent jobs persist in order', confirmed.orders.length === 2 && confirmed.orders[1].dependsOnOrderIds.includes(confirmed.orders[0].id));
check('closing planner restores simulation', confirmed.paused === false);
check('confirmation closes planner', confirmed.modalHidden);

await page.evaluate(() => {
  window.getGameState().time += 60000;
  window.advanceTime(250);
  window.getGameState().time += 60000;
  window.advanceTime(250);
});
const completed = await page.evaluate(({ targetId }) => {
  const state = window.getGameState();
  const system = state.galaxies[state.activeGalaxyId].systems[targetId];
  return {
    types: system.structures.map((structure) => structure.type),
    statuses: state.builderConstructionOrders.map((order) => order.status),
  };
}, fixture);
check('drone completes projected Outpost then Shipyard', completed.types.includes('outpost') && completed.types.includes('shipyard'));
check('confirmed construction orders complete', completed.statuses.every((status) => status === 'complete'));

const parallel = await page.evaluate(() => {
  window.__newGame(779);
  window.__setBootPhase('playing');
  const state = window.getGameState();
  state.credits = 5000;
  window.__forceResearch('eco_surveyor');
  window.__forceResearch('eco_construction_drones');
  window.__listBuilderDrones();
  const systemId = state.stronghold;
  const system = state.galaxies[state.activeGalaxyId].systems[systemId];
  system.structures = [];
  const worlds = system.bodies.filter((body) => body.type === 'habitable').slice(0, 3);
  for (const drone of state.builderDrones) {
    drone.status = 'idle';
    drone.systemId = systemId;
    drone.originSystemId = systemId;
    drone.awaitingOrders = false;
  }
  const draft = worlds.map((world, index) => ({
    clientId: `parallel-${index}`,
    bodyId: world.id,
    structureType: 'outpost',
  }));
  const result = window.__confirmBuilderConstructionPlan(systemId, draft);
  const queued = state.builderConstructionOrders.find((order) => order.status === 'queued');
  const beforeCancel = state.credits;
  const cancelled = window.__cancelBuilderConstructionOrder(queued.id);
  return {
    result,
    active: state.builderConstructionOrders.filter((order) => order.status === 'active').map((order) => order.assignedDroneId),
    queuedStatus: queued.status,
    cancelled,
    beforeCancel,
    afterCancel: state.credits,
  };
});
check('two stationed drones start independent worlds in parallel', parallel.result.ok
  && parallel.active.length === 2 && new Set(parallel.active).size === 2);
check('extra worlds remain in an unlimited pending queue', parallel.result.orders.length === 3 && parallel.queuedStatus === 'cancelled');
check('pending order cancellation refunds its full cost', parallel.cancelled.ok
  && parallel.afterCancel === parallel.beforeCancel + parallel.cancelled.refunded);

const ownershipLoss = await page.evaluate(() => {
  const state = window.getGameState();
  const creditsBefore = state.credits;
  state.galaxies[state.activeGalaxyId].systems[state.stronghold].owner = 'neutral';
  window.advanceTime(50);
  return {
    creditsBefore,
    creditsAfter: state.credits,
    activeStatuses: state.builderConstructionOrders
      .filter((order) => order.assignedDroneId)
      .map((order) => order.status),
  };
});
check('ownership loss aborts active jobs without refund', ownershipLoss.activeStatuses.every((status) => status === 'failed')
  && ownershipLoss.creditsAfter === ownershipLoss.creditsBefore);

const pendingSaveState = await page.evaluate(() => {
  const state = structuredClone(window.getGameState());
  state.galaxies[state.activeGalaxyId].systems[state.stronghold].owner = 'player';
  if (state.builderDrones[0]) state.builderDrones[0].awaitingOrders = true;
  return state;
});
const pendingReload = deserialize(serialize(pendingSaveState));
check('pending arrival planner survives save and reload', pendingReload.ok
  && pendingReload.state.builderDrones.some((drone) => drone.awaitingOrders));

const currentState = await page.evaluate(() => structuredClone(window.getGameState()));
currentState.manualTradeRoutes = [{ id: 'legacy-route', fromSystemId: currentState.stronghold, toSystemId: fixture.targetId }];
delete currentState.builderConstructionOrders;
const legacyJson = JSON.stringify(currentState);
const migrated = deserialize(JSON.stringify({
  saveVersion: 13,
  checksum: crc32(legacyJson),
  savedAt: Date.now(),
  state: currentState,
}));
check('v13 save migrates to v14 planner state', migrated.ok && Array.isArray(migrated.state.builderConstructionOrders));
check('v14 migration removes manual trade routes', migrated.ok && !Object.hasOwn(migrated.state, 'manualTradeRoutes'));
check('manual trade route UI and hooks are removed', await page.evaluate(() => (
  !document.getElementById('trade-routes-panel')
  && typeof window.__addTradeRoute === 'undefined'
  && typeof window.__clearTradeRoutes === 'undefined'
)));
check('no browser console errors', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((result) => !result.condition);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
