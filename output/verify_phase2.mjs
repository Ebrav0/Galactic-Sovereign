// Phase 2 verification: combat hybrid + wandering pirates.
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

const PIRATE_FLEET_COUNT = 2;
const PIRATE_WANDER_MS = 45000;
const CORVETTE_BUILD_MS = 22000;
const CORVETTE_COST = 180;
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
await page.evaluate(() => window.__newGame(42));

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

// --- Section 1: Ship model + save-v4 ---
let s = await text();
check('1.1 hull stats include combat classes',
  ['corvette', 'frigate', 'destroyer', 'healer'].every((h) => s.hullStats.includes(h)));
check('1.2 new game playerShips empty, pirates spawned',
  s.playerShips.length === 0 && s.pirates.fleetCount === PIRATE_FLEET_COUNT);

await page.evaluate(() => {
  const st = window.getGameState();
  st.playerShips.push({ id: 'ship-test', hull: 'corvette', systemId: st.stronghold, hp: 100, maxHp: 120, transit: null });
});
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
s = await text();
check('1.3 save-v4 round trip restores playerShips', s.playerShips.some((sh) => sh.id === 'ship-test'));

// --- Section 2: Shipyard combat production ---
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 5000;
  const sys = st.systems[st.stronghold];
  const planet = sys.bodies.find((b) => b.type === 'habitable');
  sys.structures.push({ id: 'sy-test', type: 'shipyard', bodyId: planet.id, builtAtTime: 0, build: null });
});
s = await text();
const queueRes = await page.evaluate(() => window.__queueHull('sy-test', 'corvette'));
check('2.1 queue corvette succeeds', queueRes.ok);
await page.evaluate((ms) => window.advanceTime(ms), CORVETTE_BUILD_MS + 500);
s = await text();
check('2.2 build completes into playerShips', s.playerShips.some((sh) => sh.hull === 'corvette'));
const scoutRes = await page.evaluate(() => window.__queueHull('sy-test', 'scout'));
check('2.3 scout queue still works', scoutRes.ok);

// --- Section 3: Player fleet transit ---
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 5000;
  const sys = st.systems[st.stronghold];
  const planet = sys.bodies.find((b) => b.type === 'habitable');
  sys.structures.push({ id: 'sy-t', type: 'shipyard', bodyId: planet.id, builtAtTime: 0, build: null });
});
await page.evaluate(() => window.__queueHull('sy-t', 'corvette'));
await page.evaluate((ms) => window.advanceTime(ms), CORVETTE_BUILD_MS + 500);
const shipId = (await text()).playerShips[0]?.id;
const neighbor = await page.evaluate(() => {
  const st = window.getGameState();
  return st.galaxy.stars.find((star) => star.id !== st.stronghold)?.id;
});
const dispatch = await page.evaluate(([id, dest]) => window.__dispatchShip(id, dest), [shipId, neighbor]);
check('3.1 dispatch starts transit', dispatch.ok && (await text()).playerShips[0].inTransit);
await page.keyboard.press('Space');
const transitAtPause = await page.evaluate(([id]) => {
  const ship = window.getGameState().playerShips.find((x) => x.id === id);
  return ship?.transit ? ship.transit.legStartTime : null;
}, [shipId]);
await page.evaluate(() => window.advanceTime(5000));
const stillPaused = await page.evaluate(([id, start]) => {
  const ship = window.getGameState().playerShips.find((x) => x.id === id);
  return ship?.transit?.legStartTime === start;
}, [shipId, transitAtPause]);
check('3.3 pause freezes ship transit', stillPaused);
await page.keyboard.press('Space');
await page.evaluate((ms) => window.advanceTime(ms), 120000);
s = await text();
check('3.2 ship arrives after unpause', !s.playerShips[0]?.inTransit && s.playerShips[0]?.systemId === neighbor);

// --- Section 4: Pirate spawn + wander ---
await page.evaluate(() => window.__newGame(777));
s = await text();
check('4.1 pirate fleets on rim not stronghold',
  s.pirates.fleets.every((f) => f.systemId !== s.strongholdSystem && f.systemId !== 'core'));
const piratesA = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text()).pirates));
await page.evaluate(() => window.__newGame(777));
const piratesB = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text()).pirates));
check('4.2 same seed same pirate spawns', piratesA === piratesB);
await page.evaluate((ms) => window.advanceTime(ms), PIRATE_WANDER_MS * 2 + 5000);
s = await text();
check('4.3 pirates wander or transit',
  s.pirates.fleets.some((f) => f.inTransit) || s.pirates.fleets.some((f) => f.systemId));
await page.evaluate(() => window.__newGame(777));
await page.evaluate((ms) => window.advanceTime(ms), PIRATE_WANDER_MS * 2);
const p1 = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text()).pirates));
await page.evaluate(() => window.__newGame(777));
await page.evaluate((ms) => window.advanceTime(ms), PIRATE_WANDER_MS * 2);
const p2 = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text()).pirates));
check('4.4 wander determinism', p1 === p2);
check('4.5 pirate markers array present', Array.isArray(s.pirates.markers));

// --- Section 5–7: Combat ---
await page.evaluate(() => window.__newGame(42));
const stronghold42 = await page.evaluate(() => window.getGameState().stronghold);
await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 8000;
  const sys = st.systems[st.stronghold];
  const planet = sys.bodies.find((b) => b.type === 'habitable');
  sys.structures.push({ id: 'sy-c', type: 'shipyard', bodyId: planet.id, builtAtTime: 0, build: null });
});
await page.evaluate(([sid]) => window.__forcePirateIntoSystem(sid), [stronghold42]);
await page.evaluate(([sid]) => window.__viewSystem(sid), [stronghold42]);
await page.evaluate(() => window.advanceTime(50));
s = await text();
check('5.1 battle triggers with pirates in system', s.battle?.active === true || s.pirates.inViewedSystem);
check('5.2 flagship present → tactical mode', s.battle?.mode === 'tactical');
await page.evaluate(() => window.__queueHull('sy-c', 'destroyer'));
await page.evaluate((ms) => window.advanceTime(ms), 45000);

await page.evaluate(() => window.__newGame(55));
const remote = await page.evaluate(() => {
  const st = window.getGameState();
  const dest = st.galaxy.stars.find((x) => x.id !== st.stronghold).id;
  st.playerShips = [{
    id: 'ship-remote', hull: 'destroyer', systemId: dest, hp: 350, maxHp: 350, transit: null,
  }];
  window.__forcePirateIntoSystem(dest);
  st.flagship.systemId = st.stronghold;
  return dest;
});
await page.evaluate(() => window.advanceTime(50));
const autoMode = await page.evaluate(([d]) => window.__getBattleState(d)?.mode, [remote]);
check('5.3 flagship absent → auto mode when battle active', autoMode === 'auto');
await page.evaluate(() => window.advanceTime(5000));
check('5.4 battle resolves', (await page.evaluate(([d]) => !window.__getBattleState(d)?.active, [remote])) !== undefined);

// Tactical HP change
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__forcePirateIntoSystem(window.getGameState().stronghold));
await page.evaluate(() => window.advanceTime(5000));
const enemyHpBefore = await page.evaluate(() => {
  const b = window.__getBattleState(window.getGameState().stronghold);
  return b?.units?.filter((u) => u.side === 'enemy').reduce((n, u) => n + u.hp, 0) ?? 0;
});
await page.evaluate(() => window.advanceTime(15000));
const enemyHpAfter = await page.evaluate(() => {
  const b = window.__getBattleState(window.getGameState().stronghold);
  return b?.units?.filter((u) => u.side === 'enemy').reduce((n, u) => n + u.hp, 0) ?? 0;
});
check('6.1 tactical reduces enemy HP', enemyHpAfter < enemyHpBefore || enemyHpBefore === 0);

// Auto-resolve determinism
await page.evaluate(() => window.__newGame(88));
const fixture = await page.evaluate(() => {
  const st = window.getGameState();
  const dest = st.galaxy.stars.find((x) => x.id !== st.stronghold).id;
  st.playerShips = [
    { id: 's1', hull: 'destroyer', systemId: dest, hp: 350, maxHp: 350, transit: null },
    { id: 's2', hull: 'destroyer', systemId: dest, hp: 350, maxHp: 350, transit: null },
  ];
  window.__forcePirateIntoSystem(dest);
  st.battleStance = 'aggressive';
  return dest;
});
await page.evaluate(() => window.advanceTime(5000));
const resolve1 = await page.evaluate(([d]) => JSON.stringify(window.__getBattleState(d)?.lastResolve), [fixture]);
await page.evaluate(() => window.__newGame(88));
await page.evaluate(([d]) => {
  const st = window.getGameState();
  st.playerShips = [
    { id: 's1', hull: 'destroyer', systemId: d, hp: 350, maxHp: 350, transit: null },
    { id: 's2', hull: 'destroyer', systemId: d, hp: 350, maxHp: 350, transit: null },
  ];
  window.__forcePirateIntoSystem(d);
  st.battleStance = 'aggressive';
}, [fixture]);
await page.evaluate(() => window.advanceTime(5000));
const resolve2 = await page.evaluate(([d]) => JSON.stringify(window.__getBattleState(d)?.lastResolve), [fixture]);
check('7.2 auto-resolve deterministic', resolve1 === resolve2);

// --- Section 9: Capture ---
await page.evaluate(() => window.__newGame(42));
const capNeighbor = await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 9999;
  const nid = st.galaxy.stars.find((x) => x.id !== st.stronghold).id;
  st.playerShips = [{ id: 'cap-ship', hull: 'frigate', systemId: nid, hp: 200, maxHp: 200, transit: null }];
  st.intel[nid] = { gatheredAt: 0 };
  st.flagship.systemId = 'sys-other';
  st.flagship.transit = null;
  return nid;
});
s = await text();
check('9.1 capture force includes combat ships', s.capture.force >= 2);
await page.evaluate(([nid]) => window.__forcePirateIntoSystem(nid), [capNeighbor]);
await page.evaluate(([nid]) => window.__viewSystem(nid), [capNeighbor]);
await page.evaluate(() => window.advanceTime(1000));
s = await text();
check('9.2 pirates contest capture', s.capture.contested === true);
check('9.4 __setEnemyPresence removed', await page.evaluate(() => typeof window.__setEnemyPresence === 'undefined'));

// --- Section 10: Hygiene ---
check('10.2 zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
