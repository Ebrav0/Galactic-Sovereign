// Phase 1 verification script (test artifact, not shipped game code).
// Covers: galaxy generation, flagship flight + pause, lane transit (single and
// multi-hop), build-requires-flagship rule, save-v1 round trip, v0->v1 migration,
// determinism, and console cleanliness.
import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/');
const { chromium } = require('playwright');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// CRC-32 mirror of src/js/save.js (needed to forge a v0 envelope).
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

// --- 1. Galaxy generation ---
let s = await text();
check('20 stars generated', s.galaxy.starCount === 20, `stars=${s.galaxy.starCount}`);
check('black hole node present', s.galaxy.blackHole === 'core');
check('lane count >= spanning tree size', s.galaxy.laneCount >= 20, `lanes=${s.galaxy.laneCount}`);
check('flagship starts at stronghold', s.flagship.systemId === s.strongholdSystem);
check('starts in system view of stronghold', s.view === 'system' && s.currentSystem === s.strongholdSystem);

const galaxy = await page.evaluate(() => {
  const g = window.getGameState().galaxy;
  return { stars: g.stars, blackHole: g.blackHole, lanes: g.lanes };
});
const nodeIds = [...galaxy.stars.map((st) => st.id), galaxy.blackHole.id];
const adj = new Map(nodeIds.map((id) => [id, []]));
for (const [a, b] of galaxy.lanes) { adj.get(a).push(b); adj.get(b).push(a); }
{
  const seen = new Set([nodeIds[0]]);
  const queue = [nodeIds[0]];
  while (queue.length) for (const n of adj.get(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  check('lane graph fully connected', seen.size === nodeIds.length, `${seen.size}/${nodeIds.length}`);
}
const avgDegree = (galaxy.lanes.length * 2) / nodeIds.length;
check('average degree in 2-4 band', avgDegree >= 2 && avgDegree <= 4, `avg=${avgDegree.toFixed(2)}`);
check('black hole has >= 2 lanes', adj.get(galaxy.blackHole.id).length >= 2,
  `lanes=${adj.get(galaxy.blackHole.id).length}`);
check('every system exists (incl. core)', await page.evaluate(() => {
  const st = window.getGameState();
  return [...st.galaxy.stars.map((x) => x.id), st.galaxy.blackHole.id].every((id) => !!st.systems[id]);
}));
check('core system has no bodies', await page.evaluate(() => {
  const st = window.getGameState();
  return st.systems[st.galaxy.blackHole.id].bodies.length === 0
    && st.systems[st.galaxy.blackHole.id].star.kind === 'blackhole';
}));

// --- 2. Flagship free flight ---
const startPos = s.flagship;
await page.evaluate(() => window.__setFlagshipInput(1, 0));
await page.evaluate(() => window.advanceTime(2000));
s = await text();
check('thrust moves flagship +x', s.flagship.x > startPos.x + 50, `dx=${(s.flagship.x - startPos.x).toFixed(1)}`);
check('heading follows velocity', Math.abs(s.flagship.heading) < 0.2, `heading=${s.flagship.heading}`);
await page.evaluate(() => window.__setFlagshipInput(0, 0));
await page.evaluate(() => window.advanceTime(3000));
s = await text();
check('drag stops the ship', Math.hypot(s.flagship.vx, s.flagship.vy) < 1,
  `v=(${s.flagship.vx},${s.flagship.vy})`);

// --- 3. Pause freezes flight ---
await page.keyboard.press('Space');
s = await text();
check('Space pauses', s.paused === true);
const pausedPos = s.flagship;
await page.evaluate(() => window.__setFlagshipInput(0, 1));
await page.evaluate(() => window.advanceTime(2000));
s = await text();
check('paused flight is frozen', s.flagship.x === pausedPos.x && s.flagship.y === pausedPos.y,
  `pos=(${s.flagship.x},${s.flagship.y})`);
await page.keyboard.press('Space');
await page.evaluate(() => window.__setFlagshipInput(0, 0));

// --- 4. Build rule: flagship must be present ---
s = await text();
const home = s.currentSystem;
const habitable = s.bodies.find((b) => b.type === 'habitable' && b.moonCount > 0);
check('home has habitable planet with moons', !!habitable);
const neighbor = adj.get(home).find((id) => id !== galaxy.blackHole.id) ?? adj.get(home)[0];
let res = await page.evaluate((id) => window.__orderTravel(id), neighbor);
check('travel order accepted', res.ok === true, res.reason ?? `eta=${res.etaMs}ms`);
s = await text();
check('flagship in transit', s.flagship.inTransit === true && s.flagship.destination === neighbor);
check('in transit: systemId null', s.flagship.systemId === null);

// While in transit, building back home must be refused.
await page.evaluate((id) => window.__viewSystem(id), home);
res = await page.evaluate((id) => window.__buildOutpost(id), habitable.id);
check('build refused without flagship', res.ok === false, res.reason);
s = await text();
check('canBuildOutpost false without flagship',
  s.bodies.find((b) => b.id === habitable.id).canBuildOutpost === false);

// --- 5. Pause freezes transit; arrival retargets the view ---
await page.keyboard.press('Space');
const frozen = (await text()).flagship.transitProgress;
await page.evaluate(() => window.advanceTime(5000));
s = await text();
check('paused transit is frozen', s.flagship.transitProgress === frozen, `progress=${s.flagship.transitProgress}`);
await page.keyboard.press('Space');
await page.evaluate((ms) => window.advanceTime(ms + 500), s.flagship.etaMs);
s = await text();
check('arrived at neighbor star', s.flagship.systemId === neighbor, `at=${s.flagship.systemId}`);
check('system view retargeted on arrival', s.currentSystem === neighbor);
check('arrival at system edge', Math.hypot(s.flagship.x, s.flagship.y) >= 300,
  `r=${Math.hypot(s.flagship.x, s.flagship.y).toFixed(0)}`);

// --- 6. Travel back (multi-hop capable) and build at home ---
res = await page.evaluate((id) => window.__orderTravel(id), home);
check('return travel accepted', res.ok === true);
await page.evaluate((ms) => window.advanceTime(ms + 500), res.etaMs);
s = await text();
check('returned to stronghold', s.flagship.systemId === home);
res = await page.evaluate((id) => window.__buildOutpost(id), habitable.id);
check('build succeeds with flagship present', res.ok === true, res.reason ?? '');
s = await text();
check('outpost recorded + income flows',
  s.structures.some((st) => st.bodyId === habitable.id) && s.incomePerSec > 0);

// --- 7. Multi-hop routing ---
const hops = new Map([[home, 0]]);
{
  const queue = [home];
  while (queue.length) {
    const n = queue.shift();
    for (const m of adj.get(n)) if (!hops.has(m)) { hops.set(m, hops.get(n) + 1); queue.push(m); }
  }
}
const farStar = galaxy.stars.map((st) => st.id).find((id) => (hops.get(id) ?? 0) >= 2);
if (farStar) {
  res = await page.evaluate((id) => window.__orderTravel(id), farStar);
  check('multi-hop path found', res.ok === true && res.path.length >= 3,
    `path=${res.path?.join(' > ')}`);
  // Screenshot the galaxy map mid-transit (lanes, wormhole, route, ship icon).
  await page.evaluate(() => window.__setView('galaxy'));
  await page.evaluate(() => window.advanceTime(1500));
  await page.evaluate(() => { document.getElementById('toast-container').innerHTML = ''; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'output/web-game/verify-p1-galaxy-transit.png' });
  s = await text();
  check('galaxy view active', s.view === 'galaxy');
  await page.evaluate((ms) => window.advanceTime(ms + 500), s.flagship.etaMs);
  s = await text();
  check('multi-hop arrival', s.flagship.systemId === farStar, `at=${s.flagship.systemId}`);
  await page.evaluate(() => window.__setView('system'));
} else {
  check('multi-hop path found', false, 'no star at hop distance >= 2');
}

// --- 8. Save v1 round trip ---
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.waitForTimeout(200);
const saved = await text();
await page.evaluate(() => { window.getGameState().credits = 99999; });
await page.evaluate(() => window.__loadSlot('slot-1'));
await page.waitForTimeout(200);
s = await text();
check('save/load restores credits', Math.abs(s.credits - saved.credits) < 1,
  `restored=${s.credits} saved=${saved.credits}`);
check('save/load restores flagship location',
  s.flagship.systemId === saved.flagship.systemId
  && s.flagship.x === saved.flagship.x && s.flagship.y === saved.flagship.y);
check('save/load restores galaxy', s.galaxy.starCount === 20 && s.galaxy.laneCount === saved.galaxy.laneCount);

// --- 9. v0 -> v1 migration ---
const v0State = {
  meta: { seed: 1, createdAt: 1751470000000, playTimeMs: 5000 },
  time: 60000,
  credits: 777,
  paused: false,
  stronghold: 'sys-home',
  system: {
    id: 'sys-home',
    name: 'Solara Prime',
    star: { radius: 46, color: '#ffd27a' },
    bodies: [{
      id: 'p1', kind: 'planet', type: 'habitable', name: 'Aurelia',
      orbitRadius: 220, orbitPeriodMs: 240000, orbitPhase: 0.4, radius: 12,
      moons: [{ id: 'p1m1', kind: 'moon', name: 'Aurelia I', orbitRadius: 30, orbitPeriodMs: 30000, orbitPhase: 0.1, radius: 3.5 }],
    }],
    structures: [{ id: 'st1', type: 'outpost', bodyId: 'p1', builtAtTime: 1000 }],
  },
};
const v0Json = JSON.stringify(v0State);
const v0Envelope = JSON.stringify({ saveVersion: 0, checksum: crc32(v0Json), savedAt: 1751470000000, state: JSON.parse(v0Json) });
await page.evaluate((env) => localStorage.setItem('gs-save-slot-2', env), v0Envelope);
res = await page.evaluate(() => window.__loadSlot('slot-2'));
check('v0 save loads via migration', res.ok === true, res.error ?? '');
s = await text();
check('migration keeps credits/time', s.credits === 777 && s.time === 60000,
  `credits=${s.credits} time=${s.time}`);
check('migration generates galaxy', s.galaxy.starCount === 20 && s.galaxy.laneCount >= 20);
check('migration installs old system as stronghold',
  s.currentSystem === s.strongholdSystem
  && s.systemName === 'Solara Prime'
  && s.structures.some((st) => st.id === 'st1' && st.bodyId === 'p1'),
  `sys=${s.systemName} structures=${s.structures.length}`);
check('migrated flagship at stronghold', s.flagship.systemId === s.strongholdSystem);

// --- 10. Corrupt v0 save still refused ---
const badEnvelope = JSON.stringify({ saveVersion: 0, checksum: 'deadbeef', savedAt: 1, state: JSON.parse(v0Json) });
await page.evaluate((env) => localStorage.setItem('gs-save-slot-3', env), badEnvelope);
res = await page.evaluate(() => window.__loadSlot('slot-3'));
check('bad checksum refused before migration', res.ok === false, res.error ?? '');

// --- 11. Determinism: same seed + same hook sequence => identical output ---
async function deterministicRun() {
  const p = await browser.newPage();
  await p.goto('http://localhost:5173');
  await p.waitForFunction(() => typeof window.render_game_to_text === 'function');
  const out = await p.evaluate(() => {
    window.__setFlagshipInput(1, -0.5);
    window.advanceTime(3000);
    window.__setFlagshipInput(0, 0);
    const st = window.getGameState();
    const target = st.galaxy.lanes.find(([a, b]) => a === st.stronghold || b === st.stronghold);
    const dest = target[0] === st.stronghold ? target[1] : target[0];
    window.__orderTravel(dest);
    window.advanceTime(4000);
    const o = JSON.parse(window.render_game_to_text());
    return JSON.stringify({ time: o.time, credits: o.credits, flagship: o.flagship, galaxy: o.galaxy, bodies: o.bodies });
  });
  await p.close();
  return out;
}
const runA = await deterministicRun();
const runB = await deterministicRun();
check('deterministic: identical runs', runA === runB);

// --- 12. Real input controls (keyboard + mouse, not hooks) ---
s = await text();
check('back in system view for input tests', s.view === 'system');
const preKey = s.flagship;
await page.keyboard.down('d');
await page.waitForTimeout(700);
await page.keyboard.up('d');
await page.waitForTimeout(150);
s = await text();
check('holding D flies flagship +x (real keys)', s.flagship.x > preKey.x + 30,
  `dx=${(s.flagship.x - preKey.x).toFixed(1)}`);

await page.keyboard.press('m');
s = await text();
check('M switches to galaxy view', s.view === 'galaxy');

// Single click on a neighbor star orders travel (after the double-click grace).
const clickTarget = await page.evaluate(() => {
  const st = window.getGameState();
  const here = st.flagship.systemId;
  const lane = st.galaxy.lanes.find(([a, b]) => a === here || b === here);
  const destId = lane[0] === here ? lane[1] : lane[0];
  const node = st.galaxy.stars.find((x) => x.id === destId) ?? st.galaxy.blackHole;
  return { id: destId, x: node.x, y: node.y };
});
const toScreen = (wx, wy) => ({ x: wx * 0.4 + 640, y: wy * 0.4 + 400 });
let pt = toScreen(clickTarget.x, clickTarget.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(450); // single-click grace period
s = await text();
check('galaxy click orders travel', s.flagship.inTransit === true && s.flagship.destination === clickTarget.id,
  `dest=${s.flagship.destination}`);

// Double click on a different star opens its system view without travel spam.
const dblTarget = await page.evaluate((skip) => {
  const st = window.getGameState();
  const star = st.galaxy.stars.find((x) => x.id !== skip);
  return { id: star.id, x: star.x, y: star.y };
}, clickTarget.id);
pt = toScreen(dblTarget.x, dblTarget.y);
await page.mouse.click(pt.x, pt.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(150);
s = await text();
check('double-click opens system view', s.view === 'system' && s.currentSystem === dblTarget.id,
  `view=${s.view} sys=${s.currentSystem}`);

// Escape clears planet selection.
if (s.bodies.length > 0) {
  await page.evaluate((id) => window.__selectPlanet(id), s.bodies[0].id);
  await page.keyboard.press('Escape');
  s = await text();
  check('Escape clears selection', s.selection === null);
} else {
  check('Escape clears selection', true, 'viewed system has no bodies (skip)');
}

// --- 13. Screenshots for visual inspection (fresh page — no toast noise) ---
const shot = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await shot.goto('http://localhost:5173');
await shot.waitForFunction(() => typeof window.render_game_to_text === 'function');
// Flagship under thrust in the home system (follow camera keeps it centered).
await shot.evaluate(() => { window.__setFlagshipInput(1, -0.35); window.advanceTime(1200); });
await shot.waitForTimeout(600);
await shot.screenshot({ path: 'output/web-game/verify-p1-system-flagship.png' });
// Galactic core system: black hole + dormant wormhole up close.
await shot.evaluate(() => { window.__setFlagshipInput(0, 0); window.__viewSystem('core'); });
await shot.waitForTimeout(300);
await shot.screenshot({ path: 'output/web-game/verify-p1-core-wormhole.png' });
// Full galaxy map.
await shot.evaluate(() => window.__setView('galaxy'));
await shot.waitForTimeout(300);
await shot.screenshot({ path: 'output/web-game/verify-p1-galaxy.png' });
await shot.close();

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
