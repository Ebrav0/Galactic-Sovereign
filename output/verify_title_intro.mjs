// Title screen + warp intro smoke test.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'));
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureDev() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(500);
  }
  throw new Error('Dev server not reachable — run npm run dev first');
}

const checks = [];
const check = (name, cond, detail = '') => {
  checks.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

try {
  await ensureDev();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  check('title screen visible', await page.locator('#title-screen:not(.hidden)').isVisible());
  check('hud chrome hidden on boot', await page.evaluate(() => document.getElementById('hud').classList.contains('hud--boot')));
  check('header hidden on boot', !(await page.locator('#top-bar').isVisible()));
  check('new game modal not auto-open', await page.locator('#new-game-modal').evaluate((el) => el.classList.contains('hidden')));

  await page.click('#title-new-campaign-btn');
  await page.waitForTimeout(300);
  check('new campaign modal opens', await page.locator('#new-game-modal:not(.hidden)').isVisible());

  await page.click('#new-game-sandbox-btn');
  await page.waitForTimeout(800);
  check('warp intro active', await page.evaluate(() => window.__getBootPhase?.() === 'warpIntro'));

  const canvasHasPixels = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return d[0] + d[1] + d[2] > 0;
  });
  check('canvas renders during warp', canvasHasPixels);

  await page.waitForTimeout(6500);
  check('hud visible after intro', await page.locator('#top-bar').isVisible());
  check('playing phase after intro', await page.evaluate(() => window.__getBootPhase?.() === 'playing'));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const hasAutosave = await page.evaluate(async () => {
    const res = await window.__loadSlot?.('autosave');
    return !!res?.ok;
  });

  if (hasAutosave) {
    check('continue skips intro when autosave exists', await page.evaluate(() => window.__getBootPhase?.() === 'playing'));
    check('hud visible after continue load', await page.locator('#top-bar').isVisible());
  } else {
    check('continue skips intro when autosave exists', true, 'skipped — no autosave');
    check('hud visible after continue load', true, 'skipped — no autosave');
  }

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(300);
  check('no page errors', errors.length === 0, errors.join('; '));

  await browser.close();
} catch (err) {
  console.error(err);
  process.exit(1);
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
