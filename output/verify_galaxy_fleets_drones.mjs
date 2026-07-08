// Galaxy performance, fleet map selection/dispatch, and builder drone verification.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try {
  ({ chromium } = createRequire(path.join(here, '../package.json'))('playwright'));
} catch {
  ({ chromium } = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/')('playwright'));
}

const OUT_DIR = path.join(here, 'visuals');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(123));

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

let snap = await text();
check('1.1 saveVersion is 11', snap.saveVersion === 11, `version=${snap.saveVersion}`);
check('1.2 builder drone state present', snap.builderDrones && Array.isArray(snap.builderDrones.drones));

const galaxyPerf = await page.evaluate(() => {
  window.__setView('galaxy');
  const st = window.getGameState();
  const graph = st.galaxies[st.activeGalaxyId].graph;
  window.__snapGalaxyCamera(0, 0, 0.055);
  return new Promise((resolve) => requestAnimationFrame(() => resolve(window.__galaxyPerfSummary())));
});
check('2.1 far galaxy LOD active', galaxyPerf.tier === 'far', JSON.stringify(galaxyPerf));
check('2.2 visible galaxy work bounded',
  galaxyPerf.visibleStars < 260 && galaxyPerf.visibleLanes < 520,
  `stars=${galaxyPerf.visibleStars} lanes=${galaxyPerf.visibleLanes}`);

const fleetSetup = await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 100000;
  const sysId = st.stronghold;
  st.playerShips.push({
    id: 'tab-ship-1',
    hull: 'corvette',
    galaxyId: st.activeGalaxyId,
    systemId: sysId,
    hp: 120,
    maxHp: 120,
    transit: null,
  });
  const group = window.__createBattleGroup();
  window.__assignShipToGroup('tab-ship-1', group.id);
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const star = graph.stars.find((s) => s.id === sysId);
  const system = st.galaxies[st.activeGalaxyId].systems[sysId];
  const bonus = { red_dwarf: -1, blue_white: 1, blue_giant: 3, red_giant: 3, subgiant: 2, white_dwarf: -1, flare_star: -1 }[system.star.kind] ?? 0;
  const nodeR = 9 + system.bodies.length * 1.6 + bonus;
  window.__setView('galaxy');
  window.__snapGalaxyCamera(star.x, star.y, 0.9);
  const sx = (star.x - nodeR - 12 - star.x) * 0.9 + window.innerWidth / 2;
  const sy = (star.y + nodeR + 12 - star.y) * 0.9 + window.innerHeight / 2;
  const lane = graph.lanes.find(([a, b]) => a === sysId || b === sysId);
  const targetId = lane[0] === sysId ? lane[1] : lane[0];
  const target = graph.stars.find((s) => s.id === targetId);
  const tx = (target.x - star.x) * 0.9 + window.innerWidth / 2;
  const ty = (target.y - star.y) * 0.9 + window.innerHeight / 2;
  return { groupId: group.id, sx, sy, targetId, tx, ty };
});

await page.mouse.click(fleetSetup.sx, fleetSetup.sy);
snap = await text();
check('3.1 click fleet marker selects fleet',
  snap.selectedBattleGroupId === fleetSetup.groupId,
  `selected=${snap.selectedBattleGroupId}`);

await page.keyboard.down('Tab');
await page.mouse.click(fleetSetup.tx, fleetSetup.ty);
await page.keyboard.up('Tab');
snap = await text();
check('3.2 Tab+click dispatches selected fleet',
  snap.playerShips.some((s) => s.id === 'tab-ship-1' && s.inTransit),
  JSON.stringify(snap.playerShips.find((s) => s.id === 'tab-ship-1')));

const routePerf = await page.evaluate(() =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(window.__galaxyPerfSummary()))));
check('3.3 galaxy perf remains available after fleet dispatch', routePerf.visibleLanes > 0, JSON.stringify(routePerf));

const droneSetup = await page.evaluate(() => {
  window.__newGame(124);
  const st = window.getGameState();
  st.credits = 100000;
  st.research.unlocked.push('mil_sensor_ship', 'mil_builder_ship', 'eco_mining_complex');
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const home = st.stronghold;
  const systems = st.galaxies[st.activeGalaxyId].systems;
  const targetId = graph.stars.map((star) => star.id).find((id) => {
    if (id === home) return false;
    const sys = systems[id];
    const planet = sys?.bodies.find((b) => b.type === 'habitable');
    return planet && !sys.structures.some((s) => s.type === 'outpost' && s.bodyId === planet.id);
  });
  const targetSystem = systems[targetId];
  const targetPlanet = targetSystem.bodies.find((b) => b.type === 'habitable');
  targetSystem.owner = 'neutral';
  window.__viewSystem(targetId);
  window.__selectPlanet(targetPlanet.id);
  return { targetId, planetId: targetPlanet.id };
});

const sendOutpost = await page.evaluate(({ targetId, planetId }) =>
  window.__sendBuilderDrone(targetId, planetId, 'outpost'), droneSetup);
check('4.1 send drone to build neutral outpost', sendOutpost.ok, sendOutpost.reason ?? '');

await page.evaluate(() => window.advanceTime(120000));
snap = await text();
const targetStructures = await page.evaluate(({ targetId }) => {
  const st = window.getGameState();
  return st.galaxies[st.activeGalaxyId].systems[targetId].structures.map((s) => s.type);
}, droneSetup);
check('4.2 drone completes outpost', targetStructures.includes('outpost'), targetStructures.join(','));
check('4.3 drone captures neutral outpost system',
  await page.evaluate(({ targetId }) => window.getGameState().galaxies[window.getGameState().activeGalaxyId].systems[targetId].owner === 'player', droneSetup));

const sendMining = await page.evaluate(({ targetId, planetId }) =>
  window.__sendBuilderDrone(targetId, planetId, 'mining_complex'), droneSetup);
check('4.4 send drone to build owned body structure', sendMining.ok, sendMining.reason ?? '');
await page.evaluate(() => window.advanceTime(90000));
const structureTypes = await page.evaluate(({ targetId }) => {
  const st = window.getGameState();
  return st.galaxies[st.activeGalaxyId].systems[targetId].structures.map((s) => s.type);
}, droneSetup);
check('4.5 drone completes body structure', structureTypes.includes('mining_complex'), structureTypes.join(','));

await page.evaluate(({ targetId, planetId }) => {
  const st = window.getGameState();
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const star = graph.stars.find((s) => s.id === targetId);
  window.__viewSystem(targetId);
  window.__selectPlanet(planetId);
  window.__snapGalaxyCamera(star.x, star.y, 0.75);
  window.__setView('galaxy');
}, droneSetup);
await page.screenshot({ path: path.join(OUT_DIR, 'galaxy-fleets-drones.png'), fullPage: true });

check('5.1 no console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\nGalaxy/fleets/drones: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
