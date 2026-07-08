// Dev-panel Unlock All Tech performance regression check.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try {
  ({ chromium } = createRequire(path.join(here, '../package.json'))('playwright'));
} catch {
  ({ chromium } = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/')('playwright'));
}

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => {
  localStorage.clear();
  window.__newGame(779);
  if (!document.querySelector('#dev-panel:not(.hidden)')) window.__toggleDevPanel();
});

check('1.1 dev panel opened', await page.locator('#dev-panel').isVisible());

const sampleFrames = () => page.evaluate(async () => {
  const start = performance.now();
  let last = start;
  let frames = 0;
  let worstGapMs = 0;
  await new Promise((resolve) => {
    function step(now) {
      frames += 1;
      worstGapMs = Math.max(worstGapMs, now - last);
      last = now;
      if (now - start >= 1000) resolve();
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  return { frames, worstGapMs, elapsedMs: last - start };
});

const baselineFrames = await sampleFrames();
check('1.2 baseline frame sampler active',
  baselineFrames.frames >= 2,
  `frames=${baselineFrames.frames} worstGap=${baselineFrames.worstGapMs.toFixed(1)}ms`);

const unlockStats = await page.evaluate(() => {
  const button = document.getElementById('dev-unlock-all-tech');
  const techCount = window.__getTechWeb().length;
  const start = performance.now();
  button.click();
  const elapsedMs = performance.now() - start;
  return {
    elapsedMs,
    techCount,
    unlockedCount: window.getGameState().research.unlocked.length,
    status: document.getElementById('dev-status')?.textContent ?? '',
  };
});

check('2.1 unlock button completes quickly',
  unlockStats.elapsedMs < 50,
  `elapsed=${unlockStats.elapsedMs.toFixed(1)}ms status=${unlockStats.status}`);
check('2.2 all tech unlocked',
  unlockStats.unlockedCount >= unlockStats.techCount,
  `unlocked=${unlockStats.unlockedCount} techCount=${unlockStats.techCount}`);

const frameStats = await sampleFrames();

check('3.1 dev panel remains responsive after unlock',
  frameStats.frames >= Math.max(2, baselineFrames.frames - 1)
    && frameStats.worstGapMs <= Math.max(150, baselineFrames.worstGapMs * 1.5),
  `before=${baselineFrames.frames}/${baselineFrames.worstGapMs.toFixed(1)}ms after=${frameStats.frames}/${frameStats.worstGapMs.toFixed(1)}ms`);
check('4.1 no console errors', errors.length === 0, errors.join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
