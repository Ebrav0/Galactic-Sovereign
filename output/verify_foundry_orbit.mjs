/**
 * Verify Sail Foundry ring station + flagship stable orbit (2026-07-04).
 * Run: node output/verify_foundry_orbit.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT_DIR = path.join('output', 'web-game', 'foundry-orbit');

let passed = 0;
let failed = 0;
function check(label, ok) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(42));

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

// --- Orbit ---
await page.evaluate(() => {
  const st = window.getGameState();
  const planet = st.systems[st.stronghold].bodies.find((b) => b.moons?.length) ?? st.systems[st.stronghold].bodies[0];
  window.__selectPlanet(planet.id);
  const a = 2 * Math.PI * (planet.orbitPhase + st.time / planet.orbitPeriodMs);
  const px = Math.cos(a) * planet.orbitRadius;
  const py = Math.sin(a) * planet.orbitRadius;
  const nearR = planet.moons?.[0]?.orbitRadius ? planet.moons[0].orbitRadius * 0.45 : 120;
  st.flagship.x = px + nearR;
  st.flagship.y = py;
  st.flagship.vx = 0;
  st.flagship.vy = 0;
  st.flagship.orbit = null;
});

const orbitEnter = await page.evaluate(() => window.__toggleOrbit());
check('orbit enter succeeds', orbitEnter.ok && orbitEnter.orbiting);

let s = await text();
check('flagship orbiting in text state', s.flagship.orbiting === true);

const pose0 = await page.evaluate(() => {
  const st = window.getGameState();
  return { x: st.flagship.x, y: st.flagship.y, heading: st.flagship.heading };
});
await page.evaluate(() => window.advanceTime(3000));
const pose1 = await page.evaluate(() => {
  const st = window.getGameState();
  return { x: st.flagship.x, y: st.flagship.y, heading: st.flagship.heading };
});
const moved = Math.hypot(pose1.x - pose0.x, pose1.y - pose0.y);
check('orbit moves flagship over 3s', moved > 5);
check('orbit updates heading', Math.abs(pose1.heading - pose0.heading) > 0.05);

const orbitExit = await page.evaluate(() => window.__toggleOrbit());
check('orbit toggle off', orbitExit.ok && !orbitExit.orbiting);

await page.screenshot({ path: path.join(SHOT_DIR, '01-orbit-system.png'), fullPage: false });

// --- Foundry ring ---
await page.evaluate(() => {
  window.getGameState().credits = 12000;
});
s = await text();
const planetId = s.bodies.find((b) => b.moonCount > 0)?.id ?? s.bodies[0]?.id;
await page.evaluate((id) => window.__selectPlanet(id), planetId);

const foundry = await page.evaluate((id) => window.__buildFoundry(id), planetId);
check('foundry build succeeds', foundry.ok);

s = await text();
check('foundry has host planet', s.dyson.foundryHostPlanetId === planetId);
check('foundry ring inside first moon orbit', s.dyson.foundryRingRadius + 12 < s.dyson.firstMoonOrbit);
check('foundry ring clears planet surface', s.dyson.foundryRingRadius > 40);

const dock0 = s.dyson.foundryDock;
await page.evaluate(() => window.advanceTime(4000));
s = await text();
const dock1 = s.dyson.foundryDock;
const dockMoved = Math.hypot(dock1.x - dock0.x, dock1.y - dock0.y);
check('foundry ring animates (dock moves)', dockMoved > 2);

await page.screenshot({ path: path.join(SHOT_DIR, '02-foundry-rings.png'), fullPage: false });

// --- Playwright action burst (O key) ---
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  const planet = st.systems[st.stronghold].bodies.find((b) => b.moons?.length) ?? st.systems[st.stronghold].bodies[0];
  window.__selectPlanet(planet.id);
  const a = 2 * Math.PI * (planet.orbitPhase + st.time / planet.orbitPeriodMs);
  const px = Math.cos(a) * planet.orbitRadius;
  const py = Math.sin(a) * planet.orbitRadius;
  st.flagship.x = px + 90;
  st.flagship.y = py;
  st.flagship.orbit = null;
});
await page.keyboard.press('KeyO');
await page.waitForTimeout(400);
s = await text();
check('KeyO enters orbit', s.flagship.orbiting === true);

await page.screenshot({ path: path.join(SHOT_DIR, '03-keyboard-orbit.png'), fullPage: false });

check('no console errors', errors.length === 0);
if (errors.length) console.log('Console errors:', errors.slice(0, 5));

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`Screenshots: ${SHOT_DIR}/`);
process.exit(failed > 0 ? 1 : 0);
