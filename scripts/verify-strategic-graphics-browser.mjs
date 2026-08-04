import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const outputDir = new URL('../output/strategic-graphics-browser/', import.meta.url);
fs.mkdirSync(outputDir, { recursive: true });
const pathFor = (name) => fileURLToPath(new URL(name, outputDir));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(8000);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
    errors.push(`console: ${message.text()}`);
  }
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

try {
  await page.goto(process.env.GS_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__newGame === 'function');
  const setup = await page.evaluate(() => {
    window.__newGame(6027, { mode: 'sandbox', aiDifficulty: 'normal' });
    window.__setBootPhase('playing');
    document.getElementById('title-screen')?.classList.add('hidden');
    const state = window.getGameState();
    state.paused = false;
    window.__devAction('revealAllIntel');
    window.__devAction('unlockAllTech');
    const home = state.stronghold;
    const galaxy = state.galaxies[state.activeGalaxyId];
    const system = galaxy.systems[home];
    const homeStar = galaxy.graph.stars.find((entry) => entry.id === home);
    const nearbyIds = galaxy.graph.stars
      .filter((entry) => Math.hypot(entry.x - homeStar.x, entry.y - homeStar.y) < 1050)
      .sort((a, b) => Math.hypot(a.x - homeStar.x, a.y - homeStar.y)
        - Math.hypot(b.x - homeStar.x, b.y - homeStar.y))
      .map((entry) => entry.id);
    for (const systemId of nearbyIds.slice(1, 4)) galaxy.systems[systemId].owner = 'player';
    const rival = state.factions.list[0];
    for (const systemId of nearbyIds.slice(4, 10)) {
      galaxy.systems[systemId].owner = 'ai';
      galaxy.systems[systemId].factionId = rival.id;
    }
    if (!system.structures.some((entry) => entry.type === 'export_depot')) {
      system.structures.push({
        id: 'graphics-export-center',
        type: 'export_depot',
        bodyId: null,
        level: 3,
        operational: true,
        builtAtTime: state.time,
      });
    }
    const registration = window.__registerExportDepot(home, {
      force: true,
      allowNonPlayer: true,
      level: 3,
    });
    const depot = registration.depot
      ?? Object.values(state.logistics.depots).find((entry) => entry.systemId === home);
    for (const entry of Object.values(state.logistics.depots)) {
      if (entry.systemId !== home) continue;
      entry.level = 3;
      entry.capacity = Math.max(360, entry.capacity ?? 0);
      entry.assemblyBays = 3;
      entry.storedCredits = 270;
      entry.inventory = { rawMaterials: 140, fuel: 80, manufacturedGoods: 50 };
    }
    const nexus = window.__listTradeNexuses()[0];
    if (!nexus) throw new Error('fixture requires a Trade Nexus');
    window.__setDepotDestination(depot.id, nexus.systemId);
    const dispatch = window.__dispatchDepot(depot.id, {
      destinationSystemId: nexus.systemId,
      force: true,
    });
    window.__setView('system');
    window.__viewSystem(home);
    let hash = 2166136261;
    for (const character of home) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2 + state.time / 90000;
    const orbit = Math.max(430, (system.star.radius ?? 180) + 285);
    window.__snapCamera(Math.cos(angle) * orbit, Math.sin(angle) * orbit, 1.18);
    return {
      home,
      homePosition: { x: homeStar.x, y: homeStar.y },
      nexus: nexus.systemId,
      depotId: depot.id,
      dispatch,
      convoyCount: state.logistics.convoys.length,
    };
  });
  assert.equal(setup.dispatch.ok, true, setup.dispatch.reason ?? 'convoy dispatch failed');
  assert.ok(setup.convoyCount > 0, 'convoy fixture should be visible');
  await page.waitForTimeout(80);
  await page.screenshot({ path: pathFor('export-center-and-convoy.png') });

  await page.evaluate(({ x, y }) => {
    window.__setView('galaxy');
    window.__snapGalaxyCamera(x, y, 0.58);
  }, setup.homePosition);
  await page.waitForTimeout(80);
  await page.screenshot({ path: pathFor('galaxy-sovereignty-and-convoy.png') });

  const textState = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert.equal(textState.view, 'galaxy');
  assert.ok(textState.logistics.convoys.length > 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(
    new URL('result.json', outputDir),
    JSON.stringify({ setup, errors, convoy: textState.logistics.convoys[0] }, null, 2),
  );
  console.log('Strategic graphics browser verification passed', setup);
} finally {
  await browser.close();
}
