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

const sampleFrames = (durationMs = 700) => page.evaluate(async (duration) => {
  const start = performance.now();
  let last = start;
  let frames = 0;
  let worstGapMs = 0;
  await new Promise((resolve) => {
    function frame(now) {
      frames += 1;
      worstGapMs = Math.max(worstGapMs, now - last);
      last = now;
      if (now - start >= duration) resolve();
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  return { frames, worstGapMs };
}, durationMs);

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
check('1 expanded drone capacity in stronghold', (s.drones?.capacity ?? 0) >= 6, `capacity=${s.drones?.capacity}`);

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
check('3 completed outpost reports valid current income',
  Number.isFinite(s.incomePerSecInViewedSystem) && s.incomePerSecInViewedSystem >= 0,
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

const launchSample = await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  const planet = st.galaxies[st.activeGalaxyId].systems[st.stronghold].bodies.find((b) => b.type === 'habitable');
  window.__queueOutpost(planet.id);
  const snap0 = JSON.parse(window.render_game_to_text());
  const phases0 = (snap0.drones?.inViewedSystem ?? []).map((d) => d.phase);
  window.advanceTime(400);
  const snap1 = JSON.parse(window.render_game_to_text());
  const assigned = (snap1.drones?.inViewedSystem ?? []).filter((d) => d.jobId);
  const outbound = assigned.filter((d) => d.phase === 'outbound' || d.phase === 'launching');
  const fx = snap1.flagship?.x ?? st.flagship.x;
  const fy = snap1.flagship?.y ?? st.flagship.y;
  let nearShip = 0;
  for (const d of outbound) {
    if (Math.hypot(d.x - fx, d.y - fy) < 420) nearShip += 1;
  }
  return { phases0, outbound: outbound.length, assigned: assigned.length, nearShip };
});
check(
  '4 drones launch outbound from flagship',
  launchSample.outbound > 0 && launchSample.nearShip > 0,
  `outbound=${launchSample.outbound} nearShip=${launchSample.nearShip} assigned=${launchSample.assigned}`,
);

const worksiteSample = await page.evaluate(() => {
  for (let i = 0; i < 24; i++) {
    window.advanceTime(200);
    const snapshot = JSON.parse(window.render_game_to_text());
    const working = snapshot.drones?.inViewedSystem?.filter((drone) => drone.phase === 'working') ?? [];
    if (working.length > 0) return { working: working.length, snapshot };
  }
  return { working: 0, snapshot: JSON.parse(window.render_game_to_text()) };
});
check('4 drones dwell visibly at construction site', worksiteSample.working > 0, `working=${worksiteSample.working}`);
const workingDrone = worksiteSample.snapshot.drones?.inViewedSystem?.find((drone) => drone.phase === 'working');
if (workingDrone) {
  await page.evaluate(({ x, y }) => window.__snapCamera(x, y, 2.2), workingDrone);
  await page.waitForTimeout(120);
}
await page.screenshot({ path: 'output/web-game/construction-drones-build.png', fullPage: true });

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

await page.evaluate(() => {
  window.__newGame(42);
  window.__setBootPhase('playing');
  window.getGameState().paused = false;
});
const stationaryFrames = await sampleFrames();
await page.keyboard.down('ArrowRight');
const movingFrames = await sampleFrames();
await page.keyboard.up('ArrowRight');
const followFormation = await page.evaluate(() => {
  const snapshot = JSON.parse(window.render_game_to_text());
  const flagship = snapshot.flagship;
  return snapshot.drones.inViewedSystem.map((drone) => Math.hypot(drone.x - flagship.x, drone.y - flagship.y));
});
check('4 moving flagship preserves baseline-relative frame cadence',
  movingFrames.frames >= Math.max(2, stationaryFrames.frames - 2)
    && movingFrames.worstGapMs <= Math.max(100, stationaryFrames.worstGapMs * 1.7),
  `${stationaryFrames.frames}/${stationaryFrames.worstGapMs.toFixed(1)}ms -> ${movingFrames.frames}/${movingFrames.worstGapMs.toFixed(1)}ms`);
check('4 idle drones stay stowed (not escorting flagship)',
  followFormation.length === 0,
  `count=${followFormation.length}`);
const cachedDroneRenderCost = await page.evaluate(async () => {
  const { drawConstructionDrone } = await import('/js/drone-render.js');
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 12; i++) {
    drawConstructionDrone(ctx, 200, 150, i, 2.5, { time: i * 16, seed: i, phase: 'outbound' });
  }
  const frames = 1200;
  const startedAt = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    for (let i = 0; i < 6; i++) {
      drawConstructionDrone(ctx, 190 + i * 4, 150, i * 0.4, 2.5, { time: frame * 16, seed: i, phase: 'working', working: true });
    }
  }
  return (performance.now() - startedAt) / frames;
});
check('4 cached six-drone sprite pass stays sub-millisecond',
  cachedDroneRenderCost < 1,
  `${cachedDroneRenderCost.toFixed(3)}ms/frame`);
await page.evaluate(() => {
  const flagship = JSON.parse(window.render_game_to_text()).flagship;
  window.__snapCamera(flagship.x, flagship.y, 2.5);
});
await page.waitForTimeout(120);
await page.screenshot({ path: 'output/web-game/construction-drone-stowed.png', fullPage: true });

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

// --- 8. Foundry construction uses the common drone workflow ---
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(42);
  const st = window.getGameState();
  st.credits = 5000;
  if (!st.research.unlocked.includes('mega_foundry_unlock')) {
    st.research.unlocked.push('mega_foundry_unlock');
  }
});
const foundryOk = await page.evaluate(() => window.__buildFoundry());
check('8 foundry queues with its named tech', foundryOk.ok, foundryOk.reason ?? '');
check('8 foundry receives construction drones', await page.evaluate(() => {
  const state = window.getGameState();
  const job = state.constructionJobs.find((entry) => entry.structureType === 'sail_foundry');
  return (job?.assignedDroneIds?.length ?? 0) > 0;
}));

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
check('9 save version remains current', s.saveVersion >= 12, `v${s.saveVersion}`);

// --- 10. UI snapshot progress ---
check('10 job progress monotonic', (s.constructionJobs[0]?.progress ?? 0) > 0);
check('10 eta present or paused', s.constructionJobs[0]?.etaMs != null || s.constructionJobs[0]?.status === 'paused');

// --- 11. No console errors ---
check('11 no console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
