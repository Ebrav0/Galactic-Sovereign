// Novacula superweapon deferred fire + cradle visuals.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

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

const outDir = path.join(__dir, 'web-game/superweapon-novacula');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('http://localhost:5173');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(42));

const unlock = async () => {
  await page.evaluate(() => {
    window.getGameState().research.unlocked.push(
      'mega_dyson_overdrive', 'dip_truce_protocol', 'sw_cradle_unlock',
      'sw_create_star', 'sw_destroy_star', 'sw_jump_gate',
    );
    window.__setCompletedDysons(3);
    window.getGameState().solarii = 500;
    window.getGameState().credits = 50000;
    window.getGameState().flagship.systemId = window.getGameState().stronghold;
    window.getGameState().flagship.transit = null;
  });
  return page.evaluate(() => window.__buildSuperweaponCradle());
};

const cradle = await unlock();
check('1. cradle builds', cradle.ok, cradle.reason ?? '');

await page.evaluate(() => {
  window.__viewSystem(window.getGameState().stronghold);
  // Exact cradle world pose for framing.
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
  const starR = sys?.star?.radius ?? 200;
  const orbitR = starR + 280;
  const angle = -Math.PI * 0.35;
  window.__snapCamera(Math.cos(angle) * orbitR, Math.sin(angle) * orbitR, 0.85);
});
await page.evaluate(() => window.advanceTime(100));
await page.screenshot({ path: path.join(outDir, '01-cradle-idle.png') });
check('2. cradle idle screenshot', fs.existsSync(path.join(outDir, '01-cradle-idle.png')));

const starsBefore = await page.evaluate(() => {
  const st = window.getGameState();
  return st.galaxies[st.activeGalaxyId].graph.stars.length;
});

const pending = await page.evaluate(() => {
  window.getGameState().solarii = 500;
  return window.__superweaponCreateDeferred(window.getGameState().stronghold);
});
check('3. deferred create starts', pending.ok && pending.pending, pending.reason ?? '');

let seq = await page.evaluate(() => window.__fireSequenceStatus());
check('4. sequence in charge', seq?.phase === 'charge' || seq?.type === 'create', seq?.phase ?? 'null');

const midStars = await page.evaluate(() => {
  const st = window.getGameState();
  return st.galaxies[st.activeGalaxyId].graph.stars.length;
});
check('5. no mutate before impact', midStars === starsBefore);

await page.evaluate(() => window.advanceTime(1500));
seq = await page.evaluate(() => window.__fireSequenceStatus());
await page.screenshot({ path: path.join(outDir, '02-charge-aim.png') });
check('6. advanced past charge', seq && seq.phase !== 'charge', seq?.phase ?? 'done');

await page.evaluate(() => window.advanceTime(2500));
const after = await page.evaluate(() => {
  const st = window.getGameState();
  return {
    stars: st.galaxies[st.activeGalaxyId].graph.stars.length,
    seq: window.__fireSequenceStatus(),
    last: st.superweapon.lastAction,
  };
});
check('7. star created at/after impact', after.stars === starsBefore + 1, String(after.stars));
check('8. lastAction create', after.last?.type === 'create');

await page.evaluate(() => {
  window.__setViewGalaxy?.();
  if (typeof window.__setView === 'function') window.__setView('galaxy');
});
await page.evaluate(() => window.advanceTime(200));
await page.screenshot({ path: path.join(outDir, '03-galaxy-create-impact.png') });

// Destroy with shield block at impact
await page.evaluate(() => {
  const st = window.getGameState();
  st.superweapon.fireSequence = null;
  st.superweapon.cooldownUntil = 0;
  st.solarii = 500;
  const g = st.galaxies[st.activeGalaxyId].graph;
  const shielded = g.stars.find((x) => x.id !== st.stronghold && !String(x.id).startsWith('sys-created'));
  st._shieldTarget = shielded.id;
  const shieldedSystem = st.galaxies[st.activeGalaxyId].systems[shielded.id];
  shieldedSystem.owner = 'ai';
  shieldedSystem.factionId = st.factions.list[0].id;
  shieldedSystem.dyson = {
    completedShells: 8, shellSails: 0, foundryStock: 0, launcherStock: {}, launcherLastFireAt: {},
  };
  window.__establishContact(st.factions.list[0].id, { stage: 'established', trigger: 'test' });
  window.__declareWar(st.factions.list[0].id, {
    goals: [{ type: 'superweapon_containment', systemIds: [shielded.id] }],
  });
  const neighbor = g.lanes.find(([a, b]) => a === shielded.id || b === shielded.id);
  const other = neighbor ? (neighbor[0] === shielded.id ? neighbor[1] : neighbor[0]) : null;
  if (other && other !== st.stronghold) {
    st.galaxies[st.activeGalaxyId].systems[other].dyson = {
      completedShells: 8, shellSails: 0, foundryStock: 0, launcherStock: {}, launcherLastFireAt: {},
    };
  }
});
const destroyPending = await page.evaluate(() => {
  const st = window.getGameState();
  return window.__superweaponDestroyDeferred(st._shieldTarget);
});
check('9. destroy sequence starts', destroyPending.ok && destroyPending.pending);
await page.evaluate(() => window.advanceTime(4000));
const blocked = await page.evaluate(() => {
  const st = window.getGameState();
  return st.superweapon.lastAction;
});
check('10. shield blocks at impact', blocked?.blocked === true, JSON.stringify(blocked));
await page.screenshot({ path: path.join(outDir, '04-shield-deflect.png') });

// Fire cinema frame at Stronghold during destroy fire (new target without shield)
await page.evaluate(() => {
  const st = window.getGameState();
  st.superweapon.fireSequence = null;
  st.superweapon.cooldownUntil = 0;
  st.solarii = 500;
  const g = st.galaxies[st.activeGalaxyId].graph;
  const target = g.stars.find((x) => x.id !== st.stronghold
    && !String(x.id).startsWith('sys-created')
    && (st.galaxies[st.activeGalaxyId].systems[x.id]?.dyson?.completedShells ?? 0) < 8);
  st._fireTarget = target?.id;
  if (st._fireTarget) {
    st.galaxies[st.activeGalaxyId].systems[st._fireTarget].owner = 'ai';
    st.galaxies[st.activeGalaxyId].systems[st._fireTarget].factionId = st.factions.list[0].id;
  }
});
await page.evaluate(() => {
  const st = window.getGameState();
  if (st._fireTarget) window.__superweaponDestroyDeferred(st._fireTarget);
});
await page.evaluate(() => {
  window.__viewSystem(window.getGameState().stronghold);
  const st = window.getGameState();
  const sys = st.galaxies[st.activeGalaxyId].systems[st.stronghold];
  const starR = sys?.star?.radius ?? 200;
  const orbitR = starR + 280;
  const angle = -Math.PI * 0.35;
  window.__snapCamera(Math.cos(angle) * orbitR, Math.sin(angle) * orbitR, 1.1);
});
await page.evaluate(() => window.advanceTime(2200));
const firePhase = await page.evaluate(() => window.__fireSequenceStatus()?.phase);
await page.screenshot({ path: path.join(outDir, '05-novacula-fire.png') });
check('11. novacula fire screenshot', fs.existsSync(path.join(outDir, '05-novacula-fire.png')) && ['aim', 'fire', 'impact'].includes(firePhase), firePhase ?? 'none');

check('12. no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
