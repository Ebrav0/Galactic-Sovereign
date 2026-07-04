// Visual verification — ship models, shuttle behavior, star/wormhole shaders, redesigned UI.
// Screenshots land in output/visuals/. Uses workspace playwright.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const OUT = path.join(here, 'visuals');
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (name, cond, detail = '') => {
  checks.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`shot ${name}.png`);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await wait(2000);

// ---------- 1. System view baseline (star shader + UI shell) ----------
await shot(page, '01-system-baseline');

// ---------- 2. Build outpost on the habitable planet with moons ----------
const setup = await page.evaluate(() => {
  const state = window.getGameState();
  const home = state.stronghold;
  const sys = state.systems[home];
  const planet = sys.bodies.find((b) => b.type === 'habitable' && b.moons.length > 0)
    ?? sys.bodies.find((b) => b.moons.length > 0);
  if (!planet) return { ok: false };
  state.credits = 5000;
  const res = window.__buildOutpost(planet.id);
  return { ok: res.ok, planetId: planet.id, moons: planet.moons.length, home };
});
check('outpost built for shuttles', setup.ok, `${setup.planetId} (${setup.moons} moons)`);

// ---------- 3. Shuttle lifecycle: sample phases across a full cycle ----------
const phases = new Set();
let sawDwellMoon = false;
let sawWingsOut = false;
let sawWingsFolded = false;
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.advanceTime(400));
  const info = await page.evaluate((sid) => window.__shuttleInfo(sid), setup.home);
  for (const s of info) {
    phases.add(s.phase);
    if (s.phase === 'dwell-moon') sawDwellMoon = true;
    if (s.wingSpread > 0.9) sawWingsOut = true;
    if (s.wingSpread === 0) sawWingsFolded = true;
  }
}
check('shuttle full cycle phases', ['outbound', 'dwell-moon', 'return', 'dwell-planet'].every((p) => phases.has(p)), [...phases].join(', '));
check('shuttle dwells on moon', sawDwellMoon);
check('shuttle wings animate (deployed + folded)', sawWingsOut && sawWingsFolded);

// Dwell duration ≈ 2.5s: step in 250ms increments and count consecutive dwell-moon.
let dwellMs = 0;
let inDwell = false;
for (let i = 0; i < 60; i++) {
  await page.evaluate(() => window.advanceTime(250));
  const info = await page.evaluate((sid) => window.__shuttleInfo(sid), setup.home);
  const first = info[0];
  if (first?.phase === 'dwell-moon') {
    inDwell = true;
    dwellMs += 250;
  } else if (inDwell) break;
}
check('moon dwell lasts 2-3s', dwellMs >= 2000 && dwellMs <= 3250, `${dwellMs}ms`);

// ---------- 4. Zoom onto the shuttle planet mid-flight ----------
await page.evaluate(async (args) => {
  // Advance until a shuttle is outbound mid-flight (wings deployed).
  for (let i = 0; i < 80; i++) {
    const info = window.__shuttleInfo(args.home);
    const flying = info.find((s) => s.phase === 'outbound' && s.wingSpread > 0.9);
    if (flying) {
      window.__snapCamera(flying.x, flying.y, 3.2);
      return;
    }
    await window.advanceTime(150);
  }
}, { home: setup.home });
await wait(400);
await shot(page, '02-shuttle-flight-closeup');

// Parked on the moon.
await page.evaluate(async (args) => {
  for (let i = 0; i < 80; i++) {
    const info = window.__shuttleInfo(args.home);
    const parked = info.find((s) => s.phase === 'dwell-moon');
    if (parked) {
      window.__snapCamera(parked.x, parked.y, 3.2);
      return;
    }
    await window.advanceTime(150);
  }
}, { home: setup.home });
await wait(400);
await shot(page, '03-shuttle-parked-moon');

// ---------- 5. Flagship closeup with thrust ----------
await page.evaluate(() => window.__setFlagshipInput(1, 0.2));
await page.evaluate(() => window.advanceTime(400));
await page.evaluate(() => {
  const f = window.getGameState().flagship;
  window.__snapCamera(f.x, f.y, 3.4);
});
await shot(page, '04-flagship-thrust-closeup');
await page.evaluate(() => window.__setFlagshipInput(0, 0));

// ---------- 6. Combat hull lineup (inject ships anchored to the outpost planet) ----------
await page.evaluate((args) => {
  const state = window.getGameState();
  const home = state.stronghold;
  const hulls = ['corvette', 'frigate', 'destroyer', 'cruiser', 'light_carrier', 'healer'];
  hulls.forEach((hull) => {
    state.playerShips.push({
      id: `viz-${hull}`,
      hull,
      hp: 100,
      maxHp: 100,
      systemId: home,
      transit: null,
      anchorBodyId: args.planetId,
    });
  });
}, { planetId: setup.planetId });
await page.evaluate(() => window.advanceTime(400));
await page.evaluate((args) => {
  const p = window.__planetPos(args.home, args.planetId);
  window.__snapCamera(p.x, p.y, 1.6);
}, { home: setup.home, planetId: setup.planetId });
await wait(300);
await shot(page, '05-fleet-formation');

await page.evaluate((args) => {
  const p = window.__planetPos(args.home, args.planetId);
  window.__snapCamera(p.x, p.y - 90, 3.4);
}, { home: setup.home, planetId: setup.planetId });
await wait(300);
await shot(page, '06-fleet-closeup');

// ---------- 7. Star closeup (cinematic shader: embers, streamers, prominences) ----------
await page.evaluate(() => window.__snapCamera(0, 0, 1.15));
await wait(600);
await shot(page, '07-star-closeup');

// ---------- 8. Galaxy view ----------
await page.keyboard.press('m');
await wait(600);
await shot(page, '08-galaxy-map');

// ---------- 9. Wormhole closeup on galaxy map ----------
await page.evaluate(() => {
  const bh = window.getGameState().galaxy.blackHole;
  window.__snapGalaxyCamera(bh.x, bh.y, 2.1);
});
await wait(700);
await shot(page, '09-wormhole-closeup');

// ---------- 10. Wormhole system view (large) ----------
await page.evaluate(() => {
  const bh = window.getGameState().galaxy.blackHole;
  window.__gatherIntel(bh.id);
  window.__viewSystem(bh.id);
  window.__snapCamera(0, 0, 1.1);
});
await wait(700);
await shot(page, '10-wormhole-system-view');

// ---------- 11. UI: build panel + intel panels ----------
await page.evaluate((args) => {
  window.__viewSystem(args.home);
  window.__selectPlanet(args.planetId);
  window.__snapCamera(0, 0, 0.5);
}, { home: setup.home, planetId: setup.planetId });
await wait(500);
check('build panel visible', await page.locator('#build-panel').isVisible());
check('intel panel visible', await page.locator('#intel-panel').isVisible());
await shot(page, '11-ui-panels');

// ---------- 12. UI: save menu modal ----------
await page.click('#save-menu-btn');
const saveMenuOk = await page
  .waitForSelector('#save-menu:not(.hidden)', { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
await wait(800);
check('save modal opens', saveMenuOk);
await shot(page, '12-ui-save-menu');
await page.click('#close-save-menu-btn');

// ---------- 13. UI: pause overlay ----------
await page.keyboard.press('Space');
const pauseOk = await page
  .waitForSelector('#pause-overlay:not(.hidden)', { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
await wait(400);
check('pause overlay', pauseOk);
await shot(page, '13-ui-pause');
await page.keyboard.press('Space');

// ---------- 14. Comms log receives entries ----------
const logCount = await page.evaluate(() => document.querySelectorAll('#notification-log-body .log-entry').length);
check('comms log has entries', logCount > 0, `${logCount} entries`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
