// Phase 0 verification script (test artifact, not shipped game code).
import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/');
const { chromium } = require('playwright');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('http://localhost:5173');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

// --- 1. Initial state ---
let s = await text();
check('starts with 500 credits', s.credits === 500, `credits=${s.credits}`);
check('stronghold flagged', s.strongholdSystem === 'sys-home');
check('has a habitable planet', s.bodies.some((b) => b.type === 'habitable' && b.moonCount > 0));
check('no income before outpost', s.incomePerSec === 0);

// --- 2. Build outpost via UI click on the planet, then panel button ---
const habitable = s.bodies.find((b) => b.type === 'habitable' && b.moonCount > 0);
await page.evaluate((id) => window.__selectPlanet(id), habitable.id);
await page.waitForTimeout(150);
s = await text();
check('planet selectable', s.selection === habitable.id);
const btnEnabled = await page.locator('#build-outpost-btn').isEnabled();
check('build button enabled for habitable', btnEnabled);
await page.click('#build-outpost-btn');
s = await text();
check('outpost built', s.structures.some((st) => st.type === 'outpost' && st.bodyId === habitable.id));
check('credits deducted (500-300=200)', Math.floor(s.credits) === 200, `credits=${s.credits}`);
const expectedIncome = 2 * (1 + 0.5 * habitable.moonCount);
check('income scales with moons', Math.abs(s.incomePerSec - expectedIncome) < 1e-9,
  `income=${s.incomePerSec} expected=${expectedIncome} moons=${habitable.moonCount}`);
check('shuttles active', s.shuttles.count === habitable.moonCount, `count=${s.shuttles.count}`);

// --- 3. advanceTime produces exact income ---
const before = s.credits;
await page.evaluate(() => window.advanceTime(60000));
s = await text();
const earned = s.credits - before;
check('advanceTime(60s) earns income*60', Math.abs(earned - expectedIncome * 60) < 1e-6,
  `earned=${earned}`);

// --- 4. Pause halts income and advanceTime ---
await page.keyboard.press('Space');
s = await text();
check('Space pauses', s.paused === true);
const pausedCredits = s.credits;
await page.evaluate(() => window.advanceTime(60000));
await page.waitForTimeout(300);
s = await text();
check('paused advanceTime is no-op', s.credits === pausedCredits && s.paused === true,
  `credits=${s.credits}`);
const overlayVisible = await page.locator('#pause-overlay').isVisible();
check('pause overlay visible', overlayVisible);
await page.keyboard.press('Space');
s = await text();
check('Space resumes', s.paused === false);

// --- 5. Save / load round trip (browser localStorage fallback) ---
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.waitForTimeout(200);
const savedCredits = (await text()).credits;
await page.evaluate(() => { window.getGameState().credits = 99999; });
await page.evaluate(() => window.__loadSlot('slot-1'));
await page.waitForTimeout(200);
s = await text();
check('save/load restores credits', Math.abs(s.credits - savedCredits) < 1,
  `restored=${s.credits} saved=${savedCredits}`);
check('save/load restores structures', s.structures.length === 1);

// --- 6. Determinism: fresh page, same seed, same actions => same output ---
async function deterministicRun() {
  const p = await browser.newPage();
  await p.goto('http://localhost:5173');
  await p.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await p.evaluate((id) => window.__buildOutpost(id), habitable.id);
  await p.evaluate(() => window.advanceTime(30000));
  const out = await p.evaluate(() => {
    const o = JSON.parse(window.render_game_to_text());
    return JSON.stringify({ time: o.time, credits: o.credits, bodies: o.bodies, structures: o.structures });
  });
  await p.close();
  return out;
}
const runA = await deterministicRun();
const runB = await deterministicRun();
check('deterministic: identical runs', runA === runB);

// --- 7. Gas/barren rejection ---
const nonHab = (await text()).bodies.find((b) => b.type !== 'habitable');
if (nonHab) {
  const res = await page.evaluate((id) => window.__buildOutpost(id), nonHab.id);
  check('non-habitable rejected', res.ok === false, res.reason);
} else {
  check('non-habitable rejected', true, 'no non-habitable planet in this seed (skip)');
}

// --- 8. Screenshot with outpost + shuttles for visual inspection ---
await page.evaluate(() => window.advanceTime(5000));
await page.waitForTimeout(400);
await page.screenshot({ path: 'output/web-game/verify-final.png' });

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
