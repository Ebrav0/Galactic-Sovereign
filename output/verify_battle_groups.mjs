// Battle group fleets verification.
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

const SAVE_VERSION = 8;

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

const addShip = (id, systemId = null) => page.evaluate(([shipId, sysId]) => {
  const st = window.getGameState();
  const loc = sysId ?? st.stronghold;
  st.playerShips.push({
    id: shipId,
    hull: 'corvette',
    galaxyId: st.activeGalaxyId,
    systemId: loc,
    hp: 120,
    maxHp: 120,
    transit: null,
  });
}, [id, systemId]);

// --- Section 1: Naming and creation ---
let g1 = await page.evaluate(() => window.__createBattleGroup());
check('1.1 first fleet name', g1.ordinal === 1 && g1.shipIds.length === 0,
  `ordinal=${g1.ordinal}`);

let g2 = await page.evaluate(() => window.__createBattleGroup());
check('1.2 second fleet name', g2.ordinal === 3, `ordinal=${g2.ordinal}`);

await page.evaluate((id) => window.__deleteBattleGroup(id), g1.id);
const g3 = await page.evaluate(() => window.__createBattleGroup());
check('1.3 ordinal after delete', g3.ordinal === 5, `ordinal=${g3.ordinal}`);

check('1.4 formatFleetName edge cases',
  await page.evaluate(() =>
    window.__formatFleetName(11) === '11th Fleet'
    && window.__formatFleetName(21) === '21st Fleet'
    && window.__formatFleetName(22) === '22nd Fleet'));

// --- Section 2: Assignment ---
await page.evaluate(() => window.__newGame(42));
await addShip('ship-a');
await addShip('ship-b');
const groups = await page.evaluate(() => window.__createBattleGroup());
await page.evaluate(([gid, sid]) => window.__assignShipToGroup(sid, gid), [groups.id, 'ship-a']);
let snap = await text();
check('2.1 assign ship to fleet',
  snap.battleGroups[0].shipIds.includes('ship-a')
  && !snap.battleGroups.some((g) => g.shipIds.includes('ship-b') && g.id !== groups.id));

const gSecond = await page.evaluate(() => window.__createBattleGroup());
await page.evaluate(([gid, sid]) => window.__assignShipToGroup(sid, gid), [gSecond.id, 'ship-b']);
await page.evaluate(([gid, sid]) => window.__assignShipToGroup(sid, gid), [groups.id, 'ship-b']);
snap = await text();
const inFirst = snap.battleGroups.find((g) => g.id === groups.id);
const inSecond = snap.battleGroups.find((g) => g.id === gSecond.id);
check('2.2 move ship between fleets',
  inFirst?.shipIds.includes('ship-b') && !inSecond?.shipIds.includes('ship-b'));

await page.evaluate((sid) => window.__assignShipToGroup(sid, null), 'ship-b');
snap = await text();
check('2.3 unassign ship',
  snap.battleGroups.every((g) => !g.shipIds.includes('ship-b')));

await page.evaluate(([gid, sid]) => window.__assignShipToGroup(sid, gid), [groups.id, 'ship-b']);
await page.evaluate((gid) => window.__deleteBattleGroup(gid), groups.id);
snap = await text();
check('2.4 delete fleet with ships',
  !snap.battleGroups.some((g) => g.id === groups.id)
  && snap.battleGroups.every((g) => !g.shipIds.includes('ship-a') && !g.shipIds.includes('ship-b')));

const neighborOfStronghold = () => page.evaluate(() => {
  const st = window.getGameState();
  const lanes = st.galaxies['gal-0'].graph.lanes;
  const lane = lanes.find(([a, b]) => a === st.stronghold || b === st.stronghold);
  return lane[0] === st.stronghold ? lane[1] : lane[0];
});
await page.evaluate(() => window.__newGame(42));
await addShip('ship-1');
await addShip('ship-2');
const neighborId = await neighborOfStronghold();
const dispatchSetup = await page.evaluate((destId) => {
  const g = window.__createBattleGroup();
  window.__assignShipToGroup('ship-1', g.id);
  window.__assignShipToGroup('ship-2', g.id);
  window.__selectBattleGroup(g.id);
  return { groupId: g.id, neighborId: destId };
}, neighborId);

const dispatchRes = await page.evaluate((targetId) => window.__orderBattleGroup(targetId), dispatchSetup.neighborId);
check('3.2 dispatch two ships', dispatchRes.ok && dispatchRes.dispatched === 2,
  `dispatched=${dispatchRes.dispatched}`);

snap = await text();
check('3.2b both ships in transit',
  snap.playerShips.filter((s) => s.inTransit).length === 2);

await page.evaluate(() => window.__newGame(42));
await addShip('ship-idle');
await addShip('ship-busy');
const partialNeighbor = await neighborOfStronghold();
const partialSetup = await page.evaluate((destId) => {
  const g = window.__createBattleGroup();
  window.__assignShipToGroup('ship-idle', g.id);
  window.__assignShipToGroup('ship-busy', g.id);
  window.__dispatchShip('ship-busy', destId);
  window.__selectBattleGroup(g.id);
  return destId;
}, partialNeighbor);

const partialRes = await page.evaluate((targetId) => window.__orderBattleGroup(targetId), partialSetup);
check('3.3 partial dispatch skips in-transit',
  partialRes.ok && partialRes.dispatched === 1 && partialRes.skipped === 1,
  `dispatched=${partialRes.dispatched} skipped=${partialRes.skipped}`);

const noSelectRes = await page.evaluate((targetId) => {
  window.__selectBattleGroup(null);
  return window.__orderBattleGroup(targetId);
}, partialSetup);
check('3.4 no fleet selected', !noSelectRes.ok && /select a fleet/i.test(noSelectRes.reason ?? ''));

await page.evaluate(() => window.__newGame(42));
await addShip('solo-ship');
const unreachableRes = await page.evaluate(() => {
  const st = window.getGameState();
  const g = window.__createBattleGroup();
  window.__assignShipToGroup('solo-ship', g.id);
  window.__selectBattleGroup(g.id);
  return window.__orderBattleGroup(st.stronghold);
});
check('3.5 already at target', !unreachableRes.ok && unreachableRes.dispatched === 0);

// --- Section 4: Save/load v8 ---
await page.evaluate(() => window.__newGame(42));
await addShip('save-ship');
await page.evaluate(() => {
  const g = window.__createBattleGroup();
  window.__assignShipToGroup('save-ship', g.id);
});
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
snap = await text();
check('4.1 save version 8', snap.saveVersion === SAVE_VERSION, `version=${snap.saveVersion}`);
check('4.2 load restores battle groups',
  snap.battleGroups.length >= 1 && snap.battleGroups.some((g) => g.shipIds.includes('save-ship')));

// v7 migration
const v7Envelope = await page.evaluate(() => {
  const st = window.getGameState();
  st.battleGroups = undefined;
  const stateJson = JSON.stringify(st);
  return {
    saveVersion: 7,
    checksum: null,
    savedAt: Date.now(),
    state: JSON.parse(stateJson),
  };
});
v7Envelope.checksum = crc32(JSON.stringify(v7Envelope.state));
await page.evaluate((env) => localStorage.setItem('gs-save-slot-2', JSON.stringify(env)), v7Envelope);
await page.evaluate(() => window.__loadSlot('slot-2'));
snap = await text();
check('4.3 v7 migration', snap.saveVersion === SAVE_VERSION && Array.isArray(snap.battleGroups),
  `groups=${snap.battleGroups?.length ?? 'missing'}`);

// --- Section 5: Regression guards ---
check('5.1 no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

const flagshipTravel = await page.evaluate(async () => {
  const st = window.getGameState();
  const lanes = st.galaxies['gal-0'].graph.lanes;
  const lane = lanes.find(([a, b]) => a === st.stronghold || b === st.stronghold);
  const neighborId = lane[0] === st.stronghold ? lane[1] : lane[0];
  return window.__orderTravel(neighborId);
});
check('5.2 flagship travel', flagshipTravel.ok);

await page.evaluate(() => {
  const st = window.getGameState();
  st.scouts.push({
    id: 'scout-test',
    galaxyId: st.activeGalaxyId,
    systemId: st.stronghold,
    transit: null,
  });
});
const scoutTravel = await page.evaluate(() => {
  const st = window.getGameState();
  const lanes = st.galaxies['gal-0'].graph.lanes;
  const lane = lanes.find(([a, b]) => a === st.stronghold || b === st.stronghold);
  const neighborId = lane[0] === st.stronghold ? lane[1] : lane[0];
  return window.__orderScout('scout-test', neighborId);
});
check('5.3 scout travel', scoutTravel.ok);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
