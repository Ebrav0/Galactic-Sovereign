/**
 * Verify Dyson sail particles + foundry supply ties (2026-07-04).
 * Run: node output/verify_dyson_sails.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT_DIR = path.join('output', 'web-game', 'dyson-sails');
const SAIL_LAUNCH_FLIGHT_MS = 900;
const SHELL_SAILS_REQUIRED = 5000;

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

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

async function setupFoundryLauncher() {
  await page.evaluate(() => {
    window.__newGame(42);
    window.getGameState().credits = 15000;
  });
  let s = await text();
  const planetId =
    s.bodies.find((b) => b.canBuildLauncher && b.type === 'habitable')?.id ??
    s.bodies.find((b) => b.canBuildLauncher)?.id ??
    s.bodies[0]?.id;
  await page.evaluate((id) => window.__buildFoundry(id), planetId);
  await page.evaluate((id) => window.__buildLauncher(id), planetId);
  s = await text();
  return { s, planetId, systemId: s.currentSystem };
}

// --- A. Supply tie geometry ---
console.log('\nA. Supply tie geometry');
const { s: s0, planetId, systemId } = await setupFoundryLauncher();
check('A1 one supply line per launcher', s0.dysonVisuals?.supplyLineCount === 1);

const planetPos = await page.evaluate(
  (args) => window.__planetPos(args.systemId, args.planetId),
  { systemId, planetId },
);
const line = s0.dysonVisuals.supplyLines[0];
const fromDist = Math.hypot(line.fromX - planetPos.x, line.fromY - planetPos.y);
check(
  'A2 supply from on foundry ring radius',
  Math.abs(fromDist - s0.dyson.foundryRingRadius) < 2,
);

const dock = s0.dysonVisuals.firstLauncherDock;
check(
  'A3 supply to matches launcher dock',
  Math.hypot(line.toX - dock.x, line.toY - dock.y) < 2,
);

const ln = s0.structureVisuals.launchers[0];
const expectedAngle = Math.atan2(ln.y - planetPos.y, ln.x - planetPos.x);
const actualAngle = Math.atan2(line.fromY - planetPos.y, line.fromX - planetPos.x);
check('A4 closest ring point angle toward launcher', Math.abs(actualAngle - expectedAngle) < 0.05);

const shuttleOnTie = await page.evaluate(() => {
  const shuttles = window.__sailShuttleInfo();
  if (!shuttles.length) return false;
  const sh = shuttles[0];
  const mx = (sh.fromX + sh.toX) / 2;
  const my = (sh.fromY + sh.toY) / 2;
  return window.__pointNearSupplySegment(sh.x, sh.y, sh.fromX, sh.fromY, sh.toX, sh.toY, 12)
    && window.__pointNearSupplySegment(mx, my, sh.fromX, sh.fromY, sh.toX, sh.toY, 12);
});
check('A5 shuttle positions lie on supply tie segment', shuttleOnTie);

// --- B. In-flight sail particles ---
console.log('\nB. In-flight sail particles');
await setupFoundryLauncher();
let s = await text();
check('B1 before fire no in-flight dots', s.dysonVisuals.inFlightDots === 0);

const launcherId = s.dysonVisuals.supplyLines[0].launcherId;
await page.evaluate(
  (id) => {
    const dyson = window.__getDyson();
    dyson.launcherStock[id] = 50;
    dyson.shellSails = 4;
    dyson.launcherLastFireAt[id] = window.getGameState().time - 100;
  },
  launcherId,
);
s = await text();
check('B2 mid-flight shows 4 particles', s.dysonVisuals.inFlightDots === 4);
check(
  'B3 in-flight progress in (0, 1)',
  s.dysonVisuals.inFlightProgress.length === 4
    && s.dysonVisuals.inFlightProgress.every((p) => p > 0 && p < 1),
);

await page.evaluate(
  (id) => {
    window.__getDyson().launcherStock[id] = 0;
  },
  launcherId,
);
await page.evaluate((ms) => window.advanceTime(ms), SAIL_LAUNCH_FLIGHT_MS + 300);
s = await text();
check('B4 flight completes with zero in-flight', s.dysonVisuals.inFlightDots === 0);

await setupFoundryLauncher();
s = await text();
const beforeSettled = s.dysonVisuals.inProgressSettledDots;
const fireLauncherId = s.dysonVisuals.supplyLines[0].launcherId;
await page.evaluate(
  (args) => {
    const dyson = window.__getDyson();
    dyson.shellSails = args.before + 4;
    dyson.launcherLastFireAt[args.id] = window.getGameState().time - 100;
  },
  { id: fireLauncherId, before: beforeSettled },
);
await page.evaluate((ms) => window.advanceTime(ms), SAIL_LAUNCH_FLIGHT_MS + 300);
s = await text();
check(
  'B5 settled dots increased by 4 after flight sequence',
  s.dysonVisuals.inProgressSettledDots === beforeSettled + 4,
);

await page.evaluate(
  (id) => {
    const dyson = window.__getDyson();
    dyson.shellSails = 8;
    dyson.launcherLastFireAt[id] = window.getGameState().time - 50;
  },
  launcherId,
);
s = await text();
const dist0 = s.dysonVisuals.inFlightDistToStar[0];
await page.evaluate(() => window.advanceTime(200));
s = await text();
const dist1 = s.dysonVisuals.inFlightDistToStar[0];
check('B6 in-flight dots move toward star', dist0 != null && dist1 != null && dist1 < dist0);

// --- C. In-progress dot field ---
console.log('\nC. In-progress dot field');
await setupFoundryLauncher();
await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: 120 },
);
s = await text();
check('C1 force 120 sails → 120 settled dots', s.dysonVisuals.inProgressSettledDots === 120);
check('C2 no completed rings at 120 sails', s.dysonVisuals.completedRingCount === 0);

await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: SHELL_SAILS_REQUIRED },
);
s = await text();
check('C3 5000 sails completes shell', s.dysonVisuals.completedRingCount === 1);
check('C4 one completed ring after completion', s.dysonVisuals.completedRingCount === 1);
check('C5 in-progress dots cleared after completion', s.dysonVisuals.inProgressSettledDots === 0);
check(
  'C6 totalDotEquivalent equals inProgressSettledDots',
  s.dysonVisuals.totalDotEquivalent === s.dysonVisuals.inProgressSettledDots,
);

// --- D. Completed shell rings ---
console.log('\nD. Completed shell rings');
await setupFoundryLauncher();
await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: SHELL_SAILS_REQUIRED * 2 },
);
s = await text();
check('D1 two completed shells stack rings', s.dysonVisuals.completedRingCount === 2);
check(
  'D2 clean between shells (0 in-progress dots)',
  s.dysonVisuals.inProgressSettledDots === 0 && s.dysonVisuals.shellSails === 0,
);

await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: 2500 },
);
s = await text();
check(
  'D3 partial third shell hybrid state',
  s.dysonVisuals.inProgressSettledDots === 2500 && s.dysonVisuals.completedRingCount === 2,
);

const radii = s.dysonVisuals.completedRingRadii;
check(
  'D4 completed ring radii increase with tier',
  radii.length === 2 && radii[1] > radii[0],
);

await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: SHELL_SAILS_REQUIRED * 8 },
);
s = await text();
check('D5 eight completed shells, no in-progress dots', s.dysonVisuals.completedRingCount === 8
  && s.dysonVisuals.inProgressSettledDots === 0);

// --- E. LOD / performance ---
console.log('\nE. LOD / performance observables');
await setupFoundryLauncher();
await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: 3000 },
);
await page.evaluate(() => window.__snapCamera(0, 0, 0.38));
s = await text();
check('E1 full dot stride at default zoom', s.dysonVisuals.dotStride === 1);

await page.evaluate(() => window.__snapCamera(0, 0, 0.15));
s = await text();
check('E2 strided dots when zoomed out', s.dysonVisuals.dotStride > 1);
check(
  'E3 settled count honest regardless of stride',
  s.dysonVisuals.inProgressSettledDots === 3000,
);

// --- F. Regression ---
console.log('\nF. Regression');
check('F1 zero console errors during run', errors.length === 0);

await setupFoundryLauncher();
await page.evaluate(
  (args) => window.__forceShellProgress(args.systemId, args.sails),
  { systemId, sails: 1800 },
);
await page.evaluate(() => window.__snapCamera(0, 0, 0.38));
await page.screenshot({ path: path.join(SHOT_DIR, '06-hybrid-rings-dots.png'), fullPage: false });
check('F3 hybrid rings + dots screenshot saved', fs.existsSync(path.join(SHOT_DIR, '06-hybrid-rings-dots.png')));

await browser.close();

console.log(`\nDyson sails: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);

console.log('\nF2 running foundry orbit regression...');
const reg = spawnSync('node', ['output/verify_foundry_orbit.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, GAME_URL: URL },
});
process.stdout.write(reg.stdout ?? '');
process.stderr.write(reg.stderr ?? '');
if (reg.status !== 0) {
  console.log('✗ F2 foundry orbit regression failed');
  process.exit(1);
}
console.log('✓ F2 foundry orbit regression passed');
