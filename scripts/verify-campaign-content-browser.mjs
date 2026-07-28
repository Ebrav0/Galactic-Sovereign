#!/usr/bin/env node
/**
 * Campaign content — Playwright: mission picker, campaign mode, progress panel.
 * Usage: node scripts/verify-campaign-content-browser.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || process.env.GS_TEST_URL || 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.env.GS_TEST_OUTPUT || 'output/campaign-content');
fs.mkdirSync(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waiveAcademy(page) {
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
}

async function finishWarp(page) {
  await page.evaluate(() => window.__setWarpIntroElapsed?.(1_000_000));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing', null, { timeout: 30_000 });
  await page.evaluate(() => {
    document.querySelectorAll('.panel--modal:not(.hidden), .modal-backdrop:not(.hidden)').forEach((n) => {
      if (n.id === 'title-screen') return;
      n.classList.add('hidden');
    });
    document.getElementById('pause-overlay')?.classList.add('hidden');
    const state = window.__getGameState?.();
    if (state) state.paused = false;
  });
}

async function openCampaignPanel(page) {
  await page.evaluate(() => {
    document.getElementById('pause-overlay')?.classList.add('hidden');
    document.getElementById('tab-campaign')?.click();
  });
  await page.locator('#campaign-screen-body').waitFor({ state: 'visible' });
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
  await waiveAcademy(page);
  await page.getByRole('button', { name: /Single Player/ }).click();

  assert(await page.locator('#title-missions-btn').isEnabled(), 'Missions should unlock after Academy');
  assert(await page.locator('#title-custom-campaign-btn').isEnabled(), 'Campaign should unlock after Academy');
  assert(await page.locator('#title-sandbox-btn').isEnabled(), 'Sandbox should unlock after Academy');

  await page.locator('#title-missions-btn').click();
  await page.locator('#new-game-mission-field').waitFor({ state: 'visible' });
  assert(await page.locator('#new-game-mission option[value="wormhole_race"]').count() === 1, 'wormhole_race option');
  assert(await page.locator('#new-game-mission option[value="dyson_defense"]').count() === 1, 'dyson_defense option');
  assert(await page.locator('#new-game-mission option[value="first_hero"]').count() === 1, 'first_hero option');
  assert(await page.locator('#new-game-mission option[value="final_dominion"]').count() === 1, 'final_dominion option');
  await page.locator('#new-game-mission').selectOption('wormhole_race');
  await page.screenshot({ path: path.join(outputDir, '01-mission-picker.png') });
  await page.locator('#new-game-start-btn').click();
  await finishWarp(page);

  const missionCamp = await page.evaluate(() => window.__campaignSummary());
  assert(missionCamp.activeMissionId === 'wormhole_race', `activeMissionId=${missionCamp.activeMissionId}`);
  assert(missionCamp.mode === 'mission', `mode=${missionCamp.mode}`);

  await openCampaignPanel(page);
  const bodyText = await page.locator('#campaign-screen-body').innerText();
  assert(
    /Wormhole Race|Complete wormhole transit/i.test(bodyText),
    `mission progress missing: ${bodyText.slice(0, 240)}`,
  );
  await page.screenshot({ path: path.join(outputDir, '02-mission-progress.png') });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('gs-show-title', { detail: { panel: 'single' } }));
  });
  await page.locator('#title-screen').waitFor({ state: 'visible' });
  await page.locator('#title-custom-campaign-btn').click();
  await page.locator('#new-game-victory-field').waitFor({ state: 'visible' });
  await page.locator('#new-game-victory').selectOption('dominion');
  await page.locator('#new-game-start-btn').click();
  await finishWarp(page);

  const camp = await page.evaluate(() => window.__campaignSummary());
  assert(camp.mode === 'campaign', `expected campaign mode, got ${camp.mode}`);
  assert(camp.victoryType === 'dominion', `expected dominion, got ${camp.victoryType}`);

  await openCampaignPanel(page);
  const dominionText = await page.locator('#campaign-screen-body').innerText();
  assert(/Dominion:/i.test(dominionText), `dominion progress missing: ${dominionText.slice(0, 240)}`);
  await page.screenshot({ path: path.join(outputDir, '03-dominion-progress.png') });

  const victory = await page.evaluate(() => {
    const state = window.__getGameState();
    state.campaign.won = true;
    return window.__checkVictory();
  });
  assert(victory?.type === 'victory' && victory?.victoryType === 'dominion', `victory=${JSON.stringify(victory)}`);
  await page.screenshot({ path: path.join(outputDir, '04-victory-path.png') });

  assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
  console.log('verify:campaign-content:browser passed', { outputDir, shots: 4 });
} finally {
  await browser.close();
}
