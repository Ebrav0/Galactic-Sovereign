// Phase 4 verification: multi-galaxy scale, wormholes, abstract sim, stronghold roster.
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
const WORMHOLE_TRANSIT_MS = 8000;
const CAPTURE_HOLD_MS = 20000;

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
await page.evaluate(() => {
  window.__newGame(42);
  window.getGameState().paused = true;
});

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

async function resetWormholeAnchors() {
  await page.evaluate(() => {
    const st = window.getGameState();
    for (const wh of Object.values(st.wormholes ?? {})) {
      wh.anchor = null;
      wh.anchorOwner = null;
    }
    for (const gal of Object.values(st.galaxies ?? {})) {
      const core = gal.systems?.core;
      if (core?.structures) {
        core.structures = core.structures.filter((s) => s.type !== 'wormhole_anchor');
      }
    }
  });
}

// --- Section 1: Save v6 ---
let s = await text();
check('1.1 saveVersion is 20', s.saveVersion === 20);
check('1.2 metaGalaxy present', s.metaGalaxy && s.metaGalaxy.activeGalaxyId === 'gal-0');
check('1.3 wormholes summary', s.wormholes && s.wormholes.count === 10);

await page.evaluate(() => {
  const st = window.getGameState();
  st.solarii = 7.5;
});
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
s = await text();
check('1.4 save round trip', Math.abs(s.solarii - 7.5) < 0.1 && s.metaGalaxy.galaxyCount === 10);

// v5 migration
await page.evaluate(() => {
  window.__newGame(42);
  window.getGameState().paused = true;
});
const v5State = await page.evaluate(() => {
  const st = window.getGameState();
  const flat = {
    meta: st.meta,
    time: st.time,
    credits: st.credits,
    paused: st.paused,
    stronghold: st.stronghold,
    galaxy: st.galaxies['gal-0'].graph,
    systems: st.galaxies['gal-0'].systems,
    intel: st.galaxies['gal-0'].intel,
    capture: st.galaxies['gal-0'].capture,
    flagship: { ...st.flagship, galaxyId: undefined, wormholeTransit: undefined },
    scouts: st.scouts.map((x) => ({ ...x, galaxyId: undefined })),
    playerShips: st.playerShips,
    pirates: st.pirates,
    systemBattles: st.systemBattles,
    battleStance: st.battleStance,
    solarii: st.solarii,
    solariiUnlocked: st.solariiUnlocked,
  };
  return JSON.parse(JSON.stringify(flat));
});
const v5Json = JSON.stringify(v5State);
const v5Checksum = crc32(v5Json);
await page.evaluate(([raw, checksum]) => localStorage.setItem('gs-save-slot-2', JSON.stringify({
  saveVersion: 5,
  checksum,
  savedAt: Date.now(),
  state: JSON.parse(raw),
})), [v5Json, v5Checksum]);
await page.evaluate(() => window.__loadSlot('slot-2'));
s = await text();
check('1.5 v5 migrates to v20', s.saveVersion === 20 && s.metaGalaxy.galaxyCount === 10);

// --- Section 2: 400-star gen ---
await page.evaluate(() => window.__newGame(42));
s = await text();
check('2.1 starCount 400', s.galaxy.starCount === 400, `stars=${s.galaxy.starCount}`);
const stats = await page.evaluate(() => window.__getGraphStats());
check('2.2 avg degree 2-4', stats.avgDegree >= 2 && stats.avgDegree <= 4, `avg=${stats.avgDegree.toFixed(2)}`);
check('2.3 black hole lanes >=2', stats.blackHoleDegree >= 2, `bh=${stats.blackHoleDegree}`);
check('2.4 diameter band', stats.diameter >= 10 && stats.diameter <= 35, `d=${stats.diameter}`);

// --- Section 2b: uniqueness ---
const fps = await page.evaluate(() => window.__listGalaxyIds().map((id) => window.__getGalaxyFingerprint(id)));
check('2b.1 all fingerprints unique', new Set(fps).size === fps.length, `count=${fps.length}`);
await page.evaluate(() => window.__newGame(99));
const fp99 = await page.evaluate(() => window.__getGalaxyFingerprint('gal-0'));
await page.evaluate(() => window.__newGame(42));
const fp42 = await page.evaluate(() => window.__getGalaxyFingerprint('gal-0'));
check('2b.2 seed changes fingerprint', fp42 !== fp99);

// --- Section 2c: stronghold roster ---
const comp = await page.evaluate(() => window.__getStrongholdComposition());
check('2c.1 five habitable', comp.planetCounts?.habitable === 5);
check('2c.2 one barren', comp.planetCounts?.barren === 1);
check('2c.3 two gas', comp.planetCounts?.gas === 2);
check('2c.4 eight total', comp.planetCounts?.total === 8);
check('2c.5 moons vary by seed', comp.moonCounts?.length === 8 && comp.moonCounts.some((n) => n > 0));

// --- Section 2d: stronghold location ---
const sh42 = s.strongholdSystem;
await page.evaluate(() => window.__newGame(99));
const sh99 = (await text()).strongholdSystem;
check('2d.1 location differs by seed', sh42 !== sh99, `${sh42} vs ${sh99}`);
await page.evaluate(() => window.__newGame(42));
const sh42b = (await text()).strongholdSystem;
check('2d.2 same seed same location', sh42 === sh42b);

// --- Section 3: multi-galaxy init ---
s = await text();
check('3.1 galaxyCount 10', s.metaGalaxy.galaxyCount === 10);
check('3.2 one hydrated', s.metaGalaxy.hydratedCount === 1);
check('3.3 nine abstract', s.abstractGalaxies.length === 9);

// --- Section 4: regression build ---
await page.evaluate(() => { window.getGameState().credits = 5000; });
await unlockDysonBuildTech();
const fRes = await page.evaluate(() => window.__buildFoundry());
check('4.1 foundry builds', fRes.ok);
const planetId = (await text()).bodies.find((b) => b.type === 'habitable')?.id;
await page.evaluate((id) => window.__selectPlanet(id), [planetId]);
check('4.2 outpost on habitable', (await page.evaluate(async ([id]) => {
  const res = window.__buildOutpost(id);
  if (res.ok) window.advanceTime(20000);
  return res.ok;
}, [planetId])));

// --- Section 5: abstract tick ---
const absBefore = (await text()).abstractGalaxies[0]?.aiCredits ?? 0;
await page.evaluate(() => window.advanceTime(30000));
const absAfter = (await text()).abstractGalaxies[0]?.aiCredits ?? 0;
check('5.1 abstract stats change', absAfter > absBefore);
await page.evaluate(() => { window.getGameState().paused = true; });
const absPaused = (await text()).abstractGalaxies[0]?.aiCredits ?? 0;
await page.evaluate(() => window.advanceTime(10000));
check('5.2 pause freezes abstract', (await text()).abstractGalaxies[0]?.aiCredits === absPaused);
await page.evaluate(() => { window.getGameState().paused = false; });

// --- Section 6: hydration ---
const fp1before = await page.evaluate(() => window.__getGalaxyFingerprint('gal-1'));
await page.evaluate(() => window.__hydrateGalaxy('gal-1'));
const sysCount = await page.evaluate(() => Object.keys(window.getGameState().galaxies['gal-1'].systems).length);
check('6.1 hydrates 401 systems', sysCount === 401);
check('6.2 graph unchanged', (await page.evaluate(() => window.__getGalaxyFingerprint('gal-1'))) === fp1before);
check('6.3 gal-1 != gal-0', fp1before !== fp42);

// --- Section 7: dehydration round trip ---
await page.evaluate(() => window.__dehydrateGalaxy('gal-1'));
await page.evaluate(() => window.__hydrateGalaxy('gal-0'));
await page.evaluate(() => window.__hydrateGalaxy('gal-1'));
check('7.1 rehydrate works', (await page.evaluate(() => window.getGameState().galaxies['gal-1'].status)) === 'active');

// --- Section 8: unanchored wormhole ---
await page.evaluate(() => window.__hydrateGalaxy('gal-0'));
await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.galaxyId = 'gal-0';
  st.flagship.systemId = 'core';
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  st.activeGalaxyId = 'gal-0';
});
const jump = await page.evaluate(() => window.__enterWormhole({}));
check('8.1 enter wormhole ok', jump.ok);
await page.evaluate(() => window.__completeWormholeTransit());
s = await text();
check('8.2 active galaxy changed', s.metaGalaxy.activeGalaxyId !== 'gal-0');
check('8.3 flagship at core', s.flagship.systemId === 'core');

// --- Section 9: anchored wormhole ---
await page.evaluate(() => window.__hydrateGalaxy('gal-0'));
await resetWormholeAnchors();
await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 10000;
  st.flagship.galaxyId = 'gal-0';
  st.flagship.systemId = 'core';
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  st.activeGalaxyId = 'gal-0';
});
const anchor = await page.evaluate(() => window.__buildWormholeAnchor('gal-2'));
check('9.1 anchor built', anchor.ok);
await page.evaluate(() => window.__resetWormholeJumpCounter(0));
const j1 = await page.evaluate(() => window.__enterWormhole({ forceAnchored: true }));
await page.evaluate(() => window.__completeWormholeTransit());
const galAfter1 = (await text()).metaGalaxy.activeGalaxyId;
await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.systemId = 'core';
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
});
const j2 = await page.evaluate(() => window.__enterWormhole({ forceAnchored: true }));
await page.evaluate(() => window.__completeWormholeTransit());
const galAfter2 = (await text()).metaGalaxy.activeGalaxyId;
check('9.2 anchored pair routes', galAfter1 === 'gal-2' && galAfter2 === 'gal-0', `${galAfter1} -> ${galAfter2}`);

// --- Section 10: wormhole pause ---
await page.evaluate(() => window.__hydrateGalaxy('gal-0'));
await resetWormholeAnchors();
const progPause = await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.galaxyId = 'gal-0';
  st.activeGalaxyId = 'gal-0';
  st.flagship.systemId = 'core';
  st.flagship.wormholeTransit = null;
  st.flagship.transit = null;
  st.paused = false;
  const jump = window.__enterWormhole({});
  if (!jump.ok) return { ok: false, reason: jump.reason, progress: 0 };
  st.paused = true;
  return {
    ok: true,
    progress: JSON.parse(window.render_game_to_text()).flagship.wormholeTransit?.progress ?? 0,
  };
});
await page.evaluate(() => window.advanceTime(5000));
check('10.1 pause freezes wormhole', progPause.ok && (await text()).flagship.wormholeTransit?.progress === progPause.progress, progPause.reason ?? '');
await page.evaluate(() => { window.getGameState().paused = false; });

// --- Section 11: determinism snapshot ---
await page.evaluate(() => {
  window.__newGame(42);
  window.getGameState().paused = true;
});
const snap = async () => {
  const t = await text();
  return {
    stronghold: t.strongholdSystem,
    fp: await page.evaluate(() => window.__getGalaxyFingerprint('gal-0')),
    abstract: t.abstractGalaxies[0]?.aiCredits,
  };
};
const d1 = await snap();
await page.evaluate(() => window.advanceTime(5000));
await page.evaluate(() => {
  window.__newGame(42);
  window.getGameState().paused = true;
});
const d2 = await snap();
check('11.1 determinism new game', d1.stronghold === d2.stronghold
  && d1.fp === d2.fp && Math.abs((d1.abstract ?? 0) - (d2.abstract ?? 0)) < 1);

// --- Section 12: performance smoke ---
const t0 = Date.now();
await page.evaluate(() => window.render_game_to_text());
check('12.1 render under 3.5s', Date.now() - t0 < 3500, `${Date.now() - t0}ms`);

// --- Section 13: hooks ---
check('13.1 hooks exist', await page.evaluate(() =>
  typeof window.__enterWormhole === 'function'
  && typeof window.__buildWormholeAnchor === 'function'
  && typeof window.__hydrateGalaxy === 'function'
  && typeof window.__completeWormholeTransit === 'function'
  && typeof window.__getGalaxyFingerprint === 'function'
  && typeof window.__getStrongholdComposition === 'function'));

// --- Section 14: hygiene ---
check('14.1 zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
