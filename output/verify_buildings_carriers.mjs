// Post-Phase-6 buildings + carrier wing verification.
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
await page.evaluate(() => window.__newGame(77));
await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  const planet = st.galaxies[st.activeGalaxyId].systems[systemId].bodies.find((b) => b.type === 'habitable');
  window.__viewSystem(systemId);
  window.__selectPlanet(planet.id);
});

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

let s = await text();
check('1.1 saveVersion is 12', s.saveVersion === 12);
check('1.2 building rows present', Array.isArray(s.bodyStructures?.buildRows));
check('1.3 mining locked before tech',
  s.bodyStructures.buildRows.some((r) => r.type === 'mining_complex' && !r.canBuild));

const setup = await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  const sys = st.galaxies[st.activeGalaxyId].systems[systemId];
  const planet = sys.bodies.find((b) => b.type === 'habitable');
  window.__viewSystem(systemId);
  window.__selectPlanet(planet.id);
  const pos = window.__planetPos(systemId, planet.id);
  window.__snapCamera(pos.x, pos.y, 1.25);
  st.credits = 100000;
  st.research.unlocked.push(
    'eco_mining_complex', 'eco_refinery', 'eco_storage_depot',
    'mil_carrier_launch_doctrine', 'mil_fighter_factory', 'mil_drydock',
    'mil_point_defense', 'mil_orbital_defense', 'mil_shield_generator',
    'mil_beam_lances', 'mil_ion_disruptors', 'mil_ion_battery',
  );
  st.flagship.systemId = systemId;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  const outpost = window.__buildOutpost(planet.id);
  const built = {};
  for (const type of [
    'mining_complex', 'refinery', 'storage_depot', 'fighter_factory',
    'planetary_shield', 'ion_battery', 'drydock', 'orbital_defense',
  ]) {
    built[type] = window.__buildBodyStructure(type, planet.id);
  }
  return { planetId: planet.id, outpost, built };
});

check('2.1 outpost built', setup.outpost.ok, setup.outpost.reason ?? '');
for (const [type, res] of Object.entries(setup.built)) {
  check(`2 building ${type}`, res.ok, res.reason ?? '');
}

s = await text();
check('2.2 surface building counts', s.bodyStructures.viewedSystem.byPlacement.surface >= 6);
check('2.3 orbital building counts', s.bodyStructures.viewedSystem.byPlacement.orbital >= 2);
check('2.4 surface visuals counted', s.surfaceSites.buildings >= 6, `buildings=${s.surfaceSites.buildings}`);
check('2.5 orbital visuals counted',
  s.structureVisuals.drydocks.length >= 1 && s.structureVisuals.orbitalDefense.length >= 1);
check('2.6 trade/refinery multiplier visible', s.bodyStructures.viewedSystem.tradeMult > 1);
check('2.7 defense power visible', s.bodyStructures.viewedSystem.defensePower > 0 && s.bodyStructures.viewedSystem.ionPower > 0);

await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  window.__spawnFriendlyShip('light_carrier', 1);
  window.__spawnFriendlyShip('patrol_cutter', 2);
  window.__spawnEnemyFleet(systemId);
});
await page.evaluate(() => window.advanceTime(500));
s = await text();
check('3.1 tactical battle active', s.battle?.active && s.battle.mode === 'tactical');
check('3.2 carrier wings launched', s.battle?.wingState?.launched > 0, JSON.stringify(s.battle?.wingState));
check('3.3 anti-fighter summary visible', s.battle?.weaponSummary?.antiFighter > 0);

const wingLoss = await page.evaluate(() => {
  const st = window.getGameState();
  const battle = st.systemBattles[st.stronghold];
  if (!battle?.units) return null;
  for (const unit of battle.units) {
    if (unit.isWing) unit.hp = 0;
    if (unit.side === 'enemy') unit.hp = 0;
  }
  window.advanceTime(250);
  const carrier = st.playerShips.find((ship) => ship.hull === 'light_carrier');
  return carrier?.wingState ?? null;
});
check('3.4 wing losses persist after battle', wingLoss?.lost > 0, JSON.stringify(wingLoss));

const replenish = await page.evaluate(() => {
  window.advanceTime(20000);
  const carrier = window.getGameState().playerShips.find((ship) => ship.hull === 'light_carrier');
  return carrier?.wingState ?? null;
});
check('3.5 fighter factory replenishes wings', replenish?.ready > wingLoss?.ready, JSON.stringify(replenish));

await page.evaluate((planetId) => {
  const st = window.getGameState();
  const pos = window.__planetPos(st.stronghold, planetId);
  window.__viewSystem(st.stronghold);
  window.__selectPlanet(planetId);
  window.__snapCamera(pos.x, pos.y, 1.55);
}, setup.planetId);
await page.screenshot({ path: path.join(OUT_DIR, 'buildings-carriers.png'), fullPage: true });
check('4.1 no console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\nBuildings/carriers: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
