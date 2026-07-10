// Same-browser baseline comparison for convoy-heavy galaxy rendering and 150+
// unit deterministic tactical LOD. Warm-up frames are excluded explicitly.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');
const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Infinity;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => window.__newGame(0x501d));
await page.evaluate(() => window.__setView('galaxy'));
await page.waitForTimeout(1800);

async function sampleDraws(count = 24) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    await page.waitForTimeout(70);
    samples.push(await page.evaluate(() => window.__galaxyPerfSummary().lastDrawMs));
  }
  return samples;
}

const baseline = await sampleDraws();
await page.evaluate(() => {
  const state = window.getGameState();
  state.paused = true;
  const graph = state.galaxies[state.activeGalaxyId].graph;
  const [fromId, toId] = graph.lanes.find(([a, b]) => a !== 'core' && b !== 'core');
  state.logistics.convoys = Array.from({ length: 120 }, (_, index) => ({
    id: `perf-convoy-${index}`,
    galaxyId: state.activeGalaxyId,
    depotId: `perf-depot-${index}`,
    fromSystemId: fromId,
    destinationSystemId: toId,
    path: [fromId, toId],
    legIndex: 0,
    currentNodeId: fromId,
    status: 'in_transit',
    systemId: null,
    dispatchedAt: 0,
    jumpStartedAt: 0,
    jumpEndsAt: 0,
    legStartTime: -index * 11,
    legDurationMs: 120000,
    manifest: { rawMaterials: 12, fuel: 8, manufacturedGoods: 6 },
    deliveryValue: 0,
    escortStrength: index % 4 === 0 ? 20 : 0,
    armor: 1,
  }));
});
await page.waitForTimeout(600);
const convoyHeavy = await sampleDraws();
const baseMedian = percentile(baseline, 0.5);
const convoyMedian = percentile(convoyHeavy, 0.5);
const convoyP95 = percentile(convoyHeavy, 0.95);
const regression = baseMedian > 0 ? (convoyMedian - baseMedian) / baseMedian : 0;
check('convoy-heavy galaxy has no sustained render regression above 15%',
  regression <= 0.15, `baseline=${baseMedian.toFixed(2)}ms convoy=${convoyMedian.toFixed(2)}ms regression=${(regression * 100).toFixed(1)}%`);
check('convoy-heavy p95 render remains below 50 ms', convoyP95 < 50, `p95=${convoyP95.toFixed(2)}ms`);

const tacticalPerf = await page.evaluate(() => {
  const state = window.getGameState();
  state.paused = false;
  state.logistics.convoys = [];
  const systemId = state.stronghold;
  state.flagship.systemId = systemId;
  state.flagship.transit = null;
  state.research.unlocked.push('mil_carrier_launch_doctrine');
  for (let i = 0; i < 75; i++) {
    state.playerShips.push({
      id: `perf-friendly-${i}`, hull: i % 8 === 0 ? 'destroyer' : 'corvette',
      galaxyId: state.activeGalaxyId, systemId,
      hp: i % 8 === 0 ? 900 : 500, maxHp: i % 8 === 0 ? 900 : 500,
      transit: null,
    });
  }
  state.pirates.fleets.push({
    id: 'perf-enemy-swarm', galaxyId: state.activeGalaxyId, systemId,
    transit: null, wanderCooldownMs: 999999,
    ships: Array.from({ length: 100 }, (_, i) => ({
      id: `perf-enemy-${i}`, hull: i % 10 === 0 ? 'frigate' : 'corvette',
      hp: i % 10 === 0 ? 900 : 500, maxHp: i % 10 === 0 ? 900 : 500,
    })),
  });
  window.__viewSystem(systemId);
  window.advanceTime(50);
  const durations = [];
  for (let i = 0; i < 160; i++) {
    const start = performance.now();
    window.advanceTime(50);
    durations.push(performance.now() - start);
  }
  const battle = window.__getBattleState(systemId);
  return {
    durations,
    lodSignature: battle?.lodSignature ?? null,
    lodConservation: battle?.lodConservation ?? false,
  };
});
const tickP95 = percentile(tacticalPerf.durations, 0.95);
const tickMax = Math.max(...tacticalPerf.durations);
check('150+ unit battle activates deterministic LOD signature',
  typeof tacticalPerf.lodSignature === 'string' && tacticalPerf.lodConservation);
check('150+ unit simulation p95 has no 50 ms hitch', tickP95 < 50, `p95=${tickP95.toFixed(2)}ms max=${tickMax.toFixed(2)}ms`);
check('performance run has no console errors', errors.length === 0, errors.join(' | '));

await browser.close();
const passed = results.filter((result) => result.pass).length;
console.log(`\nOverhaul performance: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
