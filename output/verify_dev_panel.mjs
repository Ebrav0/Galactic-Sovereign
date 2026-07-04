// Dev panel verification — cheats, autobuild, spawn, validation.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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
const devAction = (action, params = {}) =>
  page.evaluate(({ action, params }) => window.__devAction(action, params), { action, params });

// --- Dev panel toggle ---
check('__toggleDevPanel exists', await page.evaluate(() => typeof window.__toggleDevPanel === 'function'));
check('__devAction exists', await page.evaluate(() => typeof window.__devAction === 'function'));
await page.evaluate(() => window.__toggleDevPanel());
check('dev panel visible', await page.locator('#dev-panel').isVisible());
await page.evaluate(() => window.__toggleDevPanel());
check('dev panel hidden after toggle', await page.locator('#dev-panel').isHidden());

// --- Positive: grant credits ---
let s = await text();
const creditsBefore = s.credits;
let res = await page.evaluate(() => window.__grantCredits(5000));
check('grant credits returns new total', res === creditsBefore + 5000, `res=${res}`);
s = await text();
check('credits increased by 5000', s.credits === creditsBefore + 5000, `credits=${s.credits}`);

// --- Positive: planet kit ---
const habitable = s.bodies.find((b) => b.type === 'habitable');
await page.evaluate((id) => window.__selectPlanet(id), habitable.id);
res = await devAction('buildPlanetKit', {});
check('planet kit ok', res.ok === true, res.reason ?? JSON.stringify(res.details));
s = await text();
check('planet kit outpost', s.structures.some((st) => st.type === 'outpost' && st.bodyId === habitable.id));
check('planet kit shipyard', s.structures.some((st) => st.type === 'shipyard' && st.bodyId === habitable.id));

// --- Idempotent kit ---
const structCount = s.structures.length;
res = await devAction('buildPlanetKit', {});
check('idempotent kit ok', res.ok === true);
check('idempotent kit skipped', (res.details?.skipped?.length ?? 0) > 0, JSON.stringify(res.details?.skipped));
s = await text();
check('no duplicate structures', s.structures.length === structCount, `count=${s.structures.length}`);

// --- Positive: friendly spawn ---
const shipsBefore = s.playerShips?.length ?? 0;
res = await devAction('spawnFriendly', { hull: 'corvette', count: 3 });
check('spawn friendly ok', res.ok === true, res.reason);
s = await text();
check('friendly ships +3', s.playerShips.length === shipsBefore + 3, `count=${s.playerShips.length}`);
check('friendly full hp',
  s.playerShips.every((sh) => sh.hp === sh.maxHp && sh.systemId === s.currentSystem));

// --- Positive: enemy spawn ---
res = await devAction('spawnEnemyFleet', {});
check('spawn enemy ok', res.ok === true, res.reason);
s = await text();
check('enemy in viewed system', s.pirates.inViewedSystem === true);
check('enemy ship count > 0',
  s.pirates.fleets.some((f) => f.systemId === s.currentSystem && f.shipCount > 0));

// --- Battle trigger ---
check('battle active after spawns', s.battle?.active === true, JSON.stringify(s.battle));

// --- Negative: invalid system ---
res = await devAction('revealIntel', { systemId: 'nope' });
check('invalid system rejected', res.ok === false && res.code === 'INVALID_SYSTEM', res.code);

// --- Negative: invalid hull ---
res = await devAction('spawnFriendly', { hull: 'cruiser', count: 1 });
check('invalid hull rejected', res.ok === false && res.code === 'INVALID_HULL', res.code);

// --- Negative: invalid count ---
res = await devAction('spawnFriendly', { hull: 'corvette', count: 0 });
check('count zero rejected', res.ok === false && res.code === 'INVALID_COUNT', res.code);

// --- Negative: force capture on owned system ---
res = await devAction('forceCapture', { systemId: s.strongholdSystem });
check('capture owned rejected', res.ok === false && res.code === 'ALREADY_OWNED', res.code);

// --- Negative: launcher without foundry ---
const gas = s.bodies.find((b) => b.type === 'gas');
if (gas) {
  res = await devAction('forceBuildLauncher', { bodyId: gas.id });
  check('launcher without foundry rejected', res.ok === false && res.code === 'NO_FOUNDRY', res.code);
} else {
  check('launcher without foundry rejected', true, 'no gas planet (skip)');
}

// --- Negative: outpost on gas ---
if (gas) {
  res = await devAction('forceBuildOutpost', { planetId: gas.id });
  check('outpost on gas rejected', res.ok === false && res.code === 'UNSUPPORTED_PLANET_TYPE', res.code);
} else {
  check('outpost on gas rejected', true, 'no gas planet (skip)');
}

// --- Duplicate foundry skip ---
res = await devAction('forceBuildFoundry', { planetId: habitable.id });
check('duplicate foundry skipped or ok', res.ok === true && (res.details?.skipped || res.details?.built),
  JSON.stringify(res.details));

// --- Dyson kit ---
res = await devAction('buildDysonKit', {});
check('dyson kit ok', res.ok === true, JSON.stringify(res.details));
s = await text();
check('foundry after dyson kit', s.structures.some((st) => st.type === 'sail_foundry'));
const state = await page.evaluate(() => window.getGameState());
const sys = state.systems[s.currentSystem];
const launcher = sys.structures.find((st) => st.type === 'dyson_launcher');
check('launcher after dyson kit', !!launcher);
check('launcher stock initialized', launcher && sys.dyson?.launcherStock?.[launcher.id] != null);

// --- Regression ---
check('__setEnemyPresence undefined', await page.evaluate(() => window.__setEnemyPresence === undefined));

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
