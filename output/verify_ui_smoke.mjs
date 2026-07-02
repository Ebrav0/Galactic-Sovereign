// UI smoke test — uses workspace playwright (verify_phase1.mjs needs skill path).
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
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  check('page loads', await page.title() === 'Galactic Sovereign');
  check('tokens.css linked', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim() === '#05070f'));
  check('header visible', await page.locator('#top-bar').isVisible());
  check('tab bar present', await page.locator('#tab-bar').isVisible());
  check('tab stub disabled count', (await page.locator('.tab--disabled').count()) === 3);
  check('canvas renders', await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    return c.width > 0 && c.height > 0;
  }));

  await page.click('#save-menu-btn');
  await page.waitForSelector('#save-menu:not(.hidden)', { timeout: 3000 });
  check('save modal opens', await page.locator('#save-menu').isVisible() && await page.locator('#save-menu-backdrop').isVisible());
  await page.click('#close-save-menu-btn');

  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  check('pause overlay', await page.locator('#pause-overlay').isVisible());
  await page.keyboard.press('Space');

  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  check('galaxy tab active after M', await page.evaluate(() => document.getElementById('tab-galaxy').classList.contains('tab--active')));

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(500);
  check('no page errors', errors.length === 0, errors.join('; '));

  await browser.close();
} catch (err) {
  console.error(err);
  process.exit(1);
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
