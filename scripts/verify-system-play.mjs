#!/usr/bin/env node
/**
 * System-play smoke: flight, orbit, follow, view toggle, pause, build button presence.
 * Usage: node scripts/verify-system-play.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { DECK_LAYOUT } from '../src/js/command-deck.js';

const baseUrl = process.argv[2] || process.env.GS_TEST_URL || 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.env.GS_TEST_OUTPUT || 'output/command-deck/system-play');
fs.mkdirSync(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function enterSandbox(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const profile = {
      version: 2,
      tutorialGraduatedAt: Date.now(),
      tutorialCurriculumVersion: 3,
      briefingsSeen: [],
      tutorialProgress: {
        foundations: {
          status: 'waived',
          currentStepId: null,
          completedStepIds: [],
          updatedAt: Date.now(),
        },
        coop: {
          status: 'not_started',
          currentStepId: null,
          completedStepIds: [],
          updatedAt: null,
        },
        chapters: {},
      },
    };
    localStorage.setItem('gs-profile-v1', JSON.stringify(profile));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Single Player/ }).click();
  await page.locator('#title-sandbox-btn').click();
  const start = page.locator('#new-game-start-btn');
  await start.waitFor({ state: 'visible', timeout: 10_000 });
  await start.click();
  await page.evaluate(() => window.__setWarpIntroElapsed?.(1_000_000));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing', null, { timeout: 30_000 });
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(25_000);

try {
  await enterSandbox(page);
  await page.locator('#flight-quick-controls').waitFor({ state: 'visible' });
  await page.locator('#view-hint').waitFor({ state: 'attached' });
  assert(await page.locator('#build-outpost-btn').count() === 1, 'build-outpost-btn missing');
  assert(await page.locator('#capture-panel-body').count() === 1, 'capture-panel-body missing');

  // Dismiss any field-manual / modal that blocks input
  await page.evaluate(() => {
    document.querySelectorAll('.panel--modal:not(.hidden), .modal-backdrop:not(.hidden)').forEach((n) => {
      if (n.id === 'title-screen') return;
      n.classList.add('hidden');
    });
    const st = window.getGameState?.();
    if (st) st.paused = false;
  });
  await page.locator('#game-canvas').click({ position: { x: 400, y: 300 } });

  const before = await page.evaluate(() => {
    const f = window.getGameState().flagship;
    return { x: f.x, y: f.y, view: window.__getView?.() || null, paused: window.getGameState().paused };
  });

  // Prefer on-screen thrust button (same path as clickable flight pad)
  await page.locator('#flight-quick-controls [data-flight-x="1"]').dispatchEvent('pointerdown');
  await page.waitForTimeout(500);
  await page.locator('#flight-quick-controls [data-flight-x="1"]').dispatchEvent('pointerup');
  await page.waitForTimeout(100);

  let afterMove = await page.evaluate(() => {
    const f = window.getGameState().flagship;
    return { x: f.x, y: f.y };
  });
  let moved = Math.hypot(afterMove.x - before.x, afterMove.y - before.y) > 0.5;
  if (!moved) {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyD');
    afterMove = await page.evaluate(() => {
      const f = window.getGameState().flagship;
      return { x: f.x, y: f.y };
    });
    moved = Math.hypot(afterMove.x - before.x, afterMove.y - before.y) > 0.5;
  }
  assert(moved, `flagship did not move (before=${JSON.stringify(before)} after=${JSON.stringify(afterMove)})`);

  // Select a body then orbit
  await page.evaluate(() => {
    const state = window.getGameState();
    const sysId = state.flagship.systemId;
    const sys = state.galaxies[state.activeGalaxyId].systems[sysId];
    const planet = sys.bodies.find((b) => b.type === 'habitable') || sys.bodies[0];
    window.__selectPlanet(planet.id);
  });
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  const inOrbit = await page.evaluate(() => !!window.getGameState().flagship.orbit);
  assert(inOrbit, 'orbit did not engage');
  await page.keyboard.press('o');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => !window.getGameState().flagship.orbit), 'orbit did not exit');

  await page.keyboard.press('f');
  await page.waitForTimeout(100);
  // follow is best-effort; ensure no throw

  await page.keyboard.press('m');
  await page.waitForTimeout(200);
  const viewGalaxy = await page.evaluate(() => window.__getView?.() || window.getGameState?.());
  // Prefer explicit view helper when present
  const viewAfterM = await page.evaluate(() => {
    if (typeof window.__getView === 'function') return window.__getView();
    return document.getElementById('tab-galaxy')?.classList.contains('tab--active') ? 'galaxy' : 'system';
  });
  assert(viewAfterM === 'galaxy', `M should open galaxy, got ${viewAfterM}`);
  await page.keyboard.press('m');
  await page.waitForTimeout(200);

  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => window.getGameState().paused) === true, 'pause failed');
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => window.getGameState().paused) === false, 'resume failed');

  // Geometry: canvas primacy
  const geom = await page.evaluate(({ minH, minW }) => {
    const canvas = document.getElementById('game-viewport')?.getBoundingClientRect()
      || document.getElementById('game-canvas')?.getBoundingClientRect();
    const deck = document.getElementById('action-deck')?.getBoundingClientRect();
    const activity = document.getElementById('activity-rail')?.getBoundingClientRect();
    const inspector = document.getElementById('context-inspector')?.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const chromeW = (activity?.width || 0) + (inspector?.width || 0);
    const freeW = (vw - chromeW) / vw;
    return {
      canvasHRatio: canvas.height / vh,
      freeW,
      deckH: deck?.height || 0,
      flightControlsPresent: !!document.getElementById('flight-quick-controls'),
      okH: canvas.height / vh >= minH - 0.05,
      okW: freeW >= minW - 0.05,
    };
  }, {
    minH: DECK_LAYOUT.compact.canvasHeightCollapsedMinRatio,
    minW: DECK_LAYOUT.systemPlay.canvasWidthFreeMinRatio,
  });

  assert(geom.okH, `canvas height ratio ${geom.canvasHRatio}`);
  assert(geom.okW, `canvas free width ratio ${geom.freeW}`);
  assert(geom.flightControlsPresent, 'flight-quick-controls stubs missing');

  await page.screenshot({ path: path.join(outputDir, 'system-play.png') });
  assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
  console.log('verify:system-play passed', { moved, viewGalaxy, geom });
} finally {
  await browser.close();
}
