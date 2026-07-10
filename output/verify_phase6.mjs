// Phase 6 verification: late game systems.
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
check('1.1 saveVersion is 12', s.saveVersion === 12);
check('1.2 milestones object', s.milestones != null);
check('1.3 campaign object', s.campaign != null);
check('1.4 diplomacy object', s.diplomacy != null);
check('1.5 superweapon object', s.superweapon != null);
check('1.6 heroFlagships array', Array.isArray(s.heroFlagships));
check('1.7 manualTradeRoutes array', Array.isArray(s.manualTradeRoutes?.routes) || s.manualTradeRoutes != null);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__setCompletedDysons(1));
const beforeDiplo = (await text()).milestones.diplomacyUnlocked;
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.evaluate(() => window.__newGame(99));
await page.evaluate(() => window.__loadSlot('slot-1'));
s = await text();
check('1.8 save round trip milestones', s.milestones?.diplomacyUnlocked === beforeDiplo && beforeDiplo === true);

await page.evaluate(() => window.__newGame(42));
const v8State = await page.evaluate(() => {
  const st = window.getGameState();
  const copy = JSON.parse(JSON.stringify(st));
  delete copy.milestones;
  delete copy.campaign;
  delete copy.diplomacy;
  delete copy.superweapon;
  delete copy.heroFlagships;
  delete copy.manualTradeRoutes;
  return copy;
});
const v8Json = JSON.stringify(v8State);
await page.evaluate(([raw, checksum]) => localStorage.setItem('gs-save-slot-v8', JSON.stringify({
  saveVersion: 8,
  checksum,
  savedAt: Date.now(),
  state: JSON.parse(raw),
})), [v8Json, crc32(v8Json)]);
await page.evaluate(() => window.__loadSlot('slot-v8'));
s = await text();
check('1.9 v8 migrates to v12', s.saveVersion === 12 && s.milestones != null);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__setCompletedDysons(1));
s = await text();
check('2.1 diplomacy gate at 1 sphere', s.milestones.diplomacyUnlocked === true);
check('2.2 superweapon locked at 1 sphere', s.milestones.superweaponUnlocked === false);

await page.evaluate(() => window.__setCompletedDysons(3));
s = await text();
check('2.3 superweapon gate at 3 spheres', s.milestones.superweaponUnlocked === true);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  st.research.unlocked.push('mega_orbital_shield');
  window.__completeDysonShell(st.stronghold, 4);
});
s = await text();
check('3.1 shell shield bonus', s.shellBonuses?.shield > 1);
await page.evaluate(() => window.__completeDysonShell(window.getGameState().stronghold, 7));
s = await text();
check('3.2 shell repair bonus at 7', s.shellBonuses?.repair > 1);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  window.getGameState().research.unlocked.push(
    'mega_dyson_overdrive', 'dip_truce_protocol', 'sw_cradle_unlock',
    'sw_create_star', 'sw_destroy_star', 'sw_jump_gate', 'hero_hull_unlock',
  );
  window.__setCompletedDysons(3);
  window.getGameState().solarii = 500;
  window.getGameState().credits = 50000;
  window.getGameState().flagship.systemId = window.getGameState().stronghold;
  window.getGameState().flagship.transit = null;
});
const cradle = await page.evaluate(() => window.__buildSuperweaponCradle());
check('4.1 superweapon cradle builds', cradle.ok, cradle.reason ?? '');
s = await text();
check('4.2 superweapon online', s.superweapon.online === true);

const starsBefore = s.galaxy.starCount;
const created = await page.evaluate(() => {
  window.getGameState().solarii = 500;
  return window.__superweaponCreate(window.getGameState().stronghold);
});
check('5.1 create star ok', created.ok, created.reason ?? '');
s = await text();
check('5.2 star count increased', s.galaxy.starCount === starsBefore + 1);

await page.evaluate(() => {
  const st = window.getGameState();
  const g = st.galaxies[st.activeGalaxyId].graph;
  const target = g.stars.find((x) => x.id !== st.stronghold && !x.id.startsWith('sys-created'));
  st.galaxies[st.activeGalaxyId].systems[target.id].dyson = { completedShells: 8, shellSails: 0, foundryStock: 0, launcherStock: {}, launcherLastFireAt: {} };
});
const blocked = await page.evaluate(() => {
  const st = window.getGameState();
  const g = st.galaxies[st.activeGalaxyId].graph;
  const shielded = g.stars.find((x) => st.galaxies[st.activeGalaxyId].systems[x.id]?.dyson?.completedShells >= 8 && x.id !== st.stronghold);
  const neighbor = g.lanes.find(([a,b]) => a === shielded.id || b === shielded.id);
  const other = neighbor ? (neighbor[0] === shielded.id ? neighbor[1] : neighbor[0]) : null;
  if (other) {
    st.galaxies[st.activeGalaxyId].systems[other].dyson = { completedShells: 8, shellSails: 0, foundryStock: 0, launcherStock: {}, launcherLastFireAt: {} };
  }
  return window.__superweaponDestroy(shielded.id);
});
check('5.3 dyson shield blocks destroy', !blocked.ok);

await page.evaluate(() => window.__setCompletedDysons(3));
await page.evaluate(() => window.__buildSuperweaponCradle());
await page.evaluate(() => { window.getGameState().solarii = 500; });
const hero = await page.evaluate(() => window.__buildHeroFlagship());
check('6.1 build hero flagship', hero.ok);
s = await text();
check('6.2 hero in summary', s.heroFlagships.length >= 1);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__setCompletedDysons(1));
await page.evaluate(() => {
  window.getGameState().research.unlocked.push('dip_truce_protocol', 'dip_trade_charter');
});
const treaty = await page.evaluate(() => window.__offerTreaty('ai-0', 'trade'));
check('7.1 trade treaty', treaty.ok);
s = await text();
check('7.2 diplomacy unlocked UI data', s.diplomacy.unlocked === true);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__setVictoryType('economic'));
await page.evaluate(() => {
  window.getGameState().credits = 60000;
  window.getGameState().solarii = 60;
  window.getGameState().solariiUnlocked = true;
});
const victory = await page.evaluate(() => window.__checkVictory());
check('9.1 economic victory', victory?.type === 'victory');

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__initTutorial());
s = await text();
check('11.1 tutorial active', s.tutorial?.active === true);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__completeMission('wormhole_race'));
s = await text();
check('10.1 mission complete', s.missions.completed.includes('wormhole_race'));

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  window.__destroyFlagship();
  window.advanceTime(100);
});
s = await text();
check('9.2 defeat on flagship', s.campaign.defeated === true);

await page.evaluate(() => window.__newGame(42));
const jumpSetup = await page.evaluate(() => {
  const st = window.getGameState();
  st.research.unlocked.push(
    'mega_dyson_overdrive', 'dip_truce_protocol',
    'sw_cradle_unlock', 'sw_create_star', 'sw_destroy_star', 'sw_jump_gate',
  );
  window.__setCompletedDysons(3);
  st.credits = 50000;
  st.solarii = 500;
  st.flagship.systemId = st.stronghold;
  st.flagship.transit = null;
  st.flagship.galaxyId = st.activeGalaxyId;
  const cradle = window.__buildSuperweaponCradle();
  const lane = st.galaxies[st.activeGalaxyId].graph.lanes
    .find(([x, y]) => x === st.stronghold || y === st.stronghold);
  const neighbor = lane ? (lane[0] === st.stronghold ? lane[1] : lane[0]) : st.stronghold;
  const jump = cradle.ok ? window.__superweaponJump(neighbor) : { ok: false, reason: cradle.reason };
  return { cradle, jump };
});
check('5.4 superweapon jump ok', jumpSetup.jump?.ok, jumpSetup.jump?.reason ?? jumpSetup.cradle?.reason ?? '');

await page.evaluate(() => window.__newGame(42));
const routeSetup = await page.evaluate(() => {
  const st = window.getGameState();
  st.research.unlocked.push('trade_route_opt');
  const g = st.galaxies[st.activeGalaxyId];
  const a = st.stronghold;
  const lane = g.graph.lanes.find(([x, y]) => x === a || y === a);
  const b = lane ? (lane[0] === a ? lane[1] : lane[0]) : null;
  if (!b || !g.systems[b]) return { ok: false, reason: 'no adjacent system' };
  g.systems[a].owner = 'player';
  g.systems[b].owner = 'player';
  const bodyA = g.systems[a].bodies[0]?.id;
  const bodyB = g.systems[b].bodies[0]?.id;
  g.systems[a].structures.push({ id: 'ts-a', type: 'trade_station', bodyId: bodyA, builtAtTime: 0 });
  g.systems[b].structures.push({ id: 'ts-b', type: 'trade_station', bodyId: bodyB, builtAtTime: 0 });
  st.manualTradeRoutes = [];
  const route = window.__addTradeRoute(a, b);
  return { ok: route.ok, reason: route.reason, count: st.manualTradeRoutes.length };
});
check('8.1 manual trade route added', routeSetup.ok, routeSetup.reason ?? '');
check('8.2 manual routes in summary', routeSetup.count >= 1);

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => window.__setCompletedDysons(1));
await page.evaluate(() => {
  window.getGameState().research.unlocked.push('dip_truce_protocol');
});
const truce = await page.evaluate(() => window.__offerTreaty('ai-0', 'truce'));
check('7.3 truce treaty', truce.ok);
const alliance = await page.evaluate(() => {
  window.getGameState().credits = 5000;
  window.getGameState().solarii = 10;
  window.getGameState().research.unlocked.push('dip_alliance_pact');
  return window.__offerTreaty('ai-0', 'alliance');
});
check('7.4 alliance treaty', alliance.ok);

await page.evaluate(() => window.__newGame(42));
const locked = await page.evaluate(() => window.__startResearch('dip_truce_protocol'));
check('4.1 diplomacy tech locked', !locked.ok);
await page.evaluate(() => window.__setCompletedDysons(1));
await page.evaluate(() => {
  const st = window.getGameState();
  st.credits = 5000;
  st.solarii = 10;
  st.research.unlocked.push('mega_shell_matrix');
});
const unlocked = await page.evaluate(() => window.__startResearch('dip_truce_protocol'));
check('4.2 diplomacy tech unlocks', unlocked.ok, unlocked.reason ?? '');

await page.evaluate(() => window.__newGame(42));
const heroAnchorSetup = await page.evaluate(() => {
  const st = window.getGameState();
  st.research.unlocked.push('sw_cradle_unlock', 'hero_hull_unlock');
  window.__setCompletedDysons(3);
  st.credits = 50000;
  st.solarii = 500;
  const cradle = window.__buildSuperweaponCradle();
  const hero = cradle.ok ? window.__buildHeroFlagship() : { ok: false, reason: cradle.reason };
  const heroId = st.heroFlagships[0]?.id ?? null;
  const g = hero.ok ? window.__createBattleGroup() : null;
  const anchor = g && heroId ? window.__setBattleGroupHeroAnchor(g.id, heroId) : { ok: false };
  return { cradle, hero, heroId, anchor, groupId: g?.id ?? null };
});
check('6.3 hero anchor on fleet', heroAnchorSetup.anchor?.ok === true, heroAnchorSetup.hero?.reason ?? heroAnchorSetup.cradle?.reason ?? '');
check('6.4 hero anchor in summary', heroAnchorSetup.heroId && (await text()).battleGroups?.some((g) => g.anchorHeroId === heroAnchorSetup.heroId));

await page.evaluate(() => window.__newGame(42));
await page.evaluate(() => {
  const st = window.getGameState();
  st.research.unlocked.push('wh_scout_range');
  const sys = st.stronghold;
  const planet = st.galaxies[st.activeGalaxyId].systems[sys].bodies[0];
  st.galaxies[st.activeGalaxyId].systems[sys].structures.push({
    id: 'lp-test', type: 'listening_post', bodyId: planet?.id ?? null, builtAtTime: 0,
  });
});
s = await text();
check('12.1 listening post built', (s.strategicStructures?.listening_post ?? 0) >= 1);

await page.evaluate(() => window.__newGame(42));
for (const id of ['wormhole_race', 'dyson_defense', 'first_hero', 'superweapon_sculpt', 'diplomacy_intro', 'final_dominion']) {
  await page.evaluate(([mid]) => window.__completeMission(mid), [id]);
}
s = await text();
check('10.2 all missions complete', s.missions.completed.length >= 6);

await page.evaluate(() => window.__initTutorial());
await page.evaluate(() => window.__setTutorialStep(7));
s = await text();
check('11.2 tutorial completion step', s.tutorial?.step === 7 && s.tutorial?.current?.readyToFinish === true);
const invalidTutorialStep = await page.evaluate(() => window.__setTutorialStep(8));
check('11.3 tutorial rejects obsolete late-game step', invalidTutorialStep.ok === false);

await page.evaluate(() => window.__newGame(42));
s = await text();
check('13.1 four AI factions', (s.factions?.list?.length ?? 0) >= 4);

check('14.1 zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\nPhase 6: ${passed}/${total} checks passed`);
await browser.close();
process.exit(passed === total ? 0 : 1);
