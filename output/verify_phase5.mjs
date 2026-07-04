// Phase 5 verification: empire queue, research, trade, AI faction.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try {
  ({ chromium } = createRequire(path.join(__dir, '../package.json'))('playwright'));
} catch {
  ({ chromium } = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/')('playwright'));
}

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

let s = await text();
check('1.1 saveVersion is 7', s.saveVersion === 7);
check('1.2 empireQueue array', Array.isArray(s.empireQueue));
check('1.3 research defaults', s.research?.unlocked?.includes('eco_baseline'));
check('1.4 factions.ai present', s.factions?.ai?.homeSystemId != null);
check('1.5 aiShips array', Array.isArray(s.aiShips));

await page.evaluate(() => {
  window.getGameState().empireQueue.push({ id: 'eq-test', hull: 'corvette', status: 'pending' });
});
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
s = await text();
check('1.6 save round trip queue', s.empireQueue.some((q) => q.id === 'eq-test'));

await page.evaluate(() => window.__newGame(42));
const v6State = await page.evaluate(() => {
  const st = window.getGameState();
  const copy = JSON.parse(JSON.stringify(st));
  delete copy.empireQueue;
  delete copy.research;
  delete copy.factions;
  delete copy.aiShips;
  return copy;
});
const v6Json = JSON.stringify(v6State);
await page.evaluate(([raw, checksum]) => localStorage.setItem('gs-save-slot-2', JSON.stringify({
  saveVersion: 6,
  checksum,
  savedAt: Date.now(),
  state: JSON.parse(raw),
})), [v6Json, crc32(v6Json)]);
await page.evaluate(() => window.__loadSlot('slot-2'));
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
s = await text();
check('1.7 v6 migrates to v7', s.saveVersion === 7 && s.research?.unlocked?.includes('eco_baseline'));

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => { window.getGameState().credits = 5000; });
await page.evaluate(() => window.__seedTestShipyards());
const creditsBefore = (await text()).credits;
const enq = await page.evaluate(() => window.__enqueueHull('corvette'));
check('2.1 enqueue ok', enq.ok);
s = await text();
check('2.2 credits deducted', s.credits < creditsBefore);
check('2.3 queue length 1', s.empireQueue.length >= 1);
const cancel = await page.evaluate(() => {
  const q = window.__getEmpireQueue().find((x) => x.status === 'pending');
  return q ? window.__cancelQueueItem(q.id) : { ok: false };
});
check('2.4 cancel refunds', cancel.ok && cancel.refunded > 0);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => { window.getGameState().credits = 20000; });
await page.evaluate(() => window.__seedTestShipyards());
await page.evaluate(() => window.__enqueueHull('corvette'));
await page.evaluate(() => window.advanceTime(30000));
s = await text();
check('3.1 dispatcher assigns or completes', s.empireQueue.some((q) => q.status === 'building' || q.status === 'complete') || s.playerShips.length > 0);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 50000;
  st.research.unlocked.push('mil_corvette_2', 'mil_parallel_dock');
});
check('4.1 parallel slots', (await text()).production?.shipyardSlots === 2);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => { window.getGameState().credits = 10000; });
await page.evaluate(() => window.__buildResearchStation());
await page.evaluate(() => window.__buildResearchStation());
await page.evaluate(() => window.__buildResearchStation());
const r3 = await page.evaluate(() => window.__buildResearchStation());
check('5.1 cap at 3', !r3.ok);
check('5.2 station count', (await text()).research.stationCount === 3);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => { window.getGameState().credits = 5000; });
check('6.1 prereq gate', !(await page.evaluate(() => window.__startResearch('eco_trade_hub'))).ok);
check('6.2 start research', (await page.evaluate(() => window.__startResearch('eco_outpost_2'))).ok);
await page.evaluate(() => window.advanceTime(120000));
check('6.3 unlock after progress', (await text()).research.unlocked.includes('eco_outpost_2'));

await page.evaluate(() => window.__newGame(42));
s = await text();
check('10.1 AI home set', s.factions.ai.homeSystemId != null);
check('10.2 AI owns systems', s.factions.ai.ownedSystemCount >= 3);
check('10.3 AI not at stronghold', s.factions.ai.homeSystemId !== s.strongholdSystem);

await page.evaluate(() => window.__hydrateGalaxy('gal-0'));
const aiBefore = (await text()).factions.ai.ownedSystemCount;
await page.evaluate(() => window.__dehydrateGalaxy('gal-0'));
await page.evaluate(() => window.__hydrateGalaxy('gal-0'));
check('13.1 hydrate round trip', (await text()).factions.ai.ownedSystemCount === aiBefore);

check('14.1 hooks exist', await page.evaluate(() =>
  typeof window.__enqueueHull === 'function'
  && typeof window.__startResearch === 'function'
  && typeof window.__forceAiCapture === 'function'));
check('14.2 zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
