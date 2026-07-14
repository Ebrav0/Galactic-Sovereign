// Flagship ambient fighter wing verification.
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

const outDir = path.join(__dir, 'web-game/flagship-wing');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('http://localhost:5173');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => window.__newGame(42));
consoleErrors.length = 0;

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
let s = await text();
check('1. wing summary present', s.flagship.wing != null);
check('2. full complement ready', s.flagship.wing.ready === s.flagship.wing.capacity && s.flagship.wing.capacity >= 10, `${s.flagship.wing.ready}/${s.flagship.wing.capacity}`);

let poses = await page.evaluate(() => window.__flagshipWingPoses());
check('3. ambient poses match ready', poses.length === s.flagship.wing.ready, String(poses.length));

const before = poses[0];
await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.x += 180;
  st.flagship.y += 90;
  st.flagship.vx = 120;
  st.flagship.vy = 40;
});
await page.evaluate(() => window.advanceTime(200));
poses = await page.evaluate(() => window.__flagshipWingPoses());
check('4. wing follows flagship move', Math.hypot(poses[0].x - before.x, poses[0].y - before.y) > 40, String(Math.hypot(poses[0].x - before.x, poses[0].y - before.y)));

await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.vx = 0;
  st.flagship.vy = 0;
  st.flagship.transit = null;
});
await page.evaluate(() => window.advanceTime(50));

// Contained wander: poses stay near flagship (not a wide ring).
const spread = await page.evaluate(() => {
  const st = window.getGameState();
  const poses = window.__flagshipWingPoses();
  const fx = st.flagship.x;
  const fy = st.flagship.y;
  let maxD = 0;
  let minD = Infinity;
  for (const p of poses) {
    const d = Math.hypot(p.x - fx, p.y - fy);
    maxD = Math.max(maxD, d);
    minD = Math.min(minD, d);
  }
  return { maxD, minD, n: poses.length };
});
check('4b. wing contained near flagship', spread.maxD < 160 && spread.minD < 80, `min=${spread.minD.toFixed(1)} max=${spread.maxD.toFixed(1)}`);

// Motion should not be a shared circular sweep (angles shouldn't all advance together).
const orbitish = await page.evaluate(async () => {
  const angles = (poses, fx, fy) => poses.map((p) => Math.atan2(p.y - fy, p.x - fx));
  const st = window.getGameState();
  const fx = st.flagship.x;
  const fy = st.flagship.y;
  const a0 = angles(window.__flagshipWingPoses(), fx, fy);
  await window.advanceTime(2500);
  const a1 = angles(window.__flagshipWingPoses(), fx, fy);
  let sameSign = 0;
  let moved = 0;
  for (let i = 0; i < a0.length; i++) {
    let d = a1[i] - a0[i];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.08) moved += 1;
    if (d > 0.08) sameSign += 1;
    if (d < -0.08) sameSign -= 1;
  }
  // A pure orbit would push almost every craft the same rotational direction.
  return { moved, sameSign: Math.abs(sameSign), n: a0.length };
});
check('4d. wander not shared orbit sweep', orbitish.moved >= 6 && orbitish.sameSign < orbitish.n * 0.75, `moved=${orbitish.moved} sameSign=${orbitish.sameSign}/${orbitish.n}`);

// No thrust trail lag: when flagship jumps, wing centroid should move nearly 1:1.
const noLag = await page.evaluate(() => {
  const st = window.getGameState();
  const before = window.__flagshipWingPoses();
  const cx0 = before.reduce((s, p) => s + p.x, 0) / before.length;
  const cy0 = before.reduce((s, p) => s + p.y, 0) / before.length;
  st.flagship.x += 200;
  st.flagship.y += 40;
  st.flagship.vx = 180;
  st.flagship.vy = 20;
  st.flagship.heading = Math.atan2(20, 180);
  const after = window.__flagshipWingPoses();
  const cx1 = after.reduce((s, p) => s + p.x, 0) / after.length;
  const cy1 = after.reduce((s, p) => s + p.y, 0) / after.length;
  const dx = cx1 - cx0;
  const dy = cy1 - cy0;
  st.flagship.vx = 0;
  st.flagship.vy = 0;
  return { dx, dy, err: Math.hypot(dx - 200, dy - 40) };
});
check('4e. wing has no thrust trail lag', noLag.err < 8, `err=${noLag.err.toFixed(2)} dx=${noLag.dx.toFixed(1)} dy=${noLag.dy.toFixed(1)}`);

const faceMotion = await page.evaluate(async () => {
  const st = window.getGameState();
  st.flagship.vx = 0;
  st.flagship.vy = 0;
  const a = window.__flagshipWingPoses();
  await window.advanceTime(120);
  const b = window.__flagshipWingPoses();
  let aligned = 0;
  for (let i = 0; i < a.length; i++) {
    const dx = b[i].x - a[i].x;
    const dy = b[i].y - a[i].y;
    if (Math.hypot(dx, dy) < 0.4) continue;
    const move = Math.atan2(dy, dx);
    let d = b[i].heading - move;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.55) aligned += 1;
  }
  return { aligned, n: a.length };
});
check('4f. escorts face direction of motion', faceMotion.aligned >= Math.max(4, faceMotion.n * 0.5),
  `aligned=${faceMotion.aligned}/${faceMotion.n}`);

// Continuity: relative escort offsets must not jump while the flagship cruises.
const continuity = await page.evaluate(async () => {
  const st = window.getGameState();
  st.flagship.vx = 160;
  st.flagship.vy = 55;
  st.paused = false;
  let prev = null;
  let maxRelJump = 0;
  let maxHeadingJump = 0;
  for (let i = 0; i < 24; i++) {
    await window.advanceTime(16);
    const poses = window.__flagshipWingPoses();
    const fx = st.flagship.x;
    const fy = st.flagship.y;
    const rel = poses.map((p) => ({
      x: p.x - fx,
      y: p.y - fy,
      h: p.heading,
    }));
    if (prev) {
      for (let j = 0; j < rel.length; j++) {
        maxRelJump = Math.max(maxRelJump, Math.hypot(rel[j].x - prev[j].x, rel[j].y - prev[j].y));
        let dh = rel[j].h - prev[j].h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        maxHeadingJump = Math.max(maxHeadingJump, Math.abs(dh));
      }
    }
    prev = rel;
  }
  st.flagship.vx = 0;
  st.flagship.vy = 0;
  return { maxRelJump, maxHeadingJump };
});
check('4g. wing relative motion continuous while cruising',
  continuity.maxRelJump < 4.5 && continuity.maxHeadingJump < 0.85,
  `relJump=${continuity.maxRelJump.toFixed(2)} headingJump=${continuity.maxHeadingJump.toFixed(2)}`);

await page.evaluate(() => {
  window.__viewSystem(window.getGameState().stronghold);
  const st = window.getGameState();
  window.__snapCamera(st.flagship.x, st.flagship.y, 1.0);
});
await page.evaluate(() => window.advanceTime(80));
await page.screenshot({ path: path.join(outDir, '01-wing-escort.png') });

// Zoom scale: fighter screen radius must track zoom proportionally (no readability floor).
const zoomSizes = await page.evaluate(() => {
  const wingR = 9 * 0.72; // FLAGSHIP_RADIUS * FLAGSHIP_WING_DRAW_SCALE
  const hullScale = 0.7; // fighter HULL_RENDER.scale
  const sizeAt = (z) => {
    const baseR = Math.max(0.75, wingR * z);
    const r = baseR * hullScale;
    const rKey = Math.max(1.5, Math.round(r * 2) / 2);
    return { r, rKey };
  };
  const far = sizeAt(0.55);
  const near = sizeAt(2.2);
  return {
    far: far.r,
    near: near.r,
    farKey: far.rKey,
    nearKey: near.rKey,
    ratio: near.r / far.r,
    zoomRatio: 2.2 / 0.55,
  };
});
check(
  '4c. wing sprite scales with zoom',
  zoomSizes.ratio > 3.5
    && Math.abs(zoomSizes.ratio - zoomSizes.zoomRatio) < 0.15
    && zoomSizes.near > zoomSizes.far,
  `far=${zoomSizes.far.toFixed(2)} near=${zoomSizes.near.toFixed(2)} farKey=${zoomSizes.farKey} ratio=${zoomSizes.ratio.toFixed(2)} zoomRatio=${zoomSizes.zoomRatio.toFixed(2)}`,
);

await page.evaluate(() => {
  const st = window.getGameState();
  window.__snapCamera(st.flagship.x, st.flagship.y, 0.55);
});
await page.evaluate(() => window.advanceTime(40));
await page.screenshot({ path: path.join(outDir, '02-wing-zoom-out.png') });

await page.evaluate(() => {
  const st = window.getGameState();
  window.__snapCamera(st.flagship.x, st.flagship.y, 2.4);
});
await page.evaluate(() => window.advanceTime(40));
await page.screenshot({ path: path.join(outDir, '03-wing-zoom-in.png') });

await page.evaluate(() => {
  const st = window.getGameState();
  window.__snapCamera(st.flagship.x, st.flagship.y, 1.15);
});
await page.evaluate(() => window.advanceTime(1800));
await page.screenshot({ path: path.join(outDir, '04-wing-wander.png') });

const hidden = await page.evaluate(() => {
  const st = window.getGameState();
  st.paused = true;
  const neighbor = st.galaxies[st.activeGalaxyId].graph.lanes
    .find(([a, b]) => a === st.stronghold || b === st.stronghold);
  const dest = neighbor ? (neighbor[0] === st.stronghold ? neighbor[1] : neighbor[0]) : st.stronghold;
  st.flagship.transit = {
    path: [st.stronghold, dest],
    legIndex: 0,
    legStartedAt: st.time,
    legDurationMs: 5000,
  };
  const count = window.__flagshipWingPoses().length;
  st.flagship.transit = null;
  st.paused = false;
  return count;
});
check('5. hidden during transit', hidden === 0, String(hidden));

// Hangar recall: escorts fly into the flagship and stow.
const hangar = await page.evaluate(async () => {
  const st = window.getGameState();
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  st.flagship.systemId = st.stronghold;
  window.__viewSystem(st.stronghold);
  window.__snapCamera(st.flagship.x, st.flagship.y, 1.2);
  const before = window.__flagshipWingPoses().length;
  const res = window.__toggleFlagshipWingHangar();
  const mid = window.__flagshipWingPoses();
  let minD = Infinity;
  for (const p of mid) {
    minD = Math.min(minD, Math.hypot(p.x - st.flagship.x, p.y - st.flagship.y));
  }
  await window.advanceTime(1800);
  const after = window.__flagshipWingPoses().length;
  const hangarState = window.__flagshipWing()?.hangar;
  return { before, mid: mid.length, minD, after, hangarState, ok: res?.ok };
});
check('5b. hangar recall starts with escorts visible', hangar.before >= 10 && hangar.mid > 0, `before=${hangar.before} mid=${hangar.mid}`);
check('5c. hangar recall stows escorts', hangar.after === 0 && hangar.hangarState === 'stowed', `after=${hangar.after} hangar=${hangar.hangarState}`);
await page.screenshot({ path: path.join(outDir, '05-wing-stowed.png') });

const relaunch = await page.evaluate(async () => {
  const res = window.__toggleFlagshipWingHangar();
  await window.advanceTime(1600);
  return {
    ok: res?.ok,
    hangar: window.__flagshipWing()?.hangar,
    poses: window.__flagshipWingPoses().length,
  };
});
check('5d. hangar launch redeploys escorts', relaunch.ok && relaunch.hangar === 'deployed' && relaunch.poses >= 10,
  `hangar=${relaunch.hangar} poses=${relaunch.poses}`);

// Combat launch + attrition
await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.systemId = st.stronghold;
  st.flagship.transit = null;
  st.flagship.wormholeTransit = null;
  // Ensure wing is out for combat launch test.
  if (st.flagship.wing?.hangar === 'stowed') window.__toggleFlagshipWingHangar();
  window.__spawnEnemyFleet(st.stronghold);
});
await page.evaluate(() => window.advanceTime(800));
const launched = await page.evaluate(() => {
  const st = window.getGameState();
  const b = window.__getBattleState?.(st.stronghold) ?? st.systemBattles?.[st.stronghold];
  return (b?.units ?? []).filter((u) => u.isWing && u.parentCarrierId === 'flagship').length;
});
check('6. combat wing launched', launched >= 5, String(launched));

check('7. no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
