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

    console.log(`[tutorial-browser] ${engine} starting Academy`);
    await page.getByRole('button', { name: /Single Player/ }).click();
    await page.getByRole('button', { name: 'Begin Academy' }).click();
    await page.waitForFunction(() => typeof window.__setWarpIntroElapsed === 'function');
    await page.evaluate(() => window.__setWarpIntroElapsed(1_000_000));
    await page.waitForFunction(() => window.__getBootPhase?.() === 'playing', null, { timeout: 10_000 });
    await page.locator('#tutorial-coach').waitFor({ state: 'visible' });
    console.log(`[tutorial-browser] ${engine} orientation visible`);
    await page.screenshot({ path: path.join(outputDir, `${engine}-01-orientation.png`) });

    const step = async () => page.evaluate(() => window.__getTutorialState().step);
    assert(await step() === 'command_overview', `${engine}: expected command_overview`);
    await page.getByRole('button', { name: 'Toggle notifications' }).click();
    assert(await step() === 'time_controls', `${engine}: notification event did not advance`);

    await page.locator('#pause-btn').click();
    assert(await step() === 'time_controls', `${engine}: pause must not advance until resumed`);
    assert(await page.evaluate(() => window.getGameState().paused) === true, `${engine}: did not pause`);
    await page.keyboard.press('Space');
    assert(await step() === 'movement', `${engine}: resume did not advance`);
    assert(await page.evaluate(() => window.getGameState().paused) === false, `${engine}: did not resume`);

    await page.keyboard.press('ArrowRight');
    assert(await step() === 'select_orbit_body', `${engine}: movement did not advance`);
    await page.getByRole('button', { name: 'Show orbit world' }).click();
    console.log(`[tutorial-browser] ${engine} orbit target framed`);
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    assert(box, `${engine}: canvas unavailable`);
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.25);
    assert(await step() === 'enter_orbit', `${engine}: framed planet was not selectable`);
    await page.screenshot({ path: path.join(outputDir, `${engine}-02-orbit-target.png`) });

    await page.keyboard.press('o');
    assert(await step() === 'exit_orbit', `${engine}: orbit entry did not advance`);
    assert(await page.evaluate(() => !!window.getGameState().flagship.orbit), `${engine}: orbit state missing`);
    await page.keyboard.press('o');
    assert(await step() === 'camera_pan', `${engine}: orbit exit did not advance`);

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45, { steps: 3 });
    await page.mouse.up();
    assert(await step() === 'camera_zoom', `${engine}: camera pan did not advance`);
    await page.mouse.wheel(0, -180);
    assert(await step() === 'camera_follow', `${engine}: zoom did not advance`);
    await page.keyboard.press('f');
    assert(await step() === 'galaxy_view', `${engine}: follow did not advance`);
    await page.keyboard.press('m');
    assert(await step() === 'inspect_star', `${engine}: Galaxy view did not advance`);

    await page.getByRole('button', { name: 'Show neighboring star' }).click();
    const galaxyBox = await canvas.boundingBox();
    await page.mouse.dblclick(
      galaxyBox.x + galaxyBox.width * 0.62,
      galaxyBox.y + galaxyBox.height * 0.35,
      { delay: 70 },
    );
    assert(await step() === 'map_ping', `${engine}: double-click inspect did not advance`);
    await page.keyboard.press('p');
    assert(await step() === 'system_return', `${engine}: training ping did not advance`);
    await page.keyboard.press('m');
    await page.getByRole('button', { name: 'Return home' }).click();
    assert(await step() === 'resources_costs', `${engine}: Stronghold recovery did not advance`);
    await page.getByRole('button', { name: 'Explain credits and income' }).click();
    const afterResources = await step();
    assert(afterResources === 'build_outpost', `${engine}: resource explanation did not advance (at ${afterResources})`);

    const coachBox = await page.locator('#tutorial-coach').boundingBox();
    assert(coachBox.x >= 0 && coachBox.y >= 0, `${engine}: coach escaped viewport`);
    assert(coachBox.x + coachBox.width <= 1280 && coachBox.y + coachBox.height <= 720,
      `${engine}: coach clipped at 1280x720`);

    await page.locator('#tutorial-library-btn').click();
    console.log(`[tutorial-browser] ${engine} library opened`);
    await page.getByRole('dialog', { name: 'Controls & Tutorials' }).waitFor({ state: 'visible' });
    assert(await page.getByText('Enter or leave orbit', { exact: true }).isVisible(), `${engine}: orbit reference missing`);
    await page.getByRole('searchbox').fill('orbit');
    assert(await page.getByText('Enter or leave orbit', { exact: true }).isVisible(), `${engine}: search hid orbit control`);
    await page.screenshot({ path: path.join(outputDir, `${engine}-03-library.png`) });
    await page.getByRole('button', { name: 'Close controls and tutorials' }).click();

    const guardedSkip = page.locator('.tutorial-coach__hold');
    await guardedSkip.dispatchEvent('pointerdown', { pointerId: 1 });
    await page.waitForFunction(() => window.__getProfile?.().tutorialProgress?.foundations?.status === 'waived');
    assert(await page.evaluate(() => window.getGameState().campaign.mode) === 'sandbox',
      `${engine}: guarded skip did not release the Academy campaign`);
    assert(await page.locator('#tutorial-coach').isHidden(), `${engine}: coach remained after guarded skip`);

    assert(errors.length === 0, `${engine}: browser errors\n${errors.join('\n')}`);
    console.log(`[tutorial-browser] ${engine} passed`);
  } finally {
    await browser.close();
  }
}

console.log('Tutorial cross-browser verifier passed', { engines, outputDir });
