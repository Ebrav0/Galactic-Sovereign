import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const outDir = path.resolve('output/visuals/campaign-intro');
const targetUrl = process.env.INTRO_TARGET === 'file'
  ? pathToFileURL(path.resolve('src/index.html')).href
  : 'http://127.0.0.1:5173';
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
    errors.push(`console: ${message.text()}`);
  }
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

const checks = [];
function check(condition, label, details = '') {
  checks.push({ ok: !!condition, label, details });
  if (!condition) throw new Error(`${label}${details ? ` — ${details}` : ''}`);
}

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__getWarpIntroState === 'function');
  await page.click('#title-new-campaign-btn');
  await page.waitForFunction(() => window.__getBootPhase?.() === 'warpIntro');

  const initial = await page.evaluate(() => window.__getWarpIntroState());
  check(initial.active, 'intro activates from New Campaign');
  check(initial.campaign.mode === 'GUIDED CAMPAIGN', 'campaign mode reaches cinematic', initial.campaign.mode);
  check(initial.campaign.systemName.length > 0, 'home-system name reaches cinematic', initial.campaign.systemName);

  const moments = [
    [1100, '01-awakening'],
    [2200, '02-flagship-ignition'],
    [3400, '03-hyperspace-breach'],
    [5900, '04-translation'],
    [7600, '05-arrival'],
    [8500, '06-system-reveal'],
    [11000, '07-system-reveal-hold'],
  ];
  for (const [elapsed, name] of moments) {
    const state = await page.evaluate((ms) => window.__setWarpIntroElapsed(ms), elapsed);
    await page.waitForTimeout(120);
    check(state.elapsedMs === elapsed, `${name} deterministic timestamp`, String(state.elapsedMs));
    await page.locator('#game-canvas').screenshot({ path: path.join(outDir, `${name}.png`) });
  }

  const heldReveal = await page.evaluate(() => window.__getWarpIntroState());
  check(heldReveal.active && heldReveal.phase === 'arrival', 'home-system reveal remains active at eleven seconds');

  await page.evaluate(() => window.__setWarpIntroElapsed(14001));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing');
  check(await page.evaluate(() => !window.getGameState().paused), 'full intro completes into unpaused campaign');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__getWarpIntroState === 'function');
  await page.click('#title-new-campaign-btn');
  await page.waitForFunction(() => window.__getBootPhase?.() === 'warpIntro');

  await page.evaluate(() => window.__setWarpIntroElapsed(500));
  await page.keyboard.press('Space');
  const earlySkip = await page.evaluate(() => window.__getWarpIntroState());
  check(!earlySkip.skipRequested, 'skip is gated during opening beat');

  await page.evaluate(() => window.__setWarpIntroElapsed(2000));
  await page.keyboard.press('Space');
  const acceptedSkip = await page.evaluate(() => window.__getWarpIntroState());
  check(acceptedSkip.skipRequested, 'skip is accepted after opening beat');
  await page.evaluate(() => window.__setWarpIntroElapsed(2900));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing');
  check(await page.evaluate(() => !window.getGameState().paused), 'skip completes into unpaused campaign');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__getWarpIntroState === 'function');
  await page.click('#title-new-campaign-btn');
  const reduced = await page.evaluate(() => window.__getWarpIntroState());
  check(reduced.reducedMotion, 'reduced-motion campaign intro is selected');
  await page.evaluate(() => window.__setWarpIntroElapsed(3201));
  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing');
  check(await page.evaluate(() => !window.getGameState().paused), 'reduced-motion intro completes into campaign');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.click('#title-custom-campaign-btn');
  await page.selectOption('#new-game-victory', 'economic');
  await page.selectOption('#new-game-ai-difficulty', 'hard');
  await page.click('#new-game-sandbox-btn');
  const custom = await page.evaluate(() => window.__getWarpIntroState());
  check(custom.campaign.mode === 'SANDBOX CAMPAIGN', 'custom mode reaches cinematic', custom.campaign.mode);
  check(custom.campaign.objective === 'ECONOMIC HEGEMONY', 'custom objective reaches cinematic', custom.campaign.objective);
  check(custom.campaign.difficulty === 'HARD', 'custom difficulty reaches cinematic', custom.campaign.difficulty);

  check(errors.length === 0, 'no browser console errors', errors.join('\n'));
  console.log(JSON.stringify({ checks, errors, screenshots: moments.map(([, name]) => `${name}.png`) }, null, 2));
} finally {
  await browser.close();
}
