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

// --- Surface landing pads & moon mining rigs ---
await page.evaluate(() => window.__newGame(42));
s = await text();
const outpostPlanet = s.bodies.find((b) => b.moonCount > 0 && b.canBuildOutpost);
check('habitable planet with moons for outpost', !!outpostPlanet);
if (outpostPlanet) {
  const built = await page.evaluate((id) => window.__buildOutpost(id), outpostPlanet.id);
  check('outpost build succeeds', built.ok);
  s = await text();
  const moons = outpostPlanet.moonCount;
  const body = s.bodies.find((b) => b.id === outpostPlanet.id);
  check('outpost on planet', body?.hasOutpost === true);
  check('surface sites per moon (pad+pad+rig)', s.surfaceSites.count === moons * 3);
  check('landing pads present', s.surfaceSites.pads === moons * 2);
  check('mining rigs present', s.surfaceSites.rigs === moons);
  check('shuttles match moon count', s.shuttles.count === moons && s.shuttles.active);
  check('some surface sites lit active', s.surfaceSites.active > 0);
  await page.screenshot({ path: path.join(SHOT_DIR, '04-surface-pads-rigs.png'), fullPage: false });
}

// --- Orbital shipyard + sail launcher ---
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  window.getGameState().credits = 8000;
});
s = await text();
const buildPlanet =
  s.bodies.find((b) => b.canBuildShipyard && b.type === 'habitable') ??
  s.bodies.find((b) => b.canBuildShipyard);
check('planet available for shipyard', !!buildPlanet);

const shipyardBuilt = await page.evaluate((id) => window.__buildShipyard(id), buildPlanet.id);
check('shipyard build succeeds', shipyardBuilt.ok);
s = await text();
check('one shipyard visual site', s.structureVisuals.shipyards.length === 1);

let planetWorld = await page.evaluate((id) => {
  const st = window.getGameState();
  const p = st.systems[st.stronghold].bodies.find((b) => b.id === id);
  const a = 2 * Math.PI * (p.orbitPhase + st.time / p.orbitPeriodMs);
  return { x: Math.cos(a) * p.orbitRadius, y: Math.sin(a) * p.orbitRadius, radius: p.radius };
}, buildPlanet.id);

const sy = s.structureVisuals.shipyards[0];
const syDist = Math.hypot(sy.x - planetWorld.x, sy.y - planetWorld.y);
check('shipyard in orbit not at center', syDist > planetWorld.radius * 1.2);

const queued = await page.evaluate((id) => {
  const st = window.getGameState();
  const yard = st.systems[st.stronghold].structures.find((s) => s.type === 'shipyard' && s.bodyId === id);
  return window.__queueScout(yard.id);
}, buildPlanet.id);
check('queue scout ok', queued.ok);
s = await text();
check('shipyard building hull', s.structureVisuals.shipyards[0].building === true);
await page.evaluate(() => window.advanceTime(4000));
s = await text();
check('shipyard build progress increases', s.structureVisuals.shipyards[0].buildProgress > 0.15);

await page.evaluate(() => {
  window.getGameState().credits = 15000;
});
await page.evaluate((id) => window.__buildFoundry(id), buildPlanet.id);
const launcherBuilt = await page.evaluate((id) => window.__buildLauncher(id), buildPlanet.id);
check('launcher build succeeds', launcherBuilt.ok);
s = await text();
check('one launcher visual site', s.structureVisuals.launchers.length === 1);

planetWorld = await page.evaluate((id) => {
  const st = window.getGameState();
  const p = st.systems[st.stronghold].bodies.find((b) => b.id === id);
  const a = 2 * Math.PI * (p.orbitPhase + st.time / p.orbitPeriodMs);
  return { x: Math.cos(a) * p.orbitRadius, y: Math.sin(a) * p.orbitRadius, radius: p.radius };
}, buildPlanet.id);

const ln = s.structureVisuals.launchers[0];
const lnDist = Math.hypot(ln.x - planetWorld.x, ln.y - planetWorld.y);
check('launcher in orbit not at center', lnDist > planetWorld.radius * 1.2);
check(
  'muzzle closer to star than platform',
  Math.hypot(ln.muzzleX, ln.muzzleY) < Math.hypot(ln.x, ln.y),
);
check(
  'launcher heading toward star',
  Math.abs(ln.heading - Math.atan2(-ln.y, -ln.x)) < 0.05,
);

const slotAngle = ln.slotAngle;
const orbitOffset = lnDist;
await page.evaluate(() => window.advanceTime(5000));
s = await text();
planetWorld = await page.evaluate((id) => {
  const st = window.getGameState();
  const p = st.systems[st.stronghold].bodies.find((b) => b.id === id);
  const a = 2 * Math.PI * (p.orbitPhase + st.time / p.orbitPeriodMs);
  return { x: Math.cos(a) * p.orbitRadius, y: Math.sin(a) * p.orbitRadius, radius: p.radius };
}, buildPlanet.id);
const ln2 = s.structureVisuals.launchers[0];
const lnDist2 = Math.hypot(ln2.x - planetWorld.x, ln2.y - planetWorld.y);
check('launcher slot angle stable', Math.abs(ln2.slotAngle - slotAngle) < 0.001);
check('launcher orbit radius stable', Math.abs(lnDist2 - orbitOffset) < 1);

await page.evaluate(() => {
  const st = window.getGameState();
  const sys = st.systems[st.stronghold];
  const launcher = sys.structures.find((s) => s.type === 'dyson_launcher');
  sys.dyson.launcherStock[launcher.id] = 50;
  sys.dyson.launcherLastFireAt[launcher.id] = st.time - 200;
});
s = await text();
check('launcher firing flash active', s.structureVisuals.launchers[0].firing === true);

await page.screenshot({ path: path.join(SHOT_DIR, '05-shipyard-launcher.png'), fullPage: false });

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
