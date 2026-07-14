// Advanced StS combat FX verification.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');

const OUT_DIR = path.join(here, 'visuals');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(917));

const setup = await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  window.__viewSystem(systemId);
  window.__snapCamera(0, 0, 0.85);
  st.credits = 250000;
  st.flagship.systemId = systemId;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  st.paused = false;

  const hulls = [
    'corvette', // point_defense
    'frigate', // kinetic
    'destroyer', // torpedo
    'cruiser', // beam_lance
    'healer', // repair
  ];
  for (const hull of hulls) {
    const stats = ({
      corvette: { hp: 120 },
      frigate: { hp: 200 },
      destroyer: { hp: 350 },
      cruiser: { hp: 500 },
      healer: { hp: 150 },
    })[hull];
    st.playerShips.push({
      id: `fx-${hull}`,
      hull,
      galaxyId: st.activeGalaxyId,
      systemId,
      hp: stats.hp,
      maxHp: stats.hp,
      transit: null,
      anchorBodyId: null,
    });
  }

  // Damaged ally so healers have a repair target.
  st.playerShips.push({
    id: 'fx-wounded',
    hull: 'frigate',
    galaxyId: st.activeGalaxyId,
    systemId,
    hp: 40,
    maxHp: 200,
    transit: null,
    anchorBodyId: null,
  });

  st.pirates.fleets.push({
    id: 'fx-pirates',
    galaxyId: st.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: Array.from({ length: 8 }, (_, i) => ({
      id: `fx-pirate-${i}`,
      hull: i % 2 === 0 ? 'corvette' : 'frigate',
      hp: i % 2 === 0 ? 120 : 200,
      maxHp: i % 2 === 0 ? 120 : 200,
    })),
  });

  window.advanceTime(200);
  const battle = window.__getBattleState(systemId);
  if (battle?.units) {
    const enemies = battle.units.filter((u) => u.side === 'enemy' && u.hp > 0);
    let ex = 0;
    let ey = 0;
    for (const e of enemies) {
      ex += e.x;
      ey += e.y;
      e.maxHp = Math.max(e.maxHp, 800);
      e.hp = e.maxHp;
    }
    if (enemies.length) {
      ex /= enemies.length;
      ey /= enemies.length;
    }

    const profileById = {
      'fx-corvette': 'point_defense',
      'fx-frigate': 'ion',
      'fx-destroyer': 'torpedo',
      'fx-cruiser': 'beam_lance',
      'fx-healer': 'repair',
      'fx-wounded': 'kinetic',
    };

    let slot = 0;
    for (const unit of battle.units) {
      if (unit.side !== 'player' || unit.hp <= 0) continue;
      if (profileById[unit.id]) unit.weaponProfile = profileById[unit.id];
      unit.weaponProfile = unit.weaponProfile ?? (
        unit.hull === 'destroyer' ? 'torpedo'
          : unit.hull === 'cruiser' ? 'beam_lance'
            : unit.hull === 'corvette' ? 'point_defense'
              : unit.hull === 'healer' ? 'repair'
                : 'kinetic'
      );
      if (unit.hull !== 'healer' && unit.hull !== 'flagship') {
        const ang = (slot / 8) * Math.PI * 2;
        unit.x = ex + Math.cos(ang) * 90;
        unit.y = ey + Math.sin(ang) * 90;
        unit.heading = Math.atan2(ey - unit.y, ex - unit.x);
        unit.cooldownMs = 0;
        slot += 1;
      }
    }
  }

  const seen = {};
  let latest = null;
  for (let i = 0; i < 50; i++) {
    const live = window.__getBattleState(systemId);
    if (live?.units) {
      for (const unit of live.units) {
        if (unit.side === 'player' && unit.hull !== 'healer' && unit.hull !== 'flagship') {
          unit.cooldownMs = Math.min(unit.cooldownMs ?? 0, 0);
        }
        if (unit.side === 'enemy' && unit.hp > 0) {
          unit.hp = Math.max(unit.hp, unit.maxHp * 0.6);
        }
      }
    }
    window.advanceTime(120);
    const fx = window.__combatFxSummary(systemId);
    latest = fx;
    for (const [profile, count] of Object.entries(fx?.byProfile ?? {})) {
      seen[profile] = Math.max(seen[profile] ?? 0, count);
    }
    const still = window.__getBattleState(systemId);
    if (!still?.active) break;
    if (requiredProfilesSeen(seen)) break;
  }

  function requiredProfilesSeen(map) {
    return ['point_defense', 'kinetic', 'torpedo', 'beam_lance', 'ion', 'repair']
      .every((p) => (map[p] ?? 0) > 0);
  }

  const fx = latest && latest.total > 0
    ? { ...latest, byProfile: { ...seen }, profiles: Object.keys(seen).sort() }
    : {
      total: Object.values(seen).reduce((a, b) => a + b, 0),
      byProfile: seen,
      profiles: Object.keys(seen).sort(),
      active: 0,
      byKind: {},
      activeByProfile: {},
    };

  const text = JSON.parse(window.render_game_to_text());
  return {
    systemId,
    battleActive: !!text.battle?.active || (fx.total > 0),
    mode: text.battle?.mode ?? 'tactical',
    fx,
    battleFx: text.battle?.fx ?? fx,
    seen,
  };
});

check('tactical battle produced FX', (setup.fx?.total ?? 0) > 0 && setup.mode === 'tactical',
  `${setup.mode} total=${setup.fx?.total}`);
check('fx events emitted', (setup.fx?.total ?? 0) > 0, JSON.stringify(setup.fx));
check('profile map populated', Object.keys(setup.fx?.byProfile ?? {}).length > 0,
  JSON.stringify(setup.fx?.byProfile ?? {}));

const required = ['point_defense', 'kinetic', 'torpedo', 'beam_lance', 'ion', 'repair'];
for (const profile of required) {
  check(`profile ${profile} present`, (setup.fx?.byProfile?.[profile] ?? setup.seen?.[profile] ?? 0) > 0,
    JSON.stringify(setup.fx?.byProfile ?? setup.seen ?? {}));
}

check('fx ring buffer under cap', (setup.fx?.total ?? 0) <= 128, String(setup.fx?.total));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const shotPath = path.join(OUT_DIR, 'sts-combat-fx.png');
await page.screenshot({ path: shotPath, fullPage: false });
check('screenshot written', fs.existsSync(shotPath), shotPath);

// Cadence smoke: restart a compact fight and ensure sim stays responsive.
const cadence = await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  window.__viewSystem(systemId);
  st.flagship.systemId = systemId;
  st.flagship.transit = null;
  if (!st.pirates.fleets.some((f) => f.id === 'fx-pirates-cadence')) {
    st.pirates.fleets.push({
      id: 'fx-pirates-cadence',
      galaxyId: st.activeGalaxyId,
      systemId,
      transit: null,
      wanderCooldownMs: 999999,
      ships: Array.from({ length: 6 }, (_, i) => ({
        id: `fx-cadence-pirate-${i}`,
        hull: 'corvette',
        hp: 120,
        maxHp: 120,
      })),
    });
  }
  window.advanceTime(100);
  const t0 = performance.now();
  window.advanceTime(5000);
  return { ms: performance.now() - t0, fx: window.__combatFxSummary(systemId) };
});
check('5s sim under 2500ms wall', cadence.ms < 2500, `${cadence.ms.toFixed(1)}ms`);
check('fx hook remains callable', typeof cadence.fx?.total === 'number' || cadence.fx === null || typeof cadence.fx === 'object');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
