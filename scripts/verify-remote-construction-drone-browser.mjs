import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outputDir = 'output/web-game/remote-construction-drone';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(`${message.text()} @ ${message.location().url || 'unknown'}`);
  }
});
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__forceResearch === 'function');

const fixture = await page.evaluate(() => {
  window.__newGame(779);
  window.__setBootPhase('playing');
  document.getElementById('title-screen')?.classList.add('hidden');
  const accountGate = document.getElementById('account-gate');
  if (accountGate) accountGate.style.display = 'none';
  const state = window.getGameState();
  state.paused = false;
  state.credits = 10_000;
  window.__forceResearch('eco_construction_drones');
  const galaxy = state.galaxies[state.activeGalaxyId];
  const neighbours = galaxy.graph.lanes
    .map(([from, to]) => from === state.stronghold ? to : to === state.stronghold ? from : null)
    .filter((systemId) => systemId && galaxy.systems[systemId]);
  const targetId = neighbours.find(
    (systemId) => galaxy.systems[systemId].bodies.some((body) => body.type === 'habitable'),
  ) ?? neighbours[0];
  const target = galaxy.systems[targetId];
  if (!target.bodies.some((body) => body.type === 'habitable')) {
    const template = galaxy.systems[state.stronghold].bodies.find((body) => body.type === 'habitable');
    target.bodies = [{
      ...structuredClone(template),
      id: 'remote-browser-world',
      name: 'Remote Browser World',
    }];
  }
  target.owner = 'player';
  const body = target.bodies.find((entry) => entry.type === 'habitable');
  window.__setView('system');
  window.__viewSystem(targetId);
  window.__selectPlanet(body.id);
  return { targetId, targetName: target.name, bodyId: body.id, bodyName: body.name };
});

const remoteButton = page.locator('[data-remote-construction-planner]');
await remoteButton.waitFor({ state: 'visible' });
assert.equal(await remoteButton.isEnabled(), true);
assert.match(await remoteButton.textContent(), /Queue & Dispatch Construction Drone/);
await remoteButton.click();

await page.locator('#drone-planner:not(.hidden)').waitFor({ state: 'visible' });
assert.match(await page.locator('#drone-planner-title').textContent(), new RegExp(fixture.targetName));
assert.match(await page.locator('#drone-planner-summary').textContent(), /dispatch automatically/i);

const targetCard = page.locator('.drone-planner__target')
  .filter({ hasText: fixture.bodyName })
  .first();
const outpostButton = targetCard.getByRole('button', { name: /Outpost/ }).first();
await outpostButton.waitFor({ state: 'visible' });
assert.equal(await outpostButton.isEnabled(), true);
await outpostButton.click();
assert.match(await page.locator('#drone-planner-total').textContent(), /construction \+ .* dispatch/);
await page.screenshot({
  path: `${outputDir}/planner-auto-dispatch.png`,
  fullPage: true,
});

const creditsBefore = await page.evaluate(() => window.getGameState().credits);
await page.locator('#drone-planner-confirm').click();
await page.locator('#drone-planner').waitFor({ state: 'hidden' });
const result = await page.evaluate(({ targetId }) => {
  const state = window.getGameState();
  return {
    credits: state.credits,
    paused: state.paused,
    orders: structuredClone(state.builderConstructionOrders),
    drones: structuredClone(state.builderDrones),
    targetId,
  };
}, fixture);
assert.equal(result.orders.length, 1);
assert.equal(result.paused, false);
assert.equal(result.orders[0].systemId, fixture.targetId);
assert.equal(result.orders[0].status, 'queued');
assert.ok(result.drones.some(
  (drone) => drone.status === 'outbound' && drone.targetSystemId === fixture.targetId,
));
assert.ok(result.credits < creditsBefore);
assert.deepEqual(
  errors.filter((message) => (
    !message.includes('/api/v1/session')
    && !message.includes('static.cloudflareinsights.com/beacon.min.js')
  )),
  [],
);

await page.screenshot({
  path: `${outputDir}/remote-order-dispatched.png`,
  fullPage: true,
});
await browser.close();
console.log('remote construction drone browser verification passed');
