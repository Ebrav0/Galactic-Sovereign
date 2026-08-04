#!/usr/bin/env node
/**
 * Browser acceptance for player-facing technology locks in ship production.
 * Usage: node scripts/verify-tech-lock-ui.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || process.env.GS_TEST_URL || 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.env.GS_TEST_OUTPUT || 'output/tech-lock-audit/browser');
fs.mkdirSync(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[render]')) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.setDefaultTimeout(30_000);
  await page.addInitScript(() => {
    localStorage.setItem('gs-profile-v1', JSON.stringify({
      version: 3,
      tutorialGraduatedAt: Date.now(),
      tutorialCurriculumVersion: 4,
      briefingsSeen: [],
      tutorialProgress: {
        foundations: {
          status: 'waived',
          currentStepId: null,
          completedStepIds: [],
          updatedAt: Date.now(),
        },
        coop: { status: 'not_started', currentStepId: null, completedStepIds: [] },
        chapters: {},
      },
    }));
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#title-singleplayer-door').click({ force: true });
  await page.locator('#title-singleplayer').waitFor({ state: 'visible' });
  await page.locator('#title-sandbox-btn').click({ force: true });
  await page.locator('#new-game-start-btn').waitFor({ state: 'visible' });
  await page.locator('#new-game-start-btn').click({ force: true });
  await page.evaluate(() => window.__setWarpIntroElapsed?.(1_000_000));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing');

  await page.evaluate(() => {
    document.querySelectorAll('.panel--modal:not(.hidden), .modal-backdrop:not(.hidden)').forEach((node) => {
      node.classList.add('hidden');
    });
    const state = window.getGameState();
    state.paused = false;
    state.credits = 100_000;
    window.__seedTestShipyards();
    const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
    const planet = system.bodies.find((body) => body.type === 'habitable') ?? system.bodies[0];
    window.__selectPlanet(planet.id);
    document.getElementById('command-queue-btn')?.click();
  });
  await page.locator('#empire-queue-panel').waitFor({ state: 'visible' });

  const locked = page.locator('#empire-queue-actions [data-queue-hull][data-required-tech]:disabled');
  await locked.first().waitFor({ state: 'visible' });
  const lockedCount = await locked.count();
  assert(lockedCount === 16, `expected 16 locked tech hulls, found ${lockedCount}`);

  const lockContract = await locked.evaluateAll((buttons) => buttons.every((button) => (
    button.disabled
      && button.getAttribute('aria-disabled') === 'true'
      && button.dataset.requiredTech
      && button.textContent.includes('🔒')
      && button.title.startsWith('Locked — research ')
  )));
  assert(lockContract, 'one or more locked hull controls lack disabled/accessibility/tech metadata');

  const before = await page.evaluate(() => window.__getEmpireQueue().length);
  await page.locator('#empire-queue-actions [data-queue-hull="dreadnought"]')
    .dispatchEvent('mousedown', { button: 0 });
  const afterDisabledAttempt = await page.evaluate(() => window.__getEmpireQueue().length);
  assert(afterDisabledAttempt === before, 'disabled dreadnought control dispatched a queue command');

  const directLocked = await page.evaluate(() => window.__enqueueHull('dreadnought'));
  assert(!directLocked.ok && /not unlocked/i.test(directLocked.reason),
    `command boundary accepted locked dreadnought: ${JSON.stringify(directLocked)}`);

  await page.evaluate(() => {
    window.getGameState().research.unlocked.push('mil_dreadnought_unlock');
  });
  const dreadnought = page.locator('#empire-queue-actions [data-queue-hull="dreadnought"]');
  await page.waitForFunction(() => (
    !document.querySelector('#empire-queue-actions [data-queue-hull="dreadnought"]')?.disabled
  ));
  assert(await dreadnought.getAttribute('aria-disabled') === 'false', 'unlocked dreadnought stayed aria-disabled');

  await dreadnought.dispatchEvent('mousedown', { button: 0 });
  await page.waitForFunction((previous) => window.__getEmpireQueue().length === previous + 1, before);
  const queuedHull = await page.evaluate(() => {
    const queued = window.__getEmpireQueue().at(-1);
    return queued?.hull ?? queued?.productId;
  });
  assert(queuedHull === 'dreadnought', `expected unlocked dreadnought to queue, found ${queuedHull}`);

  await page.screenshot({
    path: path.join(outputDir, 'production-tech-locks.png'),
    fullPage: true,
  });
  assert(errors.length === 0, `browser errors: ${errors.join('; ')}`);
  console.log(`verify:tech-lock-ui passed (${lockedCount} locked controls)`, { outputDir });
  await context.close();
} finally {
  await browser.close();
}
