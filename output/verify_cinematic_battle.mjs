// Cinematic + large tactical battle verification.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');

const OUT_DIR = path.join(here, 'visuals');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

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

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(314));

const setup = await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  window.__viewSystem(systemId);
  window.__snapCamera(0, 0, 0.62);
  st.credits = 250000;
  st.flagship.systemId = systemId;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;

  for (let i = 0; i < 70; i++) {
    st.playerShips.push({
      id: `cin-corvette-${i}`,
      hull: i % 5 === 0 ? 'destroyer' : 'corvette',
      galaxyId: st.activeGalaxyId,
      systemId,
      hp: i % 5 === 0 ? 350 : 120,
      maxHp: i % 5 === 0 ? 350 : 120,
      transit: null,
      anchorBodyId: null,
    });
  }

  st.pirates.fleets.push({
    id: 'cinematic-swarm',
    galaxyId: st.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: Array.from({ length: 105 }, (_, i) => ({
      id: `cin-pirate-${i}`,
      hull: i % 7 === 0 ? 'frigate' : 'corvette',
      hp: i % 7 === 0 ? 200 : 120,
      maxHp: i % 7 === 0 ? 200 : 120,
    })),
  });

  window.advanceTime(500);
  return JSON.parse(window.render_game_to_text());
});

check('large battle is tactical', setup.battle?.active && setup.battle.mode === 'tactical',
  setup.battle ? `${setup.battle.playerShips}v${setup.battle.enemyShips}` : 'no battle');
check('battle exceeds LOD threshold', (setup.battle?.playerShips ?? 0) + (setup.battle?.enemyShips ?? 0) >= 150);

const advanceMs = await page.evaluate(() => {
  const t0 = performance.now();
  window.advanceTime(5000);
  return performance.now() - t0;
});
check('large battle advanceTime budget', advanceMs < 1800, `${Math.round(advanceMs)}ms for 5s sim`);

await page.screenshot({ path: path.join(OUT_DIR, 'cinematic-large-battle.png'), fullPage: true });
const snap = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
fs.writeFileSync(path.join(OUT_DIR, 'cinematic-large-battle-state.json'), JSON.stringify(snap, null, 2));

check('screenshot state still has ships', (snap.battle?.playerShips ?? 0) > 0 && (snap.battle?.enemyShips ?? 0) > 0);
check('no console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\nCinematic battle: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
