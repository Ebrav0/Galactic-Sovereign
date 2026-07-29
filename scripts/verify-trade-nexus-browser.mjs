import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const outputDir = new URL('../output/trade-nexus-redesign/', import.meta.url);
fs.mkdirSync(outputDir, { recursive: true });
const pathFor = (name) => fileURLToPath(new URL(name, outputDir));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(10000);
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
    window.__newGame(72628, { mode: 'sandbox', aiDifficulty: 'normal' });
    window.__setBootPhase('playing');
    document.getElementById('title-screen')?.classList.add('hidden');
    const state = window.getGameState();
    window.__devAction('revealAllIntel');
    window.__devAction('unlockAllTech');
    const home = state.stronghold;
    const galaxy = state.galaxies[state.activeGalaxyId];
    const system = galaxy.systems[home];
    if (!system.structures.some((entry) => entry.type === 'export_depot')) {
      system.structures.push({
        id: 'nexus-visual-export-center',
        type: 'export_depot',
        bodyId: null,
        level: 3,
        operational: true,
        builtAtTime: state.time,
      });
    }
    const depot = window.__registerExportDepot(home, {
      force: true,
      allowNonPlayer: true,
      level: 3,
    }).depot ?? Object.values(state.logistics.depots).find((entry) => entry.systemId === home);
    depot.storedCredits = 600;
    depot.capacity = Math.max(600, depot.capacity);
    depot.level = 3;
    depot.assemblyBays = 3;
    const nexus = window.__listTradeNexuses().find((entry) => entry.available);
    if (!nexus) throw new Error('Fixture requires an available Trade Nexus');
    window.__setDepotDestination(depot.id, nexus.systemId);
    const dispatch = window.__dispatchDepot(depot.id, {
      destinationSystemId: nexus.systemId,
      doctrineId: 'bulk',
      force: true,
    });
    if (!dispatch.ok) throw new Error(dispatch.reason);
    const convoy = dispatch.convoy;
    convoy.status = 'delivered';
    convoy.systemId = nexus.systemId;
    convoy.currentNodeId = nexus.systemId;
    convoy.deliveredAt = state.time;
    convoy.deliveryValue = convoy.creditLoad;
    state.logistics.convoys.push({
      ...structuredClone(convoy),
      id: 'convoy-2',
      convoySpeed: Math.max(40, convoy.convoySpeed * 0.92),
    });
    state.paused = false;
    window.__setView('system');
    window.__viewSystem(nexus.systemId);
    window.__snapCamera(0, 0, 0.92);
    return {
      home,
      nexus: nexus.systemId,
      convoyId: convoy.id,
      convoyIds: [convoy.id, 'convoy-2'],
      deliveredAt: convoy.deliveredAt,
      depotId: depot.id,
      path: [...convoy.path],
    };
  });

  async function captureNexusPhase(offsetMs, expectedPhase, fileName) {
    const text = await page.evaluate(({ deliveredAt, offset }) => {
      const state = window.getGameState();
      state.time = deliveredAt + offset;
      state.paused = false;
      window.__viewSystem(window.__nexusFixtureSystemId);
      window.__snapCamera(0, 0, 0.92);
      return JSON.parse(window.render_game_to_text());
    }, { deliveredAt: setup.deliveredAt, offset: offsetMs });
    const traffic = text.logistics.nexusTraffic.find((entry) => entry.convoyId === setup.convoyId);
    assert.equal(traffic?.phase, expectedPhase);
    assert.ok(Number.isInteger(traffic.portIndex) && traffic.portIndex >= 0 && traffic.portIndex < 6);
    await page.waitForTimeout(80);
    await page.screenshot({ path: pathFor(fileName) });
    return traffic;
  }

  await page.evaluate((nexusId) => {
    window.__nexusFixtureSystemId = nexusId;
  }, setup.nexus);

  const approach = await captureNexusPhase(1300, 'approach', '01-nexus-approach.png');
  const approachTraffic = JSON.parse(await page.evaluate(() => window.render_game_to_text()))
    .logistics.nexusTraffic;
  assert.equal(approachTraffic.length, 2, 'Expected two simultaneous cargo ships at the Nexus');
  assert.equal(
    new Set(approachTraffic.map((entry) => entry.portIndex)).size,
    2,
    'Simultaneous cargo ships must dock at different ports',
  );
  const unloading = await captureNexusPhase(5600, 'unloading', '02-nexus-unloading.png');
  const departing = await captureNexusPhase(8850, 'departing', '03-nexus-departure.png');
  assert.equal(approach.portIndex, unloading.portIndex);
  assert.equal(unloading.portIndex, departing.portIndex);
  assert.ok(unloading.cargoRatio < 1 && unloading.cargoRatio > 0);

  const returning = await page.evaluate(async ({ deliveredAt, convoyId }) => {
    const state = window.getGameState();
    const convoy = state.logistics.convoys.find((entry) => entry.id === convoyId);
    const { convoyReturnTransitStatus } = await import('/js/logistics.js');
    for (let offset = 12000; offset < 180000; offset += 250) {
      state.time = deliveredAt + offset;
      const status = convoyReturnTransitStatus(state, convoy);
      if (status?.phase === 'returning' && status.progress > 0.2 && status.progress < 0.8) {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(status.x, status.y, 0.72);
        return { offset, status };
      }
    }
    return null;
  }, setup);
  assert.ok(returning, 'Expected an empty convoy on the reverse lane');
  await page.waitForTimeout(80);
  await page.screenshot({ path: pathFor('04-empty-return-lane.png') });

  const originArrival = await page.evaluate(async ({ deliveredAt, convoyId, home }) => {
    const state = window.getGameState();
    const convoy = state.logistics.convoys.find((entry) => entry.id === convoyId);
    const { convoyReturnTransitStatus } = await import('/js/logistics.js');
    const { exportDepotWorldPose } = await import('/js/trade-nexus-render.js');
    for (let offset = 12000; offset < 180000; offset += 250) {
      state.time = deliveredAt + offset;
      const status = convoyReturnTransitStatus(state, convoy);
      if (status?.phase !== 'origin_arrival' || status.progress < 0.25) continue;
      window.__setView('system');
      window.__viewSystem(home);
      const homeSystem = state.galaxies[state.activeGalaxyId].systems[home];
      const pose = exportDepotWorldPose(homeSystem, state.time);
      window.__snapCamera(pose.x, pose.y, 1.18);
      return { offset, status };
    }
    return null;
  }, setup);
  assert.ok(originArrival, 'Expected the empty convoy to return to its Export Center');
  const originText = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert.equal(originText.logistics.nexusTraffic[0]?.phase, 'origin_arrival');
  await page.waitForTimeout(80);
  await page.screenshot({ path: pathFor('05-origin-return.png') });

  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(
    new URL('result.json', outputDir),
    JSON.stringify({ setup, approach, unloading, departing, returning, originArrival, errors }, null, 2),
  );
  console.log('Trade Nexus browser verification passed', {
    convoyId: setup.convoyId,
    portIndex: approach.portIndex,
    path: setup.path,
    returnOffsetMs: returning.offset,
    originArrivalOffsetMs: originArrival.offset,
  });
} finally {
  await browser.close();
}
