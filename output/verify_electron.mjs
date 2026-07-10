// Electron verification: window.gameSave IPC, on-disk saves, restart persistence.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(process.env.HOME + '/.codex/skills/develop-web-game/scripts/');
const { _electron: electron } = require('playwright');

import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const electronBin = path.join(projectRoot, 'node_modules', '.bin', 'electron');
const saveDir = path.join(os.homedir(), 'Documents', 'Galactic Sovereign', 'saves');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function launch() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: ['.'],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  // Vite's websocket can trigger one full reload right after connect; let it settle.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  return { app, page };
}

// --- Session 1: build, save to disk ---
let { app, page } = await launch();
const hasBridge = await page.evaluate(() => !!window.gameSave);
check('window.gameSave bridge present', hasBridge);

const habitable = await page.evaluate(() => {
  const s = JSON.parse(window.render_game_to_text());
  return s.bodies.find((b) => b.type === 'habitable' && b.moonCount > 0);
});
// Pause so real-time income doesn't drift while we assert exact values.
await page.keyboard.press('Space');
await page.evaluate((id) => window.__buildOutpost(id), habitable.id);
await page.evaluate(() => window.__saveSlot('slot-1'));
await page.waitForTimeout(500);

const slotFile = path.join(saveDir, 'slot-1.json');
check('save file exists on disk', fs.existsSync(slotFile), slotFile);
const envelope = JSON.parse(fs.readFileSync(slotFile, 'utf8'));
// Ground truth for the restore check is what was actually written to disk.
const creditsBefore = envelope.state.credits;
check('envelope has saveVersion 12', envelope.saveVersion === 12);
check('envelope has checksum', /^[0-9a-f]{8}$/.test(envelope.checksum), envelope.checksum);

await page.screenshot({ path: path.join(projectRoot, 'output', 'web-game', 'electron-session1.png') });
await app.close();

// --- Session 2: fresh app instance, load from disk ---
({ app, page } = await launch());
const fresh = await page.evaluate(() => JSON.parse(window.render_game_to_text()).credits);
check('fresh session starts at 500', fresh === 500, `credits=${fresh}`);
await page.evaluate(() => window.__loadSlot('slot-1'));
await page.waitForTimeout(500);
const restored = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
check('restart restores credits', Math.abs(restored.credits - creditsBefore) < 0.001,
  `restored=${restored.credits} expected=${creditsBefore}`);
check('restart restores outpost and export depot',
  restored.structures.some((structure) => structure.type === 'outpost')
    && restored.structures.some((structure) => structure.type === 'export_depot'));

// exit-save: close app window gracefully, then check the file appeared
await app.close();
await new Promise((r) => setTimeout(r, 1000));
const exitFile = path.join(saveDir, 'exit-save.json');
check('exit-save written on quit', fs.existsSync(exitFile), exitFile);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
