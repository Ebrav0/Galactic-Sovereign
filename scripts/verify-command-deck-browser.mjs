#!/usr/bin/env node
/**
 * Adaptive Command Deck — Playwright geometry + context markers + slide-overs.
 * Usage: node scripts/verify-command-deck-browser.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { DECK_LAYOUT } from '../src/js/command-deck.js';

const baseUrl = process.argv[2] || process.env.GS_TEST_URL || 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.env.GS_TEST_OUTPUT || 'output/command-deck/acceptance');
fs.mkdirSync(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function enterSandbox(page) {
  await page.addInitScript(() => {
    const profile = {
      version: 3,
      tutorialGraduatedAt: Date.now(),
      tutorialCurriculumVersion: 4,
      briefingsSeen: [],
      uiPreferences: {
        pinnedMonitor: null,
        pinnedMonitorCollapsed: false,
      },
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
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Single Player/ }).click({ force: true });
  await page.locator('#title-sandbox-btn').click({ force: true });
  const start = page.locator('#new-game-start-btn');
  await start.waitFor({ state: 'visible', timeout: 10_000 });
  await start.click({ force: true });
  await page.evaluate(() => window.__setWarpIntroElapsed?.(1_000_000));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing', null, { timeout: 30_000 });
}

async function measureShell(page) {
  return page.evaluate(() => {
    const rect = (id) => {
      const node = document.getElementById(id);
      if (!node || node.classList.contains('hidden')) return null;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') return null;
      return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const canvas = rect('game-viewport') || rect('game-canvas');
    return {
      vw,
      vh,
      activity: rect('activity-rail'),
      inspector: rect('context-inspector'),
      canvas,
      deckContext: document.getElementById('hud')?.dataset?.deckContext || null,
      deckExpanded: document.getElementById('hud')?.classList.contains('hud--deck-expanded'),
    };
  });
}

async function runAtViewport(browser, size, label) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
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
  page.setDefaultTimeout(25_000);

  await enterSandbox(page);
  await page.evaluate(() => {
    document.querySelectorAll('.panel--modal:not(.hidden), .modal-backdrop:not(.hidden)').forEach((n) => {
      if (n.id === 'title-screen') return;
      n.classList.add('hidden');
    });
    const st = window.getGameState?.();
    if (st) st.paused = false;
  });
  await page.locator('#activity-rail').waitFor({ state: 'visible' });
  await page.locator('#context-inspector').waitFor({ state: 'attached' });

  await page.evaluate(() => window.__selectPlanet?.(null));
  await page.waitForTimeout(200);
  let shell = await measureShell(page);
  await page.screenshot({ path: path.join(outputDir, `${label}-01-system-collapsed.png`) });

  assert(shell.activity, `${label}: activity-rail missing`);
  assert(shell.canvas, `${label}: canvas missing`);
  assert(!shell.inspector || shell.inspector.width <= 1,
    `${label}: quiet map should have a closed inspector (${shell.inspector?.width ?? 'none'})`);
  assert(shell.deckContext === 'systemMap' || shell.deckContext === 'activity',
    `${label}: expected systemMap context, got ${shell.deckContext}`);

  if (size.width >= 1440) {
    assert(shell.activity.width >= DECK_LAYOUT.wide.activityRail[0] - 8
      && shell.activity.width <= DECK_LAYOUT.wide.activityRail[1] + 20,
      `${label}: activity rail width ${shell.activity.width}`);
  } else {
    assert(shell.activity.width <= DECK_LAYOUT.compact.activityRailMax + 40,
      `${label}: compact activity rail should be icon-first (${shell.activity.width})`);
  }

  const canvasHRatio = shell.canvas.height / shell.vh;
  assert(canvasHRatio >= DECK_LAYOUT.compact.canvasHeightCollapsedMinRatio - 0.05,
    `${label}: canvas height ratio ${canvasHRatio.toFixed(3)} with deck collapsed`);

  await page.evaluate(() => {
    const state = window.getGameState?.();
    const sysId = state?.flagship?.systemId;
    const sys = state?.galaxies?.[state.activeGalaxyId]?.systems?.[sysId]
      || Object.values(state?.galaxies?.[state.activeGalaxyId]?.systems || {})[0];
    const planet = sys?.bodies?.find((b) => b.type === 'habitable') || sys?.bodies?.[0];
    if (planet) window.__selectPlanet?.(planet.id);
  });
  await page.waitForFunction(() => {
    const inspector = document.getElementById('context-inspector');
    return inspector && inspector.getBoundingClientRect().width >= 280;
  }, null, { timeout: 3_000 });
  shell = await measureShell(page);
  assert(shell.inspector && shell.inspector.width >= Math.min(300, DECK_LAYOUT.wide.inspector[0] - 20),
    `${label}: selection should open contextual inspector (${shell.inspector?.width ?? 'none'})`);
  await page.screenshot({ path: path.join(outputDir, `${label}-02-body-or-system.png`) });

  await page.locator('#command-map-btn').evaluate((button) => button.click());
  await page.waitForFunction(() => window.__getView?.() === 'galaxy', null, { timeout: 3_000 });
  const overlaysOk = await page.evaluate(() => {
    const o = document.getElementById('overlay-threat');
    const wrap = document.getElementById('overlay-controls');
    if (!o || !wrap) return false;
    wrap.classList.remove('hidden');
    o.classList.remove('hidden');
    return true;
  });
  assert(overlaysOk, `${label}: overlay-threat`);
  assert(await page.evaluate(() => window.__getView?.() === 'galaxy'
    || document.getElementById('tab-galaxy')?.classList.contains('tab--active')),
  `${label}: galaxy view not active`);
  await page.screenshot({ path: path.join(outputDir, `${label}-03-galaxy.png`) });

  await page.locator('#tab-fleet').evaluate((button) => button.click());
  try {
    await page.waitForFunction(
      () => document.getElementById('hud')?.dataset?.deckContext === 'activity',
      null,
      { timeout: 3_000 },
    );
  } catch {
    throw new Error(`${label}: activity context did not render; errors=${errors.join('; ') || 'none'}`);
  }
  shell = await measureShell(page);
  const fleetUi = await page.evaluate(() => JSON.parse(window.render_game_to_text()).ui);
  assert(shell.deckContext === 'activity',
    `${label}: fleet should set activity context; shell=${JSON.stringify(shell)} ui=${JSON.stringify(fleetUi)}`);
  await page.screenshot({ path: path.join(outputDir, `${label}-04-fleet.png`) });

  await page.locator('[data-pin-monitor="fleet"]').evaluate((button) => button.click());
  await page.locator('#command-queue-btn').evaluate((button) => button.click());
  await page.waitForFunction(
    () => {
      const ui = JSON.parse(window.render_game_to_text()).ui;
      const queue = document.getElementById('empire-queue-panel');
      return ui.activeDeck === 'queue'
        && queue
        && !queue.classList.contains('hidden')
        && document.getElementById('context-inspector')?.getBoundingClientRect().width >= 280;
    },
    null,
    { timeout: 3_000 },
  );
  const pinnedState = await page.evaluate(() => JSON.parse(window.render_game_to_text()).ui);
  assert(pinnedState.pinnedMonitor === 'fleet', `${label}: fleet pin did not persist in UI state`);
  assert(pinnedState.activeDeck === 'queue', `${label}: queue should be the active deck`);
  await page.screenshot({ path: path.join(outputDir, `${label}-04b-pinned-fleet-queue.png`) });

  await page.locator('#command-launcher-btn').evaluate((button) => button.click());
  await page.locator('#command-launcher').waitFor({ state: 'visible' });
  await page.locator('#tab-tech').evaluate((button) => button.click());
  await page.locator('#tech-screen').waitFor({ state: 'visible', timeout: 3_000 });
  const strip = await page.evaluate(({ minPx, minRatio }) => {
    const screen = document.getElementById('tech-screen');
    if (!screen || screen.classList.contains('hidden')) return { ok: false, reason: 'hidden' };
    const r = screen.getBoundingClientRect();
    const leftStrip = r.left;
    const ok = leftStrip >= minPx || leftStrip / window.innerWidth >= minRatio
      || screen.classList.contains('tech-screen--fullscreen');
    return { ok, leftStrip, fullscreen: screen.classList.contains('tech-screen--fullscreen') };
  }, {
    minPx: DECK_LAYOUT.slideOverMapStripMinPx,
    minRatio: DECK_LAYOUT.slideOverMapStripMinRatio,
  });
  assert(strip.ok, `${label}: tech slide-over map strip failed ${JSON.stringify(strip)}`);
  await page.screenshot({ path: path.join(outputDir, `${label}-05-tech.png`) });

  await page.locator('#command-launcher-btn').evaluate((button) => button.click());
  await page.locator('#command-launcher').waitFor({ state: 'visible', timeout: 3_000 });
  await page.locator('#tab-diplomacy').evaluate((button) => button.click());
  await page.locator('#diplomacy-screen').waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {
      throw new Error(`${label}: diplomacy workspace did not render`);
    });
  await page.screenshot({ path: path.join(outputDir, `${label}-06-diplomacy.png`) });

  await page.locator('#tab-system').evaluate((button) => button.click());
  await page.waitForTimeout(200);

  assert(errors.length === 0, `${label}: page errors: ${errors.join('; ')}`);
  await context.close();
  return { label, ok: true };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  await runAtViewport(browser, { width: 1440, height: 960 }, '1440');
  await runAtViewport(browser, { width: 1280, height: 720 }, '1280');
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#title-singleplayer-door').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(outputDir, 'title-solo-door.png') });
    await context.close();
  }
  console.log('verify:command-deck:browser passed', { outputDir });
} finally {
  await browser.close();
}
