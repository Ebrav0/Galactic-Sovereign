// Coach-mark tutorial browser smoke: tip floats near anchors, not a full panel.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'));
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web-game');

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
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    window.__newGame?.(42, { mode: 'tutorial', victoryType: 'sandbox' });
    document.getElementById('title-screen')?.classList.add('hidden');
    document.getElementById('hud')?.classList.remove('hud--boot');
    if (typeof window.__setBootPhase === 'function') window.__setBootPhase('playing');
    else if (window.__getBootPhase) {
      // Force playing via warp skip hooks if present
      const st = window.__getState?.();
      if (st) st.paused = false;
    }
  });
  await page.waitForTimeout(600);

  // Ensure playing HUD without waiting on warp intro
  await page.evaluate(() => {
    document.getElementById('title-screen')?.classList.add('hidden');
    document.getElementById('warp-intro')?.classList.add('hidden');
    const hud = document.getElementById('hud');
    hud?.classList.remove('hud--boot');
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__initTutorial?.();
    window.__setTutorialStep?.(1);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__focusTutorial?.());
  await page.waitForTimeout(500);

  check('old tutorial panel removed', await page.locator('#tutorial-guide').count() === 0);
  check('coach mark present', await page.locator('#tutorial-coach:not(.hidden)').isVisible());

  const coachBox = await page.locator('#tutorial-coach').boundingBox();
  check('coach is compact (not full panel)', !!coachBox && coachBox.width < 340 && coachBox.height < 220,
    coachBox ? `${Math.round(coachBox.width)}x${Math.round(coachBox.height)}` : 'missing');

  const tutorial = await page.evaluate(() => window.__getTutorialState?.());
  check('tutorial active on outpost step', tutorial?.active && tutorial?.step === 1);
  check('coach targets build-outpost-btn', tutorial?.current?.uiTargetId === 'build-outpost-btn');

  const anchored = await page.evaluate(() => {
    const coach = document.getElementById('tutorial-coach');
    const btn = document.getElementById('build-outpost-btn');
    if (!coach || !btn || btn.classList.contains('hidden')) return { ok: false, reason: 'hidden' };
    const highlighted = btn.classList.contains('tutorial-target');
    const c = coach.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const near = Math.abs(c.right - b.left) < 80 || Math.abs(c.left - b.right) < 80
      || Math.abs(c.bottom - b.top) < 80 || Math.abs(c.top - b.bottom) < 80
      || (c.left < b.right + 120 && c.right > b.left - 120 && c.top < b.bottom + 120);
    return { ok: highlighted && near, highlighted, near };
  });
  check('coach floats near highlighted outpost button', anchored.ok, JSON.stringify(anchored));

  await page.screenshot({ path: path.join(OUT, 'tutorial-coach.png'), fullPage: false });

  await page.evaluate(() => window.__setTutorialStep?.(5));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__focusTutorial?.());
  await page.waitForTimeout(400);
  const galaxyStep = await page.evaluate(() => {
    const t = window.__getTutorialState?.();
    const coach = document.getElementById('tutorial-coach');
    return {
      step: t?.step,
      target: t?.current?.uiTargetId,
      visible: !!coach && !coach.classList.contains('hidden'),
    };
  });
  check('galaxy recon step uses tab-galaxy anchor', galaxyStep.step === 5 && galaxyStep.target === 'tab-galaxy');
  check('coach still visible on map step', galaxyStep.visible);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join('; '));

  await browser.close();
} catch (err) {
  console.error(err);
  process.exit(1);
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
