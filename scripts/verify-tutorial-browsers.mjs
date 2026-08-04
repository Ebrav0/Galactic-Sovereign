import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5173/';
const requested = process.argv.slice(3);
const engines = requested.length ? requested : ['firefox', 'webkit'];
const launchers = { chromium, firefox, webkit };
const outputDir = path.resolve('output/tutorial-foundations/cross-browser');
await fs.mkdir(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const engine of engines) {
  const browserType = launchers[engine];
  if (!browserType) throw new Error(`Unknown browser engine: ${engine}`);
  console.log(`[tutorial-browser] ${engine} launching`);
  const launchOptions = { headless: true, timeout: 15_000 };
  if (engine === 'firefox') {
    launchOptions.env = {
      ...process.env,
      MOZ_DISABLE_CONTENT_SANDBOX: '1',
      MOZ_HEADLESS_WIDTH: '1280',
      MOZ_HEADLESS_HEIGHT: '720',
    };
    launchOptions.firefoxUserPrefs = {
      'gfx.webrender.software': true,
      'media.autoplay.default': 0,
    };
  }
  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      if (location?.url?.endsWith('/api/v1/session')) return;
      errors.push(`console: ${message.text()}${location?.url ? ` @ ${location.url}` : ''}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().endsWith('/api/v1/session')) return;
    if (response.status() >= 400) errors.push(`response ${response.status()}: ${response.url()}`);
  });

  try {
    console.log(`[tutorial-browser] ${engine} loading`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__clearTutorialProfile === 'function');
    await page.evaluate(() => window.__clearTutorialProfile());
    await page.reload({ waitUntil: 'domcontentloaded' });

    console.log(`[tutorial-browser] ${engine} starting Foundations`);
    await page.getByRole('button', { name: /Single Player/ }).click();
    await page.getByRole('button', { name: 'Campaign' }).waitFor({ state: 'visible' });
    assert(await page.getByRole('button', { name: 'Campaign' }).isEnabled(),
      `${engine}: Campaign should remain available before Foundations`);
    assert(await page.getByRole('button', { name: 'Missions' }).isEnabled(),
      `${engine}: Missions should remain available before Foundations`);
    assert(await page.getByRole('button', { name: 'Sandbox' }).isEnabled(),
      `${engine}: Sandbox should remain available before Foundations`);
    await page.getByRole('button', { name: 'Begin Sovereign Foundations' }).click();
    await page.waitForFunction(() => typeof window.__setWarpIntroElapsed === 'function');
    await page.evaluate(() => window.__setWarpIntroElapsed(1_000_000));
    await page.waitForFunction(() => window.__getBootPhase?.() === 'playing', null, { timeout: 10_000 });
    await page.locator('#tutorial-coach').waitFor({ state: 'visible' });
    console.log(`[tutorial-browser] ${engine} first milestone visible`);
    await page.screenshot({ path: path.join(outputDir, `${engine}-01-foundations.png`) });

    const step = async () => page.evaluate(() => window.__getTutorialState().step);
    assert(await step() === 'establish_stronghold', `${engine}: expected establish_stronghold`);
    assert(await page.locator('#tutorial-coach .tutorial-coach__checklist').isVisible(),
      `${engine}: milestone checklist missing`);
    assert(await page.locator('#tutorial-coach details').isVisible(),
      `${engine}: optional explanation disclosure missing`);
    const access = await page.evaluate(() => ({
      technology: window.__tutorialAccess('research'),
      diplomacy: window.__tutorialAccess('diplomacy'),
      operations: window.__tutorialAccess('operations'),
    }));
    assert(Object.values(access).every((entry) => entry.allowed),
      `${engine}: Foundations must guide rather than gate ${JSON.stringify(access)}`);

    const coachBox = await page.locator('#tutorial-coach').boundingBox();
    assert(coachBox.x >= 0 && coachBox.y >= 0, `${engine}: coach escaped viewport`);
    assert(coachBox.x + coachBox.width <= 1280 && coachBox.y + coachBox.height <= 720,
      `${engine}: coach clipped at 1280x720`);

    await page.locator('#command-launcher-btn').evaluate((button) => button.click());
    await page.locator('#command-launcher').waitFor({ state: 'visible' });
    await page.locator('#command-tutorials-btn').evaluate((button) => button.click());
    console.log(`[tutorial-browser] ${engine} library opened`);
    await page.getByRole('dialog', { name: 'Controls & Tutorials' }).waitFor({ state: 'visible' });
    assert(await page.getByText('Enter or leave orbit', { exact: true }).isVisible(), `${engine}: orbit reference missing`);
    await page.getByRole('searchbox').fill('orbit');
    assert(await page.getByText('Enter or leave orbit', { exact: true }).isVisible(), `${engine}: search hid orbit control`);
    await page.screenshot({ path: path.join(outputDir, `${engine}-03-library.png`) });
    await page.getByRole('button', { name: 'Close controls and tutorials' }).click();

    const beforeSkip = await page.evaluate(() => ({
      seed: window.getGameState().seed,
      stronghold: window.getGameState().stronghold,
    }));
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'End guidance' }).click();
    await page.waitForFunction(() => window.__getProfile?.().tutorialProgress?.foundations?.status === 'waived');
    assert(await page.evaluate(() => window.getGameState().campaign.mode) === 'sandbox',
      `${engine}: ending guidance did not release the Foundations campaign`);
    const afterSkip = await page.evaluate(() => ({
      seed: window.getGameState().seed,
      stronghold: window.getGameState().stronghold,
    }));
    assert(JSON.stringify(beforeSkip) === JSON.stringify(afterSkip),
      `${engine}: ending guidance replaced the player's empire`);
    assert(await page.locator('#tutorial-coach').isHidden(), `${engine}: coach remained after guarded skip`);

    assert(errors.length === 0, `${engine}: browser errors\n${errors.join('\n')}`);
    console.log(`[tutorial-browser] ${engine} passed`);
  } finally {
    await browser.close();
  }
}

console.log('Tutorial cross-browser verifier passed', { engines, outputDir });
