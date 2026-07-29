#!/usr/bin/env node
/**
 * Logistics Command browser regression:
 * proves live controls remain mounted long enough for real pointer/keyboard
 * interaction, then exercises every center/convoy control end-to-end.
 *
 * Usage: node scripts/verify-logistics-controls-browser.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || process.env.GS_TEST_URL || 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.env.GS_TEST_OUTPUT || 'output/logistics-controls');
fs.mkdirSync(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function delayedPointerClick(page, locator, holdMs = 160) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, `Control is not visible: ${await locator.textContent()}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(180);
}

async function setupLogisticsSandbox(page) {
  return page.evaluate(() => {
    const state = window.__newGame(20260728, { mode: 'sandbox', victoryType: 'economic' });
    window.__setBootPhase('playing');
    document.getElementById('title-screen')?.classList.add('hidden');
    document.getElementById('new-game-modal')?.classList.add('hidden');
    document.getElementById('new-game-modal-backdrop')?.classList.add('hidden');
    state.paused = false;
    state.credits = 5000;

    const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
    const body = system.bodies.find((entry) => entry.type === 'habitable') ?? system.bodies[0];
    if (!system.structures.some((entry) => entry.type === 'outpost')) {
      system.structures.push({
        id: 'logistics-controls-outpost',
        type: 'outpost',
        bodyId: body.id,
        builtAtTime: state.time,
      });
    }
    for (const techId of [
      'trade_fast_couriers',
      'trade_bulk_freighter',
      'trade_armored_convoy',
      'trade_logistics_hubs',
    ]) {
      if (!state.research.unlocked.includes(techId)) state.research.unlocked.push(techId);
    }

    const registration = window.__registerExportDepot(state.stronghold, { storedCredits: 1200 });
    const depot = registration.depot;
    depot.storedCredits = 1200;
    const nexuses = window.__listTradeNexuses().filter((entry) => entry.available);
    if (nexuses[0]) window.__setDepotDestination(depot.id, nexuses[0].systemId);

    const group = window.__createBattleGroup();
    window.advanceTime(100);
    return {
      depotId: depot.id,
      groupId: group.id,
      nexusIds: nexuses.map((entry) => entry.systemId),
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error' && !text.includes('404 (Not Found)')) {
    errors.push(`console: ${text}`);
  }
});

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => typeof window.__newGame === 'function' && typeof window.render_game_to_text === 'function',
  );
  const setup = await setupLogisticsSandbox(page);
  assert(setup.nexusIds.length >= 2, 'Expected at least two available Trade Nexuses');

  await page.locator('#tab-logistics').click();
  const panel = page.locator('#logistics-panel');
  await panel.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelectorAll('#logistics-panel-body button').length >= 4,
  );

  // Enter the panel first, then prove the control nodes remain mounted while
  // the live simulation continues updating physical-credit totals.
  const panelBox = await panel.boundingBox();
  assert(panelBox, 'Logistics panel has no visible bounds');
  await page.mouse.move(panelBox.x + 24, panelBox.y + 24);
  await page.evaluate(() => {
    window.__logisticsControlButton = document.querySelector('#logistics-panel-body button');
    window.__logisticsControlSelect = document.querySelector('#logistics-panel-body select');
  });
  await page.waitForTimeout(350);
  const stable = await page.evaluate(() => ({
    button: window.__logisticsControlButton
      === document.querySelector('#logistics-panel-body button'),
    select: window.__logisticsControlSelect
      === document.querySelector('#logistics-panel-body select'),
  }));
  assert(stable.button && stable.select, `Logistics controls were detached: ${JSON.stringify(stable)}`);

  const reserve = page.getByRole('button', { name: /Available$/ }).first();
  await delayedPointerClick(page, reserve);
  assert(
    await page.evaluate((groupId) => (
      window.getGameState().battleGroups.find((entry) => entry.id === groupId)?.convoyReserve === true
    ), setup.groupId),
    'Escort reserve button did not mutate its fleet',
  );

  const center = page.locator('.logistics-card').first();
  const doctrine = center.locator('select').nth(0);
  await doctrine.focus();
  await page.waitForTimeout(350);
  await doctrine.selectOption('fast');
  await page.waitForTimeout(180);
  assert(
    await page.evaluate((depotId) => (
      window.getGameState().logistics.depots[depotId]?.doctrineId === 'fast'
    ), setup.depotId),
    'Doctrine dropdown did not update the Export Center',
  );

  const destination = center.locator('select').nth(1);
  await destination.selectOption(setup.nexusIds[1]);
  await page.waitForTimeout(180);
  assert(
    await page.evaluate(({ depotId, destinationId }) => (
      window.getGameState().logistics.depots[depotId]?.preferredNexusId === destinationId
    ), { depotId: setup.depotId, destinationId: setup.nexusIds[1] }),
    'Destination dropdown did not update the route',
  );

  const pause = center.getByRole('button', { name: 'Pause route' });
  await delayedPointerClick(page, pause);
  assert(
    await page.evaluate((depotId) => (
      window.getGameState().logistics.depots[depotId]?.routePaused === true
    ), setup.depotId),
    'Pause route button did not pause',
  );
  // The existing button closure reads live depot state even before the panel
  // refreshes, so the same stable control must resume correctly.
  await delayedPointerClick(page, pause);
  assert(
    await page.evaluate((depotId) => (
      window.getGameState().logistics.depots[depotId]?.routePaused === false
    ), setup.depotId),
    'Pause route button did not resume',
  );

  const upgrade = center.getByRole('button', { name: 'Upgrade to L2' });
  await delayedPointerClick(page, upgrade);
  assert(
    await page.evaluate((depotId) => (
      window.getGameState().logistics.depots[depotId]?.level === 2
    ), setup.depotId),
    'Upgrade button did not raise the Export Center to level 2',
  );

  const dispatch = center.getByRole('button', { name: 'Dispatch now' });
  await delayedPointerClick(page, dispatch);
  await page.evaluate(() => {
    // Keep the fresh convoy in its departure jump window so rerouting has a
    // valid route-node origin instead of racing the real-time transit clock.
    const state = window.getGameState();
    const convoy = state.logistics.convoys.find((entry) => entry.status === 'jumping');
    if (convoy) {
      convoy.currentNodeId = convoy.fromSystemId;
      convoy.systemId = convoy.fromSystemId;
      convoy.legIndex = 0;
      convoy.jumpEndsAt = state.time + 60_000;
      convoy.legStartTime = convoy.jumpEndsAt;
    }
    document.activeElement?.blur();
  });
  await page.mouse.move(700, 900);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).logistics.convoys.length === 1,
  );
  const convoyId = await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).logistics.convoys[0].id,
  );

  await page.waitForFunction(
    (id) => [...document.querySelectorAll('.logistics-card strong')]
      .some((node) => node.textContent === id.toUpperCase()),
    convoyId,
  );
  await page.mouse.move(panelBox.x + 24, panelBox.y + 24);
  await page.waitForTimeout(120);
  const convoyCard = page.locator('.logistics-card').filter({ hasText: convoyId.toUpperCase() });
  const reroute = convoyCard.getByRole('button', { name: 'Reroute' });
  await delayedPointerClick(page, reroute);
  const rerouteState = await page.evaluate((id) => ({
    completed: [...document.querySelectorAll('.toast')].some((node) => (
      node.textContent.includes('rerouted') && window.getGameState().logistics.convoys
        .some((convoy) => convoy.id === id)
    )),
    toasts: [...document.querySelectorAll('.toast')].map((node) => node.textContent),
    convoy: window.getGameState().logistics.convoys.find((entry) => entry.id === id) ?? null,
  }), convoyId);
  assert(rerouteState.completed, `Reroute button did not complete: ${JSON.stringify(rerouteState)}`);

  const follow = convoyCard.getByRole('button', { name: 'Follow' });
  await delayedPointerClick(page, follow);
  assert(
    await page.evaluate(() => window.__getView() === 'galaxy'),
    'Follow button did not switch to the galaxy convoy view',
  );

  const textState = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert(textState.logistics.convoys.some((convoy) => convoy.id === convoyId),
    'render_game_to_text is missing the dispatched convoy');
  assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);

  await page.screenshot({ path: path.join(outputDir, 'logistics-controls.png'), fullPage: true });
  fs.writeFileSync(
    path.join(outputDir, 'result.json'),
    JSON.stringify({
      ok: true,
      stable,
      depotId: setup.depotId,
      convoyId,
      doctrine: 'fast',
      destination: setup.nexusIds[1],
      level: 2,
      controls: [
        'reserve',
        'doctrine',
        'destination',
        'pause',
        'resume',
        'upgrade',
        'dispatch',
        'reroute',
        'follow',
      ],
      errors,
    }, null, 2),
  );
  console.log('verify:logistics:browser passed', { depotId: setup.depotId, convoyId, stable });
} finally {
  await context.close();
  await browser.close();
}
