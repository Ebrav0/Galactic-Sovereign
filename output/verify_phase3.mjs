// Phase 3 verification: Dyson loop + Solarii dual currency (Phase 4 regression: save-v6 shape).
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

const FOUNDRY_COST = 800;
const LAUNCHER_COST = 250;
const SHELL_SAILS_REQUIRED = 5000;
const LAUNCHERS_PER_BODY_MAX = 3;
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

async function unlockDysonBuildTech() {
  await page.evaluate(() => {
    const st = window.getGameState();
    if (!st.research.unlocked.includes('mega_foundry_unlock')) {
      st.research.unlocked.push('mega_foundry_unlock');
    }
    if (!st.research.unlocked.includes('mega_launcher_unlock')) {
      st.research.unlocked.push('mega_launcher_unlock');
    }
  });
}

async function setupDysonInStronghold() {
  await page.evaluate(() => {
    const st = window.getGameState();
    st.credits = 20000;
  });
  await unlockDysonBuildTech();
  const foundry = await page.evaluate(() => window.__buildFoundry());
  const planetId = (await text()).bodies.find((b) => b.type === 'habitable')?.id;
  await page.evaluate((id) => window.__selectPlanet(id), planetId);
  const launcher = await page.evaluate(([id]) => window.__buildLauncher(id), [planetId]);
  return { foundry, launcher, planetId };
}

// --- Section 1: Save v6 shape (Dyson fields from Phase 3) ---
let s = await text();
check('1.1 saveVersion is 9', s.saveVersion === 9);
check('1.2 solarii fields present', s.solarii === 0 && s.solariiUnlocked === false);
check('1.3 dyson summary on viewed system', s.dyson && s.dyson.completedShells === 0);

await page.evaluate(() => {
  const st = window.getGameState();
  st.solarii = 12.5;
  st.galaxies[st.activeGalaxyId].systems[st.stronghold].dyson.completedShells = 2;
});
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
s = await text();
check('1.4 save round trip restores dyson + solarii', s.solarii === 12.5 && s.dyson.completedShells === 2);

// v4 -> v6 migration chain
await page.evaluate(() => window.__newGame(42));
const v4State = await page.evaluate(() => {
  const st = window.getGameState();
  const gal = st.galaxies[st.activeGalaxyId];
  st.playerShips = [{ id: 'mig-ship', hull: 'corvette', systemId: st.stronghold, hp: 100, maxHp: 120, transit: null, galaxyId: st.activeGalaxyId }];
  delete st.solarii;
  delete st.solariiUnlocked;
  for (const s of Object.values(gal.systems)) delete s.dyson;
  const flat = {
    meta: st.meta,
    time: st.time,
    credits: st.credits,
    paused: st.paused,
    stronghold: st.stronghold,
    galaxy: gal.graph,
    systems: gal.systems,
    intel: gal.intel,
    capture: gal.capture,
    flagship: { ...st.flagship, galaxyId: undefined, wormholeTransit: undefined },
    scouts: st.scouts.map((x) => ({ ...x, galaxyId: undefined })),
    playerShips: st.playerShips,
    pirates: st.pirates,
    systemBattles: st.systemBattles,
    battleStance: st.battleStance,
  };
  return JSON.parse(JSON.stringify(flat));
});
const v4StateJson = JSON.stringify(v4State);
const v4Checksum = crc32(v4StateJson);
await page.evaluate(([raw, checksum]) => localStorage.setItem('gs-save-slot-2', JSON.stringify({
  saveVersion: 4,
  checksum,
  savedAt: Date.now(),
  state: JSON.parse(raw),
})), [v4StateJson, v4Checksum]);
await page.evaluate(() => window.__loadSlot('slot-2'));
s = await text();
check('1.5 v4 migrates to v9', s.saveVersion === 9 && s.playerShips.some((sh) => sh.id === 'mig-ship'));
check('1.6 v4 migration adds dyson defaults', s.dyson && typeof s.dyson.shellSails === 'number');

// --- Section 2: Foundry build ---
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => { window.getGameState().credits = 5000; });
await unlockDysonBuildTech();
const f1 = await page.evaluate(() => window.__buildFoundry());
check('2.1 build foundry succeeds', f1.ok);
s = await text();
check('2.2 foundry in structures', s.structures.some((x) => x.type === 'sail_foundry'));
const f2 = await page.evaluate(() => window.__buildFoundry());
check('2.3 second foundry rejected', !f2.ok);

// --- Section 3: Launcher build ---
const planetId = s.bodies.find((b) => b.type === 'habitable')?.id;
const l1 = await page.evaluate(([id]) => window.__buildLauncher(id), [planetId]);
check('3.1 build launcher succeeds', l1.ok);
s = await text();
check('3.2 launcher count is 1', s.dyson.launcherCount === 1);
check('3.3 body launcherCount field', s.bodies.find((b) => b.id === planetId)?.launcherCount === 1);

for (let i = 0; i < LAUNCHERS_PER_BODY_MAX - 1; i++) {
  await page.evaluate(([id]) => window.__buildLauncher(id), [planetId]);
}
const lCap = await page.evaluate(([id]) => window.__buildLauncher(id), [planetId]);
check('3.4 launcher cap at 3/body', !lCap.ok);
s = await text();
check('3.5 three launchers on body', s.bodies.find((b) => b.id === planetId)?.launcherCount === 3);

// moon launcher
await page.evaluate(() => window.__newGame(42));
await setupDysonInStronghold();
const moonId = await page.evaluate(() => {
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
  const planet = sys.bodies.find((b) => b.moons?.length > 0);
  return planet?.moons[0]?.id ?? null;
});
if (moonId) {
  const moonLauncher = await page.evaluate(([id]) => window.__buildLauncher(id), [moonId]);
  check('3.6 moon launcher build', moonLauncher.ok);
} else {
  check('3.6 moon launcher build', true, 'skipped — no moons in home system');
}

// --- Section 4: Sail production ---
await page.evaluate(() => window.__newGame(42));
await setupDysonInStronghold();
const creditsBefore = (await text()).credits;
await page.evaluate(() => window.advanceTime(5000));
s = await text();
check('4.1 credits drain during production', s.credits < creditsBefore);
check('4.2 foundry stock rises', s.dyson.foundryStock > 0 || s.dyson.launcherStockTotal > 0);

// --- Section 5: Shell progress via launchers ---
await page.evaluate(() => window.__newGame(42));
await setupDysonInStronghold();
const launcherId = (await page.evaluate(() => {
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
  return sys.structures.find((x) => x.type === 'dyson_launcher')?.id ?? null;
}));
if (!launcherId) {
  check('5.1 launchers advance shellSails', false, 'no launcher built');
} else {
  await page.evaluate(([id]) => {
    const st = window.getGameState();
    const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
    const launcher = sys.structures.find((x) => x.id === id);
    if (launcher) {
      sys.dyson.launcherStock[id] = 100;
      sys.dyson.launcherLastFireAt[id] = 0;
    }
  }, [launcherId]);
  await page.evaluate(() => window.advanceTime(10000));
  s = await text();
  check('5.1 launchers advance shellSails', s.dyson.shellSails > 0);
}

// --- Section 6: Shell completion ---
await page.evaluate(() => window.__newGame(42));
await setupDysonInStronghold();
await page.evaluate(([sid, sails]) => window.__forceShellProgress(sid, sails), [s.strongholdSystem, SHELL_SAILS_REQUIRED]);
s = await text();
check('6.1 shell completion increments tier', s.dyson.completedShells === 1);
check('6.2 shell counter resets progress', s.dyson.shellSails < SHELL_SAILS_REQUIRED);
check('6.3 solarii unlocked after shell 1', s.solariiUnlocked === true);

// --- Section 7: Solarii income ---
await page.evaluate(() => window.advanceTime(10000));
s = await text();
check('7.1 solarii income after shell 1', s.solarii > 0);
check('7.2 solariiPerSec > 0', s.solariiPerSec > 0);

await page.evaluate(() => {
  const st = window.getGameState();
  st.galaxies[st.activeGalaxyId].systems[st.stronghold].dyson.completedShells = 2;
});
await page.evaluate(() => window.advanceTime(5000));
const rate2 = (await text()).solariiPerSec;
await page.evaluate(() => {
  const st = window.getGameState();
  st.galaxies[st.activeGalaxyId].systems[st.stronghold].dyson.completedShells = 1;
});
s = await text();
check('7.3 solarii scales with shell tier', rate2 > s.solariiPerSec);

// --- Section 8: Credit bonus shell 2 ---
await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
  const planet = sys.bodies.find((b) => b.type === 'habitable');
  sys.structures.push({ id: 'op-bonus', type: 'outpost', bodyId: planet.id, builtAtTime: 0 });
  sys.dyson.completedShells = 1;
});
const income1 = (await text()).incomePerSecInViewedSystem;
await page.evaluate(() => {
  window.getGameState().galaxies[window.getGameState().activeGalaxyId].systems[window.getGameState().stronghold].dyson.completedShells = 2;
});
const income2 = (await text()).incomePerSecInViewedSystem;
check('8.1 shell 2 credit bonus', income2 > income1);

// --- Section 9: Capture weight ---
await page.evaluate(() => window.__newGame(42));
const baseReq = (await text()).intel.captureRequirement;
await setupDysonInStronghold();
const withStructReq = (await text()).intel.captureRequirement;
check('9.1 dyson structures increase capture req', withStructReq > baseReq);
s = await text();
await page.evaluate(([sid, sails]) => window.__forceShellProgress(sid, sails), [s.strongholdSystem, SHELL_SAILS_REQUIRED]);
const withShellReq = (await text()).intel.captureRequirement;
check('9.2 completed shells increase capture req', withShellReq > withStructReq);

// --- Section 10: Capture persistence ---
await page.evaluate(() => window.__newGame(42));
const neighborId = await page.evaluate(() => {
  const st = window.getGameState();
  return st.galaxies[st.activeGalaxyId].graph.stars.find((x) => x.id !== st.stronghold).id;
});
await page.evaluate(([nid]) => {
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[nid];
  sys.dyson.completedShells = 0;
  sys.dyson.shellSails = 1200;
  sys.structures.push({ id: 'st-cap-f', type: 'sail_foundry', bodyId: null, builtAtTime: 0 });
  sys.structures.push({ id: 'st-cap-l', type: 'dyson_launcher', bodyId: sys.bodies[0]?.id ?? 'p1', builtAtTime: 0 });
  st.galaxies[st.activeGalaxyId].intel[nid] = { gatheredAt: 0 };
  st.playerShips = [
    { id: 'cap-d1', hull: 'destroyer', systemId: nid, galaxyId: st.activeGalaxyId, hp: 350, maxHp: 350, transit: null },
    { id: 'cap-d2', hull: 'destroyer', systemId: nid, galaxyId: st.activeGalaxyId, hp: 350, maxHp: 350, transit: null },
    { id: 'cap-d3', hull: 'destroyer', systemId: nid, galaxyId: st.activeGalaxyId, hp: 350, maxHp: 350, transit: null },
    { id: 'cap-d4', hull: 'destroyer', systemId: nid, galaxyId: st.activeGalaxyId, hp: 350, maxHp: 350, transit: null },
    { id: 'cap-f1', hull: 'frigate', systemId: nid, galaxyId: st.activeGalaxyId, hp: 200, maxHp: 200, transit: null },
    { id: 'cap-f2', hull: 'frigate', systemId: nid, galaxyId: st.activeGalaxyId, hp: 200, maxHp: 200, transit: null },
    { id: 'cap-d5', hull: 'destroyer', systemId: nid, galaxyId: st.activeGalaxyId, hp: 350, maxHp: 350, transit: null },
  ];
  st.flagship.galaxyId = st.activeGalaxyId;
  st.flagship.systemId = nid;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  st.pirates.fleets.forEach((f) => { f.systemId = 'core'; f.transit = null; f.galaxyId = st.activeGalaxyId; });
}, [neighborId]);
await page.evaluate(([nid]) => window.__viewSystem(nid), [neighborId]);
await page.evaluate(([ms]) => window.advanceTime(ms), [CAPTURE_HOLD_MS + 500]);
s = await text();
check('10.1 system captured', s.systemOwner === 'player');
const persisted = await page.evaluate(([nid]) => {
  const sys = window.getGameState().galaxies[window.getGameState().activeGalaxyId].systems[nid];
  return { shells: sys.dyson.completedShells, sails: sys.dyson.shellSails, foundry: sys.structures.some((x) => x.type === 'sail_foundry') };
}, [neighborId]);
check('10.2 dyson progress persists on capture', persisted.shells === 0 && persisted.sails >= 1200 && persisted.foundry);

// --- Section 11: Pause ---
await page.evaluate(() => window.__newGame(42));
await setupDysonInStronghold();
await page.evaluate(() => {
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
  const launcher = sys.structures.find((x) => x.type === 'dyson_launcher');
  sys.dyson.launcherStock[launcher.id] = 200;
  sys.dyson.launcherLastFireAt[launcher.id] = 0;
});
await page.evaluate(() => { window.getGameState().paused = true; });
const sailsAtPause = (await text()).dyson.shellSails;
await page.evaluate(() => window.advanceTime(5000));
const sailsWhilePaused = (await text()).dyson.shellSails;
check('11.1 pause freezes shell progress', sailsWhilePaused === sailsAtPause);
await page.evaluate(() => { window.getGameState().paused = false; });

// --- Section 12: Determinism ---
const snap = async (seed) => {
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(([s]) => window.__newGame(s), [seed]);
  await page.evaluate(() => { window.getGameState().paused = false; });
  await setupDysonInStronghold();
  await page.evaluate(() => window.__grantCredits(50000));
  await page.evaluate(() => window.advanceTime(120000));
  return page.evaluate(() => {
    window.getGameState().paused = true;
    const t = JSON.parse(window.render_game_to_text());
    return {
      dyson: {
        completedShells: t.dyson?.completedShells ?? 0,
        shellSails: Math.floor(t.dyson?.shellSails ?? 0),
        foundryStock: Math.round((t.dyson?.foundryStock ?? 0) * 100) / 100,
      },
      solarii: Math.round((t.solarii ?? 0) * 1000) / 1000,
      credits: Math.floor(t.credits),
    };
  });
};
const a = await snap(42);
const b = await snap(42);
check('12.1 determinism dyson snapshot', JSON.stringify(a) === JSON.stringify(b));

// --- Section 13: Visual observables ---
await page.evaluate(() => window.__newGame(42));
await setupDysonInStronghold();
s = await text();
check('13.1 sail shuttles active with foundry+launcher', s.sailShuttles.count > 0);

// --- Section 14: Hygiene ---
check('14.1 test hooks exist',
  await page.evaluate(() =>
    typeof window.__buildFoundry === 'function'
    && typeof window.__buildLauncher === 'function'
    && typeof window.__grantCredits === 'function'
    && typeof window.__forceShellProgress === 'function'));
check('14.2 zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
