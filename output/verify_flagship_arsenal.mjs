// Flagship multi-battery arsenal verification.
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

const outDir = path.join(__dir, 'web-game/flagship-arsenal');
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

const text = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
let s = await text();
check('1. weapons suite present', Array.isArray(s.flagship.weapons) && s.flagship.weapons.length >= 5, String(s.flagship.weapons?.length));
const profiles = new Set(s.flagship.weapons.map((w) => w.profile));
check('2. has beam_lance', profiles.has('beam_lance'));
check('3. has kinetic', profiles.has('kinetic'));
check('4. has torpedo', profiles.has('torpedo'));
check('5. has point_defense', profiles.has('point_defense'));
check('6. has ion', profiles.has('ion'));

await page.evaluate(() => {
  const st = window.getGameState();
  st.flagship.x = 400;
  st.flagship.y = -200;
  window.__spawnEnemyFleet(st.flagship.systemId);
});
await page.evaluate(() => window.advanceTime(500));
s = await text();
const battle = await page.evaluate(() => {
  const st = window.getGameState();
  const sid = st.flagship.systemId;
  return window.__getBattleState?.(sid) ?? st.systemBattles?.[sid] ?? null;
});
check('7. battle triggered', !!battle?.active, battle?.mode ?? 'none');
const flagUnit = battle?.units?.find((u) => u.hull === 'flagship');
check('8. flagship combat unit has weapons', Array.isArray(flagUnit?.weapons) && flagUnit.weapons.length >= 5);
check('9. flagship hideSprite set', flagUnit?.hideSprite === true);

await page.evaluate(() => window.advanceTime(3000));
const fx = await page.evaluate(() => {
  const st = window.getGameState();
  const b = st.systemBattles?.[st.flagship.systemId];
  return (b?.fxEvents ?? []).map((e) => e.profile ?? e.type).filter(Boolean);
});
check('10. multi-profile FX emitted', new Set(fx).size >= 2 || fx.length >= 3, fx.slice(0, 8).join(','));

await page.screenshot({ path: path.join(outDir, '01-flagship-arsenal.png') });
check('11. no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
