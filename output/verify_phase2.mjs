// Phase 2 verification: combat hybrid, save-v3, fleet transit, capture E2E.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const skillRequire = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/');
let chromium;
try {
  ({ chromium } = skillRequire('playwright'));
} catch {
  ({ chromium } = createRequire(path.join(__dir, '../package.json'))('playwright'));
}

const AUTO_RESOLVE_MS = 8000;
const CAPTURE_HOLD_MS = 20000;
const TICK_MS = 50;

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (str) => {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) crc = CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('http://localhost:5173');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

// --- 1. save-v3 baseline ---
let s = await text();
check('1.1 flagship has hp', s.flagship.hp != null && s.flagship.maxHp != null,
  `hp=${s.flagship.hp}/${s.flagship.maxHp}`);
check('1.2 ships array present', Array.isArray(s.ships), `len=${s.ships?.length}`);
check('1.3 garrison object present', typeof s.garrison === 'object');
check('1.4 combat observability', typeof s.combat === 'object');
check('1.5 fleet summary', s.fleet && typeof s.fleet.totalShips === 'number');

const home = s.strongholdSystem;
check('1.6 stronghold has no garrison', s.garrison.unitCount === 0 || !s.garrison.composition?.length);

const neighbor = await page.evaluate((hid) => {
  const st = window.getGameState();
  return st.galaxy.stars.find((x) => x.id !== hid)?.id;
}, home);
const garNeighbor = await page.evaluate((nid) => window.__getGarrison(nid), neighbor);
check('1.7 neighbor has seeded garrison', garNeighbor.unitCount > 0, `units=${garNeighbor.unitCount}`);

// --- 2. Hull production ---
let res;
await page.evaluate((c) => { window.getGameState().credits = c; }, 50000);
await page.evaluate((hid) => {
  const st = window.getGameState();
  const sys = st.systems[hid];
  const planet = sys.bodies.find((b) => b.type === 'habitable');
  if (!sys.structures.some((x) => x.type === 'outpost' && x.bodyId === planet.id)) {
    sys.structures.push({ id: 't-out', type: 'outpost', bodyId: planet.id, builtAtTime: 0 });
  }
  if (!sys.structures.some((x) => x.type === 'shipyard' && x.bodyId === planet.id)) {
    sys.structures.push({ id: 't-sy', type: 'shipyard', bodyId: planet.id, builtAtTime: 0, build: null });
  }
}, home);

const shipyardId = await page.evaluate((hid) => {
  const st = window.getGameState();
  return st.systems[hid].structures.find((x) => x.type === 'shipyard')?.id;
}, home);

res = await page.evaluate((sy) => window.__queueHull(sy, 'corvette'), shipyardId);
check('2.1 corvette queued', res.ok === true, res.reason ?? '');

await page.evaluate(() => window.advanceTime(25000));
s = await text();
check('2.2 corvette produced', s.shipCount >= 1, `ships=${s.shipCount}`);
check('2.3 ship in stronghold', s.ships.some((sh) => sh.systemId === home && sh.hull === 'corvette'));

const corvette = s.ships.find((sh) => sh.hull === 'corvette');
check('2.4 corvette has hp', corvette?.hp > 0, `hp=${corvette?.hp}`);

// --- 3. Fleet capture force ---
await page.evaluate(([hid, sid]) => window.__spawnShip(hid, 'frigate'), [home, corvette?.id]);
s = await text();
check('3.1 spawn frigate', s.shipCount >= 2, `count=${s.shipCount}`);

const forceBefore = s.capture.force;
check('3.2 fleet increases capture force', forceBefore >= 3, `force=${forceBefore}`);

// --- 4. Ship transit ---
res = await page.evaluate(([shipId, nid]) => window.__orderShipTravel(shipId, nid), [corvette.id, neighbor]);
check('4.1 ship travel ordered', res.ok === true, res.reason ?? '');
await page.evaluate((ms) => window.advanceTime(ms + 500), res.etaMs ?? 5000);
s = await text();
check('4.2 ship arrived', s.ships.find((sh) => sh.id === corvette.id)?.systemId === neighbor);

// Re-seed garrison for auto-resolve tests (battle may have cleared it during transit advance)
await page.evaluate((nid) => {
  window.getGameState().garrisons[nid] = [{ hull: 'corvette', count: 2 }, { hull: 'frigate', count: 1 }];
  delete window.getGameState().combat[nid];
}, neighbor);

// --- 5. Auto-resolve battle ---
await page.evaluate((nid) => {
  const st = window.getGameState();
  st.flagship.systemId = st.stronghold;
  st.flagship.transit = null;
  window.__viewSystem(nid);
}, neighbor);
await page.evaluate((nid) => window.__startBattle(nid), neighbor);
s = await text();
check('5.1 auto battle started (no flagship)', s.combat.active && s.combat.mode === 'auto',
  `active=${s.combat.active} mode=${s.combat.mode}`);
check('5.2 resolve preview present', s.combat.predictedOutcome != null,
  `winner=${s.combat.predictedOutcome}`);

const preview = await page.evaluate((nid) => window.__autoResolvePreview(nid), neighbor);
check('5.3 preview hook works', preview.playerScore >= 0 && preview.enemyScore >= 0);

await page.evaluate((ms) => window.advanceTime(ms + 100), AUTO_RESOLVE_MS);
s = await text();
check('5.4 battle resolved', !s.combat.active || s.combat.phase === 'resolved');

// --- 6. Tactical battle ---
await page.evaluate((nid) => {
  window.getGameState().garrisons[nid] = [{ hull: 'corvette', count: 3 }];
  delete window.getGameState().combat[nid];
  window.__viewSystem(nid);
  const st = window.getGameState();
  st.flagship.systemId = nid;
  st.flagship.transit = null;
  st.flagship.x = 0;
  st.flagship.y = -100;
  st.flagship.hp = st.flagship.maxHp;
}, neighbor);
await page.evaluate((nid) => {
  window.__spawnShip(nid, 'destroyer');
  window.__spawnShip(nid, 'healer');
  window.__startBattle(nid);
}, neighbor);
s = await text();
check('6.1 tactical battle with flagship', s.combat.mode === 'tactical', `mode=${s.combat.mode}`);
await page.evaluate(() => window.advanceTime(15000));
s = await text();
check('6.2 tactical combat progressed',
  s.combat.phase === 'resolved' || s.garrison.unitCount === 0 || !s.combat.active,
  `phase=${s.combat.phase} garrison=${s.garrison.unitCount}`);

// --- 7. Capture E2E ---
await page.evaluate((nid) => {
  const st = window.getGameState();
  st.garrisons[nid] = [];
  delete st.combat[nid];
  window.__gatherIntel(nid);
}, neighbor);
await page.evaluate((nid) => {
  window.__spawnShip(nid, 'cruiser');
  window.__spawnShip(nid, 'destroyer');
  window.__spawnShip(nid, 'frigate');
}, neighbor);
s = await text();
check('7.1 capture force meets req', s.capture.force >= (s.capture.requirement ?? 0),
  `force=${s.capture.force} req=${s.capture.requirement}`);
check('7.2 not contested after garrison cleared', !s.capture.contested);

await page.evaluate((ms) => window.advanceTime(ms + 500), CAPTURE_HOLD_MS);
s = await text();
check('7.3 system captured', s.systemOwner === 'player', `owner=${s.systemOwner}`);

// --- 8. save-v3 round trip ---
const saved = await text();
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => {
  window.getGameState().ships = [];
  window.getGameState().credits = 0;
});
await page.evaluate(() => window.__loadSlot('slot-1'));
s = await text();
check('8.1 save-v3 restores ships', s.shipCount === saved.shipCount);
check('8.2 save-v3 restores credits', s.credits === saved.credits);

// --- 9. Determinism spot check ---
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
const runSeq = async () => {
  await page.evaluate(() => window.advanceTime(5000));
  await page.evaluate(([hid]) => {
    window.__spawnShip(hid, 'corvette');
    window.__spawnShip(hid, 'corvette');
  }, home);
  await page.evaluate(() => window.advanceTime(3000));
  return page.evaluate(() => window.render_game_to_text());
};
const a = await runSeq();
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
const b = await runSeq();
check('9.1 determinism spot check', a === b);

// --- 10. Pause ---
await page.evaluate(() => window.getGameState().paused = true);
const progBefore = (await text()).capture.progressMs;
await page.evaluate(() => window.advanceTime(20000));
check('10.1 pause freezes capture', (await text()).capture.progressMs === progBefore);

check('10.2 zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
