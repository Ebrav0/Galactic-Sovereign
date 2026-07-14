// Combat steering verification — pure math + live tactical battle feel.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');

import {
  shortestAngleDelta,
  steerUnit,
  ensureUnitMotion,
  hullMotionProfile,
  applyShipSeparation,
  resolveStickyTarget,
} from '../src/js/combat-steering.js';
import {
  TICK_MS,
  TACTICAL_TURN_RATE,
  TACTICAL_SHIP_SPEED,
} from '../src/js/constants.js';

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- Pure unit checks ---
check('shortestAngleDelta wraps correctly', Math.abs(shortestAngleDelta(0.1, -0.1) + 0.2) < 1e-9);
check('shortestAngleDelta prefers short arc across ±π', Math.abs(shortestAngleDelta(3.0, -3.0)) < 0.5);

{
  const unit = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
  ensureUnitMotion(unit);
  const dt = TICK_MS / 1000;
  const maxStep = TACTICAL_TURN_RATE * hullMotionProfile('corvette').turnRateMult * dt + 0.01;
  steerUnit(unit, Math.PI, {
    dt,
    thrust: 1,
    maxSpeed: TACTICAL_SHIP_SPEED,
    turnRate: TACTICAL_TURN_RATE * hullMotionProfile('corvette').turnRateMult,
    accel: 55,
    drag: 1.15,
  });
  check('steerUnit clamps heading turn per tick', Math.abs(unit.heading) <= maxStep + 1e-6, `heading=${unit.heading}`);
  check('steerUnit gains forward velocity', unit.vx > 0 && Math.abs(unit.vy) < 0.5, `vx=${unit.vx} vy=${unit.vy}`);
}

{
  const a = { id: 'a', hull: 'corvette', hp: 100, x: 0, y: 0, vx: 0, vy: 0, heading: 0 };
  const b = { id: 'b', hull: 'corvette', hp: 100, x: 2, y: 0, vx: 0, vy: 0, heading: 0 };
  applyShipSeparation([a, b], { dt: 0.05, strength: 90 });
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  check('separation pushes overlapping escorts apart', dist > 2, `dist=${dist}`);
}

{
  const unit = { id: 'u', x: 0, y: 0, focusTargetId: null, focusTargetUntil: 0 };
  const live = [
    { id: 't1', hp: 10, x: 50, y: 0 },
    { id: 't2', hp: 10, x: 40, y: 0 },
  ];
  const first = resolveStickyTarget(unit, () => live[0], {
    nowMs: 1000,
    stickMs: 1200,
    leashDist: 500,
    findById: (id) => live.find((t) => t.id === id),
  });
  const second = resolveStickyTarget(unit, () => live[1], {
    nowMs: 1100,
    stickMs: 1200,
    leashDist: 500,
    findById: (id) => live.find((t) => t.id === id),
  });
  check('sticky target retained within stick window', first?.id === 't1' && second?.id === 't1', `${first?.id}/${second?.id}`);
}

// --- Browser battle checks ---
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(442));

const samples = await page.evaluate(async () => {
  const st = window.getGameState();
  const systemId = st.stronghold;
  window.__viewSystem(systemId);
  st.paused = false;
  st.flagship.systemId = systemId;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;

  st.pirates.fleets = [{
    id: 'steer-pirates',
    galaxyId: st.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: [
      { id: 'sp0', hull: 'corvette', hp: 120, maxHp: 120 },
      { id: 'sp1', hull: 'corvette', hp: 120, maxHp: 120 },
      { id: 'sp2', hull: 'frigate', hp: 200, maxHp: 200 },
    ],
  }];
  window.__spawnFriendlyShip('corvette', 4);
  window.__spawnFriendlyShip('frigate', 2);
  window.__forcePirateIntoSystem(systemId);
  window.advanceTime(200);

  const battle = st.systemBattles?.[systemId];
  if (!battle?.active || !battle.units) {
    return { ok: false, reason: 'no battle' };
  }

  const mobiles = () => battle.units.filter((u) => u.hp > 0 && !u.isStructure && !u.isConvoy && u.hull !== 'flagship' && !u.isWing);
  const snapshot = () => mobiles().map((u) => ({
    id: u.id,
    side: u.side,
    hull: u.hull,
    x: u.x,
    y: u.y,
    heading: u.heading,
    vx: u.vx ?? 0,
    vy: u.vy ?? 0,
  }));

  const t0 = snapshot();
  const headingDeltas = [];
  for (let i = 0; i < 6; i++) {
    const before = new Map(snapshot().map((u) => [u.id, u.heading]));
    window.advanceTime(50);
    for (const u of snapshot()) {
      const prev = before.get(u.id);
      if (prev == null) continue;
      let d = u.heading - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      headingDeltas.push(Math.abs(d));
    }
  }

  window.advanceTime(2000);
  const t1 = snapshot();
  const speeds = t1.map((u) => Math.hypot(u.vx, u.vy));
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);

  const player = t1.filter((u) => u.side === 'player');
  let minPair = Infinity;
  for (let i = 0; i < player.length; i++) {
    for (let j = i + 1; j < player.length; j++) {
      const d = Math.hypot(player[i].x - player[j].x, player[i].y - player[j].y);
      if (d < minPair) minPair = d;
    }
  }

  const maxHeadingDelta = headingDeltas.length ? Math.max(...headingDeltas) : 0;
  const turnCap = 1.55 * 1.0 * 0.05 + 0.02; // escort turnRate * dt + slack

  return {
    ok: true,
    battleActive: battle.active,
    unitCount: t0.length,
    maxHeadingDelta,
    turnCap,
    meanSpeed,
    minPair: Number.isFinite(minPair) ? minPair : null,
    hasVelocityFields: t1.every((u) => Number.isFinite(u.vx) && Number.isFinite(u.vy)),
  };
});

check('tactical battle started for steering verify', samples.ok && samples.battleActive, samples.reason ?? `units=${samples.unitCount}`);
if (samples.ok) {
  check('units have velocity fields', samples.hasVelocityFields === true);
  check(
    'heading change per tick within turn rate',
    samples.maxHeadingDelta <= samples.turnCap,
    `maxΔ=${samples.maxHeadingDelta?.toFixed(4)} cap=${samples.turnCap?.toFixed(4)}`,
  );
  check(
    'mean ship speed in sane cruise band',
    samples.meanSpeed > 0.5 && samples.meanSpeed < 40,
    `meanSpeed=${samples.meanSpeed?.toFixed(2)}`,
  );
  check(
    'same-side escorts keep minimum separation',
    samples.minPair == null || samples.minPair >= 10,
    `minPair=${samples.minPair?.toFixed?.(1) ?? samples.minPair}`,
  );
}

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
