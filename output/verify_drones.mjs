// Construction drones verification (Phase 6).
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

const OUTPOST_COST = 300;
const STRUCTURE_BUILD_MS = 18000;
const FOUNDRY_COST = 800;
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

// --- 1. New game state ---
let s = await text();
check('1 new game constructionJobs empty', (s.constructionJobs ?? []).length === 0);
check('1 drone capacity in stronghold', (s.drones?.capacity ?? 0) >= 2, `capacity=${s.drones?.capacity}`);

// --- 2. Order outpost ---
const habitable = s.bodies.find((b) => b.type === 'habitable');
const creditsBefore = s.credits;
await page.evaluate((id) => window.__selectPlanet(id), habitable.id);
const order = await page.evaluate((id) => window.__queueOutpost(id), habitable.id);
check('2 order outpost ok', order.ok, order.reason ?? '');
s = await text();
check('2 credits deducted', s.credits === creditsBefore - OUTPOST_COST, `${s.credits} vs ${creditsBefore - OUTPOST_COST}`);
check('2 structure stub under construction',
  s.structures.some((st) => st.type === 'outpost' && st.underConstruction));
check('2 active construction job',
  s.constructionJobs.some((j) => j.structureType === 'outpost' && j.status !== 'complete'));

// --- 3. Timed completion ---
await page.evaluate(() => window.advanceTime(12000));
s = await text();
check('3 outpost complete', s.structures.some((st) => st.type === 'outpost' && !st.underConstruction));
check('3 passive income stays disabled under physical logistics',
  s.incomePerSecInViewedSystem === 0,
  `${s.incomePerSecInViewedSystem}/s`);

// --- 4. Drone motion + determinism ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
});
await page.evaluate((id) => {
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
}, habitable.id);
await page.evaluate(() => window.advanceTime(500));
const snapA = await page.evaluate(() => window.render_game_to_text());
await page.evaluate(() => window.advanceTime(500));
const snapB = await page.evaluate(() => window.render_game_to_text());
const parsedA = JSON.parse(snapA);
const parsedB = JSON.parse(snapB);
const posA = parsedA.drones?.inViewedSystem?.[0];
const posB = parsedB.drones?.inViewedSystem?.[0];
check('4 drone positions present', !!posA && !!posB);
check('4 drone motion changes', posA && posB && (posA.x !== posB.x || posA.y !== posB.y));

await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
  window.advanceTime(5000);
});
const det1 = await page.evaluate(() => window.render_game_to_text());
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
  window.advanceTime(5000);
});
const det2 = await page.evaluate(() => window.render_game_to_text());
check('4 determinism CRC', crc32(det1) === crc32(det2), `${crc32(det1)} vs ${crc32(det2)}`);

// --- 5. Builder ship capacity ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
});
await page.evaluate(() => window.__spawnBuilderShip());
s = await text();
const capBefore = s.drones.capacity;
await page.evaluate(() => window.__spawnBuilderShip());
s = await text();
check('5 builder ship increases capacity', s.drones.capacity > capBefore, `${capBefore} -> ${s.drones.capacity}`);

// --- 6. Flagship leaves pauses job ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
  window.advanceTime(2000);
  const progressBefore = st.constructionJobs[0].workDoneMs;
  const graph = st.galaxies[st.activeGalaxyId].graph;
  const lane = graph.lanes.find((l) => l[0] === st.stronghold || l[1] === st.stronghold);
  const dest = lane[0] === st.stronghold ? lane[1] : lane[0];
  st.flagship.transit = {
    path: [st.stronghold, dest],
    legIndex: 0,
    legStartTime: st.time,
    legDurationMs: 60000,
  };
  st.flagship.systemId = null;
  window.advanceTime(5000);
  return {
    progressBefore,
    progressAfter: st.constructionJobs[0].workDoneMs,
    status: st.constructionJobs[0].status,
  };
}).then((r) => {
  check('6 job paused when flagship leaves', r.status === 'paused');
  check('6 no progress while away', r.progressAfter === r.progressBefore, `${r.progressBefore} vs ${r.progressAfter}`);
});

// --- 7. Duplicate block ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  st.flagship.systemId = st.stronghold;
  st.flagship.transit = null;
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
});
const dup = await page.evaluate(() => {
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  return window.__queueOutpost(planet.id);
});
check('7 duplicate outpost rejected', !dup.ok);

// --- 8. Tech gate for foundry ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  st.credits = 5000;
  if (!st.research.unlocked.includes('mega_foundry_unlock')) {
    st.research.unlocked.push('mega_foundry_unlock');
  }
});
const foundryBlocked = await page.evaluate(() => window.__buildFoundry());
check('8 foundry blocked without builder drones', !foundryBlocked.ok, foundryBlocked.reason ?? '');
await page.evaluate(() => window.__forceResearch('mil_builder_ship'));
const foundryOk = await page.evaluate(() => window.__buildFoundry());
check('8 foundry succeeds after research', foundryOk.ok, foundryOk.reason ?? '');

// --- 9. Save round-trip mid-construction ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
  window.advanceTime(4000);
});
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
  window.advanceTime(4000);
  st.paused = true;
});
const mid = await text();
const midJob = mid.constructionJobs[0];
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
s = await text();
check('9 save round-trip preserves workDoneMs',
  s.constructionJobs[0]?.workDoneMs >= midJob?.workDoneMs,
  `${midJob?.workDoneMs} vs ${s.constructionJobs[0]?.workDoneMs}`);
await page.evaluate(() => { window.getGameState().paused = false; });
check('9 save version 12', s.saveVersion === 12);

// --- 10. UI snapshot progress ---
check('10 job progress monotonic', (s.constructionJobs[0]?.progress ?? 0) > 0);
check('10 eta present or paused', s.constructionJobs[0]?.etaMs != null || s.constructionJobs[0]?.status === 'paused');

// --- 11. No console errors ---
check('11 no console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
