// Star visual verification: close-up screenshots plus a flare/corona pixel sanity check.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const text = m.text();
  if (/GPU stall due to ReadPixels/i.test(text)) return;
  if (m.type() === 'error' || /shader|program|WebGL/i.test(text)) errors.push(text);
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => localStorage.clear());

async function configureStar(type, color, radius, seed, time) {
  await page.evaluate(({ type, color, radius, seed, time }) => {
    window.__newGame(seed, { mode: 'sandbox' });
    const st = window.getGameState();
    const systemId = st.stronghold;
    const sys = st.galaxies[st.activeGalaxyId].systems[systemId];
    sys.star.type = type;
    sys.star.color = color;
    sys.star.radius = radius;
    sys.star.visualSeed = seed * 9973;
    st.time = time;
    window.__viewSystem(systemId);
    window.__snapCamera(0, 0, 1.08);
    window.advanceTime(100);
  }, { type, color, radius, seed, time });
  await page.waitForTimeout(250);
}

async function canvasShot(name) {
  const file = path.join(OUT_DIR, name);
  await page.locator('#game-canvas').screenshot({ path: file });
  return file;
}

await configureStar('yellow_dwarf', '#ffd27a', 190, 811, 12800);
await canvasShot('star-yellow-detail.png');

await configureStar('flare_star', '#ff5840', 150, 923, 18750);
await canvasShot('star-flare-active.png');

const metrics = await page.evaluate(() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const cx = w / 2;
  const cy = h / 2;
  const r = 150 * 1.08 * 1.35;
  let coronaBright = 0;
  let flarePlume = 0;
  let surfaceDetail = 0;
  let samples = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const i = (y * w + x) * 4;
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];
      const lum = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (d > r * 1.02 && d < r * 2.35) {
        samples++;
        if (lum > 34) coronaBright++;
        if (lum > 72 && red > blue * 1.05 && green > blue * 0.7) flarePlume++;
      } else if (d < r * 0.8) {
        if (Math.abs(red - green) > 18 || Math.abs(green - blue) > 20) surfaceDetail++;
      }
    }
  }
  return { coronaBright, flarePlume, surfaceDetail, samples };
});

fs.writeFileSync(path.join(OUT_DIR, 'star-visual-metrics.json'), JSON.stringify(metrics, null, 2));
check('flare corona has bright outer pixels', metrics.coronaBright > 800, `${metrics.coronaBright}/${metrics.samples}`);
check('flare star has bright plasma plumes', metrics.flarePlume > 70, `${metrics.flarePlume} plume pixels`);
check('star surface has visible color variation', metrics.surfaceDetail > 1200, `${metrics.surfaceDetail} varied core samples`);
check('no shader or console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\nStar visuals: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
