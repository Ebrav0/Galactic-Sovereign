// Verify combat shield + hull bars for player and pirate ships.
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
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
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
await page.evaluate(() => {
  window.__newGame(442);
  document.getElementById('title-screen')?.classList.add('hidden');
  document.getElementById('hud')?.classList.remove('hud--boot');
  window.__setBootPhase?.('playing');
});

const probe = await page.evaluate(() => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  window.__viewSystem(systemId);
  window.__snapCamera(0, 0, 0.85);
  st.credits = 250000;
  st.paused = false;
  st.flagship.systemId = systemId;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;

  st.pirates.fleets = [{
    id: 'verify-status-pirates',
    galaxyId: st.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: Array.from({ length: 6 }, (_, i) => ({
      id: `verify-pirate-bar-${i}`,
      hull: i % 2 === 0 ? 'frigate' : 'corvette',
      hp: i % 2 === 0 ? 200 : 120,
      maxHp: i % 2 === 0 ? 200 : 120,
    })),
  }];
  for (const hull of ['corvette', 'frigate', 'destroyer', 'cruiser', 'corvette', 'frigate']) {
    window.__spawnFriendlyShip(hull, 1);
  }
  window.advanceTime(200);
  window.__forcePirateIntoSystem(systemId);
  window.advanceTime(600);

  const battle = st.systemBattles[systemId];
  const units = (battle?.units ?? []).filter((u) => u.hp > 0 && !u.isWing);
  const players = units.filter((u) => u.side === 'player');
  const enemies = units.filter((u) => u.side === 'enemy');

  const shieldSum = (unit) => {
    const f = unit.shieldFacings ?? unit.shields;
    if (!f) return { shield: 0, maxShield: 0 };
    let shield = 0;
    let maxShield = 0;
    for (const facing of Object.values(f)) {
      shield += facing?.value ?? 0;
      maxShield += facing?.max ?? 0;
    }
    return { shield, maxShield };
  };

  let cx = 0;
  let cy = 0;
  for (const unit of units) {
    cx += unit.x;
    cy += unit.y;
  }
  cx /= Math.max(1, units.length);
  cy /= Math.max(1, units.length);

  for (const [i, unit] of players.entries()) {
    if (unit.shieldFacings) {
      for (const facing of Object.values(unit.shieldFacings)) {
        facing.value = Math.max(0, facing.max * (i % 2 === 0 ? 0.45 : 0.8));
      }
    }
    unit.hp = Math.max(1, unit.maxHp * (i % 2 === 0 ? 0.55 : 0.9));
  }
  for (const [i, unit] of enemies.entries()) {
    if (unit.shieldFacings) {
      for (const facing of Object.values(unit.shieldFacings)) {
        facing.value = Math.max(0, facing.max * (i % 2 === 0 ? 0.3 : 0.7));
      }
    }
    unit.hp = Math.max(1, unit.maxHp * (i % 2 === 0 ? 0.4 : 0.75));
  }

  window.__snapCamera(cx, cy, 1.35);
  window.advanceTime(80);

  const sample = units.slice(0, 8).map((u) => {
    const s = shieldSum(u);
    return {
      id: u.id,
      side: u.side,
      hull: u.hull,
      hp: Math.round(u.hp),
      maxHp: Math.round(u.maxHp),
      shield: Math.round(s.shield),
      maxShield: Math.round(s.maxShield),
    };
  });

  return {
    active: !!battle?.active,
    mode: battle?.mode ?? null,
    playerCount: players.length,
    enemyCount: enemies.length,
    allHaveShields: units.every((u) => shieldSum(u).maxShield > 0),
    allHaveHp: units.every((u) => (u.maxHp ?? 0) > 0),
    sample,
  };
});

check('tactical battle active', probe.active && probe.mode === 'tactical', `${probe.mode}`);
check('player units present', probe.playerCount >= 2, `n=${probe.playerCount}`);
check('pirate units present', probe.enemyCount >= 4, `n=${probe.enemyCount}`);
check('all combat ships have shields', probe.allHaveShields, JSON.stringify(probe.sample.slice(0, 3)));
check('all combat ships have hull maxHp', probe.allHaveHp);

await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(OUT_DIR, 'combat-status-bars.png'),
  fullPage: false,
});

const pixelProbe = await page.evaluate(() => {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return { ok: false, reason: 'no canvas' };
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: 'no 2d context' };
  window.advanceTime(32);
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  let cyan = 0;
  let green = 0;
  let redish = 0;
  const step = 2;
  for (let y = Math.floor(h * 0.1); y < Math.floor(h * 0.9); y += step) {
    for (let x = Math.floor(w * 0.05); x < Math.floor(w * 0.95); x += step) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 140) continue;
      if (b > 150 && g > 110 && r < 210 && b >= r) cyan++;
      if (g > 130 && g > r + 15 && g > b + 10) green++;
      if (r > 140 && r > g + 25 && r > b + 25) redish++;
    }
  }
  return { ok: true, cyan, green, redish, w, h };
});

check('canvas has shield-bar cyan pixels', pixelProbe.ok && pixelProbe.cyan > 2,
  `cyan=${pixelProbe.cyan} green=${pixelProbe.green} red=${pixelProbe.redish}`);
check('canvas has hull-bar green or red pixels',
  pixelProbe.ok && (pixelProbe.green > 2 || pixelProbe.redish > 2),
  `green=${pixelProbe.green} red=${pixelProbe.redish}`);
check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(`screenshot: ${path.join(OUT_DIR, 'combat-status-bars.png')}`);
console.log('sample units:', JSON.stringify(probe.sample, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
