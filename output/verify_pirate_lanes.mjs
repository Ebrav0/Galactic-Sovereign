// Pirate raid, fleet power marker, and lane interdiction verification.
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

const raid = await page.evaluate(() => {
  window.__newGame(606);
  const st = window.getGameState();
  st.paused = false;
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const home = st.stronghold;
  const lane = graph.lanes.find(([a, b]) => a === home || b === home);
  const neighbor = lane[0] === home ? lane[1] : lane[0];
  const fleet = st.pirates.fleets[0];
  for (let i = 0; i < 12; i++) {
    fleet.galaxyId = st.activeGalaxyId;
    fleet.systemId = neighbor;
    fleet.transit = null;
    fleet.wanderCooldownMs = 0;
    fleet.intent = { type: 'wander', targetSystemId: null };
    window.advanceTime(50);
    if (fleet.intent?.type === 'raid' && fleet.transit) break;
  }
  return {
    home,
    neighbor,
    intent: fleet.intent,
    inTransit: !!fleet.transit,
    path: fleet.transit?.path ?? [],
    power: JSON.parse(window.render_game_to_text()).pirates.fleets[0]?.power ?? 0,
  };
});

check('1.1 pirate chooses a raid target through lane routing',
  raid.intent?.type === 'raid' && raid.inTransit && raid.path.includes(raid.home),
  JSON.stringify(raid));
check('1.2 pirate power level is exposed', raid.power > 0, `power=${raid.power}`);

const markerState = await text();
check('1.3 pirate transit marker includes icon payload',
  markerState.pirates.transitMarkers.some((m) => m.side === 'enemy' && m.power > 0 && m.intent === 'raid'),
  JSON.stringify(markerState.pirates.transitMarkers));

const interdict = await page.evaluate(() => {
  window.__newGame(707);
  const st = window.getGameState();
  st.paused = false;
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const home = st.stronghold;
  const lane = graph.lanes.find(([a, b]) => a === home || b === home);
  const neighbor = lane[0] === home ? lane[1] : lane[0];
  const ship = {
    id: 'lane-ship-1',
    hull: 'destroyer',
    galaxyId: st.activeGalaxyId,
    systemId: home,
    hp: 350,
    maxHp: 350,
    transit: null,
    weaponProfile: 'torpedo',
  };
  st.playerShips.push(ship);
  const group = window.__createBattleGroup();
  window.__assignShipToGroup(ship.id, group.id);
  window.__dispatchShip(ship.id, neighbor);
  ship.transit.legDurationMs = 10000;
  ship.transit.legStartTime = st.time - 1000;

  const fleet = st.pirates.fleets[0];
  fleet.galaxyId = st.activeGalaxyId;
  fleet.systemId = null;
  fleet.transit = {
    path: [neighbor, home],
    legIndex: 0,
    legStartTime: st.time - 9000,
    legDurationMs: 10000,
  };
  fleet.wanderCooldownMs = 45000;
  fleet.intent = { type: 'raid', targetSystemId: home };

  const events = window.advanceTime(50);
  const battle = window.__getBattleState(home);
  const snap = JSON.parse(window.render_game_to_text());
  return {
    events: events.pirateInterdictions ?? [],
    ship: snap.playerShips.find((s) => s.id === ship.id),
    fleet: snap.pirates.fleets.find((f) => f.id === fleet.id),
    battleMode: battle?.mode ?? null,
  };
});

check('2.1 same-lane crossing creates pirate interdiction event',
  interdict.events.length === 1,
  JSON.stringify(interdict.events));
check('2.2 interdiction drops both forces into a battle system',
  interdict.ship && !interdict.ship.inTransit && interdict.fleet && !interdict.fleet.inTransit && interdict.battleMode,
  JSON.stringify(interdict));

await page.evaluate(({ home, neighbor }) => {
  const st = window.getGameState();
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const a = graph.stars.find((s) => s.id === home);
  const b = graph.stars.find((s) => s.id === neighbor);
  window.__setView('galaxy');
  window.__snapGalaxyCamera((a.x + b.x) / 2, (a.y + b.y) / 2, 0.9);
}, { home: raid.home, neighbor: raid.neighbor });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT_DIR, 'pirate-raid-lanes.png'), fullPage: true });

const perf = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(window.__galaxyPerfSummary()))));
check('3.1 galaxy perf reports pirate marker layer', perf.pirateMarkers > 0, JSON.stringify(perf));
check('3.2 no console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\nPirate lanes: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
